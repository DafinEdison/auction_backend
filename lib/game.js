const path = require("path");
const fs = require("fs");
const Auction = require("./auction");

const liveAuctions = new Map();

let squads = null;
function loadSquads() {
  try {
    // Try local data folder within the Next app or server project
    let text;
    try {
      const localPath = path.resolve(process.cwd(), "data/squads.json");
      text = fs.readFileSync(localPath, "utf-8");
      squads = JSON.parse(text);
      return;
    } catch (_) {}

    // Try sibling Next app data path when running from external socket server
    try {
      const siblingNextPath = path.resolve(process.cwd(), "../ipl-auction-next/data/squads.json");
      text = fs.readFileSync(siblingNextPath, "utf-8");
      squads = JSON.parse(text);
      return;
    } catch (_) {}

    // Fallback: original sibling path from the legacy project
    try {
      const legacyPath = path.resolve(process.cwd(), "../Ipl-Auction/data/squads.json");
      text = fs.readFileSync(legacyPath, "utf-8");
      squads = JSON.parse(text);
      return;
    } catch (_) {}

    // Final fallback minimal data if not found
    squads = [
      {
        squad: "demo-squad",
        players: [
          { name: "Demo Player 1", stats: { role: "Batsman" } },
          { name: "Demo Player 2", stats: { role: "Bowler" } },
        ],
      },
    ];
  } catch (e) {
    // Fallback minimal data if not found
    squads = [
      {
        squad: "demo-squad",
        players: [
          { name: "Demo Player 1", stats: { role: "Batsman" } },
          { name: "Demo Player 2", stats: { role: "Bowler" } },
        ],
      },
    ];
  }
}

loadSquads();

// Export squads snapshot for APIs that need a fallback
function getSquads() {
  return Array.isArray(squads) ? squads : [];
}

const create = (io, socket, data) => {
  socket.join(data.room);
  // Track socket association to enable cleanup on disconnect
  try {
    socket.data = socket.data || {};
    socket.data.room = data.room;
    socket.data.username = data.username;
  } catch (e) {}
  const auction = new Auction(io.to(data.room));
  // Track host for admin settings
  auction.host = data.username;
  // Provide context for auto-advance on timeout
  try { auction.setContext(liveAuctions, data.room); } catch (e) {}
  auction.public = Boolean(data.public);
  auction.addUser(data.username);
  liveAuctions.set(data.room, auction);
  io.to(data.room).emit("users", { users: auction.users, settings: auction.getSettings(), host: auction.host });
};

const join = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) {
    return socket.emit("join-result", {
      success: false,
      error: "Room does not exist!!",
    });
  }
  auction.addUser(data.username);
  socket.join(data.room);
  // Track socket association to enable cleanup on disconnect
  try {
    socket.data = socket.data || {};
    socket.data.room = data.room;
    socket.data.username = data.username;
  } catch (e) {}
  socket.emit("join-result", { success: true, room: data.room, error: "" });
  io.to(data.room).emit("users", { users: auction.users, settings: auction.getSettings(), host: auction.host });
};

const start = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return;
  const username = socket?.data?.username;
  if (!username || username !== auction.host) {
    return socket.emit("start-error", { message: "Only the room creator can start the auction." });
  }
  io.to(data.room).emit("start");
};

const play = (socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return;
  const username = socket?.data?.username;
  if (!username || username !== auction.host) {
    return socket.emit("start-error", { message: "Only the room creator can start the auction." });
  }
  auction.startAuction();
  try { auction.setSquads(squads); } catch (e) {}
  auction.servePlayer(squads);
  auction.startInterval();
};

const bid = (socket, data) => {
  const auction = liveAuctions.get(data.room);
  auction.bid(socket, data.user);
  auction.displayBidder();
};

const next = async (io, data) => {
  const auction = liveAuctions.get(data.room);
  await auction.next(squads, liveAuctions, data.room);
};

const rtmAccept = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return;
  try { auction.handleRTMAccept(data.user); } catch (e) {}
};

const checkUser = (socket, user) => {
  let toBeFound;
  let room;

  for (let [key, value] of liveAuctions) {
    const find = value.findUser(user.username);
    if (find) {
      toBeFound = find;
      room = key;
      break;
    }
  }

  if (toBeFound) {
    socket.join(room);
    socket.emit("existing-user", {
      room: room,
      users: liveAuctions.get(room).fetchPlayers(),
      initial: liveAuctions.get(room).getCurrentPlayer(),
      started: liveAuctions.get(room).getStatus(),
      timer: liveAuctions.get(room).timer,
    });
    // Also emit current state so UI can restore immediately
    const auction = liveAuctions.get(room);
    if (auction) {
      socket.emit("start");
      const player = auction.getCurrentPlayer();
      if (player) socket.emit("player", { player });
      socket.emit("bid", { currentBidder: auction.getCurrentBid() });
      socket.emit("display", { time: auction.timer });
    }
  } else {
    socket.emit("no-existing-user");
  }
};

const serverUsers = (io, room) => {
  const auction = liveAuctions.get(room);
  if (!auction) return;
  io.to(room).emit("users", { users: auction.users, settings: auction.getSettings(), host: auction.host });
};

const TEAM_MAP = {
  csk: "chennai-super-kings",
  mi: "mumbai-indians",
  rcb: "royal-challengers-bangalore",
  kkr: "kolkata-knight-riders",
  srh: "sunrisers-hyderabad",
  rr: "rajasthan-royals",
  dc: "delhi-capitals",
  pbks: "punjab-kings",
};
const toSlug = (abbr) => TEAM_MAP[(abbr || "").toLowerCase()] || (abbr || "").toLowerCase();

const chooseTeam = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return socket.emit("team-error", { message: "Room not found" });
  const user = auction.findUser(data.username);
  if (!user) return socket.emit("team-error", { message: "User not in room" });
  const slug = toSlug(data.team);
  // Prevent duplicate team selection
  const alreadyTaken = auction.users.some((u) => toSlug(u.team) === slug && u.user !== data.username);
  if (alreadyTaken) {
    return socket.emit("team-error", { message: "This team is already taken. Choose a different one." });
  }
  user.setTeam(data.team);
  try {
    // Pre-populate retained players for selected team if user has no players yet
    const teamSlug = slug;
    if (teamSlug && user.players.length === 0) {
      const squadObj = (squads || []).find((s) => (s.squad || "").toLowerCase() === teamSlug);
      const retainedCount = (auction && auction.retainedCount) || 5;
      if (squadObj && Array.isArray(squadObj.players)) {
        const retained = squadObj.players.slice(0, Math.min(retainedCount, squadObj.players.length));
        for (const p of retained) {
          // Avoid duplicate by name if any
          const exists = user.players.some((up) => (up?.name || "") === (p?.name || ""));
          if (!exists) {
            try { user.addPlayer(p); } catch (e) {}
          }
        }
      }
    }
  } catch (e) {}
  serverUsers(io, data.room);
  socket.emit("team-updated", { success: true, team: data.team });
};

const settings = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return socket.emit("settings-error", { message: "Room not found" });
  // Only host can update settings
  const username = socket?.data?.username;
  if (!username || username !== auction.host) {
    return socket.emit("settings-error", { message: "Not authorized" });
  }
  try {
    if (typeof data.rtmEnabled === "boolean") auction.setRTMEnabled(data.rtmEnabled);
    if (typeof data.rtmPerTeam === "number" && data.rtmPerTeam >= 0 && data.rtmPerTeam <= 5) auction.setRTMPerTeam(data.rtmPerTeam);
    serverUsers(io, data.room);
    socket.emit("settings-updated", { success: true, settings: auction.getSettings() });
  } catch (e) {
    socket.emit("settings-error", { message: "Failed to update settings" });
  }
};

const exitUser = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return;
  // If the exiting user is the current highest bidder, clear the bidder
  if (auction.currentBidder === data.user) {
    auction.currentBidder = "";
    // Notify clients so UI reflects no current bidder
    auction.displayBidder();
  }
  auction.removeUser(data.user);
  try { socket.leave(data.room); } catch (e) {}
  if (auction.users.length === 0) {
    liveAuctions.delete(data.room);
  } else {
    serverUsers(io, data.room);
  }
};

const listAuctions = () => {
  const rooms = [];
  for (let [key, value] of liveAuctions) {
    if (value.public) {
      rooms.push({ room: key, users: value.users.map((u) => u.user) });
    }
  }
  return rooms;
};

const follow = (io, socket, data) => {
  const auction = liveAuctions.get(data.room);
  if (!auction) return socket.emit("join-result", { success: false, error: "Room does not exist!!" });
  // Join socket to room but do NOT add to users list
  socket.join(data.room);
  try {
    socket.data = socket.data || {};
    socket.data.room = data.room;
    socket.data.username = data.username || "";
  } catch (e) {}
  // Send current state so viewer sees live data immediately
  socket.emit("start");
  const player = auction.getCurrentPlayer();
  if (player) socket.emit("player", { player });
  socket.emit("bid", { currentBidder: auction.getCurrentBid() });
  socket.emit("display", { time: auction.timer });
};

module.exports = {
  create,
  join,
  start,
  play,
  bid,
  next,
  checkUser,
  serverUsers,
  exitUser,
  listAuctions,
  chooseTeam,
  follow,
  settings,
  rtmAccept,
  getSquads,
};
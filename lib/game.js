const path = require("path");
const fs = require("fs");
const Auction = require("./auction");

const liveAuctions = new Map();

let squads = null;
function loadSquads() {
  try {
    // Try local data folder within the socket server project
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

function getSquads() {
  return squads;
}

const create = (io, socket, data) => {
  const { room, user } = data;
  if (liveAuctions.has(room)) {
    socket.emit("error", { message: "Room already exists" });
    return;
  }
  
  const auction = new Auction(room);
  auction.setContext(liveAuctions, room);
  auction.setSquads(squads);
  auction.host = user;
  auction.addUser(user);
  
  liveAuctions.set(room, auction);
  socket.join(room);
  socket.emit("created", { room, user });
  io.to(room).emit("users", {
    users: auction.users.map(u => ({ user: u.user, team: u.getTeam() })),
    host: auction.host,
    settings: auction.getSettings(),
  });
};

const join = (io, socket, data) => {
  const { room, user } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  if (auction.getStatus()) {
    socket.emit("error", { message: "Auction has already started" });
    return;
  }
  
  auction.addUser(user);
  socket.join(room);
  socket.emit("joined", { room, user });
  io.to(room).emit("users", {
    users: auction.users.map(u => ({ user: u.user, team: u.getTeam() })),
    host: auction.host,
    settings: auction.getSettings(),
  });
};

const start = (io, socket, data) => {
  const { room } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  auction.startAuction();
  auction.servePlayer(squads);
  auction.resetBid();
  auction.resetTimer();
  auction.startInterval();
  
  io.to(room).emit("start");
};

const play = (socket, data) => {
  const { room } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  socket.emit("play", {
    player: auction.getCurrentPlayer(),
    bid: auction.getCurrentBid(),
    bidder: auction.displayBidder(),
    timer: auction.timer,
  });
};

const bid = (socket, data) => {
  const { room, user } = data;
  const auction = liveAuctions.get(room);
  auction.bid(socket, user);
};

const next = async (io, data) => {
  const { room } = data;
  const auction = liveAuctions.get(room);
  await auction.advanceAfterTimeout();
};

const rtmAccept = (io, socket, data) => {
  const { room, user } = data;
  const auction = liveAuctions.get(room);
  auction.handleRTMAccept(user);
};

const checkUser = (socket, user) => {
  if (!user) {
    socket.emit("error", { message: "User not found" });
    return false;
  }
  
  if (typeof user !== "string" || user.trim() === "") {
    socket.emit("error", { message: "Invalid user" });
    return false;
  }
  
  if (user.length > 20) {
    socket.emit("error", { message: "Username too long" });
    return false;
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(user)) {
    socket.emit("error", { message: "Username contains invalid characters" });
    return false;
  }
  
  return true;
};

const serverUsers = (io, room) => {
  const auction = liveAuctions.get(room);
  if (auction) {
    io.to(room).emit("users", {
      users: auction.users.map(u => ({ user: u.user, team: u.getTeam() })),
      host: auction.host,
      settings: auction.getSettings(),
    });
  }
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

const chooseTeam = (io, socket, data) => {
  const { room, user, team } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  const userObj = auction.findUser(user);
  if (!userObj) {
    socket.emit("error", { message: "User not found in auction" });
    return;
  }
  
  const teamKey = TEAM_MAP[team];
  if (!teamKey) {
    socket.emit("error", { message: "Invalid team" });
    return;
  }
  
  // Check if team is already taken
  const teamTaken = auction.users.some(u => u.getTeam() === teamKey && u.user !== user);
  if (teamTaken) {
    socket.emit("error", { message: "Team already taken" });
    return;
  }
  
  userObj.setTeam(teamKey);
  socket.emit("teamChosen", { team: teamKey });
  serverUsers(io, room);
};

const settings = (io, socket, data) => {
  const { room, rtmEnabled, rtmPerTeam } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  if (rtmEnabled !== undefined) {
    auction.setRTMEnabled(rtmEnabled);
  }
  
  if (rtmPerTeam !== undefined) {
    auction.setRTMPerTeam(rtmPerTeam);
  }
  
  io.to(room).emit("settings", auction.getSettings());
};

const exitUser = (io, socket, data) => {
  const { room, user } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    return;
  }
  
  auction.removeUser(user);
  socket.leave(room);
  
  if (auction.users.length === 0) {
    auction.clearTimer();
    liveAuctions.delete(room);
  } else {
    serverUsers(io, room);
  }
  
  socket.emit("exited", { room });
};

const listAuctions = () => {
  return Array.from(liveAuctions.keys()).map(room => ({
    room,
    users: liveAuctions.get(room).users.length,
    started: liveAuctions.get(room).getStatus(),
  }));
};

const follow = (io, socket, data) => {
  const { room } = data;
  const auction = liveAuctions.get(room);
  
  if (!auction) {
    socket.emit("error", { message: "Room does not exist" });
    return;
  }
  
  socket.join(room);
  socket.emit("following", { room });
  
  if (auction.getStatus()) {
    socket.emit("play", {
      player: auction.getCurrentPlayer(),
      bid: auction.getCurrentBid(),
      bidder: auction.displayBidder(),
      timer: auction.timer,
    });
  }
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
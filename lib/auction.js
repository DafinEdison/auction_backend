const User = require("./user");
const { dbConnect } = require("../lib/db");
const dbUser = require("../models/User");

class Auction {
  constructor(room) {
    this.users = [];
    this.currentBidder = "";
    this.currentBid = 0;
    this.currentPlayer = "";
    this.timer = 10;
    this.interval = null;
    this.room = room;
    this.roomId = "";
    this.liveAuctions = null;
    this.squads = null;
    this.squad = 0;
    this.player = 0;
    // Number of retained players per squad to skip in auction
    this.retainedCount = 5;
    this.confirm = 0;
    this.started = false;
    this.commentary = [];
    // RTM state
    this.rtmActive = false;
    this.rtmEligibleUser = "";
    this.rtmWindow = 0;
    this.rtmInterval = null;
    // Settings
    this.rtmEnabled = true;
    this.rtmPerTeam = 3;
    this.host = "";
  }

  startAuction() {
    this.started = true;
    // Begin serving players after retained slots per squad
    this.player = this.retainedCount;
  }

  getStatus() {
    return this.started;
  }

  bid(socket, bidder) {
    if (this.currentBidder === bidder) {
      return;
    }
    const user = this.findUser(bidder);
    const increment = this.getIncrement(this.currentBid);
    if (!user || user.budget < this.currentBid + increment) {
      return socket.emit("bid-error", {
        message: "The current bid exceeds your budget.",
      });
    }
    // Round to 2 decimals to avoid floating-point artifacts
    this.currentBid = Number((this.currentBid + increment).toFixed(2));
    this.currentBidder = bidder;
    this.commentary.push({
      user: bidder,
      team: (user && user.team) || "",
      amount: this.currentBid,
      player: this.currentPlayer?.name || "",
    });
    // Encourage active bidding: add 5 seconds on each valid bid
    this.extendTimer(5);
    // Limit live commentary to the most recent 5 activities
    this.room.emit("commentary", { history: this.commentary.slice(-5) });
    this.displayBidder();
  }

  findUser(user) {
    return this.users.find((u) => u.user === user);
  }

  servePlayer(squads) {
    const player = squads[this.squad].players[this.player];
    player.basePrice = this.getBasePrice(player);
    this.commentary = [];
    this.resetBid();
    this.currentBid = player.basePrice || 0;
    this.currentPlayer = player;
    this.room.emit("player", { player });
    this.displayBidder();
    this.room.emit("commentary", { history: [] });
  }

  getCurrentPlayer() {
    return this.currentPlayer;
  }

  getCurrentBid() {
    return { bidder: this.currentBidder, bid: this.currentBid };
  }

  getIncrement(currentBid) {
    if (currentBid < 1) return 0.05;
    if (currentBid < 2) return 0.1;
    if (currentBid < 5) return 0.2;
    return 0.25;
  }

  getBasePrice(player) {
    try {
      const role = (player?.stats?.role || "").toLowerCase();
      if (role.includes("all")) return 1.0;
      return 0.5;
    } catch (e) {
      return 0.5;
    }
  }

  displayBidder() {
    this.room.emit("bid", { currentBidder: this.getCurrentBid() });
  }

  resetBid() {
    this.currentBidder = "";
    this.currentBid = 0;
  }

  resetTimer() {
    this.timer = 10;
    this.confirm = 0;
  }

  clearTimer() {
    try { clearInterval(this.interval); } catch (e) {}
    this.interval = null;
  }

  extendTimer(seconds = 5) {
    const add = Number(seconds) || 0;
    if (add <= 0) return;
    // Do not revive timer after it has expired
    if (this.timer <= 0) return;
    this.timer += add;
    // Immediately broadcast the new time so clients reflect the extension
    this.room.emit("display", { time: this.timer });
  }

  startInterval() {
    // Prevent multiple intervals from running concurrently
    if (this.interval) {
      try { clearInterval(this.interval); } catch (e) {}
      this.interval = null;
    }
    const currObj = this;
    this.interval = setInterval(() => {
      currObj.decrementClock();
    }, 1000);
  }

  decrementClock() {
    if (this.timer === 0) {
      if (this.currentBidder) {
        // Offer RTM window to the previous franchise if eligible
        const eligible = this.getRTMEligibleUser(this.currentPlayer);
        if (eligible && eligible.user !== this.currentBidder) {
          this.clearTimer();
          this.startRTMWindow(eligible);
          return; // pause normal flow until RTM resolves
        }
        // No RTM or bidder is same as eligible; finalize sale
        this.addPlayer(this.currentPlayer, this.currentBid);
        this.clearTimer();
        this.resetBid();
        try { this.advanceAfterTimeout(); } catch (e) {}
      } else {
        this.room.emit("unsold", {
          player: this.currentPlayer,
          basePrice: this.currentPlayer?.basePrice || 0,
        });
        this.clearTimer();
        this.resetBid();
        try { this.advanceAfterTimeout(); } catch (e) {}
      }
    }
    const time = this.timer;
    this.room.emit("display", { time });
    this.timer--;
  }

  async gameOver(squads, liveAuctions, room) {
    this.player++;
    if (squads[this.squad].players.length === this.player) {
      // Move to next squad; skip retained players again
      this.player = this.retainedCount;
      this.squad++;
      if (squads.length === this.squad) {
        const auction = this;
        this.room.emit("game-over");
        try {
          await dbConnect();
          for (const u of this.users) {
            await dbUser.findOneAndUpdate(
              { username: u.user },
              { $push: { auctions: { auction: auction.users } } },
            );
          }
        } catch (e) {
          console.error("Persist auctions failed", e);
        }
        liveAuctions.delete(room);
        return true;
      }
    }
    return false;
  }

  addUser(user) {
    if (!this.dupUser(user)) {
      const u = new User(user);
      // Initialize RTM tokens per current settings
      try { u.rtm = Number(this.rtmPerTeam) || 0; } catch (e) {}
      this.users.push(u);
    }
  }

  removeUser(user) {
    this.users = this.users.filter((u) => user !== u.user);
  }

  dupUser(user) {
    return this.users.some((u) => user === u.user);
  }

  async next(squads, liveAuctions, room) {
    this.confirm++;
    if (this.confirm >= this.users.length) {
      if (!(await this.gameOver(squads, liveAuctions, room))) {
        // Defensive: ensure any existing interval is cleared before starting a new one
        this.clearTimer();
        this.resetTimer();
        this.resetBid();
        this.startInterval();
        this.servePlayer(squads);
      }
    }
  }

  // RTM helpers
  getRTMEligibleUser(player) {
    try {
      if (!this.rtmEnabled) return null;
      const squad = (player?.squad || "").toLowerCase();
      if (!squad) return null;
      const eligible = this.users.find((u) => (u.team || "").toLowerCase() === squad && (u.rtm || 0) > 0);
      return eligible || null;
    } catch (e) {
      return null;
    }
  }

  startRTMWindow(eligibleUser) {
    this.rtmActive = true;
    this.rtmEligibleUser = eligibleUser.user;
    this.rtmWindow = 5;
    // Notify room that RTM is available to eligible user for the final bid
    this.room.emit("rtm-offer", {
      player: this.currentPlayer,
      amount: this.currentBid,
      eligible: this.rtmEligibleUser,
      time: this.rtmWindow,
    });
    // Count down RTM window
    const curr = this;
    if (this.rtmInterval) { try { clearInterval(this.rtmInterval); } catch (e) {} }
    this.rtmInterval = setInterval(() => {
      curr.rtmWindow--;
      if (curr.rtmWindow <= 0) {
        curr.finalizeRTM(false);
      }
    }, 1000);
  }

  handleRTMAccept(username) {
    if (!this.rtmActive) return;
    if (username !== this.rtmEligibleUser) return;
    // Ensure eligible user has budget and can add player
    const user = this.findUser(username);
    const amount = this.currentBid;
    if (!user || user.budget < amount) {
      // Inform client they cannot exercise RTM due to budget
      this.room.emit("rtm-error", { user: username, message: "Insufficient budget to match bid" });
      return; // remain in RTM window until timeout
    }
    // Temporarily set as current bidder and award
    const previousBidder = this.currentBidder;
    this.currentBidder = username;
    // Decrement RTM token
    try { user.rtm = Math.max(0, (user.rtm || 0) - 1); } catch (e) {}
    // Award player
    this.addPlayer(this.currentPlayer, amount);
    this.resetBid();
    this.finalizeRTM(true);
  }

  finalizeRTM(accepted) {
    // Cleanup RTM state and proceed to next player
    try { clearInterval(this.rtmInterval); } catch (e) {}
    this.rtmInterval = null;
    this.rtmActive = false;
    this.rtmEligibleUser = "";
    this.rtmWindow = 0;
    if (!accepted) {
      // RTM not used; award to original highest bidder
      if (this.currentBidder) {
        this.addPlayer(this.currentPlayer, this.currentBid);
      } else {
        this.room.emit("unsold", {
          player: this.currentPlayer,
          basePrice: this.currentPlayer?.basePrice || 0,
        });
      }
      this.resetBid();
    }
    try { this.advanceAfterTimeout(); } catch (e) {}
  }

  addPlayer(player, amount) {
    const currentUser = this.findUser(this.currentBidder);
    const can = currentUser.canAddPlayer(player);
    if (!can.ok) {
      this.room.emit("composition-error", {
        user: currentUser.user,
        message: can.reason,
      });
      this.confirm = 0;
      this.room.emit("users", { users: this.users });
      return;
    }
    currentUser.addPlayer(player);
    currentUser.deduct(amount);
    this.confirm = 0;
    this.room.emit("users", { users: this.users });
    // Broadcast sold event and append to commentary
    this.commentary.push({
      user: currentUser.user,
      team: currentUser.team || "",
      amount: amount,
      player: player?.name || "",
      sold: true,
    });
    this.room.emit("commentary", { history: this.commentary.slice(-5) });
    this.room.emit("sold", {
      player,
      user: currentUser.user,
      team: currentUser.team || "",
      amount,
    });
  }

  fetchPlayers() {
    return this.users;
  }

  // Settings accessors
  setRTMEnabled(val) {
    this.rtmEnabled = Boolean(val);
  }

  setRTMPerTeam(val) {
    const n = Number(val) || 0;
    this.rtmPerTeam = Math.max(0, Math.min(5, n));
    // Update all users to new token count only if auction not started
    if (!this.started) {
      for (const u of this.users) {
        try { u.rtm = this.rtmPerTeam; } catch (e) {}
      }
    }
  }

  getSettings() {
    return { rtmEnabled: this.rtmEnabled, rtmPerTeam: this.rtmPerTeam };
  }

  // Context setters for auto-advance on timeout
  setContext(liveAuctions, roomId) {
    this.liveAuctions = liveAuctions;
    this.roomId = roomId;
  }

  setSquads(squads) {
    this.squads = squads;
  }

  async advanceAfterTimeout() {
    try {
      const squads = this.squads;
      const liveAuctions = this.liveAuctions;
      const roomId = this.roomId;
      if (!squads) return; // cannot advance without squads context
      const over = await this.gameOver(squads, liveAuctions, roomId);
      if (!over) {
        this.resetTimer();
        this.startInterval();
        this.servePlayer(squads);
      }
    } catch (e) {
      // fail-safe: do not crash interval on errors
    }
  }
}

module.exports = Auction;
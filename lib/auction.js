const User = require("./user");
// dbConnect is safe to import (it lazy-loads mongoose)
const { dbConnect } = require("../lib/db");

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
    const newBid = this.currentBid + increment;

    try {
      user.deduct(newBid - this.currentBid);
      this.currentBid = newBid;
      this.currentBidder = bidder;
      this.resetTimer();
    } catch (error) {
      socket.emit("error", { message: error.message });
    }
  }

  findUser(user) {
    return this.users.find((u) => u.user === user);
  }

  servePlayer(squads) {
    if (this.squad < squads.length && this.player < squads[this.squad].players.length) {
      const player = squads[this.squad].players[this.player];
      player.basePrice = this.getBasePrice(player);
      this.commentary = [];
      this.resetBid();
      this.currentBid = player.basePrice || 0;
      this.currentPlayer = player;
      this.room.emit("player", { player });
      this.displayBidder();
      this.room.emit("commentary", { history: [] });
      return this.currentPlayer;
    }
    return null;
  }

  getCurrentPlayer() {
    return this.currentPlayer;
  }

  getCurrentBid() {
    return { bidder: this.currentBidder, bid: this.currentBid };
  }

  getIncrement(currentBid) {
    if (currentBid < 5) return 0.5;
    if (currentBid < 10) return 1;
    if (currentBid < 20) return 2;
    return 5;
  }

  getBasePrice(player) {
    const role = player.stats?.role?.toLowerCase() || "";
    if (role.includes("wicket-keeper") || role.includes("keeper")) return 2;
    if (role.includes("all-rounder") || role.includes("allrounder")) return 2;
    if (role.includes("batsman") || role.includes("batter")) return 1.5;
    if (role.includes("bowler")) return 1;
    return 1;
  }

  displayBidder() {
    this.room.emit("bid", { currentBidder: this.getCurrentBid() });
  }

  resetBid() {
    this.currentBid = this.getBasePrice(this.currentPlayer);
    this.currentBidder = "";
  }

  resetTimer() {
    this.timer = 10;
  }

  clearTimer() {
    if (this.interval) clearInterval(this.interval);
  }

  extendTimer(seconds = 5) {
    this.timer += seconds;
    if (this.timer > 30) {
      this.timer = 30;
    }
    this.room.emit("display", { time: this.timer });
  }

  startInterval() {
    this.interval = setInterval(() => {
      this.decrementClock();
    }, 1000);
  }

  decrementClock() {
    this.timer--;
    this.room.emit("display", { time: this.timer });
    if (this.timer <= 0) {
      this.clearTimer();
      if (this.rtmActive) {
        this.finalizeRTM(false);
      } else {
        const eligibleUser = this.getRTMEligibleUser(this.currentPlayer);
        if (this.rtmEnabled && eligibleUser && this.currentBidder !== eligibleUser) {
          this.startRTMWindow(eligibleUser);
        } else {
          this.addPlayer(this.currentPlayer, this.currentBid);
        }
      }
    }
  }

  async gameOver(squads, liveAuctions, room) {
    try {
      const conn = await dbConnect();
      if (!conn) return; // DB not available; skip persistence

      // Lazy load model so missing mongoose doesn't crash the server
      const dbUser = require("../models/User");

      for (const user of this.users) {
        const dbUserDoc = await dbUser.findOne({ username: user.user });
        if (dbUserDoc) {
          if (!dbUserDoc.auctions) {
            dbUserDoc.auctions = [];
          }
          dbUserDoc.auctions.push({
            room: room,
            players: user.getPlayers(),
            team: user.getTeam(),
            budget: user.getBudget(),
            date: new Date(),
          });
          await dbUserDoc.save();
        }
      }
    } catch (error) {
      console.warn("Failed to save auction results:", error.message);
    }
  }

  addUser(user) {
    if (!this.dupUser(user)) {
      const newUser = new User(user);
      this.users.push(newUser);
      return newUser;
    }
  }

  removeUser(user) {
    this.users = this.users.filter((u) => u.user !== user);
  }

  dupUser(user) {
    return this.users.find((u) => u.user === user);
  }

  async next(squads, liveAuctions, room) {
    this.player++;
    if (this.player >= squads[this.squad].players.length) {
      this.squad++;
      this.player = this.retainedCount;
    }
    if (this.squad >= squads.length) {
      await this.gameOver(squads, liveAuctions, room);
      return false;
    }
    return true;
  }

  getRTMEligibleUser(player) {
    const previousTeam = player.stats?.previousTeam?.toLowerCase();
    if (!previousTeam) return null;
    
    return this.users.find(user => {
      const userTeam = user.getTeam().toLowerCase();
      return userTeam === previousTeam && user.rtm > 0;
    })?.user;
  }

  startRTMWindow(eligibleUser) {
    this.rtmActive = true;
    this.rtmEligibleUser = eligibleUser;
    this.rtmWindow = 10;
    
    this.rtmInterval = setInterval(() => {
      this.rtmWindow--;
      if (this.rtmWindow <= 0) {
        this.finalizeRTM(false);
      }
    }, 1000);
  }

  handleRTMAccept(username) {
    if (this.rtmActive && this.rtmEligibleUser === username) {
      this.finalizeRTM(true);
      return true;
    }
    return false;
  }

  finalizeRTM(accepted) {
    if (this.rtmInterval) {
      clearInterval(this.rtmInterval);
      this.rtmInterval = null;
    }
    
    this.rtmActive = false;
    
    if (accepted) {
      const user = this.findUser(this.rtmEligibleUser);
      if (user) {
        user.rtm--;
        user.addPlayer(this.currentPlayer);
        user.deduct(this.currentBid);
      }
    } else {
      this.addPlayer(this.currentPlayer, this.currentBid);
    }
    
    this.rtmEligibleUser = "";
    this.rtmWindow = 0;
  }

  addPlayer(player, amount) {
    if (this.currentBidder) {
      const user = this.findUser(this.currentBidder);
      if (user) {
        const canAdd = user.canAddPlayer(player);
        if (canAdd.canAdd) {
          user.addPlayer(player);
          this.commentary.push({
            player: player.name,
            team: user.getTeam(),
            amount: amount,
            bidder: this.currentBidder,
            timestamp: new Date(),
          });
        } else {
          console.warn(`Cannot add player ${player.name}: ${canAdd.reason}`);
        }
      }
    } else {
      console.log(`${player.name} went unsold`);
      this.commentary.push({
        player: player.name,
        team: "UNSOLD",
        amount: 0,
        bidder: "",
        timestamp: new Date(),
      });
    }
  }

  fetchPlayers() {
    return this.users.map(user => ({
      user: user.user,
      team: user.getTeam(),
      players: user.getPlayers(),
      budget: user.getBudget(),
    }));
  }

  setRTMEnabled(val) {
    this.rtmEnabled = val;
  }

  setRTMPerTeam(val) {
    this.rtmPerTeam = val;
    this.users.forEach(user => {
      user.rtm = val;
    });
  }

  getSettings() {
    return {
      rtmEnabled: this.rtmEnabled,
      rtmPerTeam: this.rtmPerTeam,
    };
  }

  setContext(liveAuctions, roomId) {
    this.liveAuctions = liveAuctions;
    this.roomId = roomId;
  }

  setSquads(squads) {
    this.squads = squads;
  }

  async advanceAfterTimeout() {
    const hasNext = await this.next(this.squads, this.liveAuctions, this.roomId);
    if (hasNext) {
      this.servePlayer(this.squads);
      this.resetBid();
      this.resetTimer();
      this.startInterval();
    } else {
      this.liveAuctions.delete(this.roomId);
    }
  }
}

module.exports = Auction;
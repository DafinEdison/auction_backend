class User {
  constructor(user) {
    this.user = user;
    this.budget = 100;
    this.team = "";
    this.batsmen = [];
    this.bowlers = [];
    this.allRounders = [];
    this.wicketKeepers = [];
    this.players = [];
    this.unknown = [];
    this.overseas = [];
    // Right-to-Match tokens remaining (display-only for now)
    this.rtm = 3;
    this.constraints = {
      maxSquadSize: 25,
      maxBatsmen: 9,
      maxBowlers: 10,
      maxAllRounders: 8,
      maxWicketKeepers: 4,
      maxOverseas: 8,
    };
  }

  deduct(amount) {
    if (amount > this.budget) {
      throw new Error("Your budget does not allow you to bid");
    }
    this.budget -= amount;
  }

  getBudget() {
    return this.budget;
  }

  setTeam(team) {
    this.team = team;
  }

  getTeam() {
    return this.team;
  }

  addPlayer(player) {
    if (player.stats && player.stats.role) {
      const role = player.stats.role.toLowerCase();
      if (role.includes("wicket")) {
        this.wicketKeepers.push(player);
      } else if (role.includes("all")) {
        this.allRounders.push(player);
      } else if (role.includes("bat")) {
        this.batsmen.push(player);
      } else if (role.includes("bowl")) {
        this.bowlers.push(player);
      }
    } else {
      this.unknown.push(player);
    }

    // Track overseas players separately for constraint and UI counters
    if (this.isOverseas(player)) {
      this.overseas.push(player);
    }

    this.players.push(player);
  }

  canAddPlayer(player) {
    if (this.players.length >= this.constraints.maxSquadSize) {
      return { ok: false, reason: "Max squad size reached" };
    }
    if (this.isOverseas(player) && this.overseas.length >= this.constraints.maxOverseas) {
      return { ok: false, reason: "Max overseas players reached" };
    }
    if (player.stats && player.stats.role) {
      const role = player.stats.role.toLowerCase();
      if (role.includes("wicket")) {
        if (this.wicketKeepers.length >= this.constraints.maxWicketKeepers) {
          return { ok: false, reason: "Max wicketkeepers reached" };
        }
      } else if (role.includes("all")) {
        if (this.allRounders.length >= this.constraints.maxAllRounders) {
          return { ok: false, reason: "Max all-rounders reached" };
        }
      } else if (role.includes("bat")) {
        if (this.batsmen.length >= this.constraints.maxBatsmen) {
          return { ok: false, reason: "Max batsmen reached" };
        }
      } else if (role.includes("bowl")) {
        if (this.bowlers.length >= this.constraints.maxBowlers) {
          return { ok: false, reason: "Max bowlers reached" };
        }
      }
    }
    return { ok: true };
  }

  // Best-effort detection of overseas players.
  // Tries multiple common fields and falls back to domestic when unknown.
  isOverseas(player) {
    try {
      // Explicit flags if present
      if (player.isOverseas === true) return true;
      if (player.stats && player.stats.isOverseas === true) return true;
      // Country/nationality fields if present
      const country = (player.country || player.nationality || player?.stats?.country || "").toLowerCase();
      if (country) {
        return country !== "india" && country !== "indian";
      }
      // If unknown, treat as domestic to avoid false positives
      return false;
    } catch (e) {
      return false;
    }
  }

  getPlayers() {
    return this.players;
  }

  getTotalPlayers() {
    return this.players.length;
  }

  getBatsmen() {
    return this.batsmen;
  }

  getTotalBatsmen() {
    return this.players.length;
  }

  getBowlers() {
    return this.bowlers;
  }

  getTotalBowlers() {
    return this.bowlers.length;
  }

  getAllRounders() {
    return this.allRounders;
  }

  getTotalAllRounders() {
    return this.allRounders.length;
  }

  getWicketKeepers() {
    return this.wicketKeepers;
  }

  getTotalWicketKeepers() {
    return this.wicketKeepers.length;
  }

  getOverseas() {
    return this.overseas;
  }

  getTotalOverseas() {
    return this.overseas.length;
  }
}

module.exports = User;
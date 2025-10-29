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
    this.players.push(player);
    const role = player.stats?.role?.toLowerCase();
    if (role) {
      if (role.includes("batsman") || role.includes("batter")) {
        this.batsmen.push(player);
      } else if (role.includes("bowler")) {
        this.bowlers.push(player);
      } else if (role.includes("all-rounder") || role.includes("allrounder")) {
        this.allRounders.push(player);
      } else if (role.includes("wicket-keeper") || role.includes("keeper")) {
        this.wicketKeepers.push(player);
      } else {
        this.unknown.push(player);
      }
    } else {
      this.unknown.push(player);
    }

    if (this.isOverseas(player)) {
      this.overseas.push(player);
    }
  }

  canAddPlayer(player) {
    if (this.getTotalPlayers() >= this.constraints.maxSquadSize) {
      return { canAdd: false, reason: "Squad size limit reached" };
    }
    
    const role = player.stats?.role?.toLowerCase();
    if (role) {
      if (role.includes("batsman") || role.includes("batter")) {
        if (this.getTotalBatsmen() >= this.constraints.maxBatsmen) {
          return { canAdd: false, reason: "Batsmen limit reached" };
        }
      } else if (role.includes("bowler")) {
        if (this.getTotalBowlers() >= this.constraints.maxBowlers) {
          return { canAdd: false, reason: "Bowlers limit reached" };
        }
      } else if (role.includes("all-rounder") || role.includes("allrounder")) {
        if (this.getTotalAllRounders() >= this.constraints.maxAllRounders) {
          return { canAdd: false, reason: "All-rounders limit reached" };
        }
      } else if (role.includes("wicket-keeper") || role.includes("keeper")) {
        if (this.getTotalWicketKeepers() >= this.constraints.maxWicketKeepers) {
          return { canAdd: false, reason: "Wicket-keepers limit reached" };
        }
      }
    }

    if (this.isOverseas(player) && this.getTotalOverseas() >= this.constraints.maxOverseas) {
      return { canAdd: false, reason: "Overseas players limit reached" };
    }

    return { canAdd: true };
  }

  isOverseas(player) {
    const indianStates = ["india", "indian"];
    const nationality = player.stats?.nationality?.toLowerCase() || "";
    const country = player.stats?.country?.toLowerCase() || "";
    
    return !indianStates.some(state => 
      nationality.includes(state) || country.includes(state)
    );
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
    return this.batsmen.length;
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
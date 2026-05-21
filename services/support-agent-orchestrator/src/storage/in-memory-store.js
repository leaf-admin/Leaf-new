class InMemoryStore {
  constructor({ maxRuns = 250 } = {}) {
    this.maxRuns = maxRuns;
    this.runs = [];
    this.byTicketId = new Map();
  }

  saveRun(run) {
    const nextRun = {
      ...run,
      id: run.id || `run_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: run.createdAt || new Date().toISOString(),
    };

    this.runs.unshift(nextRun);
    if (nextRun.ticketId) {
      this.byTicketId.set(nextRun.ticketId, nextRun);
    }
    if (this.runs.length > this.maxRuns) {
      this.runs = this.runs.slice(0, this.maxRuns);
    }
    return nextRun;
  }

  listRuns(limit = 50) {
    return this.runs.slice(0, limit);
  }

  getLatestForTicket(ticketId) {
    return this.byTicketId.get(ticketId) || null;
  }
}

module.exports = InMemoryStore;

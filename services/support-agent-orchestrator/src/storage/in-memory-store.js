class InMemoryStore {
  constructor({ maxRuns = 250 } = {}) {
    this.maxRuns = maxRuns;
    this.runs = [];
    this.byRunId = new Map();
    this.byTicketId = new Map();
    this.actions = [];
    this.actionsById = new Map();
    this.actionsByIdempotencyKey = new Map();
  }

  saveRun(run) {
    const nextRun = {
      ...run,
      id: run.id || `run_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: run.createdAt || new Date().toISOString(),
    };

    this.runs.unshift(nextRun);
    this.byRunId.set(nextRun.id, nextRun);
    if (nextRun.ticketId) {
      this.byTicketId.set(nextRun.ticketId, nextRun);
    }
    if (this.runs.length > this.maxRuns) {
      const removed = this.runs.slice(this.maxRuns);
      removed.forEach((run) => this.byRunId.delete(run.id));
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

  getRun(runId) {
    return this.byRunId.get(runId) || null;
  }

  saveAction(action) {
    const nextAction = {
      ...action,
      id: action.id || `action_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: action.createdAt || new Date().toISOString(),
      updatedAt: action.updatedAt || new Date().toISOString(),
    };

    this.actions.unshift(nextAction);
    this.actionsById.set(nextAction.id, nextAction);
    if (nextAction.idempotencyKey) {
      this.actionsByIdempotencyKey.set(nextAction.idempotencyKey, nextAction);
    }
    this.attachActionToRun(nextAction.runId, nextAction);
    return nextAction;
  }

  updateAction(actionId, patch = {}) {
    const existing = this.actionsById.get(actionId);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.actionsById.set(actionId, updated);
    if (updated.idempotencyKey) {
      this.actionsByIdempotencyKey.set(updated.idempotencyKey, updated);
    }
    this.actions = this.actions.map((action) => (action.id === actionId ? updated : action));
    this.attachActionToRun(updated.runId, updated);
    return updated;
  }

  getActionByIdempotencyKey(idempotencyKey) {
    if (!idempotencyKey) return null;
    return this.actionsByIdempotencyKey.get(idempotencyKey) || null;
  }

  listActions({ runId, ticketId, limit = 50 } = {}) {
    return this.actions
      .filter((action) => (!runId || action.runId === runId) && (!ticketId || action.ticketId === ticketId))
      .slice(0, limit);
  }

  attachActionToRun(runId, action) {
    const run = this.getRun(runId);
    if (!run) return null;
    const actions = Array.isArray(run.actions) ? run.actions.filter((item) => item.id !== action.id) : [];
    actions.unshift(action);
    const updatedRun = { ...run, actions };
    this.byRunId.set(runId, updatedRun);
    if (updatedRun.ticketId) {
      this.byTicketId.set(updatedRun.ticketId, updatedRun);
    }
    this.runs = this.runs.map((item) => (item.id === runId ? updatedRun : item));
    return updatedRun;
  }
}

module.exports = InMemoryStore;

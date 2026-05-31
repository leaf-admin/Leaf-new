const fs = require("node:fs");
const path = require("node:path");

const InMemoryStore = require("./in-memory-store");

class JsonFileStore extends InMemoryStore {
  constructor({ filePath, maxRuns = 250, maxAuditEvents } = {}) {
    super({ maxRuns, maxAuditEvents });
    this.filePath = filePath;
    this.loaded = false;
    this.load();
  }

  load() {
    if (this.loaded || !this.filePath || !fs.existsSync(this.filePath)) {
      this.loaded = true;
      return this;
    }

    const payload = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    (payload.runs || []).reverse().forEach((run) => this.saveRun(run));
    (payload.actions || []).reverse().forEach((action) => this.saveAction(action));
    (payload.auditEvents || []).reverse().forEach((event) => this.saveAuditEvent(event));
    this.loaded = true;
    return this;
  }

  persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: "support-orchestrator-store.v1",
      updatedAt: new Date().toISOString(),
      runs: this.runs,
      actions: this.actions,
      auditEvents: this.auditEvents,
    };
    fs.writeFileSync(this.filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  saveRun(run) {
    const nextRun = super.saveRun(run);
    if (this.loaded) this.persist();
    return nextRun;
  }

  saveAction(action) {
    const nextAction = super.saveAction(action);
    if (this.loaded) this.persist();
    return nextAction;
  }

  updateAction(actionId, patch = {}) {
    const updated = super.updateAction(actionId, patch);
    if (updated && this.loaded) this.persist();
    return updated;
  }

  saveAuditEvent(event) {
    const nextEvent = super.saveAuditEvent(event);
    if (this.loaded) this.persist();
    return nextEvent;
  }
}

module.exports = JsonFileStore;

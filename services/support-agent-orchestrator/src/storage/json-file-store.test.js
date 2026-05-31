const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const JsonFileStore = require("./json-file-store");

test("persists runs, actions and audit events across restarts", () => {
  const filePath = path.join(os.tmpdir(), `leaf-support-store-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);

  try {
    const store = new JsonFileStore({ filePath });
    store.saveRun({ id: "run_persist_1", ticketId: "SUP-1", audit: { mode: "guarded_copilot" } });
    store.saveAction({
      id: "action_persist_1",
      runId: "run_persist_1",
      ticketId: "SUP-1",
      type: "internal_note",
      status: "succeeded",
      idempotencyKey: "SUP-1:internal-note:v1",
    });
    store.saveAuditEvent({
      id: "audit_persist_1",
      type: "run_created",
      runId: "run_persist_1",
      ticketId: "SUP-1",
      mode: "guarded_copilot",
    });

    const reloaded = new JsonFileStore({ filePath });

    assert.equal(reloaded.getRun("run_persist_1").ticketId, "SUP-1");
    assert.equal(reloaded.listActions({ ticketId: "SUP-1" })[0].id, "action_persist_1");
    assert.equal(reloaded.listAuditEvents({ ticketId: "SUP-1" })[0].id, "audit_persist_1");
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

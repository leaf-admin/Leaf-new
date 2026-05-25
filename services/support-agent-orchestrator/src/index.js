const { start } = require("./server");

start().catch((error) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    service: "support-agent-orchestrator",
    level: "error",
    message: "Fatal startup error",
    error: error.message,
  }));
  process.exit(1);
});

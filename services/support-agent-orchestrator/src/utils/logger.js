function serializeMeta(meta = {}) {
  try {
    return JSON.stringify(meta);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function log(level, message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    service: "support-agent-orchestrator",
    level,
    message,
    ...meta,
  };
  const line = serializeMeta(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (message, meta) => log("info", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  error: (message, meta) => log("error", message, meta),
};

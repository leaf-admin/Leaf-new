const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..");

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveFromService(relativePath) {
  if (!relativePath) return "";
  return path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(rootDir, relativePath);
}

const config = {
  env: process.env.NODE_ENV || "development",
  port: asNumber(process.env.PORT, 3015),
  serviceName: "leaf-support-agent-orchestrator",
  leaf: {
    apiBaseUrl: (process.env.LEAF_API_BASE_URL || "http://localhost:3001/api").replace(/\/$/, ""),
    apiToken: process.env.LEAF_API_TOKEN || "",
    apiTimeoutMs: asNumber(process.env.LEAF_API_TIMEOUT_MS, 12000),
    wsUrl: (process.env.LEAF_WS_URL || "http://localhost:3001").replace(/\/$/, ""),
  },
  security: {
    dashboardToken: process.env.SUPPORT_ORCHESTRATOR_TOKEN || "",
    allowMissingDashboardToken:
      (process.env.SUPPORT_ORCHESTRATOR_ALLOW_MISSING_TOKEN || "").trim().toLowerCase() === "true" ||
      (process.env.NODE_ENV || "development") === "test",
    corsOrigins: csv(process.env.CORS_ORIGIN, ["http://localhost:3000", "http://localhost:3002", "http://localhost:3003"]),
  },
  playbook: {
    path: resolveFromService(process.env.SUPPORT_PLAYBOOK_PATH || "../../docs/support/LEAF_SUPPORT_PLAYBOOK.md"),
  },
  automation: {
    autonomousMode: asBool(process.env.SUPPORT_AUTONOMOUS_MODE, false),
    minConfidence: asNumber(process.env.SUPPORT_MIN_CONFIDENCE, 0.72),
  },
  polling: {
    enabled: asBool(process.env.ENABLE_SUPPORT_POLLING, true),
    intervalMs: asNumber(process.env.SUPPORT_POLL_INTERVAL_MS, 30000),
  },
  redis: {
    enabled: asBool(process.env.ENABLE_REDIS_SUBSCRIBER, false),
    url: process.env.REDIS_URL || "redis://localhost:6379",
    channel: process.env.SUPPORT_CHAT_REDIS_CHANNEL || "support:chat:messages",
  },
  socket: {
    enabled: asBool(process.env.ENABLE_SOCKET_LISTENER, false),
  },
};

module.exports = config;

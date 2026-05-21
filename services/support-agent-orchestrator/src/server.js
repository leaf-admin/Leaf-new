const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const config = require("./config");
const logger = require("./utils/logger");
const InMemoryStore = require("./storage/in-memory-store");
const LeafApiClient = require("./clients/leaf-api-client");
const RedisSubscriber = require("./clients/redis-subscriber");
const SocketListener = require("./clients/socket-listener");
const PlaybookStore = require("./knowledge/playbook-store");
const SupportClassifier = require("./agents/classifier");
const N1Agent = require("./agents/n1-agent");
const N2Router = require("./agents/n2-router");
const N3Diagnostics = require("./agents/n3-diagnostics");
const SupportOrchestrator = require("./orchestrator/support-orchestrator");
const createApiRouter = require("./routes/api");

function createApp() {
  const app = express();
  const store = new InMemoryStore();
  const playbookStore = new PlaybookStore({ filePath: config.playbook.path }).load();
  const leafApiClient = new LeafApiClient({
    baseUrl: config.leaf.apiBaseUrl,
    token: config.leaf.apiToken,
    timeoutMs: config.leaf.apiTimeoutMs,
  });
  const classifier = new SupportClassifier({
    playbookStore,
    minConfidence: config.automation.minConfidence,
    autonomousMode: config.automation.autonomousMode,
  });
  const orchestrator = new SupportOrchestrator({
    config,
    leafApiClient,
    playbookStore,
    classifier,
    n1Agent: new N1Agent(),
    n2Router: new N2Router(),
    n3Diagnostics: new N3Diagnostics(),
    store,
  });

  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.security.corsOrigins.includes(origin) || config.security.corsOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error("CORS origin blocked"));
      }
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: config.serviceName, ts: new Date().toISOString() });
  });
  app.use("/v1", createApiRouter({ config, orchestrator, store }));

  app.use((error, _req, res, _next) => {
    logger.warn("Request failed", { error: error.message, status: error.status });
    res.status(error.status || 500).json({
      success: false,
      error: error.message || "internal_error",
    });
  });

  app.locals.orchestrator = orchestrator;
  return app;
}

async function start() {
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info("Support agent orchestrator listening", { port: config.port });
  });

  const orchestrator = app.locals.orchestrator;
  orchestrator.startPolling();

  const redisSubscriber = config.redis.enabled
    ? new RedisSubscriber({ url: config.redis.url, channel: config.redis.channel })
    : null;
  if (redisSubscriber) {
    await redisSubscriber.start((payload) => orchestrator.handleRealtimeChat(payload));
  }

  const socketListener = config.socket.enabled
    ? new SocketListener({ url: config.leaf.wsUrl })
    : null;
  if (socketListener) {
    socketListener.start({ onSupportChat: (payload) => orchestrator.handleRealtimeChat(payload) });
  }

  async function shutdown() {
    logger.info("Shutting down support agent orchestrator");
    orchestrator.stopPolling();
    if (redisSubscriber) await redisSubscriber.stop();
    if (socketListener) socketListener.stop();
    server.close(() => process.exit(0));
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = { createApp, start };

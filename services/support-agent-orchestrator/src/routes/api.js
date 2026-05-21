const express = require("express");

function requireToken(config) {
  return (req, res, next) => {
    const expected = config.security.dashboardToken;
    if (!expected) {
      if (config.security.allowMissingDashboardToken) return next();
      return res.status(503).json({ success: false, error: "orchestrator_token_not_configured" });
    }
    const received = req.get("x-orchestrator-token") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (received === expected) return next();
    return res.status(401).json({ success: false, error: "orchestrator_unauthorized" });
  };
}

function createApiRouter({ config, orchestrator, store }) {
  const router = express.Router();
  const auth = requireToken(config);

  router.get("/status", auth, (_req, res) => {
    res.json({ success: true, status: orchestrator.status() });
  });

  router.get("/runs", auth, (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json({ success: true, runs: store.listRuns(limit) });
  });

  router.get("/tickets/:ticketId/analysis", auth, async (req, res, next) => {
    try {
      const run = await orchestrator.analyzeTicket(req.params.ticketId, { force: false });
      res.json({ success: true, analysis: run });
    } catch (error) {
      next(error);
    }
  });

  router.post("/tickets/:ticketId/analyze", auth, async (req, res, next) => {
    try {
      const run = await orchestrator.analyzeTicket(req.params.ticketId, { force: true });
      res.json({ success: true, analysis: run });
    } catch (error) {
      next(error);
    }
  });

  router.post("/chat/analyze", auth, async (req, res, next) => {
    try {
      const run = orchestrator.analyzeChat(req.body || {});
      res.json({ success: true, analysis: run });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createApiRouter;
module.exports.requireToken = requireToken;

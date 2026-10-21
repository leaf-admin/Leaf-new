// Rotas públicas que recebem alertas do Sentry e do UptimeRobot e repassam aos bots.
// Registradas antes de /api/ops (que exige login): a autenticação aqui é a assinatura do
// Sentry ou o token secreto do UptimeRobot. Ver docs/operations/BOT_EVENTS_RUNBOOK.md.
const express = require('express');
const relayService = require('../services/external-alert-relay-service');
const { logError, logStructured } = require('../utils/logger');

const router = express.Router();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;
// Alerta do Sentry com o evento inteiro fica bem abaixo disso; acima, recusa.
const MAX_BODY_BYTES = 256 * 1024;
const hits = new Map();

// 60 requisições por minuto por IP, em memória: os provedores mandam poucas.
function limit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (hits.size > 5000) {
      for (const [ip, value] of hits) if (value.resetAt <= now) hits.delete(ip);
    }
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW) return res.status(429).json({ success: false });
  return next();
}

function bodySize(req, res, next) {
  const declared = Number.parseInt(req.get('content-length') || '0', 10);
  const received = Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0;
  if (Math.max(Number.isFinite(declared) ? declared : 0, received) > MAX_BODY_BYTES) {
    return res.status(413).json({ success: false });
  }
  return next();
}

router.post('/sentry', limit, bodySize, async (req, res) => {
  const secret = process.env.SENTRY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ success: false, error: 'not_configured' });
  const valid = relayService.verifySentrySignature({
    rawBody: req.rawBody,
    signature: req.get('sentry-hook-signature'),
    secret,
  });
  if (!valid) return res.status(401).json({ success: false });
  try {
    const result = await relayService.relaySentry({ resource: req.get('sentry-hook-resource'), payload: req.body });
    return res.status(202).json({ success: true, relayed: result.relayed });
  } catch (error) {
    logError(error, { service: 'alert-relay', operation: 'sentry' });
    return res.status(500).json({ success: false });
  }
});

router.post('/uptimerobot', limit, bodySize, async (req, res) => {
  const token = process.env.UPTIMEROBOT_WEBHOOK_TOKEN;
  if (!token) return res.status(503).json({ success: false, error: 'not_configured' });
  const supplied = req.get('x-leaf-alert-token') || req.query?.token;
  if (!relayService.safeEqual(supplied, token)) return res.status(401).json({ success: false });
  try {
    const { token: _token, ...query } = req.query || {};
    const result = await relayService.relayUptime({ ...query, ...(req.body || {}) });
    if (!result.relayed) {
      logStructured('info', 'Alerta do UptimeRobot ignorado', { service: 'alert-relay', reason: result.reason });
    }
    return res.status(202).json({ success: true, relayed: result.relayed });
  } catch (error) {
    logError(error, { service: 'alert-relay', operation: 'uptimerobot' });
    return res.status(500).json({ success: false });
  }
});

module.exports = router;
module.exports._resetRateLimit = () => hits.clear();

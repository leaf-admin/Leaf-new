'use strict';

// Link de acompanhamento da viagem (services/trip-share-service.js).
// - POST /api/rides/:bookingId/share-link: o passageiro gera o link da própria corrida.
// - GET  /api/public/trip-share/:token: a página leaf.app.br/viagem lê a situação, sem login.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireFirebaseUser } = require('../middleware/firebase-user-auth');
const tripShareService = require('../services/trip-share-service');
const redisPool = require('../utils/redis-pool');
const { logError } = require('../utils/logger');

const router = express.Router();

// A página consulta a cada 15 s: 120 por 15 min por IP cobre uma viagem longa com folga.
const publicViewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.TRIP_SHARE_PUBLIC_RATE_LIMIT || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas consultas. Tente de novo em alguns minutos.' }
});

async function getRedis() {
  await redisPool.ensureConnection?.();
  return redisPool.getConnection();
}

router.post('/api/rides/:bookingId/share-link', requireFirebaseUser, async (req, res) => {
  try {
    const result = await tripShareService.createShareLink(await getRedis(), {
      bookingId: req.params.bookingId,
      customerId: req.authenticatedUser?.uid
    });
    if (!result.ok) {
      const status = result.code === 'BOOKING_ENDED' ? 409 : 404;
      return res.status(status).json({ success: false, code: result.code });
    }
    return res.json({ success: true, url: result.url, expiresInSeconds: tripShareService.SHARE_TTL_SECONDS });
  } catch (error) {
    logError(error, 'Falha ao gerar link de acompanhamento', { service: 'trip-share' });
    return res.status(500).json({ success: false, error: 'Erro ao gerar o link' });
  }
});

router.get('/api/public/trip-share/:token', publicViewLimiter, async (req, res) => {
  try {
    const view = await tripShareService.getPublicView(await getRedis(), req.params.token);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (!view) {
      return res.status(404).json({ success: false, code: 'SHARE_NOT_FOUND' });
    }
    return res.json({ success: true, trip: view });
  } catch (error) {
    logError(error, 'Falha ao ler link de acompanhamento', { service: 'trip-share' });
    return res.status(500).json({ success: false, error: 'Erro ao ler a viagem' });
  }
});

module.exports = router;

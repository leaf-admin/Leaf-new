'use strict';

// Passageiro confirma se fez uma corrida cujo repasse está em conferência
// (payout-hold-service). Só vê as próprias corridas e só responde uma vez.

const express = require('express');
const { requireFirebaseUser } = require('../middleware/firebase-user-auth');
const payoutHoldService = require('../services/payout-hold-service');
const redisPool = require('../utils/redis-pool');
const { logError } = require('../utils/logger');

const router = express.Router();

async function getRedis() {
  await redisPool.ensureConnection?.();
  return redisPool.getConnection();
}

router.get('/api/rides/confirmations/pending', requireFirebaseUser, async (req, res) => {
  try {
    const uid = String(req.authenticatedUser?.uid || '').trim();
    const holds = await payoutHoldService.listHolds(await getRedis());
    const pending = holds
      .filter((hold) => hold.customerId === uid && hold.status === payoutHoldService.HOLD_STATUS.AWAITING_PASSENGER)
      .map((hold) => payoutHoldService.toPublicView(hold, { audience: 'passenger' }));
    return res.json({ success: true, pending });
  } catch (error) {
    logError(error, 'Falha ao listar corridas para confirmar', { service: 'ride-confirmations' });
    return res.status(500).json({ success: false, error: 'Erro ao buscar corridas para confirmar' });
  }
});

router.post('/api/rides/:bookingId/confirmation', requireFirebaseUser, async (req, res) => {
  const tookRide = req.body?.tookRide;
  if (typeof tookRide !== 'boolean') {
    return res.status(400).json({ success: false, error: 'tookRide deve ser true ou false', code: 'TOOK_RIDE_REQUIRED' });
  }
  try {
    const result = await payoutHoldService.recordPassengerAnswer(await getRedis(), {
      bookingId: req.params.bookingId,
      customerId: String(req.authenticatedUser?.uid || '').trim(),
      tookRide
    });
    // Corrida de outro passageiro responde igual a corrida inexistente.
    if (!result.ok) {
      return res.status(404).json({ success: false, error: 'Corrida não encontrada', code: 'CONFIRMATION_NOT_FOUND' });
    }
    return res.json({ success: true, alreadyAnswered: result.alreadyAnswered === true });
  } catch (error) {
    logError(error, 'Falha ao registrar confirmação da corrida', { service: 'ride-confirmations' });
    return res.status(500).json({ success: false, error: 'Erro ao registrar a resposta' });
  }
});

module.exports = router;

'use strict';

const { createHash } = require('crypto');
const express = require('express');
const firebaseConfig = require('../firebase-config');
const { authenticateSupport, requireSupportRoles, isSupportAgent } = require('../middleware/support-auth');
const {
  normalizeRideStatus,
  resolveRideStatusLabel,
  resolveRideRevenue
} = require('../services/dashboard-ride-monitoring-service');
const { logStructured, logError } = require('../utils/logger');

const router = express.Router();

const SAVED_REPLY_MANAGER_ROLES = ['admin', 'manager', 'super-admin', 'development', 'support_n3'];
const SHORTCUT_PATTERN = /^[a-z0-9-]{2,24}$/;
const RIDE_ID_PATTERN = /^[\w-]{1,128}$/;
const MAX_TEXT_LENGTH = 1000;
const NOTE_LIST_LIMIT = 100;
const SAVED_REPLY_LIST_LIMIT = 200;

const firestore = () => firebaseConfig.getFirestore();
// Notas ficam fora da coleção de mensagens: nenhum caminho de envio ao cliente lê daqui.
const noteCollection = (userId) => firestore()
  .collection('support_internal_notes')
  .doc(createHash('sha256').update(String(userId)).digest('hex'))
  .collection('notes');
const actorLabel = (user = {}) => user.name || user.email || user.uid || user.id || 'agente';
const cleanText = (value) => String(value || '').trim();

function firstString(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function requireAgent(req, res, next) {
  if (!isSupportAgent(req.user)) return res.status(403).json({ success: false, error: 'Acesso negado' });
  return next();
}

function requireOperationalScope(req, res, next) {
  const scopes = [req.query.scope, req.headers['x-leaf-support-scope']].filter(Boolean);
  if (scopes.every((scope) => scope === 'operational')) return next();
  return res.status(404).json({ success: false, error: 'Indisponível neste escopo' });
}

function serializeRide(id, ride) {
  const pickup = ride.pickup || ride.pickupLocation || {};
  const destination = ride.drop || ride.destinationLocation || ride.destination || {};
  const status = normalizeRideStatus(ride.status, ride.state, ride.bookingStatus, ride.tripStatus);
  return {
    id,
    status,
    statusLabel: resolveRideStatusLabel(status),
    // Corrida concluída sem fechamento financeiro vem zerada: mostra "sem valor", nunca R$ 0.
    grossAmount: resolveRideRevenue(ride) || null,
    pickupAddress: firstString(ride.pickupAddress, pickup.add, pickup.address),
    destinationAddress: firstString(ride.destinationAddress, destination.add, destination.address),
    paymentStatus: firstString(ride.paymentStatus, ride.payment_status),
    passengerId: firstString(ride.customerId, ride.passengerId, ride.customer),
    passengerName: firstString(ride.customerName, ride.passengerName),
    driverId: firstString(ride.driverId, ride.driver_id, ride.driver, ride.acceptedDriverId),
    driverName: firstString(ride.driverName, ride.driver_name)
  };
}

router.use('/tools', authenticateSupport, requireAgent);

router.get('/tools/saved-replies', async (_req, res) => {
  try {
    const snapshot = await firestore().collection('support_saved_replies').limit(SAVED_REPLY_LIST_LIMIT).get();
    const replies = snapshot.docs
      .map((doc) => doc.data())
      .sort((left, right) => left.shortcut.localeCompare(right.shortcut));
    return res.json({ success: true, replies });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'listSavedReplies' });
    return res.status(500).json({ success: false, error: 'Erro ao listar respostas prontas' });
  }
});

router.post('/tools/saved-replies', requireSupportRoles(SAVED_REPLY_MANAGER_ROLES), async (req, res) => {
  try {
    const shortcut = cleanText(req.body?.shortcut).replace(/^\//, '').toLowerCase();
    const message = cleanText(req.body?.message);
    if (!SHORTCUT_PATTERN.test(shortcut)) {
      return res.status(400).json({ success: false, error: 'Atalho inválido: use de 2 a 24 letras, números ou hífen' });
    }
    if (!message || message.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ success: false, error: `Resposta deve ter de 1 a ${MAX_TEXT_LENGTH} caracteres` });
    }
    const reply = { shortcut, message, updatedBy: actorLabel(req.user), updatedAt: new Date().toISOString() };
    await firestore().collection('support_saved_replies').doc(shortcut).set(reply);
    logStructured('info', 'Resposta pronta salva', { service: 'support-tools', shortcut, actor: reply.updatedBy });
    return res.json({ success: true, reply });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'saveSavedReply' });
    return res.status(500).json({ success: false, error: 'Erro ao salvar resposta pronta' });
  }
});

router.delete('/tools/saved-replies/:shortcut', requireSupportRoles(SAVED_REPLY_MANAGER_ROLES), async (req, res) => {
  try {
    const shortcut = cleanText(req.params.shortcut).toLowerCase();
    if (!SHORTCUT_PATTERN.test(shortcut)) {
      return res.status(400).json({ success: false, error: 'Atalho inválido' });
    }
    await firestore().collection('support_saved_replies').doc(shortcut).delete();
    logStructured('info', 'Resposta pronta removida', { service: 'support-tools', shortcut, actor: actorLabel(req.user) });
    return res.json({ success: true });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'deleteSavedReply' });
    return res.status(500).json({ success: false, error: 'Erro ao remover resposta pronta' });
  }
});

router.get('/tools/chat-notes/:userId', requireOperationalScope, async (req, res) => {
  try {
    const snapshot = await noteCollection(req.params.userId)
      .orderBy('createdAt', 'desc')
      .limit(NOTE_LIST_LIMIT)
      .get();
    return res.json({ success: true, notes: snapshot.docs.map((doc) => doc.data()).reverse() });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'listChatNotes' });
    return res.status(500).json({ success: false, error: 'Erro ao listar notas' });
  }
});

router.post('/tools/chat-notes/:userId', requireOperationalScope, async (req, res) => {
  try {
    const message = cleanText(req.body?.message);
    if (!message || message.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ success: false, error: `Nota deve ter de 1 a ${MAX_TEXT_LENGTH} caracteres` });
    }
    const ref = noteCollection(req.params.userId).doc();
    const note = {
      id: ref.id,
      message,
      senderType: 'agent',
      isInternal: true,
      authorName: actorLabel(req.user),
      createdAt: new Date().toISOString()
    };
    await ref.set(note);
    logStructured('info', 'Nota interna registrada', { service: 'support-tools', noteId: ref.id, actor: note.authorName });
    return res.status(201).json({ success: true, note });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'addChatNote' });
    return res.status(500).json({ success: false, error: 'Erro ao salvar nota' });
  }
});

router.get('/tools/rides/:rideId', requireOperationalScope, async (req, res) => {
  try {
    const { rideId } = req.params;
    if (!RIDE_ID_PATTERN.test(rideId)) {
      return res.status(400).json({ success: false, error: 'Corrida inválida' });
    }
    const rides = await firestore().collection('rides').doc(rideId).get();
    const snapshot = rides.exists ? rides : await firestore().collection('bookings').doc(rideId).get();
    if (!snapshot.exists) return res.status(404).json({ success: false, error: 'Corrida não encontrada' });
    return res.json({ success: true, ride: serializeRide(rideId, snapshot.data() || {}) });
  } catch (error) {
    logError(error, { service: 'support-tools', operation: 'getRide' });
    return res.status(500).json({ success: false, error: 'Erro ao buscar corrida' });
  }
});

module.exports = router;

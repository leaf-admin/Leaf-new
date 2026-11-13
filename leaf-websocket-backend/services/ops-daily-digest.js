'use strict';

// Resumo diário das filas do painel para a rotina Operação (agentes.chat).
// Roda no ciclo do worker de ride health (líder único). Uma vez por dia, a
// partir de OPS_DAILY_DIGEST_HOUR_BRT (padrão 9h de Brasília), com trava no
// Redis para não duplicar. Custo: um recálculo do resumo de pendências por dia.

const { logStructured, logError } = require('../utils/logger');

const DIGEST_LOCK_PREFIX = 'ops:daily_digest:';
let lastSentDateBrt = null;

function brtParts(now = new Date()) {
  const shifted = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours()
  };
}

function buildDigestData(summary = {}) {
  const drivers = summary.drivers || {};
  const byReason = drivers.byReason || {};
  const base = String(process.env.LEAF_DASHBOARD_BASE_URL || 'https://dashboard.leaf.app.br').trim().replace(/\/+$/, '');
  return {
    reviewCount: Number(drivers.review || 0),
    readyToApprove: Number(byReason.ready_to_approve || 0),
    backgroundCertificates: Number(byReason.background_certificate || 0),
    documentsToReview: Number(byReason.documents || 0),
    manualReview: Number(byReason.manual_review || 0),
    waitingOver24h: Number(drivers.waitingOver24h || 0),
    oldestWaitingHours: drivers.oldestWaitingMs ? Math.floor(drivers.oldestWaitingMs / 3600000) : 0,
    cpfReviews: Number(summary.cpfReviews || 0),
    supportOpen: Number(summary.supportOpen || 0),
    withdrawalsPending: Number(summary.withdrawalsPending || 0),
    dashboardUrl: `${base}/drivers?tab=review`
  };
}

async function maybeRunOpsDailyDigest(redis, {
  env = process.env,
  now = new Date(),
  loadSummary = null,
  emitEvent = null
} = {}) {
  if (String(env.OPS_DAILY_DIGEST_ENABLED || 'true') === 'false') return null;
  const hour = Math.min(23, Math.max(0, Number.parseInt(env.OPS_DAILY_DIGEST_HOUR_BRT || '9', 10) || 9));
  const { date, hour: currentHour } = brtParts(now);
  if (currentHour < hour || lastSentDateBrt === date) return null;

  const lockKey = `${DIGEST_LOCK_PREFIX}${date}`;
  const acquired = await redis.set(lockKey, now.toISOString(), 'EX', 2 * 24 * 60 * 60, 'NX');
  lastSentDateBrt = date;
  if (!acquired) return null;

  try {
    const summary = loadSummary
      ? await loadSummary()
      : await require('./ops-pending-service').getPendingSummary({
        firestore: require('../firebase-config').getFirestore(),
        force: true
      });
    const data = buildDigestData(summary);
    const emit = emitEvent || ((type, payload, options) => require('./bot-event-service').emit(type, payload, options));
    await emit('ops.daily_digest', data, {
      dedupeKey: date,
      severity: data.waitingOver24h > 0 ? 'N2' : 'N3',
      money: false
    });
    logStructured('info', 'Resumo diário das filas enviado', { service: 'ops-daily-digest', date, ...data });
    return data;
  } catch (error) {
    // Libera a trava para tentar de novo no próximo ciclo.
    await redis.del(lockKey).catch(() => null);
    lastSentDateBrt = null;
    logError(error, 'Falha no resumo diário das filas', { service: 'ops-daily-digest', date });
    return null;
  }
}

function resetOpsDailyDigestState() {
  lastSentDateBrt = null;
}

module.exports = {
  buildDigestData,
  maybeRunOpsDailyDigest,
  resetOpsDailyDigestState
};

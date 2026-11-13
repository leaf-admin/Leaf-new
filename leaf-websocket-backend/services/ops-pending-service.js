'use strict';

// Pendências do painel (motoristas para revisar, certidões, CPF, suporte).
//
// Custo: o resumo fica em cache no Redis (compartilhado por todos os admins e
// pelos dois gateways) por OPS_PENDING_CACHE_TTL_SECONDS. Cada recálculo lê só
// os cadastros que estão na fila de revisão (select de 4 campos) e faz três
// contagens agregadas (1 leitura cada por até 1000 entradas). Nenhum painel
// lê a coleção inteira para montar o contador.
//
// Tempo real: quando um cadastro muda de fila, o cache é invalidado e os
// painéis recebem "ops:pending_changed" pelo namespace /dashboard, na sala
// leve "dashboard:ops", que não liga os loops de métricas do dashboard.

const { logStructured, logError } = require('../utils/logger');

const OPS_ROOM = 'dashboard:ops';
const CACHE_KEY = 'ops:pending_summary:v1';
const CACHE_TTL_SECONDS = Math.max(
  10,
  Number.parseInt(process.env.OPS_PENDING_CACHE_TTL_SECONDS || '60', 10) || 60
);
const REVIEW_LIST_LIMIT = 300;
const NOTIFY_DEBOUNCE_MS = 1500;
const SUPPORT_OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'escalated'];
// Saques esperando a conferência e o clique de processar no painel.
const WITHDRAWAL_PENDING_STATUSES = ['pending', 'ledger_pending'];
const REVIEW_REASONS = ['manual_review', 'ready_to_approve', 'background_certificate', 'documents'];

let realtimeIo = null;
let redisClient = null;
let notifyTimer = null;
let pendingNotifyReasons = new Set();

function configureOpsPending({ io = null, redis = null } = {}) {
  if (io) realtimeIo = io;
  if (redis) redisClient = redis;
}

function resolveRedis() {
  if (redisClient) return redisClient;
  try {
    // eslint-disable-next-line global-require
    return require('../utils/redis-pool').getConnection();
  } catch (_) {
    return null;
  }
}

function toIso(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function countQuery(query) {
  try {
    const snapshot = await query.count().get();
    return Number(snapshot?.data?.().count || 0);
  } catch (error) {
    logError(error, 'Falha na contagem de pendências', { service: 'ops-pending' });
    return null;
  }
}

async function computePendingSummary(firestore, now = new Date()) {
  const reviewSnapshot = await firestore
    .collection('driver_applications')
    .where('reviewBucket', '==', 'review')
    .select('reviewReason', 'reviewWaitingSince', 'persistenceScope', 'driver')
    .limit(REVIEW_LIST_LIMIT)
    .get();

  const byReason = Object.fromEntries(REVIEW_REASONS.map((reason) => [reason, 0]));
  let total = 0;
  let oldestWaitingSince = null;
  let waitingOver24h = 0;
  const dayAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  reviewSnapshot.docs.forEach((doc) => {
    const data = doc.data() || {};
    const namespace = String(data?.persistenceScope?.namespace || 'operational').toLowerCase();
    if (namespace !== 'operational') return;
    total += 1;
    const reason = REVIEW_REASONS.includes(data.reviewReason) ? data.reviewReason : 'documents';
    byReason[reason] += 1;
    const since = toIso(data.reviewWaitingSince);
    if (since && (!oldestWaitingSince || since < oldestWaitingSince)) oldestWaitingSince = since;
    if (since && since <= dayAgoIso) waitingOver24h += 1;
  });

  const [cpfReviews, supportOpen, withdrawalsPending] = await Promise.all([
    countQuery(firestore.collection('cpf_review_restrictions')),
    countQuery(firestore.collection('support_tickets').where('status', 'in', SUPPORT_OPEN_STATUSES)),
    countQuery(firestore.collection('driver_withdrawals').where('status', 'in', WITHDRAWAL_PENDING_STATUSES))
  ]);

  const oldestWaitingMs = oldestWaitingSince ? Math.max(0, now.getTime() - Date.parse(oldestWaitingSince)) : null;

  return {
    generatedAt: now.toISOString(),
    drivers: {
      review: total,
      byReason,
      oldestWaitingSince,
      oldestWaitingMs,
      waitingOver24h,
      truncated: reviewSnapshot.size >= REVIEW_LIST_LIMIT
    },
    backgroundCertificates: byReason.background_certificate,
    cpfReviews,
    supportOpen,
    withdrawalsPending,
    total: total + (cpfReviews || 0) + (supportOpen || 0) + (withdrawalsPending || 0)
  };
}

async function getPendingSummary({ firestore, force = false } = {}) {
  const redis = resolveRedis();
  if (!force && redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) return { ...JSON.parse(cached), cached: true };
    } catch (_) {
      // Sem cache: segue para o cálculo.
    }
  }

  const summary = await computePendingSummary(firestore);
  if (redis) {
    try {
      await redis.set(CACHE_KEY, JSON.stringify(summary), 'EX', CACHE_TTL_SECONDS);
    } catch (_) {
      // Cache é otimização; falha não afeta a resposta.
    }
  }
  return { ...summary, cached: false };
}

async function invalidatePendingSummary() {
  const redis = resolveRedis();
  if (!redis) return;
  try {
    await redis.del(CACHE_KEY);
  } catch (_) {
    // Expira sozinho pelo TTL.
  }
}

function flushNotify() {
  notifyTimer = null;
  const reasons = Array.from(pendingNotifyReasons);
  pendingNotifyReasons = new Set();
  invalidatePendingSummary()
    .catch(() => {})
    .finally(() => {
      if (!realtimeIo) return;
      try {
        realtimeIo.of('/dashboard').to(OPS_ROOM).emit('ops:pending_changed', {
          reasons,
          at: new Date().toISOString()
        });
      } catch (error) {
        logError(error, 'Falha ao avisar painéis sobre pendências', { service: 'ops-pending' });
      }
    });
}

/**
 * Chamado quando algo entra ou sai de uma fila. Agrupa avisos em rajada e
 * não faz leitura nenhuma: o painel decide se busca o resumo (em cache).
 */
function notifyPendingChanged(reason = 'unknown') {
  pendingNotifyReasons.add(String(reason || 'unknown'));
  if (notifyTimer) return;
  notifyTimer = setTimeout(flushNotify, NOTIFY_DEBOUNCE_MS);
  if (typeof notifyTimer?.unref === 'function') notifyTimer.unref();
  logStructured('debug', 'Pendências do painel mudaram', { service: 'ops-pending', reason });
}

module.exports = {
  OPS_ROOM,
  CACHE_KEY,
  configureOpsPending,
  computePendingSummary,
  getPendingSummary,
  invalidatePendingSummary,
  notifyPendingChanged
};

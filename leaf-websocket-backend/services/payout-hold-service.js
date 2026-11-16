'use strict';

/**
 * Repasse em conferência.
 *
 * Algumas corridas concluídas têm sinais de que talvez não tenham acontecido como registrado
 * (por exemplo: o motorista fez o trajeto, mas o GPS do passageiro ficou no embarque). Nesses
 * casos o crédito do motorista não sai na hora: o billing-worker guarda o evento da corrida
 * aqui e pergunta ao passageiro se ele fez a corrida.
 *
 * - Passageiro responde "sim" ou não responde em 24 h: o crédito sai normalmente.
 * - Passageiro responde "não": a corrida vai para revisão no painel; nada é estornado
 *   automaticamente (estorno continua sendo decisão da operação, com as ferramentas de hoje).
 *
 * Nada aqui acusa ninguém: o motorista vê só "valor em conferência" e o motivo técnico fica
 * no painel. A retenção é sempre por corrida, nunca bloqueia a conta.
 *
 * Armazenamento: um hash no Redis (como as pendências de crédito de cancelamento), um item
 * por corrida. O billing-worker é o único que credita; rota e painel só mudam o status.
 */

const HOLDS_HASH_KEY = 'billing:payout_holds';
const HOUR_MS = 60 * 60 * 1000;
const RELEASED_RETENTION_MS = 7 * 24 * HOUR_MS;
const MAX_AUTOMATIC_RELEASE_ATTEMPTS = 30;

const HOLD_STATUS = Object.freeze({
  AWAITING_PASSENGER: 'awaiting_passenger',
  RELEASE_REQUESTED: 'release_requested',
  IN_REVIEW: 'in_review',
  RELEASED: 'released'
});

const HOLD_REASONS = Object.freeze({
  // GPS do passageiro longe do carro durante a corrida, sem confirmação de embarque.
  LOCATION_DIVERGENCE: 'LOCATION_DIVERGENCE',
  // Sinal de segurança na corrida: GPS simulado ou salto de posição impossível.
  LOCATION_SIGNAL: 'LOCATION_SIGNAL',
  // Incidente aberto para a corrida (botão de segurança, suporte).
  OPEN_INCIDENT: 'OPEN_INCIDENT',
  // Corrida encerrada longe do destino e cobrada pelo valor integral.
  ENDED_FAR_FROM_DESTINATION: 'ENDED_FAR_FROM_DESTINATION'
});

const LOCATION_SIGNAL_TYPES = new Set(['mock_location', 'location_jump']);

function isEnabled(env = process.env) {
  return String(env.PAYOUT_HOLD_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function autoReleaseMs(env = process.env) {
  const hours = Number.parseFloat(env.PAYOUT_HOLD_AUTO_RELEASE_HOURS || '24');
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * HOUR_MS;
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function isTruthy(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function addressOf(rawLocation) {
  const location = parseJson(rawLocation, null);
  if (!location || typeof location !== 'object') return null;
  const address = location.add || location.address || location.description || null;
  return address ? String(address).slice(0, 200) : null;
}

/**
 * Motivos para segurar o crédito desta corrida (lista vazia = crédito normal) e o resumo que
 * o passageiro vê na pergunta. Só lê o Redis; falha ao ler um sinal não segura a corrida.
 */
async function evaluateRideHold(redis, { bookingId, driverId } = {}) {
  const reasons = [];
  const summary = { pickupAddress: null, destinationAddress: null };
  const normalizedBookingId = String(bookingId || '').trim();
  if (!redis || !normalizedBookingId) return { reasons, summary };

  const integrity = (await redis.hgetall(`trip_integrity:${normalizedBookingId}`).catch(() => null)) || {};
  const divergenceUnresolved =
    Boolean(integrity.holdRecommendedAt) ||
    Boolean(integrity.passengerReportedIssueAt) ||
    (Boolean(integrity.alertOpenAt) && !integrity.boardingConfirmedAt);
  if (divergenceUnresolved) {
    reasons.push(HOLD_REASONS.LOCATION_DIVERGENCE);
  }

  const booking = (await redis.hgetall(`booking:${normalizedBookingId}`).catch(() => null)) || {};
  summary.pickupAddress = addressOf(booking.pickupLocation);
  summary.destinationAddress = addressOf(booking.destinationLocation);
  if (isTruthy(booking.opsReviewRequired)) {
    reasons.push(HOLD_REASONS.OPEN_INCIDENT);
  }
  const earlyEndSkipped = parseJson(booking.earlyEndSettlementSkipped, null);
  if (earlyEndSkipped && typeof earlyEndSkipped === 'object' && earlyEndSkipped.reason) {
    reasons.push(HOLD_REASONS.ENDED_FAR_FROM_DESTINATION);
  }

  const normalizedDriverId = String(driverId || booking.driverId || '').trim();
  if (normalizedDriverId) {
    let signalIds = [];
    try {
      signalIds = (await redis.zrevrange(`safety:driver:${normalizedDriverId}:signals`, 0, 19)) || [];
    } catch (error) {
      signalIds = [];
    }
    for (const signalId of signalIds) {
      const signal = (await redis.hgetall(`safety:signal:${signalId}`).catch(() => null)) || {};
      if (
        String(signal.bookingId || '') === normalizedBookingId &&
        LOCATION_SIGNAL_TYPES.has(String(signal.type || '')) &&
        signal.sandbox !== 'true'
      ) {
        reasons.push(HOLD_REASONS.LOCATION_SIGNAL);
        break;
      }
    }
  }

  return { reasons: [...new Set(reasons)], summary };
}

async function getHold(redis, bookingId) {
  const normalizedBookingId = String(bookingId || '').trim();
  if (!redis || !normalizedBookingId) return null;
  return parseJson(await redis.hget(HOLDS_HASH_KEY, normalizedBookingId), null);
}

async function saveHold(redis, hold) {
  await redis.hset(HOLDS_HASH_KEY, hold.bookingId, JSON.stringify(hold));
  return hold;
}

/**
 * Guarda a corrida em conferência. Idempotente: se o worker reprocessar o mesmo evento,
 * mantém o item existente (com o status e o prazo originais).
 */
async function recordHold(redis, { bookingId, driverId, customerId, reasons = [], summary = {}, event, now = Date.now(), env = process.env } = {}) {
  const normalizedBookingId = String(bookingId || '').trim();
  if (!redis || !normalizedBookingId || !event) return { created: false, hold: null };

  const existing = await getHold(redis, normalizedBookingId);
  if (existing && existing.status !== HOLD_STATUS.RELEASED) {
    return { created: false, hold: existing };
  }

  const hold = {
    bookingId: normalizedBookingId,
    driverId: String(driverId || '').trim() || null,
    customerId: String(customerId || '').trim() || null,
    reasons: [...new Set(reasons)],
    pickupAddress: summary.pickupAddress || null,
    destinationAddress: summary.destinationAddress || null,
    status: HOLD_STATUS.AWAITING_PASSENGER,
    createdAt: now,
    autoReleaseAt: now + autoReleaseMs(env),
    passengerAnswer: null,
    passengerAnsweredAt: null,
    reviewNote: null,
    reviewedBy: null,
    releaseAttempts: 0,
    event
  };
  await saveHold(redis, hold);
  return { created: true, hold };
}

/** Passageiro respondeu se fez a corrida. Só vale enquanto a corrida aguarda essa resposta. */
async function recordPassengerAnswer(redis, { bookingId, customerId, tookRide, now = Date.now() } = {}) {
  const hold = await getHold(redis, bookingId);
  if (!hold) return { ok: false, code: 'HOLD_NOT_FOUND' };
  if (!hold.customerId || String(hold.customerId) !== String(customerId || '')) {
    return { ok: false, code: 'HOLD_CUSTOMER_MISMATCH' };
  }
  if (hold.status !== HOLD_STATUS.AWAITING_PASSENGER) {
    return { ok: true, alreadyAnswered: true, hold };
  }
  const next = {
    ...hold,
    passengerAnswer: tookRide ? 'took_ride' : 'did_not_take_ride',
    passengerAnsweredAt: now,
    status: tookRide ? HOLD_STATUS.RELEASE_REQUESTED : HOLD_STATUS.IN_REVIEW
  };
  await saveHold(redis, next);
  return { ok: true, hold: next };
}

/** Decisão da operação no painel: liberar o crédito ou manter em revisão com uma nota. */
async function recordReviewDecision(redis, { bookingId, release, note = '', reviewedBy = null, now = Date.now() } = {}) {
  const hold = await getHold(redis, bookingId);
  if (!hold) return { ok: false, code: 'HOLD_NOT_FOUND' };
  if (hold.status === HOLD_STATUS.RELEASED) return { ok: false, code: 'HOLD_ALREADY_RELEASED' };
  const next = {
    ...hold,
    status: release ? HOLD_STATUS.RELEASE_REQUESTED : HOLD_STATUS.IN_REVIEW,
    reviewNote: String(note || '').trim().slice(0, 500) || hold.reviewNote || null,
    reviewedBy: reviewedBy || hold.reviewedBy || null,
    reviewedAt: now
  };
  await saveHold(redis, next);
  return { ok: true, hold: next };
}

async function listHolds(redis) {
  if (!redis) return [];
  const all = (await redis.hgetall(HOLDS_HASH_KEY)) || {};
  return Object.values(all)
    .map((raw) => parseJson(raw, null))
    .filter((hold) => hold && hold.bookingId)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

/** Itens que o worker deve creditar agora: liberação pedida ou prazo de 24 h vencido sem resposta. */
async function listDueForRelease(redis, { now = Date.now() } = {}) {
  const holds = await listHolds(redis);
  return holds.filter((hold) =>
    hold.status === HOLD_STATUS.RELEASE_REQUESTED ||
    (hold.status === HOLD_STATUS.AWAITING_PASSENGER && now >= Number(hold.autoReleaseAt || 0))
  );
}

async function markReleased(redis, bookingId, { now = Date.now(), releasedBy = 'billing_worker' } = {}) {
  const hold = await getHold(redis, bookingId);
  if (!hold) return null;
  const next = {
    ...hold,
    status: HOLD_STATUS.RELEASED,
    releasedAt: now,
    releasedBy,
    releaseCause: hold.status === HOLD_STATUS.AWAITING_PASSENGER ? 'auto_release_timeout' : 'release_requested'
  };
  await saveHold(redis, next);
  return next;
}

async function registerReleaseAttempt(redis, bookingId, errorMessage = null, { now = Date.now() } = {}) {
  const hold = await getHold(redis, bookingId);
  if (!hold) return null;
  const next = {
    ...hold,
    releaseAttempts: (Number(hold.releaseAttempts) || 0) + 1,
    lastReleaseAttemptAt: now,
    lastReleaseError: errorMessage ? String(errorMessage).slice(0, 300) : null
  };
  await saveHold(redis, next);
  return next;
}

/** Apaga itens liberados há mais de 7 dias (o crédito já está no ledger e no payment_distributions). */
async function pruneReleased(redis, { now = Date.now() } = {}) {
  const holds = await listHolds(redis);
  const stale = holds.filter(
    (hold) => hold.status === HOLD_STATUS.RELEASED && now - Number(hold.releasedAt || 0) > RELEASED_RETENTION_MS
  );
  if (stale.length > 0) {
    await redis.hdel(HOLDS_HASH_KEY, ...stale.map((hold) => hold.bookingId));
  }
  return stale.length;
}

/** Visão sem o evento bruto (para app e painel). */
function toPublicView(hold, { audience = 'ops' } = {}) {
  if (!hold) return null;
  const base = {
    bookingId: hold.bookingId,
    status: hold.status,
    createdAt: hold.createdAt ? new Date(hold.createdAt).toISOString() : null,
    autoReleaseAt: hold.autoReleaseAt ? new Date(hold.autoReleaseAt).toISOString() : null
  };
  if (audience === 'passenger') {
    return {
      bookingId: hold.bookingId,
      completedAt: base.createdAt,
      pickupAddress: hold.pickupAddress || null,
      destinationAddress: hold.destinationAddress || null
    };
  }
  return {
    ...base,
    driverId: hold.driverId,
    customerId: hold.customerId,
    pickupAddress: hold.pickupAddress || null,
    destinationAddress: hold.destinationAddress || null,
    reasons: hold.reasons || [],
    passengerAnswer: hold.passengerAnswer,
    passengerAnsweredAt: hold.passengerAnsweredAt ? new Date(hold.passengerAnsweredAt).toISOString() : null,
    reviewNote: hold.reviewNote,
    reviewedBy: hold.reviewedBy,
    releasedAt: hold.releasedAt ? new Date(hold.releasedAt).toISOString() : null,
    releaseCause: hold.releaseCause || null,
    releaseAttempts: Number(hold.releaseAttempts) || 0,
    lastReleaseError: hold.lastReleaseError || null
  };
}

module.exports = {
  HOLDS_HASH_KEY,
  HOLD_STATUS,
  HOLD_REASONS,
  MAX_AUTOMATIC_RELEASE_ATTEMPTS,
  isEnabled,
  autoReleaseMs,
  evaluateRideHold,
  getHold,
  recordHold,
  recordPassengerAnswer,
  recordReviewDecision,
  listHolds,
  listDueForRelease,
  markReleased,
  registerReleaseAttempt,
  pruneReleased,
  toPublicView
};

'use strict';

// Full refund of a Pix confirmed for a temporary ride session that never became
// a booking (the passenger app left the payment screen while the QR was still
// payable, then the Pix arrived). Approved by Izaak on 2026-10-27.
//
// When a holding is confirmed for `temp_ride_session_*`, the ride id is added to
// a Redis sorted set due ORPHAN_PAYMENT_REFUND_DELAY_MS later (default 10 min).
// The queue-worker leader drains due entries each cycle. An entry is refunded
// only if the holding is still `in_holding` with no bookingId and the
// passenger's active booking does not reference this payment; the refund
// itself goes through paymentService.processRideRefund (idempotent claim,
// provider call, ledger, bot alert). createBooking refuses a payment with a
// refund claimed or done (authoritative-payment-confirmation-service).
const { FINANCIAL_COLLECTIONS } = require('./financial-runtime-context');
const { logStructured } = require('../utils/logger');

const DUE_KEY = 'payment:orphan_refund_due';
const TEMP_RIDE_PREFIX = 'temp_ride_session_';
const REFUND_REASON = 'ORPHAN_PAYMENT_NO_BOOKING';
const DEFAULT_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_BATCH = 20;

function isEnabled(env = process.env) {
  return String(env.ENABLE_ORPHAN_PAYMENT_REFUND ?? 'true').trim().toLowerCase() !== 'false';
}

function delayMs(env = process.env) {
  const parsed = Number.parseInt(env.ORPHAN_PAYMENT_REFUND_DELAY_MS || '', 10);
  return Number.isFinite(parsed) && parsed >= 60 * 1000 ? parsed : DEFAULT_DELAY_MS;
}

function isTemporaryRideId(rideId) {
  return String(rideId || '').startsWith(TEMP_RIDE_PREFIX);
}

// Entries are `<namespace>:<rideId>`, so the check reads the right holdings.
const entryFor = (namespace, rideId) => `${namespace}:${rideId}`;
function parseEntry(entry) {
  const [namespace, ...rest] = String(entry || '').split(':');
  const rideId = rest.join(':');
  return FINANCIAL_COLLECTIONS[namespace] && isTemporaryRideId(rideId) ? { namespace, rideId } : null;
}

// Best effort: a failure here only loses the safety net for this payment.
async function scheduleOrphanCheck(redis, rideId, { namespace, now = Date.now(), env = process.env } = {}) {
  if (!isEnabled(env) || !isTemporaryRideId(rideId) || !FINANCIAL_COLLECTIONS[namespace] || !redis?.zadd) return false;
  try {
    // NX keeps the first due time if the confirmation is processed twice.
    await redis.zadd(DUE_KEY, 'NX', now + delayMs(env), entryFor(namespace, rideId));
    return true;
  } catch (error) {
    logStructured('warn', 'Falha ao agendar checagem de Pix sem corrida', {
      service: 'orphan-payment-refund', rideId, error: error.message
    });
    return false;
  }
}

async function bookingUsesPayment(redis, passengerId, rideId) {
  if (!passengerId || !redis?.get) return false;
  const activeBookingId = await redis.get(`customer_active_booking:${passengerId}`);
  if (!activeBookingId) return false;
  const reference = await redis.hget(`booking:${activeBookingId}`, 'paymentReferenceRideId');
  return reference === rideId;
}

// Decide and refund one ride; returns a short outcome for logs and tests.
async function checkOne({ redis, firestore, paymentService, namespace, rideId }) {
  const snapshot = await firestore.collection(FINANCIAL_COLLECTIONS[namespace].paymentHoldings).doc(rideId).get();
  if (!snapshot.exists) return { outcome: 'no_holding' };
  const holding = snapshot.data() || {};
  if (String(holding.status || '').toLowerCase() !== 'in_holding') return { outcome: 'not_held' };
  if (holding.bookingId) return { outcome: 'has_booking' };
  const passengerId = holding.passengerId || holding.customerId || null;
  if (await bookingUsesPayment(redis, passengerId, rideId)) return { outcome: 'has_booking' };

  const amount = Number(holding.amount);
  const result = await paymentService.processRideRefund({
    rideId,
    chargeId: holding.chargeId || holding.paymentId || null,
    amount,
    reason: REFUND_REASON,
    status: 'REFUNDED',
    passengerId,
    financialContext: holding.financialContext || null,
    metadata: { source: 'orphan_payment_refund' }
  });
  return { outcome: result?.success ? 'refunded' : 'refund_failed', result };
}

// Drain due entries. Each entry is claimed with ZREM, so two leaders never
// refund the same ride; a failed refund is re-queued for a later attempt.
async function processDueOrphanChecks({
  redis,
  firestore,
  paymentService,
  now = Date.now(),
  limit = DEFAULT_BATCH,
  env = process.env
} = {}) {
  if (!isEnabled(env) || !redis?.zrangebyscore || !firestore || !paymentService) return [];
  const due = await redis.zrangebyscore(DUE_KEY, 0, now, 'LIMIT', 0, limit);
  const outcomes = [];
  for (const entry of due) {
    if (Number(await redis.zrem(DUE_KEY, entry)) !== 1) continue;
    const parsed = parseEntry(entry);
    if (!parsed) continue;
    const { namespace, rideId } = parsed;
    let checked;
    try {
      checked = await checkOne({ redis, firestore, paymentService, namespace, rideId });
    } catch (error) {
      checked = { outcome: 'refund_failed', result: { error: error.message } };
    }
    if (checked.outcome === 'refund_failed') {
      await redis.zadd(DUE_KEY, now + delayMs(env), entry).catch(() => null);
    }
    logStructured(checked.outcome === 'refund_failed' ? 'warn' : 'info', 'Checagem de Pix sem corrida', {
      service: 'orphan-payment-refund',
      rideId,
      namespace,
      outcome: checked.outcome,
      code: checked.result?.code || null,
      error: checked.result?.error || null
    });
    outcomes.push({ rideId, outcome: checked.outcome });
  }
  return outcomes;
}

module.exports = {
  DUE_KEY,
  REFUND_REASON,
  isTemporaryRideId,
  scheduleOrphanCheck,
  processDueOrphanChecks
};

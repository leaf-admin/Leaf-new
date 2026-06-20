const redisPool = require('../utils/redis-pool');
const RideStateManager = require('./ride-state-manager');
const GradualRadiusExpander = require('./gradual-radius-expander');
const { logStructured } = require('../utils/logger');

const PAYMENT_LINK_TTL_SECONDS = Number.parseInt(
  process.env.PAYMENT_BOOKING_LINK_TTL_SECONDS || '172800',
  10
);
const PAYMENT_DISPATCH_MAX_ATTEMPTS = Number.parseInt(
  process.env.PAYMENT_DISPATCH_MAX_ATTEMPTS || '3',
  10
);
const PAYMENT_DISPATCH_RETRY_DELAY_MS = Number.parseInt(
  process.env.PAYMENT_DISPATCH_RETRY_DELAY_MS || '350',
  10
);

const DISPATCHABLE_STATES = new Set([
  RideStateManager.STATES.PENDING,
  RideStateManager.STATES.AWAITING_PAYMENT,
  RideStateManager.STATES.SEARCHING,
  RideStateManager.STATES.EXPANDED,
  RideStateManager.STATES.REJECTED,
  RideStateManager.STATES.NOTIFIED,
  RideStateManager.STATES.AWAITING_RESPONSE,
  RideStateManager.STATES.REASSIGNMENT_PENDING
]);

const FINAL_OR_LOCKED_STATES = new Set([
  RideStateManager.STATES.MATCHED,
  RideStateManager.STATES.ACCEPTED,
  RideStateManager.STATES.IN_PROGRESS,
  RideStateManager.STATES.REASSIGNED_IN_PROGRESS,
  RideStateManager.STATES.COMPLETED,
  RideStateManager.STATES.EARLY_ENDED_BY_RIDER,
  RideStateManager.STATES.INTERRUPTED_OPERATIONAL_ENDED,
  RideStateManager.STATES.EARLY_ENDED_REVIEW,
  RideStateManager.STATES.INTERRUPTED_OPERATIONAL,
  RideStateManager.STATES.CANCELED
]);
const RETRYABLE_DISPATCH_REASONS = new Set([
  'BOOKING_NOT_FOUND',
  'PICKUP_LOCATION_INVALID',
  'IO_UNAVAILABLE'
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBookingLocation(rawValue) {
  if (!rawValue) return null;

  if (typeof rawValue === 'object') {
    const lat = Number(rawValue.lat);
    const lng = Number(rawValue.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { ...rawValue, lat, lng };
    }
    return null;
  }

  if (typeof rawValue !== 'string') return null;

  try {
    const parsed = JSON.parse(rawValue);
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { ...parsed, lat, lng };
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function bookingExists(redis, bookingId) {
  if (!bookingId) return false;
  const size = await redis.hlen(`booking:${bookingId}`);
  return size > 0;
}

async function ensureCustomerActiveBooking(redis, bookingId, bookingData) {
  const customerId = bookingData?.customerId;
  if (!customerId) {
    return { ok: true };
  }

  const activeBookingId = await redis.get(`customer_active_booking:${customerId}`);
  if (activeBookingId && activeBookingId !== bookingId) {
    return {
      ok: false,
      reason: 'STALE_CUSTOMER_ACTIVE_BOOKING',
      customerId,
      activeBookingId
    };
  }

  return { ok: true };
}

async function linkPaymentToBooking({
  bookingId,
  chargeId,
  temporaryRideId,
  ttlSeconds = PAYMENT_LINK_TTL_SECONDS
}) {
  if (!bookingId || (!chargeId && !temporaryRideId)) return;

  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const pipeline = redis.multi();

  if (chargeId) {
    pipeline.set(`payment_charge_booking:${chargeId}`, bookingId, 'EX', ttlSeconds);
  }

  if (temporaryRideId) {
    pipeline.set(`payment_temp_ride_booking:${temporaryRideId}`, bookingId, 'EX', ttlSeconds);
  }

  await pipeline.exec();
}

async function resolveBookingIdFromPaymentRefs({ bookingId, chargeId, temporaryRideId }) {
  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();

  if (bookingId && await bookingExists(redis, bookingId)) {
    return bookingId;
  }

  if (chargeId) {
    const linkedByCharge = await redis.get(`payment_charge_booking:${chargeId}`);
    if (linkedByCharge && await bookingExists(redis, linkedByCharge)) {
      return linkedByCharge;
    }
  }

  if (temporaryRideId) {
    const linkedByTemp = await redis.get(`payment_temp_ride_booking:${temporaryRideId}`);
    if (linkedByTemp && await bookingExists(redis, linkedByTemp)) {
      return linkedByTemp;
    }
  }

  if (temporaryRideId && await bookingExists(redis, temporaryRideId)) {
    return temporaryRideId;
  }

  if (chargeId && await bookingExists(redis, chargeId)) {
    return chargeId;
  }

  return null;
}

async function markBookingPaymentConfirmed({
  bookingId,
  chargeId,
  temporaryRideId,
  amountInCents,
  paymentStatus = 'in_holding',
  source = 'unknown'
}) {
  if (!bookingId) return;

  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const nowIso = new Date().toISOString();
  const pipeline = redis.multi();

  const payload = {
    paymentStatus,
    paymentChargeId: chargeId || '',
    paymentAmountInCents: Number.isFinite(Number(amountInCents))
      ? String(Math.round(Number(amountInCents)))
      : '',
    paymentReferenceRideId: temporaryRideId || '',
    paymentConfirmedAt: nowIso,
    paymentUpdatedBy: source
  };

  pipeline.hset(`booking:${bookingId}`, payload);
  if (chargeId) {
    pipeline.set(`payment_charge_booking:${chargeId}`, bookingId, 'EX', PAYMENT_LINK_TTL_SECONDS);
  }
  if (temporaryRideId) {
    pipeline.set(`payment_temp_ride_booking:${temporaryRideId}`, bookingId, 'EX', PAYMENT_LINK_TTL_SECONDS);
  }

  await pipeline.exec();
}

async function materializePaymentForBooking({
  bookingId,
  chargeId,
  temporaryRideId,
  amountInCents,
  passengerId = null,
  paymentStatus = 'in_holding',
  source = 'unknown'
}) {
  const safeBookingId = String(bookingId || '').trim();
  const safeChargeId = String(chargeId || '').trim();
  const safeTemporaryRideId = String(temporaryRideId || '').trim();
  const safeAmountInCents = Number.isFinite(Number(amountInCents))
    ? Math.round(Number(amountInCents))
    : null;

  if (!safeBookingId || (!safeChargeId && !safeTemporaryRideId)) {
    return {
      success: false,
      skipped: true,
      reason: 'PAYMENT_REFERENCE_MISSING'
    };
  }

  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();

  const firebaseConfig = require('../firebase-config');
  const firestore = firebaseConfig.getFirestore();
  const admin = require('firebase-admin');
  const nowIso = new Date().toISOString();
  const normalizedStatus = String(paymentStatus || 'in_holding').trim().toLowerCase() || 'in_holding';

  let sourceHolding = null;
  let sourceRidePayment = null;

  if (firestore && safeTemporaryRideId) {
    const [holdingDoc, ridePaymentDoc] = await Promise.all([
      firestore.collection('payment_holdings').doc(safeTemporaryRideId).get().catch(() => null),
      firestore.collection('ride_payments').doc(safeTemporaryRideId).get().catch(() => null)
    ]);

    if (holdingDoc?.exists) {
      sourceHolding = holdingDoc.data() || null;
    }
    if (ridePaymentDoc?.exists) {
      sourceRidePayment = ridePaymentDoc.data() || null;
    }
  }

  const resolvedAmount = safeAmountInCents
    || Number(sourceHolding?.amount)
    || Number(sourceRidePayment?.amount)
    || 0;
  const roundedAmount = Number.isFinite(Number(resolvedAmount))
    ? Math.round(Number(resolvedAmount))
    : 0;

  const resolvedPassengerId = passengerId
    || sourceHolding?.passengerId
    || sourceRidePayment?.passengerId
    || null;
  const resolvedChargeId = safeChargeId
    || sourceHolding?.chargeId
    || sourceHolding?.paymentId
    || sourceRidePayment?.chargeId
    || '';

  if (firestore) {
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    const basePaymentReference = {
      rideId: safeBookingId,
      canonicalRideId: safeBookingId,
      bookingId: safeBookingId,
      temporaryRideId: safeTemporaryRideId || null,
      paymentReferenceRideId: safeTemporaryRideId || null,
      chargeId: resolvedChargeId || null,
      paymentId: resolvedChargeId || sourceHolding?.paymentId || null,
      passengerId: resolvedPassengerId,
      amount: roundedAmount,
      amountInReais: roundedAmount > 0 ? roundedAmount / 100 : null,
      status: normalizedStatus,
      source,
      materializedFrom: safeTemporaryRideId || null,
      materializedAt: serverTimestamp,
      materializedAtIso: nowIso,
      updatedAt: serverTimestamp
    };

    await firestore.collection('payment_holdings').doc(safeBookingId).set({
      ...(sourceHolding || {}),
      ...basePaymentReference,
      paymentMethod: sourceHolding?.paymentMethod || 'pix',
      paidAt: sourceHolding?.paidAt || sourceRidePayment?.confirmedAt || nowIso,
      confirmedAt: sourceHolding?.confirmedAt || nowIso
    }, { merge: true });

    await firestore.collection('ride_payments').doc(safeBookingId).set({
      ...(sourceRidePayment || {}),
      rideId: safeBookingId,
      canonicalRideId: safeBookingId,
      bookingId: safeBookingId,
      temporaryRideId: safeTemporaryRideId || null,
      paymentReferenceRideId: safeTemporaryRideId || null,
      chargeId: resolvedChargeId || null,
      passengerId: resolvedPassengerId,
      amount: roundedAmount,
      status: sourceRidePayment?.status || 'CONFIRMED',
      credited: sourceRidePayment?.credited === true,
      source,
      materializedFrom: safeTemporaryRideId || null,
      materializedAt: serverTimestamp,
      materializedAtIso: nowIso,
      updatedAt: serverTimestamp
    }, { merge: true });
  }

  await markBookingPaymentConfirmed({
    bookingId: safeBookingId,
    chargeId: resolvedChargeId,
    temporaryRideId: safeTemporaryRideId,
    amountInCents: roundedAmount,
    paymentStatus: normalizedStatus,
    source
  });

  if (roundedAmount > 0) {
    await redis.set(
      `payment_status_cache:${safeBookingId}`,
      JSON.stringify({
        status: normalizedStatus,
        amount: roundedAmount,
        paymentId: resolvedChargeId || null,
        chargeId: resolvedChargeId || null,
        paidAt: sourceHolding?.paidAt || sourceRidePayment?.confirmedAt || nowIso,
        confirmedAt: sourceHolding?.confirmedAt || nowIso,
        rideId: safeBookingId,
        updatedAt: nowIso
      }),
      'EX',
      PAYMENT_LINK_TTL_SECONDS
    ).catch(() => null);
  }

  return {
    success: true,
    bookingId: safeBookingId,
    temporaryRideId: safeTemporaryRideId || null,
    chargeId: resolvedChargeId || null,
    amountInCents: roundedAmount
  };
}

async function triggerDispatchAttempt({
  bookingId,
  io,
  pickupLocation = null,
  source = 'unknown',
  force = false
}) {
  if (!bookingId) {
    return { success: false, skipped: true, reason: 'BOOKING_ID_MISSING' };
  }

  if (!io) {
    logStructured('warn', 'Dispatch pós-pagamento ignorado: io indisponível', {
      service: 'payment-dispatch-service',
      bookingId,
      source
    });
    return { success: false, skipped: true, reason: 'IO_UNAVAILABLE' };
  }

  await redisPool.ensureConnection();
  const redis = redisPool.getConnection();
  const bookingKey = `booking:${bookingId}`;
  const bookingData = await redis.hgetall(bookingKey);

  if (!bookingData || Object.keys(bookingData).length === 0) {
    return { success: false, skipped: true, reason: 'BOOKING_NOT_FOUND' };
  }

  const customerActiveCheck = await ensureCustomerActiveBooking(redis, bookingId, bookingData);
  if (!customerActiveCheck.ok) {
    return {
      success: true,
      skipped: true,
      reason: customerActiveCheck.reason,
      customerId: customerActiveCheck.customerId,
      activeBookingId: customerActiveCheck.activeBookingId
    };
  }

  const state = await RideStateManager.getBookingState(redis, bookingId);

  if (state && FINAL_OR_LOCKED_STATES.has(state)) {
    return {
      success: true,
      skipped: true,
      reason: 'BOOKING_ALREADY_LOCKED',
      state
    };
  }

  const searchKey = `booking_search:${bookingId}`;
  const existingSearch = await redis.hgetall(searchKey);
  const searchAlreadyActive = Boolean(
    existingSearch &&
    existingSearch.state &&
    existingSearch.state !== 'STOPPED'
  );

  if (searchAlreadyActive && !force) {
    return {
      success: true,
      skipped: true,
      reason: 'SEARCH_ALREADY_ACTIVE',
      state: state || null
    };
  }

  const resolvedPickup =
    parseBookingLocation(pickupLocation) ||
    parseBookingLocation(bookingData.pickupLocation);

  if (!resolvedPickup) {
    return { success: false, skipped: true, reason: 'PICKUP_LOCATION_INVALID' };
  }

  if (!state || state === RideStateManager.STATES.PENDING || state === RideStateManager.STATES.AWAITING_PAYMENT) {
    try {
      if (!state) {
        await redis.hset(bookingKey, {
          state: RideStateManager.STATES.SEARCHING,
          updatedAt: new Date().toISOString()
        });
      } else {
        await RideStateManager.updateBookingState(
          redis,
          bookingId,
          RideStateManager.STATES.SEARCHING,
          { source: `payment_dispatch:${source}` }
        );
      }
    } catch (stateError) {
      logStructured('warn', 'Falha ao ajustar estado para SEARCHING no dispatch pós-pagamento', {
        service: 'payment-dispatch-service',
        bookingId,
        source,
        state,
        error: stateError.message
      });
    }
  } else if (!DISPATCHABLE_STATES.has(state)) {
    return {
      success: true,
      skipped: true,
      reason: 'STATE_NOT_DISPATCHABLE',
      state
    };
  }

  await redis.hset(bookingKey, {
    dispatchTriggeredAt: new Date().toISOString(),
    dispatchTriggeredBy: source
  });

  const expander = new GradualRadiusExpander(io);
  await expander.startGradualSearch(bookingId, resolvedPickup);

  logStructured('info', 'Dispatch de motoristas acionado após confirmação de pagamento', {
    service: 'payment-dispatch-service',
    bookingId,
    source,
    searchAlreadyActive
  });

  return {
    success: true,
    skipped: false,
    bookingId
  };
}

async function triggerDispatchAfterPayment(options) {
  const {
    maxAttempts = PAYMENT_DISPATCH_MAX_ATTEMPTS,
    retryDelayMs = PAYMENT_DISPATCH_RETRY_DELAY_MS
  } = options || {};

  const parsedMaxAttempts = Math.max(1, Number.parseInt(maxAttempts, 10) || 1);
  const parsedRetryDelayMs = Math.max(50, Number.parseInt(retryDelayMs, 10) || PAYMENT_DISPATCH_RETRY_DELAY_MS);

  let lastResult = null;

  for (let attempt = 1; attempt <= parsedMaxAttempts; attempt += 1) {
    lastResult = await triggerDispatchAttempt(options);

    const isRetryableSkip = Boolean(
      lastResult &&
      lastResult.skipped &&
      RETRYABLE_DISPATCH_REASONS.has(lastResult.reason)
    );

    if (!isRetryableSkip || attempt === parsedMaxAttempts) {
      if (attempt > 1) {
        logStructured('info', 'Dispatch pós-pagamento finalizado com retry', {
          service: 'payment-dispatch-service',
          bookingId: options?.bookingId,
          source: options?.source || 'unknown',
          attempts: attempt,
          reason: lastResult?.reason || null,
          success: Boolean(lastResult?.success)
        });
      }

      return {
        ...(lastResult || {}),
        attempts: attempt
      };
    }

    await delay(parsedRetryDelayMs);
  }

  return {
    ...(lastResult || { success: false, skipped: true, reason: 'UNKNOWN' }),
    attempts: parsedMaxAttempts
  };
}

module.exports = {
  linkPaymentToBooking,
  materializePaymentForBooking,
  markBookingPaymentConfirmed,
  resolveBookingIdFromPaymentRefs,
  triggerDispatchAfterPayment
};

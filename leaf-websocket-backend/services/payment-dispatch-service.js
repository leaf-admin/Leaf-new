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
  RideStateManager.STATES.SEARCHING,
  RideStateManager.STATES.EXPANDED,
  RideStateManager.STATES.REJECTED,
  RideStateManager.STATES.NOTIFIED,
  RideStateManager.STATES.AWAITING_RESPONSE
]);

const FINAL_OR_LOCKED_STATES = new Set([
  RideStateManager.STATES.MATCHED,
  RideStateManager.STATES.ACCEPTED,
  RideStateManager.STATES.IN_PROGRESS,
  RideStateManager.STATES.COMPLETED,
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

  if (!state || state === RideStateManager.STATES.PENDING) {
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
  markBookingPaymentConfirmed,
  resolveBookingIdFromPaymentRefs,
  triggerDispatchAfterPayment
};

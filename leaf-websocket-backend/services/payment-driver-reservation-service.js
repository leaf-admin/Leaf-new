'use strict';

const crypto = require('crypto');

const DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS = Math.max(
  30,
  Number.parseInt(process.env.PAYMENT_DRIVER_RESERVATION_TTL_SECONDS || '180', 10) || 180
);
const PAYMENT_DRIVER_RESERVATION_BOOKING_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.PAYMENT_DRIVER_RESERVATION_BOOKING_TTL_SECONDS || '900', 10) || 900
);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTtlSeconds(value, fallback = DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Number.isFinite(parsed) && parsed > 0 ? parsed : fallback);
}

function normalizeLocation(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { ...value, lat, lng };
}

function buildPaymentDriverReservationId({
  passengerId,
  rideId,
  paymentSessionId,
  quoteLockId,
  quoteSessionId
} = {}) {
  const stableContext = [
    normalizeText(passengerId),
    normalizeText(rideId) || normalizeText(paymentSessionId),
    normalizeText(quoteLockId),
    normalizeText(quoteSessionId)
  ].join(':');
  const hash = crypto
    .createHash('sha256')
    .update(`payment_driver_reservation:${stableContext}`)
    .digest('hex')
    .slice(0, 32);
  return `pdr_${hash}`;
}

function getPaymentDriverReservationKey(reservationId) {
  return `payment_driver_reservation:${normalizeText(reservationId)}`;
}

function getDriverPaymentReservationKey(driverId) {
  return `driver_payment_reservation:${normalizeText(driverId)}`;
}

function buildReservationPayload(input = {}, ttlSeconds = DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS) {
  const nowMs = Date.now();
  const safeTtlSeconds = normalizeTtlSeconds(ttlSeconds);
  return {
    reservationId: normalizeText(input.reservationId),
    driverId: normalizeText(input.driverId),
    passengerId: normalizeText(input.passengerId) || null,
    rideId: normalizeText(input.rideId) || null,
    paymentSessionId: normalizeText(input.paymentSessionId) || null,
    paymentContextKey: normalizeText(input.paymentContextKey) || null,
    quoteSessionId: normalizeText(input.quoteSessionId) || null,
    quoteLockId: normalizeText(input.quoteLockId) || null,
    paymentIntentId: normalizeText(input.paymentIntentId) || null,
    status: input.status || 'reserved_for_payment',
    pickupLocation: normalizeLocation(input.pickupLocation),
    destinationLocation: normalizeLocation(input.destinationLocation),
    carType: normalizeText(input.carType) || null,
    createdAtIso: input.createdAtIso || new Date(nowMs).toISOString(),
    updatedAtIso: new Date(nowMs).toISOString(),
    expiresAtMs: nowMs + safeTtlSeconds * 1000,
    expiresAtIso: new Date(nowMs + safeTtlSeconds * 1000).toISOString(),
    ttlSeconds: safeTtlSeconds
  };
}

async function readPaymentDriverReservation(redis, reservationId) {
  const safeReservationId = normalizeText(reservationId);
  if (!redis || !safeReservationId) return null;

  const raw = await redis.get(getPaymentDriverReservationKey(safeReservationId));
  if (!raw) return null;

  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_error) {
    return null;
  }
}

async function getDriverPaymentReservation(redis, driverId) {
  const safeDriverId = normalizeText(driverId);
  if (!redis || !safeDriverId) return null;

  const reservationId = await redis.get(getDriverPaymentReservationKey(safeDriverId));
  if (!reservationId) return null;

  const reservation = await readPaymentDriverReservation(redis, reservationId);
  if (!reservation) return { reservationId };
  return reservation;
}

function reservationMatchesContext(reservation = {}, context = {}) {
  const expectedReservationId = normalizeText(context.reservationId || context.paymentDriverReservationId);
  if (expectedReservationId && normalizeText(reservation.reservationId) === expectedReservationId) {
    return true;
  }

  const expectedRideIds = new Set([
    normalizeText(context.rideId),
    normalizeText(context.temporaryRideId),
    normalizeText(context.paymentReferenceRideId),
    normalizeText(context.bookingId)
  ].filter(Boolean));
  if (expectedRideIds.has(normalizeText(reservation.rideId))) {
    return true;
  }

  const expectedPaymentSessionId = normalizeText(context.paymentSessionId);
  if (expectedPaymentSessionId && expectedPaymentSessionId === normalizeText(reservation.paymentSessionId)) {
    return true;
  }

  const expectedQuoteLockId = normalizeText(context.quoteLockId || context.paymentQuoteLockId);
  if (expectedQuoteLockId && expectedQuoteLockId === normalizeText(reservation.quoteLockId)) {
    return true;
  }

  return false;
}

async function reservePaymentDriver({
  redis,
  driverId,
  passengerId,
  rideId,
  paymentSessionId,
  paymentContextKey,
  quoteSessionId,
  quoteLockId,
  pickupLocation,
  destinationLocation,
  carType,
  paymentIntentId = null,
  ttlSeconds = DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS
} = {}) {
  const safeDriverId = normalizeText(driverId);
  if (!redis || !safeDriverId) {
    return { success: false, code: 'PAYMENT_DRIVER_RESERVATION_INPUT_INVALID' };
  }

  const reservationId = buildPaymentDriverReservationId({
    passengerId,
    rideId,
    paymentSessionId,
    quoteLockId,
    quoteSessionId
  });
  const safeTtlSeconds = normalizeTtlSeconds(ttlSeconds);
  const driverKey = getDriverPaymentReservationKey(safeDriverId);
  const reservationKey = getPaymentDriverReservationKey(reservationId);
  const existingReservationId = await redis.get(driverKey);

  if (existingReservationId && existingReservationId !== reservationId) {
    const existing = await readPaymentDriverReservation(redis, existingReservationId);
    return {
      success: false,
      code: 'DRIVER_ALREADY_RESERVED_FOR_PAYMENT',
      driverId: safeDriverId,
      reservationId,
      existingReservationId,
      existingExpiresAtIso: existing?.expiresAtIso || null
    };
  }

  if (!existingReservationId) {
    const acquired = await redis.set(driverKey, reservationId, 'EX', safeTtlSeconds, 'NX');
    if (acquired !== 'OK') {
      return {
        success: false,
        code: 'DRIVER_ALREADY_RESERVED_FOR_PAYMENT',
        driverId: safeDriverId,
        reservationId
      };
    }
  } else {
    await redis.set(driverKey, reservationId, 'EX', safeTtlSeconds);
  }

  const existingPayload = await readPaymentDriverReservation(redis, reservationId);
  const payload = buildReservationPayload({
    ...(existingPayload || {}),
    reservationId,
    driverId: safeDriverId,
    passengerId,
    rideId,
    paymentSessionId,
    paymentContextKey,
    quoteSessionId,
    quoteLockId,
    pickupLocation,
    destinationLocation,
    carType,
    paymentIntentId,
    createdAtIso: existingPayload?.createdAtIso
  }, safeTtlSeconds);

  await redis.set(reservationKey, JSON.stringify(payload), 'EX', safeTtlSeconds);

  return {
    success: true,
    reservationId,
    driverId: safeDriverId,
    expiresAtIso: payload.expiresAtIso,
    ttlSeconds: safeTtlSeconds,
    reservation: payload
  };
}

async function validatePaymentDriverReservation({
  redis,
  reservationId,
  passengerId,
  rideId,
  paymentSessionId,
  quoteLockId,
  bookingId = null
} = {}) {
  const reservation = await readPaymentDriverReservation(redis, reservationId);
  if (!reservation) {
    return {
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_MISSING'
    };
  }

  const expiresAtMs = Number(reservation.expiresAtMs || Date.parse(reservation.expiresAtIso || ''));
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    return {
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_EXPIRED',
      reservation
    };
  }

  const driverPointer = await redis.get(getDriverPaymentReservationKey(reservation.driverId));
  if (driverPointer !== reservation.reservationId) {
    return {
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_RELEASED',
      reservation
    };
  }

  if (!reservationMatchesContext(reservation, {
    reservationId,
    passengerId,
    rideId,
    paymentSessionId,
    quoteLockId,
    bookingId
  })) {
    return {
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_CONTEXT_MISMATCH',
      reservation
    };
  }

  if (normalizeText(passengerId) && normalizeText(reservation.passengerId) !== normalizeText(passengerId)) {
    return {
      success: false,
      code: 'PAYMENT_DRIVER_RESERVATION_PASSENGER_MISMATCH',
      reservation
    };
  }

  return {
    success: true,
    reservation
  };
}

async function consumePaymentDriverReservationForBooking({
  redis,
  reservationId,
  bookingId,
  ttlSeconds = PAYMENT_DRIVER_RESERVATION_BOOKING_TTL_SECONDS
} = {}) {
  const safeBookingId = normalizeText(bookingId);
  const reservation = await readPaymentDriverReservation(redis, reservationId);
  if (!reservation || !safeBookingId) {
    return {
      success: false,
      code: reservation ? 'BOOKING_ID_REQUIRED' : 'PAYMENT_DRIVER_RESERVATION_MISSING'
    };
  }

  const safeTtlSeconds = normalizeTtlSeconds(ttlSeconds, PAYMENT_DRIVER_RESERVATION_BOOKING_TTL_SECONDS);
  const payload = {
    ...reservation,
    status: 'consumed_for_booking',
    bookingId: safeBookingId,
    updatedAtIso: new Date().toISOString()
  };

  await redis.set(
    getPaymentDriverReservationKey(reservation.reservationId),
    JSON.stringify(payload),
    'EX',
    safeTtlSeconds
  );
  await redis.set(
    getDriverPaymentReservationKey(reservation.driverId),
    reservation.reservationId,
    'EX',
    safeTtlSeconds
  );

  return {
    success: true,
    reservation: payload
  };
}

async function releasePaymentDriverReservation(redis, reservationId) {
  const reservation = await readPaymentDriverReservation(redis, reservationId);
  if (!reservation) return false;

  const driverPointer = await redis.get(getDriverPaymentReservationKey(reservation.driverId));
  const pipeline = redis.multi();
  pipeline.del(getPaymentDriverReservationKey(reservation.reservationId));
  if (driverPointer === reservation.reservationId) {
    pipeline.del(getDriverPaymentReservationKey(reservation.driverId));
  }
  await pipeline.exec();
  return true;
}

module.exports = {
  DEFAULT_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS,
  PAYMENT_DRIVER_RESERVATION_BOOKING_TTL_SECONDS,
  buildPaymentDriverReservationId,
  getPaymentDriverReservationKey,
  getDriverPaymentReservationKey,
  readPaymentDriverReservation,
  getDriverPaymentReservation,
  reservePaymentDriver,
  validatePaymentDriverReservation,
  consumePaymentDriverReservationForBooking,
  releasePaymentDriverReservation,
  reservationMatchesContext
};

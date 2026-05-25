const { logStructured } = require('../utils/logger');

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundMoney(value) {
  const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  return Math.round(normalized * 100) / 100;
}

function resolveRideExtensionPaymentTimeoutSec() {
  const parsed = Number.parseInt(
    process.env.RIDE_EXTENSION_PAYMENT_TIMEOUT_SEC || '300',
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

function buildRideExtensionExpiresAt(baseDate = new Date(), timeoutSec = null) {
  const ttlSeconds =
    timeoutSec !== null &&
    timeoutSec !== undefined &&
    Number.isFinite(Number(timeoutSec))
    ? Math.max(1, Math.round(Number(timeoutSec)))
    : resolveRideExtensionPaymentTimeoutSec();
  const expiresAtMs = new Date(baseDate).getTime() + (ttlSeconds * 1000);
  return new Date(expiresAtMs).toISOString();
}

function isIsoDateExpired(rawValue, now = Date.now()) {
  if (!rawValue) return false;
  const parsed = Date.parse(rawValue);
  if (!Number.isFinite(parsed)) return false;
  return parsed <= now;
}

function parseJsonMaybe(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function normalizeLocation(rawValue) {
  const candidate = parseJsonMaybe(rawValue);
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const lat = toFiniteNumber(candidate.lat ?? candidate.latitude);
  const lng = toFiniteNumber(candidate.lng ?? candidate.longitude);
  if (lat === null || lng === null) {
    return null;
  }

  return {
    ...candidate,
    lat,
    lng
  };
}

function serializeRedisValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function parseMoneyValue(rawValue, fallback = 0) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function resolvePrepaidAmount(bookingHash = {}) {
  const prepaidAmountInCents = parseMoneyValue(
    bookingHash.paymentAmountInCents || bookingHash.amountInCents || 0,
    0
  );

  if (prepaidAmountInCents > 0) {
    return roundMoney(prepaidAmountInCents / 100);
  }

  return 0;
}

function resolveContractualFare(bookingHash = {}) {
  const bookingFare = parseMoneyValue(
    bookingHash.estimatedFare ||
      bookingHash.totalAmount ||
      bookingHash.finalFare ||
      bookingHash.estimate ||
      0,
    0
  );

  const prepaidAmount = resolvePrepaidAmount(bookingHash);
  return roundMoney(Math.max(bookingFare, prepaidAmount));
}

function parseHistoryField(rawValue) {
  const parsed = parseJsonMaybe(rawValue);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadBookingContext(redis, bookingId) {
  const bookingHash = await redis.hgetall(`booking:${bookingId}`);
  if (!bookingHash || Object.keys(bookingHash).length === 0) {
    return null;
  }

  const activeRaw = await redis.hget('bookings:active', bookingId);
  let activeBooking = null;

  if (activeRaw) {
    try {
      activeBooking = typeof activeRaw === 'string' ? JSON.parse(activeRaw) : activeRaw;
    } catch (_error) {
      activeBooking = null;
    }
  }

  return {
    bookingHash,
    activeBooking
  };
}

async function persistBookingPatch(redis, bookingId, patch = {}, options = {}) {
  const serializedPatch = {};
  Object.entries(patch).forEach(([key, value]) => {
    const serializedValue = serializeRedisValue(value);
    if (serializedValue !== undefined) {
      serializedPatch[key] = serializedValue;
    }
  });

  const pipeline = redis.multi();
  if (Object.keys(serializedPatch).length > 0) {
    pipeline.hset(`booking:${bookingId}`, serializedPatch);
  }

  const mergeActiveBooking = options.mergeActiveBooking !== false;
  if (mergeActiveBooking) {
    pipeline.hget('bookings:active', bookingId);
  }

  const results = await pipeline.exec();

  if (!mergeActiveBooking) {
    return;
  }

  const activeRaw = results?.[1]?.[1];
  if (!activeRaw) {
    return;
  }

  let activeBooking = null;
  try {
    activeBooking = typeof activeRaw === 'string' ? JSON.parse(activeRaw) : activeRaw;
  } catch (_error) {
    activeBooking = null;
  }

  if (!activeBooking || typeof activeBooking !== 'object') {
    return;
  }

  const updatedActiveBooking = {
    ...activeBooking
  };

  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    updatedActiveBooking[key] = value;
  });

  if (patch.pickupLocation) {
    updatedActiveBooking.pickupLocation = patch.pickupLocation;
    updatedActiveBooking.pickup = patch.pickupLocation;
  }

  if (patch.destinationLocation) {
    updatedActiveBooking.destinationLocation = patch.destinationLocation;
    updatedActiveBooking.drop = patch.destinationLocation;
  }

  if (patch.estimatedFare !== undefined) {
    const estimate = parseMoneyValue(patch.estimatedFare, 0);
    updatedActiveBooking.estimatedFare = estimate;
    updatedActiveBooking.estimate = estimate;
  }

  if (patch.routeDistanceKm !== undefined) {
    updatedActiveBooking.routeDistanceKm = parseMoneyValue(patch.routeDistanceKm, 0);
  }

  if (patch.routeDurationSecs !== undefined) {
    updatedActiveBooking.routeDurationSecs = parseMoneyValue(patch.routeDurationSecs, 0);
  }

  if (patch.driverId !== undefined) {
    updatedActiveBooking.driverId = patch.driverId || null;
  }

  if (patch.status !== undefined) {
    updatedActiveBooking.status = patch.status;
  }

  await redis.hset('bookings:active', bookingId, JSON.stringify(updatedActiveBooking));
}

async function appendJsonHistoryField(redis, bookingId, fieldName, item, limit = 20) {
  const currentRaw = await redis.hget(`booking:${bookingId}`, fieldName);
  const current = parseHistoryField(currentRaw);
  const next = [...current, item].slice(-limit);
  await persistBookingPatch(redis, bookingId, {
    [fieldName]: next
  });
  return next;
}

function resolveRouteMetrics(bookingHash = {}) {
  const originalDistanceKm = parseMoneyValue(
    bookingHash.routeDistanceKm ||
      bookingHash.distance ||
      bookingHash.routeDistance ||
      bookingHash.tripDistance ||
      0,
    0
  );

  const originalDurationSecs = parseMoneyValue(
    bookingHash.routeDurationSecs ||
      bookingHash.duration ||
      bookingHash.routeDuration ||
      bookingHash.tripDuration ||
      0,
    0
  );

  return {
    originalDistanceKm,
    originalDurationSecs
  };
}

function calculateProgressRatio({
  bookingHash = {},
  executedDistanceKm = 0,
  executedDurationSecs = 0
}) {
  const { originalDistanceKm, originalDurationSecs } = resolveRouteMetrics(bookingHash);

  const distanceShare =
    originalDistanceKm > 0 ? clamp(executedDistanceKm / originalDistanceKm, 0, 1) : null;
  const durationShare =
    originalDurationSecs > 0 ? clamp(executedDurationSecs / originalDurationSecs, 0, 1) : null;

  let blendedProgress = 0;
  if (distanceShare !== null && durationShare !== null) {
    blendedProgress = (distanceShare * 0.65) + (durationShare * 0.35);
  } else if (distanceShare !== null) {
    blendedProgress = distanceShare;
  } else if (durationShare !== null) {
    blendedProgress = durationShare;
  }

  return {
    originalDistanceKm,
    originalDurationSecs,
    distanceShare,
    durationShare,
    progressRatio: clamp(blendedProgress, 0, 1)
  };
}

function calculateExecutedFareSettlement(bookingHash = {}, options = {}) {
  const originalFare = resolveContractualFare(bookingHash);
  const tollFee = parseMoneyValue(bookingHash.tollFee || 0, 0);
  const prepaidAmount = roundMoney(Math.max(resolvePrepaidAmount(bookingHash), originalFare));

  const executedDistanceKm = Math.max(0, parseMoneyValue(options.distanceKm || 0, 0));
  const executedDurationSecs = Math.max(0, parseMoneyValue(options.durationSecs || 0, 0));
  const minChargeRatio = clamp(
    parseMoneyValue(
      options.minChargeRatio ??
        process.env.RIDER_EARLY_END_MIN_CHARGE_RATIO ??
        '0.25',
      0.25
    ),
    0,
    1
  );

  const progress = calculateProgressRatio({
    bookingHash,
    executedDistanceKm,
    executedDurationSecs
  });

  const appliedRatio = clamp(
    Math.max(progress.progressRatio, minChargeRatio),
    0,
    1
  );

  const executedFare = roundMoney(Math.max(0, originalFare * appliedRatio));
  const estimatedRefund = roundMoney(Math.max(0, prepaidAmount - executedFare));

  return {
    settlementType: String(options.settlementType || 'EXECUTED_FARE_SETTLEMENT').trim(),
    originalFare: roundMoney(originalFare),
    prepaidAmount: roundMoney(prepaidAmount),
    executedFare,
    tollFee: roundMoney(tollFee),
    estimatedRefund,
    appliedRatio,
    progressRatio: progress.progressRatio,
    distanceShare: progress.distanceShare,
    durationShare: progress.durationShare,
    executedDistanceKm: roundMoney(executedDistanceKm),
    executedDurationSecs: Math.round(executedDurationSecs),
    originalDistanceKm: roundMoney(progress.originalDistanceKm),
    originalDurationSecs: Math.round(progress.originalDurationSecs),
    remainingReservedAmount: roundMoney(Math.max(0, prepaidAmount - executedFare))
  };
}

function calculateRiderEarlyEndSettlement(bookingHash = {}, options = {}) {
  return calculateExecutedFareSettlement(bookingHash, {
    ...options,
    settlementType: 'EARLY_ENDED_BY_RIDER',
    minChargeRatio:
      options.minChargeRatio ??
      process.env.RIDER_EARLY_END_MIN_CHARGE_RATIO ??
      '0.25'
  });
}

function calculateOperationalInterruptionSettlement(bookingHash = {}, options = {}) {
  return calculateExecutedFareSettlement(bookingHash, {
    ...options,
    settlementType: 'INTERRUPTED_OPERATIONAL',
    minChargeRatio: options.minChargeRatio ?? 0
  });
}

function resolveRideLegs(bookingHash = {}) {
  const parsed = parseJsonMaybe(bookingHash.rideLegs);
  return Array.isArray(parsed) ? parsed : [];
}

function resolveOperationalContinuation(bookingHash = {}) {
  const parsed = parseJsonMaybe(
    bookingHash.operationalContinuation ||
      bookingHash.operationalInterruption ||
      bookingHash.reassignmentContext
  );
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function sumRideLegGrossFare(rideLegs = []) {
  return roundMoney(
    (Array.isArray(rideLegs) ? rideLegs : []).reduce((accumulator, leg) => {
      return accumulator + parseMoneyValue(leg?.grossAmount || leg?.executedFare || 0, 0);
    }, 0)
  );
}

function buildRideLegSettlement({
  bookingHash = {},
  existingRideLegs = [],
  driverId,
  grossAmount = 0,
  distanceKm = 0,
  durationSecs = 0,
  startedAt = null,
  endedAt = null,
  startLocation = null,
  endLocation = null,
  reason = 'LEG_COMPLETED',
  legType = 'PRIMARY',
  absorbedOperationalFee = false,
  absorbedPaymentIntermediationFee = false,
  rescueBonus = 0,
  source = 'runtime',
  metadata = {}
}) {
  const PaymentService = require('./payment-service');
  const paymentService = new PaymentService();
  const normalizedGrossAmount = roundMoney(Math.max(0, parseMoneyValue(grossAmount, 0)));
  const normalizedDistanceKm = roundMoney(Math.max(0, parseMoneyValue(distanceKm, 0)));
  const normalizedDurationSecs = Math.round(Math.max(0, parseMoneyValue(durationSecs, 0)));
  const normalizedBonus = roundMoney(Math.max(0, parseMoneyValue(rescueBonus, 0)));
  const rawBreakdown = paymentService.calculateFareBreakdownFromReais(normalizedGrossAmount, 0);
  const rawOperationalFee = roundMoney(rawBreakdown.operationalFee);
  const rawPaymentIntermediationFee = roundMoney(rawBreakdown.paymentIntermediationFee);
  const retainedOperationalFee = absorbedOperationalFee ? 0 : rawOperationalFee;
  const retainedPaymentIntermediationFee = absorbedPaymentIntermediationFee
    ? 0
    : rawPaymentIntermediationFee;
  const platformAbsorbedOperationalFee = absorbedOperationalFee ? rawOperationalFee : 0;
  const platformAbsorbedPaymentIntermediationFee = absorbedPaymentIntermediationFee
    ? rawPaymentIntermediationFee
    : 0;
  const totalFees = roundMoney(retainedOperationalFee + retainedPaymentIntermediationFee);
  const driverNetAmount = roundMoney(
    Math.max(0, normalizedGrossAmount - totalFees + normalizedBonus)
  );

  return {
    legId: `leg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    legNumber: (Array.isArray(existingRideLegs) ? existingRideLegs.length : 0) + 1,
    driverId: String(driverId || '').trim() || null,
    legType: String(legType || 'PRIMARY').trim().toUpperCase(),
    reason: String(reason || 'LEG_COMPLETED').trim().toUpperCase(),
    grossAmount: normalizedGrossAmount,
    distanceKm: normalizedDistanceKm,
    durationSecs: normalizedDurationSecs,
    startedAt: startedAt || null,
    endedAt: endedAt || new Date().toISOString(),
    startLocation: normalizeLocation(startLocation) || startLocation || null,
    endLocation: normalizeLocation(endLocation) || endLocation || null,
    operationalFee: retainedOperationalFee,
    paymentIntermediationFee: retainedPaymentIntermediationFee,
    totalFees,
    driverNetAmount,
    rescueBonus: normalizedBonus,
    platformAbsorbedOperationalFee,
    platformAbsorbedPaymentIntermediationFee,
    financialPolicy: {
      absorbedOperationalFee,
      absorbedPaymentIntermediationFee
    },
    source: String(source || 'runtime').trim(),
    metadata
  };
}

function buildOperationalInterruptionRecord({
  bookingHash = {},
  driverId,
  interruptionLocation,
  reason = 'VEHICLE_BREAKDOWN',
  note = '',
  settlement,
  closedRideLeg,
  currentState = 'IN_PROGRESS'
}) {
  const pickupLocation = normalizeLocation(interruptionLocation);
  return {
    status: 'PASSENGER_DECISION_PENDING',
    interruptedAt: new Date().toISOString(),
    interruptedByDriverId: driverId,
    currentState: String(currentState || 'IN_PROGRESS').trim().toUpperCase(),
    reason: String(reason || 'VEHICLE_BREAKDOWN').trim().toUpperCase(),
    note: String(note || '').trim(),
    pickupLocation,
    originalDestination:
      normalizeLocation(bookingHash.destinationLocation || bookingHash.destination) || null,
    executedFare: roundMoney(settlement?.executedFare || 0),
    remainingReservedAmount: roundMoney(settlement?.remainingReservedAmount || 0),
    estimatedRefund: roundMoney(settlement?.estimatedRefund || 0),
    closedRideLeg
  };
}

function buildContinuationRideLeg({
  bookingHash = {},
  existingRideLegs = [],
  driverId,
  finalFare,
  distanceKm = 0,
  durationSecs = 0,
  startLocation = null,
  endLocation = null,
  startedAt = null,
  endedAt = null,
  rescueBonus = 0,
  metadata = {}
}) {
  const normalizedFinalFare = roundMoney(Math.max(0, parseMoneyValue(finalFare, 0)));
  const alreadySettled = sumRideLegGrossFare(existingRideLegs);
  const remainingGrossAmount = roundMoney(Math.max(0, normalizedFinalFare - alreadySettled));

  return buildRideLegSettlement({
    bookingHash,
    existingRideLegs,
    driverId,
    grossAmount: remainingGrossAmount,
    distanceKm,
    durationSecs,
    startLocation,
    endLocation,
    startedAt,
    endedAt,
    reason: 'CONTINUATION_COMPLETED',
    legType: 'CONTINUATION',
    absorbedOperationalFee: true,
    absorbedPaymentIntermediationFee: true,
    rescueBonus,
    source: 'continuation_completion',
    metadata: {
      ...metadata,
      remainingGrossAmount,
      alreadySettled
    }
  });
}

function buildExtensionRequest({
  bookingHash = {},
  customerId,
  newEndLocation,
  newFare,
  routeDistanceKm = null,
  routeDurationSecs = null,
  traceId = null,
  correlationId = null
}) {
  const currentFare = resolveContractualFare(bookingHash);
  const normalizedNewFare = roundMoney(newFare);
  const diffFare = roundMoney(Math.max(0, normalizedNewFare - currentFare));

  return {
    requestId: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'DRIVER_DECISION_PENDING',
    requestedAt: new Date().toISOString(),
    requestedBy: customerId,
    currentFare: roundMoney(currentFare),
    newFare: normalizedNewFare,
    diffFare,
    newEndLocation,
    routeDistanceKm: routeDistanceKm !== null ? roundMoney(routeDistanceKm) : null,
    routeDurationSecs: routeDurationSecs !== null ? Math.round(routeDurationSecs) : null,
    traceId,
    correlationId
  };
}

async function applyConfirmedRideExtension({
  redis,
  bookingId,
  chargeId,
  amountInCents = null,
  io = null,
  source = 'unknown'
}) {
  const context = await loadBookingContext(redis, bookingId);
  if (!context?.bookingHash) {
    return { success: false, skipped: true, reason: 'BOOKING_NOT_FOUND' };
  }

  const extensionRequest = parseJsonMaybe(context.bookingHash.activeExtensionRequest);
  if (!extensionRequest || typeof extensionRequest !== 'object') {
    return { success: false, skipped: true, reason: 'NO_ACTIVE_EXTENSION' };
  }

  if (String(extensionRequest.chargeId || '').trim() !== String(chargeId || '').trim()) {
    return { success: false, skipped: true, reason: 'CHARGE_MISMATCH' };
  }

  if (extensionRequest.status === 'CONFIRMED') {
    return { success: true, skipped: true, reason: 'ALREADY_CONFIRMED', extensionRequest };
  }

  if (
    extensionRequest.status === 'EXPIRED' ||
    isIsoDateExpired(extensionRequest.expiresAt)
  ) {
    if (extensionRequest.status !== 'EXPIRED' && isIsoDateExpired(extensionRequest.expiresAt)) {
      await expirePendingRideExtension({
        redis,
        bookingId,
        chargeId,
        io,
        source: `${source}_ttl_guard`,
        reason: 'PAYMENT_TIMEOUT'
      });
    }
    return {
      success: false,
      skipped: true,
      reason: 'EXTENSION_EXPIRED',
      extensionRequest
    };
  }

  const confirmedExtension = {
    ...extensionRequest,
    status: 'CONFIRMED',
    paidAt: new Date().toISOString(),
    paidAmountInCents: Number.isFinite(Number(amountInCents))
      ? Math.round(Number(amountInCents))
      : null,
    source
  };

  const bookingPatch = {
    destinationLocation: confirmedExtension.newEndLocation,
    destinationAddress:
      confirmedExtension.newEndLocation?.add ||
      confirmedExtension.newEndLocation?.address ||
      confirmedExtension.newEndLocation?.formattedAddress ||
      '',
    estimatedFare: confirmedExtension.newFare,
    ...(confirmedExtension.routeDistanceKm !== null
      ? { routeDistanceKm: confirmedExtension.routeDistanceKm }
      : {}),
    ...(confirmedExtension.routeDurationSecs !== null
      ? { routeDurationSecs: confirmedExtension.routeDurationSecs }
      : {}),
    activeExtensionRequest: confirmedExtension,
    lastConfirmedExtensionAt: confirmedExtension.paidAt,
    lastExtensionChargeId: chargeId,
    extensionPaymentStatus: 'confirmed'
  };

  await persistBookingPatch(redis, bookingId, bookingPatch);
  await appendJsonHistoryField(redis, bookingId, 'extensionHistory', confirmedExtension, 20);

  const passengerId =
    context.bookingHash.customerId ||
    context.bookingHash.passengerId ||
    context.activeBooking?.customerId ||
    null;
  const driverId =
    context.bookingHash.driverId ||
    context.activeBooking?.driverId ||
    null;

  const payload = {
    success: true,
    bookingId,
    chargeId,
    status: 'CONFIRMED',
    newFare: confirmedExtension.newFare,
    diffFare: confirmedExtension.diffFare,
    destinationLocation: confirmedExtension.newEndLocation,
    routeDistanceKm: confirmedExtension.routeDistanceKm,
    routeDurationSecs: confirmedExtension.routeDurationSecs,
    paidAmountInCents: confirmedExtension.paidAmountInCents,
    message: 'Extensão de corrida confirmada'
  };

  if (io) {
    if (passengerId) {
      io.to(`customer_${passengerId}`).emit('rideExtensionConfirmed', payload);
    }
    if (driverId) {
      io.to(`driver_${driverId}`).emit('rideExtensionConfirmed', payload);
    }
  }

  logStructured('info', 'Extensão de corrida confirmada via pagamento', {
    service: 'ride-lifecycle-service',
    bookingId,
    chargeId,
    passengerId,
    driverId,
    source
  });

  return {
    success: true,
    payload,
    extensionRequest: confirmedExtension
  };
}

async function expirePendingRideExtension({
  redis,
  bookingId,
  chargeId = null,
  io = null,
  source = 'unknown',
  reason = 'PAYMENT_EXPIRED'
}) {
  const context = await loadBookingContext(redis, bookingId);
  if (!context?.bookingHash) {
    return { success: false, skipped: true, reason: 'BOOKING_NOT_FOUND' };
  }

  const extensionRequest = parseJsonMaybe(context.bookingHash.activeExtensionRequest);
  if (!extensionRequest || typeof extensionRequest !== 'object') {
    return { success: false, skipped: true, reason: 'NO_ACTIVE_EXTENSION' };
  }

  if (
    chargeId &&
    String(extensionRequest.chargeId || '').trim() &&
    String(extensionRequest.chargeId || '').trim() !== String(chargeId || '').trim()
  ) {
    return { success: false, skipped: true, reason: 'CHARGE_MISMATCH' };
  }

  if (extensionRequest.status === 'CONFIRMED') {
    return { success: false, skipped: true, reason: 'ALREADY_CONFIRMED' };
  }

  if (extensionRequest.status === 'EXPIRED') {
    return { success: true, skipped: true, reason: 'ALREADY_EXPIRED', extensionRequest };
  }

  const expiredAt = new Date().toISOString();
  const expiredExtension = {
    ...extensionRequest,
    status: 'EXPIRED',
    expiredAt,
    expiryReason: String(reason || 'PAYMENT_EXPIRED').trim().toUpperCase(),
    source
  };

  await persistBookingPatch(redis, bookingId, {
    activeExtensionRequest: expiredExtension,
    extensionPaymentStatus: 'expired',
    lastExpiredExtensionAt: expiredAt
  });
  await appendJsonHistoryField(redis, bookingId, 'extensionHistory', expiredExtension, 20);

  const passengerId =
    context.bookingHash.customerId ||
    context.bookingHash.passengerId ||
    context.activeBooking?.customerId ||
    null;
  const driverId =
    context.bookingHash.driverId ||
    context.activeBooking?.driverId ||
    null;

  const payload = {
    success: true,
    bookingId,
    chargeId: expiredExtension.chargeId || chargeId || null,
    status: 'EXPIRED',
    expiresAt: expiredExtension.expiresAt || null,
    expiredAt,
    diffFare: roundMoney(expiredExtension.diffFare || 0),
    newFare: roundMoney(expiredExtension.newFare || 0),
    destinationLocation: expiredExtension.newEndLocation || null,
    reason: expiredExtension.expiryReason,
    message: 'O tempo para pagamento do complemento expirou. A corrida segue com o destino original.'
  };

  if (io) {
    if (passengerId) {
      io.to(`customer_${passengerId}`).emit('rideExtensionExpired', payload);
    }
    if (driverId) {
      io.to(`driver_${driverId}`).emit('rideExtensionExpired', payload);
    }
  }

  logStructured('info', 'Extensão de corrida expirada', {
    service: 'ride-lifecycle-service',
    bookingId,
    chargeId: payload.chargeId,
    passengerId,
    driverId,
    source,
    reason: payload.reason
  });

  return {
    success: true,
    payload,
    extensionRequest: expiredExtension
  };
}

module.exports = {
  toFiniteNumber,
  roundMoney,
  resolveRideExtensionPaymentTimeoutSec,
  buildRideExtensionExpiresAt,
  isIsoDateExpired,
  parseJsonMaybe,
  normalizeLocation,
  parseMoneyValue,
  resolvePrepaidAmount,
  resolveContractualFare,
  loadBookingContext,
  persistBookingPatch,
  appendJsonHistoryField,
  calculateProgressRatio,
  calculateExecutedFareSettlement,
  calculateRiderEarlyEndSettlement,
  calculateOperationalInterruptionSettlement,
  resolveRideLegs,
  resolveOperationalContinuation,
  sumRideLegGrossFare,
  buildRideLegSettlement,
  buildOperationalInterruptionRecord,
  buildContinuationRideLeg,
  buildExtensionRequest,
  applyConfirmedRideExtension,
  expirePendingRideExtension
};

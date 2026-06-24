const crypto = require('crypto');

const DEFAULT_QUOTE_LOCK_TTL_SECONDS = 120;
const QUOTE_LOCK_KEY_PREFIX = 'pricing:quote-lock';

function getQuoteLockTtlSeconds() {
  const configured = Number.parseInt(process.env.PRICING_QUOTE_LOCK_TTL_SECONDS || '', 10);
  return Math.max(30, Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_QUOTE_LOCK_TTL_SECONDS);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCarType(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(
    typeof value === 'string' ? value.replace(',', '.') : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMoneyReais(value, fallback = 0) {
  const parsed = normalizeNumber(value, fallback);
  return Number(Math.max(0, parsed || 0).toFixed(2));
}

function normalizeAmountCents(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function moneyReaisToCents(value) {
  return normalizeAmountCents(normalizeMoneyReais(value) * 100);
}

function normalizeLocation(location = {}) {
  const lat = normalizeNumber(location?.lat ?? location?.latitude, NaN);
  const lng = normalizeNumber(location?.lng ?? location?.longitude, NaN);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    add: normalizeText(location.add || location.address || location.name)
  };
}

function buildRouteSignature({
  pickupLocation,
  destinationLocation,
  carType,
  precision = 5
} = {}) {
  const pickup = normalizeLocation(pickupLocation);
  const destination = normalizeLocation(destinationLocation);
  if (!pickup || !destination) {
    return '';
  }

  return [
    pickup.lat.toFixed(precision),
    pickup.lng.toFixed(precision),
    destination.lat.toFixed(precision),
    destination.lng.toFixed(precision),
    normalizeCarType(carType)
  ].join('|');
}

function buildQuoteLockRedisKey(quoteLockId) {
  return `${QUOTE_LOCK_KEY_PREFIX}:${normalizeText(quoteLockId)}`;
}

function createQuoteLockId({ quoteSessionId = '', passengerId = '' } = {}) {
  const entropy = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .createHash('sha256')
    .update([
      'leaf_quote_lock',
      normalizeText(quoteSessionId),
      normalizeText(passengerId),
      Date.now(),
      entropy
    ].join(':'))
    .digest('hex')
    .slice(0, 32);
  return `ql_${hash}`;
}

function buildQuoteLockPayload({
  quoteLockId,
  quoteSessionId = null,
  passengerId = null,
  pickupLocation,
  destinationLocation,
  carType,
  estimatedFare,
  grossEstimatedFare,
  passengerPayableFare,
  discountBenefit = null,
  routeDistanceKm = 0,
  routeDurationSecs = 0,
  tollFee = 0,
  rateCardVersion = null,
  pricingPayload = null,
  pricingAudit = null,
  ttlSeconds = getQuoteLockTtlSeconds(),
  nowMs = Date.now()
} = {}) {
  const payableFare = normalizeMoneyReais(passengerPayableFare ?? estimatedFare);
  const grossFare = normalizeMoneyReais(grossEstimatedFare ?? estimatedFare ?? payableFare);
  const expiresAtMs = nowMs + ttlSeconds * 1000;

  return {
    quoteLockId,
    quoteSessionId: normalizeText(quoteSessionId) || null,
    passengerId: normalizeText(passengerId) || null,
    routeSignature: buildRouteSignature({ pickupLocation, destinationLocation, carType }),
    pickupLocation: normalizeLocation(pickupLocation),
    destinationLocation: normalizeLocation(destinationLocation),
    carType: normalizeText(carType) || null,
    estimatedFare: payableFare,
    passengerPayableFare: payableFare,
    grossEstimatedFare: grossFare,
    payableAmountInCents: moneyReaisToCents(payableFare),
    grossAmountInCents: moneyReaisToCents(grossFare),
    discountBenefit: discountBenefit || null,
    routeDistanceKm: normalizeNumber(routeDistanceKm, 0) || 0,
    routeDurationSecs: normalizeNumber(routeDurationSecs, 0) || 0,
    tollFee: normalizeMoneyReais(tollFee, 0),
    rateCardVersion: normalizeText(rateCardVersion) || null,
    quoteVersion: normalizeText(rateCardVersion) || 'v1',
    pricingPayload: pricingPayload || null,
    pricingAudit: pricingAudit || null,
    createdAtIso: new Date(nowMs).toISOString(),
    expiresAtIso: new Date(expiresAtMs).toISOString(),
    expiresAtMs
  };
}

async function createQuoteLock({
  redis,
  ttlSeconds = getQuoteLockTtlSeconds(),
  ...payload
} = {}) {
  if (!redis || typeof redis.set !== 'function') {
    return {
      success: false,
      code: 'QUOTE_LOCK_STORE_UNAVAILABLE',
      error: 'Quote lock store unavailable'
    };
  }

  const quoteLockId = payload.quoteLockId || createQuoteLockId(payload);
  const lock = buildQuoteLockPayload({
    ...payload,
    quoteLockId,
    ttlSeconds
  });

  try {
    await redis.set(buildQuoteLockRedisKey(quoteLockId), JSON.stringify(lock), 'EX', ttlSeconds);
    return {
      success: true,
      quoteLockId,
      quoteLock: lock,
      ttlSeconds,
      expiresAtIso: lock.expiresAtIso
    };
  } catch (error) {
    return {
      success: false,
      code: 'QUOTE_LOCK_WRITE_FAILED',
      error: error.message
    };
  }
}

async function readQuoteLock({ redis, quoteLockId } = {}) {
  if (!redis || typeof redis.get !== 'function') {
    return {
      success: false,
      code: 'QUOTE_LOCK_STORE_UNAVAILABLE',
      error: 'Quote lock store unavailable'
    };
  }

  const safeQuoteLockId = normalizeText(quoteLockId);
  if (!safeQuoteLockId) {
    return {
      success: false,
      code: 'QUOTE_LOCK_REQUIRED',
      error: 'Quote lock id required'
    };
  }

  const raw = await redis.get(buildQuoteLockRedisKey(safeQuoteLockId));
  if (!raw) {
    return {
      success: false,
      code: 'QUOTE_LOCK_NOT_FOUND_OR_EXPIRED',
      error: 'Quote lock not found or expired'
    };
  }

  try {
    const quoteLock = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      success: true,
      quoteLock
    };
  } catch (error) {
    return {
      success: false,
      code: 'QUOTE_LOCK_INVALID',
      error: 'Quote lock payload invalid'
    };
  }
}

async function validateQuoteLock({
  redis,
  quoteLockId,
  quoteSessionId = null,
  passengerId = null,
  amountInCents,
  grossAmountInCents = null,
  pickupLocation = null,
  destinationLocation = null,
  carType = null,
  toleranceInCents = 1,
  nowMs = Date.now()
} = {}) {
  const readResult = await readQuoteLock({ redis, quoteLockId });
  if (!readResult.success) {
    return readResult;
  }

  const quoteLock = readResult.quoteLock || {};
  const expiresAtMs = Number(quoteLock.expiresAtMs || Date.parse(quoteLock.expiresAtIso || ''));
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
    return {
      success: false,
      code: 'QUOTE_LOCK_EXPIRED',
      error: 'Quote lock expired',
      quoteLock
    };
  }

  const expectedSessionId = normalizeText(quoteLock.quoteSessionId);
  const incomingSessionId = normalizeText(quoteSessionId);
  if (expectedSessionId && incomingSessionId && expectedSessionId !== incomingSessionId) {
    return {
      success: false,
      code: 'QUOTE_LOCK_SESSION_MISMATCH',
      error: 'Quote lock session mismatch',
      quoteLock
    };
  }

  const expectedPassengerId = normalizeText(quoteLock.passengerId);
  const incomingPassengerId = normalizeText(passengerId);
  if (expectedPassengerId && incomingPassengerId && expectedPassengerId !== incomingPassengerId) {
    return {
      success: false,
      code: 'QUOTE_LOCK_PASSENGER_MISMATCH',
      error: 'Quote lock passenger mismatch',
      quoteLock
    };
  }

  const expectedAmountInCents = normalizeAmountCents(
    quoteLock.payableAmountInCents || moneyReaisToCents(quoteLock.passengerPayableFare || quoteLock.estimatedFare)
  );
  const incomingAmountInCents = normalizeAmountCents(amountInCents, -1);
  const safeTolerance = Math.max(0, normalizeAmountCents(toleranceInCents, 1));
  if (
    expectedAmountInCents > 0 &&
    incomingAmountInCents > 0 &&
    Math.abs(expectedAmountInCents - incomingAmountInCents) > safeTolerance
  ) {
    return {
      success: false,
      code: 'QUOTE_LOCK_AMOUNT_MISMATCH',
      error: 'Quote lock amount mismatch',
      expectedAmountInCents,
      incomingAmountInCents,
      quoteLock
    };
  }

  const expectedGrossAmountInCents = normalizeAmountCents(
    quoteLock.grossAmountInCents || moneyReaisToCents(quoteLock.grossEstimatedFare)
  );
  const incomingGrossAmountInCents = normalizeAmountCents(grossAmountInCents, 0);
  if (
    expectedGrossAmountInCents > 0 &&
    incomingGrossAmountInCents > 0 &&
    Math.abs(expectedGrossAmountInCents - incomingGrossAmountInCents) > safeTolerance
  ) {
    return {
      success: false,
      code: 'QUOTE_LOCK_GROSS_AMOUNT_MISMATCH',
      error: 'Quote lock gross amount mismatch',
      expectedGrossAmountInCents,
      incomingGrossAmountInCents,
      quoteLock
    };
  }

  const incomingRouteSignature = buildRouteSignature({
    pickupLocation,
    destinationLocation,
    carType
  });
  if (quoteLock.routeSignature && incomingRouteSignature && quoteLock.routeSignature !== incomingRouteSignature) {
    return {
      success: false,
      code: 'QUOTE_LOCK_ROUTE_MISMATCH',
      error: 'Quote lock route mismatch',
      quoteLock
    };
  }

  return {
    success: true,
    quoteLock,
    expectedAmountInCents,
    payableAmountInCents: expectedAmountInCents,
    grossAmountInCents: expectedGrossAmountInCents
  };
}

module.exports = {
  buildQuoteLockPayload,
  buildQuoteLockRedisKey,
  buildRouteSignature,
  createQuoteLock,
  createQuoteLockId,
  getQuoteLockTtlSeconds,
  moneyReaisToCents,
  normalizeAmountCents,
  normalizeLocation,
  readQuoteLock,
  validateQuoteLock
};

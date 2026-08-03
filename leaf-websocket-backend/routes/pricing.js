const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const fareEstimationService = require('../services/fare-estimation-service');
const passengerDiscountBenefitService = require('../services/passenger-discount-benefit-service');
const { getPublicRateCards, RATE_CARD_VERSION } = require('../services/pricing/calculateFare');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const geofenceService = require('../services/geofence-service');
const { hasPaymentEligibleDriver } = require('../services/payment-driver-availability-guard');
const routeTollService = require('../services/route-toll-service');
const placesCacheService = require('../services/places-cache-service');
const { normalizeOperationalCarType } = require('../utils/operational-car-type');
const {
  createQuoteLock,
  getQuoteLockTtlSeconds
} = require('../services/quote-lock-service');

const router = express.Router();
const MAX_OPERATIONAL_ROUTE_DISTANCE_KM = Math.max(
  80,
  Number.parseFloat(process.env.PRICING_MAX_OPERATIONAL_ROUTE_DISTANCE_KM || '120') || 120
);
const QUOTE_SESSION_COUNTER_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.PRICING_QUOTE_SESSION_COUNTER_TTL_SECONDS || '900', 10) || 900
);
const PUBLIC_QUOTE_LOCK_MAX_TTL_SECONDS = 120;
const MAX_QUOTE_REQUESTS_PER_CATEGORY_SESSION = 3;
const QUOTE_SESSION_ROUTE_KEY_PREFIX = 'pricing:quote-session-route';
const INCREMENT_QUOTE_SESSION_COUNTER_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function shouldRequireQuoteLockForPayment() {
  const configured = process.env.REQUIRE_PAYMENT_QUOTE_LOCK;
  if (configured !== undefined) {
    return String(configured).toLowerCase() === 'true';
  }
  return process.env.NODE_ENV !== 'test';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(
    typeof value === 'string'
      ? value.replace(',', '.')
      : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'sim'].includes(String(value).trim().toLowerCase());
}

function hasCoordinate(location = {}) {
  const latRaw = location?.lat;
  const lngRaw = location?.lng;
  if (latRaw === null || latRaw === undefined || latRaw === '') {
    return false;
  }
  if (lngRaw === null || lngRaw === undefined || lngRaw === '') {
    return false;
  }
  return Number.isFinite(toNumber(latRaw, NaN)) && Number.isFinite(toNumber(lngRaw, NaN));
}

function hasCanonicalRouteGeometry(route = {}) {
  const coordinates = routeTollService.decodePolyline(route?.polylinePoints || '');
  return coordinates.length >= 2 && coordinates.every((coordinate) => (
    Number.isFinite(Number(coordinate?.latitude)) &&
    Number.isFinite(Number(coordinate?.longitude))
  ));
}

function normalizeQuoteSessionId(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 96);
  return normalized || '';
}

function resolveQuoteSessionId(req, body = {}) {
  return normalizeQuoteSessionId(
    req.headers['x-leaf-quote-session-id'] ||
      req.headers['x-quote-session-id'] ||
      body.quoteSessionId ||
      body.quote_session_id ||
      ''
  );
}

function buildQuoteSessionRouteKey(quoteSessionId) {
  return `${QUOTE_SESSION_ROUTE_KEY_PREFIX}:${quoteSessionId}`;
}

function buildQuoteSessionRouteSignature(pickupLocation, destinationLocation) {
  return [
    Number(pickupLocation?.lat).toFixed(5),
    Number(pickupLocation?.lng).toFixed(5),
    Number(destinationLocation?.lat).toFixed(5),
    Number(destinationLocation?.lng).toFixed(5)
  ].join('|');
}

function buildQuoteSessionCanonicalRouteSnapshot(canonicalRoute = {}) {
  return {
    distance_in_km: toNumber(canonicalRoute.distance_in_km, 0),
    time_in_secs: toNumber(canonicalRoute.time_in_secs, 0),
    duration_in_traffic: toNumber(
      canonicalRoute.duration_in_traffic ?? canonicalRoute.time_in_secs,
      0
    ),
    polylinePoints: String(canonicalRoute.polylinePoints || '').slice(0, 100000),
    trafficSegments: Array.isArray(canonicalRoute.trafficSegments)
      ? canonicalRoute.trafficSegments.slice(0, 80)
      : [],
    tollFee: Math.max(0, toNumber(canonicalRoute.tollFee, 0))
  };
}

async function persistQuoteSessionRoute({
  redis,
  quoteSessionId,
  pickupLocation,
  destinationLocation,
  canonicalRoute
}) {
  if (!quoteSessionId || !redis || typeof redis.set !== 'function') {
    return;
  }

  const payload = {
    routeSignature: buildQuoteSessionRouteSignature(
      pickupLocation,
      destinationLocation
    ),
    canonicalRoute: buildQuoteSessionCanonicalRouteSnapshot(canonicalRoute)
  };

  try {
    await redis.set(
      buildQuoteSessionRouteKey(quoteSessionId),
      JSON.stringify(payload),
      'EX',
      QUOTE_SESSION_COUNTER_TTL_SECONDS,
      'NX'
    );
  } catch (error) {
    logStructured('warn', 'Falha ao persistir rota canônica da sessão de quote', {
      service: 'pricing-routes',
      operation: 'pricing_quote_session_route_write',
      quoteSessionId,
      error: error.message
    });
  }
}

async function readQuoteSessionRoute({
  redis,
  quoteSessionId,
  pickupLocation,
  destinationLocation
}) {
  if (!quoteSessionId || !redis || typeof redis.get !== 'function') {
    return null;
  }

  try {
    const raw = await redis.get(buildQuoteSessionRouteKey(quoteSessionId));
    if (!raw) {
      return null;
    }
    const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const expectedSignature = buildQuoteSessionRouteSignature(
      pickupLocation,
      destinationLocation
    );
    if (payload?.routeSignature !== expectedSignature) {
      return null;
    }
    return payload?.canonicalRoute || null;
  } catch (error) {
    logStructured('warn', 'Falha ao ler rota canônica da sessão de quote', {
      service: 'pricing-routes',
      operation: 'pricing_quote_session_route_read',
      quoteSessionId,
      error: error.message
    });
    return null;
  }
}

async function incrementQuoteSessionCounter(redis, quoteSessionId, carType) {
  if (!quoteSessionId) {
    return { success: true, count: null };
  }

  if (!redis || typeof redis.eval !== 'function') {
    return { success: false, count: null };
  }

  const categoryKey = normalizeOperationalCarType(carType, 'unknown');
  const key = `pricing:quote-session:${quoteSessionId}:${categoryKey}`;
  try {
    const count = Number(await redis.eval(
      INCREMENT_QUOTE_SESSION_COUNTER_SCRIPT,
      1,
      key,
      String(QUOTE_SESSION_COUNTER_TTL_SECONDS)
    ));
    return {
      success: Number.isFinite(count) && count > 0,
      count: Number.isFinite(count) && count > 0 ? count : null
    };
  } catch (error) {
    logStructured('warn', 'Falha ao incrementar contador temporário de quote', {
      service: 'pricing-routes',
      operation: 'pricing_quote_session_counter',
      quoteSessionId,
      error: error.message
    });
    return { success: false, count: null };
  }
}

async function resolveQuoteDriverAvailability({
  redis,
  io,
  pickupLocation,
  destinationLocation,
  carType,
  quoteSessionId,
  quoteLockId,
  passengerId
}) {
  const availability = await hasPaymentEligibleDriver({
    redis,
    io,
    pickupLocation,
    destinationLocation,
    carType,
    reserveDriver: false,
    reservationContext: {
      passengerId,
      quoteSessionId,
      quoteLockId
    },
    logStructured,
    logContext: {
      service: 'pricing-routes',
      operation: 'pricing_quote_driver_availability',
      quoteSessionId: quoteSessionId || null
    }
  });

  if (!availability?.success) {
    return {
      status: 'unknown',
      hasDrivers: null,
      code: availability?.code || 'DRIVER_AVAILABILITY_UNKNOWN',
      pickupEtaMin: null,
      radiusKm: availability?.radiusKm || null,
      source: 'payment_driver_availability_guard'
    };
  }

  return {
    status: availability.hasDrivers ? 'available' : 'unavailable',
    hasDrivers: Boolean(availability.hasDrivers),
    code: availability.code || (availability.hasDrivers ? 'DRIVERS_AVAILABLE' : 'NO_DRIVERS_AVAILABLE'),
    pickupEtaMin: Number.isFinite(Number(availability.estimatedPickupEtaMin))
      ? Number(availability.estimatedPickupEtaMin)
      : null,
    driverDistanceKm: Number.isFinite(Number(availability.driverDistanceKm))
      ? Number(availability.driverDistanceKm)
      : null,
    candidates: Number.isFinite(Number(availability.candidates))
      ? Number(availability.candidates)
      : 0,
    eligible: Number.isFinite(Number(availability.eligible))
      ? Number(availability.eligible)
      : 0,
    radiusKm: Number.isFinite(Number(availability.radiusKm))
      ? Number(availability.radiusKm)
      : null,
    source: 'payment_driver_availability_guard'
  };
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

async function resolveOptionalFirebaseUserId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';

  try {
    const decoded = await admin.auth().verifyIdToken(header.slice('Bearer '.length).trim());
    return String(decoded?.uid || '').trim();
  } catch (_error) {
    return '';
  }
}

function resolveQuoteLockTtlPolicy() {
  return {
    ttlSeconds: Math.min(
      getQuoteLockTtlSeconds(),
      PUBLIC_QUOTE_LOCK_MAX_TTL_SECONDS
    ),
    reason: 'default'
  };
}

router.get('/pricing/categories', (_req, res) => {
  return res.json({
    success: true,
    version: RATE_CARD_VERSION,
    categories: getPublicRateCards()
  });
});

router.post('/pricing/quote', async (req, res) => {
  const body = req.body || {};
  const pickupLocation = body.pickupLocation || body.pickup || {};
  const destinationLocation = body.destinationLocation || body.destination || body.drop || {};
  const quoteSessionId = resolveQuoteSessionId(req, body);

  if (!hasCoordinate(pickupLocation) || !hasCoordinate(destinationLocation)) {
    metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
    return res.status(400).json({
      error: 'pickup_and_destination_required',
      message: 'Pickup e destino com lat/lng válidos são obrigatórios.'
    });
  }

  const normalizedPickupLocation = {
    ...pickupLocation,
    lat: toNumber(pickupLocation.lat, NaN),
    lng: toNumber(pickupLocation.lng, NaN)
  };
  const normalizedDestinationLocation = {
    ...destinationLocation,
    lat: toNumber(destinationLocation.lat, NaN),
    lng: toNumber(destinationLocation.lng, NaN)
  };

  if (geofenceService.isActive()) {
    const geofenceValidation = geofenceService.validateRideLocations(
      normalizedPickupLocation,
      normalizedDestinationLocation
    );
    if (!geofenceValidation.valid) {
      metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
      return res.status(422).json({
        error: geofenceValidation.code || 'route_out_of_coverage',
        code: geofenceValidation.code || 'ROUTE_OUT_OF_COVERAGE',
        retryable: geofenceValidation.retryable === true,
        message: geofenceValidation.error || 'Origem ou destino fora da área de operação da Leaf.'
      });
    }
  }

  const straightDistanceKm = haversineDistanceKm(
    normalizedPickupLocation.lat,
    normalizedPickupLocation.lng,
    normalizedDestinationLocation.lat,
    normalizedDestinationLocation.lng
  );
  if (Number.isFinite(straightDistanceKm) && straightDistanceKm > MAX_OPERATIONAL_ROUTE_DISTANCE_KM) {
    metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
    return res.status(422).json({
      error: 'route_distance_exceeds_limit',
      message: 'Destino fora da área de cobertura operacional da Leaf.',
      maxOperationalDistanceKm: MAX_OPERATIONAL_ROUTE_DISTANCE_KM
    });
  }

  try {
    const redis = redisPool.getConnection();
    const canonicalRouteResult = await placesCacheService.fetchDirectionsRoute({
      startLoc: `${normalizedPickupLocation.lat},${normalizedPickupLocation.lng}`,
      destLoc: `${normalizedDestinationLocation.lat},${normalizedDestinationLocation.lng}`,
      trafficEnabled: toBoolean(process.env.ENABLE_TRAFFIC_AWARE_ROUTES, true),
      alternativesEnabled: false,
      cacheOnly: true
    });
    let canonicalRoute = canonicalRouteResult?.data || null;
    let canonicalRouteSource = 'directions_cache';
    let canonicalRouteDistanceKm = toNumber(canonicalRoute?.distance_in_km, 0);
    let canonicalRouteDurationSecs = toNumber(
      canonicalRoute?.duration_in_traffic ?? canonicalRoute?.time_in_secs,
      0
    );
    let hasCanonicalRoute = Boolean(
      canonicalRoute &&
      hasCanonicalRouteGeometry(canonicalRoute) &&
      canonicalRouteDistanceKm > 0 &&
      canonicalRouteDurationSecs > 0
    );

    if (!hasCanonicalRoute) {
      canonicalRoute = await readQuoteSessionRoute({
        redis,
        quoteSessionId,
        pickupLocation: normalizedPickupLocation,
        destinationLocation: normalizedDestinationLocation
      });
      canonicalRouteDistanceKm = toNumber(canonicalRoute?.distance_in_km, 0);
      canonicalRouteDurationSecs = toNumber(
        canonicalRoute?.duration_in_traffic ?? canonicalRoute?.time_in_secs,
        0
      );
      hasCanonicalRoute = Boolean(
        canonicalRoute &&
        hasCanonicalRouteGeometry(canonicalRoute) &&
        canonicalRouteDistanceKm > 0 &&
        canonicalRouteDurationSecs > 0
      );
      canonicalRouteSource = hasCanonicalRoute ? 'quote_session' : 'unavailable';
    }

    if (!hasCanonicalRoute) {
      metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
      return res.status(503).json({
        error: 'canonical_route_required',
        code: 'CANONICAL_ROUTE_REQUIRED',
        retryable: true,
        message: 'Rota canônica indisponível para cotação. Atualize a rota e tente novamente.'
      });
    }

    if (canonicalRouteSource === 'directions_cache') {
      await persistQuoteSessionRoute({
        redis,
        quoteSessionId,
        pickupLocation: normalizedPickupLocation,
        destinationLocation: normalizedDestinationLocation,
        canonicalRoute
      });
    }

    const quoteSessionCounter = await incrementQuoteSessionCounter(
      redis,
      quoteSessionId,
      body.carType
    );
    if (!quoteSessionCounter.success) {
      metrics.recordPricingQuoteRequest?.({ success: false, source: 'session' });
      return res.status(503).json({
        error: 'quote_refresh_guard_unavailable',
        code: 'QUOTE_REFRESH_GUARD_UNAVAILABLE',
        retryable: true,
        message: 'Não foi possível validar a cotação agora. Tente novamente em instantes.'
      });
    }

    const quoteRequestCount = quoteSessionCounter.count;
    if (
      Number.isFinite(quoteRequestCount) &&
      quoteRequestCount > MAX_QUOTE_REQUESTS_PER_CATEGORY_SESSION
    ) {
      metrics.recordPricingQuoteRequest?.({ success: false, source: 'session' });
      return res.status(409).json({
        error: 'quote_refresh_limit_reached',
        code: 'QUOTE_REFRESH_LIMIT_REACHED',
        retryable: false,
        requiresUserAction: true,
        maxAutomaticRefreshes: MAX_QUOTE_REQUESTS_PER_CATEGORY_SESSION - 1,
        message: 'Preço expirado. Atualize a cotação para continuar.'
      });
    }

    const canonicalPricingPayload = {
      routePolyline: canonicalRoute.polylinePoints,
      polylinePoints: canonicalRoute.polylinePoints,
      routeDetails: canonicalRoute
    };
    const tollEstimate = routeTollService.resolveTollFeeFromPricingPayload(
      canonicalPricingPayload
    );
    const result = await fareEstimationService.estimateRideFare({
      redis,
      pickupLocation: normalizedPickupLocation,
      destinationLocation: normalizedDestinationLocation,
      carType: body.carType,
      routeDistanceKm: canonicalRouteDistanceKm,
      routeDurationSecs: canonicalRouteDurationSecs,
      tollFee: tollEstimate.tollFee,
      clientEstimatedFare: body.clientEstimatedFare,
      pricingContext: null
    });

    const passengerId =
      String(body.passengerId || body.customerId || '').trim() ||
      (await resolveOptionalFirebaseUserId(req));
    const grossAmountInCents = Math.max(0, Math.round(Number(result.estimatedFare || 0) * 100));
    const discountPreview = await passengerDiscountBenefitService.previewDiscount({
      userId: passengerId,
      grossAmountCents: grossAmountInCents,
      benefitId: body.discountBenefitId || body.benefitId || ''
    });
    const estimatedFare = discountPreview.applied
      ? discountPreview.payableFare
      : result.estimatedFare;
    const quoteLockTtlPolicy = resolveQuoteLockTtlPolicy();

    const quoteLockResult = await createQuoteLock({
      redis,
      quoteSessionId,
      passengerId,
      pickupLocation: normalizedPickupLocation,
      destinationLocation: normalizedDestinationLocation,
      carType: result.normalizedCarType,
      estimatedFare,
      grossEstimatedFare: result.estimatedFare,
      passengerPayableFare: estimatedFare,
      discountBenefit: discountPreview.applied ? discountPreview : null,
      routeDistanceKm: result.routeMetrics?.distanceKm || 0,
      routeDurationSecs: result.routeMetrics?.durationSecs || 0,
      routePolyline: canonicalRoute.polylinePoints,
      trafficSegments: canonicalRoute.trafficSegments || [],
      tollFee: result.tollFee || 0,
      rateCardVersion: result.rateCardVersion,
      pricingPayload: result.pricingPayload || null,
      pricingAudit: result.pricingAudit || null,
      ttlSeconds: quoteLockTtlPolicy.ttlSeconds
    });

    if (!quoteLockResult.success && shouldRequireQuoteLockForPayment()) {
      metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
      logStructured('error', 'Falha ao criar quote lock obrigatório', {
        service: 'pricing-routes',
        operation: 'pricing_quote_lock',
        quoteSessionId: quoteSessionId || null,
        code: quoteLockResult.code,
        error: quoteLockResult.error
      });
      return res.status(503).json({
        error: 'quote_lock_unavailable',
        message: 'Não foi possível travar a cotação agora. Tente novamente em instantes.',
        code: quoteLockResult.code || 'QUOTE_LOCK_UNAVAILABLE'
      });
    }

    const driverAvailability = await resolveQuoteDriverAvailability({
      redis,
      io: req.app.get('io'),
      pickupLocation: normalizedPickupLocation,
      destinationLocation: normalizedDestinationLocation,
      carType: result.normalizedCarType,
      quoteSessionId,
      quoteLockId: quoteLockResult.success ? quoteLockResult.quoteLockId : null,
      passengerId
    });

    metrics.recordPricingQuoteRequest?.({ success: true, source: quoteSessionId ? 'session' : 'anonymous' });

    if (quoteSessionId) {
      res.set('X-Leaf-Quote-Session-Id', quoteSessionId);
    }
    if (quoteRequestCount) {
      res.set('X-Leaf-Quote-Session-Count', String(quoteRequestCount));
    }
    res.set('X-Leaf-Quote-Route-Source', canonicalRouteSource);

    logStructured('info', 'Quote dinâmico calculado', {
      service: 'pricing-routes',
      operation: 'pricing_quote',
      quoteSessionId: quoteSessionId || null,
      quoteRequestCount: quoteRequestCount || null,
      canonicalRouteSource,
      carType: result.normalizedCarType,
      estimatedFare,
      quoteLockTtlSeconds: quoteLockResult.success ? quoteLockResult.ttlSeconds : null,
      quoteLockTtlReason: quoteLockTtlPolicy.reason,
      tollFee: result.tollFee || 0,
      tollDetectionSource: tollEstimate.source || null,
      driverAvailabilityStatus: driverAvailability.status,
      driverAvailabilityCode: driverAvailability.code
    });

    return res.json({
      quoteSessionId: quoteSessionId || null,
      quoteLockId: quoteLockResult.success ? quoteLockResult.quoteLockId : null,
      quoteLockExpiresAt: quoteLockResult.success ? quoteLockResult.expiresAtIso : null,
      quoteLockTtlSeconds: quoteLockResult.success ? quoteLockResult.ttlSeconds : null,
      quoteRequestCount: quoteRequestCount || null,
      canonicalRouteSource,
      estimatedFare,
      grossEstimatedFare: result.estimatedFare,
      passengerPayableFare: estimatedFare,
      discountBenefit: discountPreview.applied ? discountPreview : null,
      carType: result.normalizedCarType,
      rateCardVersion: result.rateCardVersion,
      routeDistanceKm: result.routeMetrics?.distanceKm || 0,
      routeDurationSecs: result.routeMetrics?.durationSecs || 0,
      tollFee: result.tollFee || 0,
      tolls: tollEstimate.tolls || [],
      tollDetection: {
        source: tollEstimate.source || null,
        toleranceKm: tollEstimate.toleranceKm || null,
        tollCount: tollEstimate.tollCount || 0
      },
      pricingPayload: result.pricingPayload || null,
      pricingAudit: result.pricingAudit || null,
      driverAvailability,
      operationalState: result.operationalState || 'NORMAL',
      scorePressao: result.scorePressao || 0,
      scoreExcecao: result.scoreExcecao || 0,
      exceptionalMode: result.exceptionalMode || null
    });
  } catch (error) {
    metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
    metrics.recordPricingEvaluation({
      success: false,
      operationalState: 'UNKNOWN',
      baselineSource: 'unavailable',
      dynamicApplied: false,
      minimumFareApplied: false,
      scorePressao: 0,
      scoreExcecao: 0
    });

    logStructured('error', 'Falha ao calcular quote dinâmico', {
      service: 'pricing-routes',
      operation: 'pricing_quote',
      error: error.message
    });

    return res.status(500).json({
      error: 'pricing_quote_failed',
      message: 'Não foi possível calcular a cotação dinâmica agora.'
    });
  }
});

module.exports = router;

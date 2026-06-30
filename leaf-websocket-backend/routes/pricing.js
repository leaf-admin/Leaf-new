const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const fareEstimationService = require('../services/fare-estimation-service');
const passengerDiscountBenefitService = require('../services/passenger-discount-benefit-service');
const paymentRuntimeProfileService = require('../services/payment-runtime-profile-service');
const { getPublicRateCards, RATE_CARD_VERSION } = require('../services/pricing/calculateFare');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const geofenceService = require('../services/geofence-service');
const { hasPaymentEligibleDriver } = require('../services/payment-driver-availability-guard');
const routeTollService = require('../services/route-toll-service');
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

function isSandboxQuoteLockTtlExtensionEnabled() {
  return String(process.env.PRICING_SANDBOX_LONG_QUOTE_LOCK_TTL || 'true').toLowerCase() !== 'false';
}

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

function hasRouteGeometry(payload = {}) {
  const polyline = String(
    payload.routePolyline ||
      payload.polylinePoints ||
      payload.encodedPolyline ||
      payload.routeDetails?.polylinePoints ||
      payload.route?.polylinePoints ||
      ''
  ).trim();
  if (polyline.length > 0) {
    return true;
  }

  const coordinates =
    payload.routeCoordinates ||
    payload.route?.coordinates ||
    payload.routeDetails?.coordinates ||
    [];
  return Array.isArray(coordinates) && coordinates.filter(hasCoordinate).length >= 2;
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

async function incrementQuoteSessionCounter(redis, quoteSessionId) {
  if (!redis || !quoteSessionId || typeof redis.incr !== 'function') {
    return null;
  }

  const key = `pricing:quote-session:${quoteSessionId}`;
  try {
    const count = Number(await redis.incr(key));
    if (typeof redis.expire === 'function') {
      await redis.expire(key, QUOTE_SESSION_COUNTER_TTL_SECONDS);
    }
    return Number.isFinite(count) && count > 0 ? count : null;
  } catch (error) {
    logStructured('warn', 'Falha ao incrementar contador temporário de quote', {
      service: 'pricing-routes',
      operation: 'pricing_quote_session_counter',
      quoteSessionId,
      error: error.message
    });
    return null;
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

async function resolveQuoteLockTtlPolicy({ passengerId = '', body = {} } = {}) {
  const baseTtlSeconds = getQuoteLockTtlSeconds();
  const safePassengerId = String(passengerId || '').trim();
  if (!safePassengerId) {
    return {
      ttlSeconds: baseTtlSeconds,
      reason: 'default'
    };
  }

  try {
    const paymentProfile = await paymentRuntimeProfileService.resolveProfile({
      passengerId: safePassengerId,
      userId: safePassengerId,
      phone: body.passengerPhone || body.phone || body.phoneNumber,
      phoneNumber: body.passengerPhone || body.phone || body.phoneNumber,
      appReview: String(process.env.APP_REVIEW || '').toLowerCase() === 'true'
    });
    if (
      isSandboxQuoteLockTtlExtensionEnabled() &&
      String(paymentProfile?.environment || '').toLowerCase() === 'sandbox'
    ) {
      return {
        ttlSeconds: getQuoteLockTtlSeconds({ longLived: true }),
        reason: 'sandbox_payment_profile',
        paymentProfileId: paymentProfile.profileId || null
      };
    }
  } catch (error) {
    logStructured('warn', 'Falha ao resolver perfil de pagamento para TTL da cotação', {
      service: 'pricing-routes',
      operation: 'pricing_quote_lock_ttl_policy',
      passengerId: safePassengerId,
      error: error.message
    });
  }

  return {
    ttlSeconds: baseTtlSeconds,
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

  if (toBoolean(body.requireRouteGeometry, false) && !hasRouteGeometry(body)) {
    metrics.recordPricingQuoteRequest?.({ success: false, source: quoteSessionId ? 'session' : 'anonymous' });
    return res.status(422).json({
      error: 'route_geometry_required',
      message: 'Rota canônica com geometria é obrigatória para cotação.'
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
        error: 'route_out_of_coverage',
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
    const quoteRequestCount = await incrementQuoteSessionCounter(redis, quoteSessionId);
    const tollEstimate = routeTollService.resolveTollFeeFromPricingPayload(body);
    const result = await fareEstimationService.estimateRideFare({
      redis,
      pickupLocation: normalizedPickupLocation,
      destinationLocation: normalizedDestinationLocation,
      carType: body.carType,
      routeDistanceKm: body.routeDistanceKm,
      routeDurationSecs: body.routeDurationSecs,
      tollFee: tollEstimate.tollFee,
      clientEstimatedFare: body.clientEstimatedFare,
      pricingContext: body.pricingContext || body.operational || null
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
    const quoteLockTtlPolicy = await resolveQuoteLockTtlPolicy({
      passengerId,
      body
    });

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

    logStructured('info', 'Quote dinâmico calculado', {
      service: 'pricing-routes',
      operation: 'pricing_quote',
      quoteSessionId: quoteSessionId || null,
      quoteRequestCount: quoteRequestCount || null,
      carType: result.normalizedCarType,
      estimatedFare,
      quoteLockTtlSeconds: quoteLockResult.success ? quoteLockResult.ttlSeconds : null,
      quoteLockTtlReason: quoteLockTtlPolicy.reason,
      paymentProfileId: quoteLockTtlPolicy.paymentProfileId || null,
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

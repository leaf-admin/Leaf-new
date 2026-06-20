const express = require('express');
const admin = require('firebase-admin');
const redisPool = require('../utils/redis-pool');
const fareEstimationService = require('../services/fare-estimation-service');
const passengerDiscountBenefitService = require('../services/passenger-discount-benefit-service');
const { getPublicRateCards, RATE_CARD_VERSION } = require('../services/pricing/calculateFare');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const geofenceService = require('../services/geofence-service');

const router = express.Router();
const MAX_OPERATIONAL_ROUTE_DISTANCE_KM = Math.max(
  80,
  Number.parseFloat(process.env.PRICING_MAX_OPERATIONAL_ROUTE_DISTANCE_KM || '120') || 120
);
const QUOTE_SESSION_COUNTER_TTL_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.PRICING_QUOTE_SESSION_COUNTER_TTL_SECONDS || '900', 10) || 900
);

function toNumber(value, fallback = 0) {
  const parsed = Number(
    typeof value === 'string'
      ? value.replace(',', '.')
      : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
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
    const result = await fareEstimationService.estimateRideFare({
      redis,
      pickupLocation: normalizedPickupLocation,
      destinationLocation: normalizedDestinationLocation,
      carType: body.carType,
      routeDistanceKm: body.routeDistanceKm,
      routeDurationSecs: body.routeDurationSecs,
      tollFee: body.tollFee,
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
      estimatedFare
    });

    return res.json({
      quoteSessionId: quoteSessionId || null,
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
      pricingPayload: result.pricingPayload || null,
      pricingAudit: result.pricingAudit || null,
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

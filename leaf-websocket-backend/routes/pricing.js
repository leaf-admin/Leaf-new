const express = require('express');
const redisPool = require('../utils/redis-pool');
const fareEstimationService = require('../services/fare-estimation-service');
const { getPublicRateCards, RATE_CARD_VERSION } = require('../services/pricing/calculateFare');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const geofenceService = require('../services/geofence-service');

const router = express.Router();
const MAX_OPERATIONAL_ROUTE_DISTANCE_KM = Math.max(
  80,
  Number.parseFloat(process.env.PRICING_MAX_OPERATIONAL_ROUTE_DISTANCE_KM || '120') || 120
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

  if (!hasCoordinate(pickupLocation) || !hasCoordinate(destinationLocation)) {
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
    return res.status(422).json({
      error: 'route_distance_exceeds_limit',
      message: 'Destino fora da área de cobertura operacional da Leaf.',
      maxOperationalDistanceKm: MAX_OPERATIONAL_ROUTE_DISTANCE_KM
    });
  }

  try {
    const redis = redisPool.getConnection();
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

    return res.json({
      estimatedFare: result.estimatedFare,
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

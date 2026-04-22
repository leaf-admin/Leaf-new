const express = require('express');
const redisPool = require('../utils/redis-pool');
const fareEstimationService = require('../services/fare-estimation-service');
const { getPublicRateCards, RATE_CARD_VERSION } = require('../services/pricing/calculateFare');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');

const router = express.Router();

function toNumber(value, fallback = 0) {
  const parsed = Number(
    typeof value === 'string'
      ? value.replace(',', '.')
      : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasCoordinate(location = {}) {
  return Number.isFinite(toNumber(location?.lat, NaN)) && Number.isFinite(toNumber(location?.lng, NaN));
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

  try {
    const redis = redisPool.getConnection();
    const result = await fareEstimationService.estimateRideFare({
      redis,
      pickupLocation,
      destinationLocation,
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

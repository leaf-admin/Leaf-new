const { logStructured } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const { PRICING_CONSTANTS } = require('./pricing/calculateFare');
const { runDynamicPricingEngine } = require('./pricing');
const pricingContextProvider = require('./pricing-context-provider');

const RATE_CARDS = {
  leaf_plus: {
    minFare: PRICING_CONSTANTS.valor_minimo,
    baseFare: PRICING_CONSTANTS.preco_base,
    fixedFee: PRICING_CONSTANTS.taxa_fixa,
    ratePerHour: PRICING_CONSTANTS.valor_min * 60,
    ratePerKm: PRICING_CONSTANTS.valor_km
  },
  leaf_elite: {
    minFare: PRICING_CONSTANTS.valor_minimo,
    baseFare: PRICING_CONSTANTS.preco_base,
    fixedFee: PRICING_CONSTANTS.taxa_fixa,
    ratePerHour: PRICING_CONSTANTS.valor_min * 60,
    ratePerKm: PRICING_CONSTANTS.valor_km
  },
  leaf_moto: {
    minFare: PRICING_CONSTANTS.valor_minimo,
    baseFare: PRICING_CONSTANTS.preco_base,
    fixedFee: PRICING_CONSTANTS.taxa_fixa,
    ratePerHour: PRICING_CONSTANTS.valor_min * 60,
    ratePerKm: PRICING_CONSTANTS.valor_km
  }
};

const DEFAULT_CAR_TYPE = 'leaf_plus';

function toNumber(value, fallback = 0) {
  const parsed = Number(
    typeof value === 'string'
      ? value.replace(',', '.')
      : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(Math.max(0, value).toFixed(2));
}

function normalizeCarType(carType) {
  const normalized = String(carType || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return DEFAULT_CAR_TYPE;
  if (normalized.includes('moto')) return 'leaf_moto';
  if (normalized.includes('elite')) return 'leaf_elite';
  if (normalized.includes('plus')) return 'leaf_plus';
  if (normalized === 'type_moto') return 'leaf_moto';
  if (normalized === 'type3') return 'leaf_elite';
  if (normalized === 'type1') return 'leaf_plus';
  return DEFAULT_CAR_TYPE;
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

function buildFallbackRouteMetrics({ pickupLocation, destinationLocation }) {
  const pickupLat = toNumber(pickupLocation?.lat, NaN);
  const pickupLng = toNumber(pickupLocation?.lng, NaN);
  const destinationLat = toNumber(destinationLocation?.lat, NaN);
  const destinationLng = toNumber(destinationLocation?.lng, NaN);

  if (
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return {
      distanceKm: 0.8,
      durationSecs: 120,
      source: 'fallback_default'
    };
  }

  const straightDistanceKm = haversineDistanceKm(
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng
  );
  const normalizedStraightDistance = Number.isFinite(straightDistanceKm) && straightDistanceKm > 0
    ? straightDistanceKm
    : 0.8;
  const routeDistanceKm = Math.max(0.8, Number((normalizedStraightDistance * 1.25).toFixed(2)));
  const avgSpeedKmH = 28;
  const timeInSecs = Math.max(120, Math.round((routeDistanceKm / avgSpeedKmH) * 3600));

  return {
    distanceKm: routeDistanceKm,
    durationSecs: timeInSecs,
    source: 'fallback_haversine'
  };
}

function normalizePricingContext(pricingContext = {}, effectiveDurationSecs = 0) {
  const operational = pricingContext.operational || pricingContext || {};
  const current = operational.current || {};
  const etaPickupMin = pricingContext.trip?.eta_pickup_min
    ?? pricingContext.eta_pickup_min
    ?? current.avg_pickup_eta_min
    ?? 0;

  return {
    trip: {
      distance_km: pricingContext.trip?.distance_km,
      duration_min_traffic: pricingContext.trip?.duration_min_traffic,
      eta_pickup_min: toNumber(etaPickupMin, 0)
    },
    operational: {
      current: {
        active_requests_5m: toNumber(current.active_requests_5m, 0),
        idle_drivers: toNumber(current.idle_drivers, 0),
        avg_pickup_eta_min: toNumber(current.avg_pickup_eta_min, toNumber(etaPickupMin, 0)),
        trip_time_inflation: toNumber(current.trip_time_inflation, 1),
        cancel_rate: toNumber(current.cancel_rate, 0),
        accept_rate: current.accept_rate === undefined ? 1 : toNumber(current.accept_rate, 1),
        avg_speed_kmh: toNumber(current.avg_speed_kmh, 0)
      },
      baseline: {
        expected_requests_5m: toNumber(operational.baseline?.expected_requests_5m, NaN),
        expected_idle_drivers: toNumber(operational.baseline?.expected_idle_drivers, NaN),
        expected_pickup_eta_min: toNumber(operational.baseline?.expected_pickup_eta_min, NaN),
        expected_speed_kmh: toNumber(operational.baseline?.expected_speed_kmh, NaN),
        expected_cancel_rate: toNumber(operational.baseline?.expected_cancel_rate, NaN)
      },
      state_context: {
        now: operational.state_context?.now || new Date().toISOString(),
        previous_state: operational.state_context?.previous_state,
        state_entered_at: operational.state_context?.state_entered_at || null,
        state_exited_at: operational.state_context?.state_exited_at || null,
        recent_exception_history: Array.isArray(operational.state_context?.recent_exception_history)
          ? operational.state_context.recent_exception_history
          : [],
        degraded_neighbor_count: toNumber(operational.state_context?.degraded_neighbor_count, 0),
        is_special_zone: operational.state_context?.is_special_zone === true,
        zone_type: operational.state_context?.zone_type || null
      }
    },
    effectiveDurationMin: Math.max(0, effectiveDurationSecs / 60)
  };
}

function sanitizeBaseline(baseline = {}) {
  const sanitized = {};
  Object.entries(baseline).forEach(([key, value]) => {
    if (Number.isFinite(value)) {
      sanitized[key] = value;
    }
  });
  return sanitized;
}

async function estimateRideFare({
  redis,
  pickupLocation,
  destinationLocation,
  carType,
  routeDistanceKm,
  routeDurationSecs,
  tollFee,
  clientEstimatedFare,
  pricingContext
}) {
  const normalizedCarType = normalizeCarType(carType);
  const providedDistanceKm = toNumber(routeDistanceKm, 0);
  const providedDurationSecs = toNumber(routeDurationSecs, 0);
  const hasProvidedRouteMetrics = providedDistanceKm > 0 && providedDurationSecs > 0;

  const fallbackMetrics = buildFallbackRouteMetrics({
    pickupLocation,
    destinationLocation
  });

  const effectiveDistanceKm = hasProvidedRouteMetrics ? providedDistanceKm : fallbackMetrics.distanceKm;
  const effectiveDurationSecs = hasProvidedRouteMetrics ? providedDurationSecs : fallbackMetrics.durationSecs;
  const effectiveTollFee = toNumber(tollFee, 0);
  const clientFare = toNumber(clientEstimatedFare, 0);
  const derivedPricingContext = await pricingContextProvider.buildDerivedPricingContext({
    redis,
    pickupLocation,
    destinationLocation,
    routeDistanceKm: effectiveDistanceKm,
    routeDurationSecs: effectiveDurationSecs,
    explicitPricingContext: pricingContext
  });
  const normalizedPricingContext = normalizePricingContext(
    derivedPricingContext.pricingContext,
    effectiveDurationSecs
  );

  const engineResult = runDynamicPricingEngine({
    trip: {
      distance_km: effectiveDistanceKm,
      duration_min_traffic: normalizedPricingContext.trip.duration_min_traffic || normalizedPricingContext.effectiveDurationMin,
      eta_pickup_min: normalizedPricingContext.trip.eta_pickup_min
    },
    operational: {
      current: normalizedPricingContext.operational.current,
      baseline: sanitizeBaseline(normalizedPricingContext.operational.baseline),
      state_context: normalizedPricingContext.operational.state_context
    }
  });
  await pricingContextProvider.recordPricingEvaluation(derivedPricingContext.metadata, engineResult);
  metrics.recordPricingEvaluation({
    success: true,
    operationalState: engineResult.pricingPayload.operational_state,
    baselineSource: derivedPricingContext.metadata?.baselineSource || 'derived_heuristic',
    dynamicApplied: Number(engineResult.pricingPayload.dynamic_percentage || 0) > 0,
    minimumFareApplied: Boolean(engineResult.pricingPayload.minimum_fare_applied),
    scorePressao: Number(engineResult.pricingPayload.score_pressao || 0),
    scoreExcecao: Number(engineResult.pricingPayload.score_excecao || 0)
  });

  const estimatedFare = roundCurrency(engineResult.pricingPayload.final_price);
  const fareDiff = roundCurrency(Math.abs(clientFare - estimatedFare));

  if (clientFare > 0 && fareDiff >= 1) {
    logStructured('warn', 'Divergência entre tarifa cliente e tarifa servidor', {
      service: 'fare-estimation-service',
      carType: normalizedCarType,
      clientFare,
      serverFare: estimatedFare,
      fareDiff,
      routeMetricsSource: hasProvidedRouteMetrics ? 'client_route_metrics' : fallbackMetrics.source,
      operationalState: engineResult.pricingPayload.operational_state
    });
  }

  return {
    estimatedFare,
    normalizedCarType,
    routeMetrics: {
      distanceKm: roundCurrency(effectiveDistanceKm),
      durationSecs: Math.max(0, Math.round(effectiveDurationSecs)),
      source: hasProvidedRouteMetrics ? 'client_route_metrics' : fallbackMetrics.source
    },
    tollFee: roundCurrency(effectiveTollFee),
    clientFare: roundCurrency(clientFare),
    fareDiff,
    pricingPayload: engineResult.pricingPayload,
    operationalState: engineResult.pricingPayload.operational_state,
    scorePressao: engineResult.pricingPayload.score_pressao,
    scoreExcecao: engineResult.pricingPayload.score_excecao,
    exceptionalMode: engineResult.exceptionalMode,
    pricingAudit: {
      originCell: derivedPricingContext.metadata?.originCell || null,
      resolution: derivedPricingContext.metadata?.resolution || null,
      zoneType: derivedPricingContext.metadata?.zoneType || null,
      baselineSource: derivedPricingContext.metadata?.baselineSource || 'derived_heuristic',
      stateSource: derivedPricingContext.metadata?.stateSource || 'derived_fallback',
      historySource: derivedPricingContext.metadata?.historySource || 'derived_fallback',
      degradedNeighborCount: derivedPricingContext.metadata?.degradedNeighborCount || 0,
      trackedCells: Array.isArray(derivedPricingContext.metadata?.trackedCells)
        ? derivedPricingContext.metadata.trackedCells
        : [],
      evaluatedAt: derivedPricingContext.metadata?.nowIso || new Date().toISOString(),
      currentSnapshot: normalizedPricingContext.operational.current,
      baselineSnapshot: sanitizeBaseline(normalizedPricingContext.operational.baseline),
      stateSnapshot: normalizedPricingContext.operational.state_context
    },
    pricingDebug: {
      context: normalizedPricingContext,
      baselineSource: derivedPricingContext.metadata?.baselineSource || 'derived_heuristic',
      stateSource: derivedPricingContext.metadata?.stateSource || 'derived_fallback',
      historySource: derivedPricingContext.metadata?.historySource || 'derived_fallback',
      pressure: engineResult.pressure,
      exception: engineResult.exception,
      state: engineResult.operationalState
    }
  };
}

module.exports = {
  estimateRideFare,
  normalizeCarType,
  RATE_CARDS
};

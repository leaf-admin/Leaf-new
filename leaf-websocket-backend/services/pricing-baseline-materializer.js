const h3 = require('h3-js');
const h3MapService = require('./h3-map-service');
const pricingContextProvider = require('./pricing-context-provider');
const { runDynamicPricingEngine } = require('./pricing');
const { logStructured } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');

const DEFAULT_ROUTE_DISTANCE_KM = Number.parseFloat(process.env.PRICING_BASELINE_ROUTE_DISTANCE_KM || '1.5');
const DEFAULT_ROUTE_DURATION_SECS = Number.parseInt(process.env.PRICING_BASELINE_ROUTE_DURATION_SECS || '240', 10);
const DEFAULT_MAX_CELLS = Number.parseInt(process.env.PRICING_BASELINE_MAX_CELLS || '250', 10);
const DEFAULT_RESOLUTION = Number.parseInt(process.env.PRICING_H3_RESOLUTION || '9', 10);
const WORLD_BBOX = {
  minLat: -90,
  minLng: -180,
  maxLat: 90,
  maxLng: 180
};

function buildPickupLocationFromCell(h3Index) {
  const [lat, lng] = h3.cellToLatLng(h3Index);
  return {
    lat,
    lng,
    address: `H3 ${h3Index}`
  };
}

function collectCandidateCells(snapshot, resolution) {
  const cells = new Set();

  (snapshot.drivers || []).forEach((driver) => {
    if (Number.isFinite(driver?.location?.lat) && Number.isFinite(driver?.location?.lng)) {
      cells.add(h3.latLngToCell(driver.location.lat, driver.location.lng, resolution));
    }
  });

  (snapshot.openRequests || []).forEach((request) => {
    if (Number.isFinite(request?.pickupLocation?.lat) && Number.isFinite(request?.pickupLocation?.lng)) {
      cells.add(h3.latLngToCell(request.pickupLocation.lat, request.pickupLocation.lng, resolution));
    }
  });

  (snapshot.activeTrips || []).forEach((trip) => {
    if (Number.isFinite(trip?.location?.lat) && Number.isFinite(trip?.location?.lng)) {
      cells.add(h3.latLngToCell(trip.location.lat, trip.location.lng, resolution));
    }
  });

  return Array.from(cells).sort();
}

async function materializePricingBaselines({
  redis,
  resolution = DEFAULT_RESOLUTION,
  maxCells = DEFAULT_MAX_CELLS,
  nowIso = new Date().toISOString(),
  routeDistanceKm = DEFAULT_ROUTE_DISTANCE_KM,
  routeDurationSecs = DEFAULT_ROUTE_DURATION_SECS
}) {
  if (!redis) {
    throw new Error('Redis é obrigatório para materializar pricing baselines');
  }
  const startedAt = Date.now();

  try {
    const snapshot = await h3MapService.collectSnapshot(redis, WORLD_BBOX);
    const candidateCells = collectCandidateCells(snapshot, resolution);
    const selectedCells = candidateCells.slice(0, maxCells);

    const summary = {
      generatedAt: nowIso,
      resolution,
      candidateCells: candidateCells.length,
      processedCells: 0,
      failedCells: 0,
      operationalStates: {
        NORMAL: 0,
        PRESSAO: 0,
        EXCEPCIONAL: 0
      },
      baselineSources: {
        redis_materialized: 0,
        derived_heuristic: 0,
        unavailable: 0
      },
      errors: []
    };

    for (const h3Index of selectedCells) {
      const pickupLocation = buildPickupLocationFromCell(h3Index);

      try {
        const derived = await pricingContextProvider.buildDerivedPricingContext({
          redis,
          pickupLocation,
          destinationLocation: pickupLocation,
          routeDistanceKm,
          routeDurationSecs,
          explicitPricingContext: {
            operational: {
              state_context: {
                now: nowIso
              }
            }
          }
        });

        const engineResult = runDynamicPricingEngine({
          trip: derived.pricingContext.trip,
          operational: derived.pricingContext.operational
        });

        await pricingContextProvider.recordPricingEvaluation(derived.metadata, engineResult);

        const operationalState = engineResult.pricingPayload.operational_state || 'NORMAL';
        const baselineSource = derived.metadata?.baselineSource || 'derived_heuristic';

        summary.processedCells += 1;
        summary.operationalStates[operationalState] = (summary.operationalStates[operationalState] || 0) + 1;
        summary.baselineSources[baselineSource] = (summary.baselineSources[baselineSource] || 0) + 1;

        metrics.recordPricingEvaluation({
          success: true,
          operationalState,
          baselineSource,
          dynamicApplied: Number(engineResult.pricingPayload.dynamic_percentage || 0) > 0,
          minimumFareApplied: Boolean(engineResult.pricingPayload.minimum_fare_applied),
          scorePressao: Number(engineResult.pricingPayload.score_pressao || 0),
          scoreExcecao: Number(engineResult.pricingPayload.score_excecao || 0)
        });
      } catch (error) {
        summary.failedCells += 1;
        if (summary.errors.length < 20) {
          summary.errors.push({
            h3Index,
            message: error.message
          });
        }

        metrics.recordPricingEvaluation({
          success: false,
          operationalState: 'UNKNOWN',
          baselineSource: 'unavailable',
          dynamicApplied: false,
          minimumFareApplied: false,
          scorePressao: 0,
          scoreExcecao: 0
        });
      }
    }

    metrics.recordPricingBaselineMaterialization({
      success: true,
      durationSeconds: (Date.now() - startedAt) / 1000,
      candidateCells: summary.candidateCells,
      processedCells: summary.processedCells,
      failedCells: summary.failedCells
    });

    logStructured('info', 'Materialização de pricing baseline concluída', {
      service: 'pricing-baseline-materializer',
      resolution,
      candidateCells: summary.candidateCells,
      processedCells: summary.processedCells,
      failedCells: summary.failedCells
    });

    return summary;
  } catch (error) {
    metrics.recordPricingBaselineMaterialization({
      success: false,
      durationSeconds: (Date.now() - startedAt) / 1000,
      candidateCells: 0,
      processedCells: 0,
      failedCells: 0
    });
    throw error;
  }
}

module.exports = {
  materializePricingBaselines,
  helpers: {
    WORLD_BBOX,
    collectCandidateCells,
    buildPickupLocationFromCell
  }
};

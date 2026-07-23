const h3 = require('h3-js');
const h3MapService = require('./h3-map-service');
const pricingContextStore = require('./pricing-context-store');
const pricingH3ReadModelService = require('./pricing-h3-read-model-service');

const PRICING_H3_RESOLUTION = Number.parseInt(process.env.PRICING_H3_RESOLUTION || '9', 10);
const PRICING_H3_RING_SIZE = Number.parseInt(process.env.PRICING_H3_RING_SIZE || '1', 10);
const PRICING_H3_BASELINE_RING_SIZE = Math.max(
  PRICING_H3_RING_SIZE + 1,
  Number.parseInt(process.env.PRICING_H3_BASELINE_RING_SIZE || '2', 10)
);
const BASELINE_ALPHA = clamp(process.env.PRICING_BASELINE_ALPHA || 0.18, 0.05, 0.5);
const STATE_CACHE_TTL_MS = Number.parseInt(process.env.PRICING_STATE_CACHE_TTL_MS || String(20 * 60 * 1000), 10);
const SNAPSHOT_CACHE_TTL_MS = Math.max(
  250,
  Number.parseInt(process.env.PRICING_SNAPSHOT_CACHE_TTL_MS || '1500', 10) || 1500
);
const PRICING_USE_H3_READMODEL = String(process.env.PRICING_USE_H3_READMODEL || 'true').toLowerCase() !== 'false';
const PRICING_READMODEL_MAX_STALE_MS = Math.max(
  1000,
  Number.parseInt(process.env.PRICING_H3_READMODEL_MAX_STALE_MS || '15000', 10) || 15000
);
const HISTORY_WINDOW_MS = pricingContextStore.DEFAULT_HISTORY_WINDOW_MS;
const HISTORY_MAX_POINTS = Number.parseInt(process.env.PRICING_HISTORY_MAX_POINTS || '20', 10);

const DEFAULT_ZONE_BASELINES = {
  default: {
    pickupEtaMin: 4,
    speedKmh: 26,
    cancelRate: 0.05,
    requestsPerCell: 0.45,
    idleDriversPerCell: 0.7
  },
  airport: {
    pickupEtaMin: 5,
    speedKmh: 22,
    cancelRate: 0.06,
    requestsPerCell: 0.7,
    idleDriversPerCell: 1
  },
  stadium: {
    pickupEtaMin: 6,
    speedKmh: 18,
    cancelRate: 0.07,
    requestsPerCell: 0.75,
    idleDriversPerCell: 0.8
  },
  rodoviaria: {
    pickupEtaMin: 5,
    speedKmh: 20,
    cancelRate: 0.06,
    requestsPerCell: 0.65,
    idleDriversPerCell: 0.9
  },
  shopping: {
    pickupEtaMin: 4.5,
    speedKmh: 23,
    cancelRate: 0.05,
    requestsPerCell: 0.6,
    idleDriversPerCell: 0.9
  }
};

const stateCache = new Map();
const snapshotCache = new Map();

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function toNumber(value, fallback = 0) {
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDivide(numerator, denominator, fallback = 0) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return fallback;
  return top / bottom;
}

function average(values, fallback = 0) {
  const normalized = values.filter((value) => Number.isFinite(value));
  if (!normalized.length) return fallback;
  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
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

function getGridDisk(cell, ringSize) {
  if (!cell) return [];
  if (typeof h3.gridDisk === 'function') {
    return h3.gridDisk(cell, ringSize);
  }
  if (typeof h3.kRing === 'function') {
    return h3.kRing(cell, ringSize);
  }
  return [cell];
}

function getTextFragments(location = {}) {
  return [
    location?.address,
    location?.add,
    location?.description,
    location?.name,
    location?.title
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function resolveZoneType({ pickupLocation, destinationLocation }) {
  const haystack = [...getTextFragments(pickupLocation), ...getTextFragments(destinationLocation)].join(' ');

  if (!haystack) return null;
  if (/(aeroporto|airport|gale[aã]o|santos dumont|gru|sdu)/i.test(haystack)) return 'airport';
  if (/(est[aá]dio|stadium|arena|maracan[aã])/i.test(haystack)) return 'stadium';
  if (/(rodovi[aá]ria|rodoviaria|bus terminal|terminal)/i.test(haystack)) return 'rodoviaria';
  if (/(shopping|mall|center)/i.test(haystack)) return 'shopping';
  return null;
}

function getZoneBaseline(zoneType) {
  return DEFAULT_ZONE_BASELINES[zoneType] || DEFAULT_ZONE_BASELINES.default;
}

function buildBBoxFromCells(cells) {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  cells.forEach((cell) => {
    h3.cellToBoundary(cell).forEach(([lat, lng]) => {
      minLat = Math.min(minLat, lat);
      minLng = Math.min(minLng, lng);
      maxLat = Math.max(maxLat, lat);
      maxLng = Math.max(maxLng, lng);
    });
  });

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng) || !Number.isFinite(maxLat) || !Number.isFinite(maxLng)) {
    return null;
  }

  return { minLat, minLng, maxLat, maxLng };
}

function buildCellMap(cells = []) {
  return new Map(cells.map((cell) => [cell.h3Index, cell]));
}

function estimatePickupEtaMin({ pickupLocation, drivers = [], zoneBaseline }) {
  const availableDrivers = drivers.filter(
    (driver) => driver?.available && Number.isFinite(driver?.location?.lat) && Number.isFinite(driver?.location?.lng)
  );

  if (!availableDrivers.length) {
    return clamp(zoneBaseline.pickupEtaMin + 3, 3, 12);
  }

  const distances = availableDrivers
    .map((driver) => haversineDistanceKm(
      pickupLocation.lat,
      pickupLocation.lng,
      driver.location.lat,
      driver.location.lng
    ))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (!distances.length) {
    return clamp(zoneBaseline.pickupEtaMin + 1, 3, 12);
  }

  const sample = distances.slice(0, Math.min(3, distances.length));
  const avgDistanceKm = average(sample, 0);
  const effectiveSpeedKmh = 22;
  const etaMin = 1.2 + ((avgDistanceKm / effectiveSpeedKmh) * 60);
  return clamp(etaMin, 2, 12);
}

function estimatePickupEtaMinFromCells({ pickupLocation, trackedCells = [], cellMap, zoneBaseline }) {
  const candidates = trackedCells
    .map((cell) => {
      const metrics = cellMap.get(cell)?.metrics || {};
      const availableDrivers = Number(metrics.availableDrivers || 0);
      if (availableDrivers <= 0) return null;

      const [lat, lng] = h3.cellToLatLng(cell);
      return {
        availableDrivers,
        distanceKm: haversineDistanceKm(
          pickupLocation.lat,
          pickupLocation.lng,
          lat,
          lng
        )
      };
    })
    .filter((candidate) => Number.isFinite(candidate?.distanceKm))
    .sort((left, right) => left.distanceKm - right.distanceKm);

  if (!candidates.length) {
    return clamp(zoneBaseline.pickupEtaMin + 3, 3, 12);
  }

  const weightedDistances = [];
  candidates.slice(0, 3).forEach((candidate) => {
    const weight = Math.max(1, Math.min(3, Math.round(candidate.availableDrivers)));
    for (let index = 0; index < weight; index += 1) {
      weightedDistances.push(candidate.distanceKm);
    }
  });

  const avgDistanceKm = average(
    weightedDistances.length ? weightedDistances : candidates.slice(0, 3).map((candidate) => candidate.distanceKm),
    0
  );
  const effectiveSpeedKmh = 22;
  const etaMin = 1.2 + ((avgDistanceKm / effectiveSpeedKmh) * 60);
  return clamp(etaMin, 2, 12);
}

function resolveHeuristicPickupEtaSource({ trackedDrivers = [] } = {}) {
  return Array.isArray(trackedDrivers) && trackedDrivers.length > 0
    ? 'haversine_available_drivers'
    : 'h3_cell_heuristic';
}

function deriveBehaviorRates({ activeRequests5m, idleDrivers, busyDrivers, avgPickupEtaMin }) {
  const pressureGap = Math.max(0, activeRequests5m - idleDrivers);
  const demandShare = safeDivide(activeRequests5m, activeRequests5m + idleDrivers + busyDrivers, 0);

  const cancelRate = clamp(
    0.03 + (pressureGap * 0.025) + (Math.max(0, avgPickupEtaMin - 4) * 0.015) + (demandShare * 0.05),
    0.02,
    0.25
  );

  const acceptRate = clamp(
    0.96 - (pressureGap * 0.035) - (Math.max(0, avgPickupEtaMin - 4) * 0.04) - (demandShare * 0.18),
    0.35,
    0.99
  );

  return { cancelRate, acceptRate };
}

function deriveTrafficMetrics({ routeDistanceKm, routeDurationSecs, zoneBaseline }) {
  const distanceKm = Math.max(0, toNumber(routeDistanceKm, 0));
  const durationSecs = Math.max(0, toNumber(routeDurationSecs, 0));
  const expectedSpeedKmh = zoneBaseline.speedKmh;

  if (distanceKm <= 0 || durationSecs <= 0) {
    return {
      avgSpeedKmh: expectedSpeedKmh,
      tripTimeInflation: 1,
      expectedSpeedKmh
    };
  }

  const actualSpeedKmh = safeDivide(distanceKm, durationSecs / 3600, expectedSpeedKmh);
  const expectedDurationSecs = safeDivide(distanceKm, expectedSpeedKmh, 0) * 3600;
  const tripTimeInflation = Math.max(1, safeDivide(durationSecs, expectedDurationSecs, 1));

  return {
    avgSpeedKmh: clamp(actualSpeedKmh, 4, 80),
    tripTimeInflation: clamp(tripTimeInflation, 1, 3),
    expectedSpeedKmh
  };
}

function deriveExpectedAggregate({ baselineCells, trackedCellCount, zoneBaseline }) {
  const populatedBaselineCells = baselineCells.filter(Boolean);

  if (!populatedBaselineCells.length) {
    return {
      expected_requests_5m: Math.max(1, Math.round(zoneBaseline.requestsPerCell * trackedCellCount)),
      expected_idle_drivers: Math.max(1, Math.round(zoneBaseline.idleDriversPerCell * trackedCellCount)),
      expected_pickup_eta_min: zoneBaseline.pickupEtaMin,
      expected_speed_kmh: zoneBaseline.speedKmh,
      expected_cancel_rate: zoneBaseline.cancelRate
    };
  }

  const avgOpenRequestsPerCell = average(populatedBaselineCells.map((cell) => cell.metrics?.openRequests || 0), zoneBaseline.requestsPerCell);
  const avgAvailableDriversPerCell = average(populatedBaselineCells.map((cell) => cell.metrics?.availableDrivers || 0), zoneBaseline.idleDriversPerCell);
  const avgImbalance = average(populatedBaselineCells.map((cell) => cell.metrics?.imbalance || 0), 0);

  return {
    expected_requests_5m: Math.max(1, Math.round(avgOpenRequestsPerCell * trackedCellCount)),
    expected_idle_drivers: Math.max(1, Math.round(avgAvailableDriversPerCell * trackedCellCount)),
    expected_pickup_eta_min: clamp(zoneBaseline.pickupEtaMin + Math.max(0, avgImbalance - 1) * 0.6, 3, 9),
    expected_speed_kmh: zoneBaseline.speedKmh,
    expected_cancel_rate: zoneBaseline.cancelRate
  };
}

function buildDerivedCurrent({ trackedCells, cellMap, snapshot, pickupLocation, routeDistanceKm, routeDurationSecs, zoneBaseline }) {
  const trackedMetrics = trackedCells
    .map((cell) => cellMap.get(cell))
    .filter(Boolean);

  const activeRequests5m = trackedMetrics.reduce((sum, cell) => sum + (cell.metrics?.openRequests || 0), 0);
  const idleDrivers = trackedMetrics.reduce((sum, cell) => sum + (cell.metrics?.availableDrivers || 0), 0);
  const busyDrivers = trackedMetrics.reduce((sum, cell) => sum + (cell.metrics?.busyDrivers || 0), 0);
  const trackedDrivers = Array.isArray(snapshot?.drivers)
    ? snapshot.drivers.filter((driver) => trackedCells.includes(h3.latLngToCell(driver.location.lat, driver.location.lng, PRICING_H3_RESOLUTION)))
    : [];
  const avgPickupEtaSource = resolveHeuristicPickupEtaSource({ trackedDrivers });
  const avgPickupEtaMin = trackedDrivers.length > 0
    ? estimatePickupEtaMin({
        pickupLocation,
        drivers: trackedDrivers,
        zoneBaseline
      })
    : estimatePickupEtaMinFromCells({
        pickupLocation,
        trackedCells,
        cellMap,
        zoneBaseline
      });
  const traffic = deriveTrafficMetrics({ routeDistanceKm, routeDurationSecs, zoneBaseline });
  const behavior = deriveBehaviorRates({
    activeRequests5m,
    idleDrivers,
    busyDrivers,
    avgPickupEtaMin
  });

  return {
    active_requests_5m: activeRequests5m,
    idle_drivers: idleDrivers,
    avg_pickup_eta_min: Number(avgPickupEtaMin.toFixed(2)),
    avg_pickup_eta_source: avgPickupEtaSource,
    avg_pickup_eta_authoritative: false,
    trip_time_inflation: Number(traffic.tripTimeInflation.toFixed(3)),
    cancel_rate: Number(behavior.cancelRate.toFixed(3)),
    accept_rate: Number(behavior.acceptRate.toFixed(3)),
    avg_speed_kmh: Number(traffic.avgSpeedKmh.toFixed(2))
  };
}

function countDegradedNeighbors({ originCell, cellMap }) {
  return getGridDisk(originCell, 1)
    .filter((cell) => cell !== originCell)
    .reduce((count, cell) => {
      const candidate = cellMap.get(cell);
      if (!candidate) return count;
      const metrics = candidate.metrics || {};
      const degraded =
        metrics.demandLevel === 'high' ||
        metrics.demandLevel === 'critical' ||
        Number(metrics.imbalance || 0) >= 1.25 ||
        Number(metrics.openRequests || 0) > Number(metrics.availableDrivers || 0);
      return degraded ? count + 1 : count;
    }, 0);
}

function cleanupStateCache(nowMs = Date.now()) {
  for (const [key, value] of stateCache.entries()) {
    if (!value?.expiresAt || value.expiresAt <= nowMs) {
      stateCache.delete(key);
    }
  }
}

function cleanupSnapshotCache(nowMs = Date.now()) {
  for (const [key, value] of snapshotCache.entries()) {
    if (!value?.expiresAt || value.expiresAt <= nowMs) {
      snapshotCache.delete(key);
    }
  }
}

function getCachedSnapshot(originCell, nowMs = Date.now()) {
  cleanupSnapshotCache(nowMs);
  const cached = snapshotCache.get(originCell);
  if (!cached || cached.expiresAt <= nowMs) {
    return null;
  }
  return cached;
}

function setCachedSnapshot(originCell, payload, nowMs = Date.now()) {
  snapshotCache.set(originCell, {
    ...payload,
    expiresAt: nowMs + SNAPSHOT_CACHE_TTL_MS
  });
}

function getCachedState(originCell, nowIso) {
  const nowMs = Date.parse(nowIso) || Date.now();
  cleanupStateCache(nowMs);
  const cached = stateCache.get(originCell);
  if (!cached) {
    return {
      previous_state: 'NORMAL',
      state_entered_at: null,
      state_exited_at: null,
      recent_exception_history: []
    };
  }

  return {
    previous_state: cached.state || 'NORMAL',
    state_entered_at: cached.entered_at || null,
    state_exited_at: cached.exited_at || null,
    recent_exception_history: Array.isArray(cached.recent_exception_history) ? cached.recent_exception_history : []
  };
}

function parseHistory(rawHistory) {
  if (!rawHistory) return [];
  try {
    const parsed = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function loadRedisPricingState(redis, originCell, nowIso) {
  if (!pricingContextStore.isRedisPricingStoreUsable(redis) || !originCell) {
    return {
      baseline: null,
      state: null,
      baselineSource: 'unavailable',
      stateSource: 'unavailable',
      historySource: 'unavailable'
    };
  }

  return pricingContextStore.loadPricingContextState(redis, {
    resolution: PRICING_H3_RESOLUTION,
    h3Index: originCell,
    nowIso,
    historyWindowMs: HISTORY_WINDOW_MS
  });
}

function deepMergeLeafValues(base = {}, override = {}) {
  const merged = { ...base };
  Object.entries(override || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  });
  return merged;
}

function mergePricingContext(derived = {}, explicit = {}) {
  const derivedOperational = derived.operational || {};
  const explicitOperational = explicit.operational || explicit || {};

  return {
    trip: deepMergeLeafValues(derived.trip || {}, explicit.trip || {}),
    operational: {
      current: deepMergeLeafValues(derivedOperational.current || {}, explicitOperational.current || {}),
      baseline: deepMergeLeafValues(derivedOperational.baseline || {}, explicitOperational.baseline || {}),
      state_context: deepMergeLeafValues(derivedOperational.state_context || {}, explicitOperational.state_context || {})
    }
  };
}

function mergeBaselineSnapshot(derivedBaseline = {}, redisBaseline = null) {
  if (!redisBaseline || typeof redisBaseline !== 'object') {
    return derivedBaseline;
  }

  return deepMergeLeafValues(derivedBaseline, {
    expected_requests_5m: redisBaseline.expected_requests_5m,
    expected_idle_drivers: redisBaseline.expected_idle_drivers,
    expected_pickup_eta_min: redisBaseline.expected_pickup_eta_min,
    expected_speed_kmh: redisBaseline.expected_speed_kmh,
    expected_cancel_rate: redisBaseline.expected_cancel_rate
  });
}

function mergeStateContext(derivedStateContext = {}, cachedStateContext = null) {
  if (!cachedStateContext || typeof cachedStateContext !== 'object') {
    return derivedStateContext;
  }

  return {
    ...derivedStateContext,
    previous_state: cachedStateContext.previous_state || derivedStateContext.previous_state,
    state_entered_at: cachedStateContext.state_entered_at || derivedStateContext.state_entered_at,
    state_exited_at: cachedStateContext.state_exited_at || derivedStateContext.state_exited_at,
    recent_exception_history:
      Array.isArray(cachedStateContext.recent_exception_history) && cachedStateContext.recent_exception_history.length > 0
        ? cachedStateContext.recent_exception_history
        : derivedStateContext.recent_exception_history
  };
}

async function buildDerivedPricingContext({
  redis,
  pickupLocation,
  destinationLocation,
  routeDistanceKm,
  routeDurationSecs,
  explicitPricingContext = null
}) {
  const providerStartedAt = Date.now();
  const perfBreakdownMs = {};
  const recordPerf = (key, startedAt) => {
    perfBreakdownMs[key] = Math.max(0, Date.now() - startedAt);
  };
  const pickupLat = toNumber(pickupLocation?.lat, NaN);
  const pickupLng = toNumber(pickupLocation?.lng, NaN);
  const nowIso = new Date().toISOString();

  if (!redis || !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    perfBreakdownMs.total = Math.max(0, Date.now() - providerStartedAt);
    return {
      pricingContext: mergePricingContext({
        trip: {
          distance_km: toNumber(routeDistanceKm, 0),
          duration_min_traffic: Math.max(0, toNumber(routeDurationSecs, 0) / 60),
          eta_pickup_min: explicitPricingContext?.trip?.eta_pickup_min || 0,
          eta_pickup_source:
            explicitPricingContext?.trip?.eta_pickup_source ||
            explicitPricingContext?.trip?.pickup_eta_source ||
            'unavailable',
          eta_pickup_authoritative:
            explicitPricingContext?.trip?.eta_pickup_authoritative === true ||
            explicitPricingContext?.trip?.pickup_eta_authoritative === true
        },
        operational: {
          current: {},
          baseline: {},
          state_context: {
            now: nowIso
          }
        }
      }, explicitPricingContext || {}),
      metadata: {
        perfBreakdownMs,
        originCell: null,
        resolution: PRICING_H3_RESOLUTION,
        nowIso,
        zoneType: null,
        trackedCells: [],
        degradedNeighborCount: 0,
        derivedCurrent: {},
        derivedBaseline: {},
        baselineSource: 'unavailable',
        stateSource: 'unavailable',
        historySource: 'unavailable'
      }
    };
  }

  const originCell = h3.latLngToCell(pickupLat, pickupLng, PRICING_H3_RESOLUTION);
  const trackedCells = getGridDisk(originCell, PRICING_H3_RING_SIZE);
  const baselineDisk = getGridDisk(originCell, PRICING_H3_BASELINE_RING_SIZE);
  const baselineCellsSet = new Set(baselineDisk.filter((cell) => !trackedCells.includes(cell)));
  const bbox = buildBBoxFromCells(baselineDisk.length ? baselineDisk : trackedCells);
  const zoneType = resolveZoneType({ pickupLocation, destinationLocation });
  const zoneBaseline = getZoneBaseline(zoneType);
  const redisStateStartedAt = Date.now();
  const redisSnapshots = await loadRedisPricingState(redis, originCell, nowIso);
  recordPerf('loadRedisPricingState', redisStateStartedAt);
  const nowMs = Date.parse(nowIso) || Date.now();
  const cachedSnapshot = getCachedSnapshot(originCell, nowMs);

  let snapshot = cachedSnapshot?.snapshot || null;
  let aggregated = cachedSnapshot?.aggregated || null;
  let readModelMetadata = null;

  if (!aggregated && PRICING_USE_H3_READMODEL && bbox) {
    const readModelStartedAt = Date.now();
    const readModelSnapshot = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: baselineDisk.length ? baselineDisk : trackedCells,
      resolution: PRICING_H3_RESOLUTION,
      maxStaleMs: PRICING_READMODEL_MAX_STALE_MS
    });
    recordPerf('loadReadModel', readModelStartedAt);

    if (readModelSnapshot?.usable) {
      aggregated = { cells: readModelSnapshot.cells };
      readModelMetadata = {
        source: 'h3_read_model',
        touchedCells: readModelSnapshot.touchedCells,
        staleCells: readModelSnapshot.staleCells,
        lastMutationAt: readModelSnapshot.lastMutationAt
      };
    } else {
      readModelMetadata = {
        source: 'fallback_full_snapshot',
        touchedCells: readModelSnapshot?.touchedCells || 0,
        staleCells: readModelSnapshot?.staleCells || 0,
        lastMutationAt: readModelSnapshot?.lastMutationAt || null,
        reason: readModelSnapshot?.reason || 'unavailable'
      };
    }
  }

  if (!aggregated) {
    if (!snapshot) {
      const snapshotStartedAt = Date.now();
      snapshot = bbox
        ? await h3MapService.collectSnapshot(redis, bbox)
        : { drivers: [], openRequests: [], activeTrips: [] };
      recordPerf('collectSnapshot', snapshotStartedAt);
    }

    const aggregateStartedAt = Date.now();
    aggregated = bbox
      ? h3MapService.aggregateCells({
          bbox,
          resolution: PRICING_H3_RESOLUTION,
          surface: 'driver',
          includeEmpty: true,
          includeBoundary: false,
          snapshot
        })
      : { cells: [] };
    recordPerf('aggregateCells', aggregateStartedAt);
  }

  if (!cachedSnapshot) {
    setCachedSnapshot(originCell, {
      bbox,
      snapshot,
      aggregated
    }, nowMs);
  }

  const cellMap = buildCellMap(aggregated.cells);
  const deriveStartedAt = Date.now();
  const derivedCurrent = buildDerivedCurrent({
    trackedCells,
    cellMap,
    snapshot,
    pickupLocation: { lat: pickupLat, lng: pickupLng },
    routeDistanceKm,
    routeDurationSecs,
    zoneBaseline
  });
  const derivedBaseline = deriveExpectedAggregate({
    baselineCells: Array.from(baselineCellsSet).map((cell) => cellMap.get(cell)).filter(Boolean),
    trackedCellCount: trackedCells.length,
    zoneBaseline
  });
  const cachedState = redisSnapshots.state || getCachedState(originCell, nowIso);
  const degradedNeighborCount = countDegradedNeighbors({ originCell, cellMap });
  recordPerf('deriveContext', deriveStartedAt);

  const derivedContext = {
    trip: {
      distance_km: toNumber(routeDistanceKm, 0),
      duration_min_traffic: Math.max(0, toNumber(routeDurationSecs, 0) / 60),
      eta_pickup_min: derivedCurrent.avg_pickup_eta_min,
      eta_pickup_source: derivedCurrent.avg_pickup_eta_source,
      eta_pickup_authoritative: false
    },
    operational: {
      current: derivedCurrent,
      baseline: mergeBaselineSnapshot(derivedBaseline, redisSnapshots.baseline),
      state_context: mergeStateContext({
        now: nowIso,
        previous_state: cachedState.previous_state,
        state_entered_at: cachedState.state_entered_at,
        state_exited_at: cachedState.state_exited_at,
        recent_exception_history: cachedState.recent_exception_history,
        degraded_neighbor_count: degradedNeighborCount,
        is_special_zone: Boolean(zoneType),
        zone_type: zoneType,
        pickup_eta_source: derivedCurrent.avg_pickup_eta_source,
        pickup_eta_authoritative: false
      }, redisSnapshots.state)
    }
  };

  perfBreakdownMs.total = Math.max(0, Date.now() - providerStartedAt);
  return {
    pricingContext: mergePricingContext(derivedContext, explicitPricingContext || {}),
    metadata: {
      redis,
      originCell,
      resolution: PRICING_H3_RESOLUTION,
      nowIso,
      zoneType,
      trackedCells,
      degradedNeighborCount,
      derivedCurrent,
      pickupEtaSource: derivedCurrent.avg_pickup_eta_source,
      pickupEtaAuthoritative: false,
      derivedBaseline: derivedContext.operational.baseline,
      baselineSource: redisSnapshots.baselineSource || 'derived_heuristic',
      stateSource: redisSnapshots.stateSource || 'derived_fallback',
      historySource: redisSnapshots.historySource || 'derived_fallback',
      perfBreakdownMs,
      readModel: readModelMetadata,
      snapshotSource: readModelMetadata?.source || 'full_snapshot',
      readModelTouchedCells: readModelMetadata?.touchedCells || 0,
      readModelStaleCells: readModelMetadata?.staleCells || 0,
      readModelLastMutationAt: readModelMetadata?.lastMutationAt || null
    }
  };
}

async function recordPricingEvaluation(metadata, engineResult) {
  if (!metadata?.originCell || !engineResult?.pricingPayload) {
    return;
  }

  const nowIso = metadata.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  cleanupStateCache(nowMs);

  const previous = stateCache.get(metadata.originCell) || {};
  const nextState = engineResult.operationalState?.estado_atual || engineResult.pricingPayload.operational_state || 'NORMAL';
  const previousState = previous.state || 'NORMAL';
  const previousHistory = Array.isArray(previous.recent_exception_history) ? previous.recent_exception_history : [];
  const nextHistory = [
    ...previousHistory,
    {
      timestamp: nowIso,
      score_excecao: Number(engineResult.pricingPayload.score_excecao || 0)
    }
  ]
    .filter((point) => {
      const timestampMs = Date.parse(point.timestamp);
      return Number.isFinite(timestampMs) && (nowMs - timestampMs) <= HISTORY_WINDOW_MS;
    })
    .slice(-HISTORY_MAX_POINTS);

  stateCache.set(metadata.originCell, {
    state: nextState,
    entered_at: previousState === nextState ? (previous.entered_at || nowIso) : nowIso,
    exited_at: previousState === nextState ? (previous.exited_at || null) : nowIso,
    recent_exception_history: nextHistory,
    expiresAt: nowMs + STATE_CACHE_TTL_MS
  });

  if (!pricingContextStore.isRedisPricingStoreUsable(metadata.redis)) {
    return;
  }

  try {
    const current = metadata.derivedCurrent || {};
    const previousSnapshots = await pricingContextStore.loadPricingContextState(metadata.redis, {
      resolution: metadata.resolution || PRICING_H3_RESOLUTION,
      h3Index: metadata.originCell,
      nowIso,
      historyWindowMs: HISTORY_WINDOW_MS
    });
    const previousBaseline = previousSnapshots.baseline || {};

    const shouldUpdateBaseline = nextState !== 'EXCEPCIONAL';
    const baselinePayload = shouldUpdateBaseline
      ? {
          expected_requests_5m: Number.isFinite(previousBaseline.expected_requests_5m)
            ? ((previousBaseline.expected_requests_5m * (1 - BASELINE_ALPHA)) + (toNumber(current.active_requests_5m, 0) * BASELINE_ALPHA))
            : toNumber(current.active_requests_5m, metadata.derivedBaseline?.expected_requests_5m || 1),
          expected_idle_drivers: Number.isFinite(previousBaseline.expected_idle_drivers)
            ? ((previousBaseline.expected_idle_drivers * (1 - BASELINE_ALPHA)) + (toNumber(current.idle_drivers, 0) * BASELINE_ALPHA))
            : toNumber(current.idle_drivers, metadata.derivedBaseline?.expected_idle_drivers || 1),
          expected_pickup_eta_min: Number.isFinite(previousBaseline.expected_pickup_eta_min)
            ? ((previousBaseline.expected_pickup_eta_min * (1 - BASELINE_ALPHA)) + (toNumber(current.avg_pickup_eta_min, 0) * BASELINE_ALPHA))
            : toNumber(current.avg_pickup_eta_min, metadata.derivedBaseline?.expected_pickup_eta_min || 4),
          expected_speed_kmh: Number.isFinite(previousBaseline.expected_speed_kmh)
            ? ((previousBaseline.expected_speed_kmh * (1 - BASELINE_ALPHA)) + (toNumber(current.avg_speed_kmh, 0) * BASELINE_ALPHA))
            : toNumber(current.avg_speed_kmh, metadata.derivedBaseline?.expected_speed_kmh || 24),
          expected_cancel_rate: Number.isFinite(previousBaseline.expected_cancel_rate)
            ? ((previousBaseline.expected_cancel_rate * (1 - BASELINE_ALPHA)) + (toNumber(current.cancel_rate, 0) * BASELINE_ALPHA))
            : toNumber(current.cancel_rate, metadata.derivedBaseline?.expected_cancel_rate || 0.05),
          sample_count: Math.max(1, Math.round(previousBaseline.sample_count || 0) + 1),
          updated_at: nowIso
        }
      : null;

    await pricingContextStore.persistPricingContextState(metadata.redis, {
      resolution: metadata.resolution || PRICING_H3_RESOLUTION,
      h3Index: metadata.originCell,
      nowIso,
      baselinePayload,
      statePayload: {
        state: nextState,
        entered_at: previousState === nextState ? (previous.entered_at || nowIso) : nowIso,
        exited_at: previousState === nextState ? (previous.exited_at || '') : nowIso,
        zone_type: metadata.zoneType || '',
        updated_at: nowIso,
        last_score_pressao: Number(engineResult.pricingPayload.score_pressao || 0),
        last_score_excecao: Number(engineResult.pricingPayload.score_excecao || 0),
        last_exceptional_mode_active: Boolean(engineResult.exceptionalMode?.exceptional_mode_active)
      },
      historyPoint: {
        timestamp: nowIso,
        score_excecao: Number(engineResult.pricingPayload.score_excecao || 0)
      },
      historyWindowMs: HISTORY_WINDOW_MS
    });
  } catch (_error) {
    // fallback silencioso para cache local
  }
}

module.exports = {
  buildDerivedPricingContext,
  recordPricingEvaluation,
  __resetCachesForTests: () => {
    stateCache.clear();
    snapshotCache.clear();
  },
  helpers: {
    resolveZoneType,
    getZoneBaseline,
    mergePricingContext,
    estimatePickupEtaMin,
    deriveBehaviorRates,
    deriveTrafficMetrics,
    deriveExpectedAggregate,
    countDegradedNeighbors
  }
};

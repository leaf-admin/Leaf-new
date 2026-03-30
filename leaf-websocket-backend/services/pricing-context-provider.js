const h3 = require('h3-js');
const h3MapService = require('./h3-map-service');

const PRICING_H3_RESOLUTION = Number.parseInt(process.env.PRICING_H3_RESOLUTION || '9', 10);
const PRICING_H3_RING_SIZE = Number.parseInt(process.env.PRICING_H3_RING_SIZE || '1', 10);
const PRICING_H3_BASELINE_RING_SIZE = Math.max(
  PRICING_H3_RING_SIZE + 1,
  Number.parseInt(process.env.PRICING_H3_BASELINE_RING_SIZE || '2', 10)
);
const REDIS_BASELINE_KEY_PREFIX = process.env.PRICING_BASELINE_KEY_PREFIX || 'pricing:baseline';
const REDIS_STATE_KEY_PREFIX = process.env.PRICING_STATE_KEY_PREFIX || 'pricing:state';
const BASELINE_ALPHA = clamp(process.env.PRICING_BASELINE_ALPHA || 0.18, 0.05, 0.5);
const REDIS_TTL_SECONDS = Number.parseInt(process.env.PRICING_REDIS_TTL_SECONDS || String(14 * 24 * 60 * 60), 10);
const STATE_CACHE_TTL_MS = Number.parseInt(process.env.PRICING_STATE_CACHE_TTL_MS || String(20 * 60 * 1000), 10);
const HISTORY_WINDOW_MS = Number.parseInt(process.env.PRICING_HISTORY_WINDOW_MS || String(20 * 60 * 1000), 10);
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

function isRedisUsable(redis) {
  return redis
    && typeof redis.hgetall === 'function'
    && typeof redis.hset === 'function'
    && typeof redis.expire === 'function';
}

function buildBaselineRedisKey(originCell, nowIso) {
  const now = new Date(nowIso);
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();
  return `${REDIS_BASELINE_KEY_PREFIX}:${originCell}:${dayOfWeek}:${hour}`;
}

function buildStateRedisKey(originCell) {
  return `${REDIS_STATE_KEY_PREFIX}:${originCell}`;
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
  const avgPickupEtaMin = estimatePickupEtaMin({
    pickupLocation,
    drivers: snapshot.drivers.filter((driver) => trackedCells.includes(h3.latLngToCell(driver.location.lat, driver.location.lng, PRICING_H3_RESOLUTION))),
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
  if (!isRedisUsable(redis) || !originCell) {
    return { baseline: null, state: null };
  }

  try {
    const [baselineHash, stateHash] = await Promise.all([
      redis.hgetall(buildBaselineRedisKey(originCell, nowIso)).catch(() => ({})),
      redis.hgetall(buildStateRedisKey(originCell)).catch(() => ({}))
    ]);

    const baseline = baselineHash && Object.keys(baselineHash).length > 0
      ? {
          expected_requests_5m: toNumber(baselineHash.expected_requests_5m, NaN),
          expected_idle_drivers: toNumber(baselineHash.expected_idle_drivers, NaN),
          expected_pickup_eta_min: toNumber(baselineHash.expected_pickup_eta_min, NaN),
          expected_speed_kmh: toNumber(baselineHash.expected_speed_kmh, NaN),
          expected_cancel_rate: toNumber(baselineHash.expected_cancel_rate, NaN),
          sample_count: toNumber(baselineHash.sample_count, 0)
        }
      : null;

    const state = stateHash && Object.keys(stateHash).length > 0
      ? {
          previous_state: stateHash.state || 'NORMAL',
          state_entered_at: stateHash.entered_at || null,
          state_exited_at: stateHash.exited_at || null,
          recent_exception_history: parseHistory(stateHash.recent_exception_history)
        }
      : null;

    return { baseline, state };
  } catch (_error) {
    return { baseline: null, state: null };
  }
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
  const pickupLat = toNumber(pickupLocation?.lat, NaN);
  const pickupLng = toNumber(pickupLocation?.lng, NaN);
  const nowIso = new Date().toISOString();

  if (!redis || !Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
    return {
      pricingContext: mergePricingContext({
        trip: {
          distance_km: toNumber(routeDistanceKm, 0),
          duration_min_traffic: Math.max(0, toNumber(routeDurationSecs, 0) / 60),
          eta_pickup_min: explicitPricingContext?.trip?.eta_pickup_min || 0
        },
        operational: {
          current: {},
          baseline: {},
          state_context: {
            now: nowIso
          }
        }
      }, explicitPricingContext || {}),
      metadata: null
    };
  }

  const originCell = h3.latLngToCell(pickupLat, pickupLng, PRICING_H3_RESOLUTION);
  const trackedCells = getGridDisk(originCell, PRICING_H3_RING_SIZE);
  const baselineDisk = getGridDisk(originCell, PRICING_H3_BASELINE_RING_SIZE);
  const baselineCellsSet = new Set(baselineDisk.filter((cell) => !trackedCells.includes(cell)));
  const bbox = buildBBoxFromCells(baselineDisk.length ? baselineDisk : trackedCells);
  const zoneType = resolveZoneType({ pickupLocation, destinationLocation });
  const zoneBaseline = getZoneBaseline(zoneType);
  const redisSnapshots = await loadRedisPricingState(redis, originCell, nowIso);

  const snapshot = bbox
    ? await h3MapService.collectSnapshot(redis, bbox)
    : { drivers: [], openRequests: [], activeTrips: [] };
  const aggregated = bbox
    ? h3MapService.aggregateCells({
        bbox,
        resolution: PRICING_H3_RESOLUTION,
        surface: 'driver',
        includeEmpty: true,
        includeBoundary: false,
        snapshot
      })
    : { cells: [] };

  const cellMap = buildCellMap(aggregated.cells);
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

  const derivedContext = {
    trip: {
      distance_km: toNumber(routeDistanceKm, 0),
      duration_min_traffic: Math.max(0, toNumber(routeDurationSecs, 0) / 60),
      eta_pickup_min: derivedCurrent.avg_pickup_eta_min
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
        zone_type: zoneType
      }, redisSnapshots.state)
    }
  };

  return {
    pricingContext: mergePricingContext(derivedContext, explicitPricingContext || {}),
    metadata: {
      redis,
      originCell,
      nowIso,
      zoneType,
      trackedCells,
      degradedNeighborCount,
      derivedCurrent,
      derivedBaseline: derivedContext.operational.baseline
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

  if (!isRedisUsable(metadata.redis)) {
    return;
  }

  try {
    const baselineKey = buildBaselineRedisKey(metadata.originCell, nowIso);
    const stateKey = buildStateRedisKey(metadata.originCell);
    const current = metadata.derivedCurrent || {};
    const previousBaselineHash = await metadata.redis.hgetall(baselineKey).catch(() => ({}));
    const previousBaseline = {
      expected_requests_5m: toNumber(previousBaselineHash.expected_requests_5m, NaN),
      expected_idle_drivers: toNumber(previousBaselineHash.expected_idle_drivers, NaN),
      expected_pickup_eta_min: toNumber(previousBaselineHash.expected_pickup_eta_min, NaN),
      expected_speed_kmh: toNumber(previousBaselineHash.expected_speed_kmh, NaN),
      expected_cancel_rate: toNumber(previousBaselineHash.expected_cancel_rate, NaN),
      sample_count: toNumber(previousBaselineHash.sample_count, 0)
    };

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

    const pipeline = metadata.redis.pipeline();
    if (baselinePayload) {
      pipeline.hset(baselineKey, {
        expected_requests_5m: String(Number(baselinePayload.expected_requests_5m.toFixed(3))),
        expected_idle_drivers: String(Number(baselinePayload.expected_idle_drivers.toFixed(3))),
        expected_pickup_eta_min: String(Number(baselinePayload.expected_pickup_eta_min.toFixed(3))),
        expected_speed_kmh: String(Number(baselinePayload.expected_speed_kmh.toFixed(3))),
        expected_cancel_rate: String(Number(baselinePayload.expected_cancel_rate.toFixed(4))),
        sample_count: String(baselinePayload.sample_count),
        updated_at: baselinePayload.updated_at
      });
      pipeline.expire(baselineKey, REDIS_TTL_SECONDS);
    }

    pipeline.hset(stateKey, {
      state: nextState,
      entered_at: previousState === nextState ? (previous.entered_at || nowIso) : nowIso,
      exited_at: previousState === nextState ? (previous.exited_at || '') : nowIso,
      recent_exception_history: JSON.stringify(nextHistory),
      zone_type: metadata.zoneType || '',
      updated_at: nowIso
    });
    pipeline.expire(stateKey, REDIS_TTL_SECONDS);
    await pipeline.exec();
  } catch (_error) {
    // fallback silencioso para cache local
  }
}

module.exports = {
  buildDerivedPricingContext,
  recordPricingEvaluation,
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

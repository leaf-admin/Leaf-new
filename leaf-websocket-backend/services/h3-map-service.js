const h3 = require('h3-js');
const { logStructured } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const { normalizeDriverStatus } = require('./dashboard-live-data-service');

const CACHE_TTL_MS = Number.parseInt(process.env.H3_MAP_CACHE_TTL_MS || '5000', 10);
const MAX_CELLS = Number.parseInt(process.env.H3_MAP_MAX_CELLS || '500', 10);
const BBOX_MAX_SPAN_DEGREES = Number.parseFloat(process.env.H3_MAP_MAX_BBOX_SPAN_DEGREES || '5');
const SEARCH_SCAN_COUNT = Number.parseInt(process.env.H3_MAP_SCAN_COUNT || '250', 10);
const SEARCH_SCAN_MAX_KEYS = Number.parseInt(process.env.H3_MAP_SCAN_MAX_KEYS || '4000', 10);
const OPEN_REQUEST_ACTIVE_WINDOW_MS = Number.parseInt(process.env.H3_MAP_OPEN_REQUEST_WINDOW_MS || String(10 * 60 * 1000), 10);
const ACTIVE_BOOKING_STALE_MS = Number.parseInt(process.env.H3_MAP_ACTIVE_BOOKING_STALE_MS || String(12 * 60 * 60 * 1000), 10);
const MAX_DYNAMIC_SURGE_PERCENT = Math.min(
  35,
  Math.max(0, Number.parseInt(process.env.MAX_DYNAMIC_SURGE_PERCENT || '35', 10) || 35)
);
const SURGE_LABEL_MIN_PERCENT = Math.max(
  1,
  Number.parseInt(process.env.H3_MAP_SURGE_LABEL_MIN_PERCENT || '3', 10) || 3
);
const MIN_GEO_QUERY_KM = 0.1;
const SUPPORTED_SURFACES = new Set(['driver', 'dashboard']);
const SUPPORTED_MODES = new Set(['supply_demand']);
const SEARCHABLE_STATES = new Set(['SEARCHING', 'PENDING', 'EXPANDED', 'NOTIFIED', 'AWAITING_RESPONSE', 'REASSIGNMENT_PENDING']);
const ACTIVE_TRIP_STATES = new Set(['MATCHED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'REASSIGNED_IN_PROGRESS', 'STARTED']);
const TERMINAL_TRIP_STATES = new Set([
  'COMPLETED',
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
  'REJECTED',
  'EARLY_ENDED_BY_RIDER',
  'INTERRUPTED_OPERATIONAL_ENDED',
  'EARLY_ENDED_REVIEW'
]);

function createHttpError(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function parseBoolean(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBBox(rawBBox) {
  const parts = String(rawBBox || '')
    .split(',')
    .map((item) => Number.parseFloat(item));

  if (parts.length !== 4 || parts.some((item) => !Number.isFinite(item))) {
    throw createHttpError(400, 'bbox inválido. Use minLng,minLat,maxLng,maxLat');
  }

  const [rawMinLng, rawMinLat, rawMaxLng, rawMaxLat] = parts;
  const minLng = Math.min(rawMinLng, rawMaxLng);
  const maxLng = Math.max(rawMinLng, rawMaxLng);
  const minLat = Math.min(rawMinLat, rawMaxLat);
  const maxLat = Math.max(rawMinLat, rawMaxLat);
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;

  if (lngSpan <= 0 || latSpan <= 0) {
    throw createHttpError(400, 'bbox inválido. Área precisa ser maior que zero.');
  }

  if (lngSpan > BBOX_MAX_SPAN_DEGREES || latSpan > BBOX_MAX_SPAN_DEGREES) {
    throw createHttpError(400, 'Viewport muito grande para H3. Aproximar o mapa antes de consultar.', {
      maxSpanDegrees: BBOX_MAX_SPAN_DEGREES
    });
  }

  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    lngSpan,
    latSpan
  };
}

function normalizeBBoxForCache(bbox) {
  const round = (value) => Number(value).toFixed(4);
  return [round(bbox.minLng), round(bbox.minLat), round(bbox.maxLng), round(bbox.maxLat)].join(',');
}

function resolutionForZoom(zoom) {
  const safeZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : 13;
  if (safeZoom <= 10) return 6;
  if (safeZoom <= 12) return 7;
  if (safeZoom <= 14) return 8;
  if (safeZoom <= 16) return 9;
  return 10;
}

function isPointInBBox(location, bbox) {
  const lat = normalizeNumber(location?.lat ?? location?.latitude);
  const lng = normalizeNumber(location?.lng ?? location?.longitude);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= bbox.minLat
    && lat <= bbox.maxLat
    && lng >= bbox.minLng
    && lng <= bbox.maxLng;
}

function parseLocation(rawValue) {
  if (!rawValue) return null;

  if (typeof rawValue === 'object') {
    const lat = normalizeNumber(rawValue.lat ?? rawValue.latitude);
    const lng = normalizeNumber(rawValue.lng ?? rawValue.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        ...rawValue,
        lat,
        lng
      };
    }
    return null;
  }

  if (typeof rawValue !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parseLocation(parsed);
  } catch (_error) {
    return null;
  }
}

function normalizeBookingStatus(rawStatus, rawState) {
  const status = String(rawStatus || '').trim().toUpperCase();
  const state = String(rawState || '').trim().toUpperCase();
  return status || state || 'UNKNOWN';
}

function parseBookingTimestampMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : null;
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }

  const asDate = Date.parse(String(value));
  return Number.isFinite(asDate) ? asDate : null;
}

function resolveBookingFreshnessMs(booking = {}) {
  const candidates = [
    booking.updatedAt,
    booking.completedAt,
    booking.cancelledAt,
    booking.canceledAt,
    booking.endedAt,
    booking.finishedAt,
    booking.startedAt,
    booking.acceptedAt,
    booking.createdAt,
    booking.timestamp
  ]
    .map(parseBookingTimestampMs)
    .filter((value) => Number.isFinite(value));

  if (!candidates.length) {
    return null;
  }

  return Math.max(...candidates);
}

function resolveDemandLevel({ demand, availableDrivers, imbalance }) {
  if (demand <= 0 && availableDrivers <= 0) return 'low';
  if (demand >= 8 || imbalance >= 3) return 'critical';
  if (demand >= 4 || imbalance >= 1.5) return 'high';
  if (demand >= 2 || imbalance >= 1) return 'medium';
  return 'low';
}

function resolveFillRateHint({ demand, availableDrivers, surplus, imbalance }) {
  if (demand <= 0 && availableDrivers <= 0) return 'idle';
  if (availableDrivers <= 0 && demand > 0) return 'critical';
  if (imbalance >= 2 || surplus <= -3) return 'tight';
  if (imbalance > 1 || surplus < 0) return 'warming';
  if (surplus >= 3) return 'surplus';
  return 'balanced';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hexColor) {
  const normalized = String(hexColor || '').replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  if (expanded.length !== 6) {
    return { r: 34, g: 197, b: 94 };
  }

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHexColors(fromColor, toColor, ratio) {
  const safeRatio = clamp(Number(ratio) || 0, 0, 1);
  const from = hexToRgb(fromColor);
  const to = hexToRgb(toColor);
  return rgbToHex({
    r: from.r + ((to.r - from.r) * safeRatio),
    g: from.g + ((to.g - from.g) * safeRatio),
    b: from.b + ((to.b - from.b) * safeRatio)
  });
}

function interpolatePalette(score, stops, fallbackColor) {
  const safeScore = clamp(Number(score) || 0, 0, 1);
  if (!Array.isArray(stops) || stops.length === 0) {
    return fallbackColor;
  }

  if (safeScore <= stops[0].at) {
    return stops[0].color;
  }

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const next = stops[index];
    if (safeScore <= next.at) {
      const span = Math.max(0.0001, next.at - previous.at);
      const ratio = (safeScore - previous.at) / span;
      return mixHexColors(previous.color, next.color, ratio);
    }
  }

  return stops[stops.length - 1]?.color || fallbackColor;
}

function buildVisualIntensity(metrics = {}, level = 'low') {
  const demandNorm = clamp((Number(metrics.demand) || 0) / 8, 0, 1);
  const imbalanceNorm = clamp((Number(metrics.imbalance) || 0) / 3, 0, 1);
  const shortageNorm = clamp(Math.max(0, -(Number(metrics.surplus) || 0)) / 4, 0, 1);
  const openRequestsNorm = clamp((Number(metrics.openRequests) || 0) / 5, 0, 1);

  if (demandNorm === 0 && imbalanceNorm === 0 && shortageNorm === 0 && openRequestsNorm === 0) {
    return 0;
  }

  const weightedScore =
    (0.4 * demandNorm) +
    (0.35 * imbalanceNorm) +
    (0.15 * shortageNorm) +
    (0.1 * openRequestsNorm);

  const levelFloor = {
    low: 0.04,
    medium: 0.28,
    high: 0.54,
    critical: 0.78
  };

  const floor = levelFloor[level] ?? 0.04;
  return clamp(Math.max(weightedScore, floor), 0, 1);
}

function buildSurgeDisplay(metrics = {}, level = 'low') {
  const visualIntensity = buildVisualIntensity(metrics, level);
  const demand = Number(metrics.demand || 0);
  const imbalance = Number(metrics.imbalance || 0);
  const shortage = Math.max(0, -(Number(metrics.surplus) || 0));

  if (demand <= 0 || (imbalance <= 0 && shortage <= 0)) {
    return {
      percent: 0,
      multiplier: 1,
      level: 'normal',
      label: '',
      labelVisible: false
    };
  }

  const percent = Math.min(
    MAX_DYNAMIC_SURGE_PERCENT,
    Math.max(0, Math.round(visualIntensity * MAX_DYNAMIC_SURGE_PERCENT))
  );
  let surgeLevel = 'yellow';
  if (percent >= 25) surgeLevel = 'purple';
  else if (percent >= 13) surgeLevel = 'red';

  return {
    percent,
    multiplier: Number((1 + percent / 100).toFixed(2)),
    level: percent > 0 ? surgeLevel : 'normal',
    label: percent > 0 ? `+${percent}%` : '',
    labelVisible: percent >= SURGE_LABEL_MIN_PERCENT
  };
}

function buildStyle(level, surface, resolution = 8, metrics = {}) {
  const dashboard = surface === 'dashboard';
  const resolutionBias = clamp((Number(resolution || 8) - 6) / 4, 0, 1);
  const visualIntensity = buildVisualIntensity(metrics, level);
  const surge = buildSurgeDisplay(metrics, level);

  if (surface === 'driver') {
    if (surge.percent <= 0) {
      return {
        fill: '#000000',
        stroke: '#000000',
        fillOpacity: 0,
        strokeOpacity: 0,
        strokeWidth: 0,
        visualIntensity: 0
      };
    }

    const fillByLevel = {
      yellow: '#FACC15',
      red: '#EF4444',
      purple: '#7E22CE'
    };
    const strokeByLevel = {
      yellow: '#CA8A04',
      red: '#B91C1C',
      purple: '#581C87'
    };
    const surgeStrength = clamp(surge.percent / Math.max(1, MAX_DYNAMIC_SURGE_PERCENT), 0, 1);

    return {
      fill: fillByLevel[surge.level] || '#FACC15',
      stroke: strokeByLevel[surge.level] || '#CA8A04',
      fillOpacity: Number((0.11 + (0.22 * surgeStrength) + (0.025 * resolutionBias)).toFixed(3)),
      strokeOpacity: Number((0.26 + (0.34 * surgeStrength) + (0.025 * resolutionBias)).toFixed(3)),
      strokeWidth: Number((0.35 + (0.45 * surgeStrength) + (0.1 * resolutionBias)).toFixed(2)),
      visualIntensity: Number(visualIntensity.toFixed(3))
    };
  }

  const fill = interpolatePalette(visualIntensity, [
    { at: 0, color: '#22C55E' },
    { at: 0.42, color: '#FACC15' },
    { at: 0.72, color: '#F59E0B' },
    { at: 1, color: '#EF4444' }
  ], '#22C55E');
  const stroke = interpolatePalette(visualIntensity, [
    { at: 0, color: '#15803D' },
    { at: 0.42, color: '#CA8A04' },
    { at: 0.72, color: '#B45309' },
    { at: 1, color: '#B91C1C' }
  ], '#15803D');
  const fillOpacity = dashboard
    ? 0.015 + (0.055 * visualIntensity) + (0.01 * resolutionBias)
    : 0.025 + (0.075 * visualIntensity) + (0.012 * resolutionBias);
  const strokeOpacity = dashboard
    ? 0.04 + (0.09 * visualIntensity) + (0.012 * resolutionBias)
    : 0.055 + (0.11 * visualIntensity) + (0.015 * resolutionBias);
  const strokeWidth = dashboard
    ? 0.2 + (0.22 * visualIntensity) + (0.06 * resolutionBias)
    : 0.24 + (0.26 * visualIntensity) + (0.08 * resolutionBias);

  return {
    fill,
    stroke,
    fillOpacity: Number(fillOpacity.toFixed(3)),
    strokeOpacity: Number(strokeOpacity.toFixed(3)),
    strokeWidth: Number(strokeWidth.toFixed(2)),
    visualIntensity: Number(visualIntensity.toFixed(3))
  };
}

function buildBoundary(h3Index) {
  return h3.cellToBoundary(h3Index).map(([lat, lng]) => ({ lat, lng }));
}

function getBBoxLoop(bbox) {
  return [
    [bbox.minLat, bbox.minLng],
    [bbox.minLat, bbox.maxLng],
    [bbox.maxLat, bbox.maxLng],
    [bbox.maxLat, bbox.minLng],
    [bbox.minLat, bbox.minLng]
  ];
}

function getViewportH3Cells(bbox, resolution) {
  const loop = getBBoxLoop(bbox);

  if (
    typeof h3.polygonToCellsExperimental === 'function'
    && h3.POLYGON_TO_CELLS_FLAGS?.containmentOverlapping
  ) {
    return h3.polygonToCellsExperimental(
      loop,
      resolution,
      h3.POLYGON_TO_CELLS_FLAGS.containmentOverlapping
    );
  }

  return h3.polygonToCells(loop, resolution);
}

function toRadians(value) {
  return value * (Math.PI / 180);
}

function bboxToGeoWindow(bbox) {
  const centerLat = (bbox.minLat + bbox.maxLat) / 2;
  const centerLng = (bbox.minLng + bbox.maxLng) / 2;
  const latKmPerDegree = 110.574;
  const lngKmPerDegree = 111.320 * Math.max(0.01, Math.cos(toRadians(centerLat)));
  const widthKm = Math.max(MIN_GEO_QUERY_KM, (bbox.maxLng - bbox.minLng) * lngKmPerDegree);
  const heightKm = Math.max(MIN_GEO_QUERY_KM, (bbox.maxLat - bbox.minLat) * latKmPerDegree);
  const radiusKm = Math.max(MIN_GEO_QUERY_KM, Math.sqrt((widthKm ** 2) + (heightKm ** 2)) / 2);

  return {
    centerLat,
    centerLng,
    widthKm,
    heightKm,
    radiusKm
  };
}

function extractRedisReplyValue(reply) {
  if (Array.isArray(reply)) {
    return reply[1];
  }
  return reply;
}

async function scanKeys(redis, pattern, count = SEARCH_SCAN_COUNT, maxKeys = SEARCH_SCAN_MAX_KEYS) {
  const keys = [];
  const safeCount = Math.max(10, Number.parseInt(count, 10) || SEARCH_SCAN_COUNT);
  const safeMaxKeys = Number.isFinite(Number(maxKeys)) && Number(maxKeys) > 0
    ? Number(maxKeys)
    : null;
  let cursor = '0';

  do {
    const response = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', safeCount);
    cursor = Array.isArray(response) ? String(response[0]) : '0';
    const batch = Array.isArray(response?.[1]) ? response[1] : [];
    keys.push(...batch);

    if (safeMaxKeys !== null && keys.length >= safeMaxKeys) {
      return keys.slice(0, safeMaxKeys);
    }
  } while (cursor !== '0');

  return keys;
}

class H3MapService {
  constructor() {
    this.cache = new Map();
  }

  getCacheKey({ bbox, resolution, surface, mode, includeEmpty, includeBoundary }) {
    return [
      normalizeBBoxForCache(bbox),
      resolution,
      surface,
      mode,
      includeEmpty ? '1' : '0',
      includeBoundary ? '1' : '0'
    ].join(':');
  }

  getCached(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return cached.value;
  }

  setCached(key, value) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
  }

  async getCells({
    redis,
    bbox: rawBBox,
    zoom,
    surface = 'dashboard',
    mode = 'supply_demand',
    includeEmpty = false,
    includeBoundary = true
  }) {
    if (!redis) {
      throw createHttpError(503, 'Redis indisponível para montar mapa H3');
    }

    const bbox = parseBBox(rawBBox);
    if (!SUPPORTED_SURFACES.has(surface)) {
      throw createHttpError(400, 'surface inválido. Use driver ou dashboard.');
    }
    if (!SUPPORTED_MODES.has(mode)) {
      throw createHttpError(400, 'mode inválido. Use supply_demand.');
    }

    let resolution = resolutionForZoom(zoom);
    const cacheKey = this.getCacheKey({ bbox, resolution, surface, mode, includeEmpty, includeBoundary });
    metrics.recordH3CellsRequest(surface, mode);

    const cached = this.getCached(cacheKey);
    if (cached) {
      metrics.recordH3CellsCache(surface, mode, true);
      metrics.recordH3CellsReturned(surface, mode, cached.summary?.cells || 0);
      return {
        ...cached,
        cacheHit: true
      };
    }

    metrics.recordH3CellsCache(surface, mode, false);
    const startedAt = Date.now();
    const snapshot = await this.collectSnapshot(redis, bbox);

    let payload = this.buildPayload({
      bbox,
      resolution,
      surface,
      includeEmpty,
      includeBoundary,
      snapshot
    });

    while (payload.cells.length > MAX_CELLS && resolution > 1) {
      resolution -= 1;
      payload = this.buildPayload({
        bbox,
        resolution,
        surface,
        includeEmpty,
        includeBoundary,
        snapshot
      });
    }

    const durationMs = Date.now() - startedAt;
    metrics.recordH3CellsCompute(surface, mode, durationMs);
    metrics.recordH3CellsReturned(surface, mode, payload.summary?.cells || 0);

    const finalPayload = {
      ...payload,
      cacheHit: false
    };

    this.setCached(
      this.getCacheKey({ bbox, resolution: payload.resolution, surface, mode, includeEmpty, includeBoundary }),
      payload
    );

    logStructured('info', 'H3 viewport gerado', {
      service: 'h3-map-service',
      surface,
      mode,
      resolution: payload.resolution,
      cellsReturned: payload.summary?.cells || 0,
      driversCount: snapshot.drivers.length,
      openRequestsCount: snapshot.openRequests.length,
      activeTripsCount: snapshot.activeTrips.length,
      cacheHit: false,
      computeMs: durationMs,
      bbox: normalizeBBoxForCache(bbox)
    });

    return finalPayload;
  }

  async collectSnapshot(redis, bbox) {
    const [drivers, openRequests, activeTrips] = await Promise.all([
      this.collectDrivers(redis, bbox),
      this.collectOpenRequests(redis, bbox),
      this.collectActiveTrips(redis, bbox)
    ]);

    return {
      drivers,
      openRequests,
      activeTrips
    };
  }

  async collectDriverIdsInBBox(redis, bbox) {
    const geoWindow = bboxToGeoWindow(bbox);

    if (typeof redis.geosearch === 'function') {
      try {
        const members = await redis.geosearch(
          'driver_locations',
          'FROMLONLAT',
          geoWindow.centerLng,
          geoWindow.centerLat,
          'BYBOX',
          geoWindow.widthKm,
          geoWindow.heightKm,
          'km'
        );
        if (Array.isArray(members)) {
          return members;
        }
      } catch (_error) {
        // fallback para GEO legacy abaixo
      }
    }

    if (typeof redis.georadius === 'function') {
      try {
        const members = await redis.georadius(
          'driver_locations',
          geoWindow.centerLng,
          geoWindow.centerLat,
          geoWindow.radiusKm,
          'km'
        );
        if (Array.isArray(members)) {
          return members;
        }
      } catch (_error) {
        // fallback para ZRANGE abaixo
      }
    }

    return redis.zrange('driver_locations', 0, -1).catch(() => []);
  }

  async collectEligibleDriversSet(redis, driverIds) {
    if (!Array.isArray(driverIds) || driverIds.length === 0) {
      return new Set();
    }

    if (typeof redis.zmscore === 'function') {
      try {
        const scores = await redis.zmscore('driver_locations_eligible', ...driverIds);
        if (Array.isArray(scores)) {
          const eligible = new Set();
          scores.forEach((score, index) => {
            if (score !== null && score !== undefined) {
              eligible.add(driverIds[index]);
            }
          });
          return eligible;
        }
      } catch (_error) {
        // fallback para pipeline/zrange
      }
    }

    if (typeof redis.pipeline === 'function') {
      try {
        const pipeline = redis.pipeline();
        if (typeof pipeline.zscore === 'function') {
          driverIds.forEach((driverId) => {
            pipeline.zscore('driver_locations_eligible', driverId);
          });

          const rows = await pipeline.exec();
          const eligible = new Set();
          rows.forEach((row, index) => {
            const score = extractRedisReplyValue(row);
            if (score !== null && score !== undefined) {
              eligible.add(driverIds[index]);
            }
          });
          return eligible;
        }
      } catch (_error) {
        // fallback para zrange
      }
    }

    const eligibleDriverIds = await redis.zrange('driver_locations_eligible', 0, -1).catch(() => []);
    return new Set(Array.isArray(eligibleDriverIds) ? eligibleDriverIds : []);
  }

  async collectDrivers(redis, bbox) {
    const driverIds = await this.collectDriverIdsInBBox(redis, bbox);

    if (!Array.isArray(driverIds) || driverIds.length === 0) {
      return [];
    }

    const eligibleSet = await this.collectEligibleDriversSet(redis, driverIds);
    let rows = [];
    if (typeof redis.pipeline === 'function') {
      const pipeline = redis.pipeline();
      driverIds.forEach((driverId) => {
        pipeline.geopos('driver_locations', driverId);
        pipeline.hgetall(`driver:${driverId}`);
      });
      rows = await pipeline.exec();
    }

    const drivers = [];
    for (let index = 0; index < driverIds.length; index += 1) {
      const driverId = driverIds[index];
      const geoReply = rows.length > 0
        ? rows[index * 2]
        : await redis.geopos('driver_locations', driverId).catch(() => null);
      const hashReply = rows.length > 0
        ? rows[index * 2 + 1]
        : await redis.hgetall(`driver:${driverId}`).catch(() => ({}));
      const geoResult = extractRedisReplyValue(geoReply);
      const driverHash = extractRedisReplyValue(hashReply) || {};
      const coords = Array.isArray(geoResult) ? geoResult[0] : null;
      if (!coords || coords.length < 2) continue;

      const lng = normalizeNumber(coords[0]);
      const lat = normalizeNumber(coords[1]);
      const location = { lat, lng };
      if (!isPointInBBox(location, bbox)) continue;

      const isOnline = String(driverHash?.isOnline || 'true') === 'true';
      const normalizedStatus = normalizeDriverStatus(driverHash?.status, isOnline);
      const available = eligibleSet.has(driverId) || normalizedStatus === 'available';

      drivers.push({
        driverId,
        location,
        status: available ? 'available' : normalizedStatus,
        available
      });
    }

    return drivers;
  }

  async collectOpenRequests(redis, bbox) {
    const searchKeys = await scanKeys(redis, 'booking_search:*', SEARCH_SCAN_COUNT, SEARCH_SCAN_MAX_KEYS);
    if (!Array.isArray(searchKeys) || searchKeys.length === 0) {
      return [];
    }

    let rows = [];
    let supportsHmget = false;

    if (typeof redis.pipeline === 'function') {
      const pipeline = redis.pipeline();
      supportsHmget = typeof pipeline.hmget === 'function';
      searchKeys.forEach((key) => {
        if (supportsHmget) {
          pipeline.hmget(key, 'state', 'pickupLocation', 'createdAt');
        } else {
          pipeline.hgetall(key);
        }
      });
      rows = await pipeline.exec();
    }
    const now = Date.now();
    const requests = [];

    for (let index = 0; index < searchKeys.length; index += 1) {
      const key = searchKeys[index];
      const replyValue = rows.length > 0
        ? extractRedisReplyValue(rows[index])
        : await redis.hgetall(key).catch(() => ({}));
      const hash = supportsHmget
        ? {
          state: Array.isArray(replyValue) ? replyValue[0] : null,
          pickupLocation: Array.isArray(replyValue) ? replyValue[1] : null,
          createdAt: Array.isArray(replyValue) ? replyValue[2] : null
        }
        : (replyValue || {});
      const state = String(hash.state || '').trim().toUpperCase();
      if (!SEARCHABLE_STATES.has(state)) continue;

      const pickupLocation = parseLocation(hash.pickupLocation);
      if (!isPointInBBox(pickupLocation, bbox)) continue;

      const createdAt = normalizeNumber(hash.createdAt, now);
      const isRecent = now - createdAt <= OPEN_REQUEST_ACTIVE_WINDOW_MS;

      requests.push({
        bookingId: key.replace(/^booking_search:/, ''),
        pickupLocation,
        createdAt,
        isRecent,
        state
      });
    }

    return requests;
  }

  async collectActiveTrips(redis, bbox) {
    const activeHash = await redis.hgetall('bookings:active').catch(() => ({}));
    const entries = Object.entries(activeHash || {});
    if (entries.length === 0) {
      return [];
    }

    const trips = [];
    const staleBookingIds = [];
    const nowMs = Date.now();
    for (const [bookingId, rawBooking] of entries) {
      let booking = null;
      try {
        booking = typeof rawBooking === 'string' ? JSON.parse(rawBooking) : rawBooking;
      } catch (_error) {
        booking = null;
      }
      if (!booking || typeof booking !== 'object') continue;

      const normalizedStatus = normalizeBookingStatus(booking.status, booking.state);
      const normalizedState = String(booking.state || '').trim().toUpperCase();
      if (TERMINAL_TRIP_STATES.has(normalizedStatus) || TERMINAL_TRIP_STATES.has(normalizedState)) {
        staleBookingIds.push(bookingId);
        continue;
      }
      if (!ACTIVE_TRIP_STATES.has(normalizedStatus)) continue;

      const freshnessMs = resolveBookingFreshnessMs(booking);
      if (Number.isFinite(freshnessMs) && (nowMs - freshnessMs) > ACTIVE_BOOKING_STALE_MS) {
        staleBookingIds.push(bookingId);
        continue;
      }

      const location =
        parseLocation(booking.currentLocation) ||
        parseLocation(booking.driverLocation) ||
        parseLocation(booking.pickupLocation) ||
        parseLocation(booking.pickup) ||
        parseLocation(booking.destinationLocation) ||
        parseLocation(booking.drop);

      if (!isPointInBBox(location, bbox)) continue;

      trips.push({
        bookingId,
        driverId: booking.driverId || booking.driver || null,
        location,
        status: normalizedStatus
      });
    }

    if (staleBookingIds.length > 0) {
      try {
        if (typeof redis.pipeline === 'function') {
          const pipeline = redis.pipeline();
          staleBookingIds.forEach((bookingId) => {
            pipeline.hdel('bookings:active', bookingId);
          });
          await pipeline.exec();
        } else if (typeof redis.hdel === 'function') {
          await Promise.all(staleBookingIds.map((bookingId) => redis.hdel('bookings:active', bookingId)));
        }

        logStructured('info', 'H3 map cleanup removeu bookings ativos stale/terminais', {
          service: 'h3-map-service',
          removedBookings: staleBookingIds.length
        });
      } catch (cleanupError) {
        logStructured('warn', 'Falha ao limpar bookings:active stale durante snapshot H3', {
          service: 'h3-map-service',
          removedBookings: staleBookingIds.length,
          error: cleanupError.message
        });
      }
    }

    return trips;
  }

  buildPayload({ bbox, resolution, surface, includeEmpty, includeBoundary, snapshot }) {
    const aggregated = this.aggregateCells({
      bbox,
      resolution,
      surface,
      includeEmpty,
      includeBoundary,
      snapshot
    });

    const summary = aggregated.cells.reduce((accumulator, cell) => {
      accumulator.cells += 1;
      accumulator.driversOnline += cell.metrics.supply;
      accumulator.driversAvailable += cell.metrics.availableDrivers;
      accumulator.openRequests += cell.metrics.openRequests;
      accumulator.activeTrips += cell.metrics.activeTrips;
      accumulator.surgeCells += Number(cell.surge?.percent || 0) > 0 ? 1 : 0;
      accumulator.maxSurgePercent = Math.max(accumulator.maxSurgePercent, Number(cell.surge?.percent || 0));
      return accumulator;
    }, {
      cells: 0,
      driversOnline: 0,
      driversAvailable: 0,
      openRequests: 0,
      activeTrips: 0,
      surgeCells: 0,
      maxSurgePercent: 0
    });

    return {
      generatedAt: new Date().toISOString(),
      bbox: {
        minLng: bbox.minLng,
        minLat: bbox.minLat,
        maxLng: bbox.maxLng,
        maxLat: bbox.maxLat
      },
      resolution: aggregated.resolution,
      summary,
      cells: aggregated.cells
    };
  }

  aggregateCells({ bbox, resolution, surface, includeEmpty, includeBoundary, snapshot }) {
    const cells = new Map();

    const getCell = (h3Index) => {
      if (!cells.has(h3Index)) {
        cells.set(h3Index, {
          h3Index,
          resolution,
          supply: 0,
          availableDrivers: 0,
          busyDrivers: 0,
          demand: 0,
          openRequests: 0,
          activeTrips: 0
        });
      }
      return cells.get(h3Index);
    };

    snapshot.drivers.forEach((driver) => {
      const h3Index = h3.latLngToCell(driver.location.lat, driver.location.lng, resolution);
      const cell = getCell(h3Index);
      cell.supply += 1;
      if (driver.available) {
        cell.availableDrivers += 1;
      } else {
        cell.busyDrivers += 1;
      }
    });

    snapshot.openRequests.forEach((request) => {
      const h3Index = h3.latLngToCell(request.pickupLocation.lat, request.pickupLocation.lng, resolution);
      const cell = getCell(h3Index);
      cell.openRequests += 1;
      cell.demand += 1;
    });

    snapshot.activeTrips.forEach((trip) => {
      const h3Index = h3.latLngToCell(trip.location.lat, trip.location.lng, resolution);
      const cell = getCell(h3Index);
      cell.activeTrips += 1;
      cell.demand += 1;
    });

    if (includeEmpty) {
      const polygonCells = getViewportH3Cells(bbox, resolution);
      polygonCells.forEach((h3Index) => {
        if (!cells.has(h3Index)) {
          cells.set(h3Index, {
            h3Index,
            resolution,
            supply: 0,
            availableDrivers: 0,
            busyDrivers: 0,
            demand: 0,
            openRequests: 0,
            activeTrips: 0
          });
        }
      });
    }

    const normalizedCells = Array.from(cells.values())
      .map((cell) => {
        const center = h3.cellToLatLng(cell.h3Index);
        const imbalance = Number((cell.demand / Math.max(1, cell.availableDrivers)).toFixed(2));
        const surplus = cell.availableDrivers - cell.demand;
        const demandLevel = resolveDemandLevel({
          demand: cell.demand,
          availableDrivers: cell.availableDrivers,
          imbalance
        });
        const fillRateHint = resolveFillRateHint({
          demand: cell.demand,
          availableDrivers: cell.availableDrivers,
          surplus,
          imbalance
        });
        const styleInput = {
          demand: cell.demand,
          availableDrivers: cell.availableDrivers,
          openRequests: cell.openRequests,
          activeTrips: cell.activeTrips,
          imbalance,
          surplus
        };
        const surge = buildSurgeDisplay(styleInput, demandLevel);

        return {
          h3Index: cell.h3Index,
          resolution,
          center: {
            lat: center[0],
            lng: center[1]
          },
          boundary: includeBoundary ? buildBoundary(cell.h3Index) : [],
          metrics: {
            supply: cell.supply,
            availableDrivers: cell.availableDrivers,
            busyDrivers: cell.busyDrivers,
            demand: cell.demand,
            openRequests: cell.openRequests,
            activeTrips: cell.activeTrips,
            imbalance,
            surplus,
            demandLevel,
            fillRateHint
          },
          surge,
          style: buildStyle(demandLevel, surface, resolution, styleInput)
        };
      })
      .sort((left, right) => left.h3Index.localeCompare(right.h3Index));

    return {
      resolution,
      cells: normalizedCells
    };
  }
}

module.exports = new H3MapService();
module.exports.H3MapService = H3MapService;
module.exports.helpers = {
  parseBBox,
  resolutionForZoom,
  parseLocation,
  normalizeBookingStatus,
  isPointInBBox,
  resolveDemandLevel,
  resolveFillRateHint,
  buildStyle,
  buildSurgeDisplay,
  parseBoolean,
  getViewportH3Cells
};

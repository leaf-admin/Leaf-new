const h3 = require('h3-js');

const DEFAULT_RESOLUTION = Number.parseInt(process.env.PRICING_H3_RESOLUTION || '9', 10);
const CELL_TTL_SECONDS = Math.max(
  300,
  Number.parseInt(process.env.PRICING_H3_READMODEL_CELL_TTL_SECONDS || String(4 * 60 * 60), 10) || (4 * 60 * 60)
);
const DEFAULT_MAX_STALE_MS = Math.max(
  1000,
  Number.parseInt(process.env.PRICING_H3_READMODEL_MAX_STALE_MS || '15000', 10) || 15000
);

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

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLocation(rawValue) {
  if (!rawValue) return null;

  if (typeof rawValue === 'object') {
    const lat = toNumber(rawValue.lat ?? rawValue.latitude);
    const lng = toNumber(rawValue.lng ?? rawValue.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return {
      ...rawValue,
      lat,
      lng
    };
  }

  if (typeof rawValue !== 'string') {
    return null;
  }

  try {
    return parseLocation(JSON.parse(rawValue));
  } catch (_error) {
    return null;
  }
}

function normalizeBookingStatus(rawStatus, rawState) {
  const status = String(rawStatus || '').trim().toUpperCase();
  const state = String(rawState || '').trim().toUpperCase();
  return status || state || 'UNKNOWN';
}

function buildCellKey(resolution, h3Index) {
  return `h3:pricing:cell:${resolution}:${h3Index}`;
}

function buildDriverStateKey(resolution) {
  return `h3:pricing:drivers:${resolution}`;
}

function buildBookingStateKey(resolution) {
  return `h3:pricing:bookings:${resolution}`;
}

function buildMetaKey(resolution) {
  return `h3:pricing:meta:${resolution}`;
}

function parseState(rawValue) {
  if (!rawValue) return null;
  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function cellForLocation(location, resolution) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    return null;
  }
  return h3.latLngToCell(location.lat, location.lng, resolution);
}

function normalizeDriverSnapshot({
  driverId,
  lat,
  lng,
  isOnline = true,
  available = true
}, resolution) {
  if (!driverId) return null;

  const numericLat = toNumber(lat);
  const numericLng = toNumber(lng);
  const online = isOnline !== false;
  if (!online || !Number.isFinite(numericLat) || !Number.isFinite(numericLng)) {
    return {
      driverId,
      isOnline: false,
      available: false,
      cell: null
    };
  }

  return {
    driverId,
    isOnline: true,
    available: available !== false,
    cell: cellForLocation({ lat: numericLat, lng: numericLng }, resolution)
  };
}

function normalizeBookingSnapshot(bookingLike = {}, resolution) {
  const bookingId = bookingLike.bookingId || bookingLike.id || null;
  if (!bookingId) return null;

  const status = normalizeBookingStatus(bookingLike.status, bookingLike.state);
  const pickupLocation = parseLocation(bookingLike.pickupLocation || bookingLike.pickup);
  const destinationLocation = parseLocation(bookingLike.destinationLocation || bookingLike.drop);
  const tripLocation = (
    parseLocation(bookingLike.currentLocation) ||
    parseLocation(bookingLike.driverLocation) ||
    parseLocation(bookingLike.location) ||
    pickupLocation ||
    destinationLocation
  );

  const searchActive = SEARCHABLE_STATES.has(status);
  const tripActive = ACTIVE_TRIP_STATES.has(status);
  const terminal = TERMINAL_TRIP_STATES.has(status);

  return {
    bookingId,
    status,
    terminal,
    searchCell: searchActive ? cellForLocation(pickupLocation, resolution) : null,
    tripCell: tripActive ? cellForLocation(tripLocation, resolution) : null,
    searchActive,
    tripActive
  };
}

function queueCellUpdate(pipeline, resolution, h3Index, field, delta, updatedAtIso) {
  if (!pipeline || !h3Index || !field || !Number.isFinite(delta) || delta === 0) {
    return;
  }
  const cellKey = buildCellKey(resolution, h3Index);
  pipeline.hincrby(cellKey, field, delta);
  pipeline.hset(cellKey, 'updatedAt', updatedAtIso);
  pipeline.expire(cellKey, CELL_TTL_SECONDS);
}

function queueMetaTouch(pipeline, resolution, updatedAtIso) {
  pipeline.set(buildMetaKey(resolution), updatedAtIso, 'EX', CELL_TTL_SECONDS);
}

async function applyDriverSnapshot(redis, payload, options = {}) {
  if (!redis || !payload?.driverId || typeof redis.hget !== 'function' || typeof redis.pipeline !== 'function') return;

  const resolution = Number.isFinite(options.resolution) ? options.resolution : DEFAULT_RESOLUTION;
  const driverStateKey = buildDriverStateKey(resolution);
  const updatedAtIso = options.updatedAt || new Date().toISOString();
  const previous = parseState(await redis.hget(driverStateKey, payload.driverId));
  const next = normalizeDriverSnapshot(payload, resolution);

  const pipeline = redis.pipeline();

  if (previous?.cell && previous?.isOnline) {
    const previousField = previous.available ? 'availableDrivers' : 'busyDrivers';
    const sameCell = previous.cell === next?.cell;
    const sameAvailability = Boolean(previous.available) === Boolean(next?.available);
    const shouldKeepPrevious = sameCell && sameAvailability && next?.isOnline;
    if (!shouldKeepPrevious) {
      queueCellUpdate(pipeline, resolution, previous.cell, previousField, -1, updatedAtIso);
    }
  }

  if (next?.cell && next?.isOnline) {
    const nextField = next.available ? 'availableDrivers' : 'busyDrivers';
    const sameCell = previous?.cell === next.cell;
    const sameAvailability = Boolean(previous?.available) === Boolean(next.available);
    const shouldSkipIncrement = sameCell && sameAvailability && previous?.isOnline;
    if (!shouldSkipIncrement) {
      queueCellUpdate(pipeline, resolution, next.cell, nextField, 1, updatedAtIso);
    }
    pipeline.hset(driverStateKey, payload.driverId, JSON.stringify(next));
    pipeline.expire(driverStateKey, CELL_TTL_SECONDS);
  } else {
    pipeline.hdel(driverStateKey, payload.driverId);
    pipeline.expire(driverStateKey, CELL_TTL_SECONDS);
  }

  queueMetaTouch(pipeline, resolution, updatedAtIso);
  await pipeline.exec();
}

async function removeDriverSnapshot(redis, driverId, options = {}) {
  if (!redis || !driverId) return;
  return applyDriverSnapshot(redis, {
    driverId,
    isOnline: false,
    available: false
  }, options);
}

async function applyBookingSnapshot(redis, bookingLike, options = {}) {
  if (!redis || typeof redis.hget !== 'function' || typeof redis.pipeline !== 'function') return;

  const resolution = Number.isFinite(options.resolution) ? options.resolution : DEFAULT_RESOLUTION;
  const bookingStateKey = buildBookingStateKey(resolution);
  const normalized = normalizeBookingSnapshot(bookingLike, resolution);
  if (!normalized?.bookingId) return;

  const updatedAtIso = options.updatedAt || new Date().toISOString();
  const previous = parseState(await redis.hget(bookingStateKey, normalized.bookingId));
  const pipeline = redis.pipeline();

  if (previous?.searchActive && previous?.searchCell) {
    const keepSearch = normalized.searchActive && normalized.searchCell === previous.searchCell;
    if (!keepSearch) {
      queueCellUpdate(pipeline, resolution, previous.searchCell, 'openRequests', -1, updatedAtIso);
    }
  }

  if (previous?.tripActive && previous?.tripCell) {
    const keepTrip = normalized.tripActive && normalized.tripCell === previous.tripCell;
    if (!keepTrip) {
      queueCellUpdate(pipeline, resolution, previous.tripCell, 'activeTrips', -1, updatedAtIso);
    }
  }

  if (normalized.searchActive && normalized.searchCell) {
    const shouldIncrementSearch = !previous?.searchActive || previous.searchCell !== normalized.searchCell;
    if (shouldIncrementSearch) {
      queueCellUpdate(pipeline, resolution, normalized.searchCell, 'openRequests', 1, updatedAtIso);
    }
  }

  if (normalized.tripActive && normalized.tripCell) {
    const shouldIncrementTrip = !previous?.tripActive || previous.tripCell !== normalized.tripCell;
    if (shouldIncrementTrip) {
      queueCellUpdate(pipeline, resolution, normalized.tripCell, 'activeTrips', 1, updatedAtIso);
    }
  }

  if (normalized.terminal || (!normalized.searchActive && !normalized.tripActive)) {
    pipeline.hdel(bookingStateKey, normalized.bookingId);
  } else {
    pipeline.hset(bookingStateKey, normalized.bookingId, JSON.stringify({
      bookingId: normalized.bookingId,
      status: normalized.status,
      searchActive: normalized.searchActive,
      searchCell: normalized.searchCell,
      tripActive: normalized.tripActive,
      tripCell: normalized.tripCell,
      updatedAt: updatedAtIso
    }));
    pipeline.expire(bookingStateKey, CELL_TTL_SECONDS);
  }

  queueMetaTouch(pipeline, resolution, updatedAtIso);
  await pipeline.exec();
}

async function clearBookingSnapshot(redis, bookingId, options = {}) {
  if (!redis || !bookingId || typeof redis.hget !== 'function' || typeof redis.pipeline !== 'function') return;
  const resolution = Number.isFinite(options.resolution) ? options.resolution : DEFAULT_RESOLUTION;
  const bookingStateKey = buildBookingStateKey(resolution);
  const updatedAtIso = options.updatedAt || new Date().toISOString();
  const previous = parseState(await redis.hget(bookingStateKey, bookingId));
  if (!previous) return;

  const pipeline = redis.pipeline();
  if (previous.searchActive && previous.searchCell) {
    queueCellUpdate(pipeline, resolution, previous.searchCell, 'openRequests', -1, updatedAtIso);
  }
  if (previous.tripActive && previous.tripCell) {
    queueCellUpdate(pipeline, resolution, previous.tripCell, 'activeTrips', -1, updatedAtIso);
  }
  pipeline.hdel(bookingStateKey, bookingId);
  pipeline.expire(bookingStateKey, CELL_TTL_SECONDS);
  queueMetaTouch(pipeline, resolution, updatedAtIso);
  await pipeline.exec();
}

function normalizeCellMetrics(rawCell = {}) {
  return {
    supply: Math.max(0, toNumber(rawCell.supply, 0) || 0),
    availableDrivers: Math.max(0, toNumber(rawCell.availableDrivers, 0) || 0),
    busyDrivers: Math.max(0, toNumber(rawCell.busyDrivers, 0) || 0),
    demand: Math.max(0, toNumber(rawCell.demand, 0) || 0),
    openRequests: Math.max(0, toNumber(rawCell.openRequests, 0) || 0),
    activeTrips: Math.max(0, toNumber(rawCell.activeTrips, 0) || 0),
    updatedAt: rawCell.updatedAt || null
  };
}

function enrichMetrics(metrics = {}) {
  const supply = Math.max(0, Number(metrics.supply ?? (metrics.availableDrivers + metrics.busyDrivers) ?? 0));
  const availableDrivers = Math.max(0, Number(metrics.availableDrivers || 0));
  const busyDrivers = Math.max(0, Number(metrics.busyDrivers || 0));
  const openRequests = Math.max(0, Number(metrics.openRequests || 0));
  const activeTrips = Math.max(0, Number(metrics.activeTrips || 0));
  const demand = Math.max(openRequests + activeTrips, Number(metrics.demand || 0));
  const imbalance = availableDrivers > 0
    ? Number((demand / availableDrivers).toFixed(2))
    : (demand > 0 ? demand : 0);

  let demandLevel = 'low';
  if (demand >= 8 || imbalance >= 3) demandLevel = 'critical';
  else if (demand >= 4 || imbalance >= 1.5) demandLevel = 'high';
  else if (demand >= 2 || imbalance >= 1) demandLevel = 'medium';

  return {
    supply,
    availableDrivers,
    busyDrivers,
    demand,
    openRequests,
    activeTrips,
    imbalance,
    demandLevel
  };
}

function emptyMetrics() {
  return enrichMetrics(normalizeCellMetrics({}));
}

async function getAggregatedCells(redis, {
  cells = [],
  resolution = DEFAULT_RESOLUTION,
  maxStaleMs = DEFAULT_MAX_STALE_MS
} = {}) {
  const uniqueCells = [...new Set((Array.isArray(cells) ? cells : []).filter(Boolean))];
  if (!redis || uniqueCells.length === 0) {
    return {
      usable: false,
      reason: 'missing_input',
      cells: [],
      touchedCells: 0,
      staleCells: 0,
      lastMutationAt: null
    };
  }

  if (typeof redis.pipeline !== 'function') {
    return {
      usable: false,
      reason: 'pipeline_unavailable',
      cells: [],
      touchedCells: 0,
      staleCells: 0,
      lastMutationAt: null
    };
  }

  const pipeline = redis.pipeline();
  uniqueCells.forEach((h3Index) => {
    pipeline.hgetall(buildCellKey(resolution, h3Index));
  });
  pipeline.get(buildMetaKey(resolution));
  const rows = await pipeline.exec();
  const metaRow = rows.pop();
  const lastMutationAt = metaRow?.[1] || null;
  const nowMs = Date.now();
  const lastMutationAtMs = lastMutationAt ? Date.parse(lastMutationAt) : NaN;
  const metaFresh = Number.isFinite(lastMutationAtMs) && (nowMs - lastMutationAtMs) <= maxStaleMs;

  let touchedCells = 0;
  let staleCells = 0;
  let freshTouchedCells = 0;
  const cellStates = uniqueCells.map((h3Index, index) => {
    const raw = rows[index]?.[1] || {};
    const normalized = normalizeCellMetrics(raw);
    const updatedAtMs = normalized.updatedAt ? Date.parse(normalized.updatedAt) : NaN;
    const touched = Object.keys(raw || {}).length > 0;
    const stale = touched && Number.isFinite(updatedAtMs) && (nowMs - updatedAtMs) > maxStaleMs;
    if (touched) {
      touchedCells += 1;
      if (stale) {
        staleCells += 1;
      } else {
        freshTouchedCells += 1;
      }
    }

    return {
      h3Index,
      resolution,
      normalized,
      touched,
      stale
    };
  });

  const allowEmptyFreshModel = touchedCells === 0 && metaFresh;
  const allowAllStaleWhenModelLive = touchedCells > 0 && freshTouchedCells === 0 && metaFresh;
  const mappedCells = cellStates.map(({ h3Index, resolution, normalized, stale }) => ({
    h3Index,
    resolution,
    metrics: (stale && !allowAllStaleWhenModelLive) ? emptyMetrics() : enrichMetrics(normalized)
  }));

  return {
    usable: freshTouchedCells > 0 || allowEmptyFreshModel || allowAllStaleWhenModelLive,
    reason: touchedCells === 0
      ? (allowEmptyFreshModel ? 'empty_fresh_model' : 'empty')
      : (freshTouchedCells === 0
        ? (allowAllStaleWhenModelLive ? 'all_stale_but_model_live' : 'stale')
        : (staleCells > 0 ? 'partial_stale' : 'ok')),
    cells: mappedCells,
    touchedCells,
    staleCells,
    freshTouchedCells,
    lastMutationAt
  };
}

module.exports = {
  DEFAULT_MAX_STALE_MS,
  DEFAULT_RESOLUTION,
  applyDriverSnapshot,
  removeDriverSnapshot,
  applyBookingSnapshot,
  clearBookingSnapshot,
  getAggregatedCells,
  __private: {
    normalizeDriverSnapshot,
    normalizeBookingSnapshot,
    buildCellKey,
    buildDriverStateKey,
    buildBookingStateKey,
    buildMetaKey,
    parseLocation,
    normalizeBookingStatus,
    enrichMetrics
  }
};

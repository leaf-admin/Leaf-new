const ACTIVE_RIDE_STATES = new Set([
  'MATCHED',
  'ACCEPTED',
  'ARRIVED',
  'IN_PROGRESS',
  'REASSIGNED_IN_PROGRESS',
  'STARTED'
]);

const COMPLETED_RIDE_STATES = new Set([
  'COMPLETE',
  'COMPLETED',
  'COMPLETED_AFTER_REASSIGNMENT',
  'PAID'
]);

const CANCELLED_RIDE_STATES = new Set([
  'CANCELED',
  'CANCELLED',
  'NO_DRIVERS_AVAILABLE',
  'NO_DRIVERS_FOUND',
  'SUPERSEDED'
]);

const DEFAULT_ACTIVE_RIDE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTimestampValue(value) {
  if (!value) return null;

  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    const time = date.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'object' && Number.isFinite(value._seconds)) {
    const nanos = Number.isFinite(value._nanoseconds) ? value._nanoseconds : 0;
    return value._seconds * 1000 + Math.floor(nanos / 1e6);
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber > 10_000_000_000 ? asNumber : asNumber * 1000;
    }

    const parsed = new Date(trimmed).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseJsonMaybe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeRideStatus(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized) {
      return normalized;
    }
  }
  return 'UNKNOWN';
}

function resolveRideTimestamp(ride = {}) {
  const candidates = [
    ride.updatedAt,
    ride.completedAt,
    ride.finishedAt,
    ride.endedAt,
    ride.startedAt,
    ride.arrivedAt,
    ride.acceptedAt,
    ride.createdAt,
    ride.tripdate,
    ride.timestamp
  ];

  for (const candidate of candidates) {
    const timestamp = parseTimestampValue(candidate);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return timestamp;
    }
  }

  return 0;
}

function resolveRideRevenue(ride = {}) {
  const financialBreakdownTotal = toFiniteNumber(ride?.financialBreakdown?.totalAmount, 0);
  if (financialBreakdownTotal > 0) {
    return Number((financialBreakdownTotal / 100).toFixed(2));
  }

  const candidates = [
    ride.finalPrice,
    ride.customer_paid,
    ride.total_fare,
    ride.fare,
    ride.estimatedFare,
    ride.estimate
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate, NaN);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Number(parsed.toFixed(2));
    }
  }

  return 0;
}

function resolveRideActor(ride = {}) {
  return (
    ride.customerName ||
    ride.passengerName ||
    ride.customer ||
    ride.customerId ||
    ride.driverName ||
    ride.driver ||
    ride.driverId ||
    null
  );
}

function hasRideLocations(ride = {}) {
  return Boolean(
    ride.pickupLocation ||
    ride.destinationLocation ||
    ride.pickup ||
    ride.drop ||
    ride.currentLocation ||
    ride.driverLocation
  );
}

function resolveRideStatusLabel(status) {
  switch (normalizeRideStatus(status)) {
    case 'SEARCHING':
    case 'MATCHED':
      return 'em busca';
    case 'ACCEPTED':
      return 'aceita';
    case 'ARRIVED':
      return 'motorista chegou';
    case 'STARTED':
    case 'IN_PROGRESS':
    case 'REASSIGNED_IN_PROGRESS':
      return 'em andamento';
    case 'COMPLETE':
    case 'COMPLETED':
    case 'COMPLETED_AFTER_REASSIGNMENT':
    case 'PAID':
      return 'concluída';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelada';
    case 'NO_DRIVERS_AVAILABLE':
    case 'NO_DRIVERS_FOUND':
      return 'sem motorista';
    case 'SUPERSEDED':
      return 'realocada';
    default:
      return 'atualizada';
  }
}

function buildRecentRideActivity(ride = {}) {
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );

  return {
    id: ride.id || ride.bookingId || null,
    type: 'ride',
    description: `Corrida ${resolveRideStatusLabel(status)}`,
    timestamp: resolveRideTimestamp(ride) || Date.now(),
    user: resolveRideActor(ride),
    metadata: {
      status,
      fare: resolveRideRevenue(ride)
    }
  };
}

function isRideLikeRecord(ride = {}) {
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );

  if (status !== 'UNKNOWN') {
    return true;
  }

  if (resolveRideActor(ride)) {
    return true;
  }

  if (resolveRideRevenue(ride) > 0) {
    return true;
  }

  if (hasRideLocations(ride)) {
    return true;
  }

  return false;
}

function buildRecentRideActivities(bookings = [], limit = 10) {
  return bookings
    .filter((booking) => isRideLikeRecord(booking))
    .map((booking) => buildRecentRideActivity(booking))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

function isActiveRideStatus(status) {
  return ACTIVE_RIDE_STATES.has(normalizeRideStatus(status));
}

function getActiveRideMaxAgeMs() {
  const parsed = Number.parseInt(
    process.env.DASHBOARD_ACTIVE_RIDES_MAX_AGE_MS || String(DEFAULT_ACTIVE_RIDE_MAX_AGE_MS),
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ACTIVE_RIDE_MAX_AGE_MS;
}

function countActiveRidesFromActiveHash(activeHash = {}, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : getActiveRideMaxAgeMs();
  const futureSkewMs = Number.isFinite(options.futureSkewMs)
    ? options.futureSkewMs
    : DEFAULT_FUTURE_SKEW_MS;

  let count = 0;

  for (const rawValue of Object.values(activeHash || {})) {
    const booking = parseJsonMaybe(rawValue);
    if (!booking || typeof booking !== 'object') {
      continue;
    }

    const status = normalizeRideStatus(
      booking.status,
      booking.state,
      booking.bookingStatus,
      booking.tripStatus
    );

    if (!isActiveRideStatus(status)) {
      continue;
    }

    const timestamp = resolveRideTimestamp(booking);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      if (timestamp > now + futureSkewMs) {
        continue;
      }

      if (now - timestamp > maxAgeMs) {
        continue;
      }
    }

    count += 1;
  }

  return count;
}

module.exports = {
  ACTIVE_RIDE_STATES,
  COMPLETED_RIDE_STATES,
  CANCELLED_RIDE_STATES,
  normalizeRideStatus,
  resolveRideStatusLabel,
  resolveRideTimestamp,
  resolveRideRevenue,
  buildRecentRideActivity,
  buildRecentRideActivities,
  isRideLikeRecord,
  countActiveRidesFromActiveHash,
  getActiveRideMaxAgeMs
};

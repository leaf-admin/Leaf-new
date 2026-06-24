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

function parseMoneyValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'string') {
    const sanitized = value.replace(/[^\d,.-]/g, '').trim();
    if (!sanitized) return fallback;
    const normalized = sanitized.includes(',')
      ? sanitized.replace(/\./g, '').replace(',', '.')
      : sanitized;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositiveMoney(...values) {
  for (const value of values) {
    const parsed = parseMoneyValue(value, null);
    if (parsed !== null && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function firstFiniteMoney(...values) {
  for (const value of values) {
    const parsed = parseMoneyValue(value, null);
    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function isTruthyFlag(value) {
  if (value === true) return true;
  return ['1', 'true', 'yes', 'sim'].includes(String(value || '').trim().toLowerCase());
}

function isCompletedRideStatus(status) {
  return COMPLETED_RIDE_STATES.has(normalizeRideStatus(status));
}

function isRideRevenuePendingFinalSnapshot(ride = {}) {
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );
  return isCompletedRideStatus(status) && !hasAuthoritativeBackendFinalSnapshot(ride);
}

function hasAuthoritativeBackendFinalSnapshot(ride = {}) {
  const fareBreakdown = ride.fareBreakdown || {};
  const paymentBreakdown = ride.paymentBreakdown || {};
  const financialBreakdown = ride.financialBreakdown || {};
  const financialSnapshot = resolveFinancialSnapshot(ride);
  const snapshotSource = String(
    ride.financialSnapshotSource ||
    financialSnapshot.financialSnapshotSource ||
    fareBreakdown.financialSnapshotSource ||
    paymentBreakdown.financialSnapshotSource ||
    financialBreakdown.financialSnapshotSource ||
    ''
  ).trim();

  return snapshotSource === 'backend_final' && (
    isTruthyFlag(ride.authoritativeSnapshot) ||
    isTruthyFlag(financialSnapshot.authoritativeSnapshot) ||
    isTruthyFlag(fareBreakdown.authoritativeSnapshot) ||
    isTruthyFlag(paymentBreakdown.authoritativeSnapshot) ||
    isTruthyFlag(financialBreakdown.authoritativeSnapshot)
  );
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

function resolveFinancialSnapshot(ride = {}) {
  const snapshot = parseJsonMaybe(ride.financialSnapshot);
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    return snapshot;
  }

  return {};
}

function centsToMoney(value, { requirePositive = false } = {}) {
  const cents = parseMoneyValue(value, null);
  if (cents === null) return null;
  if (requirePositive && cents <= 0) return null;
  if (!requirePositive && cents < 0) return null;
  return Number((cents / 100).toFixed(2));
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
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );
  const fareBreakdown = ride.fareBreakdown || {};
  const paymentBreakdown = ride.paymentBreakdown || {};
  const financialBreakdown = ride.financialBreakdown || {};
  const financialSnapshot = resolveFinancialSnapshot(ride);
  const snapshotGross = centsToMoney(financialSnapshot.passengerPaidCents, {
    requirePositive: true
  });
  const finalGross = firstPositiveMoney(
    ride.finalPrice,
    ride.finalFare,
    ride.grossAmount,
    ride.grossFare,
    ride.totalPaid,
    ride.customer_paid,
    ride.customerPaid,
    ride.paymentAmount,
    ride.financial?.totalPaid?.amount,
    fareBreakdown.finalFare,
    fareBreakdown.grossAmount,
    paymentBreakdown.finalFare,
    paymentBreakdown.grossAmount,
    financialBreakdown.finalFare,
    financialBreakdown.grossAmount
  );

  if (isCompletedRideStatus(status)) {
    if (hasAuthoritativeBackendFinalSnapshot(ride)) {
      if (snapshotGross !== null) {
        return snapshotGross;
      }
      if (finalGross !== null) {
        return Number(finalGross.toFixed(2));
      }
    }

    return 0;
  }

  const financialBreakdownTotal = toFiniteNumber(financialBreakdown.totalAmount, 0);
  if (financialBreakdownTotal > 0) {
    return Number((financialBreakdownTotal / 100).toFixed(2));
  }

  const candidates = [
    finalGross,
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

function resolveRideOperationalFee(ride = {}) {
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );

  if (isCompletedRideStatus(status) && !hasAuthoritativeBackendFinalSnapshot(ride)) {
    return 0;
  }

  const fareBreakdown = ride.fareBreakdown || {};
  const paymentBreakdown = ride.paymentBreakdown || {};
  const financialBreakdown = ride.financialBreakdown || {};
  const calculationBreakdown = ride.calculationBreakdown || {};
  const financialSnapshot = resolveFinancialSnapshot(ride);
  const financialContract = parseJsonMaybe(ride.financialContract) || {};
  const authoritativeSnapshotFee = hasAuthoritativeBackendFinalSnapshot(ride)
    ? centsToMoney(financialSnapshot.operationalFeeCents)
    : null;

  if (authoritativeSnapshotFee !== null) {
    return authoritativeSnapshotFee;
  }

  const value = firstFiniteMoney(
    ride.operationalFee,
    ride.leafOperationalFee,
    ride.leafOperational,
    fareBreakdown.operationalFee,
    paymentBreakdown.operationalFee,
    calculationBreakdown.operationalFee,
    financialBreakdown.leafOperationalFee,
    financialBreakdown.leafOperational
  );

  if (value !== null) {
    return Number(value.toFixed(2));
  }

  const centsValue = firstFiniteMoney(
    ride.operationalFeeCents,
    financialSnapshot.operationalFeeCents,
    financialContract.operationalFeeCents
  );

  if (centsValue !== null) {
    return Number((centsValue / 100).toFixed(2));
  }

  return 0;
}

function resolveRideDriverNetAmount(ride = {}) {
  const status = normalizeRideStatus(
    ride.status,
    ride.state,
    ride.bookingStatus,
    ride.tripStatus
  );

  if (isCompletedRideStatus(status) && !hasAuthoritativeBackendFinalSnapshot(ride)) {
    return 0;
  }

  const fareBreakdown = ride.fareBreakdown || {};
  const paymentBreakdown = ride.paymentBreakdown || {};
  const financialBreakdown = ride.financialBreakdown || {};
  const calculationBreakdown = ride.calculationBreakdown || {};
  const financialSnapshot = resolveFinancialSnapshot(ride);
  const financialContract = parseJsonMaybe(ride.financialContract) || {};
  const authoritativeSnapshotDriverNet = hasAuthoritativeBackendFinalSnapshot(ride)
    ? centsToMoney(financialSnapshot.driverNetAmountCents)
    : null;

  if (authoritativeSnapshotDriverNet !== null) {
    return authoritativeSnapshotDriverNet;
  }

  const value = firstFiniteMoney(
    ride.driverNetAmount,
    ride.driverNet,
    ride.driverEarnings,
    ride.netFare,
    fareBreakdown.driverNetAmount,
    fareBreakdown.driverNet,
    paymentBreakdown.driverNetAmount,
    paymentBreakdown.driverNet,
    calculationBreakdown.driverNetAmount,
    calculationBreakdown.net,
    financialBreakdown.driverNetAmount,
    financialBreakdown.driverNet
  );

  if (value !== null) {
    return Number(value.toFixed(2));
  }

  const centsValue = firstFiniteMoney(
    ride.driverNetAmountCents,
    financialSnapshot.driverNetAmountCents,
    financialContract.driverNetAmountCents
  );

  if (centsValue !== null) {
    return Number((centsValue / 100).toFixed(2));
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
      fare: resolveRideRevenue(ride),
      farePendingReconciliation: isRideRevenuePendingFinalSnapshot(ride)
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
  resolveRideOperationalFee,
  resolveRideDriverNetAmount,
  buildRecentRideActivity,
  buildRecentRideActivities,
  isRideLikeRecord,
  isRideRevenuePendingFinalSnapshot,
  countActiveRidesFromActiveHash,
  getActiveRideMaxAgeMs
};

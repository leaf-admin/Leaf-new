const {
  DEFAULT_EARLY_END_DISTANCE_METERS,
  resolveRideEarlyEnd
} = require('../services/ride-early-end-service');

const ACTIVE_STATUSES = new Set([
  'PENDING', 'PENDING_PAYMENT', 'PAID', 'SEARCHING', 'EXPANDED', 'NOTIFIED',
  'AWAITING_RESPONSE', 'ACCEPTED', 'ARRIVED', 'STARTED', 'IN_PROGRESS', 'REASSIGNMENT_PENDING'
]);

function objectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function timestamp(value) {
  if (value && typeof value === 'object') {
    const seconds = value._seconds ?? value.seconds;
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinates(value) {
  const point = objectValue(value);
  const lat = point?.lat ?? point?.latitude;
  const lng = point?.lng ?? point?.longitude;
  if ([lat, lng].some((v) => v === null || v === undefined || v === '' || typeof v === 'boolean')) return null;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)
  ) return null;
  return { lat: latitude, lng: longitude };
}

function normalized(value) {
  return String(value || '').trim().toUpperCase();
}

// This is a reconciliation aid, never authorization to seed a live counter.
// A generic COMPLETED status also contains early endings in current persistence.
function classifyHistoricalRide(ride = {}) {
  const context = objectValue(ride.financialContext) || {};
  if (
    [ride.financialNamespace, context.namespace, ride.paymentProviderEnvironment, ride.providerEnvironment, context.providerEnvironment]
      .some((value) => normalized(value) === 'SANDBOX') ||
    ride.testUserSandbox === true || ride.testUserSandbox === 'true'
  ) return { classification: 'excluded', reason: 'SANDBOX' };

  const status = normalized(ride.status || ride.state);
  const completionType = normalized(ride.completionType);
  const settlement = objectValue(ride.settlement) || objectValue(ride.earlyEndSettlement) || {};
  const earlyEnd = objectValue(ride.earlyEnd);
  const earlyEndSkipped = objectValue(ride.driverEarlyEndSkipped);
  const completionSignals = [status, completionType, normalized(settlement.settlementType)];
  if (completionSignals.some((signal) => signal.includes('CANCEL'))) {
    return { classification: 'excluded', reason: 'CANCELLED' };
  }
  if (completionSignals.some((signal) => signal.includes('EARLY') || signal.includes('INTERRUPTED'))) {
    return { classification: 'excluded', reason: 'EARLY_OR_INTERRUPTED' };
  }
  if (earlyEnd?.detected === true || earlyEndSkipped) {
    return { classification: 'excluded', reason: 'EARLY_END_DETECTED' };
  }
  if (ACTIVE_STATUSES.has(status)) return { classification: 'excluded', reason: 'NOT_COMPLETED' };
  if (status !== 'COMPLETED') return { classification: 'unresolved', reason: 'UNKNOWN_STATUS' };

  const endLocation = coordinates(ride.endLocation);
  const destinationLocation = coordinates(ride.destinationLocation || ride.destination);
  if (!endLocation || !destinationLocation) {
    return { classification: 'unresolved', reason: 'MISSING_DESTINATION_EVIDENCE' };
  }
  // Reuse the existing backend's default arrival boundary; do not create a new
  // distance rule. The export must be checked against the historical config.
  if (resolveRideEarlyEnd({ endLocation, destinationLocation, env: {} })) {
    return { classification: 'excluded', reason: 'ENDED_AWAY_FROM_DESTINATION' };
  }
  return { classification: 'destination_candidate', reason: 'END_LOCATION_NEAR_DESTINATION' };
}

function auditDriverIntroFeeHistory(input = {}) {
  if (input.schemaVersion !== 1 || !Array.isArray(input.drivers) || !Array.isArray(input.rides)) {
    throw new Error('Expected schemaVersion=1 with drivers[] and rides[]');
  }
  const exportedThrough = timestamp(input.exportedThrough);
  if (exportedThrough === null) throw new Error('exportedThrough is required');
  const drivers = new Map();
  for (const driver of input.drivers) {
    const driverId = String(driver?.driverId || '').trim();
    if (!driverId || drivers.has(driverId)) throw new Error('Missing or duplicate driverId in drivers[]');
    const registeredAt = timestamp(driver.registeredAt);
    drivers.set(driverId, {
      driverId,
      registeredAt,
      coverageDeclaredComplete: driver.historyCompleteFromRegistration === true && registeredAt !== null && registeredAt <= exportedThrough,
      destinationCandidateRideIds: [],
      excluded: [],
      unresolved: [],
      duplicateSnapshotCount: 0
    });
  }

  const grouped = new Map();
  let orphanSnapshotCount = 0;
  for (const ride of input.rides) {
    const driverId = String(ride?.driverId || '').trim();
    const driver = drivers.get(driverId);
    if (!driver) {
      orphanSnapshotCount += 1;
      continue;
    }
    const bookingId = String(ride.bookingId || ride.rideId || ride.id || '').trim();
    if (!bookingId) {
      driver.unresolved.push({ bookingId: null, reason: 'MISSING_BOOKING_ID' });
      continue;
    }
    if (!grouped.has(bookingId)) grouped.set(bookingId, []);
    grouped.get(bookingId).push({ ride, driver });
  }

  for (const [bookingId, snapshots] of grouped) {
    const driverIds = new Set(snapshots.map(({ driver }) => driver.driverId));
    if (driverIds.size !== 1) {
      for (const driverId of driverIds) drivers.get(driverId).unresolved.push({ bookingId, reason: 'CONFLICTING_DRIVER' });
      continue;
    }
    const driver = snapshots[0].driver;
    driver.duplicateSnapshotCount += snapshots.length - 1;
    const assessments = snapshots.map(({ ride }) => {
      const classified = classifyHistoricalRide(ride);
      if (classified.classification !== 'destination_candidate') return classified;
      const completedAt = timestamp(ride.completedAt);
      if (
        completedAt === null || driver.registeredAt === null ||
        completedAt < driver.registeredAt || completedAt > exportedThrough
      ) return { classification: 'unresolved', reason: 'INVALID_COMPLETION_WINDOW' };
      return classified;
    });
    const uniqueAssessments = new Set(assessments.map((value) => JSON.stringify(value)));
    const assessment = uniqueAssessments.size === 1
      ? assessments[0]
      : { classification: 'unresolved', reason: 'CONFLICTING_SNAPSHOTS' };
    if (assessment.classification === 'destination_candidate') driver.destinationCandidateRideIds.push(bookingId);
    else driver[assessment.classification].push({ bookingId, reason: assessment.reason });
  }

  return {
    schemaVersion: 1,
    mode: 'offline_reconciliation_only',
    arrivalThresholdMeters: DEFAULT_EARLY_END_DISTANCE_METERS,
    exportedThrough: new Date(exportedThrough).toISOString(),
    requiresHumanVerification: true,
    orphanSnapshotCount,
    drivers: [...drivers.values()].map(({ registeredAt, ...driver }) => ({
      ...driver,
      registeredAt: registeredAt === null ? null : new Date(registeredAt).toISOString(),
      destinationCandidateCount: driver.destinationCandidateRideIds.length,
      eligibleCandidate: driver.coverageDeclaredComplete && driver.unresolved.length === 0 && orphanSnapshotCount === 0
        ? driver.destinationCandidateRideIds.length < 25
        : null
    }))
  };
}

module.exports = { auditDriverIntroFeeHistory, classifyHistoricalRide };

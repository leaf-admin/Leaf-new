const { DRIVER_INTRO_FEE_POLICY } = require('./driver-intro-fee-policy');
const { normalizeState } = require('./driver-intro-fee-state');
const { keyForDriver } = require('./driver-intro-fee-service');

const REPORT_LIMIT = 500;
const STATUS_ORDER = { review: 0, invalid: 1, active: 2, finished: 3 };

function driverIdFromDocument(doc) {
  const encoded = doc.id.startsWith(`${DRIVER_INTRO_FEE_POLICY.policyId}__`)
    ? doc.id.slice(DRIVER_INTRO_FEE_POLICY.policyId.length + 2)
    : doc.id;
  try { return decodeURIComponent(encoded); } catch (_) { return encoded; }
}

function parseState(value) {
  try { return normalizeState(value); } catch (_) { return null; }
}

// Redis holds the live counter and Firestore a checkpoint that may lag behind it.
// A cache from another dataset generation or another driver is never trusted.
function latestState(checkpoint, rawLive) {
  const live = rawLive ? parseState(rawLive) : null;
  const liveIsTrusted = live
    && live.driverId === checkpoint.driverId
    && live.generation === checkpoint.approvedGeneration
    && live.qualifiedCompletedRides >= checkpoint.qualifiedCompletedRides;
  return liveIsTrusted ? live : checkpoint;
}

async function readLiveStates(redis, driverIds) {
  if (!driverIds.length) return { available: true, values: [] };
  try {
    const keys = driverIds.map((driverId) => keyForDriver(driverId));
    return { available: true, values: await redis.mget(...keys) };
  } catch (_) {
    return { available: false, values: [] };
  }
}

async function readDriverNames(firestore, driverIds) {
  if (!driverIds.length) return new Map();
  const refs = driverIds.map((driverId) => firestore.collection('users').doc(driverId));
  const snapshots = await firestore.getAll(...refs, { fieldMask: ['firstName', 'lastName'] });
  return new Map(snapshots.map((snapshot) => {
    const { firstName, lastName } = snapshot.data() || {};
    return [snapshot.id, [firstName, lastName].filter(Boolean).join(' ') || null];
  }));
}

function buildRow(driverId, name, state) {
  const limit = DRIVER_INTRO_FEE_POLICY.qualifyingRideLimit;
  if (!state) {
    return { driverId, name, ridesUsed: null, ridesRemaining: null, inRide: false, status: 'invalid' };
  }
  const ridesUsed = state.qualifiedCompletedRides;
  const finished = ridesUsed >= limit;
  return {
    driverId,
    name,
    ridesUsed,
    ridesRemaining: Math.max(0, limit - ridesUsed),
    inRide: Boolean(state.inflightBookingId),
    status: state.reviewRequiredBookingId ? 'review' : (finished ? 'finished' : 'active')
  };
}

// Read-only. Sandbox counters stay out: QA rides are not operational data.
async function getDriverIntroFeeReport({
  firestore = require('../firebase-config').getFirestore(),
  redis,
  env = process.env
} = {}) {
  const snapshot = await firestore
    .collection('driver_intro_fee_states')
    .limit(REPORT_LIMIT + 1)
    .get();
  const docs = snapshot.docs.slice(0, REPORT_LIMIT);
  const driverIds = docs.map(driverIdFromDocument);
  const [names, live] = await Promise.all([
    readDriverNames(firestore, driverIds),
    readLiveStates(redis, driverIds)
  ]);

  const drivers = docs.map((doc, index) => {
    const checkpoint = parseState(doc.data());
    const state = checkpoint ? latestState(checkpoint, live.values[index]) : null;
    return buildRow(driverIds[index], names.get(driverIds[index]) || null, state);
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (b.ridesUsed ?? 0) - (a.ridesUsed ?? 0));

  const countStatus = (status) => drivers.filter((row) => row.status === status).length;
  return {
    success: true,
    policy: {
      enabled: env.DRIVER_INTRO_FEE_ENABLED === 'true',
      rideLimit: DRIVER_INTRO_FEE_POLICY.qualifyingRideLimit,
      feeCents: DRIVER_INTRO_FEE_POLICY.operationalFeeCents,
      paymentFeeIncluded: DRIVER_INTRO_FEE_POLICY.paymentFeeIncluded
    },
    summary: {
      drivers: drivers.length,
      active: countStatus('active'),
      finished: countStatus('finished'),
      needsReview: countStatus('review') + countStatus('invalid'),
      ridesUsed: drivers.reduce((total, row) => total + (row.ridesUsed || 0), 0)
    },
    drivers,
    liveCounters: live.available,
    truncated: snapshot.docs.length > REPORT_LIMIT
  };
}

module.exports = { getDriverIntroFeeReport, REPORT_LIMIT };

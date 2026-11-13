// Owner-approved on 2026-10-22 (#405). Pure policy; no provider calls or activation.
// Owner-approved on 2026-10-31: during the promotion the R$ 0,99 is the driver's whole
// fee, Pix included. policyId stays: it keys the Redis and Firestore ride counters.
// Owner-approved on 2026-11-06: the R$ 0,99 covers the minimum Pix cost (R$ 0,50) and
// R$ 0,49 for Leaf. Above R$ 62,50 the Pix grows past the minimum and the driver pays
// the excess; Leaf always keeps R$ 0,49 and never absorbs Pix.
const DRIVER_INTRO_FEE_POLICY = Object.freeze({
  policyId: 'driver_first_25_destination_completions_v1',
  qualifyingRideLimit: 25,
  operationalFeeCents: 99,
  paymentFeeIncluded: true,
  pixExcessChargedToDriver: true,
  leafFeeCents: 49,
  // Owner-approved on 2026-11-09, extended to 31/12 on 2026-11-13: every ride offered until 31/12/2026 23:59:59 (Brasília,
  // UTC-3) gets the promotion, whatever the driver's ride count. The offer time decides,
  // so a ride offered on 31/12 and finished on 01/01 keeps it. Never shorten this
  // retroactively: stored contexts are recomputed against it at settlement.
  eligibleUntil: '2027-01-01T03:00:00.000Z'
});
// Sandbox (QA) rides count on their own counter, never on the operational one.
const DRIVER_INTRO_FEE_NAMESPACES = Object.freeze(['operational', 'sandbox']);

function policyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Only a backend-verified lifetime history may produce this context. Registration
// date, totalTrips and an absent counter must never be interpreted as zero rides.
function buildDriverIntroFeeContext({
  driverId,
  qualifiedCompletedRides,
  historyVerified,
  historySnapshotId,
  namespace = 'operational',
  paymentFeeIncluded = DRIVER_INTRO_FEE_POLICY.paymentFeeIncluded,
  pixExcessChargedToDriver = DRIVER_INTRO_FEE_POLICY.pixExcessChargedToDriver,
  offeredAt = null
} = {}) {
  if (historyVerified !== true || typeof historySnapshotId !== 'string' || !historySnapshotId.trim()) {
    throw policyError('DRIVER_INTRO_FEE_HISTORY_UNVERIFIED');
  }
  if (
    typeof driverId !== 'string' || !driverId.trim() ||
    !Number.isSafeInteger(qualifiedCompletedRides) || qualifiedCompletedRides < 0
  ) {
    throw policyError('DRIVER_INTRO_FEE_CONTEXT_INVALID');
  }
  if (!DRIVER_INTRO_FEE_NAMESPACES.includes(namespace)) throw policyError('DRIVER_INTRO_FEE_CONTEXT_INVALID');
  // Offers made since 2026-11-09 carry offeredAt and follow the date rule. A context
  // without it was accepted under the 25-ride rule and keeps that rule.
  let eligible;
  if (offeredAt === null || offeredAt === undefined) {
    eligible = qualifiedCompletedRides < DRIVER_INTRO_FEE_POLICY.qualifyingRideLimit;
  } else {
    const offeredAtMs = typeof offeredAt === 'string' ? Date.parse(offeredAt) : NaN;
    if (!Number.isFinite(offeredAtMs)) throw policyError('DRIVER_INTRO_FEE_CONTEXT_INVALID');
    eligible = offeredAtMs < Date.parse(DRIVER_INTRO_FEE_POLICY.eligibleUntil);
  }
  const dateTerms = offeredAt === null || offeredAt === undefined
    ? {}
    : { offeredAt: new Date(Date.parse(offeredAt)).toISOString(), eligibleUntil: DRIVER_INTRO_FEE_POLICY.eligibleUntil };
  return Object.freeze({
    policyId: DRIVER_INTRO_FEE_POLICY.policyId,
    namespace,
    driverId: driverId.trim(),
    qualifiedCompletedRides,
    historyVerified: true,
    historySnapshotId: historySnapshotId.trim(),
    eligible,
    operationalFeeCents: eligible ? DRIVER_INTRO_FEE_POLICY.operationalFeeCents : null,
    paymentFeeIncluded: paymentFeeIncluded === true,
    pixExcessChargedToDriver: paymentFeeIncluded === true && pixExcessChargedToDriver === true,
    leafFeeCents: eligible && paymentFeeIncluded === true && pixExcessChargedToDriver === true
      ? DRIVER_INTRO_FEE_POLICY.leafFeeCents
      : null,
    ...dateTerms
  });
}

// The promotion takes new offers only before eligibleUntil. Accepted rides settle anyway.
function isDriverIntroFeeOpen(nowMs = Date.now()) {
  return nowMs < Date.parse(DRIVER_INTRO_FEE_POLICY.eligibleUntil);
}

function normalizeDriverIntroFeeContext(context) {
  if (context === null || context === undefined) return null;
  if (typeof context !== 'object' || Array.isArray(context) || context.policyId !== DRIVER_INTRO_FEE_POLICY.policyId) {
    throw policyError('DRIVER_INTRO_FEE_CONTEXT_INVALID');
  }
  // Recompute derived fields when reading a stored context; never accept an
  // arbitrary monetary override or an eligibility flag supplied by a caller.
  // A context stored without the flag was accepted under the Pix-separate terms.
  // One without pixExcessChargedToDriver was accepted under the 2026-10-31 terms
  // (R$ 0,99 total at any fare, Leaf absorbing the Pix excess).
  return buildDriverIntroFeeContext({
    ...context,
    paymentFeeIncluded: context.paymentFeeIncluded === true,
    pixExcessChargedToDriver: context.pixExcessChargedToDriver === true,
    offeredAt: context.offeredAt ?? null
  });
}

module.exports = {
  DRIVER_INTRO_FEE_POLICY,
  DRIVER_INTRO_FEE_NAMESPACES,
  buildDriverIntroFeeContext,
  normalizeDriverIntroFeeContext,
  isDriverIntroFeeOpen
};

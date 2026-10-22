// Owner-approved on 2026-10-22 (#405). Pure policy; no provider calls or activation.
const DRIVER_INTRO_FEE_POLICY = Object.freeze({
  policyId: 'driver_first_25_destination_completions_v1',
  qualifyingRideLimit: 25,
  operationalFeeCents: 99
});

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
  historySnapshotId
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
  const eligible = qualifiedCompletedRides < DRIVER_INTRO_FEE_POLICY.qualifyingRideLimit;
  return Object.freeze({
    policyId: DRIVER_INTRO_FEE_POLICY.policyId,
    driverId: driverId.trim(),
    qualifiedCompletedRides,
    historyVerified: true,
    historySnapshotId: historySnapshotId.trim(),
    eligible,
    operationalFeeCents: eligible ? DRIVER_INTRO_FEE_POLICY.operationalFeeCents : null
  });
}

function normalizeDriverIntroFeeContext(context) {
  if (context === null || context === undefined) return null;
  if (typeof context !== 'object' || Array.isArray(context) || context.policyId !== DRIVER_INTRO_FEE_POLICY.policyId) {
    throw policyError('DRIVER_INTRO_FEE_CONTEXT_INVALID');
  }
  // Recompute derived fields when reading a stored context; never accept an
  // arbitrary monetary override or an eligibility flag supplied by a caller.
  return buildDriverIntroFeeContext(context);
}

module.exports = {
  DRIVER_INTRO_FEE_POLICY,
  buildDriverIntroFeeContext,
  normalizeDriverIntroFeeContext
};

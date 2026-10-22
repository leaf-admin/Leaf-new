const { DRIVER_INTRO_FEE_POLICY, buildDriverIntroFeeContext } = require('./driver-intro-fee-policy');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseObject(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { fail('DRIVER_INTRO_FEE_INVALID_STATE'); }
  }
  return value;
}

function normalizeState(value) {
  const state = parseObject(value);
  if (!state || state.version !== 1 || state.policyId !== DRIVER_INTRO_FEE_POLICY.policyId || state.namespace !== 'operational') {
    fail('DRIVER_INTRO_FEE_INVALID_STATE');
  }
  const ids = state.completedBookingIds;
  if (
    !Number.isSafeInteger(state.baselineCount) || state.baselineCount < 0 || state.baselineCount > 25 ||
    !Array.isArray(ids) || ids.length > 25 - state.baselineCount || new Set(ids).size !== ids.length ||
    ids.some(id => typeof id !== 'string' || !id.trim()) ||
    !Number.isFinite(Date.parse(state.historyThrough)) ||
    state.qualifiedCompletedRides !== Math.min(25, state.baselineCount + ids.length)
  ) fail('DRIVER_INTRO_FEE_INVALID_STATE');
  const context = buildDriverIntroFeeContext(state);
  return { ...state, ...context, completedBookingIds: [...ids] };
}

function buildSeedState({ driverId, qualifiedCompletedRides, historySnapshotId, historyThrough }) {
  const context = buildDriverIntroFeeContext({ driverId, qualifiedCompletedRides, historySnapshotId, historyVerified: true });
  return normalizeState({
    ...context,
    namespace: 'operational',
    qualifiedCompletedRides: Math.min(25, qualifiedCompletedRides),
    baselineCount: Math.min(25, qualifiedCompletedRides),
    completedBookingIds: [],
    historyThrough,
    version: 1
  });
}

function mergeCheckpoint(stored, incoming) {
  const next = normalizeState(incoming);
  const previous = normalizeState(stored);
  if (
    previous.driverId !== next.driverId || previous.historySnapshotId !== next.historySnapshotId ||
    previous.historyThrough !== next.historyThrough || previous.baselineCount !== next.baselineCount ||
    previous.approvedGeneration !== next.approvedGeneration
  ) fail('DRIVER_INTRO_FEE_CHECKPOINT_CONFLICT');
  const ids = [...new Set([...previous.completedBookingIds, ...next.completedBookingIds])];
  const merged = normalizeState({
    ...previous,
    completedBookingIds: ids.slice(0, 25 - previous.baselineCount),
    qualifiedCompletedRides: Math.min(25, previous.baselineCount + ids.length),
    ...(previous.reviewRequiredBookingId || next.reviewRequiredBookingId
      ? { reviewRequiredBookingId: previous.reviewRequiredBookingId || next.reviewRequiredBookingId }
      : {})
  });
  delete merged.inflightBookingId;
  delete merged.generation;
  return merged;
}

module.exports = { buildSeedState, mergeCheckpoint, normalizeState, parseObject, fail };

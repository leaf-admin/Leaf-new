export const PROTOTYPE_TRAFFIC_SEGMENT_COLORS = Object.freeze({
  normal: '#198754',
  moderate: '#F59E0B',
  heavy: '#DC2626',
});

export function resolveTrafficSegmentLevel(durationWithoutTrafficSecs, trafficDurationSecs) {
  const baseDuration = Number(durationWithoutTrafficSecs);
  const trafficDuration = Number(trafficDurationSecs);
  if (
    !Number.isFinite(baseDuration) ||
    !Number.isFinite(trafficDuration) ||
    baseDuration <= 0 ||
    trafficDuration <= 0
  ) {
    return null;
  }

  const ratio = trafficDuration / baseDuration;
  if (ratio >= 1.35) {
    return 'heavy';
  }
  if (ratio >= 1.15) {
    return 'moderate';
  }
  return 'normal';
}

export function resolveTrafficBaseDurationSecs(leg = {}) {
  const value = Number(
    leg.duration_without_traffic ??
    leg.durationWithoutTraffic ??
    leg.base_duration_secs ??
    leg.durationSeconds,
  );
  return Number.isFinite(value) && value > 0 ? value : null;
}

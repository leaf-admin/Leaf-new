export const PROTOTYPE_TRAFFIC_SEGMENT_COLORS = Object.freeze({
  normal: '#198754',
  moderate: '#F59E0B',
  heavy: '#DC2626',
});

const PROTOTYPE_TRAFFIC_LEVEL_PRIORITY = Object.freeze({
  normal: 1,
  moderate: 2,
  heavy: 3,
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

export function resolveTrafficSegmentLevelForLeg(leg = {}, route = {}, legCount = 1) {
  const canUseRouteTotals = Number(legCount) === 1;
  const baseDuration =
    resolveTrafficBaseDurationSecs(leg) ??
    (canUseRouteTotals ? resolveTrafficBaseDurationSecs(route) : null);
  const trafficDuration =
    leg.duration_in_traffic ??
    leg.durationInTraffic ??
    (canUseRouteTotals ? route.duration_in_traffic ?? route.durationInTraffic : null);

  return resolveTrafficSegmentLevel(baseDuration, trafficDuration);
}

export function resolveWorstTrafficSegmentLevel(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return 'normal';
  }

  return segments.reduce((worstLevel, segment) => {
    const level = String(segment?.level || segment?.trafficLevel || 'normal')
      .trim()
      .toLowerCase();
    const normalizedLevel = PROTOTYPE_TRAFFIC_LEVEL_PRIORITY[level]
      ? level
      : 'normal';

    return PROTOTYPE_TRAFFIC_LEVEL_PRIORITY[normalizedLevel] >
      PROTOTYPE_TRAFFIC_LEVEL_PRIORITY[worstLevel]
      ? normalizedLevel
      : worstLevel;
  }, 'normal');
}

export function resolveTrafficFareStatusPresentation(level = 'normal') {
  const normalizedLevel = String(level || 'normal').trim().toLowerCase();

  if (normalizedLevel === 'heavy') {
    return {
      label: 'Tarifa alta',
      tariffHigh: true,
    };
  }

  if (normalizedLevel === 'moderate') {
    return {
      label: 'Tarifa moderada',
      tariffHigh: true,
    };
  }

  return {
    label: 'Tarifa baixa',
    tariffHigh: false,
  };
}

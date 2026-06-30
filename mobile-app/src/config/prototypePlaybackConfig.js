import Constants from 'expo-constants';

function expoExtra() {
  return Constants?.expoConfig?.extra || {};
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function resolveNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function resolveBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function getPrototypePlaybackConfigSnapshot() {
  const extraConfig = expoExtra()?.prototypePlayback || {};

  return {
    enabled: resolveBoolean(
      firstDefined(
        extraConfig.enabled,
        process.env.EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_ENABLED,
        process.env.LEAF_PROTOTYPE_ROUTE_PLAYBACK_ENABLED,
      ),
      false,
    ),
    tickMs: resolveNumber(
      firstDefined(
        extraConfig.tickMs,
        process.env.EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_TICK_MS,
        process.env.LEAF_PROTOTYPE_ROUTE_PLAYBACK_TICK_MS,
      ),
      1000,
    ),
    pickupSpeedMetersPerSecond: resolveNumber(
      firstDefined(
        extraConfig.pickupSpeedMetersPerSecond,
        process.env.EXPO_PUBLIC_PROTOTYPE_PICKUP_SPEED_MPS,
        process.env.LEAF_PROTOTYPE_PICKUP_SPEED_MPS,
      ),
      8,
    ),
    tripSpeedMetersPerSecond: resolveNumber(
      firstDefined(
        extraConfig.tripSpeedMetersPerSecond,
        process.env.EXPO_PUBLIC_PROTOTYPE_TRIP_SPEED_MPS,
        process.env.LEAF_PROTOTYPE_TRIP_SPEED_MPS,
      ),
      10,
    ),
    qaMultiplier: resolveNumber(
      firstDefined(
        extraConfig.qaMultiplier,
        process.env.EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER,
        process.env.LEAF_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER,
      ),
      1.75,
    ),
  };
}

export default getPrototypePlaybackConfigSnapshot;

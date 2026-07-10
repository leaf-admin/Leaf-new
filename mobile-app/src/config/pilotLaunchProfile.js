import Constants from 'expo-constants';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

function normalizeFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return TRUTHY_VALUES.has(String(value).trim().toLowerCase());
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function expoExtra() {
  return Constants?.expoConfig?.extra || {};
}

function resolveLaunchProfile() {
  const rawProfile = firstDefined(
    expoExtra().launchProfile,
    process.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE,
    process.env.LEAF_LAUNCH_PROFILE
  );

  const normalized = String(rawProfile || 'full')
    .trim()
    .toLowerCase();

  if (['pilot', 'pilot_controlled', 'controlled_pilot'].includes(normalized)) {
    return 'pilot_controlled';
  }

  if (['ride_flow_validation', 'ride_validation', 'flow_validation'].includes(normalized)) {
    return 'ride_flow_validation';
  }

  return normalized || 'full';
}

function isPilotControlledLaunch() {
  return (
    ['pilot_controlled', 'geofence_validation', 'ride_flow_validation'].includes(resolveLaunchProfile()) ||
    expoExtra().pilotControlled === true ||
    normalizeFlag(process.env.EXPO_PUBLIC_PILOT_CONTROLLED, false)
  );
}

function resolvePilotFeature(flagKey, extraKey, enabledOutsidePilot = true) {
  const pilotControlled = isPilotControlledLaunch();
  const fallback = pilotControlled ? false : enabledOutsidePilot;
  return normalizeFlag(
    firstDefined(
      expoExtra()?.pilotFeatureFlags?.[extraKey],
      process.env[flagKey]
    ),
    fallback
  );
}

export function getPilotLaunchFeatureSnapshot() {
  return {
    launchProfile: resolveLaunchProfile(),
    pilotControlled: isPilotControlledLaunch(),
    driverWithdrawalsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS', 'driverWithdrawalsEnabled', false),
    referralProgramsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS', 'referralProgramsEnabled', true),
    leafDelasEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_LEAF_DELAS', 'leafDelasEnabled', true),
    driverDestinationModeEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE', 'driverDestinationModeEnabled', true),
    dynamicPricingEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING', 'dynamicPricingEnabled', true),
    smartPushEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_SMART_PUSH', 'smartPushEnabled', false),
    softBanEnforcementEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT', 'softBanEnforcementEnabled', true),
    adminMutationsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS', 'adminMutationsEnabled', true),
  };
}

export function isPilotFeatureEnabled(featureKey, defaultValue = true) {
  const snapshot = getPilotLaunchFeatureSnapshot();
  if (Object.prototype.hasOwnProperty.call(snapshot, featureKey)) {
    return snapshot[featureKey];
  }
  return defaultValue;
}

export function getPilotFeatureFlagDefaults() {
  const snapshot = getPilotLaunchFeatureSnapshot();
  return {
    PILOT_CONTROLLED_LAUNCH: snapshot.pilotControlled,
    PILOT_DRIVER_WITHDRAWALS_ENABLED: snapshot.driverWithdrawalsEnabled,
    PILOT_REFERRAL_PROGRAMS_ENABLED: snapshot.referralProgramsEnabled,
    PILOT_LEAF_DELAS_ENABLED: snapshot.leafDelasEnabled,
    PILOT_DRIVER_DESTINATION_MODE_ENABLED: snapshot.driverDestinationModeEnabled,
    PILOT_DYNAMIC_PRICING_ENABLED: snapshot.dynamicPricingEnabled,
    PILOT_SMART_PUSH_ENABLED: snapshot.smartPushEnabled,
    PILOT_SOFT_BAN_ENFORCEMENT_ENABLED: snapshot.softBanEnforcementEnabled,
    PILOT_ADMIN_MUTATIONS_ENABLED: snapshot.adminMutationsEnabled,
  };
}

export default getPilotLaunchFeatureSnapshot;

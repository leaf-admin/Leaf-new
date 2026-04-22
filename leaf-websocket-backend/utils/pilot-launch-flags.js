function normalizeFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function resolveLaunchProfile() {
  const rawProfile = firstDefined(
    process.env.LEAF_LAUNCH_PROFILE,
    process.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE
  );

  const normalized = String(rawProfile || 'full')
    .trim()
    .toLowerCase();

  if (['pilot', 'pilot_controlled', 'controlled_pilot'].includes(normalized)) {
    return 'pilot_controlled';
  }

  return normalized || 'full';
}

function isPilotControlledLaunch() {
  return (
    resolveLaunchProfile() === 'pilot_controlled' ||
    normalizeFlag(firstDefined(process.env.LEAF_PILOT_CONTROLLED, process.env.EXPO_PUBLIC_PILOT_CONTROLLED), false)
  );
}

function resolvePilotFeature(flagKey, enabledOutsidePilot = true) {
  const fallback = isPilotControlledLaunch() ? false : enabledOutsidePilot;
  return normalizeFlag(process.env[flagKey], fallback);
}

function getPilotLaunchFlags() {
  return {
    launchProfile: resolveLaunchProfile(),
    pilotControlled: isPilotControlledLaunch(),
    driverWithdrawalsEnabled: resolvePilotFeature('ENABLE_DRIVER_WITHDRAWALS', false),
    referralProgramsEnabled: resolvePilotFeature('ENABLE_REFERRAL_PROGRAMS', true),
    softBanEnforcementEnabled: resolvePilotFeature('ENABLE_SOFT_BAN_ENFORCEMENT', true),
    adminMutationsEnabled: resolvePilotFeature('ENABLE_ADMIN_MUTATIONS', true),
  };
}

function isLaunchFeatureEnabled(featureKey, defaultValue = true) {
  const snapshot = getPilotLaunchFlags();
  if (Object.prototype.hasOwnProperty.call(snapshot, featureKey)) {
    return snapshot[featureKey];
  }

  return defaultValue;
}

function buildLaunchFeatureDisabledPayload(feature, message) {
  return {
    success: false,
    code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE',
    feature,
    launchProfile: resolveLaunchProfile(),
    error: message || 'Recurso indisponivel neste perfil de lancamento'
  };
}

module.exports = {
  getPilotLaunchFlags,
  isPilotControlledLaunch,
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
};

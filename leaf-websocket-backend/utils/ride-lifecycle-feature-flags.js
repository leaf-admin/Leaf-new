function normalizeFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return String(value).trim().toLowerCase() === 'true';
}

function getRideLifecycleFeatureFlags() {
  return {
    rideExtensionFlow: normalizeFlag(process.env.ENABLE_RIDE_EXTENSION_FLOW, true),
    riderEarlyEnd: normalizeFlag(process.env.ENABLE_RIDER_EARLY_END, true),
    operationalReassignment: normalizeFlag(process.env.ENABLE_OPERATIONAL_REASSIGNMENT, false),
    multiLegBilling: normalizeFlag(process.env.ENABLE_MULTI_LEG_BILLING, false)
  };
}

function isRideExtensionFlowEnabled() {
  return getRideLifecycleFeatureFlags().rideExtensionFlow;
}

function isRiderEarlyEndEnabled() {
  return getRideLifecycleFeatureFlags().riderEarlyEnd;
}

function isOperationalReassignmentEnabled() {
  return getRideLifecycleFeatureFlags().operationalReassignment;
}

function isMultiLegBillingEnabled() {
  return getRideLifecycleFeatureFlags().multiLegBilling;
}

module.exports = {
  getRideLifecycleFeatureFlags,
  isRideExtensionFlowEnabled,
  isRiderEarlyEndEnabled,
  isOperationalReassignmentEnabled,
  isMultiLegBillingEnabled
};

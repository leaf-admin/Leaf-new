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
    driverEarlyEndSettlement: normalizeFlag(process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT, false),
    operationalReassignment: normalizeFlag(process.env.ENABLE_OPERATIONAL_REASSIGNMENT, false),
    multiLegBilling: normalizeFlag(process.env.ENABLE_MULTI_LEG_BILLING, false),
    driverSelfActionPush: normalizeFlag(process.env.ENABLE_DRIVER_SELF_ACTION_PUSH, false)
  };
}

function isRideExtensionFlowEnabled() {
  return getRideLifecycleFeatureFlags().rideExtensionFlow;
}

function isRiderEarlyEndEnabled() {
  return getRideLifecycleFeatureFlags().riderEarlyEnd;
}

function isDriverEarlyEndSettlementEnabled() {
  return getRideLifecycleFeatureFlags().driverEarlyEndSettlement;
}

function isOperationalReassignmentEnabled() {
  return getRideLifecycleFeatureFlags().operationalReassignment;
}

function isMultiLegBillingEnabled() {
  return getRideLifecycleFeatureFlags().multiLegBilling;
}

// Push ao motorista sobre o que ele mesmo acabou de fazer (aceitar, iniciar).
// O app já mostra a notificação da corrida em andamento; o push duplicava o
// aviso e ficava preso na bandeja do Android depois do fim da corrida.
function isDriverSelfActionPushEnabled() {
  return getRideLifecycleFeatureFlags().driverSelfActionPush;
}

module.exports = {
  getRideLifecycleFeatureFlags,
  isRideExtensionFlowEnabled,
  isRiderEarlyEndEnabled,
  isDriverEarlyEndSettlementEnabled,
  isOperationalReassignmentEnabled,
  isMultiLegBillingEnabled,
  isDriverSelfActionPushEnabled
};

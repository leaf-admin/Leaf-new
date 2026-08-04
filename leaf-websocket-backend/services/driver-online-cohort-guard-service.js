'use strict';

const { evaluatePilotAccess } = require('./pilot-access-control-service');
const {
  commitDriverOnlineProjection
} = require('./driver-online-projection-service');
const {
  resolveDriverOnlineTransition
} = require('./driver-online-time-policy-service');

const DEFAULT_DENIAL_MESSAGE =
  'Este cadastro ainda não faz parte da operação assistida nesta região.';

async function enforceDriverOnlineCohort({
  redis,
  driverId,
  driverKey = null,
  eligibleGeoKey = null
} = {}) {
  if (!redis || !String(driverId || '').trim()) {
    return {
      allowed: false,
      code: 'PILOT_DRIVER_IDENTITY_UNAVAILABLE',
      retryable: true,
      reason: 'Não foi possível validar o acesso do motorista agora.',
      message: 'Não foi possível validar o acesso do motorista agora.'
    };
  }

  const access = evaluatePilotAccess({
    userId: driverId,
    role: 'driver',
    operation: 'driver_online'
  });

  if (access.allowed) {
    return access;
  }

  const checkedAt = new Date().toISOString();
  await commitDriverOnlineProjection(redis, {
    driverId,
    driverKey: driverKey || `driver:${driverId}`,
    eligibleGeoKey: eligibleGeoKey || process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
    isOnline: false,
    dispatchEligible: false,
    fields: {
      driverId,
      status: 'OFFLINE',
      isOnline: 'false',
      dispatchEligible: 'false',
      dispatchEligibilityCode: access.code || 'PILOT_COHORT_ACCESS_DENIED',
      dispatchEligibilityCheckedAt: checkedAt,
      updatedAt: checkedAt
    }
  });

  await resolveDriverOnlineTransition(redis, {
    driverId,
    isOnline: false
  });

  return {
    ...access,
    reason: access.message || DEFAULT_DENIAL_MESSAGE,
    message: access.message || DEFAULT_DENIAL_MESSAGE,
    checkedAt
  };
}

function buildPublicDriverCohortDenial(access = {}) {
  return {
    success: false,
    error: access.reason || access.message || DEFAULT_DENIAL_MESSAGE,
    message: access.reason || access.message || DEFAULT_DENIAL_MESSAGE,
    code: access.code || 'PILOT_COHORT_ACCESS_DENIED',
    retryable: access.retryable === true,
    assistedLaunchRestricted: true
  };
}

module.exports = {
  buildPublicDriverCohortDenial,
  enforceDriverOnlineCohort
};

const firebaseConfig = require('../firebase-config');
const { resolveDriverActivationState } = require('./driver-activation-state-service');
const { resolveActiveTripForDriver } = require('../utils/active-trip-index');
const { logStructured } = require('../utils/logger');

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isBlockedAccount(userData = {}) {
  const status = normalizeStatus(
    userData.accountStatus ||
      userData.driverStatus ||
      userData.status ||
      userData.safetyStatus
  );
  return ['blocked', 'suspended', 'banido', 'banned', 'rejected', 'denied'].includes(status);
}

function getActiveRideId(activeTrip) {
  return activeTrip?.bookingId || activeTrip?.rideId || activeTrip?.tripId || activeTrip?.id || null;
}

class DriverOnlinePolicyService {
  async getPolicy(driverId, context = {}) {
    const safeDriverId = String(driverId || '').trim();
    if (!safeDriverId) {
      return {
        success: false,
        canGoOnline: false,
        code: 'DRIVER_ID_REQUIRED',
        message: 'Motorista não identificado.'
      };
    }

    const db = firebaseConfig?.getRealtimeDB?.();
    if (!db) {
      return {
        success: false,
        canGoOnline: false,
        code: 'RTDB_UNAVAILABLE',
        message: 'Não foi possível validar seu cadastro agora.'
      };
    }

    const [activationState, userSnapshot, activeTrip] = await Promise.all([
      resolveDriverActivationState({ driverId: safeDriverId, db }),
      db.ref(`users/${safeDriverId}`).once('value'),
      resolveActiveTripForDriver(safeDriverId).catch(() => null)
    ]);

    const userData = userSnapshot?.val?.() || {};
    const activeRideId = getActiveRideId(activeTrip);
    const blockers = [];
    const warnings = [];
    const requiredActions = [];

    if (isBlockedAccount(userData)) {
      blockers.push({
        code: 'DRIVER_ACCOUNT_BLOCKED',
        message: 'Sua conta precisa de revisão antes de ficar online.'
      });
    }

    if (!activationState.canGoOnline) {
      const code = activationState.requiresLiveness
        ? 'IDENTITY_VERIFICATION_REQUIRED'
        : 'DRIVER_ACTIVATION_INCOMPLETE';
      const action = activationState.requiresLiveness
        ? 'start_identity_verification'
        : 'open_driver_activation';
      blockers.push({
        code,
        message: activationState.blockingReason || 'Finalize sua ativação para ficar online.'
      });
      requiredActions.push(action);
    }

    if (activeRideId) {
      warnings.push({
        code: 'ACTIVE_RIDE_DETECTED',
        message: 'Você já tem uma corrida ativa.'
      });
    }

    const canGoOnline = blockers.length === 0;
    const policy = {
      success: true,
      driverId: safeDriverId,
      canGoOnline,
      canAttemptOnline: activationState.canAttemptOnline === true && !isBlockedAccount(userData),
      requiresLiveness: activationState.requiresLiveness === true,
      neverInterruptActiveRide: true,
      activeRideId,
      activationState,
      blockers,
      warnings,
      requiredActions,
      hydration: {
        shouldHoldUiUntilResolved: true,
        resolvedAt: new Date().toISOString()
      },
      runtime: {
        source: 'backend',
        geofenceEnforced: String(process.env.ENABLE_DRIVER_ONLINE_GEOFENCE || 'false').toLowerCase() === 'true',
        minimumAppVersion: process.env.DRIVER_ONLINE_MIN_APP_VERSION || null
      }
    };

    if (context.intent === 'go_online') {
      logStructured(canGoOnline ? 'info' : 'warn', 'Driver online intent evaluated', {
        service: 'driver-online-policy-service',
        driverId: safeDriverId,
        canGoOnline,
        blockers: blockers.map((item) => item.code)
      });
    }

    return policy;
  }
}

module.exports = new DriverOnlinePolicyService();
module.exports.DriverOnlinePolicyService = DriverOnlinePolicyService;

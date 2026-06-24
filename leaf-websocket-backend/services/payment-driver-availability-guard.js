'use strict';

const DEFAULT_RADIUS_KM = Number.parseFloat(process.env.PAYMENT_AVAILABILITY_RADIUS_KM || '5');
const DEFAULT_LIMIT = Number.parseInt(process.env.PAYMENT_AVAILABILITY_LIMIT || '12', 10);
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

function getRedisPool() {
  return require('../utils/redis-pool');
}

function getDriverLockManager() {
  return require('./driver-lock-manager');
}

function getDriverEligibilityService() {
  return require('./driver-eligibility-service');
}

function getRideDispatchPreferenceService() {
  return require('./ride-dispatch-preference-service');
}

function getPaymentDriverReservationService() {
  return require('./payment-driver-reservation-service');
}

function normalizeFiniteNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLocation(value = {}) {
  if (!value || typeof value !== 'object') return null;
  const lat = normalizeFiniteNumber(value.lat ?? value.latitude);
  const lng = normalizeFiniteNumber(value.lng ?? value.longitude);
  if (lat === null || lng === null) return null;
  return {
    ...value,
    lat,
    lng
  };
}

function resolvePaymentLocation(payload = {}, keys = []) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, segment) => current?.[segment], payload);
    const normalized = normalizeLocation(value);
    if (normalized) return normalized;
  }
  return null;
}

function resolvePaymentCarType(payload = {}) {
  return (
    payload.carType ||
    payload.vehicle ||
    payload.vehicleCategory ||
    payload.rideDetails?.carType ||
    payload.rideDetails?.vehicle ||
    payload.rideDetails?.vehicleCategory ||
    null
  );
}

function buildPaymentAvailabilityInput(payload = {}) {
  return {
    pickupLocation: resolvePaymentLocation(payload, [
      'pickupLocation',
      'rideDetails.pickupLocation',
      'rideDetails.pickup',
      'rideDetails.originLocation',
      'rideDetails.originCoordinate'
    ]),
    destinationLocation: resolvePaymentLocation(payload, [
      'destinationLocation',
      'rideDetails.destinationLocation',
      'rideDetails.drop',
      'rideDetails.destinationCoordinate'
    ]),
    preferences:
      payload.preferences && typeof payload.preferences === 'object'
        ? payload.preferences
        : (payload.rideDetails?.preferences && typeof payload.rideDetails.preferences === 'object'
          ? payload.rideDetails.preferences
          : {}),
    carType: resolvePaymentCarType(payload)
  };
}

function isDriverOnlineAvailable(driverData = {}) {
  const isOnline = driverData.isOnline === true || driverData.isOnline === 'true';
  const dispatchEligible =
    driverData.dispatchEligible === true ||
    driverData.dispatchEligible === 'true' ||
    driverData.dispatchEligibilityCode === 'ELIGIBLE';
  const status = String(driverData.status || '').trim().toUpperCase();
  const available = status === 'AVAILABLE' || status === 'ONLINE';
  return isOnline && dispatchEligible && available;
}

async function hasPaymentEligibleDriver({
  pickupLocation,
  destinationLocation = null,
  preferences = {},
  carType = null,
  redis = null,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  eligibleGeoKey = ELIGIBLE_DRIVER_GEO_KEY,
  reserveDriver = false,
  reservationContext = {},
  reservationTtlSeconds = null,
  logStructured = () => {},
  logContext = {}
  } = {}) {
  const normalizedPickup = normalizeLocation(pickupLocation);
  if (!normalizedPickup) {
    return {
      success: false,
      hasDrivers: false,
      code: 'PICKUP_LOCATION_REQUIRED'
    };
  }

  const normalizedDestination = normalizeLocation(destinationLocation);
  const safeRadiusKm = Math.max(0.5, normalizeFiniteNumber(radiusKm) || 5);
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || 12);

  try {
    const redisPool = getRedisPool();
    const driverLockManager = getDriverLockManager();
    const driverEligibilityService = getDriverEligibilityService();
    const { driverMatchesRidePreferences } = getRideDispatchPreferenceService();
    const {
      getDriverPaymentReservation,
      reservePaymentDriver,
      reservationMatchesContext
    } = getPaymentDriverReservationService();

    await redisPool.ensureConnection();
    const redisClient = redis || redisPool.getConnection();
    const nearbyDrivers = await redisClient.georadius(
      eligibleGeoKey,
      normalizedPickup.lng,
      normalizedPickup.lat,
      safeRadiusKm,
      'km',
      'WITHDIST',
      'WITHCOORD',
      'COUNT',
      safeLimit
    );

    if (!Array.isArray(nearbyDrivers) || nearbyDrivers.length === 0) {
      return {
        success: true,
        hasDrivers: false,
        code: 'NO_DRIVERS_AVAILABLE',
        candidates: 0,
        eligible: 0,
        rejections: {},
        radiusKm: safeRadiusKm
      };
    }

    let eligible = 0;
    const rejections = {
      locked: 0,
      paymentReserved: 0,
      missingState: 0,
      offlineOrIneligible: 0,
      preferenceMismatch: 0,
      categoryMismatch: 0
    };
    for (const driverEntry of nearbyDrivers) {
      const driverId = Array.isArray(driverEntry) ? driverEntry[0] : driverEntry;
      if (!driverId) continue;

      const paymentReservation = await getDriverPaymentReservation(redisClient, driverId);
      if (paymentReservation && !reservationMatchesContext(paymentReservation, reservationContext)) {
        rejections.paymentReserved += 1;
        continue;
      }

      const lockStatus = await driverLockManager.isDriverLocked(driverId);
      if (lockStatus?.isLocked) {
        rejections.locked += 1;
        continue;
      }

      const driverData = await redisClient.hgetall(`driver:${driverId}`);
      if (!driverData || Object.keys(driverData).length === 0) {
        rejections.missingState += 1;
        continue;
      }
      if (!isDriverOnlineAvailable(driverData)) {
        rejections.offlineOrIneligible += 1;
        continue;
      }

      const preferenceMatch = driverMatchesRidePreferences(driverData, {
        pickupLocation: normalizedPickup,
        destinationLocation: normalizedDestination,
        preferences,
        carType
      });
      if (!preferenceMatch.ok) {
        rejections.preferenceMismatch += 1;
        continue;
      }

      const categoryEligibility = await driverEligibilityService.isDriverEligibleForRide(
        driverId,
        carType,
        driverData
      );
      if (!categoryEligibility?.eligible) {
        rejections.categoryMismatch += 1;
        continue;
      }

      eligible += 1;
      if (reserveDriver) {
        const reservationResult = await reservePaymentDriver({
          redis: redisClient,
          driverId,
          passengerId: reservationContext.passengerId,
          rideId: reservationContext.rideId,
          paymentSessionId: reservationContext.paymentSessionId,
          paymentContextKey: reservationContext.paymentContextKey,
          quoteSessionId: reservationContext.quoteSessionId,
          quoteLockId: reservationContext.quoteLockId,
          pickupLocation: normalizedPickup,
          destinationLocation: normalizedDestination,
          carType,
          ttlSeconds: reservationTtlSeconds
        });

        if (!reservationResult.success) {
          rejections.paymentReserved += 1;
          continue;
        }

        return {
          success: true,
          hasDrivers: true,
          code: 'DRIVER_RESERVED_FOR_PAYMENT',
          candidates: nearbyDrivers.length,
          eligible,
          rejections,
          radiusKm: safeRadiusKm,
          driverId,
          reservationId: reservationResult.reservationId,
          reservationExpiresAt: reservationResult.expiresAtIso,
          reservationTtlSeconds: reservationResult.ttlSeconds,
          reservation: reservationResult.reservation
        };
      }

      return {
        success: true,
        hasDrivers: true,
        code: 'DRIVERS_AVAILABLE',
        candidates: nearbyDrivers.length,
        eligible,
        rejections,
        radiusKm: safeRadiusKm,
        driverId
      };
    }

    return {
      success: true,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      candidates: nearbyDrivers.length,
      eligible,
      rejections,
      radiusKm: safeRadiusKm
    };
  } catch (error) {
    logStructured('error', 'payment advance availability guard failed', {
      ...logContext,
      code: 'PAYMENT_AVAILABILITY_CHECK_FAILED',
      error: error.message
    });
    return {
      success: false,
      hasDrivers: false,
      code: 'PAYMENT_AVAILABILITY_CHECK_FAILED',
      error: error.message
    };
  }
}

module.exports = {
  buildPaymentAvailabilityInput,
  hasPaymentEligibleDriver,
  normalizeLocation,
  isDriverOnlineAvailable
};

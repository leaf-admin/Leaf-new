'use strict';

const {
  getPaymentAvailabilityLimit,
  getPaymentAvailabilityRadiusKm
} = require('../utils/dispatch-config');

const DEFAULT_RADIUS_KM = getPaymentAvailabilityRadiusKm();
const DEFAULT_LIMIT = getPaymentAvailabilityLimit();
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

function getDriverSocketPresenceService() {
  return require('./driver-socket-presence-service');
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

function getSocketRooms(socket) {
  return Array.from(socket?.rooms || []);
}

function isDriverSocket(socket, driverId) {
  return Boolean(
    socket &&
    socket.userId === driverId &&
    socket.userType === 'driver' &&
    socket.connected !== false
  );
}

function isDriverSocketInDispatchRoom(socket, driverId) {
  if (!isDriverSocket(socket, driverId)) return false;
  const rooms = getSocketRooms(socket);
  return rooms.includes('drivers_room') || rooms.includes(`driver_${driverId}`);
}

async function isDriverDispatchReachable(io, driverId, redis = null) {
  if (!driverId) {
    return {
      reachable: false,
      code: 'DRIVER_ID_REQUIRED'
    };
  }

  let socketCode = io ? 'DRIVER_SOCKET_OFFLINE' : 'SOCKET_CONTEXT_UNAVAILABLE';
  let socketError = null;

  if (io) {
    const cachedSocket = io?.connectedUsers?.get?.(driverId);
    if (isDriverSocketInDispatchRoom(cachedSocket, driverId)) {
      return {
        reachable: true,
        code: 'LOCAL_CONNECTED_USER'
      };
    }

    try {
      const socketsInRoom = await io.in(`driver_${driverId}`).fetchSockets();
      const reachable = Array.isArray(socketsInRoom) &&
        socketsInRoom.some((socket) => isDriverSocketInDispatchRoom(socket, driverId));
      if (reachable) {
        return {
          reachable: true,
          code: 'ROOM_SOCKET_REACHABLE'
        };
      }
    } catch (error) {
      socketCode = 'SOCKET_REACHABILITY_CHECK_FAILED';
      socketError = error.message;
    }
  }

  if (redis) {
    try {
      const { readDriverSocketPresence } = getDriverSocketPresenceService();
      const presence = await readDriverSocketPresence(redis, driverId);
      if (presence.reachable) {
        return {
          reachable: true,
          code: presence.code,
          presence
        };
      }
      socketCode = presence.code || socketCode;
    } catch (error) {
      socketCode = 'SOCKET_PRESENCE_CHECK_FAILED';
      socketError = error.message;
    }
  }

  return {
    reachable: false,
    code: socketCode,
    error: socketError
  };
}

function estimatePickupEtaMinFromDistance(distanceKm) {
  const normalizedDistanceKm = normalizeFiniteNumber(distanceKm);
  if (normalizedDistanceKm === null || normalizedDistanceKm < 0) {
    return null;
  }

  const averageUrbanPickupKmPerMin = Math.max(
    0.2,
    normalizeFiniteNumber(process.env.PAYMENT_AVAILABILITY_PICKUP_KM_PER_MIN) || 0.35
  );
  return Math.max(2, Math.ceil(normalizedDistanceKm / averageUrbanPickupKmPerMin));
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
  io = null,
  requireDispatchReachability = Boolean(io) &&
    String(process.env.PAYMENT_AVAILABILITY_REQUIRE_DISPATCH_REACHABILITY || 'true').toLowerCase() !== 'false',
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
      socketUnreachable: 0,
      preferenceMismatch: 0,
      categoryMismatch: 0
    };
    for (const driverEntry of nearbyDrivers) {
      const driverId = Array.isArray(driverEntry) ? driverEntry[0] : driverEntry;
      const driverDistanceKm = Array.isArray(driverEntry)
        ? normalizeFiniteNumber(driverEntry[1])
        : null;
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

      if (requireDispatchReachability) {
        const reachability = await isDriverDispatchReachable(io, driverId, redisClient);
        if (!reachability.reachable) {
          rejections.socketUnreachable += 1;
          logStructured('warn', 'payment driver availability rejected unreachable driver', {
            ...logContext,
            code: reachability.code,
            driverId,
            reachabilityError: reachability.error || null
          });
          continue;
        }
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
          driverDistanceKm,
          estimatedPickupEtaMin: estimatePickupEtaMinFromDistance(driverDistanceKm),
          driverId,
          reservationId: reservationResult.reservationId,
          reservationExpiresAt: reservationResult.expiresAtIso,
          reservationTtlSeconds: reservationResult.ttlSeconds,
          reservationReused: reservationResult.reused === true,
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
        driverDistanceKm,
        estimatedPickupEtaMin: estimatePickupEtaMinFromDistance(driverDistanceKm),
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
  estimatePickupEtaMinFromDistance,
  normalizeLocation,
  isDriverOnlineAvailable,
  isDriverDispatchReachable
};

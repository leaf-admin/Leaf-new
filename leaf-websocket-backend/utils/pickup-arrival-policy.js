const DEFAULT_PICKUP_TOLERANCE_METERS = Math.max(
  5,
  Number.parseInt(process.env.PICKUP_ARRIVAL_TOLERANCE_METERS || '20', 10) || 20
);

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonMaybe(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function normalizeCoordinate(value) {
  const candidate = parseJsonMaybe(value);
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const latitude = toFiniteNumber(candidate.latitude ?? candidate.lat);
  const longitude = toFiniteNumber(candidate.longitude ?? candidate.lng);
  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function resolveBookingPickupCoordinate(booking = {}) {
  return (
    normalizeCoordinate(booking.pickupCoordinate) ||
    normalizeCoordinate(booking.pickupLocation) ||
    normalizeCoordinate(booking.pickup) ||
    normalizeCoordinate(booking.originLocation) ||
    normalizeCoordinate(booking.origin)
  );
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(origin, destination) {
  const safeOrigin = normalizeCoordinate(origin);
  const safeDestination = normalizeCoordinate(destination);
  if (!safeOrigin || !safeDestination) {
    return null;
  }

  const earthRadiusMeters = 6371000;
  const deltaLat = toRad(safeDestination.latitude - safeOrigin.latitude);
  const deltaLng = toRad(safeDestination.longitude - safeOrigin.longitude);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRad(safeOrigin.latitude)) *
      Math.cos(toRad(safeDestination.latitude)) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

async function resolveDriverCoordinate({ redis, driverId, location }) {
  const directLocation = normalizeCoordinate(location);
  if (directLocation) {
    return directLocation;
  }

  if (!redis || !driverId) {
    return null;
  }

  try {
    const geoPosition = await redis.geopos('driver_locations', driverId);
    const point = Array.isArray(geoPosition) ? geoPosition[0] : null;
    const longitude = toFiniteNumber(point?.[0]);
    const latitude = toFiniteNumber(point?.[1]);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  } catch (_error) {
    // noop
  }

  try {
    const driverState = await redis.hgetall(`driver:${driverId}`);
    const latitude = toFiniteNumber(driverState?.lat ?? driverState?.latitude);
    const longitude = toFiniteNumber(driverState?.lng ?? driverState?.longitude);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude };
    }
  } catch (_error) {
    // noop
  }

  return null;
}

async function assessDriverArrivalAtPickup({
  redis,
  driverId,
  booking,
  location,
  toleranceMeters = DEFAULT_PICKUP_TOLERANCE_METERS
}) {
  const pickupCoordinate = resolveBookingPickupCoordinate(booking);
  if (!pickupCoordinate) {
    return {
      allowed: false,
      code: 'PICKUP_COORDINATE_UNAVAILABLE',
      message: 'Não foi possível validar o local de embarque agora.',
      toleranceMeters
    };
  }

  const driverCoordinate = await resolveDriverCoordinate({ redis, driverId, location });
  if (!driverCoordinate) {
    return {
      allowed: false,
      code: 'DRIVER_LOCATION_UNAVAILABLE',
      message: 'Não foi possível validar sua localização atual.',
      toleranceMeters,
      pickupCoordinate
    };
  }

  const distanceMetersRaw = calculateDistanceMeters(driverCoordinate, pickupCoordinate);
  const distanceMeters = Number.isFinite(distanceMetersRaw) ? Math.round(distanceMetersRaw) : null;
  if (!Number.isFinite(distanceMeters)) {
    return {
      allowed: false,
      code: 'PICKUP_DISTANCE_UNAVAILABLE',
      message: 'Não foi possível calcular a distância até o embarque.',
      toleranceMeters,
      pickupCoordinate,
      driverCoordinate
    };
  }

  if (distanceMeters > toleranceMeters) {
    return {
      allowed: false,
      code: 'PICKUP_TOLERANCE_NOT_REACHED',
      message: `Aproxime-se do embarque para registrar chegada. Distância atual: ${distanceMeters} m.`,
      distanceMeters,
      toleranceMeters,
      pickupCoordinate,
      driverCoordinate
    };
  }

  return {
    allowed: true,
    distanceMeters,
    toleranceMeters,
    pickupCoordinate,
    driverCoordinate
  };
}

module.exports = {
  DEFAULT_PICKUP_TOLERANCE_METERS,
  normalizeCoordinate,
  resolveBookingPickupCoordinate,
  assessDriverArrivalAtPickup
};

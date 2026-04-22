function isCoordinateValid(value) {
  return Boolean(value) &&
    Number.isFinite(Number(value.latitude)) &&
    Number.isFinite(Number(value.longitude));
}

function normalizeCoordinate(value) {
  if (!isCoordinateValid(value)) {
    return null;
  }

  return {
    latitude: Number(value.latitude),
    longitude: Number(value.longitude),
  };
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

function calculateDistanceMeters(origin, destination) {
  if (!isCoordinateValid(origin) || !isCoordinateValid(destination)) {
    return Number.NaN;
  }

  const earthRadiusMeters = 6371000;
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

export function buildPlaybackPath(routeCoordinates = [], origin = null, destination = null) {
  const normalizedRoute = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeCoordinate).filter(Boolean)
    : [];

  if (normalizedRoute.length >= 2) {
    return normalizedRoute;
  }

  const normalizedOrigin = normalizeCoordinate(origin);
  const normalizedDestination = normalizeCoordinate(destination);
  return [normalizedOrigin, normalizedDestination].filter(Boolean);
}

const DEFAULT_ROUTE_PLAYBACK_PROFILE = Object.freeze({
  idle: Object.freeze({
    speedMetersPerSecond: 0,
  }),
  accepted: Object.freeze({
    speedMetersPerSecond: 8,
  }),
  started: Object.freeze({
    speedMetersPerSecond: 10,
  }),
});

function findNearestPathIndex(path, coordinate) {
  if (!Array.isArray(path) || path.length === 0 || !isCoordinateValid(coordinate)) {
    return 0;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  path.forEach((item, index) => {
    const distance = calculateDistanceMeters(coordinate, item);
    if (Number.isFinite(distance) && distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function interpolateCoordinate(origin, destination, progressRatio) {
  return {
    latitude:
      Number(origin.latitude) +
      (Number(destination.latitude) - Number(origin.latitude)) * progressRatio,
    longitude:
      Number(origin.longitude) +
      (Number(destination.longitude) - Number(origin.longitude)) * progressRatio,
  };
}

export function calculateHeadingDegrees(origin, destination) {
  if (!isCoordinateValid(origin) || !isCoordinateValid(destination)) {
    return null;
  }

  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);

  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);

  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

export function advanceCoordinateAlongPath({
  currentCoordinate,
  path,
  stepMeters,
  destinationCoordinate = null,
  arrivalToleranceMeters = 18,
}) {
  const current = normalizeCoordinate(currentCoordinate);
  const normalizedPath = Array.isArray(path) ? path.map(normalizeCoordinate).filter(Boolean) : [];
  const destination = normalizeCoordinate(destinationCoordinate) ||
    normalizedPath[normalizedPath.length - 1] ||
    null;

  if (!current || !destination || normalizedPath.length < 2) {
    return null;
  }

  const currentToDestinationMeters = calculateDistanceMeters(current, destination);
  if (
    Number.isFinite(currentToDestinationMeters) &&
    currentToDestinationMeters <= arrivalToleranceMeters
  ) {
    return {
      coordinate: destination,
      heading: calculateHeadingDegrees(current, destination),
      reachedDestination: true,
      remainingMeters: 0,
    };
  }

  let remainingStepMeters = Math.max(1, Number(stepMeters) || 1);
  let pointerIndex = findNearestPathIndex(normalizedPath, current);
  let segmentStart = current;

  while (pointerIndex < normalizedPath.length - 1) {
    const segmentEnd = normalizedPath[pointerIndex + 1];
    const segmentMeters = calculateDistanceMeters(segmentStart, segmentEnd);

    if (!Number.isFinite(segmentMeters) || segmentMeters <= 0) {
      pointerIndex += 1;
      segmentStart = segmentEnd;
      continue;
    }

    if (segmentMeters <= remainingStepMeters) {
      remainingStepMeters -= segmentMeters;
      pointerIndex += 1;
      segmentStart = segmentEnd;
      continue;
    }

    const progressRatio = remainingStepMeters / segmentMeters;
    const nextCoordinate = interpolateCoordinate(
      segmentStart,
      segmentEnd,
      progressRatio,
    );

    return {
      coordinate: nextCoordinate,
      heading: calculateHeadingDegrees(segmentStart, segmentEnd),
      reachedDestination: false,
      remainingMeters: Math.max(
        0,
        calculateDistanceMeters(nextCoordinate, destination),
      ),
    };
  }

  return {
    coordinate: destination,
    heading: calculateHeadingDegrees(current, destination),
    reachedDestination: true,
    remainingMeters: 0,
  };
}

export function resolvePlaybackProfile(status, options = {}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const fallbackProfile =
    DEFAULT_ROUTE_PLAYBACK_PROFILE[normalizedStatus] ||
    DEFAULT_ROUTE_PLAYBACK_PROFILE.idle;
  const tickMs = Math.max(250, Number(options.tickMs) || 2500);
  const qaMultiplier = Math.max(0.1, Number(options.qaMultiplier) || 1);
  const speedMetersPerSecond = Math.max(
    0,
    Number(options.speedMetersPerSecond ?? fallbackProfile.speedMetersPerSecond) || 0,
  );
  const stepMeters =
    speedMetersPerSecond <= 0
      ? 0
      : Math.max(
          1,
          Math.round(speedMetersPerSecond * (tickMs / 1000) * qaMultiplier),
        );

  return {
    status: normalizedStatus,
    tickMs,
    qaMultiplier,
    speedMetersPerSecond,
    stepMeters,
  };
}

export function resolvePlaybackStepMeters(status, options = {}) {
  return resolvePlaybackProfile(status, options).stepMeters;
}

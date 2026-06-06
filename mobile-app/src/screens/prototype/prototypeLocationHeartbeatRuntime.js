export const DRIVER_LOCATION_HEARTBEAT_MS = 5000;
export const PASSENGER_LOCATION_HEARTBEAT_MS = 2000;
export const PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS = 4500;
export const PASSENGER_LOCATION_STARTED_HEARTBEAT_MS = 3000;
export const PASSENGER_LOCATION_MIN_SEND_GAP_MS = 900;
export const PASSENGER_LOCATION_MIN_MOVEMENT_METERS = 6;
export const PASSENGER_LOCATION_MIN_HEADING_DELTA_DEG = 8;

function normalizeCoordinate(coordinate) {
  if (!coordinate) {
    return null;
  }

  const latitude = Number(coordinate.latitude ?? coordinate.lat);
  const longitude = Number(coordinate.longitude ?? coordinate.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

export function calculateHeartbeatDistanceMeters(origin, destination) {
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

export function buildDriverLocationPayload(runtimeState = {}) {
  const fallbackCoordinate =
    runtimeState?.driverCoordinate || runtimeState?.currentCoordinate || null;
  const latitude = Number(fallbackCoordinate?.latitude);
  const longitude = Number(fallbackCoordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const heading = Number(runtimeState?.currentHeading || 0);
  return {
    lat: latitude,
    lng: longitude,
    heading: Number.isFinite(heading) ? heading : 0,
    speed: 0,
  };
}

export function buildPassengerLocationPayload(runtimeState = {}) {
  const latitude = Number(runtimeState?.currentCoordinate?.latitude);
  const longitude = Number(runtimeState?.currentCoordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const heading = Number(runtimeState?.currentHeading || 0);
  return {
    lat: latitude,
    lng: longitude,
    heading: Number.isFinite(heading) ? heading : 0,
    speed: 0,
  };
}

export function normalizeHeadingDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function calculateHeadingDeltaDegrees(previousHeading, nextHeading) {
  const start = normalizeHeadingDegrees(previousHeading);
  const end = normalizeHeadingDegrees(nextHeading);
  const rawDelta = Math.abs(end - start);
  return Math.min(rawDelta, 360 - rawDelta);
}

export function shouldThrottlePassengerLocationPush({
  bookingId,
  bookingStatus,
  location,
  force = false,
  lastSentAt = 0,
  lastBookingId = null,
  lastBookingStatus = "",
  lastLocation = null,
  lastHeading = 0,
  nowMs = Date.now(),
}) {
  if (force || !lastSentAt) {
    return false;
  }

  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();
  if (
    String(lastBookingId || "") !== String(bookingId || "") ||
    String(lastBookingStatus || "").trim().toLowerCase() !== normalizedStatus
  ) {
    return false;
  }

  const elapsedMs = Number(nowMs) - Number(lastSentAt);
  const minIntervalMs =
    normalizedStatus === "started"
      ? PASSENGER_LOCATION_STARTED_HEARTBEAT_MS
      : PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS;

  if (elapsedMs >= minIntervalMs) {
    return false;
  }

  const movedMeters = calculateHeartbeatDistanceMeters(lastLocation, location);
  if (
    Number.isFinite(movedMeters) &&
    movedMeters >= PASSENGER_LOCATION_MIN_MOVEMENT_METERS
  ) {
    return false;
  }

  const headingDelta = calculateHeadingDeltaDegrees(lastHeading, location?.heading);
  if (headingDelta >= PASSENGER_LOCATION_MIN_HEADING_DELTA_DEG) {
    return false;
  }

  return true;
}

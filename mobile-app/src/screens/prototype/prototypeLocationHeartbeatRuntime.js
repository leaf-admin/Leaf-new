export const DRIVER_LOCATION_HEARTBEAT_MS = 5000;
export const PASSENGER_LOCATION_HEARTBEAT_MS = 2000;
export const PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS = 4500;
export const PASSENGER_LOCATION_STARTED_HEARTBEAT_MS = 3000;
export const PASSENGER_LOCATION_MIN_SEND_GAP_MS = 900;
export const PASSENGER_LOCATION_MIN_MOVEMENT_METERS = 6;
export const PASSENGER_LOCATION_MIN_HEADING_DELTA_DEG = 8;
const PASSENGER_HEARTBEAT_ACTIVE_STATUSES = new Set([
  "accepted",
  "arrived",
  "started",
]);

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

function assertHeartbeatSocket(socket, methodName) {
  if (!socket || typeof socket[methodName] !== "function") {
    throw new Error("Serviço de localização indisponível.");
  }
}

function resolveHeartbeatSentAt(nowMs = null) {
  const numericNowMs = Number(nowMs);
  const sentAtMs = Number.isFinite(numericNowMs) ? numericNowMs : Date.now();
  return {
    sentAtMs,
    sentAtIso: new Date(sentAtMs).toISOString(),
  };
}

export async function sendDriverLocationHeartbeat({
  profileUid = "",
  location = null,
  socket = null,
  routePlanShare = null,
  nowMs = null,
} = {}) {
  const normalizedProfileUid = String(profileUid || "").trim();
  if (!normalizedProfileUid) {
    return { success: false, code: "PROFILE_REQUIRED" };
  }

  if (!location) {
    return { success: false, code: "LOCATION_REQUIRED" };
  }

  assertHeartbeatSocket(socket, "updateLocation");
  await socket.updateLocation(
    normalizedProfileUid,
    location.lat,
    location.lng,
    location.heading,
    location.speed,
    routePlanShare?.payload || {},
  );

  const { sentAtMs, sentAtIso } = resolveHeartbeatSentAt(nowMs);
  return {
    success: true,
    location,
    routePlanSignature: routePlanShare?.signature || "",
    sentAtMs,
    heartbeatPatch: {
      running: true,
      lastSentAt: sentAtIso,
      lastError: "",
    },
  };
}

export async function sendPassengerLocationHeartbeat({
  bookingId = "",
  location = null,
  socket = null,
  nowMs = null,
} = {}) {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    return { success: false, code: "BOOKING_REQUIRED" };
  }

  if (!location) {
    return { success: false, code: "LOCATION_REQUIRED" };
  }

  assertHeartbeatSocket(socket, "updatePassengerLocation");
  await socket.updatePassengerLocation(
    normalizedBookingId,
    location.lat,
    location.lng,
    location.heading,
    location.speed,
  );

  const { sentAtMs, sentAtIso } = resolveHeartbeatSentAt(nowMs);
  return {
    success: true,
    location,
    bookingId: normalizedBookingId,
    sentAtMs,
    heartbeatPatch: {
      running: true,
      lastSentAt: sentAtIso,
      lastError: "",
    },
    locationSnapshot: {
      latitude: location.lat,
      longitude: location.lng,
    },
    heading: Number(location.heading || 0),
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

export function shouldMonitorPassengerTripulation(runtimeState = {}) {
  return (
    Boolean(runtimeState?.activeBookingId) &&
    PASSENGER_HEARTBEAT_ACTIVE_STATUSES.has(
      String(runtimeState?.bookingStatus || "").trim().toLowerCase(),
    )
  );
}

export function buildPassengerHeartbeatStartKey(profileUid = "", bookingId = "") {
  const normalizedProfileUid = String(profileUid || "").trim();
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedProfileUid || !normalizedBookingId) {
    return "";
  }

  return `${normalizedProfileUid}:${normalizedBookingId}`;
}

export function shouldReusePassengerHeartbeat({
  hasInterval = false,
  activeProfileUid = "",
  activeBookingId = "",
  profileUid = "",
  bookingId = "",
}) {
  return (
    Boolean(hasInterval) &&
    String(activeProfileUid || "") === String(profileUid || "") &&
    String(activeBookingId || "") === String(bookingId || "")
  );
}

export function shouldReusePendingPassengerHeartbeatStart({
  pendingStartPromise = null,
  pendingStartKey = "",
  startKey = "",
}) {
  return Boolean(pendingStartPromise) && String(pendingStartKey || "") === String(startKey || "");
}

export function shouldCoalescePassengerLocationAttempt({
  force = false,
  bookingId = "",
  lastBookingId = "",
  lastAttemptAt = 0,
  nowMs = Date.now(),
}) {
  if (force) {
    return false;
  }

  return (
    String(lastBookingId || "") === String(bookingId || "") &&
    Number(lastAttemptAt || 0) > 0 &&
    Number(nowMs) - Number(lastAttemptAt || 0) < PASSENGER_LOCATION_MIN_SEND_GAP_MS
  );
}

export function buildPassengerHeartbeatState(previousState = {}, patch = {}) {
  return {
    passengerLocationHeartbeat: {
      ...(previousState.passengerLocationHeartbeat || {}),
      ...patch,
    },
  };
}

export function buildDriverHeartbeatState(previousState = {}, patch = {}) {
  return {
    driverLocationHeartbeat: {
      ...(previousState.driverLocationHeartbeat || {}),
      ...patch,
    },
  };
}

export function buildDriverLocationHeartbeatState(
  previousState = {},
  location = null,
  heartbeatPatch = {},
) {
  const latitude = Number(location?.lat ?? location?.latitude);
  const longitude = Number(location?.lng ?? location?.longitude);
  const coordinatePatch =
    Number.isFinite(latitude) && Number.isFinite(longitude)
      ? {
          currentCoordinate: {
            latitude,
            longitude,
          },
          driverCoordinate: {
            latitude,
            longitude,
          },
        }
      : {};

  return {
    ...coordinatePatch,
    ...buildDriverHeartbeatState(previousState, heartbeatPatch),
  };
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

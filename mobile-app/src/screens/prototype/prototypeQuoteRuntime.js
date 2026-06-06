export const MAX_DIRECTIONS_REQUESTS_PER_BOOKING = Math.max(
  1,
  Number.parseInt(
    process.env.EXPO_PUBLIC_MAX_DIRECTIONS_REQUESTS_PER_BOOKING || "6",
    10,
  ) || 6,
);

export const QUOTE_LOCK_VALIDITY_MS = Math.max(
  15000,
  Number.parseInt(process.env.EXPO_PUBLIC_QUOTE_VALIDITY_MS || "120000", 10) ||
    120000,
);

export const QUOTE_LOCK_COORDINATE_PRECISION = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_COORDINATE_PRECISION || "3",
    10,
  ) || 3,
);

export const QUOTE_LOCK_MAX_ROUTE_POINTS = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_MAX_ROUTE_POINTS || "180",
    10,
  ) || 180,
);

const runtimeDirectionsRequestsByBooking = new Map();

function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function buildQuoteTripEtaText(durationMinutes) {
  const numericDuration = Number(durationMinutes);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return "";
  }

  return `Chegada estimada em ${Math.max(1, Math.round(numericDuration))} min`;
}

export function normalizeRuntimeCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

export function normalizeRuntimeRouteCoordinates(coordinates = []) {
  return Array.isArray(coordinates)
    ? coordinates.map(normalizeRuntimeCoordinate).filter(Boolean)
    : [];
}

export function normalizeQuoteLockCoordinate(
  value,
  precision = QUOTE_LOCK_COORDINATE_PRECISION,
) {
  const normalized = normalizeRuntimeCoordinate(value);
  if (!normalized) {
    return null;
  }

  return {
    latitude: Number(normalized.latitude.toFixed(precision)),
    longitude: Number(normalized.longitude.toFixed(precision)),
  };
}

export function buildQuoteLockRouteKey(originCoordinate, destinationCoordinate) {
  const normalizedOrigin = normalizeQuoteLockCoordinate(originCoordinate);
  const normalizedDestination = normalizeQuoteLockCoordinate(
    destinationCoordinate,
  );
  if (!normalizedOrigin || !normalizedDestination) {
    return "";
  }

  return [
    normalizedOrigin.latitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedOrigin.longitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedDestination.latitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedDestination.longitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
  ].join(":");
}

function normalizeQuoteLockTimestamp(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  return Math.round(numericValue);
}

export function normalizePersistedQuoteLock(lockInput = null, nowMs = Date.now()) {
  if (!lockInput || typeof lockInput !== "object") {
    return null;
  }

  const routeKey = sanitizeText(lockInput.routeKey, "");
  if (!routeKey) {
    return null;
  }

  const createdAt =
    normalizeQuoteLockTimestamp(lockInput.createdAt) || Date.now();
  const fallbackExpiresAt = createdAt + QUOTE_LOCK_VALIDITY_MS;
  const expiresAt =
    normalizeQuoteLockTimestamp(lockInput.expiresAt) || fallbackExpiresAt;

  if (expiresAt <= nowMs) {
    return null;
  }

  const distanceKm = Number(lockInput.distanceKm);
  const durationMinutes = Number(lockInput.durationMinutes);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  return {
    routeKey,
    distanceKm: Number(distanceKm.toFixed(1)),
    durationMinutes: Math.max(1, Math.round(durationMinutes)),
    etaText:
      sanitizeText(lockInput.etaText, "") ||
      buildQuoteTripEtaText(Math.max(1, Math.round(durationMinutes))),
    createdAt,
    expiresAt,
    coordinates: normalizeRuntimeRouteCoordinates(lockInput.coordinates).slice(
      0,
      QUOTE_LOCK_MAX_ROUTE_POINTS,
    ),
  };
}

export function resolveActiveQuoteLock(lockInput = null, routeKey = "", nowMs = Date.now()) {
  const normalizedRouteKey = sanitizeText(routeKey, "");
  if (!normalizedRouteKey) {
    return null;
  }

  const normalizedLock = normalizePersistedQuoteLock(lockInput, nowMs);
  if (!normalizedLock) {
    return null;
  }

  if (normalizedLock.routeKey !== normalizedRouteKey) {
    return null;
  }

  return normalizedLock;
}

export function buildQuoteLockSnapshot({
  originCoordinate,
  destinationCoordinate,
  distanceKm,
  durationMinutes,
  etaText = "",
  coordinates = [],
  nowMs = Date.now(),
}) {
  const routeKey = buildQuoteLockRouteKey(originCoordinate, destinationCoordinate);
  if (!routeKey) {
    return null;
  }

  const normalizedDistanceKm = Number(distanceKm);
  const normalizedDurationMinutes = Number(durationMinutes);
  if (!Number.isFinite(normalizedDistanceKm) || normalizedDistanceKm <= 0) {
    return null;
  }
  if (
    !Number.isFinite(normalizedDurationMinutes) ||
    normalizedDurationMinutes <= 0
  ) {
    return null;
  }

  const createdAt = nowMs;

  return {
    routeKey,
    distanceKm: Number(normalizedDistanceKm.toFixed(1)),
    durationMinutes: Math.max(1, Math.round(normalizedDurationMinutes)),
    etaText:
      sanitizeText(etaText, "") ||
      buildQuoteTripEtaText(Math.max(1, Math.round(normalizedDurationMinutes))),
    createdAt,
    expiresAt: createdAt + QUOTE_LOCK_VALIDITY_MS,
    coordinates: normalizeRuntimeRouteCoordinates(coordinates).slice(
      0,
      QUOTE_LOCK_MAX_ROUTE_POINTS,
    ),
  };
}

export function registerDirectionsRequestForBooking(bookingIdInput) {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return {
      allowed: true,
      count: 0,
      max: MAX_DIRECTIONS_REQUESTS_PER_BOOKING,
    };
  }

  const currentCount = Number(runtimeDirectionsRequestsByBooking.get(bookingId) || 0);
  if (currentCount >= MAX_DIRECTIONS_REQUESTS_PER_BOOKING) {
    return {
      allowed: false,
      count: currentCount,
      max: MAX_DIRECTIONS_REQUESTS_PER_BOOKING,
    };
  }

  const nextCount = currentCount + 1;
  runtimeDirectionsRequestsByBooking.set(bookingId, nextCount);
  return {
    allowed: true,
    count: nextCount,
    max: MAX_DIRECTIONS_REQUESTS_PER_BOOKING,
  };
}

export function clearDirectionsBudgetForBooking(bookingIdInput) {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return;
  }
  runtimeDirectionsRequestsByBooking.delete(bookingId);
}

export function resetDirectionsBudgetForTests() {
  runtimeDirectionsRequestsByBooking.clear();
}

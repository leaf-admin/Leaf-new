const DEFAULT_DRIVER_DESTINATION_MIN_PROGRESS_KM = Math.max(
  0,
  Number.parseFloat(process.env.DRIVER_DESTINATION_MIN_PROGRESS_KM || '1') || 1
);
const DEFAULT_DRIVER_DESTINATION_ARRIVAL_RADIUS_KM = Math.max(
  0.3,
  Number.parseFloat(process.env.DRIVER_DESTINATION_ARRIVAL_RADIUS_KM || '3') || 3
);

function toBooleanFlag(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(
    String(value).trim().toLowerCase()
  );
}

function toNumber(value, fallback = NaN) {
  const parsed = Number(
    typeof value === 'string' ? value.replace(',', '.') : value
  );
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCoordinate(value = {}) {
  const lat = toNumber(value.lat ?? value.latitude, NaN);
  const lng = toNumber(value.lng ?? value.longitude, NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function haversineDistanceKm(a, b) {
  const origin = normalizeCoordinate(a);
  const destination = normalizeCoordinate(b);
  if (!origin || !destination) return NaN;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(destination.lat - origin.lat);
  const dLng = toRad(destination.lng - origin.lng);
  const lat1 = toRad(origin.lat);
  const lat2 = toRad(destination.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function normalizeGender(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!normalized) return null;
  if (['f', 'female', 'feminino', 'mulher', 'woman'].includes(normalized)) {
    return 'female';
  }
  if (['m', 'male', 'masculino', 'homem', 'man'].includes(normalized)) {
    return 'male';
  }
  return normalized;
}

function extractLeafDelasPreference(requirements = {}) {
  const preferences = requirements.preferences || requirements || {};
  return toBooleanFlag(
    preferences.leafDelas ||
      preferences.leafDelasEnabled ||
      preferences.femaleDriverOnly ||
      preferences.womenOnly ||
      requirements.femaleDriverOnly
  );
}

function getDriverGender(driverData = {}) {
  return normalizeGender(
    driverData.gender ||
      driverData.genero ||
      driverData.genderCode ||
      driverData.genderLabel ||
      driverData.driverGender
  );
}

function getDriverDestinationMode(driverData = {}) {
  const active = toBooleanFlag(
    driverData.destinationModeActive ||
      driverData.driverDestinationModeActive ||
      driverData.destinationFilterActive
  );
  const expiresAtRaw =
    driverData.destinationModeExpiresAt ||
    driverData.driverDestinationExpiresAt ||
    driverData.destinationFilterExpiresAt ||
    null;
  const expiresAtMs = expiresAtRaw ? Date.parse(String(expiresAtRaw)) : NaN;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs < Date.now();

  const target = normalizeCoordinate({
    lat:
      driverData.destinationModeLat ??
      driverData.driverDestinationLat ??
      driverData.destinationFilterLat,
    lng:
      driverData.destinationModeLng ??
      driverData.driverDestinationLng ??
      driverData.destinationFilterLng
  });

  return {
    active: active && !expired,
    target,
    expired,
    minProgressKm: Math.max(
      0,
      toNumber(
        driverData.destinationModeMinProgressKm ??
          driverData.driverDestinationMinProgressKm,
        DEFAULT_DRIVER_DESTINATION_MIN_PROGRESS_KM
      )
    ),
    arrivalRadiusKm: Math.max(
      0.3,
      toNumber(
        driverData.destinationModeArrivalRadiusKm ??
          driverData.driverDestinationArrivalRadiusKm,
        DEFAULT_DRIVER_DESTINATION_ARRIVAL_RADIUS_KM
      )
    )
  };
}

function hasRideDispatchPreferences(requirements = {}) {
  const preferences = requirements.preferences || requirements || {};
  return Boolean(
    extractLeafDelasPreference(requirements) ||
      preferences.destinationLocation ||
      requirements.destinationLocation ||
      requirements.destination ||
      requirements.drop
  );
}

function driverMatchesLeafDelas(driverData = {}, requirements = {}) {
  if (!extractLeafDelasPreference(requirements)) {
    return { ok: true, reason: 'LEAF_DELAS_NOT_REQUESTED' };
  }

  const gender = getDriverGender(driverData);
  if (gender === 'female') {
    return { ok: true, reason: 'LEAF_DELAS_DRIVER_MATCH' };
  }

  return {
    ok: false,
    reason: gender ? 'LEAF_DELAS_DRIVER_GENDER_MISMATCH' : 'LEAF_DELAS_DRIVER_GENDER_UNKNOWN'
  };
}

function driverMatchesDestinationMode(driverData = {}, requirements = {}) {
  const mode = getDriverDestinationMode(driverData);
  if (!mode.active) {
    return { ok: true, reason: mode.expired ? 'DRIVER_DESTINATION_EXPIRED' : 'DRIVER_DESTINATION_INACTIVE' };
  }

  if (!mode.target) {
    return { ok: false, reason: 'DRIVER_DESTINATION_TARGET_MISSING' };
  }

  const pickupLocation = normalizeCoordinate(
    requirements.pickupLocation || requirements.pickup || {}
  );
  const destinationLocation = normalizeCoordinate(
    requirements.destinationLocation ||
      requirements.destination ||
      requirements.drop ||
      {}
  );

  if (!pickupLocation || !destinationLocation) {
    return { ok: false, reason: 'RIDE_DESTINATION_REQUIRED_FOR_DRIVER_DESTINATION_MODE' };
  }

  const pickupToTargetKm = haversineDistanceKm(pickupLocation, mode.target);
  const destinationToTargetKm = haversineDistanceKm(destinationLocation, mode.target);
  if (!Number.isFinite(pickupToTargetKm) || !Number.isFinite(destinationToTargetKm)) {
    return { ok: false, reason: 'DRIVER_DESTINATION_DISTANCE_INVALID' };
  }

  const progressKm = pickupToTargetKm - destinationToTargetKm;
  const reachesTargetArea = destinationToTargetKm <= mode.arrivalRadiusKm;
  const makesProgress = progressKm >= mode.minProgressKm;

  return {
    ok: reachesTargetArea || makesProgress,
    reason: reachesTargetArea || makesProgress
      ? 'DRIVER_DESTINATION_MATCH'
      : 'DRIVER_DESTINATION_NO_PROGRESS',
    meta: {
      pickupToTargetKm: Number(pickupToTargetKm.toFixed(2)),
      destinationToTargetKm: Number(destinationToTargetKm.toFixed(2)),
      progressKm: Number(progressKm.toFixed(2)),
      minProgressKm: mode.minProgressKm,
      arrivalRadiusKm: mode.arrivalRadiusKm
    }
  };
}

function driverMatchesRidePreferences(driverData = {}, requirements = {}) {
  const leafDelas = driverMatchesLeafDelas(driverData, requirements);
  if (!leafDelas.ok) return leafDelas;

  const destinationMode = driverMatchesDestinationMode(driverData, requirements);
  if (!destinationMode.ok) return destinationMode;

  return {
    ok: true,
    reason: destinationMode.reason === 'DRIVER_DESTINATION_MATCH'
      ? destinationMode.reason
      : leafDelas.reason,
    meta: destinationMode.meta || null
  };
}

module.exports = {
  driverMatchesDestinationMode,
  driverMatchesLeafDelas,
  driverMatchesRidePreferences,
  extractLeafDelasPreference,
  getDriverDestinationMode,
  hasRideDispatchPreferences,
  haversineDistanceKm,
  normalizeCoordinate,
  normalizeGender
};

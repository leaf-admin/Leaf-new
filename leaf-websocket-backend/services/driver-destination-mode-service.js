'use strict';

const DEFAULT_TIME_ZONE = process.env.LEAF_OPERATION_TIME_ZONE || 'America/Sao_Paulo';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'sim'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCoordinate(lat, lng) {
  const parsedLat = Number.parseFloat(lat);
  const parsedLng = Number.parseFloat(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return null;
  return { lat: parsedLat, lng: parsedLng };
}

function dayKey(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch (_error) {
    return date.toISOString().slice(0, 10);
  }
}

function readPolicyFromEnv() {
  return {
    enabled: parseBool(process.env.ENABLE_DRIVER_DESTINATION_MODE, true),
    baseDailyQuota: parsePositiveInt(process.env.DRIVER_DESTINATION_DAILY_BASE_QUOTA, 2),
    maxDailyQuota: parsePositiveInt(process.env.DRIVER_DESTINATION_DAILY_MAX_QUOTA, 4),
    extraEveryCompletedTrips: parsePositiveInt(process.env.DRIVER_DESTINATION_EXTRA_EVERY_TRIPS, 100),
    durationMinutes: parsePositiveInt(process.env.DRIVER_DESTINATION_DURATION_MINUTES, 90),
    minProgressKm: parsePositiveFloat(process.env.DRIVER_DESTINATION_MIN_PROGRESS_KM, 1),
    arrivalRadiusKm: parsePositiveFloat(process.env.DRIVER_DESTINATION_ARRIVAL_RADIUS_KM, 3),
    usageTtlSeconds: parsePositiveInt(process.env.DRIVER_DESTINATION_USAGE_TTL_SECONDS, 3 * 24 * 60 * 60),
    timeZone: process.env.LEAF_OPERATION_TIME_ZONE || DEFAULT_TIME_ZONE
  };
}

function totalTripsFromDriverState(driverState = {}) {
  return Math.max(
    0,
    Number.parseInt(
      driverState.totalTrips ??
        driverState.completedTrips ??
        driverState.ridesCount ??
        driverState.completed_rides ??
        0,
      10
    ) || 0
  );
}

function grantedQuotaForDriver(driverState = {}, policy = readPolicyFromEnv()) {
  const base = Math.max(0, Number.parseInt(policy.baseDailyQuota, 10) || 0);
  const max = Math.max(base, Number.parseInt(policy.maxDailyQuota, 10) || base);
  const every = Math.max(1, Number.parseInt(policy.extraEveryCompletedTrips, 10) || 1);
  const bonus = Math.floor(totalTripsFromDriverState(driverState) / every);
  return Math.min(max, base + bonus);
}

function usageKey(driverId, date = new Date(), policy = readPolicyFromEnv()) {
  return `driver_destination_usage:${driverId}:${dayKey(date, policy.timeZone)}`;
}

function parseDestinationMode(source = {}) {
  const active = parseBool(source.active ?? source.destinationModeActive, false);
  const coordinate = normalizeCoordinate(
    source.lat ?? source.destinationModeLat,
    source.lng ?? source.destinationModeLng
  );

  if (!active || !coordinate) {
    return {
      provided: source.provided === true,
      active: false,
      coordinate: null,
      label: '',
      address: '',
      expiresAt: ''
    };
  }

  return {
    provided: source.provided === true,
    active: true,
    coordinate,
    label: String(source.label || source.destinationName || '').trim(),
    address: String(source.address || source.destinationAddress || '').trim(),
    expiresAt: String(source.expiresAt || source.destinationModeExpiresAt || '').trim()
  };
}

function readExistingMode(driverState = {}, now = new Date()) {
  const coordinate = normalizeCoordinate(
    driverState.destinationModeLat ?? driverState.driverDestinationLat,
    driverState.destinationModeLng ?? driverState.driverDestinationLng
  );
  const active = parseBool(
    driverState.destinationModeActive ?? driverState.driverDestinationModeActive,
    false
  );
  const expiresAt = String(
    driverState.destinationModeExpiresAt || driverState.driverDestinationExpiresAt || ''
  ).trim();
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();

  return {
    active: active && Boolean(coordinate) && !expired,
    coordinate,
    expiresAt,
    expired
  };
}

function sameCoordinate(a, b, precision = 5) {
  if (!a || !b) return false;
  return (
    Number(a.lat).toFixed(precision) === Number(b.lat).toFixed(precision) &&
    Number(a.lng).toFixed(precision) === Number(b.lng).toFixed(precision)
  );
}

function buildInactiveModePatch() {
  return {
    destinationModeActive: 'false',
    driverDestinationModeActive: 'false',
    destinationModeLat: '',
    destinationModeLng: '',
    destinationModeExpiresAt: '',
    destinationModeMinProgressKm: '',
    destinationModeArrivalRadiusKm: '',
    destinationModeLabel: '',
    destinationModeAddress: ''
  };
}

function buildActiveModePatch(mode, policy, now = new Date(), preserveExpiresAt = null) {
  const expiresAt = preserveExpiresAt || new Date(
    now.getTime() + Math.max(1, policy.durationMinutes) * 60 * 1000
  ).toISOString();

  return {
    destinationModeActive: 'true',
    driverDestinationModeActive: 'true',
    destinationModeLat: String(mode.coordinate.lat),
    destinationModeLng: String(mode.coordinate.lng),
    destinationModeExpiresAt: expiresAt,
    destinationModeMinProgressKm: String(policy.minProgressKm),
    destinationModeArrivalRadiusKm: String(policy.arrivalRadiusKm),
    destinationModeLabel: mode.label || '',
    destinationModeAddress: mode.address || ''
  };
}

async function readUsage(redis, driverId, date = new Date(), policy = readPolicyFromEnv()) {
  if (!redis || !driverId) {
    return {
      used: 0,
      key: null,
      day: dayKey(date, policy.timeZone)
    };
  }

  const key = usageKey(driverId, date, policy);
  const usedRaw = await redis.hget(key, 'used').catch(() => null);
  return {
    used: Math.max(0, Number.parseInt(usedRaw || '0', 10) || 0),
    key,
    day: dayKey(date, policy.timeZone)
  };
}

async function consumeUsage(redis, driverId, date, policy) {
  const key = usageKey(driverId, date, policy);
  const used = await redis.hincrby(key, 'used', 1);
  await redis
    .multi()
    .hset(key, {
      day: dayKey(date, policy.timeZone),
      updatedAt: date.toISOString()
    })
    .expire(key, policy.usageTtlSeconds)
    .exec();
  return Math.max(0, Number.parseInt(used, 10) || 0);
}

async function getPolicyForDriver({ redis, driverId, driverState = {}, now = new Date() }) {
  const policy = readPolicyFromEnv();
  const quota = grantedQuotaForDriver(driverState, policy);
  const usage = await readUsage(redis, driverId, now, policy);
  const existing = readExistingMode(driverState, now);

  return {
    enabled: policy.enabled,
    dailyQuota: quota,
    usedToday: usage.used,
    remainingToday: Math.max(0, quota - usage.used),
    day: usage.day,
    durationMinutes: policy.durationMinutes,
    minProgressKm: policy.minProgressKm,
    arrivalRadiusKm: policy.arrivalRadiusKm,
    extraEveryCompletedTrips: policy.extraEveryCompletedTrips,
    maxDailyQuota: policy.maxDailyQuota,
    active: existing.active,
    activeExpiresAt: existing.active ? existing.expiresAt : null
  };
}

async function resolveDestinationModeIntent({
  redis,
  driverId,
  requestedMode = {},
  existingDriverState = {},
  isOnline = true,
  now = new Date()
}) {
  const policy = readPolicyFromEnv();
  const mode = parseDestinationMode(requestedMode);

  if (!isOnline) {
    return {
      allowed: true,
      shouldWrite: true,
      consumed: false,
      patch: buildInactiveModePatch(),
      destinationMode: {
        active: false,
        label: '',
        address: '',
        expiresAt: ''
      },
      policy: await getPolicyForDriver({ redis, driverId, driverState: existingDriverState, now })
    };
  }

  if (!mode.provided) {
    return {
      allowed: true,
      shouldWrite: false,
      consumed: false,
      patch: null,
      policy: await getPolicyForDriver({ redis, driverId, driverState: existingDriverState, now })
    };
  }

  if (!isOnline || !mode.active) {
    return {
      allowed: true,
      shouldWrite: true,
      consumed: false,
      patch: buildInactiveModePatch(),
      destinationMode: {
        active: false,
        label: '',
        address: '',
        expiresAt: ''
      },
      policy: await getPolicyForDriver({ redis, driverId, driverState: existingDriverState, now })
    };
  }

  if (!policy.enabled) {
    return {
      allowed: false,
      code: 'DRIVER_DESTINATION_MODE_DISABLED',
      error: 'Destino de caminho indisponível no momento.'
    };
  }

  const existing = readExistingMode(existingDriverState, now);
  if (existing.active && sameCoordinate(existing.coordinate, mode.coordinate)) {
    const patch = buildActiveModePatch(mode, policy, now, existing.expiresAt);
    return {
      allowed: true,
      shouldWrite: true,
      consumed: false,
      patch,
      destinationMode: {
        active: true,
        label: patch.destinationModeLabel,
        address: patch.destinationModeAddress,
        expiresAt: patch.destinationModeExpiresAt
      },
      policy: await getPolicyForDriver({ redis, driverId, driverState: existingDriverState, now })
    };
  }

  const quota = grantedQuotaForDriver(existingDriverState, policy);
  const usage = await readUsage(redis, driverId, now, policy);
  if (usage.used >= quota) {
    return {
      allowed: false,
      code: 'DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED',
      error: 'Você já usou seus destinos de caminho de hoje.',
      policy: {
        enabled: policy.enabled,
        dailyQuota: quota,
        usedToday: usage.used,
        remainingToday: 0,
        day: usage.day,
        durationMinutes: policy.durationMinutes
      }
    };
  }

  const usedToday = await consumeUsage(redis, driverId, now, policy);
  const patch = buildActiveModePatch(mode, policy, now);
  return {
    allowed: true,
    shouldWrite: true,
    consumed: true,
    patch,
    destinationMode: {
      active: true,
      label: patch.destinationModeLabel,
      address: patch.destinationModeAddress,
      expiresAt: patch.destinationModeExpiresAt
    },
    policy: {
      enabled: policy.enabled,
      dailyQuota: quota,
      usedToday,
      remainingToday: Math.max(0, quota - usedToday),
      day: usage.day,
      durationMinutes: policy.durationMinutes,
      minProgressKm: policy.minProgressKm,
      arrivalRadiusKm: policy.arrivalRadiusKm
    }
  };
}

module.exports = {
  buildActiveModePatch,
  buildInactiveModePatch,
  dayKey,
  getPolicyForDriver,
  grantedQuotaForDriver,
  parseDestinationMode,
  readPolicyFromEnv,
  resolveDestinationModeIntent,
  totalTripsFromDriverState,
  usageKey
};

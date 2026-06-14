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
  const bonusRideWindow = parsePositiveInt(
    process.env.DRIVER_DESTINATION_BONUS_RIDE_WINDOW ||
      process.env.DRIVER_DESTINATION_EXTRA_EVERY_TRIPS,
    5
  );
  return {
    enabled: parseBool(process.env.ENABLE_DRIVER_DESTINATION_MODE, true),
    baseDailyQuota: parsePositiveInt(process.env.DRIVER_DESTINATION_DAILY_BASE_QUOTA, 2),
    maxDailyQuota: parsePositiveInt(process.env.DRIVER_DESTINATION_DAILY_MAX_QUOTA, 12),
    bonusRideWindow,
    extraEveryCompletedTrips: bonusRideWindow,
    durationMinutes: parsePositiveInt(process.env.DRIVER_DESTINATION_DURATION_MINUTES, 90),
    minProgressKm: parsePositiveFloat(process.env.DRIVER_DESTINATION_MIN_PROGRESS_KM, 1),
    arrivalRadiusKm: parsePositiveFloat(process.env.DRIVER_DESTINATION_ARRIVAL_RADIUS_KM, 3),
    usageTtlSeconds: parsePositiveInt(process.env.DRIVER_DESTINATION_USAGE_TTL_SECONDS, 3 * 24 * 60 * 60),
    timeZone: process.env.LEAF_OPERATION_TIME_ZONE || DEFAULT_TIME_ZONE
  };
}

function parseNonNegativeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function dailyTripsFromDriverState(driverState = {}, date = new Date(), policy = readPolicyFromEnv()) {
  const currentDay = dayKey(date, policy.timeZone);
  const destinationModeDay = String(driverState.destinationModeDailyCompletedTripsDay || '').trim();
  if (destinationModeDay && destinationModeDay === currentDay) {
    return parseNonNegativeInt(driverState.destinationModeDailyCompletedTrips, 0);
  }

  return Math.max(
    0,
    parseNonNegativeInt(
      driverState.dailyCompletedTrips ??
        driverState.todayCompletedTrips ??
        driverState.completedToday ??
        driverState.ridesToday ??
        driverState.todayTrips ??
        driverState.driverTripsToday ??
        0,
      0
    )
  );
}

function buildDestinationEntitlement(driverState = {}, usage = {}, policy = readPolicyFromEnv(), now = new Date()) {
  const baseDailyQuota = Math.max(0, parseNonNegativeInt(policy.baseDailyQuota, 0));
  const maxDailyQuota = Math.max(baseDailyQuota, parseNonNegativeInt(policy.maxDailyQuota, baseDailyQuota));
  const bonusRideWindow = Math.max(1, parseNonNegativeInt(policy.bonusRideWindow || policy.extraEveryCompletedTrips, 5));
  const usedToday = Math.max(0, parseNonNegativeInt(usage.used, 0));
  const dailyCompletedTrips = dailyTripsFromDriverState(driverState, now, policy);
  const bonusAnchorTrips = Math.min(
    dailyCompletedTrips,
    Math.max(0, parseNonNegativeInt(usage.bonusAnchorTrips, 0))
  );
  const ridesSinceBonusAnchor = Math.max(0, dailyCompletedTrips - bonusAnchorTrips);
  const bonusReady = ridesSinceBonusAnchor >= bonusRideWindow;
  const baseRemaining = Math.max(0, baseDailyQuota - Math.min(usedToday, baseDailyQuota));
  const bonusRemaining = bonusReady ? 1 : 0;
  const maxRemaining = Math.max(0, maxDailyQuota - usedToday);
  const remainingToday = Math.min(maxRemaining, baseRemaining + bonusRemaining);

  return {
    baseDailyQuota,
    maxDailyQuota,
    bonusRideWindow,
    bonusAnchorTrips,
    bonusReady,
    dailyCompletedTrips,
    dailyQuota: Math.min(maxDailyQuota, baseDailyQuota + (bonusReady ? 1 : 0)),
    usedToday,
    baseRemaining,
    bonusRemaining,
    remainingToday,
    ridesSinceBonusAnchor,
    ridesUntilNextBonus: bonusReady ? 0 : Math.max(0, bonusRideWindow - ridesSinceBonusAnchor)
  };
}

function grantedQuotaForDriver(driverState = {}, policy = readPolicyFromEnv(), usage = {}, now = new Date()) {
  return buildDestinationEntitlement(driverState, usage, policy, now).dailyQuota;
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
  const [usedRaw, bonusAnchorRaw] = await Promise.all([
    redis.hget(key, 'used').catch(() => null),
    redis.hget(key, 'bonusAnchorTrips').catch(() => null)
  ]);
  return {
    used: Math.max(0, Number.parseInt(usedRaw || '0', 10) || 0),
    bonusAnchorTrips: Math.max(0, Number.parseInt(bonusAnchorRaw || '0', 10) || 0),
    key,
    day: dayKey(date, policy.timeZone)
  };
}

async function consumeUsage(redis, driverId, date, policy, { consumeBonus = false, dailyCompletedTrips = 0 } = {}) {
  const key = usageKey(driverId, date, policy);
  const used = await redis.hincrby(key, 'used', 1);
  const payload = {
    day: dayKey(date, policy.timeZone),
    updatedAt: date.toISOString()
  };
  if (consumeBonus) {
    payload.bonusAnchorTrips = String(Math.max(0, parseNonNegativeInt(dailyCompletedTrips, 0)));
    payload.bonusConsumedAt = date.toISOString();
  }
  await redis
    .multi()
    .hset(key, payload)
    .expire(key, policy.usageTtlSeconds)
    .exec();
  return Math.max(0, Number.parseInt(used, 10) || 0);
}

async function recordDriverDestinationDailyRideCompletion({
  redis,
  driverId,
  bookingId,
  now = new Date(),
  policy = readPolicyFromEnv()
}) {
  if (!redis || !driverId || !bookingId) {
    return { recorded: false, reason: 'missing_input' };
  }

  const day = dayKey(now, policy.timeZone);
  const completedSetKey = `driver_destination_completed_rides:${driverId}:${day}`;
  const driverKey = `driver:${driverId}`;
  const added = await redis.sadd(completedSetKey, String(bookingId)).catch(() => 0);
  await redis.expire(completedSetKey, policy.usageTtlSeconds).catch(() => null);

  if (Number(added) !== 1) {
    return { recorded: false, reason: 'already_recorded', day };
  }

  const existingDay = await redis.hget(driverKey, 'destinationModeDailyCompletedTripsDay').catch(() => null);
  if (existingDay && String(existingDay) !== day) {
    await redis
      .multi()
      .hset(driverKey, {
        destinationModeDailyCompletedTripsDay: day,
        destinationModeDailyCompletedTrips: '0'
      })
      .exec()
      .catch(() => null);
  } else if (!existingDay) {
    await redis.hset(driverKey, 'destinationModeDailyCompletedTripsDay', day).catch(() => null);
  }

  const completedToday = await redis.hincrby(driverKey, 'destinationModeDailyCompletedTrips', 1);
  await redis
    .hset(driverKey, {
      destinationModeDailyCompletedTripsDay: day,
      destinationModeDailyCompletedTripsUpdatedAt: now.toISOString()
    })
    .catch(() => null);

  return {
    recorded: true,
    day,
    completedToday: parseNonNegativeInt(completedToday, 0)
  };
}

async function getPolicyForDriver({ redis, driverId, driverState = {}, now = new Date() }) {
  const policy = readPolicyFromEnv();
  const usage = await readUsage(redis, driverId, now, policy);
  const entitlement = buildDestinationEntitlement(driverState, usage, policy, now);
  const existing = readExistingMode(driverState, now);

  return {
    enabled: policy.enabled,
    dailyQuota: entitlement.dailyQuota,
    baseDailyQuota: entitlement.baseDailyQuota,
    usedToday: entitlement.usedToday,
    remainingToday: entitlement.remainingToday,
    day: usage.day,
    durationMinutes: policy.durationMinutes,
    minProgressKm: policy.minProgressKm,
    arrivalRadiusKm: policy.arrivalRadiusKm,
    bonusRideWindow: entitlement.bonusRideWindow,
    extraEveryCompletedTrips: entitlement.bonusRideWindow,
    maxDailyQuota: entitlement.maxDailyQuota,
    maxCarriedBonusTickets: 1,
    dailyCompletedTrips: entitlement.dailyCompletedTrips,
    bonusReady: entitlement.bonusReady,
    ridesUntilNextBonus: entitlement.ridesUntilNextBonus,
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

  const usage = await readUsage(redis, driverId, now, policy);
  const entitlement = buildDestinationEntitlement(existingDriverState, usage, policy, now);
  if (entitlement.remainingToday <= 0) {
    return {
      allowed: false,
      code: 'DRIVER_DESTINATION_DAILY_QUOTA_EXCEEDED',
      error: 'Você já usou seus destinos de caminho de hoje.',
      policy: {
        enabled: policy.enabled,
        dailyQuota: entitlement.dailyQuota,
        baseDailyQuota: entitlement.baseDailyQuota,
        usedToday: entitlement.usedToday,
        remainingToday: 0,
        dailyCompletedTrips: entitlement.dailyCompletedTrips,
        bonusRideWindow: entitlement.bonusRideWindow,
        ridesUntilNextBonus: entitlement.ridesUntilNextBonus,
        bonusReady: entitlement.bonusReady,
        day: usage.day,
        durationMinutes: policy.durationMinutes
      }
    };
  }

  const consumeBonus = entitlement.baseRemaining <= 0;
  const usedToday = await consumeUsage(redis, driverId, now, policy, {
    consumeBonus,
    dailyCompletedTrips: entitlement.dailyCompletedTrips
  });
  const nextUsage = {
    ...usage,
    used: usedToday,
    bonusAnchorTrips: consumeBonus ? entitlement.dailyCompletedTrips : usage.bonusAnchorTrips
  };
  const nextEntitlement = buildDestinationEntitlement(existingDriverState, nextUsage, policy, now);
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
      dailyQuota: nextEntitlement.dailyQuota,
      baseDailyQuota: nextEntitlement.baseDailyQuota,
      usedToday,
      remainingToday: nextEntitlement.remainingToday,
      day: usage.day,
      dailyCompletedTrips: nextEntitlement.dailyCompletedTrips,
      bonusRideWindow: nextEntitlement.bonusRideWindow,
      bonusReady: nextEntitlement.bonusReady,
      ridesUntilNextBonus: nextEntitlement.ridesUntilNextBonus,
      durationMinutes: policy.durationMinutes,
      minProgressKm: policy.minProgressKm,
      arrivalRadiusKm: policy.arrivalRadiusKm
    }
  };
}

module.exports = {
  buildActiveModePatch,
  buildInactiveModePatch,
  buildDestinationEntitlement,
  dailyTripsFromDriverState,
  dayKey,
  getPolicyForDriver,
  grantedQuotaForDriver,
  parseDestinationMode,
  readPolicyFromEnv,
  recordDriverDestinationDailyRideCompletion,
  resolveDestinationModeIntent,
  usageKey
};

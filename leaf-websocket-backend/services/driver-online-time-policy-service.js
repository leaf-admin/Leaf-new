const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_WARNING_HOURS = 10;
const DEFAULT_LIMIT_HOURS = 12;
const DEFAULT_TTL_SECONDS = 3 * 24 * 60 * 60;
const DRIVER_ONLINE_DAILY_LIMIT_MESSAGE = 'Você atingiu o limite de tempo online hoje.';

function readPositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function getPolicy() {
  const warningHours = readPositiveNumber(
    process.env.DRIVER_ONLINE_DAILY_WARNING_HOURS,
    DEFAULT_WARNING_HOURS
  );
  const limitHours = readPositiveNumber(
    process.env.DRIVER_ONLINE_DAILY_LIMIT_HOURS,
    DEFAULT_LIMIT_HOURS
  );
  const timezone = String(
    process.env.DRIVER_ONLINE_DAILY_TIMEZONE || DEFAULT_TIMEZONE
  ).trim() || DEFAULT_TIMEZONE;

  return {
    timezone,
    warningMs: Math.max(1, Math.round(warningHours * 60 * 60 * 1000)),
    limitMs: Math.max(1, Math.round(limitHours * 60 * 60 * 1000)),
    ttlSeconds: Math.max(
      24 * 60 * 60,
      Math.round(readPositiveNumber(
        process.env.DRIVER_ONLINE_DAILY_TTL_SECONDS,
        DEFAULT_TTL_SECONDS
      ))
    )
  };
}

function getOperationalDayKey(nowMs = Date.now(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function keyFor(driverId, dayKey) {
  return `driver_online_daily:${dayKey}:${driverId}`;
}

function parseMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function buildSnapshot(raw = {}, nowMs = Date.now(), policy = getPolicy()) {
  const totalMs = parseMs(raw.totalMs);
  const sessionStartedAtMs = parseMs(raw.sessionStartedAtMs);
  const sessionElapsedMs = sessionStartedAtMs > 0
    ? Math.max(0, nowMs - sessionStartedAtMs)
    : 0;
  const effectiveMs = totalMs + sessionElapsedMs;

  return {
    dayKey: raw.dayKey || getOperationalDayKey(nowMs, policy.timezone),
    timezone: policy.timezone,
    totalMs,
    sessionStartedAtMs: sessionStartedAtMs || null,
    effectiveMs,
    remainingMs: Math.max(0, policy.limitMs - effectiveMs),
    warningMs: policy.warningMs,
    limitMs: policy.limitMs,
    nearLimit: effectiveMs >= policy.warningMs,
    limitReached: effectiveMs >= policy.limitMs
  };
}

async function readDriverOnlineDailySnapshot(redis, driverId, nowMs = Date.now()) {
  const policy = getPolicy();
  const dayKey = getOperationalDayKey(nowMs, policy.timezone);
  const raw = await redis.hgetall(keyFor(driverId, dayKey));
  return buildSnapshot({ ...raw, dayKey }, nowMs, policy);
}

async function resolveDriverOnlineTransition(redis, {
  driverId,
  isOnline,
  nowMs = Date.now(),
  persist = true
}) {
  if (!driverId) {
    throw new Error('driverId ausente para controle diario online');
  }

  const policy = getPolicy();
  const dayKey = getOperationalDayKey(nowMs, policy.timezone);
  const key = keyFor(driverId, dayKey);
  const raw = await redis.hgetall(key);
  const snapshotBefore = buildSnapshot({ ...raw, dayKey }, nowMs, policy);

  if (isOnline && snapshotBefore.limitReached) {
    return {
      allowed: false,
      code: 'DRIVER_ONLINE_DAILY_LIMIT_REACHED',
      message: DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
      snapshot: snapshotBefore
    };
  }

  if (isOnline) {
    const sessionStartedAtMs = snapshotBefore.sessionStartedAtMs || nowMs;
    const snapshot = buildSnapshot({
      dayKey,
      totalMs: snapshotBefore.totalMs,
      sessionStartedAtMs
    }, nowMs, policy);
    if (persist === false) {
      return {
        allowed: true,
        snapshot
      };
    }
    await redis.hset(key, {
      driverId,
      dayKey,
      timezone: policy.timezone,
      totalMs: String(snapshotBefore.totalMs),
      sessionStartedAtMs: String(sessionStartedAtMs),
      sessionStartedAtIso: new Date(sessionStartedAtMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString()
    });
    await redis.expire(key, policy.ttlSeconds);
    return {
      allowed: true,
      snapshot
    };
  }

  await redis.hset(key, {
    driverId,
    dayKey,
    timezone: policy.timezone,
    totalMs: String(snapshotBefore.effectiveMs),
    sessionStartedAtMs: '',
    sessionStartedAtIso: '',
    updatedAt: new Date(nowMs).toISOString()
  });
  await redis.expire(key, policy.ttlSeconds);

  return {
    allowed: true,
    snapshot: buildSnapshot({
      dayKey,
      totalMs: snapshotBefore.effectiveMs,
      sessionStartedAtMs: ''
    }, nowMs, policy)
  };
}

async function closeDriverOnlineSessionAt(redis, {
  driverId,
  closedAtMs = Date.now()
}) {
  if (!driverId) {
    throw new Error('driverId ausente para fechar controle diario online');
  }

  const policy = getPolicy();
  const dayKey = getOperationalDayKey(closedAtMs, policy.timezone);
  const key = keyFor(driverId, dayKey);
  const raw = await redis.hgetall(key);
  const snapshotBefore = buildSnapshot({ ...raw, dayKey }, closedAtMs, policy);

  if (!snapshotBefore.sessionStartedAtMs) {
    return {
      closed: false,
      snapshot: snapshotBefore
    };
  }

  await redis.hset(key, {
    driverId,
    dayKey,
    timezone: policy.timezone,
    totalMs: String(snapshotBefore.effectiveMs),
    sessionStartedAtMs: '',
    sessionStartedAtIso: '',
    updatedAt: new Date(closedAtMs).toISOString(),
    closedAtIso: new Date(closedAtMs).toISOString(),
    closedReason: 'stale_heartbeat'
  });
  await redis.expire(key, policy.ttlSeconds);

  return {
    closed: true,
    snapshot: buildSnapshot({
      dayKey,
      totalMs: snapshotBefore.effectiveMs,
      sessionStartedAtMs: ''
    }, closedAtMs, policy)
  };
}

module.exports = {
  closeDriverOnlineSessionAt,
  DRIVER_ONLINE_DAILY_LIMIT_MESSAGE,
  getDriverOnlineDailyPolicy: getPolicy,
  getOperationalDayKey,
  readDriverOnlineDailySnapshot,
  resolveDriverOnlineTransition
};

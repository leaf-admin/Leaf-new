const alertService = require('./alert-service');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured, logError } = require('../utils/logger');
const { resolveActiveTripForDriver } = require('../utils/active-trip-index');

const REASSIGNMENT_PENDING_KEY = process.env.RIDE_HEALTH_REASSIGNMENT_PENDING_KEY || 'ride_health:reassignment_pending';
const EARLY_ENDED_REVIEW_KEY = process.env.RIDE_HEALTH_EARLY_REVIEW_KEY || 'ride_health:early_ended_review';
const DRIVER_SIGNAL_ACTIVE_KEY = process.env.RIDE_HEALTH_DRIVER_SIGNAL_ACTIVE_KEY || 'ride_health:driver_signal_active';
const DEFAULT_STUCK_THRESHOLD_MS = Number.parseInt(process.env.RIDE_HEALTH_REASSIGNMENT_STUCK_THRESHOLD_MS || '300000', 10);
const DEFAULT_STUCK_CRITICAL_COUNT = Number.parseInt(process.env.RIDE_HEALTH_REASSIGNMENT_STUCK_CRITICAL_COUNT || '3', 10);
const DEFAULT_REVIEW_WARNING_COUNT = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_WARNING_COUNT || '3', 10);
const DEFAULT_REVIEW_CRITICAL_COUNT = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_CRITICAL_COUNT || '6', 10);
const DEFAULT_REVIEW_WINDOW_MS = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_WINDOW_MS || '3600000', 10);
const DEFAULT_DRIVER_SIGNAL_STALE_MS = Number.parseInt(process.env.RIDE_HEALTH_DRIVER_SIGNAL_STALE_MS || '90000', 10);
const DEFAULT_DRIVER_SIGNAL_STALE_CRITICAL_COUNT = Number.parseInt(process.env.RIDE_HEALTH_DRIVER_SIGNAL_STALE_CRITICAL_COUNT || '3', 10);
const DEFAULT_TOP_BOOKINGS_LIMIT = Number.parseInt(process.env.RIDE_HEALTH_TOP_BOOKINGS_LIMIT || '5', 10);
// Corrida em andamento (aceita/chegou/iniciada) sem posição aceita por este tempo vira alerta crítico por corrida.
const DEFAULT_DRIVER_LOCATION_CRITICAL_STALE_MS = Number.parseInt(process.env.RIDE_HEALTH_DRIVER_LOCATION_CRITICAL_STALE_MS || '60000', 10);
// Cooldown por corrida: a mesma corrida não gera o mesmo alerta de novo antes deste intervalo.
const DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS = Number.parseInt(process.env.RIDE_HEALTH_DRIVER_LOCATION_ALERT_COOLDOWN_MS || '600000', 10);
const DEFAULT_DRIVER_LOCATION_ALERT_MAX_PER_CYCLE = Number.parseInt(process.env.RIDE_HEALTH_DRIVER_LOCATION_ALERT_MAX_PER_CYCLE || '20', 10);
const DRIVER_LOCATION_ALERT_COOLDOWN_PREFIX = 'ride_health:driver_location_alert:';
const DRIVER_OFFLINE_ALERT_COOLDOWN_PREFIX = 'ride_health:driver_offline_alert:';
const IN_PROGRESS_RIDE_STATUSES = new Set(['ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'STARTED']);
const localAlertCooldowns = new Map();

const TRACKED_STATES = {
  REASSIGNMENT_PENDING: REASSIGNMENT_PENDING_KEY,
  EARLY_ENDED_REVIEW: EARLY_ENDED_REVIEW_KEY
};

const TRACKED_STATE_VALUES = new Set(Object.keys(TRACKED_STATES));
const DRIVER_SIGNAL_TERMINAL_STATES = new Set([
  'COMPLETE',
  'COMPLETED',
  'CANCELED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
  'NO_DRIVERS_AVAILABLE',
  'NO_DRIVERS_FOUND',
  'EARLY_ENDED_BY_RIDER',
  'INTERRUPTED_OPERATIONAL_ENDED',
  'EARLY_ENDED_REVIEW'
]);

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNowMs(nowIso) {
  return Date.parse(nowIso) || Date.now();
}

function isRedisRideHealthUsable(redis) {
  return Boolean(
    redis
      && typeof redis.pipeline === 'function'
      && typeof redis.zadd === 'function'
      && typeof redis.zrem === 'function'
      && typeof redis.zcard === 'function'
      && typeof redis.zcount === 'function'
      && typeof redis.zrange === 'function'
      && typeof redis.zrangebyscore === 'function'
  );
}

function isRedisRideHealthBackfillUsable(redis) {
  return Boolean(
    isRedisRideHealthUsable(redis)
      && typeof redis.scan === 'function'
      && typeof redis.hgetall === 'function'
      && typeof redis.del === 'function'
  );
}

function isRedisDriverSignalIndexUsable(redis) {
  return Boolean(
    redis
      && typeof redis.zadd === 'function'
      && typeof redis.zrem === 'function'
  );
}

function parseSortedSetRows(rows = []) {
  const parsed = [];
  for (let index = 0; index < rows.length; index += 2) {
    const bookingId = rows[index];
    const scoreMs = toNumber(rows[index + 1], NaN);
    if (!bookingId || !Number.isFinite(scoreMs)) {
      continue;
    }
    parsed.push({ bookingId, scoreMs });
  }
  return parsed;
}

function buildEmptySnapshot(nowIso, options = {}) {
  const stuckThresholdMs = Math.max(60000, toNumber(options.stuckThresholdMs, DEFAULT_STUCK_THRESHOLD_MS));
  const reviewWindowMs = Math.max(60000, toNumber(options.reviewWindowMs, DEFAULT_REVIEW_WINDOW_MS));
  const driverSignalStaleMs = Math.max(30000, toNumber(options.driverSignalStaleMs, DEFAULT_DRIVER_SIGNAL_STALE_MS));

  return {
    timestamp: nowIso,
    reassignmentPending: {
      total: 0,
      stuck: 0,
      oldestAgeMs: 0,
      oldestBookingId: null,
      bookingIds: [],
      stuckThresholdMs
    },
    earlyEndedReview: {
      total: 0,
      recent: 0,
      oldestAgeMs: 0,
      oldestBookingId: null,
      bookingIds: [],
      recentWindowMs: reviewWindowMs
    },
    driverSignal: {
      total: 0,
      stale: 0,
      oldestAgeMs: 0,
      oldestBookingId: null,
      bookingIds: [],
      staleThresholdMs: driverSignalStaleMs
    }
  };
}

function applySnapshotMetrics(snapshot) {
  metrics.setRideHealthStateCount('reassignment_pending', snapshot.reassignmentPending.total);
  metrics.setRideHealthStuckCount('reassignment_pending', snapshot.reassignmentPending.stuck);
  metrics.setRideHealthStateCount('early_ended_review', snapshot.earlyEndedReview.total);
  metrics.setRideHealthRecentCount('early_ended_review', snapshot.earlyEndedReview.recent);
  metrics.setRideHealthStateCount('driver_signal_active', snapshot.driverSignal.total);
  metrics.setRideHealthStuckCount('driver_signal_stale', snapshot.driverSignal.stale);
}

function formatDurationMs(durationMs) {
  const safeDurationMs = Math.max(0, toNumber(durationMs, 0));
  const totalMinutes = Math.round(safeDurationMs / 60000);
  if (totalMinutes < 1) {
    return 'menos de 1 min';
  }
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) {
    return `${hours} h`;
  }
  return `${hours} h ${minutes} min`;
}

function resolveTrackedRideState(bookingHash = {}) {
  const stateCandidates = [
    bookingHash.state,
    bookingHash.status,
    bookingHash.completionType
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);

  return stateCandidates.find((value) => TRACKED_STATE_VALUES.has(value)) || null;
}

function resolveTrackedRideTimestampMs(bookingHash = {}, nowIso = new Date().toISOString()) {
  const candidates = [
    bookingHash.updatedAt,
    bookingHash.completedAt,
    bookingHash.reassignmentRequestedAt,
    bookingHash.endedAt,
    bookingHash.createdAt,
    nowIso
  ];

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return normalizeNowMs(nowIso);
}

async function backfillRideHealthIndex(redis, options = {}) {
  if (!isRedisRideHealthBackfillUsable(redis)) {
    return {
      success: false,
      skipped: true,
      reason: 'redis_unavailable'
    };
  }

  const nowIso = options.nowIso || new Date().toISOString();
  const scanCount = Math.max(50, toNumber(options.scanCount, 250));
  const maxKeys = Math.max(100, toNumber(options.maxKeys, 10000));
  const trackedEntries = {
    REASSIGNMENT_PENDING: [],
    EARLY_ENDED_REVIEW: []
  };

  let cursor = '0';
  let scannedKeys = 0;

  do {
    const response = await redis.scan(cursor, 'MATCH', 'booking:*', 'COUNT', scanCount);
    cursor = Array.isArray(response) ? String(response[0] || '0') : '0';
    const keys = Array.isArray(response?.[1]) ? response[1] : [];

    if (keys.length > 0) {
      const bookingHashes = await Promise.all(
        keys.map((key) => redis.hgetall(key).catch(() => null))
      );

      for (const bookingHash of bookingHashes) {
        scannedKeys += 1;
        if (!bookingHash || Object.keys(bookingHash).length === 0) {
          if (scannedKeys >= maxKeys) break;
          continue;
        }

        const trackedState = resolveTrackedRideState(bookingHash);
        if (!trackedState) {
          if (scannedKeys >= maxKeys) break;
          continue;
        }

        const bookingId = bookingHash.id || bookingHash.bookingId || bookingHash.tripId;
        if (!bookingId) {
          if (scannedKeys >= maxKeys) break;
          continue;
        }

        trackedEntries[trackedState].push({
          bookingId: String(bookingId),
          scoreMs: resolveTrackedRideTimestampMs(bookingHash, nowIso)
        });

        if (scannedKeys >= maxKeys) break;
      }
    }
  } while (cursor !== '0' && scannedKeys < maxKeys);

  const pipeline = redis.pipeline();
  pipeline.del(REASSIGNMENT_PENDING_KEY);
  pipeline.del(EARLY_ENDED_REVIEW_KEY);

  trackedEntries.REASSIGNMENT_PENDING.forEach((entry) => {
    pipeline.zadd(REASSIGNMENT_PENDING_KEY, entry.scoreMs, entry.bookingId);
  });
  trackedEntries.EARLY_ENDED_REVIEW.forEach((entry) => {
    pipeline.zadd(EARLY_ENDED_REVIEW_KEY, entry.scoreMs, entry.bookingId);
  });

  await pipeline.exec();

  return {
    success: true,
    scannedKeys,
    maxKeys,
    reassignmentPending: trackedEntries.REASSIGNMENT_PENDING.length,
    earlyEndedReview: trackedEntries.EARLY_ENDED_REVIEW.length
  };
}

async function syncTrackedRideState(redis, { bookingId, previousState = null, newState = null, updatedAt = null } = {}) {
  if (!isRedisRideHealthUsable(redis) || !bookingId) {
    return false;
  }

  const newStateIsTerminal = DRIVER_SIGNAL_TERMINAL_STATES.has(String(newState || '').trim().toUpperCase());
  if (!TRACKED_STATES[previousState] && !TRACKED_STATES[newState] && !newStateIsTerminal) {
    return false;
  }

  const scoreMs = normalizeNowMs(updatedAt || new Date().toISOString());
  const pipeline = redis.pipeline();

  Object.values(TRACKED_STATES).forEach((key) => {
    pipeline.zrem(key, bookingId);
  });
  if (newStateIsTerminal) {
    pipeline.zrem(DRIVER_SIGNAL_ACTIVE_KEY, bookingId);
  }

  if (TRACKED_STATES[newState]) {
    pipeline.zadd(TRACKED_STATES[newState], scoreMs, bookingId);
  }

  await pipeline.exec();
  return true;
}

async function syncDriverSignalForRide(redis, { bookingId, lastLocationAt = null } = {}) {
  if (!isRedisDriverSignalIndexUsable(redis) || !bookingId) {
    return false;
  }

  const scoreMs = toNumber(lastLocationAt, Date.now());
  if (!Number.isFinite(scoreMs) || scoreMs <= 0) {
    return false;
  }

  await redis.zadd(DRIVER_SIGNAL_ACTIVE_KEY, scoreMs, String(bookingId));
  return true;
}

// A última posição do motorista pode chegar depois do fim da corrida e pôr a
// corrida de volta no índice; quando o hash da corrida expira, ela fica ali
// para sempre e vira alerta falso. Antes de alertar, tira do índice as corridas
// paradas que já terminaram ou não existem mais.
async function pruneFinishedDriverSignalEntries(redis, { nowMs = Date.now(), staleMs = DEFAULT_DRIVER_SIGNAL_STALE_MS, limit = 100 } = {}) {
  if (!isRedisDriverSignalIndexUsable(redis) || typeof redis.hgetall !== 'function' || typeof redis.zrangebyscore !== 'function') {
    return 0;
  }
  const staleIds = await redis.zrangebyscore(DRIVER_SIGNAL_ACTIVE_KEY, 0, nowMs - staleMs, 'LIMIT', 0, limit).catch(() => []);
  let removed = 0;
  for (const bookingId of staleIds) {
    const bookingHash = await redis.hgetall(`booking:${bookingId}`).catch(() => null);
    if (!bookingHash) continue;
    const state = String(bookingHash.state || bookingHash.status || '').trim().toUpperCase();
    if (Object.keys(bookingHash).length === 0 || DRIVER_SIGNAL_TERMINAL_STATES.has(state)) {
      await redis.zrem(DRIVER_SIGNAL_ACTIVE_KEY, bookingId);
      removed += 1;
    }
  }
  if (removed) {
    logStructured('info', 'Corridas encerradas removidas do índice de sinal do motorista', {
      service: 'ride-health-monitor',
      removed
    });
  }
  return removed;
}

async function getRideOperationsSnapshot(redis, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const nowMs = normalizeNowMs(nowIso);
  const stuckThresholdMs = Math.max(60000, toNumber(options.stuckThresholdMs, DEFAULT_STUCK_THRESHOLD_MS));
  const reviewWindowMs = Math.max(60000, toNumber(options.reviewWindowMs, DEFAULT_REVIEW_WINDOW_MS));
  const driverSignalStaleMs = Math.max(30000, toNumber(options.driverSignalStaleMs, DEFAULT_DRIVER_SIGNAL_STALE_MS));
  const topLimit = Math.max(1, toNumber(options.topLimit, DEFAULT_TOP_BOOKINGS_LIMIT));

  if (!isRedisRideHealthUsable(redis)) {
    const emptySnapshot = buildEmptySnapshot(nowIso, { stuckThresholdMs, reviewWindowMs });
    applySnapshotMetrics(emptySnapshot);
    return emptySnapshot;
  }

  const reassignmentMaxScore = nowMs - stuckThresholdMs;
  const reviewMinScore = nowMs - reviewWindowMs;
  const driverSignalStaleMaxScore = nowMs - driverSignalStaleMs;

  const [
    reassignmentTotal,
    reassignmentOldestRows,
    reassignmentStuckCount,
    reassignmentStuckRows,
    reviewTotal,
    reviewOldestRows,
    reviewRecentCount,
    reviewRecentRows,
    driverSignalTotal,
    driverSignalOldestRows,
    driverSignalStaleCount,
    driverSignalStaleRows
  ] = await Promise.all([
    redis.zcard(REASSIGNMENT_PENDING_KEY).catch(() => 0),
    redis.zrange(REASSIGNMENT_PENDING_KEY, 0, 0, 'WITHSCORES').catch(() => []),
    redis.zcount(REASSIGNMENT_PENDING_KEY, 0, reassignmentMaxScore).catch(() => 0),
    redis.zrangebyscore(
      REASSIGNMENT_PENDING_KEY,
      0,
      reassignmentMaxScore,
      'WITHSCORES',
      'LIMIT',
      0,
      topLimit
    ).catch(() => []),
    redis.zcard(EARLY_ENDED_REVIEW_KEY).catch(() => 0),
    redis.zrange(EARLY_ENDED_REVIEW_KEY, 0, 0, 'WITHSCORES').catch(() => []),
    redis.zcount(EARLY_ENDED_REVIEW_KEY, reviewMinScore, '+inf').catch(() => 0),
    redis.zrangebyscore(
      EARLY_ENDED_REVIEW_KEY,
      reviewMinScore,
      '+inf',
      'WITHSCORES',
      'LIMIT',
      0,
      topLimit
    ).catch(() => []),
    redis.zcard(DRIVER_SIGNAL_ACTIVE_KEY).catch(() => 0),
    redis.zrange(DRIVER_SIGNAL_ACTIVE_KEY, 0, 0, 'WITHSCORES').catch(() => []),
    redis.zcount(DRIVER_SIGNAL_ACTIVE_KEY, 0, driverSignalStaleMaxScore).catch(() => 0),
    redis.zrangebyscore(
      DRIVER_SIGNAL_ACTIVE_KEY,
      0,
      driverSignalStaleMaxScore,
      'WITHSCORES',
      'LIMIT',
      0,
      topLimit
    ).catch(() => [])
  ]);

  const reassignmentOldest = parseSortedSetRows(reassignmentOldestRows)[0] || null;
  const reassignmentStuckBookings = parseSortedSetRows(reassignmentStuckRows);
  const reviewOldest = parseSortedSetRows(reviewOldestRows)[0] || null;
  const recentReviewBookings = parseSortedSetRows(reviewRecentRows);
  const driverSignalOldest = parseSortedSetRows(driverSignalOldestRows)[0] || null;
  const staleDriverSignalBookings = parseSortedSetRows(driverSignalStaleRows);

  const snapshot = {
    timestamp: nowIso,
    reassignmentPending: {
      total: toNumber(reassignmentTotal, 0),
      stuck: toNumber(reassignmentStuckCount, 0),
      oldestAgeMs: reassignmentOldest ? Math.max(0, nowMs - reassignmentOldest.scoreMs) : 0,
      oldestBookingId: reassignmentOldest ? reassignmentOldest.bookingId : null,
      bookingIds: reassignmentStuckBookings.map((item) => item.bookingId),
      stuckThresholdMs
    },
    earlyEndedReview: {
      total: toNumber(reviewTotal, 0),
      recent: toNumber(reviewRecentCount, 0),
      oldestAgeMs: reviewOldest ? Math.max(0, nowMs - reviewOldest.scoreMs) : 0,
      oldestBookingId: reviewOldest ? reviewOldest.bookingId : null,
      bookingIds: recentReviewBookings.map((item) => item.bookingId),
      recentWindowMs: reviewWindowMs
    },
    driverSignal: {
      total: toNumber(driverSignalTotal, 0),
      stale: toNumber(driverSignalStaleCount, 0),
      oldestAgeMs: driverSignalOldest ? Math.max(0, nowMs - driverSignalOldest.scoreMs) : 0,
      oldestBookingId: driverSignalOldest ? driverSignalOldest.bookingId : null,
      bookingIds: staleDriverSignalBookings.map((item) => item.bookingId),
      staleThresholdMs: driverSignalStaleMs
    }
  };

  applySnapshotMetrics(snapshot);
  return snapshot;
}

function buildDriverSignalAlert(snapshot, options = {}) {
  const staleCount = snapshot.driverSignal.stale;
  if (!staleCount) {
    return null;
  }

  const criticalThreshold = Math.max(1, toNumber(options.driverSignalCriticalCount, DEFAULT_DRIVER_SIGNAL_STALE_CRITICAL_COUNT));
  const severity = staleCount >= criticalThreshold ? 'critical' : 'warning';
  const oldestDuration = formatDurationMs(snapshot.driverSignal.oldestAgeMs);

  return {
    severity,
    metric: 'driver_signal_stale',
    value: staleCount,
    threshold: severity === 'critical' ? criticalThreshold : 1,
    service: 'ride-health-monitor',
    message: `${staleCount} corrida(s) ativa(s) sem sinal recente do motorista acima de ${formatDurationMs(snapshot.driverSignal.staleThresholdMs)}. Mais antiga: ${oldestDuration}.`,
    details: {
      bookingIds: snapshot.driverSignal.bookingIds,
      oldestBookingId: snapshot.driverSignal.oldestBookingId
    }
  };
}

function buildReassignmentAlert(snapshot, options = {}) {
  const stuckCount = snapshot.reassignmentPending.stuck;
  if (!stuckCount) {
    return null;
  }

  const criticalThreshold = Math.max(1, toNumber(options.stuckCriticalCount, DEFAULT_STUCK_CRITICAL_COUNT));
  const severity = stuckCount >= criticalThreshold ? 'critical' : 'warning';
  const oldestDuration = formatDurationMs(snapshot.reassignmentPending.oldestAgeMs);

  return {
    severity,
    metric: 'reassignment_pending_stuck',
    value: stuckCount,
    threshold: severity === 'critical' ? criticalThreshold : 1,
    service: 'ride-health-monitor',
    message: `${stuckCount} corrida(s) em REASSIGNMENT_PENDING acima de ${formatDurationMs(snapshot.reassignmentPending.stuckThresholdMs)}. Mais antiga: ${oldestDuration}.`,
    details: {
      bookingIds: snapshot.reassignmentPending.bookingIds,
      oldestBookingId: snapshot.reassignmentPending.oldestBookingId
    }
  };
}

function buildReviewAlert(snapshot, options = {}) {
  const recentCount = snapshot.earlyEndedReview.recent;
  const warningThreshold = Math.max(1, toNumber(options.reviewWarningCount, DEFAULT_REVIEW_WARNING_COUNT));
  const criticalThreshold = Math.max(warningThreshold, toNumber(options.reviewCriticalCount, DEFAULT_REVIEW_CRITICAL_COUNT));

  if (recentCount < warningThreshold) {
    return null;
  }

  const severity = recentCount >= criticalThreshold ? 'critical' : 'warning';
  const threshold = severity === 'critical' ? criticalThreshold : warningThreshold;

  return {
    severity,
    metric: 'early_ended_review_volume',
    value: recentCount,
    threshold,
    service: 'ride-health-monitor',
    message: `${recentCount} corrida(s) em EARLY_ENDED_REVIEW na janela de ${formatDurationMs(snapshot.earlyEndedReview.recentWindowMs)}.`,
    details: {
      bookingIds: snapshot.earlyEndedReview.bookingIds,
      oldestBookingId: snapshot.earlyEndedReview.oldestBookingId
    }
  };
}

function normalizeRideStatus(value) {
  return String(value || '').trim().toUpperCase();
}

// Status de corrida em andamento a partir do hash da corrida (state ou status).
function resolveInProgressRideStatus(bookingHash = {}) {
  return [bookingHash.state, bookingHash.status]
    .map(normalizeRideStatus)
    .find((value) => IN_PROGRESS_RIDE_STATUSES.has(value)) || null;
}

// Cooldown compartilhado entre réplicas via SET NX PX. Sem Redis utilizável, usa a memória do processo.
async function claimRideAlertCooldown(redis, key, ttlMs, nowMs = Date.now()) {
  const ttl = Math.max(1000, toNumber(ttlMs, DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS));
  if (redis && typeof redis.set === 'function') {
    try {
      return (await redis.set(key, String(nowMs), 'PX', ttl, 'NX')) === 'OK';
    } catch (error) {
      logStructured('warn', 'Cooldown de alerta de corrida usando memória local', {
        service: 'ride-health-monitor',
        error: error.message
      });
    }
  }
  const until = localAlertCooldowns.get(key);
  if (until && until > nowMs) {
    return false;
  }
  localAlertCooldowns.set(key, nowMs + ttl);
  if (localAlertCooldowns.size > 1000) {
    for (const [storedKey, storedUntil] of localAlertCooldowns) {
      if (storedUntil <= nowMs) localAlertCooldowns.delete(storedKey);
    }
  }
  return true;
}

// Nunca lança: falha no envio ao bot não pode quebrar o monitor nem a desconexão.
async function emitRideBotEvent(type, data, { dedupeKey, severity = 'N2' } = {}) {
  try {
    const botEventService = require('./bot-event-service');
    return await botEventService.emit(type, data, { dedupeKey, severity });
  } catch (error) {
    logStructured('warn', 'Falha ao enviar evento de corrida para os bots', {
      service: 'ride-health-monitor',
      type,
      error: error.message
    });
    return { queued: 0, skipped: 'error' };
  }
}

function buildDriverLocationStaleAlert(rides = [], { thresholdMs = DEFAULT_DRIVER_LOCATION_CRITICAL_STALE_MS } = {}) {
  const oldest = rides.reduce((worst, ride) => (ride.staleSeconds > worst.staleSeconds ? ride : worst), rides[0]);
  return {
    severity: 'critical',
    metric: 'driver_location_stale_active_ride',
    value: rides.length,
    threshold: 1,
    service: 'ride-health-monitor',
    message: `${rides.length} corrida(s) em andamento sem posição do motorista acima de ${formatDurationMs(thresholdMs)}. Mais antiga: ${formatDurationMs(oldest.staleSeconds * 1000)}.`,
    details: {
      bookingIds: rides.map((ride) => ride.bookingId),
      oldestBookingId: oldest.bookingId
    }
  };
}

// Corridas em andamento cuja última posição aceita passou do limiar crítico. Cada corrida
// só entra aqui uma vez por janela de cooldown.
async function evaluateDriverLocationStaleRides(redis, {
  nowMs = Date.now(),
  staleMs = DEFAULT_DRIVER_LOCATION_CRITICAL_STALE_MS,
  cooldownMs = DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS,
  maxPerCycle = DEFAULT_DRIVER_LOCATION_ALERT_MAX_PER_CYCLE
} = {}) {
  if (!isRedisDriverSignalIndexUsable(redis) || typeof redis.hgetall !== 'function') {
    return [];
  }

  const rows = await redis.zrangebyscore(
    DRIVER_SIGNAL_ACTIVE_KEY,
    0,
    nowMs - staleMs,
    'WITHSCORES',
    'LIMIT',
    0,
    Math.max(1, maxPerCycle)
  ).catch(() => []);

  const rides = [];
  for (const { bookingId, scoreMs } of parseSortedSetRows(rows)) {
    try {
      const bookingHash = await redis.hgetall(`booking:${bookingId}`).catch(() => null);
      if (!bookingHash || Object.keys(bookingHash).length === 0) continue;

      const status = resolveInProgressRideStatus(bookingHash);
      if (!status) continue;

      const claimed = await claimRideAlertCooldown(
        redis,
        `${DRIVER_LOCATION_ALERT_COOLDOWN_PREFIX}${bookingId}`,
        cooldownMs,
        nowMs
      );
      if (!claimed) continue;

      rides.push({
        bookingId: String(bookingId),
        driverId: bookingHash.driverId ? String(bookingHash.driverId) : null,
        status,
        staleSeconds: Math.max(0, Math.round((nowMs - scoreMs) / 1000)),
        lastLocationAt: new Date(scoreMs).toISOString(),
        cooldownBucket: Math.floor(nowMs / Math.max(1000, cooldownMs))
      });
    } catch (error) {
      logError(error, 'Falha ao avaliar sinal do motorista de uma corrida', {
        service: 'ride-health-monitor',
        bookingId
      });
    }
  }
  return rides;
}

// Chamado quando a sessão online do motorista é derrubada por falta de heartbeat.
// Só alerta se o motorista tem corrida em andamento; cooldown por corrida.
async function alertDriverOfflineDuringActiveRide(redis, {
  driverId,
  lastSignalAtMs,
  nowMs = Date.now(),
  cooldownMs = DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS
} = {}) {
  try {
    if (!redis || !driverId) return { alerted: false, reason: 'missing_input' };

    const { tripId } = await resolveActiveTripForDriver(redis, driverId);
    if (!tripId) return { alerted: false, reason: 'no_active_ride' };

    const bookingHash = await redis.hgetall(`booking:${tripId}`).catch(() => null);
    const status = bookingHash ? resolveInProgressRideStatus(bookingHash) : null;
    if (!status) return { alerted: false, reason: 'ride_not_in_progress' };

    const claimed = await claimRideAlertCooldown(
      redis,
      `${DRIVER_OFFLINE_ALERT_COOLDOWN_PREFIX}${tripId}`,
      cooldownMs,
      nowMs
    );
    if (!claimed) return { alerted: false, reason: 'cooldown' };

    const lastSignalAtValid = Number.isFinite(lastSignalAtMs) && lastSignalAtMs > 0;
    const result = await emitRideBotEvent('ride.driver_offline_during_active', {
      bookingId: String(tripId),
      driverId: String(driverId),
      status,
      staleSeconds: lastSignalAtValid ? Math.max(0, Math.round((nowMs - lastSignalAtMs) / 1000)) : null,
      lastLocationAt: lastSignalAtValid ? new Date(lastSignalAtMs).toISOString() : null
    }, {
      dedupeKey: `driver_offline_during_active:${tripId}:${Math.floor(nowMs / Math.max(1000, cooldownMs))}`,
      severity: 'N2'
    });
    return { alerted: true, result };
  } catch (error) {
    logStructured('warn', 'Falha ao avaliar motorista offline com corrida ativa', {
      service: 'ride-health-monitor',
      error: error.message
    });
    return { alerted: false, reason: 'error' };
  }
}

async function evaluateRideOperationsAlerts(redis, options = {}) {
  const nowIsoForRun = options.nowIso || new Date().toISOString();
  await pruneFinishedDriverSignalEntries(redis, {
    nowMs: normalizeNowMs(nowIsoForRun),
    staleMs: Math.max(30000, toNumber(options.driverSignalStaleMs, DEFAULT_DRIVER_SIGNAL_STALE_MS))
  });
  const snapshot = await getRideOperationsSnapshot(redis, options);
  const alerts = [];
  const alertClient = options.alertClient || alertService;

  const reassignmentAlert = buildReassignmentAlert(snapshot, options);
  const reviewAlert = buildReviewAlert(snapshot, options);
  const driverSignalAlert = buildDriverSignalAlert(snapshot, options);

  for (const alert of [reassignmentAlert, reviewAlert, driverSignalAlert].filter(Boolean)) {
    try {
      await alertClient.sendAlert(alert);
      metrics.recordRideHealthAlert(alert.metric, alert.severity);
      alerts.push(alert);
    } catch (error) {
      logError(error, 'Falha ao enviar alerta de ride health', {
        service: 'ride-health-monitor',
        metric: alert.metric,
        severity: alert.severity
      });
    }
  }

  // Regra por corrida (limiar crítico, cooldown por corrida): Discord e evento ao bot Operação.
  const driverLocationStaleThresholdMs = Math.max(
    15000,
    toNumber(options.driverLocationCriticalStaleMs, DEFAULT_DRIVER_LOCATION_CRITICAL_STALE_MS)
  );
  const driverLocationCooldownMs = Math.max(
    1000,
    toNumber(options.driverLocationAlertCooldownMs, DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS)
  );
  let driverLocationStaleRides = [];
  try {
    driverLocationStaleRides = await evaluateDriverLocationStaleRides(redis, {
      nowMs: normalizeNowMs(nowIsoForRun),
      staleMs: driverLocationStaleThresholdMs,
      cooldownMs: driverLocationCooldownMs,
      maxPerCycle: toNumber(options.driverLocationAlertMaxPerCycle, DEFAULT_DRIVER_LOCATION_ALERT_MAX_PER_CYCLE)
    });
  } catch (error) {
    logError(error, 'Falha ao avaliar sinal do motorista por corrida', {
      service: 'ride-health-monitor'
    });
  }

  if (driverLocationStaleRides.length) {
    const locationAlert = buildDriverLocationStaleAlert(driverLocationStaleRides, {
      thresholdMs: driverLocationStaleThresholdMs
    });
    try {
      await alertClient.sendAlert(locationAlert);
      metrics.recordRideHealthAlert(locationAlert.metric, locationAlert.severity);
      alerts.push(locationAlert);
    } catch (error) {
      logError(error, 'Falha ao enviar alerta de posição do motorista', {
        service: 'ride-health-monitor',
        metric: locationAlert.metric,
        severity: locationAlert.severity
      });
    }

    for (const ride of driverLocationStaleRides) {
      await emitRideBotEvent('ride.driver_location_stale', {
        bookingId: ride.bookingId,
        driverId: ride.driverId,
        status: ride.status,
        staleSeconds: ride.staleSeconds,
        lastLocationAt: ride.lastLocationAt
      }, {
        dedupeKey: `driver_location_stale:${ride.bookingId}:${ride.cooldownBucket}`,
        severity: 'N2'
      });
    }
  }

  logStructured('info', 'Ciclo de ride health avaliado', {
    service: 'ride-health-monitor',
    reassignmentPending: snapshot.reassignmentPending.total,
    reassignmentPendingStuck: snapshot.reassignmentPending.stuck,
    earlyEndedReviewTotal: snapshot.earlyEndedReview.total,
    earlyEndedReviewRecent: snapshot.earlyEndedReview.recent,
    driverSignalActive: snapshot.driverSignal.total,
    driverSignalStale: snapshot.driverSignal.stale,
    driverLocationStaleRides: driverLocationStaleRides.length,
    alerts: alerts.length
  });

  return {
    snapshot,
    alerts
  };
}

module.exports = {
  DEFAULT_DRIVER_LOCATION_CRITICAL_STALE_MS,
  DEFAULT_DRIVER_LOCATION_ALERT_COOLDOWN_MS,
  DEFAULT_DRIVER_LOCATION_ALERT_MAX_PER_CYCLE,
  alertDriverOfflineDuringActiveRide,
  buildDriverLocationStaleAlert,
  claimRideAlertCooldown,
  evaluateDriverLocationStaleRides,
  DEFAULT_REVIEW_WINDOW_MS,
  DEFAULT_REVIEW_WARNING_COUNT,
  DEFAULT_REVIEW_CRITICAL_COUNT,
  DEFAULT_DRIVER_SIGNAL_STALE_MS,
  DEFAULT_DRIVER_SIGNAL_STALE_CRITICAL_COUNT,
  DEFAULT_STUCK_CRITICAL_COUNT,
  DEFAULT_STUCK_THRESHOLD_MS,
  DRIVER_SIGNAL_ACTIVE_KEY,
  EARLY_ENDED_REVIEW_KEY,
  REASSIGNMENT_PENDING_KEY,
  TRACKED_STATES,
  buildDriverSignalAlert,
  buildReviewAlert,
  buildReassignmentAlert,
  backfillRideHealthIndex,
  evaluateRideOperationsAlerts,
  formatDurationMs,
  getRideOperationsSnapshot,
  isRedisRideHealthBackfillUsable,
  isRedisRideHealthUsable,
  pruneFinishedDriverSignalEntries,
  parseSortedSetRows,
  resolveTrackedRideState,
  resolveTrackedRideTimestampMs,
  syncDriverSignalForRide,
  syncTrackedRideState
};

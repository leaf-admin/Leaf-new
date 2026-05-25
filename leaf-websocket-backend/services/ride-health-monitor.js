const alertService = require('./alert-service');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured, logError } = require('../utils/logger');

const REASSIGNMENT_PENDING_KEY = process.env.RIDE_HEALTH_REASSIGNMENT_PENDING_KEY || 'ride_health:reassignment_pending';
const EARLY_ENDED_REVIEW_KEY = process.env.RIDE_HEALTH_EARLY_REVIEW_KEY || 'ride_health:early_ended_review';
const DEFAULT_STUCK_THRESHOLD_MS = Number.parseInt(process.env.RIDE_HEALTH_REASSIGNMENT_STUCK_THRESHOLD_MS || '300000', 10);
const DEFAULT_STUCK_CRITICAL_COUNT = Number.parseInt(process.env.RIDE_HEALTH_REASSIGNMENT_STUCK_CRITICAL_COUNT || '3', 10);
const DEFAULT_REVIEW_WARNING_COUNT = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_WARNING_COUNT || '3', 10);
const DEFAULT_REVIEW_CRITICAL_COUNT = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_CRITICAL_COUNT || '6', 10);
const DEFAULT_REVIEW_WINDOW_MS = Number.parseInt(process.env.RIDE_HEALTH_EARLY_REVIEW_WINDOW_MS || '3600000', 10);
const DEFAULT_TOP_BOOKINGS_LIMIT = Number.parseInt(process.env.RIDE_HEALTH_TOP_BOOKINGS_LIMIT || '5', 10);

const TRACKED_STATES = {
  REASSIGNMENT_PENDING: REASSIGNMENT_PENDING_KEY,
  EARLY_ENDED_REVIEW: EARLY_ENDED_REVIEW_KEY
};

const TRACKED_STATE_VALUES = new Set(Object.keys(TRACKED_STATES));

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
    }
  };
}

function applySnapshotMetrics(snapshot) {
  metrics.setRideHealthStateCount('reassignment_pending', snapshot.reassignmentPending.total);
  metrics.setRideHealthStuckCount('reassignment_pending', snapshot.reassignmentPending.stuck);
  metrics.setRideHealthStateCount('early_ended_review', snapshot.earlyEndedReview.total);
  metrics.setRideHealthRecentCount('early_ended_review', snapshot.earlyEndedReview.recent);
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

  if (!TRACKED_STATES[previousState] && !TRACKED_STATES[newState]) {
    return false;
  }

  const scoreMs = normalizeNowMs(updatedAt || new Date().toISOString());
  const pipeline = redis.pipeline();

  Object.values(TRACKED_STATES).forEach((key) => {
    pipeline.zrem(key, bookingId);
  });

  if (TRACKED_STATES[newState]) {
    pipeline.zadd(TRACKED_STATES[newState], scoreMs, bookingId);
  }

  await pipeline.exec();
  return true;
}

async function getRideOperationsSnapshot(redis, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const nowMs = normalizeNowMs(nowIso);
  const stuckThresholdMs = Math.max(60000, toNumber(options.stuckThresholdMs, DEFAULT_STUCK_THRESHOLD_MS));
  const reviewWindowMs = Math.max(60000, toNumber(options.reviewWindowMs, DEFAULT_REVIEW_WINDOW_MS));
  const topLimit = Math.max(1, toNumber(options.topLimit, DEFAULT_TOP_BOOKINGS_LIMIT));

  if (!isRedisRideHealthUsable(redis)) {
    const emptySnapshot = buildEmptySnapshot(nowIso, { stuckThresholdMs, reviewWindowMs });
    applySnapshotMetrics(emptySnapshot);
    return emptySnapshot;
  }

  const reassignmentMaxScore = nowMs - stuckThresholdMs;
  const reviewMinScore = nowMs - reviewWindowMs;

  const [
    reassignmentTotal,
    reassignmentOldestRows,
    reassignmentStuckCount,
    reassignmentStuckRows,
    reviewTotal,
    reviewOldestRows,
    reviewRecentCount,
    reviewRecentRows
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
    ).catch(() => [])
  ]);

  const reassignmentOldest = parseSortedSetRows(reassignmentOldestRows)[0] || null;
  const reassignmentStuckBookings = parseSortedSetRows(reassignmentStuckRows);
  const reviewOldest = parseSortedSetRows(reviewOldestRows)[0] || null;
  const recentReviewBookings = parseSortedSetRows(reviewRecentRows);

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
    }
  };

  applySnapshotMetrics(snapshot);
  return snapshot;
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

async function evaluateRideOperationsAlerts(redis, options = {}) {
  const snapshot = await getRideOperationsSnapshot(redis, options);
  const alerts = [];
  const alertClient = options.alertClient || alertService;

  const reassignmentAlert = buildReassignmentAlert(snapshot, options);
  const reviewAlert = buildReviewAlert(snapshot, options);

  for (const alert of [reassignmentAlert, reviewAlert].filter(Boolean)) {
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

  logStructured('info', 'Ciclo de ride health avaliado', {
    service: 'ride-health-monitor',
    reassignmentPending: snapshot.reassignmentPending.total,
    reassignmentPendingStuck: snapshot.reassignmentPending.stuck,
    earlyEndedReviewTotal: snapshot.earlyEndedReview.total,
    earlyEndedReviewRecent: snapshot.earlyEndedReview.recent,
    alerts: alerts.length
  });

  return {
    snapshot,
    alerts
  };
}

module.exports = {
  DEFAULT_REVIEW_WINDOW_MS,
  DEFAULT_REVIEW_WARNING_COUNT,
  DEFAULT_REVIEW_CRITICAL_COUNT,
  DEFAULT_STUCK_CRITICAL_COUNT,
  DEFAULT_STUCK_THRESHOLD_MS,
  EARLY_ENDED_REVIEW_KEY,
  REASSIGNMENT_PENDING_KEY,
  TRACKED_STATES,
  buildReviewAlert,
  buildReassignmentAlert,
  backfillRideHealthIndex,
  evaluateRideOperationsAlerts,
  formatDurationMs,
  getRideOperationsSnapshot,
  isRedisRideHealthBackfillUsable,
  isRedisRideHealthUsable,
  parseSortedSetRows,
  resolveTrackedRideState,
  resolveTrackedRideTimestampMs,
  syncTrackedRideState
};

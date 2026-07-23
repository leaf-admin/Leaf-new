jest.mock('../../../services/alert-service', () => ({
  sendAlert: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    setRideHealthStateCount: jest.fn(),
    setRideHealthStuckCount: jest.fn(),
    setRideHealthRecentCount: jest.fn(),
    recordRideHealthAlert: jest.fn()
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const alertService = require('../../../services/alert-service');
const { metrics } = require('../../../utils/prometheus-metrics');
const {
  backfillRideHealthIndex,
  evaluateRideOperationsAlerts,
  getRideOperationsSnapshot,
  syncDriverSignalForRide,
  syncTrackedRideState
} = require('../../../services/ride-health-monitor');

function createRedisMock() {
  const zsets = new Map();
  const hashes = new Map();

  const ensureKey = (key) => {
    if (!zsets.has(key)) {
      zsets.set(key, []);
    }
    return zsets.get(key);
  };

  const sortKey = (key) => {
    ensureKey(key).sort((left, right) => left.score - right.score || left.member.localeCompare(right.member));
  };

  const normalizeBound = (value, fallback) => {
    if (value === '+inf') return Number.POSITIVE_INFINITY;
    if (value === '-inf') return Number.NEGATIVE_INFINITY;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const redis = {
    seedHash(key, value) {
      hashes.set(key, { ...value });
    },
    pipeline() {
      const operations = [];
      return {
        del(...keys) {
          operations.push(() => redis.del(...keys));
          return this;
        },
        zrem(key, member) {
          operations.push(() => redis.zrem(key, member));
          return this;
        },
        zadd(key, score, member) {
          operations.push(() => redis.zadd(key, score, member));
          return this;
        },
        exec() {
          return Promise.all(operations.map((operation) => operation()));
        }
      };
    },
    async scan(cursor, _matchKeyword, matchPattern, _countKeyword, countValue) {
      const allKeys = [...hashes.keys()].filter((key) => {
        if (matchPattern === 'booking:*') {
          return key.startsWith('booking:');
        }
        return true;
      });
      const offset = Number(cursor) || 0;
      const count = Number(countValue) || allKeys.length;
      const chunk = allKeys.slice(offset, offset + count);
      const nextCursor = offset + count >= allKeys.length ? '0' : String(offset + count);
      return [nextCursor, chunk];
    },
    async hgetall(key) {
      return hashes.get(key) || {};
    },
    async del(...keys) {
      keys.forEach((key) => {
        zsets.delete(key);
      });
      return keys.length;
    },
    async zadd(key, score, member) {
      const list = ensureKey(key).filter((entry) => entry.member !== member);
      list.push({ member, score: Number(score) });
      zsets.set(key, list);
      sortKey(key);
      return 1;
    },
    async zrem(key, member) {
      const list = ensureKey(key).filter((entry) => entry.member !== member);
      zsets.set(key, list);
      return 1;
    },
    async zcard(key) {
      return ensureKey(key).length;
    },
    async zcount(key, min, max) {
      const minValue = normalizeBound(min, Number.NEGATIVE_INFINITY);
      const maxValue = normalizeBound(max, Number.POSITIVE_INFINITY);
      return ensureKey(key).filter((entry) => entry.score >= minValue && entry.score <= maxValue).length;
    },
    async zrange(key, start, stop, withScores) {
      const list = ensureKey(key);
      const end = stop < 0 ? list.length : stop + 1;
      const slice = list.slice(start, end);
      if (withScores === 'WITHSCORES') {
        return slice.flatMap((entry) => [entry.member, String(entry.score)]);
      }
      return slice.map((entry) => entry.member);
    },
    async zrangebyscore(key, min, max, ...args) {
      const minValue = normalizeBound(min, Number.NEGATIVE_INFINITY);
      const maxValue = normalizeBound(max, Number.POSITIVE_INFINITY);
      let limitOffset = 0;
      let limitCount = Number.POSITIVE_INFINITY;
      let withScores = false;

      for (let index = 0; index < args.length; index += 1) {
        if (args[index] === 'WITHSCORES') {
          withScores = true;
        }
        if (args[index] === 'LIMIT') {
          limitOffset = Number(args[index + 1]) || 0;
          limitCount = Number(args[index + 2]) || Number.POSITIVE_INFINITY;
        }
      }

      const filtered = ensureKey(key)
        .filter((entry) => entry.score >= minValue && entry.score <= maxValue)
        .slice(limitOffset, limitOffset + limitCount);

      if (withScores) {
        return filtered.flatMap((entry) => [entry.member, String(entry.score)]);
      }
      return filtered.map((entry) => entry.member);
    }
  };

  return redis;
}

describe('ride-health-monitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sincroniza corridas rastreadas ao entrar e sair de REASSIGNMENT_PENDING', async () => {
    const redis = createRedisMock();

    await syncTrackedRideState(redis, {
      bookingId: 'booking-1',
      previousState: 'INTERRUPTED_OPERATIONAL',
      newState: 'REASSIGNMENT_PENDING',
      updatedAt: '2026-03-30T12:00:00.000Z'
    });

    let snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:04:00.000Z'
    });
    expect(snapshot.reassignmentPending.total).toBe(1);

    await syncTrackedRideState(redis, {
      bookingId: 'booking-1',
      previousState: 'REASSIGNMENT_PENDING',
      newState: 'ACCEPTED',
      updatedAt: '2026-03-30T12:05:00.000Z'
    });

    snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:06:00.000Z'
    });
    expect(snapshot.reassignmentPending.total).toBe(0);
  });

  it('gera snapshot com stuck reassignments e reviews recentes', async () => {
    const redis = createRedisMock();

    await syncTrackedRideState(redis, {
      bookingId: 'booking-stuck',
      previousState: 'INTERRUPTED_OPERATIONAL',
      newState: 'REASSIGNMENT_PENDING',
      updatedAt: '2026-03-30T11:50:00.000Z'
    });
    await syncTrackedRideState(redis, {
      bookingId: 'booking-review',
      previousState: 'IN_PROGRESS',
      newState: 'EARLY_ENDED_REVIEW',
      updatedAt: '2026-03-30T11:58:00.000Z'
    });

    const snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      stuckThresholdMs: 5 * 60 * 1000,
      reviewWindowMs: 15 * 60 * 1000
    });

    expect(snapshot.reassignmentPending.stuck).toBe(1);
    expect(snapshot.reassignmentPending.bookingIds).toEqual(['booking-stuck']);
    expect(snapshot.earlyEndedReview.recent).toBe(1);
    expect(snapshot.earlyEndedReview.bookingIds).toEqual(['booking-review']);
    expect(metrics.setRideHealthStateCount).toHaveBeenCalledWith('reassignment_pending', 1);
    expect(metrics.setRideHealthRecentCount).toHaveBeenCalledWith('early_ended_review', 1);
  });

  it('monitora corridas ativas sem sinal recente do motorista', async () => {
    const redis = createRedisMock();

    await syncDriverSignalForRide(redis, {
      bookingId: 'booking-signal-stale',
      lastLocationAt: Date.parse('2026-03-30T11:57:00.000Z')
    });
    await syncDriverSignalForRide(redis, {
      bookingId: 'booking-signal-fresh',
      lastLocationAt: Date.parse('2026-03-30T11:59:30.000Z')
    });

    const snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      driverSignalStaleMs: 60 * 1000
    });

    expect(snapshot.driverSignal.total).toBe(2);
    expect(snapshot.driverSignal.stale).toBe(1);
    expect(snapshot.driverSignal.bookingIds).toEqual(['booking-signal-stale']);
    expect(metrics.setRideHealthStateCount).toHaveBeenCalledWith('driver_signal_active', 2);
    expect(metrics.setRideHealthStuckCount).toHaveBeenCalledWith('driver_signal_stale', 1);
  });

  it('alerta e limpa o índice de sinal do motorista quando a corrida termina', async () => {
    const redis = createRedisMock();

    await syncDriverSignalForRide(redis, {
      bookingId: 'booking-signal-stale',
      lastLocationAt: Date.parse('2026-03-30T11:57:00.000Z')
    });

    const result = await evaluateRideOperationsAlerts(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      driverSignalStaleMs: 60 * 1000,
      driverSignalCriticalCount: 1
    });

    expect(result.alerts).toEqual([
      expect.objectContaining({
        metric: 'driver_signal_stale',
        severity: 'critical',
        value: 1,
        details: expect.objectContaining({
          bookingIds: ['booking-signal-stale']
        })
      })
    ]);
    expect(metrics.recordRideHealthAlert).toHaveBeenCalledWith('driver_signal_stale', 'critical');

    await syncTrackedRideState(redis, {
      bookingId: 'booking-signal-stale',
      previousState: 'IN_PROGRESS',
      newState: 'COMPLETED',
      updatedAt: '2026-03-30T12:01:00.000Z'
    });

    const snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:02:00.000Z',
      driverSignalStaleMs: 60 * 1000
    });

    expect(snapshot.driverSignal.total).toBe(0);
    expect(snapshot.driverSignal.stale).toBe(0);
  });

  it('envia alertas quando reassignments presos e reviews recentes ultrapassam thresholds', async () => {
    const redis = createRedisMock();

    await syncTrackedRideState(redis, {
      bookingId: 'booking-stuck-a',
      previousState: 'INTERRUPTED_OPERATIONAL',
      newState: 'REASSIGNMENT_PENDING',
      updatedAt: '2026-03-30T11:40:00.000Z'
    });
    await syncTrackedRideState(redis, {
      bookingId: 'booking-stuck-b',
      previousState: 'INTERRUPTED_OPERATIONAL',
      newState: 'REASSIGNMENT_PENDING',
      updatedAt: '2026-03-30T11:42:00.000Z'
    });
    await syncTrackedRideState(redis, {
      bookingId: 'booking-review-a',
      previousState: 'IN_PROGRESS',
      newState: 'EARLY_ENDED_REVIEW',
      updatedAt: '2026-03-30T11:55:00.000Z'
    });
    await syncTrackedRideState(redis, {
      bookingId: 'booking-review-b',
      previousState: 'IN_PROGRESS',
      newState: 'EARLY_ENDED_REVIEW',
      updatedAt: '2026-03-30T11:57:00.000Z'
    });
    await syncTrackedRideState(redis, {
      bookingId: 'booking-review-c',
      previousState: 'IN_PROGRESS',
      newState: 'EARLY_ENDED_REVIEW',
      updatedAt: '2026-03-30T11:59:00.000Z'
    });

    const result = await evaluateRideOperationsAlerts(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      stuckThresholdMs: 5 * 60 * 1000,
      stuckCriticalCount: 2,
      reviewWarningCount: 2,
      reviewCriticalCount: 3,
      reviewWindowMs: 15 * 60 * 1000
    });

    expect(result.alerts).toHaveLength(2);
    expect(alertService.sendAlert).toHaveBeenCalledTimes(2);
    expect(metrics.recordRideHealthAlert).toHaveBeenCalledWith('reassignment_pending_stuck', 'critical');
    expect(metrics.recordRideHealthAlert).toHaveBeenCalledWith('early_ended_review_volume', 'critical');
  });

  it('faz backfill do índice a partir de booking hashes persistidos', async () => {
    const redis = createRedisMock();
    redis.seedHash('booking:reassign-a', {
      id: 'reassign-a',
      state: 'REASSIGNMENT_PENDING',
      updatedAt: '2026-03-30T11:40:00.000Z'
    });
    redis.seedHash('booking:review-a', {
      id: 'review-a',
      status: 'EARLY_ENDED_REVIEW',
      completedAt: '2026-03-30T11:55:00.000Z'
    });
    redis.seedHash('booking:completed-a', {
      id: 'completed-a',
      status: 'COMPLETED',
      updatedAt: '2026-03-30T11:59:00.000Z'
    });

    const backfill = await backfillRideHealthIndex(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      scanCount: 2,
      maxKeys: 10
    });

    expect(backfill.success).toBe(true);
    expect(backfill.reassignmentPending).toBe(1);
    expect(backfill.earlyEndedReview).toBe(1);

    const snapshot = await getRideOperationsSnapshot(redis, {
      nowIso: '2026-03-30T12:00:00.000Z',
      stuckThresholdMs: 5 * 60 * 1000,
      reviewWindowMs: 15 * 60 * 1000
    });

    expect(snapshot.reassignmentPending.total).toBe(1);
    expect(snapshot.earlyEndedReview.total).toBe(1);
    expect(snapshot.earlyEndedReview.bookingIds).toEqual(['review-a']);
  });
});

const {
  beginDispatchWave,
  recordDispatchWave,
  recordDispatchDirectNotification,
  recordDispatchWaveAcceptance
} = require('../../../services/dispatch-wave-trace-service');

function createRedisMock() {
  const hashes = new Map();
  const lists = new Map();
  const expirations = [];

  const ensureHash = (key) => {
    if (!hashes.has(key)) {
      hashes.set(key, new Map());
    }
    return hashes.get(key);
  };

  const ensureList = (key) => {
    if (!lists.has(key)) {
      lists.set(key, []);
    }
    return lists.get(key);
  };

  const redis = {
    async hincrby(key, field, increment) {
      const hash = ensureHash(key);
      const current = Number(hash.get(field) || 0);
      const next = current + Number(increment || 0);
      hash.set(field, String(next));
      return next;
    },
    async hset(key, values) {
      const hash = ensureHash(key);
      Object.entries(values || {}).forEach(([field, value]) => {
        hash.set(field, String(value));
      });
      return 1;
    },
    async hsetnx(key, field, value) {
      const hash = ensureHash(key);
      if (hash.has(field)) return 0;
      hash.set(field, String(value));
      return 1;
    },
    async hmget(key, ...fields) {
      const hash = ensureHash(key);
      return fields.map((field) => (hash.has(field) ? hash.get(field) : null));
    },
    async rpush(key, value) {
      const list = ensureList(key);
      list.push(String(value));
      return list.length;
    },
    async hdel(key, ...fields) {
      const hash = ensureHash(key);
      let removed = 0;
      fields.forEach((field) => {
        if (hash.delete(field)) {
          removed += 1;
        }
      });
      return removed;
    },
    async ltrim(key, start, end) {
      const list = ensureList(key);
      const normalizedStart = start < 0 ? Math.max(list.length + start, 0) : start;
      const normalizedEnd = end < 0 ? list.length + end : end;
      const next = list.slice(normalizedStart, normalizedEnd + 1);
      lists.set(key, next);
      return 'OK';
    },
    async expire(key, ttl) {
      expirations.push({ key, ttl });
      return 1;
    },
    multi() {
      const operations = [];
      const chain = {
        hset: (...args) => {
          operations.push(() => redis.hset(...args));
          return chain;
        },
        hincrby: (...args) => {
          operations.push(() => redis.hincrby(...args));
          return chain;
        },
        hsetnx: (...args) => {
          operations.push(() => redis.hsetnx(...args));
          return chain;
        },
        rpush: (...args) => {
          operations.push(() => redis.rpush(...args));
          return chain;
        },
        ltrim: (...args) => {
          operations.push(() => redis.ltrim(...args));
          return chain;
        },
        expire: (...args) => {
          operations.push(() => redis.expire(...args));
          return chain;
        },
        hdel: (...args) => {
          operations.push(() => redis.hdel(...args));
          return chain;
        },
        exec: async () => {
          for (const operation of operations) {
            await operation();
          }
          return [];
        }
      };
      return chain;
    },
    __readHash(key) {
      return Object.fromEntries(ensureHash(key).entries());
    },
    __readList(key) {
      return ensureList(key);
    },
    __expirations: expirations
  };

  return redis;
}

describe('dispatch-wave-trace-service', () => {
  it('records cumulative wave metrics and first notified wave', async () => {
    const redis = createRedisMock();

    const firstWave = await recordDispatchWave(redis, 'booking_wave_1', {
      radiusKm: 2.5,
      candidateCount: 6,
      notifiedCount: 2,
      failedCount: 1,
      failureReasons: {
        DRIVER_LIVENESS_STALE: 1
      },
      limit: 3,
      bookingState: 'SEARCHING',
      timestampMs: Date.UTC(2026, 3, 8, 12, 0, 0)
    });

    const secondWave = await recordDispatchWave(redis, 'booking_wave_1', {
      radiusKm: 5,
      candidateCount: 4,
      notifiedCount: 0,
      failedCount: 2,
      failureReasons: {
        DRIVER_LOCKED_OTHER_BOOKING: 1,
        DRIVER_SOCKET_OFFLINE: 1
      },
      limit: 3,
      bookingState: 'EXPANDED',
      timestampMs: Date.UTC(2026, 3, 8, 12, 0, 8)
    });

    const hash = redis.__readHash('booking:booking_wave_1');
    const trace = redis.__readList('dispatch_wave_trace:booking_wave_1');

    expect(firstWave).toEqual(
      expect.objectContaining({
        source: 'gradual_expander',
        waveNumber: 1,
        candidateCount: 6,
        notifiedCount: 2,
        failedCount: 1
      })
    );
    expect(secondWave).toEqual(
      expect.objectContaining({
        source: 'gradual_expander',
        waveNumber: 2,
        candidateCount: 4,
        notifiedCount: 0,
        failedCount: 2
      })
    );
    expect(hash).toEqual(
      expect.objectContaining({
        dispatchWaveCount: '2',
        dispatchWaveFirstNotifiedWave: '1',
        dispatchWaveFirstNotifiedSource: 'gradual_expander',
        dispatchWaveLastNotifiedWave: '1',
        dispatchWaveLastNotifiedSource: 'gradual_expander',
        dispatchWaveTotalCandidates: '10',
        dispatchWaveTotalNotified: '2',
        dispatchWaveTotalFailed: '3',
        dispatchWaveLastFailureReasonsJson: JSON.stringify({
          DRIVER_LOCKED_OTHER_BOOKING: 1,
          DRIVER_SOCKET_OFFLINE: 1
        }),
        dispatchWaveLastRadiusKm: '5'
      })
    );
    expect(trace).toHaveLength(2);
    expect(JSON.parse(trace[0])).toEqual(
      expect.objectContaining({
        type: 'wave',
        source: 'gradual_expander',
        waveNumber: 1,
        candidateCount: 6,
        notifiedCount: 2
      })
    );
    expect(JSON.parse(trace[0])).toEqual(
      expect.objectContaining({
        failureReasons: {
          DRIVER_LIVENESS_STALE: 1
        }
      })
    );
    expect(redis.__expirations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'dispatch_wave_trace:booking_wave_1'
        })
      ])
    );
  });

  it('records the acceptance against the last notified wave', async () => {
    const redis = createRedisMock();

    await recordDispatchWave(redis, 'booking_wave_2', {
      radiusKm: 2.5,
      candidateCount: 5,
      notifiedCount: 1,
      failedCount: 0,
      limit: 2,
      bookingState: 'SEARCHING',
      timestampMs: Date.UTC(2026, 3, 8, 12, 5, 0)
    });

    await recordDispatchWave(redis, 'booking_wave_2', {
      radiusKm: 5,
      candidateCount: 4,
      notifiedCount: 2,
      failedCount: 1,
      limit: 2,
      bookingState: 'EXPANDED',
      timestampMs: Date.UTC(2026, 3, 8, 12, 5, 8)
    });

    const acceptance = await recordDispatchWaveAcceptance(redis, 'booking_wave_2', {
      driverId: 'driver_42',
      timestampMs: Date.UTC(2026, 3, 8, 12, 5, 12)
    });

    const hash = redis.__readHash('booking:booking_wave_2');
    const trace = redis.__readList('dispatch_wave_trace:booking_wave_2');
    const acceptedEvent = JSON.parse(trace[trace.length - 1]);

    expect(acceptance).toEqual(
      expect.objectContaining({
        acceptedWave: 2,
        acceptedRadiusKm: 5,
        driverId: 'driver_42',
        acceptedSource: 'gradual_expander',
        acceptedType: 'wave',
        waveCount: 2,
        totalCandidates: 9,
        totalNotified: 3,
        totalFailed: 1
      })
    );
    expect(hash).toEqual(
      expect.objectContaining({
        dispatchWaveAcceptedWave: '2',
        dispatchWaveAcceptedRadiusKm: '5',
        dispatchWaveAcceptedDriverId: 'driver_42',
        dispatchWaveAcceptedSource: 'gradual_expander',
        dispatchWaveAcceptedType: 'wave'
      })
    );
    expect(acceptedEvent).toEqual(
      expect.objectContaining({
        type: 'accepted',
        source: 'gradual_expander',
        dispatchType: 'wave',
        waveNumber: 2,
        radiusKm: 5,
        driverId: 'driver_42',
        totalCandidates: 9,
        totalNotified: 3
      })
    );
  });

  it('records acceptance against a pending wave when the accept arrives before wave finalization', async () => {
    const redis = createRedisMock();

    const pending = await beginDispatchWave(redis, 'booking_wave_pending', {
      radiusKm: 1,
      source: 'gradual_expander',
      timestampMs: Date.UTC(2026, 3, 8, 12, 7, 0)
    });

    const acceptance = await recordDispatchWaveAcceptance(redis, 'booking_wave_pending', {
      driverId: 'driver_fast',
      timestampMs: Date.UTC(2026, 3, 8, 12, 7, 1)
    });

    expect(pending).toEqual(
      expect.objectContaining({
        waveNumber: 1,
        radiusKm: 1,
        source: 'gradual_expander'
      })
    );
    expect(acceptance).toEqual(
      expect.objectContaining({
        acceptedWave: 1,
        acceptedRadiusKm: 1,
        acceptedSource: 'gradual_expander'
      })
    );
    expect(redis.__readList('dispatch_wave_trace:booking_wave_pending')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"type":"accepted"')
      ])
    );
  });

  it('prefers pending candidate counts when acceptance wins the race against wave totals', async () => {
    const redis = createRedisMock();

    await beginDispatchWave(redis, 'booking_wave_pending_counts', {
      radiusKm: 2,
      source: 'gradual_expander',
      candidateCount: 13,
      limit: 20,
      timestampMs: Date.UTC(2026, 3, 8, 12, 8, 0)
    });

    await redis.hset('booking:booking_wave_pending_counts', {
      dispatchWaveCount: '2',
      dispatchWaveTotalCandidates: '0',
      dispatchWaveTotalNotified: '0'
    });

    const acceptance = await recordDispatchWaveAcceptance(redis, 'booking_wave_pending_counts', {
      driverId: 'driver_fast_counts',
      timestampMs: Date.UTC(2026, 3, 8, 12, 8, 1)
    });

    expect(acceptance).toEqual(
      expect.objectContaining({
        acceptedWave: 1,
        totalCandidates: 13,
        totalNotified: 13
      })
    );

    const acceptedEvent = JSON.parse(
      redis.__readList('dispatch_wave_trace:booking_wave_pending_counts').slice(-1)[0]
    );

    expect(acceptedEvent).toEqual(
      expect.objectContaining({
        type: 'accepted',
        totalCandidates: 13,
        totalNotified: 13
      })
    );
  });

  it('marks direct notifications as accepted from the direct path', async () => {
    const redis = createRedisMock();

    const direct = await recordDispatchDirectNotification(redis, 'booking_wave_3', {
      driverId: 'driver_direct_1',
      source: 'response_handler',
      timestampMs: Date.UTC(2026, 3, 8, 12, 10, 0)
    });

    const acceptance = await recordDispatchWaveAcceptance(redis, 'booking_wave_3', {
      driverId: 'driver_direct_1',
      timestampMs: Date.UTC(2026, 3, 8, 12, 10, 2)
    });

    const hash = redis.__readHash('booking:booking_wave_3');

    expect(direct).toEqual(
      expect.objectContaining({
        directCount: 1,
        source: 'response_handler',
        driverId: 'driver_direct_1'
      })
    );
    expect(acceptance).toEqual(
      expect.objectContaining({
        acceptedWave: 0,
        acceptedSource: 'response_handler',
        acceptedType: 'direct',
        directCount: 1
      })
    );
    expect(hash).toEqual(
      expect.objectContaining({
        dispatchDirectCount: '1',
        dispatchWaveAcceptedSource: 'response_handler',
        dispatchWaveAcceptedType: 'direct'
      })
    );
  });
});

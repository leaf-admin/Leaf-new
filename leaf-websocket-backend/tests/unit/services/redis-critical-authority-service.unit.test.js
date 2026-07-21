jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));

const redisPool = require('../../../utils/redis-pool');
const {
  APPROVED_MAXMEMORY_BYTES,
  RedisCriticalAuthorityService,
  RedisCriticalAuthorityNotReadyError
} = require('../../../services/redis-critical-authority-service');

const READY_NOW_MS = Date.parse('2026-07-13T12:00:00.000Z');
const WORKER_HEALTH_KEY = 'leaf:runtime:trip-location-worker:health';

const READY_ENV = Object.freeze({
  REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true',
  REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true',
  REDIS_CRITICAL_DATASET_GENERATION: 'prod-2026-07-13-a',
  REDIS_CRITICAL_DATASET_GENERATION_KEY: 'leaf:runtime:critical-dataset:generation',
  REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '60',
  REDIS_CRITICAL_MEMORY_HIGH_PERCENT: '75',
  REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT: '85',
  REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS: '5000',
  TRIP_LOCATION_CONSUMER_MAX_IDLE_MS: '30000',
  ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER: 'true',
  ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: 'true',
  TRIP_LOCATION_WORKER_HEALTH_KEY: WORKER_HEALTH_KEY,
  TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS: '45000'
});

function buildRedis(overrides = {}) {
  const values = {
    maxmemoryPolicy: 'noeviction',
    appendonly: 'yes',
    appendfsync: 'everysec',
    aofEnabled: 1,
    aofLastWriteStatus: 'ok',
    evictedKeys: 0,
    usedMemory: APPROVED_MAXMEMORY_BYTES * 0.25,
    maxmemory: APPROVED_MAXMEMORY_BYTES,
    generation: READY_ENV.REDIS_CRITICAL_DATASET_GENERATION,
    generationTtl: -1,
    tripLocationStreamLength: 0,
    tripLocationConsumerGroupPresent: true,
    tripLocationConsumers: [{ name: 'trip-location-worker-1', pending: 0, idle: 1000 }],
    tripLocationWorkerHealth: {
      status: 'idle',
      heartbeatAt: String(READY_NOW_MS - 1000),
      processedTrips: '0',
      flushedPoints: '0',
      failures: '0'
    },
    tripLocationWorkerHealthTtl: 89,
    ...overrides
  };

  return {
    config: jest.fn(async (_operation, key) => {
      const configValues = {
        'maxmemory-policy': values.maxmemoryPolicy,
        appendonly: values.appendonly,
        appendfsync: values.appendfsync
      };
      return [key, configValues[key]];
    }),
    info: jest.fn(async (section) => {
      if (section === 'persistence') {
        const aofEnabledLine = values.omitAofEnabled
          ? ''
          : `aof_enabled:${values.aofEnabled}\r\n`;
        return `# Persistence\r\n${aofEnabledLine}aof_last_write_status:${values.aofLastWriteStatus}\r\n`;
      }
      if (section === 'stats') {
        const evictedKeysLine = values.omitEvictedKeys
          ? ''
          : `evicted_keys:${values.evictedKeys}\r\n`;
        return `# Stats\r\n${evictedKeysLine}`;
      }
      if (section === 'memory') {
        const usedMemoryLine = values.omitUsedMemory
          ? ''
          : `used_memory:${values.usedMemory}\r\n`;
        const maxmemoryLine = values.omitMaxmemory
          ? ''
          : `maxmemory:${values.maxmemory}\r\n`;
        return `# Memory\r\n${usedMemoryLine}${maxmemoryLine}`;
      }
      return '';
    }),
    get: jest.fn(async () => values.generation),
    ttl: jest.fn(async (key) => (
      key === WORKER_HEALTH_KEY
        ? values.tripLocationWorkerHealthTtl
        : values.generationTtl
    )),
    hgetall: jest.fn(async (key) => (
      key === WORKER_HEALTH_KEY
        ? values.tripLocationWorkerHealth
        : {}
    )),
    xlen: jest.fn(async () => values.tripLocationStreamLength),
    xinfo: jest.fn(async (operation) => {
      if (operation === 'GROUPS') {
        return values.tripLocationConsumerGroupPresent
          ? [[
            'name',
            'trip-location-workers',
            'pending',
            0,
            'last-delivered-id',
            '1-0',
            'lag',
            0
          ]]
          : [];
      }
      if (operation === 'CONSUMERS') {
        return values.tripLocationConsumers.map((consumer) => [
          'name', consumer.name,
          'pending', consumer.pending,
          'idle', consumer.idle
        ]);
      }
      throw new Error(`Unexpected XINFO operation: ${operation}`);
    }),
    set: jest.fn()
  };
}

describe('redis-critical-authority-service', () => {
  let nowMs;
  let redis;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    nowMs = READY_NOW_MS;
    redis = buildRedis();
    redisPool.ensureConnection.mockResolvedValue(true);
    redisPool.getConnection.mockReturnValue(redis);
    service = new RedisCriticalAuthorityService({
      redisPool,
      now: () => nowMs
    });
  });

  test('attests the approved live Redis contract without initializing the generation marker', async () => {
    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result).toMatchObject({
      ready: true,
      status: 'healthy',
      quarantined: false,
      blockers: [],
      dataset: {
        markerPresent: true,
        generationMatches: true,
        markerPersistent: true
      },
      redis: {
        maxmemoryPolicy: 'noeviction',
        appendonly: 'yes',
        appendfsync: 'everysec',
        aofEnabled: 1,
        aofLastWriteStatus: 'ok',
        evictedKeys: 0
      },
      memory: {
        level: 'normal',
        usagePercent: 25,
        approvedMaxmemoryBytes: APPROVED_MAXMEMORY_BYTES,
        maxmemoryMatchesApproved: true
      },
      streams: {
        tripLocation: {
          enabled: true,
          consumerGroupPresent: true,
          consumerActive: true,
          consumerStateValid: true,
          consumerCount: 1,
          activeConsumerCount: 1,
          minConsumerIdleMs: 1000,
          maxConsumerIdleMs: 30000,
          length: 0,
          trimThreshold: 500000,
          persistence: expect.objectContaining({
            required: true,
            present: true,
            status: 'idle',
            heartbeatAgeMs: 1000,
            heartbeatFresh: true,
            ttlSeconds: 89,
            counters: {
              processedTrips: 0,
              flushedPoints: 0,
              failures: 0
            }
          })
        }
      }
    });
    expect(redis.get).toHaveBeenCalledWith(READY_ENV.REDIS_CRITICAL_DATASET_GENERATION_KEY);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('quarantines a missing generation marker and assertReady fails closed', async () => {
    redis = buildRedis({ generation: null, generationTtl: -2 });
    redisPool.getConnection.mockReturnValue(redis);

    await expect(service.assertReady({ env: READY_ENV, forceRefresh: true }))
      .rejects.toMatchObject({
        name: 'RedisCriticalAuthorityNotReadyError',
        code: 'REDIS_CRITICAL_AUTHORITY_NOT_READY',
        statusCode: 503,
        retryable: true,
        attestation: expect.objectContaining({
          ready: false,
          quarantined: true,
          blockers: expect.arrayContaining(['dataset_generation_marker_missing'])
        })
      });
    expect(RedisCriticalAuthorityNotReadyError.prototype).toBeInstanceOf(Error);
    expect(redis.set).not.toHaveBeenCalled();
  });

  test('quarantines mismatched or expiring generation markers', async () => {
    redis = buildRedis({ generation: 'old-generation', generationTtl: 3600 });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.quarantined).toBe(true);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'dataset_generation_mismatch',
      'dataset_generation_marker_not_persistent'
    ]));
  });

  test('rejects eviction and persistence drift even when Redis answers', async () => {
    redis = buildRedis({
      maxmemoryPolicy: 'allkeys-lru',
      appendonly: 'no',
      appendfsync: 'always',
      aofEnabled: 0,
      aofLastWriteStatus: 'err',
      evictedKeys: 4
    });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'maxmemory_policy_not_noeviction',
      'appendonly_not_enabled',
      'appendfsync_not_everysec',
      'aof_enabled_not_one',
      'aof_last_write_status_not_ok',
      'evicted_keys_nonzero'
    ]));
  });

  test.each([
    ['missing evicted_keys', { omitEvictedKeys: true }, 'evicted_keys_invalid'],
    ['malformed evicted_keys', { evictedKeys: 'not-a-number' }, 'evicted_keys_invalid'],
    ['missing used_memory', { omitUsedMemory: true }, 'used_memory_invalid'],
    ['malformed used_memory', { usedMemory: 'not-a-number' }, 'used_memory_invalid'],
    ['missing maxmemory', { omitMaxmemory: true }, 'maxmemory_invalid'],
    ['malformed maxmemory', { maxmemory: 'not-a-number' }, 'maxmemory_invalid']
  ])('quarantines %s instead of accepting a numeric fallback', async (_label, overrides, blocker) => {
    redis = buildRedis(overrides);
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.quarantined).toBe(true);
    expect(result.blockers).toContain(blocker);
  });

  test('requires INFO persistence to report aof_enabled=1', async () => {
    redis = buildRedis({ omitAofEnabled: true });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('aof_enabled_not_one');
    expect(result.redis.aofEnabled).toBeNull();
  });

  test('quarantines new critical claims when the trip-location consumer group is absent', async () => {
    redis = buildRedis({ tripLocationConsumerGroupPresent: false });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('trip_location_stream_consumer_missing');
    expect(result.streams.tripLocation).toEqual(expect.objectContaining({
      enabled: true,
      consumerGroupPresent: false
    }));
  });

  test.each([
    ['has no registered consumer', []],
    ['has only consumers beyond the configured idle limit', [
      { name: 'trip-location-worker-stale', pending: 0, idle: 30001 }
    ]]
  ])('quarantines new critical claims when the trip-location group %s', async (_label, consumers) => {
    redis = buildRedis({ tripLocationConsumers: consumers });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('trip_location_stream_consumer_inactive');
    expect(result.streams.tripLocation).toEqual(expect.objectContaining({
      consumerGroupPresent: true,
      consumerActive: false,
      activeConsumerCount: 0,
      maxConsumerIdleMs: 30000
    }));
  });

  test('accepts the group when at least one consumer is within the configured idle limit', async () => {
    redis = buildRedis({
      tripLocationConsumers: [
        { name: 'trip-location-worker-stale', pending: 0, idle: 45000 },
        { name: 'trip-location-worker-live', pending: 0, idle: 29999 }
      ]
    });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(true);
    expect(result.streams.tripLocation).toEqual(expect.objectContaining({
      consumerActive: true,
      consumerCount: 2,
      activeConsumerCount: 1,
      minConsumerIdleMs: 29999
    }));
    expect(redis.xinfo).toHaveBeenCalledWith(
      'CONSUMERS',
      'trip_location_events',
      'trip-location-workers'
    );
  });

  test('does not require a group or live consumer when the trip-location stream is disabled', async () => {
    const result = await service.attest({
      env: {
        ...READY_ENV,
        ENABLE_TRIP_LOCATION_STREAM: 'false',
        TRIP_LOCATION_CONSUMER_MAX_IDLE_MS: 'invalid-while-disabled'
      },
      forceRefresh: true
    });

    expect(result.ready).toBe(true);
    expect(result.streams.tripLocation).toEqual(expect.objectContaining({
      enabled: false,
      consumerActive: false,
      persistence: expect.objectContaining({
        required: false,
        heartbeatFresh: true
      })
    }));
    expect(redis.xinfo).not.toHaveBeenCalled();
    expect(redis.hgetall).not.toHaveBeenCalled();
  });

  test.each([
    [
      'missing',
      { tripLocationWorkerHealth: {}, tripLocationWorkerHealthTtl: -2 },
      'trip_location_worker_health_missing'
    ],
    [
      'stale',
      {
        tripLocationWorkerHealth: {
          status: 'healthy',
          heartbeatAt: String(READY_NOW_MS - 45001),
          processedTrips: '1',
          flushedPoints: '10',
          failures: '0'
        }
      },
      'trip_location_worker_health_stale'
    ],
    [
      'degraded',
      {
        tripLocationWorkerHealth: {
          status: 'degraded',
          heartbeatAt: String(READY_NOW_MS - 1000),
          processedTrips: '2',
          flushedPoints: '3',
          failures: '1'
        }
      },
      'trip_location_worker_health_degraded'
    ],
    [
      'invalid',
      {
        tripLocationWorkerHealth: {
          status: 'healthy',
          heartbeatAt: String(READY_NOW_MS - 1000),
          processedTrips: 'not-an-integer',
          flushedPoints: '3',
          failures: '0'
        }
      },
      'trip_location_worker_health_invalid'
    ]
  ])('quarantines a %s trip-location persistence heartbeat', async (_label, overrides, blocker) => {
    redis = buildRedis(overrides);
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.quarantined).toBe(true);
    expect(result.blockers).toContain(blocker);
    expect(result.streams.tripLocation.persistence).toEqual(expect.objectContaining({
      required: true
    }));
    expect(JSON.stringify(result)).not.toContain(WORKER_HEALTH_KEY);
  });

  test('rejects disabled persistence controls before probing Redis', async () => {
    const result = await service.attest({
      env: {
        ...READY_ENV,
        ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER: 'false',
        ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: 'false'
      }
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'trip_location_persistence_worker_disabled',
      'trip_location_firestore_persistence_disabled'
    ]));
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
  });

  test('fails closed before probing Redis when the enabled stream idle limit is invalid', async () => {
    const result = await service.attest({
      env: {
        ...READY_ENV,
        ENABLE_TRIP_LOCATION_STREAM: 'true',
        TRIP_LOCATION_CONSUMER_MAX_IDLE_MS: 'invalid'
      }
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('trip_location_consumer_max_idle_invalid');
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
  });

  test('quarantines new critical claims before trip-location backlog exceeds safe retention', async () => {
    redis = buildRedis({ tripLocationStreamLength: 500001 });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('trip_location_stream_backlog_critical');
  });

  test.each([
    [59, 'normal', true],
    [60, 'warning', true],
    [75, 'high', true],
    [85, 'critical', false]
  ])('classifies memory usage %s%% as %s', async (usagePercent, level, ready) => {
    redis = buildRedis({
      usedMemory: Math.round(APPROVED_MAXMEMORY_BYTES * (usagePercent / 100))
    });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.memory).toMatchObject({ level, usagePercent });
    expect(result.ready).toBe(ready);
    if (!ready) expect(result.blockers).toContain('memory_usage_critical');
  });

  test('quarantines maxmemory drift even when current usage is low', async () => {
    redis = buildRedis({
      usedMemory: 64 * 1024 * 1024,
      maxmemory: 512 * 1024 * 1024
    });
    redisPool.getConnection.mockReturnValue(redis);

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result.ready).toBe(false);
    expect(result.blockers).toContain('maxmemory_not_approved');
    expect(result.memory).toEqual(expect.objectContaining({
      approvedMaxmemoryBytes: APPROVED_MAXMEMORY_BYTES,
      maxmemoryMatchesApproved: false
    }));
  });

  test('rejects static attestation drift before touching Redis', async () => {
    const result = await service.attest({
      env: {
        ...READY_ENV,
        REDIS_CRITICAL_MEMORY_WARNING_PERCENT: '50'
      }
    });

    expect(result).toMatchObject({
      ready: false,
      status: 'quarantined',
      quarantined: true,
      blockers: ['memory_threshold_policy_mismatch']
    });
    expect(redisPool.ensureConnection).not.toHaveBeenCalled();
  });

  test('uses a short cache for health but forceRefresh always performs a live probe', async () => {
    await service.attest({ env: READY_ENV });
    const cached = await service.attest({ env: READY_ENV });

    expect(cached.cache).toMatchObject({ hit: true, ageMs: 0, ttlMs: 5000 });
    expect(redis.config).toHaveBeenCalledTimes(3);

    await service.assertReady({ env: READY_ENV, forceRefresh: true });
    expect(redis.config).toHaveBeenCalledTimes(6);
  });

  test('quarantines connection and command failures without leaking credentials', async () => {
    redisPool.ensureConnection.mockRejectedValue(
      Object.assign(
        new Error('connection refused redis://:super-secret@redis:6379 auth=super-secret'),
        { code: 'ECONNREFUSED' }
      )
    );

    const result = await service.attest({ env: READY_ENV, forceRefresh: true });

    expect(result).toMatchObject({
      ready: false,
      status: 'quarantined',
      quarantined: true,
      blockers: ['redis_attestation_probe_failed'],
      error: {
        code: 'ECONNREFUSED',
        message: 'Redis attestation probe failed'
      }
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('redis://');
  });
});

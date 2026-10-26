jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'SERVER_TS')
    }
  }
}));

describe('trip-location-persistence-service', () => {
  let service;
  let redisPool;
  let firebaseConfig;
  let redisMock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.TRIP_LOCATION_CHUNK_RETENTION_DAYS = '7';
    process.env.ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE = 'true';
    process.env.TRIP_LOCATION_WORKER_HEALTH_KEY = 'leaf:test:trip-location-worker:health';
    process.env.TRIP_LOCATION_WORKER_HEALTH_TTL_SECONDS = '90';

    redisPool = require('../../../utils/redis-pool');
    firebaseConfig = require('../../../firebase-config');

    redisMock = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      rpush: jest.fn(),
      expire: jest.fn(),
      hset: jest.fn(),
      hgetall: jest.fn(),
      hincrby: jest.fn(),
      llen: jest.fn(),
      lrange: jest.fn(),
      ltrim: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn().mockResolvedValue([]),
      scan: jest.fn().mockResolvedValue(['0', []]),
      sscan: jest.fn().mockResolvedValue(['0', []]),
      zadd: jest.fn(), zrem: jest.fn(), hdel: jest.fn(),
      eval: jest.fn(), queueIds: []
    };

    const { APPEND_BUFFER, CLAIM_TRIPS, CLAIM_CHUNK, ACK_CHUNK } = require('../../../utils/trip-location-buffer-ops');
    redisMock.zadd.mockImplementation(async (_key, ...args) => {
      const id = args[args.length - 1];
      if (!redisMock.queueIds.includes(id)) redisMock.queueIds.push(id);
    });
    // Adapter for JS calculations/health contracts only. Real Lua, CAS and ACK
    // failure behavior are tested separately against private Redis.
    redisMock.eval.mockImplementation(async (...args) => {
      if (args[0] === APPEND_BUFFER) {
        const count = await redisMock.rpush(args[2], args[8]) || 1;
        await redisMock.hset(args[3], { ...JSON.parse(args[9]), bufferVersion: String(Number(args[7]) + 1) });
        await redisMock.sadd(args[5], args[10]);
        return [1, count];
      }
      if (args[0] === CLAIM_TRIPS) return redisMock.queueIds;
      if (args[0] === CLAIM_CHUNK) return args[5];
      if (args[0] === ACK_CHUNK) return JSON.parse(args[10]).length;
      return 0;
    });

    redisPool.ensureConnection.mockResolvedValue(true);
    redisPool.getConnection.mockReturnValue(redisMock);
    firebaseConfig.getFirestore.mockReturnValue({});

    service = require('../../../services/trip-location-persistence-service');
  });

  function buildSandboxEnvelope() {
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      paymentProfileSource: 'unit-test',
      testUserSandbox: true
    });
    return {
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId,
      providerEnvironment: financialContext.providerEnvironment,
      paymentProfileId: financialContext.paymentProfileId,
      testUserSandbox: financialContext.testUserSandbox
    };
  }

  function buildRedisEnvelope(envelope) {
    return {
      ...envelope,
      financialContext: JSON.stringify(envelope.financialContext),
      testUserSandbox: String(envelope.testUserSandbox)
    };
  }

  test.each(['0', '-1', '1000000', 'invalid'])('bounds chunk size for configuration %s', value => {
    const previous = process.env.TRIP_LOCATION_CHUNK_SIZE;
    try {
      process.env.TRIP_LOCATION_CHUNK_SIZE = value;
      jest.resetModules();
      const configured = require('../../../services/trip-location-persistence-service');
      expect(configured.chunkSize).toBeGreaterThanOrEqual(1);
      expect(configured.chunkSize).toBeLessThanOrEqual(100);
    } finally {
      if (previous === undefined) delete process.env.TRIP_LOCATION_CHUNK_SIZE;
      else process.env.TRIP_LOCATION_CHUNK_SIZE = previous;
    }
  });

  test('normalization is idempotent across CAS and stream retries with nullable fields', () => {
    const normalized = service.normalizeLocationEvent({ tripId: 'retry', driverId: 'driver',
      lat: -23, lng: -46, seq: null, capturedAt: 1710000000000, receivedAt: 1710000000100 });
    expect(service.normalizeLocationEvent(normalized)).toEqual(normalized);
    for (const field of ['seq', 'accuracy', 'heading', 'speed', 'outOfOrderWindow', 'lastAcceptedSeq']) {
      expect(normalized[field]).toBeNull();
    }
  });

  test('normalizeLocationEvent should include ordering metadata', () => {
    const normalized = service.normalizeLocationEvent({
      tripId: 'trip-1',
      driverId: 'driver-1',
      lat: -23.5,
      lng: -46.6,
      seq: 10,
      capturedAt: 1000,
      orderStatus: 'in_order',
      outOfOrderWindow: 15,
      lastAcceptedSeq: 10
    });

    expect(normalized.tripId).toBe('trip-1');
    expect(normalized.orderStatus).toBe('in_order');
    expect(normalized.outOfOrderWindow).toBe(15);
    expect(normalized.lastAcceptedSeq).toBe(10);
  });

  test('bufferLocationEvent should short-circuit on duplicate worker dedupe key', async () => {
    redisMock.eval.mockResolvedValueOnce([0, 0]);

    const result = await service.bufferLocationEvent({
      tripId: 'trip-1',
      driverId: 'driver-1',
      seq: 5,
      capturedAt: 123,
      lat: -23.5,
      lng: -46.6
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      duplicate: true,
      tripId: 'trip-1'
    }));
    expect(redisMock.rpush).not.toHaveBeenCalled();
  });

  test('bufferLocationEvent accumulates canonical distance in Redis metadata', async () => {
    let metadata = {};
    redisMock.rpush.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    redisMock.hgetall.mockImplementation(async () => metadata);
    redisMock.hset.mockImplementation(async (_key, patch) => {
      metadata = { ...metadata, ...patch };
      return 'OK';
    });

    await service.bufferLocationEvent({
      tripId: 'trip-1',
      driverId: 'driver-1',
      lat: -22.9,
      lng: -43.2,
      receivedAt: 1_000_100
    });
    await service.bufferLocationEvent({
      tripId: 'trip-1',
      driverId: 'driver-1',
      lat: -22.901,
      lng: -43.201,
      receivedAt: 1_000_200
    });
    const distanceBeforeStalePoint = metadata.canonicalDistanceKm;
    await service.bufferLocationEvent({
      tripId: 'trip-1',
      driverId: 'driver-1',
      lat: 0,
      lng: 0,
      receivedAt: 1_000_150
    });

    expect(metadata).toEqual(expect.objectContaining({
      canonicalDriverId: 'driver-1',
      canonicalPointsCount: '2',
      canonicalFirstLat: '-22.9',
      canonicalFirstLng: '-43.2',
      canonicalLastLat: '-22.901',
      canonicalLastLng: '-43.201'
    }));
    expect(Number(metadata.canonicalDistanceKm)).toBeGreaterThan(0);
    expect(metadata.canonicalDistanceKm).toBe(distanceBeforeStalePoint);
  });

  test('preserves the sealed sandbox envelope in the location point and Redis metadata', async () => {
    const sandboxEnvelope = buildSandboxEnvelope();
    redisMock.hgetall.mockResolvedValue({});
    redisMock.rpush.mockResolvedValue(1);
    redisMock.hset.mockResolvedValue('OK');

    await service.bufferLocationEvent({
      tripId: 'sandbox-trip-1',
      driverId: 'sandbox-driver-1',
      customerId: 'sandbox-customer-1',
      lat: -22.9,
      lng: -43.2,
      ...sandboxEnvelope
    });

    const bufferedPoint = JSON.parse(redisMock.rpush.mock.calls[0][1]);
    expect(bufferedPoint).toEqual(expect.objectContaining({
      financialNamespace: 'sandbox',
      financialContextId: sandboxEnvelope.financialContextId,
      financialContext: sandboxEnvelope.financialContext
    }));
    expect(redisMock.hset).toHaveBeenCalledWith(
      'trip_loc_meta:sandbox-trip-1',
      expect.objectContaining({
        financialNamespace: 'sandbox',
        financialContextId: sandboxEnvelope.financialContextId,
        financialContext: JSON.stringify(sandboxEnvelope.financialContext),
        testUserSandbox: 'true'
      })
    );
  });

  test('fails closed before Redis and Firestore when a sandbox signal loses its sealed context', async () => {
    await expect(service.bufferLocationEvent({
      tripId: 'sandbox-trip-lost-context',
      driverId: 'sandbox-driver-1',
      lat: -22.9,
      lng: -43.2,
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox'
    })).rejects.toMatchObject({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });

    expect(redisPool.getConnection).not.toHaveBeenCalled();
    expect(firebaseConfig.getFirestore).not.toHaveBeenCalled();
  });

  test('flushTripChunks should persist chunk with retention timestamp', async () => {
    const addMock = jest.fn().mockResolvedValue({ id: 'chunk-1' });
    const collectionMock = jest.fn(() => ({ doc: jest.fn(() => ({ create: addMock })) }));
    firebaseConfig.getFirestore.mockReturnValue({
      collection: collectionMock
    });

    redisMock.set.mockResolvedValue('OK');
    redisMock.llen.mockResolvedValue(2);
    redisMock.lrange.mockResolvedValue([
      JSON.stringify({ tripId: 'trip-1', driverId: 'driver-1', seq: 1, lat: -23.5, lng: -46.6, capturedAt: 1000 }),
      JSON.stringify({ tripId: 'trip-1', driverId: 'driver-1', seq: 2, lat: -23.51, lng: -46.61, capturedAt: 2000 })
    ]);
    redisMock.ltrim.mockResolvedValue('OK');
    redisMock.hincrby.mockResolvedValue(2);
    redisMock.hset.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);

    const result = await service.flushTripChunks('trip-1', {
      force: false,
      maxChunks: 1,
      reason: 'test'
    });

    expect(result.success).toBe(true);
    expect(collectionMock).toHaveBeenCalledWith('trip_location_chunks');
    expect(addMock).toHaveBeenCalledTimes(1);
    const persistedDoc = addMock.mock.calls[0][0];
    expect(persistedDoc).toEqual(expect.objectContaining({
      tripId: 'trip-1',
      pointsCount: 2,
      reason: 'test'
    }));
    expect(persistedDoc.expiresAt).toBeInstanceOf(Date);
  });

  test('flushPendingTrips publishes idle heartbeat when the Firestore client is available', async () => {
    redisMock.scan.mockResolvedValue(['0', []]);

    const result = await service.flushPendingTrips();

    expect(result).toEqual({
      success: true,
      processedTrips: 0,
      flushedPoints: 0,
      failures: 0
    });
    expect(redisMock.hset).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      expect.objectContaining({
        status: 'idle',
        heartbeatAt: expect.stringMatching(/^\d+$/),
        processedTrips: '0',
        flushedPoints: '0',
        failures: '0'
      })
    );
    expect(redisMock.expire).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      90
    );
    expect(firebaseConfig.getFirestore).toHaveBeenCalledTimes(1);
  });

  test('flushPendingTrips publishes degraded heartbeat when Firestore persistence is enabled but unavailable', async () => {
    firebaseConfig.getFirestore.mockReturnValue(null);

    const result = await service.flushPendingTrips();

    expect(result).toEqual({
      success: false,
      processedTrips: 0,
      flushedPoints: 0,
      failures: 1,
      reason: 'firestore_unavailable'
    });
    expect(redisMock.scan).not.toHaveBeenCalled();
    expect(redisMock.hset).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      expect.objectContaining({
        status: 'degraded',
        processedTrips: '0',
        flushedPoints: '0',
        failures: '1'
      })
    );
    expect(redisMock.expire).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      90
    );
  });

  test('flushPendingTrips publishes healthy status when existing flushes all succeed', async () => {
    redisMock.scan.mockResolvedValue(['0', ['trip_loc_buffer:trip-1']]);
    redisMock.llen.mockResolvedValue(4);
    jest.spyOn(service, 'flushTripChunks').mockResolvedValue({
      success: true,
      flushedPoints: 4
    });

    const result = await service.flushPendingTrips();

    expect(result).toEqual({
      success: true,
      processedTrips: 1,
      flushedPoints: 4,
      failures: 0
    });
    expect(redisMock.hset).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      expect.objectContaining({
        status: 'healthy',
        processedTrips: '1',
        flushedPoints: '4',
        failures: '0'
      })
    );
  });

  test('flushPendingTrips returns success=false and degraded heartbeat after a partial failure', async () => {
    redisMock.scan.mockResolvedValue(['0', ['trip_loc_buffer:trip-1', 'trip_loc_buffer:trip-2']]);
    redisMock.llen.mockResolvedValue(3);
    jest.spyOn(service, 'flushTripChunks')
      .mockResolvedValueOnce({ success: true, flushedPoints: 3 })
      .mockResolvedValueOnce({ success: false, reason: 'firestore_unavailable' });

    const result = await service.flushPendingTrips();

    expect(result).toEqual({
      success: false,
      processedTrips: 2,
      flushedPoints: 3,
      failures: 1
    });
    expect(redisMock.hset).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      expect.objectContaining({
        status: 'degraded',
        processedTrips: '2',
        flushedPoints: '3',
        failures: '1'
      })
    );
  });

  test('flushPendingTrips attempts degraded heartbeat when an external scan fails', async () => {
    redisMock.scan.mockRejectedValue(new Error('external scan failure'));

    await expect(service.flushPendingTrips()).rejects.toThrow('external scan failure');

    expect(redisMock.hset).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      expect.objectContaining({
        status: 'degraded',
        failures: '1'
      })
    );
    expect(redisMock.expire).toHaveBeenCalledWith(
      'leaf:test:trip-location-worker:health',
      90
    );
    expect(firebaseConfig.getFirestore).toHaveBeenCalledTimes(1);
  });

  test('bufferLocationEvent indexes the trip so the periodic flush can skip SCAN', async () => {
    redisMock.set.mockResolvedValue('OK');
    redisMock.rpush.mockResolvedValue(1);
    redisMock.hgetall.mockResolvedValue({});

    await service.bufferLocationEvent({
      tripId: 'trip-9',
      driverId: 'driver-1',
      seq: 1,
      capturedAt: 1000,
      lat: -22.9,
      lng: -43.2
    });

    expect(redisMock.sadd).toHaveBeenCalledWith('trip_loc_buffer_index', 'trip-9');
  });

  test('flushPendingTrips reads the index and only reconciles with SCAN on its interval', async () => {
    redisMock.sscan.mockResolvedValue(['0', ['trip-1']]);
    redisMock.llen.mockResolvedValue(2);
    redisMock.scan.mockResolvedValue(['0', ['trip_loc_buffer:trip-1', 'trip_loc_buffer:trip-orphan']]);
    const flushSpy = jest.spyOn(service, 'flushTripChunks').mockResolvedValue({
      success: true,
      flushedPoints: 2
    });

    const first = await service.flushPendingTrips();
    expect(redisMock.scan).toHaveBeenCalledTimes(1);
    expect(redisMock.zadd).toHaveBeenCalledWith(service.bufferQueueKey, 'NX', expect.any(Number), 'trip-orphan');
    expect(flushSpy.mock.calls.map(([tripId]) => tripId)).toEqual(['trip-1', 'trip-orphan']);
    expect(first.processedTrips).toBe(2);

    await service.flushPendingTrips();
    await service.flushPendingTrips();
    expect(redisMock.scan).toHaveBeenCalledTimes(1);
  });

  test('flushPendingTrips drops index entries whose buffer drained or expired', async () => {
    service.lastBufferReconcileAt = Date.now();
    redisMock.queueIds = ['trip-gone'];
    redisMock.llen.mockResolvedValue(0);
    const flushSpy = jest.spyOn(service, 'flushTripChunks');

    const result = await service.flushPendingTrips();

    expect(redisMock.scan).not.toHaveBeenCalled();
    expect(flushSpy).not.toHaveBeenCalled();
    expect(redisMock.srem).toHaveBeenCalledWith('trip_loc_buffer_index', 'trip-gone');
    expect(result).toEqual({
      success: true,
      processedTrips: 0,
      flushedPoints: 0,
      failures: 0
    });
  });
});

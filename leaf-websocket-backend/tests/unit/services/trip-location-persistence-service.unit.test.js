jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../../../utils/redis-scan', () => ({
  scanKeys: jest.fn()
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
      scan: jest.fn()
    };

    redisPool.ensureConnection.mockResolvedValue(true);
    redisPool.getConnection.mockReturnValue(redisMock);

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
    redisMock.set.mockResolvedValue(null);

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
    const collectionMock = jest.fn(() => ({ add: addMock }));
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
    redisMock.get.mockResolvedValue('different-lock'); // evita del em lock que não pertence

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

  test('recovers sandbox scope from Redis metadata and writes only to sandbox chunks', async () => {
    const sandboxEnvelope = buildSandboxEnvelope();
    const redisEnvelope = buildRedisEnvelope(sandboxEnvelope);
    const addMock = jest.fn().mockResolvedValue({ id: 'sandbox-chunk-1' });
    const collectionMock = jest.fn(() => ({ add: addMock }));
    firebaseConfig.getFirestore.mockReturnValue({ collection: collectionMock });

    redisMock.hgetall.mockResolvedValue(redisEnvelope);
    redisMock.set.mockResolvedValue('OK');
    redisMock.llen.mockResolvedValue(1);
    redisMock.lrange.mockResolvedValue([
      JSON.stringify({
        tripId: 'sandbox-trip-1',
        driverId: 'sandbox-driver-1',
        seq: 1,
        lat: -22.9,
        lng: -43.2,
        capturedAt: 1000,
        ...sandboxEnvelope
      })
    ]);
    redisMock.get.mockResolvedValue('different-lock');

    const result = await service.flushTripChunks('sandbox-trip-1', {
      force: false,
      maxChunks: 1,
      reason: 'periodic'
    });

    expect(result.success).toBe(true);
    expect(collectionMock).toHaveBeenCalledWith('sandbox_trip_location_chunks');
    expect(collectionMock).not.toHaveBeenCalledWith('trip_location_chunks');
    expect(addMock).toHaveBeenCalledWith(expect.objectContaining({
      financialNamespace: 'sandbox',
      financialContextId: sandboxEnvelope.financialContextId,
      financialContext: sandboxEnvelope.financialContext
    }));
  });

  test('does not reach Firestore when sandbox Redis metadata lost its context', async () => {
    redisMock.hgetall.mockResolvedValue({
      tripId: 'sandbox-trip-lost-context',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox'
    });

    await expect(service.flushTripChunks('sandbox-trip-lost-context', {
      force: false,
      maxChunks: 1
    })).rejects.toMatchObject({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });

    expect(firebaseConfig.getFirestore).not.toHaveBeenCalled();
  });

  test('writes sandbox final summaries only to the sandbox collection', async () => {
    const sandboxEnvelope = buildSandboxEnvelope();
    const redisEnvelope = buildRedisEnvelope(sandboxEnvelope);
    const setSummaryMock = jest.fn().mockResolvedValue(undefined);
    const docMock = jest.fn(() => ({ set: setSummaryMock }));
    const collectionMock = jest.fn(() => ({ doc: docMock }));
    firebaseConfig.getFirestore.mockReturnValue({ collection: collectionMock });
    redisMock.llen.mockResolvedValue(0);
    redisMock.hgetall.mockResolvedValue(redisEnvelope);

    const result = await service.forceFinalizeTrip('sandbox-trip-1', {
      status: 'completed',
      reason: 'ride_completed',
      ...sandboxEnvelope
    });

    expect(result.success).toBe(true);
    expect(collectionMock).toHaveBeenCalledWith('sandbox_trip_location_summaries');
    expect(collectionMock).not.toHaveBeenCalledWith('trip_location_summaries');
    expect(setSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'sandbox-trip-1',
        financialNamespace: 'sandbox',
        financialContextId: sandboxEnvelope.financialContextId,
        financialContext: sandboxEnvelope.financialContext
      }),
      { merge: true }
    );
  });

  test('derives interruption metrics only from server-received trip telemetry', async () => {
    firebaseConfig.getFirestore.mockReturnValue(null);
    redisMock.lrange.mockResolvedValue([
      JSON.stringify({
        tripId: 'trip-1',
        driverId: 'driver-1',
        lat: -22.9005,
        lng: -43.2005,
        capturedAt: 1,
        receivedAt: 1_000_100,
        seq: 1
      }),
      JSON.stringify({
        tripId: 'trip-1',
        driverId: 'other-driver',
        lat: 0,
        lng: 0,
        receivedAt: 1_000_150,
        seq: 2
      }),
      JSON.stringify({
        tripId: 'trip-1',
        driverId: 'driver-1',
        lat: -22.901,
        lng: -43.201,
        capturedAt: 999_999_999,
        receivedAt: 1_000_200,
        seq: 3
      })
    ]);

    const result = await service.resolveCanonicalTripMetrics({
      redis: redisMock,
      tripId: 'trip-1',
      driverId: 'driver-1',
      startedAt: 1_000_000,
      startLocation: { lat: -22.9, lng: -43.2 },
      nowMs: 1_000_600
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      source: 'server_trip_location_telemetry',
      durationSecs: 1,
      pointsCount: 2,
      endLocation: { lat: -22.901, lng: -43.201 }
    }));
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(1);
  });

  test('resolves canonical metrics from Redis metadata after location chunks are flushed', async () => {
    redisMock.hgetall.mockResolvedValue({
      canonicalDriverId: 'driver-1',
      canonicalDistanceKm: '0.150000',
      canonicalPointsCount: '30',
      canonicalFirstLat: '-22.9005',
      canonicalFirstLng: '-43.2005',
      canonicalFirstReceivedAt: '1000100',
      canonicalLastLat: '-22.905',
      canonicalLastLng: '-43.205',
      canonicalLastReceivedAt: '1000500'
    });

    const result = await service.resolveCanonicalTripMetrics({
      redis: redisMock,
      tripId: 'trip-1',
      driverId: 'driver-1',
      startedAt: 1_000_000,
      startLocation: { lat: -22.9, lng: -43.2 },
      nowMs: 1_600_000
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      source: 'server_trip_location_telemetry',
      durationSecs: 600,
      pointsCount: 30,
      endLocation: { lat: -22.905, lng: -43.205 }
    }));
    expect(result.distanceKm).toBeGreaterThan(0.15);
    expect(redisMock.lrange).not.toHaveBeenCalled();
  });
});

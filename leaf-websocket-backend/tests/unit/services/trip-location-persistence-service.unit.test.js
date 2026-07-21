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
  let RedisScan;
  let redisMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.TRIP_LOCATION_CHUNK_RETENTION_DAYS = '7';
    process.env.ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE = 'true';
    process.env.TRIP_LOCATION_WORKER_HEALTH_KEY = 'leaf:test:trip-location-worker:health';
    process.env.TRIP_LOCATION_WORKER_HEALTH_TTL_SECONDS = '90';

    redisPool = require('../../../utils/redis-pool');
    firebaseConfig = require('../../../firebase-config');
    RedisScan = require('../../../utils/redis-scan');

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
    firebaseConfig.getFirestore.mockReturnValue({});

    service = require('../../../services/trip-location-persistence-service');
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

  test('flushTripChunks should persist chunk with retention timestamp', async () => {
    const addMock = jest.fn().mockResolvedValue({ id: 'chunk-1' });
    firebaseConfig.getFirestore.mockReturnValue({
      collection: jest.fn(() => ({
        add: addMock
      }))
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
    RedisScan.scanKeys.mockResolvedValue([]);

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
    expect(RedisScan.scanKeys).not.toHaveBeenCalled();
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
    RedisScan.scanKeys.mockResolvedValue(['trip_loc_buffer:trip-1']);
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
    RedisScan.scanKeys.mockResolvedValue([
      'trip_loc_buffer:trip-1',
      'trip_loc_buffer:trip-2'
    ]);
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
    RedisScan.scanKeys.mockRejectedValue(new Error('external scan failure'));

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
});

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));
jest.mock('../../../firebase-config', () => ({ getFirestore: jest.fn() }));
jest.mock('../../../utils/redis-scan', () => ({ scanKeys: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn(), logError: jest.fn() }));
jest.mock('firebase-admin', () => ({
  firestore: { FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TS') } }
}));

const service = require('../../../services/trip-location-persistence-service');

// Caso real de produção (sandbox, 2026-10-13): a trilha começou 20 s antes do início
// da viagem e o encerramento no embarque foi cobrado inteiro.
const STARTED_AT_MS = 1791903743946;
const META = {
  canonicalDriverId: 'driver_1',
  canonicalFirstLat: '-22.9207704',
  canonicalFirstLng: '-43.4059848',
  canonicalLastLat: '-22.9207704',
  canonicalLastLng: '-43.4059848',
  canonicalFirstReceivedAt: '1791903723734',
  canonicalLastReceivedAt: '1791903751994',
  canonicalDistanceKm: '0.000000',
  canonicalPointsCount: '9'
};

function createRedis(meta = META, bufferPoints = []) {
  return {
    hgetall: jest.fn().mockResolvedValue(meta),
    lrange: jest.fn().mockResolvedValue(bufferPoints)
  };
}

const baseOptions = {
  tripId: 'booking_1',
  driverId: 'driver_1',
  startedAt: new Date(STARTED_AT_MS).toISOString(),
  startLocation: { lat: -22.9207704, lng: -43.4059848 },
  nowMs: STARTED_AT_MS + 13600
};

describe('trip metrics when telemetry started before the trip', () => {
  it('returns the last trusted position when asked to accept pre-start telemetry', async () => {
    const metrics = await service.resolveCanonicalTripMetrics({
      ...baseOptions,
      redis: createRedis(),
      allowPreStartTelemetry: true
    });

    expect(metrics).toMatchObject({
      success: true,
      source: 'server_trip_location_last_point',
      endLocation: { lat: -22.9207704, lng: -43.4059848 },
      lastReceivedAtMs: 1791903751994,
      distanceKm: 0,
      durationSecs: 14
    });
  });

  it('keeps the previous answer for callers that did not ask for it', async () => {
    const metrics = await service.resolveCanonicalTripMetrics({ ...baseOptions, redis: createRedis() });

    expect(metrics.source).not.toBe('server_trip_location_last_point');
  });

  it('does not trust a last position that is also older than the trip start', async () => {
    const metrics = await service.resolveCanonicalTripMetrics({
      ...baseOptions,
      redis: createRedis({ ...META, canonicalLastReceivedAt: String(STARTED_AT_MS - 1000) }),
      allowPreStartTelemetry: true
    });

    expect(metrics.source).not.toBe('server_trip_location_last_point');
  });

  it('ignores telemetry from another driver', async () => {
    const metrics = await service.resolveCanonicalTripMetrics({
      ...baseOptions,
      redis: createRedis({ ...META, canonicalDriverId: 'driver_2' }),
      allowPreStartTelemetry: true
    });

    expect(metrics.source).not.toBe('server_trip_location_last_point');
  });
});

describe('toll crossings recorded with the canonical trail', () => {
  const PLAZA = { lat: -22.9194989223804, lng: -43.3962833 };

  function createWritableRedis(meta = {}) {
    const store = { ...meta };
    return {
      store,
      hgetall: jest.fn(async () => ({ ...store })),
      hset: jest.fn(async (_key, values) => { Object.assign(store, values); }),
      set: jest.fn().mockResolvedValue('OK'),
      rpush: jest.fn().mockResolvedValue(1),
      sadd: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      lrange: jest.fn().mockResolvedValue([])
    };
  }

  async function buffer(redis, point) {
    require('../../../utils/redis-pool').getConnection.mockReturnValue(redis);
    await service.bufferLocationEvent({ tripId: 'booking_1', driverId: 'driver_1', ...point });
  }

  it('records a plaza the car drove through and reports it after the start', async () => {
    const redis = createWritableRedis();
    await buffer(redis, { lat: PLAZA.lat - 0.003, lng: PLAZA.lng, receivedAt: STARTED_AT_MS + 1000, seq: 1 });
    await buffer(redis, { lat: PLAZA.lat + 0.003, lng: PLAZA.lng, receivedAt: STARTED_AT_MS + 20000, seq: 2 });

    expect(JSON.parse(redis.store.canonicalTollCrossings)).toEqual([
      expect.objectContaining({ id: 'p10a_transolimpica', at: STARTED_AT_MS + 20000 })
    ]);

    const metrics = await service.resolveCanonicalTripMetrics({
      redis,
      tripId: 'booking_1',
      driverId: 'driver_1',
      startedAt: new Date(STARTED_AT_MS).toISOString(),
      nowMs: STARTED_AT_MS + 30000
    });
    expect(metrics.tollCrossingsTracked).toBe(true);
    expect(metrics.tollCrossings.map((crossing) => crossing.id)).toEqual(['p10a_transolimpica']);
  });

  it('reports no crossing for the production early end beside the pickup', async () => {
    const metrics = await service.resolveCanonicalTripMetrics({
      ...baseOptions,
      redis: createRedis({ ...META, canonicalTollCrossings: '[]' }),
      allowPreStartTelemetry: true
    });

    expect(metrics).toMatchObject({ tollCrossingsTracked: true, tollCrossings: [] });
  });

  it('leaves a trail that started before crossings were recorded as untracked', async () => {
    const redis = createWritableRedis({
      canonicalDriverId: 'driver_1',
      canonicalFirstLat: String(PLAZA.lat - 0.003),
      canonicalFirstLng: String(PLAZA.lng),
      canonicalLastLat: String(PLAZA.lat - 0.003),
      canonicalLastLng: String(PLAZA.lng),
      canonicalFirstReceivedAt: String(STARTED_AT_MS + 1000),
      canonicalLastReceivedAt: String(STARTED_AT_MS + 1000),
      canonicalDistanceKm: '0',
      canonicalPointsCount: '1'
    });
    await buffer(redis, { lat: PLAZA.lat + 0.003, lng: PLAZA.lng, receivedAt: STARTED_AT_MS + 20000, seq: 2 });

    expect(redis.store.canonicalTollCrossings).toBeUndefined();
    const metrics = await service.resolveCanonicalTripMetrics({
      redis,
      tripId: 'booking_1',
      driverId: 'driver_1',
      startedAt: new Date(STARTED_AT_MS).toISOString(),
      nowMs: STARTED_AT_MS + 30000
    });
    expect(metrics.tollCrossingsTracked).toBe(false);
  });
});

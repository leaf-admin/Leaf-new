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

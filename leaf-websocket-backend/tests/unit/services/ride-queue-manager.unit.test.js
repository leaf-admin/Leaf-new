jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn()
}));

jest.mock('../../../utils/geohash-utils', () => ({
  getRegionHashFromLocation: jest.fn(() => 'region123')
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    PENDING: 'PENDING',
    AWAITING_PAYMENT: 'AWAITING_PAYMENT'
  }
}));

jest.mock('../../../services/event-sourcing', () => ({
  EVENT_TYPES: {
    RIDE_QUEUED: 'ride.queued'
  },
  recordEvent: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  BOOKING_VISIBILITY_TTL_SEC: 60,
  getVisibleBookingKey: jest.fn((bookingId) => `booking_visible:${bookingId}`)
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../../../utils/redis-scan', () => ({
  scanKeys: jest.fn()
}));

const redisPool = require('../../../utils/redis-pool');
const RedisScan = require('../../../utils/redis-scan');

describe('ride-queue-manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('serializes ride preferences and Leaf Delas flags into the Redis booking snapshot', async () => {
    const pipeline = {
      hset: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([])
    };
    redisPool.getConnection.mockReturnValue({
      pipeline: jest.fn(() => pipeline)
    });

    const rideQueueManager = require('../../../services/ride-queue-manager');

    await rideQueueManager.enqueueRide(
      {
        bookingId: 'booking_preferences_1',
        customerId: 'customer_1',
        pickupLocation: { lat: -22.97, lng: -43.18 },
        destinationLocation: { lat: -22.98, lng: -43.22 },
        estimatedFare: 27.5,
        preferences: {
          leafDelas: true,
          temperature: 'cool',
          conversation: 'quiet'
        },
        femaleDriverOnly: true,
        paymentStatus: 'confirmed',
        paymentAmountInCents: 1840,
        paymentGrossAmountInCents: 1960,
        paymentQuoteSessionId: 'quote_session_123',
        paymentQuoteLockId: 'ql_123',
        paymentDriverReservationId: 'pdr_123',
        paymentDriverReservationDriverId: 'driver_123',
        paymentDriverReservationExpiresAt: '2026-06-27T14:00:00.000Z',
        paymentDriverReservationTtlSeconds: 21600,
        providerEnvironment: 'sandbox',
        paymentProviderEnvironment: 'sandbox',
        paymentProfileId: 'qa-test-users-sandbox-durable',
        paymentProfileReason: 'durable_test_users_payment_sandbox_policy',
        paymentProfileSource: 'firestore',
        passengerName: 'Leaf Passageiro Teste',
        customerName: 'Leaf Passageiro Teste',
        routeCoordinates: [
          { latitude: -22.97, longitude: -43.18 },
          { latitude: -22.98, longitude: -43.22 }
        ],
        trafficSegments: [
          {
            level: 'normal',
            coordinates: [
              { latitude: -22.97, longitude: -43.18 },
              { latitude: -22.98, longitude: -43.22 }
            ]
          }
        ]
      },
      { deferEventSourcing: false }
    );

    expect(pipeline.hset).toHaveBeenCalledWith(
      'booking:booking_preferences_1',
      expect.objectContaining({
        preferences: JSON.stringify({
          leafDelas: true,
          temperature: 'cool',
          conversation: 'quiet'
        }),
        femaleDriverOnly: 'true',
        paymentAmountInCents: '1840',
        paymentGrossAmountInCents: '1960',
        paymentQuoteSessionId: 'quote_session_123',
        paymentQuoteLockId: 'ql_123',
        paymentDriverReservationId: 'pdr_123',
        paymentDriverReservationDriverId: 'driver_123',
        paymentDriverReservationExpiresAt: '2026-06-27T14:00:00.000Z',
        paymentDriverReservationTtlSeconds: '21600',
        providerEnvironment: 'sandbox',
        paymentProviderEnvironment: 'sandbox',
        paymentProfileId: 'qa-test-users-sandbox-durable',
        paymentProfileReason: 'durable_test_users_payment_sandbox_policy',
        paymentProfileSource: 'firestore',
        passengerName: 'Leaf Passageiro Teste',
        customerName: 'Leaf Passageiro Teste',
        routeCoordinates: JSON.stringify([
          { latitude: -22.97, longitude: -43.18 },
          { latitude: -22.98, longitude: -43.22 }
        ]),
        trafficSegments: JSON.stringify([
          {
            level: 'normal',
            coordinates: [
              { latitude: -22.97, longitude: -43.18 },
              { latitude: -22.98, longitude: -43.22 }
            ]
          }
        ])
      })
    );
    expect(pipeline.hset).toHaveBeenCalledWith(
      'booking_visible:booking_preferences_1',
      expect.objectContaining({
        preferences: JSON.stringify({
          leafDelas: true,
          temperature: 'cool',
          conversation: 'quiet'
        }),
        femaleDriverOnly: 'true',
        paymentAmountInCents: '1840',
        paymentGrossAmountInCents: '1960',
        paymentQuoteSessionId: 'quote_session_123',
        paymentQuoteLockId: 'ql_123',
        paymentDriverReservationId: 'pdr_123',
        paymentDriverReservationDriverId: 'driver_123',
        paymentDriverReservationExpiresAt: '2026-06-27T14:00:00.000Z',
        paymentDriverReservationTtlSeconds: '21600',
        providerEnvironment: 'sandbox',
        paymentProviderEnvironment: 'sandbox',
        paymentProfileId: 'qa-test-users-sandbox-durable',
        routeCoordinates: JSON.stringify([
          { latitude: -22.97, longitude: -43.18 },
          { latitude: -22.98, longitude: -43.22 }
        ]),
        trafficSegments: JSON.stringify([
          {
            level: 'normal',
            coordinates: [
              { latitude: -22.97, longitude: -43.18 },
              { latitude: -22.98, longitude: -43.22 }
            ]
          }
        ])
      })
    );
  });
});

describe('ride-queue-manager active regions', () => {
  let redis;
  let manager;
  let nowSpy;
  let now;

  beforeEach(() => {
    jest.clearAllMocks();
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    redis = {
      smembers: jest.fn().mockResolvedValue([]),
      sadd: jest.fn().mockResolvedValue(1)
    };
    redisPool.getConnection.mockReturnValue(redis);
    RedisScan.scanKeys.mockResolvedValue([]);
    jest.isolateModules(() => {
      manager = require('../../../services/ride-queue-manager');
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('does not rescan the keyspace on every cycle while the queue is idle', async () => {
    await expect(manager.getActiveRegions()).resolves.toEqual([]);
    expect(RedisScan.scanKeys).toHaveBeenCalledTimes(1);

    // Past the 2s region cache but inside the 60s reconcile window.
    for (let i = 0; i < 20; i += 1) {
      now += 2500;
      await expect(manager.getActiveRegions()).resolves.toEqual([]);
    }

    expect(redis.smembers).toHaveBeenCalledTimes(21);
    expect(RedisScan.scanKeys).toHaveBeenCalledTimes(1);
  });

  it('reconciles a pending queue missing from the index once the interval elapses', async () => {
    await manager.getActiveRegions();
    RedisScan.scanKeys.mockResolvedValue(['ride_queue:orphan:pending']);

    now += 60_000;
    await expect(manager.getActiveRegions()).resolves.toEqual(['orphan']);

    expect(RedisScan.scanKeys).toHaveBeenCalledTimes(2);
    expect(redis.sadd).toHaveBeenCalledWith('ride_queue:regions', 'orphan');
  });

  it('serves regions from the index without scanning', async () => {
    redis.smembers.mockResolvedValue(['region-a', 'region-b']);

    await expect(manager.getActiveRegions()).resolves.toEqual(['region-a', 'region-b']);

    expect(RedisScan.scanKeys).not.toHaveBeenCalled();
  });
});

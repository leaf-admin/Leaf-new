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

const redisPool = require('../../../utils/redis-pool');

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

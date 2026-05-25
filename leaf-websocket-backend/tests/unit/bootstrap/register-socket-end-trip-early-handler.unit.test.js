jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({
  calculateFareBreakdownFromReais: jest.fn(() => ({
    totalFare: 27.5,
    tollFee: 2.5,
    rideFare: 25
  }))
})));

jest.mock('../../../services/ride-persistence-service', () => ({
  persistFinalRideDataWithOutbox: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  clearBookingSnapshot: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/ride-lifecycle-feature-flags', () => ({
  isRiderEarlyEndEnabled: jest.fn(() => true)
}));

const ridePersistenceService = require('../../../services/ride-persistence-service');
const pricingH3ReadModelService = require('../../../services/pricing-h3-read-model-service');
const { isRiderEarlyEndEnabled } = require('../../../utils/ride-lifecycle-feature-flags');
const registerSocketEndTripEarlyHandler = require('../../../bootstrap/register-socket-end-trip-early-handler');

function buildHarness({ commandResult } = {}) {
  const listeners = {};
  const socket = {
    id: 'socket-1',
    userId: 'customer-1',
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: jest.fn()
  };
  const roomEmit = jest.fn();
  const io = {
    activeBookings: new Map([['booking-1', { bookingId: 'booking-1' }]]),
    to: jest.fn(() => ({ emit: roomEmit }))
  };
  const redis = {
    hgetall: jest.fn().mockResolvedValue({
      bookingId: 'booking-1',
      customerId: 'customer-1',
      driverId: 'driver-1',
      destinationAddress: 'Leblon',
      status: 'STARTED'
    }),
    hdel: jest.fn().mockResolvedValue(1)
  };
  const EndRideEarlyByRiderCommand = jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(commandResult || {
      success: true,
      data: {
        driverId: 'driver-1',
        customerId: 'customer-1',
        event: { bookingId: 'booking-1' },
        finalFare: 27.5,
        tollFee: 2.5,
        distance: 6.2,
        duration: 840,
        paymentDistribution: { driverAmount: 22 },
        settlement: { idempotencyKey: 'settlement-1' }
      }
    })
  }));
  const eventBus = {
    publish: jest.fn().mockResolvedValue(true)
  };
  const traceContext = {
    generateTraceId: jest.fn(() => 'trace-1'),
    runWithTraceId: jest.fn(async (_traceId, fn) => fn())
  };

  registerSocketEndTripEarlyHandler({
    socket,
    io,
    redisPool: {
      getConnection: jest.fn(() => redis)
    },
    logStructured: jest.fn(),
    EndRideEarlyByRiderCommand,
    traceContext,
    eventBus
  });

  return {
    listeners,
    socket,
    io,
    roomEmit,
    redis,
    EndRideEarlyByRiderCommand,
    eventBus
  };
}

describe('registerSocketEndTripEarlyHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isRiderEarlyEndEnabled.mockReturnValue(true);
  });

  it('emits tripCompleted for passenger and driver and persists final data asynchronously', async () => {
    const { listeners, io, roomEmit, redis, EndRideEarlyByRiderCommand, eventBus } = buildHarness();

    await listeners.endTripEarlyByRider({
      bookingId: 'booking-1',
      endLocation: { lat: -22.98, lng: -43.21 },
      distanceKm: 6.2,
      durationSecs: 840
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(EndRideEarlyByRiderCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        customerId: 'customer-1',
        distanceKm: 6.2,
        durationSecs: 840
      })
    );
    expect(io.to).toHaveBeenCalledWith('driver_driver-1');
    expect(io.to).toHaveBeenCalledWith('customer_customer-1');
    expect(roomEmit).toHaveBeenCalledWith(
      'tripCompleted',
      expect.objectContaining({
        bookingId: 'booking-1',
        completionType: 'EARLY_ENDED_BY_RIDER'
      })
    );
    expect(eventBus.publish).toHaveBeenCalledWith({
      eventType: 'ride.completed',
      data: { bookingId: 'booking-1' }
    });
    expect(ridePersistenceService.persistFinalRideDataWithOutbox).toHaveBeenCalledWith(
      'booking-1',
      expect.objectContaining({
        completionType: 'EARLY_ENDED_BY_RIDER',
        fare: 27.5
      })
    );
    expect(redis.hdel).toHaveBeenCalledWith('bookings:active', 'booking-1');
    expect(pricingH3ReadModelService.clearBookingSnapshot).toHaveBeenCalledWith(redis, 'booking-1');
  });

  it('rejects early ending when the feature flag is off', async () => {
    isRiderEarlyEndEnabled.mockReturnValue(false);
    const { listeners, socket } = buildHarness();

    await listeners.endTripEarlyByRider({
      bookingId: 'booking-1',
      endLocation: { lat: -22.98, lng: -43.21 }
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'tripCompleteError',
      expect.objectContaining({
        error: expect.stringContaining('desabilitado')
      })
    );
  });
});

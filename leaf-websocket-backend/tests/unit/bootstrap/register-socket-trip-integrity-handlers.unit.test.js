jest.mock('../../../services/ride-state-manager', () => ({
  getBookingState: jest.fn().mockResolvedValue('STARTED')
}));

const RideStateManager = require('../../../services/ride-state-manager');
const registerSocketTripIntegrityHandlers = require('../../../bootstrap/register-socket-trip-integrity-handlers');

function buildHarness({ bookingData, integritySnapshot, cancelResult } = {}) {
  const listeners = {};
  const socket = {
    id: 'socket-1',
    userId: 'customer-1',
    userType: 'customer',
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: jest.fn()
  };
  const roomEmit = jest.fn();
  const io = {
    to: jest.fn(() => ({ emit: roomEmit }))
  };
  const redis = {
    get: jest.fn().mockResolvedValue('booking-1'),
    hgetall: jest.fn(async (key) => {
      if (key === 'booking:booking-1') {
        return bookingData || {
          bookingId: 'booking-1',
          customerId: 'customer-1',
          driverId: 'driver-1',
          status: 'STARTED'
        };
      }
      if (key === 'trip_integrity:booking-1') {
        return integritySnapshot || {
          driverId: 'driver-1',
          customerId: 'customer-1',
          driverLat: '-22.9700',
          driverLng: '-43.1800',
          driverAt: String(Date.now()),
          divergenceCount: '0'
        };
      }
      return {};
    }),
    hset: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    set: jest.fn().mockResolvedValue('OK')
  };
  const CancelRideCommand = jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(cancelResult || { success: true, data: { event: { bookingId: 'booking-1' } } })
  }));
  const eventBus = {
    publish: jest.fn().mockResolvedValue(true)
  };

  registerSocketTripIntegrityHandlers({
    socket,
    io,
    redisPool: {
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      getConnection: jest.fn(() => redis)
    },
    logStructured: jest.fn(),
    CancelRideCommand,
    traceContext: {
      generateTraceId: jest.fn(() => 'trace-1')
    },
    eventBus
  });

  return {
    listeners,
    socket,
    io,
    roomEmit,
    redis,
    CancelRideCommand,
    eventBus
  };
}

describe('registerSocketTripIntegrityHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RideStateManager.getBookingState.mockResolvedValue('STARTED');
  });

  it('accepts passenger location updates during monitored rides', async () => {
    const { listeners, socket, redis } = buildHarness();

    await listeners.passengerLocationUpdate({
      bookingId: 'booking-1',
      lat: -22.9701,
      lng: -43.1801,
      timestamp: Date.now()
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'trip_integrity:booking-1',
      expect.objectContaining({
        customerId: 'customer-1',
        passengerLat: String(-22.9701),
        passengerLng: String(-43.1801)
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'passengerLocationUpdated',
      expect.objectContaining({
        success: true,
        bookingId: 'booking-1'
      })
    );
  });

  it('marks the ride for payout review instead of cancelling when the divergence stays unresolved', async () => {
    const alertOpenAt = Date.now() - 60 * 1000;
    const { listeners, redis, CancelRideCommand } = buildHarness({
      integritySnapshot: {
        driverId: 'driver-1',
        customerId: 'customer-1',
        driverLat: '-22.9700',
        driverLng: '-43.1800',
        driverAt: String(Date.now()),
        passengerLat: '-22.9970',
        passengerLng: '-43.1800',
        passengerAt: String(Date.now()),
        divergenceCount: '5',
        alertOpenAt: String(alertOpenAt)
      }
    });

    // Passageiro a ~3 km do carro, alerta aberto há 1 minuto sem confirmação.
    await listeners.passengerLocationUpdate({
      bookingId: 'booking-1',
      lat: -22.9970,
      lng: -43.1800,
      timestamp: Date.now()
    });

    expect(CancelRideCommand).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalledWith(expect.stringContaining('driver_soft_ban'), expect.anything(), 'EX', expect.anything());
    expect(redis.hset).toHaveBeenCalledWith(
      'trip_integrity:booking-1',
      expect.objectContaining({
        holdRecommendedAt: expect.any(String),
        holdRecommendedReason: 'TRIP_INTEGRITY_DISTANCE_TIMEOUT'
      })
    );
  });

  it('confirms boarding for both passenger and driver rooms', async () => {
    const { listeners, io, roomEmit, redis } = buildHarness();

    await listeners.confirmBoardingStatus({
      bookingId: 'booking-1',
      boarded: true
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'trip_integrity:booking-1',
      expect.objectContaining({
        divergenceCount: '0',
        boardingConfirmedAt: expect.any(String)
      })
    );
    expect(io.to).toHaveBeenCalledWith('customer_customer-1');
    expect(io.to).toHaveBeenCalledWith('driver_driver-1');
    expect(roomEmit).toHaveBeenCalledWith(
      'boardingStatusConfirmed',
      expect.objectContaining({
        success: true,
        bookingId: 'booking-1',
        boarded: true
      })
    );
  });

  it('cancels the ride when passenger reports incorrect boarding', async () => {
    const { listeners, socket, CancelRideCommand, eventBus } = buildHarness();

    await listeners.confirmBoardingStatus({
      bookingId: 'booking-1',
      boarded: false
    });

    expect(CancelRideCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-1',
        canceledBy: 'system_trip_integrity',
        userType: 'system'
      })
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ride.canceled'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'boardingStatusConfirmed',
      expect.objectContaining({
        success: true,
        bookingId: 'booking-1',
        boarded: false
      })
    );
  });
});

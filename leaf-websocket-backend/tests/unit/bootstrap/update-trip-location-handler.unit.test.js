jest.mock('../../../services/trip-location-persistence-service', () => ({
  bufferLocationEvent: jest.fn().mockResolvedValue({ success: true })
}));

const tripLocationPersistenceService = require('../../../services/trip-location-persistence-service');
const registerSocketUpdateTripLocationHandler = require('../../../bootstrap/register-socket-update-trip-location-handler');

describe('registerSocketUpdateTripLocationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('broadcasts and persists driver location updates for active trips', async () => {
    const listeners = {};
    const socket = {
      userId: 'driver_1',
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      })
    };
    const roomEmitter = { emit: jest.fn() };
    const io = {
      to: jest.fn(() => roomEmitter)
    };
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_1',
        driverId: 'driver_1'
      })
    };
    const logStructured = jest.fn();

    registerSocketUpdateTripLocationHandler({
      socket,
      io,
      redisPool: {
        getConnection: () => redis
      },
      logStructured
    });

    await listeners.updateTripLocation({
      bookingId: 'booking_1',
      lat: '-22.9711',
      lng: '-43.1822',
      heading: 92,
      speed: 12,
      accuracy: 5,
      seq: 8,
      capturedAt: 123456
    });

    expect(io.to).toHaveBeenCalledWith('customer_customer_1');
    expect(roomEmitter.emit).toHaveBeenCalledWith(
      'tripLocationUpdated',
      expect.objectContaining({
        bookingId: 'booking_1',
        location: { lat: -22.9711, lng: -43.1822 },
        heading: 92,
        speed: 12
      })
    );
    expect(tripLocationPersistenceService.bufferLocationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'booking_1',
        bookingId: 'booking_1',
        driverId: 'driver_1',
        customerId: 'customer_1',
        lat: -22.9711,
        lng: -43.1822,
        heading: 92,
        speed: 12,
        accuracy: 5,
        seq: 8,
        capturedAt: 123456,
        source: 'updateTripLocation'
      })
    );
    expect(logStructured).not.toHaveBeenCalledWith(
      'error',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('rejects trip telemetry from a socket that is not the assigned driver', async () => {
    const listeners = {};
    const socket = {
      userId: 'customer_1',
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      })
    };
    const roomEmitter = { emit: jest.fn() };
    const io = { to: jest.fn(() => roomEmitter) };
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_1',
        driverId: 'driver_1'
      })
    };
    const logStructured = jest.fn();

    registerSocketUpdateTripLocationHandler({
      socket,
      io,
      redisPool: { getConnection: () => redis },
      logStructured
    });

    await listeners.updateTripLocation({
      bookingId: 'booking_1',
      lat: -22.9711,
      lng: -43.1822
    });

    expect(io.to).not.toHaveBeenCalled();
    expect(tripLocationPersistenceService.bufferLocationEvent).not.toHaveBeenCalled();
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('rejeitada'),
      expect.objectContaining({
        bookingId: 'booking_1',
        socketUserId: 'customer_1',
        bookingDriverId: 'driver_1'
      })
    );
  });

  it('propagates only the authoritative sandbox envelope loaded from the booking', async () => {
    const listeners = {};
    const socket = {
      userId: 'driver_1',
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      })
    };
    const roomEmitter = { emit: jest.fn() };
    const io = { to: jest.fn(() => roomEmitter) };
    const authoritativeFinancialContext = JSON.stringify({
      version: 1,
      namespace: 'sandbox',
      contextId: 'authoritative-context-id'
    });
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        customerId: 'customer_1',
        driverId: 'driver_1',
        financialContext: authoritativeFinancialContext,
        financialNamespace: 'sandbox',
        financialContextId: 'authoritative-context-id',
        paymentProviderEnvironment: 'sandbox',
        paymentProfileId: 'qa-sandbox',
        testUserSandbox: 'true'
      })
    };

    registerSocketUpdateTripLocationHandler({
      socket,
      io,
      redisPool: { getConnection: () => redis },
      logStructured: jest.fn()
    });

    await listeners.updateTripLocation({
      bookingId: 'booking_1',
      lat: -22.9711,
      lng: -43.1822,
      financialContext: 'client-spoofed-context',
      financialNamespace: 'operational'
    });

    expect(tripLocationPersistenceService.bufferLocationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        financialContext: authoritativeFinancialContext,
        financialNamespace: 'sandbox',
        financialContextId: 'authoritative-context-id',
        providerEnvironment: 'sandbox',
        paymentProfileId: 'qa-sandbox',
        testUserSandbox: 'true'
      })
    );
  });
});

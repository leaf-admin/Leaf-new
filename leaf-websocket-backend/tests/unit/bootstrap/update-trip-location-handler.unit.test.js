jest.mock('../../../services/trip-location-persistence-service', () => ({
  bufferLocationEvent: jest.fn().mockResolvedValue({ success: true })
}));

const tripLocationPersistenceService = require('../../../services/trip-location-persistence-service');
const registerSocketUpdateTripLocationHandler = require('../../../bootstrap/register-socket-update-trip-location-handler');

describe('registerSocketUpdateTripLocationHandler', () => {
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
});

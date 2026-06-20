jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    ACCEPTED: 'ACCEPTED'
  }
}));

jest.mock('../../../services/booking-visibility-service', () => ({
  writeVisibleBookingSnapshot: jest.fn().mockResolvedValue(true)
}));

const { writeVisibleBookingSnapshot } = require('../../../services/booking-visibility-service');
const { ensureAcceptedRideCanonicalState } = require('../../../utils/accepted-ride-state');

describe('ensureAcceptedRideCanonicalState', () => {
  it('persists accepted state before socket delivery can advance the passenger UI', async () => {
    const hsetCalls = [];
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        state: 'SEARCHING',
        status: 'SEARCHING',
        customerId: 'passenger-1',
        pickupLocation: JSON.stringify({ lat: -22.92, lng: -43.4, add: 'Pickup' }),
        destinationLocation: JSON.stringify({ lat: -22.96, lng: -43.17, add: 'Dropoff' }),
        estimatedFare: '77.67'
      }),
      hset: jest.fn(async (...args) => {
        hsetCalls.push(args);
        return 1;
      }),
      type: jest.fn().mockResolvedValue('hash'),
      del: jest.fn().mockResolvedValue(1)
    };

    const active = await ensureAcceptedRideCanonicalState(redis, {
      bookingId: 'booking-1',
      driverId: 'driver-1',
      acceptedAt: '2026-06-18T13:29:10.600Z'
    });

    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking-1',
      expect.objectContaining({
        state: 'ACCEPTED',
        status: 'ACCEPTED',
        driverId: 'driver-1',
        ownerDriverId: 'driver-1',
        acceptedAt: '2026-06-18T13:29:10.600Z'
      })
    );
    expect(writeVisibleBookingSnapshot).toHaveBeenCalledWith(
      redis,
      'booking-1',
      expect.objectContaining({
        status: 'ACCEPTED',
        driverId: 'driver-1'
      })
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'bookings:active',
      'booking-1',
      expect.any(String)
    );
    const activeWrite = hsetCalls.find((call) => call[0] === 'bookings:active');
    const activePayload = JSON.parse(activeWrite[2]);
    expect(activePayload).toEqual(
      expect.objectContaining({
        status: 'ACCEPTED',
        state: 'ACCEPTED',
        driverId: 'driver-1',
        estimate: 77.67,
        pickup: expect.objectContaining({ add: 'Pickup' }),
        drop: expect.objectContaining({ add: 'Dropoff' })
      })
    );
    expect(active.status).toBe('ACCEPTED');
  });

  it('does not emit an active booking when the primary booking is missing', async () => {
    const redis = {
      hgetall: jest.fn().mockResolvedValue({}),
      hset: jest.fn(),
      type: jest.fn(),
      del: jest.fn()
    };

    await expect(
      ensureAcceptedRideCanonicalState(redis, {
        bookingId: 'missing',
        driverId: 'driver-1'
      })
    ).rejects.toThrow(/Booking not found/);
    expect(redis.hset).not.toHaveBeenCalled();
  });
});

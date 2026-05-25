const {
  writeVisibleBookingSnapshot,
  loadVisibleBookingSnapshot,
  rehydratePrimaryBooking
} = require('../../../services/booking-visibility-service');

describe('booking-visibility-service', () => {
  let hashes;
  let expirations;
  let redis;

  beforeEach(() => {
    hashes = new Map();
    expirations = [];
    redis = {
      hset: jest.fn(async (key, payload) => {
        const current = hashes.get(key) || {};
        hashes.set(key, { ...current, ...payload });
        return 1;
      }),
      hgetall: jest.fn(async (key) => hashes.get(key) || {}),
      expire: jest.fn(async (key, ttl) => {
        expirations.push({ key, ttl });
        return 1;
      })
    };
  });

  it('stores and reloads a visible booking snapshot', async () => {
    await writeVisibleBookingSnapshot(redis, 'booking_1', {
      state: 'PENDING',
      customerId: 'customer_1'
    });

    const snapshot = await loadVisibleBookingSnapshot(redis, 'booking_1');

    expect(snapshot).toEqual(
      expect.objectContaining({
        state: 'PENDING',
        customerId: 'customer_1',
        visibilityUpdatedAt: expect.any(String)
      })
    );
    expect(expirations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'booking_visible:booking_1' })
      ])
    );
  });

  it('rehydrates the primary booking hash when only the visible snapshot remains', async () => {
    hashes.set('booking_visible:booking_2', {
      bookingId: 'booking_2',
      state: 'ACCEPTED',
      driverId: 'driver_1'
    });

    const result = await rehydratePrimaryBooking(redis, 'booking_2', {
      rehydratedFor: 'accept_ride'
    });

    expect(result).toEqual(
      expect.objectContaining({
        bookingId: 'booking_2',
        state: 'ACCEPTED',
        driverId: 'driver_1',
        rehydratedFor: 'accept_ride',
        rehydratedFromVisibility: 'true'
      })
    );
    expect(hashes.get('booking:booking_2')).toEqual(
      expect.objectContaining({
        bookingId: 'booking_2',
        state: 'ACCEPTED',
        driverId: 'driver_1'
      })
    );
  });
});

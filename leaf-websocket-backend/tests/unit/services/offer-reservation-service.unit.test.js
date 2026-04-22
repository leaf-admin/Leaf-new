const {
  reserveOffer,
  loadOfferReservation,
  hasOfferReservation,
  clearOfferReservation,
  clearOfferReservationsForBooking
} = require('../../../services/offer-reservation-service');

describe('offer-reservation-service', () => {
  let strings;
  let sets;
  let expirations;
  let redis;

  beforeEach(() => {
    strings = new Map();
    sets = new Map();
    expirations = [];

    const ensureSet = (key) => {
      if (!sets.has(key)) {
        sets.set(key, new Set());
      }
      return sets.get(key);
    };

    redis = {
      set: jest.fn(async (key, value, _exKeyword, ttl) => {
        strings.set(key, value);
        expirations.push({ key, ttl });
        return 'OK';
      }),
      get: jest.fn(async (key) => strings.get(key) || null),
      exists: jest.fn(async (key) => (strings.has(key) ? 1 : 0)),
      sadd: jest.fn(async (key, value) => {
        ensureSet(key).add(value);
        return 1;
      }),
      srem: jest.fn(async (key, value) => {
        ensureSet(key).delete(value);
        return 1;
      }),
      smembers: jest.fn(async (key) => Array.from(ensureSet(key))),
      expire: jest.fn(async (key, ttl) => {
        expirations.push({ key, ttl });
        return 1;
      }),
      del: jest.fn(async (key) => {
        strings.delete(key);
        sets.delete(key);
        return 1;
      }),
      multi() {
        const operations = [];
        const multiApi = {
          set: (...args) => {
            operations.push(() => redis.set(...args));
            return multiApi;
          },
          sadd: (...args) => {
            operations.push(() => redis.sadd(...args));
            return multiApi;
          },
          expire: (...args) => {
            operations.push(() => redis.expire(...args));
            return multiApi;
          },
          del: (...args) => {
            operations.push(() => redis.del(...args));
            return multiApi;
          },
          srem: (...args) => {
            operations.push(() => redis.srem(...args));
            return multiApi;
          },
          exec: async () => {
            for (const op of operations) {
              await op();
            }
            return [];
          }
        };
        return multiApi;
      }
    };
  });

  it('stores and loads a reservation with ttl metadata', async () => {
    await reserveOffer(redis, 'booking_1', 'driver_1', {
      ttlSeconds: 9,
      metadata: { status: 'AWAITING_RESPONSE' }
    });

    const reservation = await loadOfferReservation(redis, 'booking_1', 'driver_1');

    expect(reservation).toEqual(
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        status: 'AWAITING_RESPONSE'
      })
    );
    expect(expirations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'offer_reservation:booking_1:driver_1', ttl: 9 }),
        expect.objectContaining({ key: 'offer_reservation_index:booking_1', ttl: 9 })
      ])
    );
  });

  it('can clear one reservation or all reservations for a booking', async () => {
    await reserveOffer(redis, 'booking_2', 'driver_1', { ttlSeconds: 10 });
    await reserveOffer(redis, 'booking_2', 'driver_2', { ttlSeconds: 10 });

    expect(await hasOfferReservation(redis, 'booking_2', 'driver_1')).toBe(true);
    expect(await hasOfferReservation(redis, 'booking_2', 'driver_2')).toBe(true);

    await clearOfferReservation(redis, 'booking_2', 'driver_1');
    expect(await hasOfferReservation(redis, 'booking_2', 'driver_1')).toBe(false);
    expect(await hasOfferReservation(redis, 'booking_2', 'driver_2')).toBe(true);

    await clearOfferReservationsForBooking(redis, 'booking_2');
    expect(await hasOfferReservation(redis, 'booking_2', 'driver_2')).toBe(false);
  });
});

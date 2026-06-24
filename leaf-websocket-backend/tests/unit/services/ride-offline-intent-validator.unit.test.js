const {
  RIDE_OFFLINE_INTENT_TYPES,
  hasRideOfflineIntentPayload,
  markRideOfflineIntentProcessed,
  normalizeEventType,
  validateAndReserveRideOfflineIntent,
} = require('../../../services/ride-offline-intent-validator');

const createRedis = ({ booking = {}, strings = {}, hashes = {} } = {}) => {
  const stringStore = new Map(Object.entries(strings));
  const hashStore = new Map(
    Object.entries({
      [`booking:${booking.bookingId || 'booking_1'}`]: booking,
      ...hashes,
    })
  );

  return {
    get: jest.fn(async (key) => stringStore.get(key) || null),
    set: jest.fn(async (key, value) => {
      stringStore.set(key, value);
      return 'OK';
    }),
    hgetall: jest.fn(async (key) => hashStore.get(key) || {}),
    hget: jest.fn(async (key, field) => {
      const value = hashStore.get(key);
      if (!value) return null;
      return value[field] || null;
    }),
    hset: jest.fn(async (key, value) => {
      const current = hashStore.get(key) || {};
      if (value && typeof value === 'object') {
        hashStore.set(key, { ...current, ...value });
        return Object.keys(value).length;
      }
      return 0;
    }),
    dumpStrings: () => Object.fromEntries(stringStore.entries()),
    dumpHashes: () => Object.fromEntries(hashStore.entries()),
  };
};

const baseIntent = (overrides = {}) => ({
  bookingId: 'booking_1',
  actorId: 'driver_1',
  role: 'driver',
  eventType: RIDE_OFFLINE_INTENT_TYPES.START_TRIP,
  idempotencyKey: 'offline_start_booking_1_driver_1',
  clientSequence: 1,
  clientCreatedAt: '2026-06-23T12:00:00.000Z',
  data: {
    offlineIntent: true,
  },
  ...overrides,
});

describe('ride-offline-intent-validator', () => {
  it('detects outbox-style payloads without treating every idempotent socket request as offline', () => {
    expect(hasRideOfflineIntentPayload({ idempotencyKey: 'regular_online_key' })).toBe(false);
    expect(hasRideOfflineIntentPayload({ clientSequence: 1 })).toBe(true);
    expect(hasRideOfflineIntentPayload({ source: 'ride_event_outbox' })).toBe(true);
  });

  it('normalizes mobile lifecycle aliases', () => {
    expect(normalizeEventType('started')).toBe(RIDE_OFFLINE_INTENT_TYPES.START_TRIP);
    expect(normalizeEventType('driver_arrived')).toBe(RIDE_OFFLINE_INTENT_TYPES.ARRIVED_AT_PICKUP);
    expect(normalizeEventType('cancelled')).toBe(RIDE_OFFLINE_INTENT_TYPES.CANCEL_RIDE);
  });

  it('accepts and reserves a driver start intent only from ARRIVED state', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ARRIVED',
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent(),
    });

    expect(result).toMatchObject({
      accepted: true,
      replay: false,
      currentState: 'ARRIVED',
    });
    expect(redis.set).toHaveBeenCalledWith(
      'ride_offline_intent:booking_1:offline_start_booking_1_driver_1',
      expect.any(String),
      'EX',
      expect.any(Number)
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'ride_offline_intent_sequence:booking_1:driver_1',
      expect.objectContaining({
        lastSequence: '1',
        lastIdempotencyKey: 'offline_start_booking_1_driver_1',
      })
    );
  });

  it('rejects a start intent while canonical booking is still ACCEPTED', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ACCEPTED',
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent(),
    });

    expect(result).toMatchObject({
      accepted: false,
      code: 'OFFLINE_INTENT_STATE_DENIED',
      currentState: 'ACCEPTED',
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects intents from users outside the ride scope', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ARRIVED',
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({ actorId: 'driver_2' }),
    });

    expect(result).toMatchObject({
      accepted: false,
      code: 'OFFLINE_INTENT_SCOPE_DENIED',
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects new intents against terminal bookings', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'COMPLETED',
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({
        eventType: RIDE_OFFLINE_INTENT_TYPES.COMPLETE_TRIP,
      }),
    });

    expect(result).toMatchObject({
      accepted: false,
      code: 'OFFLINE_INTENT_TERMINAL_RIDE',
      currentState: 'COMPLETED',
    });
  });

  it('rejects stale local sequence numbers for the same booking and actor', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'IN_PROGRESS',
      },
      hashes: {
        'ride_offline_intent_sequence:booking_1:driver_1': {
          lastSequence: '7',
        },
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({
        eventType: RIDE_OFFLINE_INTENT_TYPES.COMPLETE_TRIP,
        idempotencyKey: 'offline_complete_booking_1_driver_1',
        clientSequence: 6,
      }),
    });

    expect(result).toMatchObject({
      accepted: false,
      code: 'OFFLINE_INTENT_OUT_OF_ORDER',
      clientSequence: 6,
      lastSequence: 7,
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('rejects idempotency key reuse with a different fingerprint', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ARRIVED',
      },
    });

    await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({
        payload: { startLocation: { lat: -22.91, lng: -43.2 } },
      }),
    });

    const conflict = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({
        payload: { startLocation: { lat: -22.92, lng: -43.21 } },
      }),
    });

    expect(conflict).toMatchObject({
      accepted: false,
      code: 'OFFLINE_INTENT_IDEMPOTENCY_CONFLICT',
      idempotencyKey: 'offline_start_booking_1_driver_1',
    });
  });

  it('returns the processed canonical result for an exact replay', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ARRIVED',
      },
    });

    await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent(),
    });
    await markRideOfflineIntentProcessed({
      redis,
      bookingId: 'booking_1',
      idempotencyKey: 'offline_start_booking_1_driver_1',
      result: {
        success: true,
        bookingId: 'booking_1',
        status: 'IN_PROGRESS',
      },
    });

    const replay = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent(),
    });

    expect(replay).toMatchObject({
      accepted: true,
      replay: true,
      cachedResult: {
        success: true,
        bookingId: 'booking_1',
        status: 'IN_PROGRESS',
      },
    });
  });

  it('accepts passenger cancel intent before the trip starts', async () => {
    const redis = createRedis({
      booking: {
        bookingId: 'booking_1',
        customerId: 'customer_1',
        driverId: 'driver_1',
        status: 'ACCEPTED',
      },
    });

    const result = await validateAndReserveRideOfflineIntent({
      redis,
      ...baseIntent({
        actorId: 'customer_1',
        role: 'customer',
        eventType: RIDE_OFFLINE_INTENT_TYPES.CANCEL_RIDE,
        idempotencyKey: 'offline_cancel_booking_1_customer_1',
      }),
    });

    expect(result).toMatchObject({
      accepted: true,
      currentState: 'ACCEPTED',
      intent: expect.objectContaining({
        role: 'passenger',
      }),
    });
  });
});

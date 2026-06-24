const mockDocs = new Map();
const mockRedisState = {
  hashes: new Map(),
  strings: new Map()
};

function writeDoc(path, data, options = {}) {
  const previous = mockDocs.get(path) || {};
  mockDocs.set(path, options.merge ? { ...previous, ...data } : { ...data });
}

function createDocRef(path) {
  return {
    path,
    get: jest.fn(async () => ({
      exists: mockDocs.has(path),
      data: () => mockDocs.get(path)
    })),
    set: jest.fn(async (data, options) => writeDoc(path, data, options))
  };
}

function createFirestore() {
  return {
    collection: (collectionPath) => ({
      doc: (id) => createDocRef(`${collectionPath}/${id}`)
    })
  };
}

function createRedis() {
  return {
    hset: jest.fn(async (key, data) => {
      mockRedisState.hashes.set(key, {
        ...(mockRedisState.hashes.get(key) || {}),
        ...data
      });
      return 'OK';
    }),
    set: jest.fn(async (key, value) => {
      mockRedisState.strings.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key) => mockRedisState.strings.get(key) || null),
    hlen: jest.fn(async (key) => Object.keys(mockRedisState.hashes.get(key) || {}).length),
    hgetall: jest.fn(async (key) => mockRedisState.hashes.get(key) || {}),
    multi: jest.fn(() => {
      const ops = [];
      return {
        hset: (key, data) => {
          ops.push(['hset', key, data]);
          return this;
        },
        set: (key, value) => {
          ops.push(['set', key, value]);
          return this;
        },
        exec: jest.fn(async () => {
          for (const [op, key, value] of ops) {
            if (op === 'hset') {
              mockRedisState.hashes.set(key, {
                ...(mockRedisState.hashes.get(key) || {}),
                ...value
              });
            } else if (op === 'set') {
              mockRedisState.strings.set(key, value);
            }
          }
          return [];
        })
      };
    })
  };
}

const mockRedis = createRedis();
const mockFirestore = createFirestore();

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(async () => undefined),
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => mockFirestore)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__')
    }
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

jest.mock('../../../services/gradual-radius-expander', () => jest.fn());

const {
  materializePaymentForBooking,
  triggerDispatchAfterPayment
} = require('../../../services/payment-dispatch-service');

describe('payment-dispatch-service', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockRedisState.hashes.clear();
    mockRedisState.strings.clear();
  });

  it('materializes a confirmed temp ride payment onto the canonical booking id', async () => {
    writeDoc('payment_holdings/temp_ride_1', {
      status: 'in_holding',
      amount: 5407,
      chargeId: 'charge_1',
      paymentId: 'charge_1',
      passengerId: 'passenger_1',
      paymentMethod: 'pix',
      paidAt: '2026-06-17T16:00:00.000Z',
      confirmedAt: '2026-06-17T16:00:01.000Z'
    });
    writeDoc('ride_payments/temp_ride_1', {
      status: 'CONFIRMED',
      amount: 5407,
      chargeId: 'charge_1',
      passengerId: 'passenger_1',
      credited: false
    });

    const result = await materializePaymentForBooking({
      bookingId: 'booking_1',
      chargeId: 'charge_1',
      temporaryRideId: 'temp_ride_1',
      passengerId: 'passenger_1',
      source: 'unit_test'
    });

    expect(result).toMatchObject({
      success: true,
      bookingId: 'booking_1',
      temporaryRideId: 'temp_ride_1',
      chargeId: 'charge_1',
      amountInCents: 5407
    });

    expect(mockDocs.get('payment_holdings/booking_1')).toMatchObject({
      rideId: 'booking_1',
      canonicalRideId: 'booking_1',
      bookingId: 'booking_1',
      temporaryRideId: 'temp_ride_1',
      paymentReferenceRideId: 'temp_ride_1',
      chargeId: 'charge_1',
      amount: 5407,
      status: 'in_holding',
      passengerId: 'passenger_1',
      materializedFrom: 'temp_ride_1'
    });
    expect(mockDocs.get('ride_payments/booking_1')).toMatchObject({
      rideId: 'booking_1',
      canonicalRideId: 'booking_1',
      bookingId: 'booking_1',
      temporaryRideId: 'temp_ride_1',
      chargeId: 'charge_1',
      amount: 5407,
      status: 'CONFIRMED',
      passengerId: 'passenger_1'
    });
    expect(mockRedisState.hashes.get('booking:booking_1')).toMatchObject({
      paymentStatus: 'in_holding',
      paymentChargeId: 'charge_1',
      paymentAmountInCents: '5407',
      paymentReferenceRideId: 'temp_ride_1',
      paymentUpdatedBy: 'unit_test'
    });
    expect(mockRedisState.strings.get('payment_charge_booking:charge_1')).toBe('booking_1');
    expect(mockRedisState.strings.get('payment_temp_ride_booking:temp_ride_1')).toBe('booking_1');
    expect(mockRedisState.strings.has('payment_status_cache:booking_1')).toBe(true);
  });

  it('does not dispatch a booking whose payment ledger is pending', async () => {
    mockRedisState.hashes.set('booking:booking_ledger_pending', {
      bookingId: 'booking_ledger_pending',
      customerId: 'passenger_1',
      paymentStatus: 'ledger_pending',
      paymentLedgerStatus: 'pending_retry',
      pickupLocation: JSON.stringify({ lat: -22.853586, lng: -43.318168 })
    });

    const result = await triggerDispatchAfterPayment({
      bookingId: 'booking_ledger_pending',
      io: {},
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      source: 'unit_test',
      force: true,
      maxAttempts: 1
    });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: 'PAYMENT_LEDGER_PENDING',
      paymentStatus: 'ledger_pending',
      paymentLedgerStatus: 'pending_retry'
    });
  });

  it('does not dispatch a paid booking when the payment driver reservation is missing', async () => {
    mockRedisState.hashes.set('booking:booking_missing_reservation', {
      bookingId: 'booking_missing_reservation',
      customerId: 'passenger_1',
      paymentStatus: 'in_holding',
      paymentLedgerStatus: 'posted',
      paymentDriverReservationId: 'pdr_missing',
      paymentReferenceRideId: 'temp_ride_1',
      paymentSessionId: 'pay_session_1',
      paymentQuoteLockId: 'ql_1',
      pickupLocation: JSON.stringify({ lat: -22.853586, lng: -43.318168 })
    });

    const result = await triggerDispatchAfterPayment({
      bookingId: 'booking_missing_reservation',
      io: {},
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      source: 'unit_test',
      force: true,
      maxAttempts: 1
    });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      reason: 'PAYMENT_DRIVER_RESERVATION_MISSING',
      paymentDriverReservationId: 'pdr_missing'
    });
    expect(mockRedisState.hashes.get('booking:booking_missing_reservation')).toMatchObject({
      paymentDispatchBlockedReason: 'PAYMENT_DRIVER_RESERVATION_MISSING'
    });
  });
});

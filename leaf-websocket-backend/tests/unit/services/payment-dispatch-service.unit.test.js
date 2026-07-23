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
    hget: jest.fn(async (key, field) => mockRedisState.hashes.get(key)?.[field] || null),
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

const GradualRadiusExpander = require('../../../services/gradual-radius-expander');
const {
  materializePaymentForBooking,
  markBookingPaymentConfirmed,
  triggerDispatchAfterPayment
} = require('../../../services/payment-dispatch-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

describe('payment-dispatch-service', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockRedisState.hashes.clear();
    mockRedisState.strings.clear();
    GradualRadiusExpander.mockClear();
    GradualRadiusExpander.mockImplementation(() => ({
      startGradualSearch: jest.fn(async () => undefined)
    }));
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

  it('materializes sandbox payment only inside sandbox financial collections', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    writeDoc('sandbox_payment_holdings/temp_ride_sandbox', {
      status: 'in_holding',
      amount: 5407,
      chargeId: 'charge_sandbox',
      paymentId: 'charge_sandbox',
      passengerId: 'passenger_sandbox',
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId
    });
    writeDoc('sandbox_ride_payments/temp_ride_sandbox', {
      status: 'CONFIRMED',
      amount: 5407,
      chargeId: 'charge_sandbox',
      passengerId: 'passenger_sandbox',
      credited: false,
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId
    });

    const result = await materializePaymentForBooking({
      bookingId: 'booking_sandbox',
      chargeId: 'charge_sandbox',
      temporaryRideId: 'temp_ride_sandbox',
      passengerId: 'passenger_sandbox',
      source: 'unit_test',
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    });

    expect(result).toMatchObject({
      success: true,
      bookingId: 'booking_sandbox',
      amountInCents: 5407,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(mockDocs.get('sandbox_payment_holdings/booking_sandbox')).toMatchObject({
      rideId: 'booking_sandbox',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(mockDocs.get('sandbox_ride_payments/booking_sandbox')).toMatchObject({
      rideId: 'booking_sandbox',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(mockDocs.get('sandbox_payment_holdings/temp_ride_sandbox')).toMatchObject({
      canonicalRideId: 'booking_sandbox',
      bookingId: 'booking_sandbox',
      temporaryRideId: 'temp_ride_sandbox',
      paymentReferenceRideId: 'temp_ride_sandbox',
      status: 'in_holding'
    });
    expect(mockDocs.get('sandbox_ride_payments/temp_ride_sandbox')).toMatchObject({
      canonicalRideId: 'booking_sandbox',
      bookingId: 'booking_sandbox',
      temporaryRideId: 'temp_ride_sandbox',
      paymentReferenceRideId: 'temp_ride_sandbox',
      status: 'CONFIRMED'
    });
    expect(Array.from(mockDocs.keys()).filter((path) => (
      path.startsWith('sandbox_payment_holdings/') ||
      path.startsWith('sandbox_ride_payments/')
    ))).toHaveLength(4);
    expect(mockDocs.has('payment_holdings/booking_sandbox')).toBe(false);
    expect(mockDocs.has('ride_payments/booking_sandbox')).toBe(false);
    expect(mockRedisState.hashes.get('booking:booking_sandbox')).toMatchObject({
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: 'true'
    });
  });

  it('marks a sandbox booking with its sealed context and rejects a lost sandbox seal', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    await markBookingPaymentConfirmed({
      bookingId: 'booking_sandbox_mark',
      chargeId: 'charge_sandbox_mark',
      amountInCents: 5511,
      source: 'unit_test',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    });

    expect(mockRedisState.hashes.get('booking:booking_sandbox_mark')).toMatchObject({
      paymentChargeId: 'charge_sandbox_mark',
      paymentAmountInCents: '5511',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: 'true'
    });
    expect(JSON.parse(
      mockRedisState.hashes.get('booking:booking_sandbox_mark').financialContext
    )).toEqual(financialContext);

    await expect(markBookingPaymentConfirmed({
      bookingId: 'booking_sandbox_lost',
      chargeId: 'charge_sandbox_lost',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    })).rejects.toMatchObject({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });
    expect(mockRedisState.hashes.has('booking:booking_sandbox_lost')).toBe(false);
  });

  it('fails closed before materialization when a sandbox signal lost its sealed context', async () => {
    await expect(materializePaymentForBooking({
      bookingId: 'booking_sandbox_context_lost',
      chargeId: 'charge_sandbox_context_lost',
      temporaryRideId: 'temp_ride_sandbox_context_lost',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox',
      source: 'unit_test'
    })).rejects.toMatchObject({
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });

    expect(Array.from(mockDocs.keys()).some((path) => (
      path.endsWith('/booking_sandbox_context_lost')
    ))).toBe(false);
    expect(mockRedisState.hashes.has('booking:booking_sandbox_context_lost')).toBe(false);
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

  it('rejects an operational poison booking before sandbox dispatch', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const startGradualSearch = jest.fn(async () => undefined);
    GradualRadiusExpander.mockImplementation(() => ({ startGradualSearch }));
    mockRedisState.hashes.set('booking:booking_sandbox_dispatch_poison', {
      bookingId: 'booking_sandbox_dispatch_poison',
      customerId: 'operational_passenger_poison',
      paymentStatus: 'in_holding',
      paymentLedgerStatus: 'posted',
      pickupLocation: JSON.stringify({ lat: -22.853586, lng: -43.318168 })
    });

    await expect(triggerDispatchAfterPayment({
      bookingId: 'booking_sandbox_dispatch_poison',
      io: {},
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      source: 'unit_test',
      force: true,
      maxAttempts: 1,
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    })).rejects.toMatchObject({
      code: 'SANDBOX_RECORD_CONTEXT_INVALID'
    });
    expect(startGradualSearch).not.toHaveBeenCalled();
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

  it('does not trigger a second driver search when payment dispatch is already active', async () => {
    const startGradualSearch = jest.fn(async () => undefined);
    GradualRadiusExpander.mockImplementation(() => ({ startGradualSearch }));
    mockRedisState.hashes.set('booking:booking_dispatch_once', {
      bookingId: 'booking_dispatch_once',
      customerId: 'passenger_1',
      state: 'PENDING',
      paymentStatus: 'in_holding',
      paymentLedgerStatus: 'posted',
      pickupLocation: JSON.stringify({ lat: -22.853586, lng: -43.318168 })
    });

    const first = await triggerDispatchAfterPayment({
      bookingId: 'booking_dispatch_once',
      io: {},
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      source: 'unit_test',
      force: false,
      maxAttempts: 1
    });

    mockRedisState.hashes.set('booking_search:booking_dispatch_once', {
      state: 'SEARCHING'
    });

    const second = await triggerDispatchAfterPayment({
      bookingId: 'booking_dispatch_once',
      io: {},
      pickupLocation: { lat: -22.853586, lng: -43.318168 },
      source: 'unit_test_replay',
      force: false,
      maxAttempts: 1
    });

    expect(first).toMatchObject({
      success: true,
      skipped: false,
      bookingId: 'booking_dispatch_once'
    });
    expect(second).toMatchObject({
      success: true,
      skipped: true,
      reason: 'SEARCH_ALREADY_ACTIVE'
    });
    expect(startGradualSearch).toHaveBeenCalledTimes(1);
  });
});

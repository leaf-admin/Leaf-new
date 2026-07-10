const mockCacheStore = new Map();
const mockCreateCharge = jest.fn();
const mockCreateChargeWithSplit = jest.fn();
const mockTransferDirectToDriver = jest.fn();
const mockProcessRefund = jest.fn();

jest.mock('../../../services/woovi-driver-service', () =>
  jest.fn().mockImplementation(() => ({
    getChargeStatus: jest.fn().mockResolvedValue({
      success: false,
      error: 'not found'
    }),
    createCharge: mockCreateCharge,
    createChargeWithSplit: mockCreateChargeWithSplit,
    transferDirectToDriver: mockTransferDirectToDriver,
    processRefund: mockProcessRefund
  }))
);

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__'),
      increment: jest.fn((value) => ({ __increment: value }))
    }
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({
    set: jest.fn(async (key, value) => {
      mockCacheStore.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key) => mockCacheStore.get(key) || null),
    hgetall: jest.fn(async () => ({}))
  }))
}));

jest.mock('../../../services/subscription-state-service', () => ({
  getBillingData: jest.fn().mockResolvedValue({
    pendingFeeCents: 0,
    dailyFeeCents: 990,
    subscriptionStatus: 'active',
    billingStatus: 'active',
    collectionMode: 'withdrawal'
  }),
  settlePendingOnWithdrawal: jest.fn().mockResolvedValue({
    success: true,
    settledCents: 0,
    remainingCents: 0
  })
}));

const PaymentService = require('../../../services/payment-service');
const firebaseConfig = require('../../../firebase-config');
const subscriptionStateService = require('../../../services/subscription-state-service');

const createInMemoryFirestore = () => {
  const docs = new Map();

  const writeDoc = (ref, data, options = {}) => {
    const previous = docs.get(ref.path) || {};
    docs.set(ref.path, options.merge ? { ...previous, ...data } : { ...data });
  };

  const collection = (path) => ({
    doc: (id = `auto_${docs.size + 1}`) => doc(`${path}/${id}`),
    where: (field, _operator, value) => ({
      limit: (limitCount = 1) => ({
        get: async () => {
          const matches = [];
          for (const [docPath, data] of docs.entries()) {
            if (!docPath.startsWith(`${path}/`)) continue;
            if (data?.[field] !== value) continue;
            matches.push({
              id: docPath.split('/').pop(),
              data: () => data
            });
            if (matches.length >= limitCount) break;
          }
          return {
            empty: matches.length === 0,
            docs: matches
          };
        }
      })
    })
  });

  const doc = (path) => ({
    path,
    collection: (name) => collection(`${path}/${name}`),
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data, options) => writeDoc({ path }, data, options),
    update: async (data) => writeDoc({ path }, data, { merge: true })
  });

  return {
    docs,
    collection,
    runTransaction: async (handler) => {
      const pendingWrites = [];
      const transaction = {
        get: async (ref) => ({
          exists: docs.has(ref.path),
          data: () => docs.get(ref.path)
        }),
        set: (ref, data, options) => {
          pendingWrites.push([ref, data, options]);
        }
      };

      const result = await handler(transaction);
      pendingWrites.forEach(([ref, data, options]) => writeDoc(ref, data, options));
      return result;
    }
  };
};

describe('PaymentService payment status cache', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_API_TOKEN = 'unit-test-production-token';
    mockCacheStore.clear();
    mockCreateCharge.mockReset();
    mockCreateChargeWithSplit.mockReset();
    mockTransferDirectToDriver.mockReset();
    mockProcessRefund.mockReset();
    mockCreateCharge.mockResolvedValue({
      success: true,
      charge: {
        id: 'charge_default',
        qrCodeImage: 'qr',
        paymentLinkUrl: 'https://pay.local/default'
      }
    });
    mockCreateChargeWithSplit.mockResolvedValue({
      success: true,
      charge: {
        id: 'charge_split',
        qrCodeImage: 'qr_split',
        paymentLinkUrl: 'https://pay.local/split'
      }
    });
    mockTransferDirectToDriver.mockResolvedValue({
      success: true,
      transferId: 'transfer_1'
    });
    firebaseConfig.getFirestore.mockReturnValue(null);
    subscriptionStateService.getBillingData.mockResolvedValue({
      pendingFeeCents: 0,
      dailyFeeCents: 990,
      subscriptionStatus: 'active',
      billingStatus: 'active',
      collectionMode: 'withdrawal'
    });
    subscriptionStateService.settlePendingOnWithdrawal.mockResolvedValue({
      success: true,
      settledCents: 0,
      remainingCents: 0
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('keeps ride-completion Pix Out disabled unless the legacy opt-in flag is explicit', () => {
    process.env.WOOVI_DIRECT_TRANSFER_ON_RIDE_COMPLETION = 'true';
    delete process.env.ENABLE_LEGACY_RIDE_COMPLETION_PIXOUT;

    expect(new PaymentService().isWooviDirectTransferOnRideCompletionEnabled()).toBe(false);

    process.env.ENABLE_LEGACY_RIDE_COMPLETION_PIXOUT = 'true';
    expect(new PaymentService().isWooviDirectTransferOnRideCompletionEnabled()).toBe(true);
  });

  it('charges the Woovi withdrawal fee only below R$ 500,00', () => {
    const service = new PaymentService();

    expect(service.calculateWithdrawFee(0)).toBe(0);
    expect(service.calculateWithdrawFee(49999)).toBe(100);
    expect(service.calculateWithdrawFee(50000)).toBe(0);
    expect(service.calculateWithdrawFee(100000)).toBe(0);
  });

  it('reads confirmed payment status from redis cache before falling back to external providers', async () => {
    const service = new PaymentService();

    await service.writePaymentStatusCache('charge_123', {
      status: 'in_holding',
      amount: 1342,
      paidAt: '2026-04-01T23:00:00.000Z'
    });

    const result = await service.getPaymentStatus('charge_123');

    expect(result).toMatchObject({
      success: true,
      status: 'in_holding',
      amount: 1342,
      source: 'payment_status_cache'
    });
  });

  it('writes cache entries for rideId and chargeId when saving payment holding', async () => {
    const service = new PaymentService();

    const result = await service.savePaymentHolding('temp_ride_123', {
      status: 'in_holding',
      amount: 1342,
      paymentId: 'charge_abc',
      chargeId: 'charge_abc',
      paidAt: '2026-04-01T23:00:00.000Z',
      confirmedAt: '2026-04-01T23:00:00.000Z'
    });

    expect(result.success).toBe(false);
    expect(mockCacheStore.has('payment_status_cache:temp_ride_123')).toBe(true);
    expect(mockCacheStore.has('payment_status_cache:charge_abc')).toBe(true);
  });

  it('marks confirmed payment as ledger_pending when payment_received ledger fails', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    service.financialLedgerService.recordPaymentReceived = jest.fn().mockResolvedValue({
      success: false,
      code: 'LEDGER_WRITE_FAILED',
      error: 'ledger unavailable'
    });

    const result = await service.storeConfirmedPayment({
      rideId: 'booking_payment_ledger_pending',
      chargeId: 'charge_ledger_pending',
      amount: 2750,
      passengerId: 'passenger_ledger'
    });

    expect(result).toMatchObject({
      success: true,
      ledgerPosted: false,
      ledgerStatus: 'pending_retry',
      ledgerError: 'ledger unavailable'
    });
    expect(firestore.docs.get('ride_payments/booking_payment_ledger_pending')).toMatchObject({
      status: 'LEDGER_PENDING',
      ledgerStatus: 'pending_retry',
      ledgerRetryable: true,
      ledgerError: 'ledger unavailable'
    });
    expect(firestore.docs.get('bookings/booking_payment_ledger_pending')).toMatchObject({
      paymentStatus: 'ledger_pending',
      paymentLedgerStatus: 'pending_retry',
      paymentDispatchBlockedReason: 'PAYMENT_LEDGER_PENDING'
    });
  });

  it('creates a regular Woovi charge when driver split target is not known yet', async () => {
    const service = new PaymentService();

    const result = await service.processAdvancePayment({
      passengerId: 'passenger_1',
      amount: 1506,
      rideId: 'temp_ride_1',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: true,
      chargeId: 'charge_default',
      splitApplied: false
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
    expect(mockCreateChargeWithSplit).not.toHaveBeenCalled();
    expect(mockCreateCharge.mock.calls[0][0].additionalInfo).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '' })
      ])
    );
  });

  it('blocks a production payment profile before provider calls in ride flow validation', async () => {
    process.env.LEAF_LAUNCH_PROFILE = 'ride_flow_validation';
    const service = new PaymentService();
    jest.spyOn(service.paymentRuntimeProfileService, 'resolveProfile').mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      scope: 'global',
      source: 'env',
      testUserSandbox: false,
      provider: 'woovi',
      wooviConfig: {
        apiToken: 'must-not-be-used',
        environment: 'production',
        baseUrl: 'https://api.woovi.com/api/v1'
      }
    });

    const result = await service.processAdvancePayment({
      passengerId: 'passenger_1',
      amount: 1506,
      rideId: 'temp_ride_validation_production_blocked',
      rideDetails: { origin: 'Origem', destination: 'Destino' },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'RIDE_FLOW_VALIDATION_SANDBOX_PROFILE_REQUIRED',
      providerEnvironment: 'production',
      paymentProfileId: 'env-default'
    });
    expect(mockCreateCharge).not.toHaveBeenCalled();
    expect(mockCreateChargeWithSplit).not.toHaveBeenCalled();
  });

  it('routes allowlisted canary passengers through the sandbox Woovi profile without a mobile rebuild', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_API_TOKEN = 'production-token';
    process.env.WOOVI_SANDBOX_API_TOKEN = 'sandbox-token';
    process.env.PAYMENT_SANDBOX_USER_IDS = 'passenger_sandbox';
    process.env.PAYMENT_SANDBOX_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const service = new PaymentService();
    const result = await service.processAdvancePayment({
      passengerId: 'passenger_sandbox',
      amount: 1900,
      rideId: 'temp_ride_sandbox',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: true,
      chargeId: 'charge_default',
      providerEnvironment: 'sandbox',
      paymentProfileId: 'env-sandbox-allowlist'
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
    expect(mockCreateCharge.mock.calls[0][0].wooviConfig).toMatchObject({
      environment: 'sandbox',
      apiToken: 'sandbox-token'
    });
  });

  it('reuses the same advance payment intent on Pix charge retries', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockCreateCharge.mockResolvedValueOnce({
      success: true,
      charge: {
        id: 'charge_retry_1',
        qrCodeImage: 'qr_retry',
        paymentLinkUrl: 'https://pay.local/retry'
      }
    });
    const service = new PaymentService();
    const paymentData = {
      passengerId: 'passenger_retry',
      amount: 2210,
      rideId: 'ride_retry_1',
      quoteVersion: 'quote_v7',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    };

    const first = await service.processAdvancePayment(paymentData);
    const second = await service.processAdvancePayment(paymentData);

    expect(first).toMatchObject({
      success: true,
      chargeId: 'charge_retry_1',
      paymentIntentId: service.buildAdvancePaymentIntentId('ride_retry_1')
    });
    expect(second).toMatchObject({
      success: true,
      idempotentReplay: true,
      chargeId: 'charge_retry_1',
      paymentIntentId: service.buildAdvancePaymentIntentId('ride_retry_1'),
      passengerName: 'Passageiro',
      customerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
    expect(mockCreateCharge.mock.calls[0][0]).toMatchObject({
      value: 2210,
      correlationID: service.buildAdvanceChargeCorrelationID(paymentData)
    });
    expect(firestore.docs.get(`payment_intents/${service.buildAdvancePaymentIntentId('ride_retry_1')}`)).toMatchObject({
      status: 'charge_created',
      chargeId: 'charge_retry_1',
      amountCents: 2210,
      passengerName: 'Passageiro',
      customerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });
  });

  it('persists driver reservation metadata and clamps the Pix charge expiration to the provider minimum', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockCreateCharge.mockResolvedValueOnce({
      success: true,
      charge: {
        id: 'charge_reserved_1',
        qrCodeImage: 'qr_reserved',
        paymentLinkUrl: 'https://pay.local/reserved'
      }
    });
    const service = new PaymentService();

    const result = await service.processAdvancePayment({
      passengerId: 'passenger_reserved',
      amount: 2750,
      rideId: 'ride_reserved_1',
      paymentDriverReservationId: 'pdr_reserved_1',
      paymentDriverReservationDriverId: 'driver_reserved_1',
      paymentDriverReservationExpiresAt: '2026-06-24T20:00:00.000Z',
      paymentDriverReservationTtlSeconds: 180,
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: true,
      chargeId: 'charge_reserved_1',
      paymentDriverReservationId: 'pdr_reserved_1',
      paymentDriverReservationDriverId: 'driver_reserved_1',
      paymentDriverReservationExpiresAt: '2026-06-24T20:00:00.000Z',
      paymentDriverReservationTtlSeconds: 180
    });
    expect(mockCreateCharge).toHaveBeenCalledWith(expect.objectContaining({
      expiresIn: 300,
      additionalInfo: expect.arrayContaining([
        expect.objectContaining({
          key: 'payment_driver_reservation_id',
          value: 'pdr_reserved_1'
        }),
        expect.objectContaining({
          key: 'payment_driver_reservation_driver_id',
          value: 'driver_reserved_1'
        })
      ])
    }));
    expect(firestore.docs.get(`payment_intents/${service.buildAdvancePaymentIntentId('ride_reserved_1')}`)).toMatchObject({
      paymentDriverReservationId: 'pdr_reserved_1',
      paymentDriverReservationDriverId: 'driver_reserved_1',
      paymentDriverReservationExpiresAt: '2026-06-24T20:00:00.000Z',
      paymentDriverReservationTtlSeconds: 180
    });
  });

  it('derives one canonical ride reference from a persisted payment session', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    const paymentData = {
      passengerId: 'passenger_session',
      amount: 7690,
      rideId: 'client_temp_1',
      paymentSessionId: 'pay_session_20260620_abcdef',
      paymentContextKey: 'route-a|leaf-plus|7690',
      quoteSessionId: 'quote_session_1',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      }
    };

    const first = await service.processAdvancePayment(paymentData);
    const second = await service.processAdvancePayment({
      ...paymentData,
      rideId: 'client_temp_2'
    });
    const canonicalRideId = service.resolveAdvancePaymentSession(paymentData).rideId;

    expect(first).toMatchObject({
      success: true,
      rideId: canonicalRideId,
      paymentSessionId: paymentData.paymentSessionId,
      paymentContextKey: paymentData.paymentContextKey
    });
    expect(second).toMatchObject({
      success: true,
      idempotentReplay: true,
      rideId: canonicalRideId,
      chargeId: 'charge_default'
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
  });

  it('rejects a payment session after it has been linked to a booking', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    const paymentData = {
      passengerId: 'passenger_consumed',
      amount: 7690,
      paymentSessionId: 'pay_session_consumed_abcdef',
      paymentContextKey: 'route-b|leaf-plus|7690',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      }
    };

    const first = await service.processAdvancePayment(paymentData);
    const consumed = await service.markAdvancePaymentIntentConsumed({
      rideId: first.rideId,
      bookingId: 'booking_consumed_1',
      chargeId: first.chargeId
    });
    const replay = await service.processAdvancePayment(paymentData);

    expect(consumed).toBe(true);
    expect(replay).toMatchObject({
      success: false,
      code: 'PAYMENT_SESSION_CONSUMED',
      bookingId: 'booking_consumed_1',
      chargeId: first.chargeId
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
  });

  it('rejects advance payment retries with changed financial parameters', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    const paymentData = {
      passengerId: 'passenger_conflict',
      amount: 1506,
      rideId: 'ride_conflict_1',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    };

    const first = await service.processAdvancePayment(paymentData);
    const conflict = await service.processAdvancePayment({
      ...paymentData,
      amount: 1800
    });

    expect(first.success).toBe(true);
    expect(conflict).toMatchObject({
      success: false,
      code: 'PAYMENT_INTENT_CONFLICT'
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
  });

  it('fails closed in production when the payment intent cannot be persisted', async () => {
    process.env.NODE_ENV = 'production';
    firebaseConfig.getFirestore.mockReturnValue(null);
    const service = new PaymentService();

    const result = await service.processAdvancePayment({
      passengerId: 'passenger_safe',
      amount: 1506,
      rideId: 'ride_safe_1',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'PAYMENT_INTENT_STORE_UNAVAILABLE'
    });
    expect(mockCreateCharge).not.toHaveBeenCalled();
  });

  it('defers driver settlement even when driver pix key is provided on advance payment', async () => {
    const service = new PaymentService();

    const result = await service.processAdvancePayment({
      passengerId: 'passenger_1',
      amount: 1506,
      rideId: 'temp_ride_2',
      driverId: 'driver_1',
      driverPixKey: 'driver-pix-key',
      rideDetails: {
        origin: 'Origem',
        destination: 'Destino'
      },
      passengerName: 'Passageiro',
      passengerEmail: 'passenger@leaf.app.br'
    });

    expect(result).toMatchObject({
      success: true,
      chargeId: 'charge_default',
      splitApplied: false,
      splitDeferred: true,
      settlementPolicy: 'post_ride_ledger',
      splitTarget: null,
      splitCalculation: null
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
    expect(mockCreateChargeWithSplit).not.toHaveBeenCalled();
    const chargePayload = mockCreateCharge.mock.calls[0][0];
    expect(chargePayload.splits).toBeUndefined();
    expect(chargePayload.additionalInfo).toEqual(
      expect.arrayContaining([
        { key: 'settlement_model', value: 'post_ride_ledger' },
        { key: 'driver_settlement', value: 'deferred_until_ride_completed' }
      ])
    );
  });
});

describe('PaymentService financial rules', () => {
  beforeEach(() => {
    firebaseConfig.getFirestore.mockReturnValue(null);
    subscriptionStateService.getBillingData.mockResolvedValue({
      pendingFeeCents: 0,
      dailyFeeCents: 990,
      subscriptionStatus: 'active',
      billingStatus: 'active',
      collectionMode: 'withdrawal'
    });
    subscriptionStateService.settlePendingOnWithdrawal.mockClear();
    subscriptionStateService.settlePendingOnWithdrawal.mockResolvedValue({
      success: true,
      settledCents: 0,
      remainingCents: 0
    });
  });

  it.each([
    [8.5, 0.79, 0.5, 'up_to_10'],
    [10, 0.79, 0.5, 'up_to_10'],
    [10.01, 0.99, 0.5, '10_to_25'],
    [25, 0.99, 0.5, '10_to_25'],
    [25.01, 1.49, 0.5, '25_to_50'],
    [50, 1.49, 0.5, '25_to_50'],
    [75, 2.25, 0.6, 'above_50_percent']
  ])(
    'applies operational and Woovi fees for R$ %s',
    (fare, expectedOperationalFee, expectedWooviFee, expectedType) => {
      const service = new PaymentService();
      const breakdown = service.calculateFareBreakdownFromReais(fare, 0);

      expect(breakdown.operationalFee).toBeCloseTo(expectedOperationalFee, 2);
      expect(breakdown.paymentIntermediationFee).toBeCloseTo(expectedWooviFee, 2);
      expect(breakdown.totalFees).toBeCloseTo(expectedOperationalFee + expectedWooviFee, 2);
      expect(breakdown.driverNetAmount).toBeCloseTo(fare - expectedOperationalFee - expectedWooviFee, 2);
      expect(breakdown.calculation.breakdown.operationalFeeType).toBe(expectedType);
    }
  );

  it('keeps toll as driver pass-through in the canonical financial contract', () => {
    const service = new PaymentService();
    const calculation = service.calculateNetAmount(3250, 750);

    expect(calculation).toMatchObject({
      totalAmount: 3250,
      tollFee: 750,
      operationalFee: 99,
      wooviFee: 50,
      netAmount: 3101
    });
    expect(calculation.financialContract).toMatchObject({
      passengerPaidCents: 3250,
      grossFareCents: 2500,
      driverTollPassThroughCents: 750,
      allocatedTotalCents: 3250,
      balanced: true
    });
  });

  it('prefers quote lock toll values when resolving Pix split tolls', () => {
    const service = new PaymentService();

    expect(service.resolveTollFeeCents({
      tollFee: 0,
      tollFeeCents: 0,
      rideDetails: { tollFee: 0 },
      quoteLockSnapshot: {
        quoteLockId: 'ql_with_toll',
        tollFee: 4
      }
    })).toBe(400);
  });

  it('does not generate unbalanced fees for anomalous tiny fares', () => {
    const service = new PaymentService();
    const calculation = service.calculateNetAmount(80, 0);

    expect(calculation).toMatchObject({
      totalAmount: 80,
      operationalFee: 79,
      wooviFee: 1,
      netAmount: 0
    });
    expect(calculation.financialContract.balanced).toBe(true);
  });

  it('keeps daily subscription billing suspended by default', () => {
    const service = new PaymentService();

    expect(service.SUBSCRIPTION_DAILY_BILLING_ENABLED).toBe(false);
    expect(service.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS).toBe(1490);
  });

  it('returns nominal daily fee but zero effective fee while daily billing is suspended', async () => {
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_balances/driver_1', {
      driverId: 'driver_1',
      balance: 42,
      totalEarnings: 100
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    subscriptionStateService.getBillingData.mockResolvedValue({
      pendingFeeCents: 990,
      dailyFeeCents: 990,
      subscriptionStatus: 'grace_period',
      billingStatus: 'overdue',
      collectionMode: 'withdrawal',
      waveId: 'wave_1'
    });

    const service = new PaymentService();
    const result = await service.getDriverBalance('driver_1');

    expect(result).toMatchObject({
      success: true,
      balanceCents: 4200,
      subscriptionPendingFeeCents: 0,
      subscriptionPendingFeeRawCents: 990,
      subscriptionDailyFeeCents: 0,
      subscriptionDailyFeeNominalCents: 1490,
      subscriptionDailyFeeEffectiveCents: 0,
      subscriptionDailyFeeSuspended: true,
      subscriptionDailyBillingEnabled: false,
      availableAfterSubscriptionCents: 4200
    });
  });

  it('does not settle suspended daily subscription fees during withdrawal', async () => {
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_balances/driver_1', {
      driverId: 'driver_1',
      balance: 42,
      totalEarnings: 100
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    subscriptionStateService.getBillingData.mockResolvedValue({
      pendingFeeCents: 990,
      dailyFeeCents: 990,
      subscriptionStatus: 'grace_period',
      billingStatus: 'overdue',
      collectionMode: 'withdrawal'
    });
    const service = new PaymentService();

    const result = await service.requestDriverWithdrawal({
      driverId: 'driver_1',
      amountCents: 2500,
      pixKey: 'driver@pix.test',
      requestId: 'withdraw_request_1'
    });

    expect(result).toMatchObject({
      success: true,
      amountCents: 2500,
      withdrawFeeCents: 100,
      subscriptionSettlementCents: 0,
      totalDebitCents: 2600,
      newBalance: 16
    });
    expect(subscriptionStateService.settlePendingOnWithdrawal).not.toHaveBeenCalled();
  });

  it('uses balanceCents as the canonical available balance during withdrawals', async () => {
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_balances/driver_cents', {
      driverId: 'driver_cents',
      balance: 0,
      balanceCents: 4200,
      totalEarnings: 0,
      totalEarningsCents: 10000
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const balance = await service.getDriverBalance('driver_cents');
    const result = await service.requestDriverWithdrawal({
      driverId: 'driver_cents',
      amountCents: 3000,
      pixKey: 'driver@pix.test',
      requestId: 'withdraw_request_cents'
    });

    expect(balance).toMatchObject({
      success: true,
      balance: 42,
      balanceCents: 4200,
      totalEarnings: 100,
      totalEarningsCents: 10000
    });
    expect(result).toMatchObject({
      success: true,
      totalDebitCents: 3100,
      newBalance: 11,
      ledgerStatus: 'posted'
    });
    expect(firestore.docs.get('driver_balances/driver_cents')).toMatchObject({
      balance: 11,
      balanceCents: 1100,
      totalEarningsCents: 10000
    });
  });

  it('keeps withdrawals ledger_pending when the canonical requested ledger fails', async () => {
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_balances/driver_ledger_pending', {
      driverId: 'driver_ledger_pending',
      balanceCents: 4200
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    service.financialLedgerService.recordWithdrawalRequested = jest.fn().mockResolvedValue({
      success: false,
      code: 'LEDGER_WRITE_FAILED',
      error: 'ledger unavailable'
    });

    const result = await service.requestDriverWithdrawal({
      driverId: 'driver_ledger_pending',
      amountCents: 2500,
      pixKey: 'driver@pix.test',
      requestId: 'withdraw_request_ledger_pending'
    });

    expect(result).toMatchObject({
      success: true,
      status: 'ledger_pending',
      ledgerStatus: 'pending_retry',
      totalDebitCents: 2600
    });
    const withdrawal = Array.from(firestore.docs.entries())
      .find(([path]) => path.startsWith('driver_withdrawals/'))?.[1];
    expect(withdrawal).toMatchObject({
      status: 'ledger_pending',
      ledgerStatus: 'pending_retry',
      ledgerRetryable: true
    });
  });

  it('rejects withdrawal idempotency replay when the same requestId changes parameters', async () => {
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_balances/driver_1', {
      driverId: 'driver_1',
      balance: 42,
      totalEarnings: 100
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const first = await service.requestDriverWithdrawal({
      driverId: 'driver_1',
      amountCents: 2500,
      pixKey: 'driver@pix.test',
      requestId: 'withdraw_request_same'
    });
    const second = await service.requestDriverWithdrawal({
      driverId: 'driver_1',
      amountCents: 2500,
      pixKey: 'other@pix.test',
      requestId: 'withdraw_request_same'
    });

    expect(first.success).toBe(true);
    expect(second).toMatchObject({
      success: false,
      code: 'WITHDRAWAL_IDEMPOTENCY_CONFLICT'
    });
    expect(firestore.docs.get('driver_balances/driver_1')).toMatchObject({
      balance: 16
    });
  });

  it('does not mark distribution as complete when internal ledger credit fails', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    service.creditDriverBalance = jest.fn().mockResolvedValue({
      success: false,
      error: 'ledger unavailable'
    });

    const result = await service.processNetDistribution({
      rideId: 'booking_failed_credit',
      driverId: 'driver_ledger',
      totalAmount: 1506,
      tollFee: 0
    });

    expect(result).toMatchObject({
      success: false,
      retryable: true,
      details: 'ledger unavailable'
    });
    expect(firestore.docs.has('payment_distributions/booking_failed_credit')).toBe(false);
  });

  it('claims pending withdrawals before Pix Out processing and skips duplicate processing', async () => {
    process.env.LEAF_PIX_KEY = 'leaf@pix.test';
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_withdrawals/wd_1', {
      driverId: 'driver_1',
      pixKey: 'driver@pix.test',
      amountCents: 2500,
      status: 'pending',
      ledgerStatus: 'posted'
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockTransferDirectToDriver.mockResolvedValue({
      success: true,
      transferId: 'transfer_wd_1'
    });
    const service = new PaymentService();

    const first = await service.processDriverWithdrawal('wd_1', 'admin_1');
    const second = await service.processDriverWithdrawal('wd_1', 'admin_2');

    expect(first).toMatchObject({
      success: true,
      withdrawalId: 'wd_1',
      transferId: 'transfer_wd_1'
    });
    expect(second).toMatchObject({
      success: true,
      alreadyProcessed: true,
      status: 'processed'
    });
    expect(mockTransferDirectToDriver).toHaveBeenCalledTimes(1);
    expect(firestore.docs.get('driver_withdrawals/wd_1')).toMatchObject({
      status: 'processed',
      processedBy: 'admin_1',
      transferId: 'transfer_wd_1'
    });
  });

  it('blocks Pix Out when the withdrawal request ledger is not posted', async () => {
    process.env.LEAF_PIX_KEY = 'leaf@pix.test';
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_withdrawals/wd_without_ledger', {
      driverId: 'driver_1',
      pixKey: 'driver@pix.test',
      amountCents: 2500,
      status: 'pending'
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const result = await service.processDriverWithdrawal('wd_without_ledger', 'admin_1');

    expect(result).toMatchObject({
      success: false,
      code: 'WITHDRAWAL_LEDGER_NOT_POSTED'
    });
    expect(mockTransferDirectToDriver).not.toHaveBeenCalled();
    expect(firestore.docs.get('driver_withdrawals/wd_without_ledger')).toMatchObject({
      status: 'pending'
    });
  });

  it('marks a processed withdrawal as ledger pending when Pix Out succeeds but processed ledger fails', async () => {
    process.env.LEAF_PIX_KEY = 'leaf@pix.test';
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_withdrawals/wd_processed_ledger_pending', {
      driverId: 'driver_1',
      pixKey: 'driver@pix.test',
      amountCents: 2500,
      status: 'pending',
      ledgerStatus: 'posted'
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockTransferDirectToDriver.mockResolvedValue({
      success: true,
      transferId: 'transfer_wd_ledger_pending'
    });
    const service = new PaymentService();
    service.financialLedgerService.recordWithdrawalProcessed = jest.fn().mockResolvedValue({
      success: false,
      code: 'LEDGER_WRITE_FAILED',
      error: 'ledger unavailable'
    });

    const result = await service.processDriverWithdrawal('wd_processed_ledger_pending', 'admin_1');

    expect(result).toMatchObject({
      success: true,
      status: 'processed_ledger_pending',
      ledgerProcessedStatus: 'pending_retry'
    });
    expect(mockTransferDirectToDriver).toHaveBeenCalledTimes(1);
    expect(firestore.docs.get('driver_withdrawals/wd_processed_ledger_pending')).toMatchObject({
      status: 'processed_ledger_pending',
      ledgerProcessedStatus: 'pending_retry',
      ledgerRetryable: true,
      transferId: 'transfer_wd_ledger_pending'
    });
  });

  it('passes stable gateway correlation id when processing withdrawals', async () => {
    process.env.LEAF_PIX_KEY = 'leaf@pix.test';
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_withdrawals/wd_gateway_1', {
      driverId: 'driver_gateway',
      pixKey: 'driver@pix.test',
      amountCents: 4500,
      status: 'pending',
      ledgerStatus: 'posted'
    });
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockTransferDirectToDriver.mockResolvedValue({
      success: true,
      transferId: 'transfer_gateway_1'
    });
    const service = new PaymentService();

    const result = await service.processDriverWithdrawal('wd_gateway_1', 'admin_1');

    expect(result.success).toBe(true);
    expect(mockTransferDirectToDriver).toHaveBeenCalledWith(
      'driver_gateway',
      4500,
      'Saque motorista driver_gateway - wd_gateway_1',
      'withdraw_wd_gateway_1',
      'driver@pix.test',
      'leaf@pix.test',
      {
        correlationID: 'leaf_withdrawal_wd_gateway_1'
      }
    );
  });

  it('settles completed ride into internal ledger without Woovi account or Pix key', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const result = await service.processNetDistribution({
      rideId: 'booking_ledger_only',
      driverId: 'driver_ledger',
      totalAmount: 1506,
      tollFee: 0
    });

    const balance = firestore.docs.get('driver_balances/driver_ledger');
    const distribution = firestore.docs.get('payment_distributions/booking_ledger_only');

    expect(result).toMatchObject({
      success: true,
      netAmount: 1357,
      netAmountInReais: '13.57',
      transferId: null,
      balanceCreditId: 'driver_ledger'
    });
    expect(balance).toMatchObject({
      driverId: 'driver_ledger',
      balance: 13.57,
      totalEarnings: 13.57,
      lastRideId: 'booking_ledger_only'
    });
    expect(distribution).toMatchObject({
      rideId: 'booking_ledger_only',
      driverId: 'driver_ledger',
      status: 'distributed',
      netAmount: 1357,
      transferId: null,
      retainedFees: {
        operationalFee: 99,
        wooviFee: 50,
        totalRetained: 149
      }
    });
  });

  it('settles the backend-final snapshot without recalculating the driver amount', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    service.calculateNetAmount = jest.fn(() => {
      throw new Error('não deve recalcular snapshot final');
    });

    const result = await service.processNetDistribution({
      rideId: 'booking_snapshot_locked',
      driverId: 'driver_snapshot',
      totalAmount: 1506,
      tollFee: 0,
      financialSnapshot: {
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        passengerPaidCents: 1506,
        tollFeeCents: 0,
        operationalFeeCents: 99,
        paymentIntermediationFeeCents: 50,
        subscriptionRetainedFeeCents: 0,
        driverNetAmountCents: 1357
      }
    });

    expect(result).toMatchObject({
      success: true,
      netAmount: 1357,
      retainedFees: {
        operationalFee: 99,
        wooviFee: 50,
        totalRetained: 149
      }
    });
    expect(service.calculateNetAmount).not.toHaveBeenCalled();
    expect(firestore.docs.get('payment_distributions/booking_snapshot_locked')).toMatchObject({
      netAmount: 1357,
      calculation: expect.objectContaining({
        totalAmount: 1506,
        netAmount: 1357
      })
    });
  });

  it('settles subscription retention from the backend-final snapshot without recalculating', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    service.calculateNetAmount = jest.fn(() => {
      throw new Error('não deve recalcular snapshot final');
    });
    service.buildRideFinancialContract = jest.fn(() => {
      throw new Error('não deve reconstruir contrato backend_final');
    });

    const result = await service.processNetDistribution({
      rideId: 'booking_snapshot_subscription',
      driverId: 'driver_snapshot',
      totalAmount: 3000,
      tollFee: 0,
      financialSnapshot: {
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        passengerPaidCents: 3000,
        tollFeeCents: 0,
        operationalFeeCents: 149,
        paymentIntermediationFeeCents: 50,
        subscriptionRetainedFeeCents: 300,
        driverNetAmountCents: 2501
      }
    });

    expect(result).toMatchObject({
      success: true,
      netAmount: 2501,
      retainedFees: {
        operationalFee: 149,
        wooviFee: 50,
        subscriptionRetainedFee: 300,
        totalRetained: 499
      }
    });
    expect(service.calculateNetAmount).not.toHaveBeenCalled();
    expect(service.buildRideFinancialContract).not.toHaveBeenCalled();
    expect(firestore.docs.get('payment_distributions/booking_snapshot_subscription')).toMatchObject({
      netAmount: 2501,
      subscriptionRetainedFee: 300,
      retainedFees: {
        operationalFee: 149,
        wooviFee: 50,
        subscriptionRetainedFee: 300,
        totalRetained: 499
      },
      calculation: expect.objectContaining({
        totalAmount: 3000,
        netAmount: 2501,
        financialContract: expect.objectContaining({
          subscriptionRetainedFeeCents: 300
        })
      })
    });
    const settlementEvent = Array.from(firestore.docs.values()).find(
      (doc) => doc.eventType === 'ride_settlement' && doc.rideId === 'booking_snapshot_subscription'
    );
    expect(settlementEvent).toMatchObject({
      totalDebitCents: 3000,
      totalCreditCents: 3000,
      lines: expect.arrayContaining([
        expect.objectContaining({
          account: 'liability:driver_balance_payable',
          direction: 'credit',
          amountCents: 2501
        }),
        expect.objectContaining({
          account: 'revenue:driver_subscription_settlement',
          direction: 'credit',
          amountCents: 300
        })
      ])
    });
  });
});

describe('PaymentService driver balance credit idempotency', () => {
  beforeEach(() => {
    firebaseConfig.getFirestore.mockReturnValue(null);
  });

  it('credits driver balance once for the same ride and amount', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();

    const firstCredit = await service.creditDriverBalance('driver_1', 1243, 'booking_1');
    const secondCredit = await service.creditDriverBalance('driver_1', 1243, 'booking_1');

    const balance = firestore.docs.get('driver_balances/driver_1');
    const transactionId = service.buildDriverBalanceCreditId('driver_1', 'booking_1', 1243);
    const transaction = firestore.docs.get(`driver_balances/driver_1/transactions/${transactionId}`);

    expect(firstCredit).toMatchObject({
      success: true,
      previousBalance: 0,
      newBalance: 12.43,
      transactionId
    });
    expect(firstCredit.duplicate).toBeUndefined();
    expect(secondCredit).toMatchObject({
      success: true,
      duplicate: true,
      newBalance: 12.43,
      transactionId
    });
    expect(balance).toMatchObject({
      driverId: 'driver_1',
      balance: 12.43,
      totalEarnings: 12.43,
      lastRideId: 'booking_1'
    });
    expect(transaction).toMatchObject({
      type: 'credit',
      amount: 12.43,
      amountInCents: 1243,
      rideId: 'booking_1',
      newBalance: 12.43,
      idempotencyKey: transactionId
    });
  });
});

describe('PaymentService refund terminal status handling', () => {
  beforeEach(() => {
    firebaseConfig.getFirestore.mockReturnValue(null);
  });

  it('marks partial and full refund statuses as refunded to block replay', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    await firestore.collection('ride_payments').doc('booking_refund_1').set({
      rideId: 'booking_refund_1',
      chargeId: 'charge_refund_1',
      amount: 8785,
      passengerId: 'customer_1',
      status: 'PAID'
    });
    await firestore.collection('payment_holdings').doc('booking_refund_1').set({
      rideId: 'booking_refund_1',
      chargeId: 'charge_refund_1',
      amount: 8785,
      status: 'refunded'
    });
    const service = new PaymentService();

    const result = await service.markPaymentRefunded('booking_refund_1', {
      refundAmount: 0,
      cancellationFee: 200,
      status: 'REFUNDED_PARTIAL',
      reason: 'unit replay guard'
    });

    expect(result).toMatchObject({ success: true });
    expect(firestore.docs.get('ride_payments/booking_refund_1')).toMatchObject({
      status: 'REFUNDED_PARTIAL',
      refunded: true,
      refundAmount: 0,
      cancellationFee: 200
    });
    expect(PaymentService.isRefundedPaymentStatus('REFUNDED_FULL')).toBe(true);
    expect(PaymentService.isRefundedPaymentStatus('REFUNDED_PARTIAL')).toBe(true);
  });

  it('closes fee-only cancellations without marking payment holding as refunded', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    await firestore.collection('ride_payments').doc('booking_fee_only_1').set({
      rideId: 'booking_fee_only_1',
      chargeId: 'charge_fee_only_1',
      amount: 1000,
      passengerId: 'customer_fee_only',
      status: 'PAID'
    });
    await firestore.collection('payment_holdings').doc('booking_fee_only_1').set({
      rideId: 'booking_fee_only_1',
      chargeId: 'charge_fee_only_1',
      amount: 1000,
      status: 'in_holding'
    });
    const service = new PaymentService();

    const result = await service.markPaymentRefunded('booking_fee_only_1', {
      refundAmount: 0,
      cancellationFee: 1000,
      status: 'FEE_ONLY',
      reason: 'unit fee retained'
    });

    expect(result).toMatchObject({ success: true });
    expect(firestore.docs.get('ride_payments/booking_fee_only_1')).toMatchObject({
      status: 'FEE_ONLY',
      refunded: false,
      refundStatus: 'FEE_ONLY',
      refundAmount: 0,
      cancellationFee: 1000,
      noRefundRequiredAt: '__SERVER_TIMESTAMP__'
    });
    expect(firestore.docs.get('payment_holdings/booking_fee_only_1')).toMatchObject({
      status: 'cancelled',
      refunded: false,
      refundStatus: 'FEE_ONLY',
      refundAmount: 0,
      cancellationFee: 1000,
      noRefundRequiredAt: '__SERVER_TIMESTAMP__'
    });
  });

  it('treats canonical confirmed payment records as captured for refunds', () => {
    expect(PaymentService.isCapturedPaymentStatus('PAID')).toBe(true);
    expect(PaymentService.isCapturedPaymentStatus('CONFIRMED')).toBe(true);
    expect(PaymentService.isCapturedPaymentStatus('LEDGER_PENDING')).toBe(true);
    expect(PaymentService.isCapturedPaymentStatus('IN_HOLDING')).toBe(true);
    expect(PaymentService.isCapturedPaymentStatus('PENDING')).toBe(false);
    expect(PaymentService.isCapturedPaymentStatus('REFUNDED_FULL')).toBe(false);
  });

  it('processes ride refunds through provider and canonical ledger-backed records', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockProcessRefund.mockResolvedValue({
      success: true,
      refundId: 'refund_provider_1'
    });
    await firestore.collection('ride_payments').doc('booking_refund_2').set({
      rideId: 'booking_refund_2',
      chargeId: 'charge_refund_2',
      amount: 8785,
      passengerId: 'customer_2',
      status: 'PAID'
    });
    await firestore.collection('payment_holdings').doc('booking_refund_2').set({
      rideId: 'booking_refund_2',
      chargeId: 'charge_refund_2',
      amount: 8785,
      status: 'in_holding'
    });
    const service = new PaymentService();

    const result = await service.processRideRefund({
      rideId: 'booking_refund_2',
      chargeId: 'charge_refund_2',
      amount: 1200,
      reason: 'unit canonical refund',
      status: 'REFUNDED_PARTIAL'
    });

    expect(result).toMatchObject({
      success: true,
      rideId: 'booking_refund_2',
      chargeId: 'charge_refund_2',
      refundId: 'refund_provider_1',
      ledgerRecorded: true
    });
    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(mockProcessRefund).toHaveBeenCalledWith(
      'charge_refund_2',
      1200,
      'Reembolso Leaf - unit canonical refund'
    );
    expect(firestore.docs.get('ride_payments/booking_refund_2')).toMatchObject({
      status: 'REFUNDED_PARTIAL',
      refunded: true,
      refundInProgress: false,
      refundStatus: 'REFUNDED_PARTIAL',
      refundAmount: 1200,
      refundId: 'refund_provider_1'
    });
    expect(firestore.docs.get('payment_holdings/booking_refund_2')).toMatchObject({
      status: 'refunded',
      refunded: true,
      refundAmount: 1200,
      refundId: 'refund_provider_1'
    });
  });

  it('does not report refund ledger evidence when ledger recording fails', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    mockProcessRefund.mockResolvedValue({
      success: true,
      refundId: 'refund_provider_ledger_fail'
    });
    await firestore.collection('ride_payments').doc('booking_refund_ledger_fail').set({
      rideId: 'booking_refund_ledger_fail',
      chargeId: 'charge_refund_ledger_fail',
      amount: 8785,
      passengerId: 'customer_ledger_fail',
      status: 'PAID'
    });
    await firestore.collection('payment_holdings').doc('booking_refund_ledger_fail').set({
      rideId: 'booking_refund_ledger_fail',
      chargeId: 'charge_refund_ledger_fail',
      amount: 8785,
      status: 'in_holding'
    });
    const service = new PaymentService();
    service.financialLedgerService.recordRefund = jest.fn().mockResolvedValue({
      success: false,
      error: 'ledger unavailable'
    });

    const result = await service.processRideRefund({
      rideId: 'booking_refund_ledger_fail',
      chargeId: 'charge_refund_ledger_fail',
      amount: 1200,
      reason: 'unit ledger failure',
      status: 'REFUNDED_PARTIAL'
    });

    expect(result).toMatchObject({
      success: true,
      rideId: 'booking_refund_ledger_fail',
      refundId: 'refund_provider_ledger_fail',
      ledgerRecorded: false,
      ledgerError: 'ledger unavailable'
    });
    expect(firestore.docs.get('ride_payments/booking_refund_ledger_fail')).toMatchObject({
      status: 'REFUNDED_PARTIAL',
      refunded: true,
      refundLedgerStatus: 'pending',
      refundLedgerError: 'ledger unavailable'
    });
  });

  it('marks an advance payment intent as consumed inside a Firestore transaction', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    const paymentIntentId = service.buildAdvancePaymentIntentId('temp_ride_1');
    await firestore.collection('payment_intents').doc(paymentIntentId).set({
      status: 'charge_created',
      chargeId: 'charge_1',
      passengerId: 'customer_1'
    });

    const result = await service.markAdvancePaymentIntentConsumed({
      rideId: 'temp_ride_1',
      bookingId: 'booking_1',
      chargeId: 'charge_1'
    });

    expect(result).toBe(true);
    expect(firestore.docs.get(`payment_intents/${paymentIntentId}`)).toMatchObject({
      status: 'consumed',
      bookingId: 'booking_1',
      canonicalRideId: 'booking_1',
      consumedChargeId: 'charge_1'
    });
  });

  it('does not overwrite an advance payment intent consumed by another booking', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    const paymentIntentId = service.buildAdvancePaymentIntentId('temp_ride_2');
    await firestore.collection('payment_intents').doc(paymentIntentId).set({
      status: 'consumed',
      bookingId: 'booking_existing',
      canonicalRideId: 'booking_existing',
      chargeId: 'charge_2',
      consumedChargeId: 'charge_2'
    });

    const result = await service.markAdvancePaymentIntentConsumed({
      rideId: 'temp_ride_2',
      bookingId: 'booking_new',
      chargeId: 'charge_2'
    });

    expect(result).toBe(false);
    expect(firestore.docs.get(`payment_intents/${paymentIntentId}`)).toMatchObject({
      status: 'consumed',
      bookingId: 'booking_existing',
      canonicalRideId: 'booking_existing',
      consumedChargeId: 'charge_2'
    });
  });

  it('finds an advance payment intent by chargeId', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    const service = new PaymentService();
    await firestore.collection('payment_intents').doc('advance_charge_lookup').set({
      paymentIntentId: 'advance_charge_lookup',
      status: 'charge_created',
      rideId: 'temp_ride_session_canonical_hash',
      chargeId: 'charge_lookup_1',
      passengerId: 'customer_1',
      quoteLockSnapshot: {
        routeDistanceKm: 27.1,
        routeDurationSecs: 1800
      }
    });

    const result = await service.getAdvancePaymentIntentByChargeId('charge_lookup_1');

    expect(result).toMatchObject({
      found: true,
      paymentIntentId: 'advance_charge_lookup',
      chargeId: 'charge_lookup_1',
      quoteLockSnapshot: {
        routeDistanceKm: 27.1,
        routeDurationSecs: 1800
      }
    });
  });

  it('does not call the provider again when a ride refund is already terminal', async () => {
    const firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    await firestore.collection('ride_payments').doc('booking_refund_3').set({
      rideId: 'booking_refund_3',
      chargeId: 'charge_refund_3',
      amount: 8785,
      refundAmount: 1200,
      refundId: 'refund_existing',
      refunded: true,
      status: 'REFUNDED_PARTIAL'
    });
    const service = new PaymentService();

    const result = await service.processRideRefund({
      rideId: 'booking_refund_3',
      chargeId: 'charge_refund_3',
      amount: 1200,
      reason: 'unit replay',
      status: 'REFUNDED_PARTIAL'
    });

    expect(result).toMatchObject({
      success: true,
      alreadyRefunded: true,
      code: 'ALREADY_REFUNDED',
      refundId: 'refund_existing'
    });
    expect(mockProcessRefund).not.toHaveBeenCalled();
  });
});

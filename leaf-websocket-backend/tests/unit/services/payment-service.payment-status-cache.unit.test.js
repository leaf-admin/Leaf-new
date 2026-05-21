const mockCacheStore = new Map();
const mockCreateCharge = jest.fn();
const mockCreateChargeWithSplit = jest.fn();
const mockTransferDirectToDriver = jest.fn();

jest.mock('../../../services/woovi-driver-service', () =>
  jest.fn().mockImplementation(() => ({
    getChargeStatus: jest.fn().mockResolvedValue({
      success: false,
      error: 'not found'
    }),
    createCharge: mockCreateCharge,
    createChargeWithSplit: mockCreateChargeWithSplit,
    transferDirectToDriver: mockTransferDirectToDriver
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
    doc: (id = `auto_${docs.size + 1}`) => doc(`${path}/${id}`)
  });

  const doc = (path) => ({
    path,
    collection: (name) => collection(`${path}/${name}`),
    id: path.split('/').pop(),
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path)
    }),
    set: async (data, options) => writeDoc({ path }, data, options)
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
    mockCacheStore.clear();
    mockCreateCharge.mockReset();
    mockCreateChargeWithSplit.mockReset();
    mockTransferDirectToDriver.mockReset();
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
      paymentIntentId: service.buildAdvancePaymentIntentId('ride_retry_1')
    });
    expect(mockCreateCharge).toHaveBeenCalledTimes(1);
    expect(mockCreateCharge.mock.calls[0][0]).toMatchObject({
      value: 2210,
      correlationID: service.buildAdvanceChargeCorrelationID(paymentData)
    });
    expect(firestore.docs.get(`payment_intents/${service.buildAdvancePaymentIntentId('ride_retry_1')}`)).toMatchObject({
      status: 'charge_created',
      chargeId: 'charge_retry_1',
      amountCents: 2210
    });
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

  it('keeps daily subscription billing suspended by default', () => {
    const service = new PaymentService();

    expect(service.SUBSCRIPTION_DAILY_BILLING_ENABLED).toBe(false);
    expect(service.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS).toBe(990);
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
      subscriptionDailyFeeNominalCents: 990,
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
      status: 'pending'
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

  it('passes stable gateway correlation id when processing withdrawals', async () => {
    process.env.LEAF_PIX_KEY = 'leaf@pix.test';
    const firestore = createInMemoryFirestore();
    firestore.docs.set('driver_withdrawals/wd_gateway_1', {
      driverId: 'driver_gateway',
      pixKey: 'driver@pix.test',
      amountCents: 4500,
      status: 'pending'
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

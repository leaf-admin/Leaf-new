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
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
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

const { logStructured } = require('../../../utils/logger');

// Caso real de QA: Pix de R$ 48,61, corrida encerrada pelo passageiro com valor final de
// R$ 12,15 em contexto sandbox de usuário de teste. Estorno esperado: R$ 36,46.
describe('PaymentService.processNetDistribution - estorno parcial no encerramento antecipado', () => {
  const bookingId = 'booking_early_end_sandbox';
  const temporaryRideId = 'temp_ride_early_end_sandbox';
  const chargeId = 'charge_early_end_sandbox';
  const financialSnapshot = {
    authoritativeSnapshot: true,
    financialSnapshotSource: 'backend_final',
    passengerPaidCents: 1215,
    tollFeeCents: 895,
    operationalFeeCents: 79,
    paymentIntermediationFeeCents: 50,
    subscriptionRetainedFeeCents: 0,
    driverNetAmountCents: 1086
  };
  let firestore;
  let service;
  let financialContext;

  const seedSandboxPayment = (overrides = {}) => {
    firestore.docs.set(`sandbox_payment_intents/${service.buildAdvancePaymentIntentId(temporaryRideId)}`, {
      paymentIntentId: service.buildAdvancePaymentIntentId(temporaryRideId),
      rideId: temporaryRideId,
      passengerId: 'passenger_early_end',
      chargeId,
      amountCents: 4861,
      status: 'charge_created',
      providerEnvironment: 'sandbox',
      financialContext,
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId
    });
    const common = {
      chargeId,
      amount: 4861,
      passengerId: 'passenger_early_end',
      canonicalRideId: bookingId,
      bookingId,
      temporaryRideId,
      paymentReferenceRideId: temporaryRideId,
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    };
    for (const rideId of [temporaryRideId, bookingId]) {
      firestore.docs.set(`sandbox_ride_payments/${rideId}`, {
        ...common,
        rideId,
        status: 'CONFIRMED',
        ...overrides
      });
      firestore.docs.set(`sandbox_payment_holdings/${rideId}`, {
        ...common,
        rideId,
        status: 'in_holding'
      });
    }
  };

  const settle = () => service.processNetDistribution({
    rideId: bookingId,
    driverId: 'driver_early_end',
    totalAmount: 1215,
    tollFee: 895,
    financialContext,
    financialSnapshot
  });

  beforeEach(() => {
    mockProcessRefund.mockReset();
    logStructured.mockClear();
    firestore = createInMemoryFirestore();
    firebaseConfig.getFirestore.mockReturnValue(firestore);
    service = new PaymentService();
    financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
  });

  it('emite o estorno parcial uma única vez no sandbox e deixa o rastro no resultado da liquidação', async () => {
    seedSandboxPayment();
    mockProcessRefund.mockResolvedValue({ success: true, refundId: 'refund_early_end' });

    const result = await settle();

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(mockProcessRefund).toHaveBeenCalledWith(
      chargeId,
      3646,
      expect.stringContaining('Estorno de Encerramento Antecipado'),
      expect.objectContaining({ wooviConfig: expect.objectContaining({ environment: 'sandbox' }) })
    );
    expect(result).toMatchObject({
      success: true,
      netAmount: 1086,
      passengerRefund: {
        attempted: true,
        success: true,
        skippedReason: null,
        storedAmountCents: 4861,
        finalAmountCents: 1215,
        refundAmountCents: 3646,
        refundId: 'refund_early_end',
        error: null
      }
    });
    expect(firestore.docs.get(`sandbox_ride_payments/${bookingId}`)).toMatchObject({
      status: 'REFUNDED_PARTIAL',
      refunded: true,
      refundStatus: 'REFUNDED_PARTIAL',
      refundAmount: 3646,
      refundId: 'refund_early_end',
      refundLedgerStatus: 'recorded'
    });
    expect(firestore.docs.get(`sandbox_payment_distributions/${bookingId}`)).toMatchObject({
      netAmount: 1086,
      passengerRefund: { attempted: true, success: true, refundAmountCents: 3646 }
    });
    expect(firestore.docs.get('sandbox_driver_balances/driver_early_end')).toBeDefined();
    expect(Array.from(firestore.docs.keys()).some((key) => (
      key.startsWith('ride_payments/') ||
      key.startsWith('payment_distributions/') ||
      key.startsWith('financial_ledger_events/')
    ))).toBe(false);
  });

  it('não repete o estorno no provedor quando a liquidação é reprocessada', async () => {
    seedSandboxPayment();
    mockProcessRefund.mockResolvedValue({ success: true, refundId: 'refund_early_end' });

    await settle();
    const replay = await settle();

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(replay).toMatchObject({
      success: true,
      netAmount: 1086,
      passengerRefund: {
        attempted: false,
        skippedReason: 'PAYMENT_ALREADY_REFUNDED',
        refundAmountCents: 3646,
        refundId: 'refund_early_end'
      }
    });
  });

  it('mantém o crédito do motorista e expõe a falha quando o provedor recusa o estorno', async () => {
    seedSandboxPayment();
    mockProcessRefund.mockResolvedValue({ success: false, error: 'provider down' });

    const result = await settle();

    expect(mockProcessRefund).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      netAmount: 1086,
      passengerRefund: {
        attempted: true,
        success: false,
        refundAmountCents: 3646,
        refundId: null,
        error: 'Falha ao processar reembolso'
      }
    });
    expect(firestore.docs.get(`sandbox_ride_payments/${bookingId}`)).toMatchObject({
      status: 'CONFIRMED',
      refundInProgress: false,
      refundStatus: 'FAILED',
      refundFailure: 'Falha ao processar reembolso'
    });
    expect(logStructured).toHaveBeenCalledWith(
      'error',
      'Falha ao processar estorno parcial do passageiro',
      expect.objectContaining({ rideId: bookingId, chargeId, refundAmount: 3646 })
    );
    expect(firestore.docs.get('sandbox_driver_balances/driver_early_end')).toBeDefined();
  });

  it('registra o motivo quando o valor pago excede o final mas o estorno não é tentado', async () => {
    seedSandboxPayment({ status: 'PENDING' });

    const result = await settle();

    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      passengerRefund: {
        attempted: false,
        success: false,
        skippedReason: 'PAYMENT_STATUS_NOT_CAPTURED',
        storedAmountCents: 4861,
        finalAmountCents: 1215
      }
    });
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'Estorno parcial do passageiro não tentado na liquidação',
      expect.objectContaining({
        rideId: bookingId,
        reason: 'PAYMENT_STATUS_NOT_CAPTURED',
        paymentStatus: 'PENDING'
      })
    );
  });

  it('não sinaliza estorno quando o valor final é igual ao valor pago', async () => {
    seedSandboxPayment({ amount: 1215 });

    const result = await settle();

    expect(mockProcessRefund).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      passengerRefund: { attempted: false, skippedReason: 'NO_REFUND_DUE', refundAmountCents: 0 }
    });
  });
});

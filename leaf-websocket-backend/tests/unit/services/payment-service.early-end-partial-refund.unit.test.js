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
    firestore.docs.set('payment_runtime_profiles/qa-test-users-sandbox-durable', {
      environment: 'sandbox',
      authorizationAppId: 'original-sandbox-test-credential'
    });
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
    expect(mockProcessRefund.mock.calls[0][3].wooviConfig.authorizationAppId)
      .toBe('original-sandbox-test-credential');
    expect(mockProcessRefund).toHaveBeenCalledWith(
      chargeId,
      3646,
      expect.stringContaining('Estorno parcial da corrida'),
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
        error: 'Falha ao processar reembolso',
        pendingStatus: 'MANUAL_REVIEW_REQUIRED',
        manualReviewRequired: true
      }
    });
    expect(result.passengerRefundManualReviewRequired).toBe(true);
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

  describe('estorno parcial que falha não pode ser esquecido', () => {
    const paymentDoc = () => firestore.docs.get(`sandbox_ride_payments/${bookingId}`);
    const driverBalance = () => firestore.docs.get('sandbox_driver_balances/driver_early_end');
    const driverCredits = () => Array.from(firestore.docs.keys())
      .filter((key) => key.startsWith('sandbox_driver_balances/driver_early_end/transactions/'));
    const settlementLedgerEvents = () => Array.from(firestore.docs.entries())
      .filter(([key, data]) => key.startsWith('sandbox_financial_ledger_events/') && data.eventType === 'ride_settlement');
    const notSent = { success: false, error: 'connect ECONNREFUSED', errorCode: 'ECONNREFUSED', providerDelivery: 'NOT_SENT' };
    const ambiguousTimeout = {
      success: false,
      error: 'timeout of 30000ms exceeded',
      errorCode: 'ECONNABORTED',
      providerDelivery: 'UNKNOWN'
    };
    const expectDriverCreditedOnce = () => {
      expect(driverCredits()).toHaveLength(1);
      expect(driverBalance()).toMatchObject({ balanceCents: 1086, totalEarningsCents: 1086 });
      expect(settlementLedgerEvents()).toHaveLength(1);
    };

    it('falha sem chegar à Woovi e depois dá certo: um estorno e um crédito', async () => {
      seedSandboxPayment();
      mockProcessRefund
        .mockResolvedValueOnce(notSent)
        .mockResolvedValueOnce({ success: true, refundId: 'refund_after_retry' });

      const first = await settle();

      // Motorista creditado, mas a liquidação não sai como sucesso: o worker repete.
      expect(first).toMatchObject({
        success: false,
        code: 'PASSENGER_REFUND_RETRY_PENDING',
        retryable: true,
        driverCredited: true,
        passengerRefund: {
          attempted: true,
          success: false,
          pendingStatus: 'RETRY_PENDING',
          manualReviewRequired: false,
          pendingRecorded: true,
          providerDelivery: 'NOT_SENT'
        }
      });
      expect(paymentDoc()).toMatchObject({
        status: 'CONFIRMED',
        refundInProgress: false,
        refundStatus: 'FAILED',
        passengerRefundPending: {
          status: 'RETRY_PENDING',
          rideId: bookingId,
          chargeId,
          amountCents: 3646,
          providerDelivery: 'NOT_SENT',
          attempts: 1
        }
      });
      expectDriverCreditedOnce();

      const second = await settle();

      expect(second).toMatchObject({
        success: true,
        netAmount: 1086,
        passengerRefund: { attempted: true, success: true, refundId: 'refund_after_retry', pendingStatus: null }
      });
      expect(second.passengerRefundManualReviewRequired).toBeUndefined();
      expect(mockProcessRefund).toHaveBeenCalledTimes(2);
      expect(paymentDoc()).toMatchObject({
        status: 'REFUNDED_PARTIAL',
        refunded: true,
        refundAmount: 3646,
        refundId: 'refund_after_retry',
        passengerRefundPending: { status: 'RESOLVED', attempts: 1 }
      });
      expectDriverCreditedOnce();

      // Evento reentregue depois do sucesso: nem estorno nem crédito de novo.
      const replay = await settle();
      expect(replay).toMatchObject({
        success: true,
        passengerRefund: { attempted: false, skippedReason: 'PAYMENT_ALREADY_REFUNDED' }
      });
      expect(mockProcessRefund).toHaveBeenCalledTimes(2);
      expectDriverCreditedOnce();
    });

    it('falha permanente sem chegar à Woovi: motorista creditado uma vez, pendência durável, nunca sucesso', async () => {
      seedSandboxPayment();
      mockProcessRefund.mockResolvedValue(notSent);

      // 1 tentativa + 5 retries do worker de billing.
      const results = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        results.push(await settle());
      }

      expect(results.every((result) => result.success === false)).toBe(true);
      expect(results.every((result) => result.code === 'PASSENGER_REFUND_RETRY_PENDING')).toBe(true);
      expect(mockProcessRefund).toHaveBeenCalledTimes(6);
      expect(paymentDoc()).toMatchObject({
        status: 'CONFIRMED',
        passengerRefundPending: {
          status: 'RETRY_PENDING',
          chargeId,
          amountCents: 3646,
          attempts: 6,
          error: expect.stringContaining('ECONNREFUSED')
        }
      });
      expectDriverCreditedOnce();
    });

    it('timeout ambíguo não é repetido: fica para revisão manual', async () => {
      seedSandboxPayment();
      mockProcessRefund.mockResolvedValue(ambiguousTimeout);

      const first = await settle();

      expect(first).toMatchObject({
        success: true,
        passengerRefundManualReviewRequired: true,
        netAmount: 1086,
        passengerRefund: {
          attempted: true,
          success: false,
          pendingStatus: 'MANUAL_REVIEW_REQUIRED',
          manualReviewRequired: true,
          pendingRecorded: true,
          providerDelivery: 'UNKNOWN'
        }
      });
      expect(paymentDoc()).toMatchObject({
        passengerRefundPending: {
          status: 'MANUAL_REVIEW_REQUIRED',
          chargeId,
          amountCents: 3646,
          providerDelivery: 'UNKNOWN',
          error: expect.stringContaining('timeout of 30000ms exceeded')
        }
      });

      // Reprocessar a liquidação não chama a Woovi de novo nem credita em dobro.
      const replay = await settle();

      expect(mockProcessRefund).toHaveBeenCalledTimes(1);
      expect(replay).toMatchObject({
        success: true,
        passengerRefundManualReviewRequired: true,
        passengerRefund: {
          attempted: false,
          skippedReason: 'PASSENGER_REFUND_MANUAL_REVIEW_REQUIRED',
          manualReviewRequired: true,
          refundAmountCents: 3646
        }
      });
      expectDriverCreditedOnce();
    });

    it('recusa do provedor (4xx) e falha sem classificação também não são repetidas', async () => {
      for (const failure of [
        { success: false, error: { error: 'refund not allowed' }, httpStatus: 400, providerDelivery: 'REJECTED' },
        { success: false, error: 'provider down' }
      ]) {
        firestore = createInMemoryFirestore();
        firebaseConfig.getFirestore.mockReturnValue(firestore);
        service = new PaymentService();
        mockProcessRefund.mockReset();
        mockProcessRefund.mockResolvedValue(failure);
        seedSandboxPayment();

        const first = await settle();
        await settle();

        expect(first).toMatchObject({ success: true, passengerRefundManualReviewRequired: true });
        expect(mockProcessRefund).toHaveBeenCalledTimes(1);
        expect(paymentDoc().passengerRefundPending).toMatchObject({ status: 'MANUAL_REVIEW_REQUIRED' });
        expectDriverCreditedOnce();
      }
    });

    it('estorno feito na Woovi mas não registrado não é enviado de novo', async () => {
      seedSandboxPayment();
      mockProcessRefund.mockResolvedValue({ success: true, refundId: 'refund_unrecorded' });
      jest.spyOn(service, 'markPaymentRefunded').mockResolvedValue({ success: false, error: 'firestore write failed' });

      const first = await settle();
      const replay = await settle();

      expect(mockProcessRefund).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({
        success: true,
        passengerRefundManualReviewRequired: true,
        passengerRefund: { code: 'REFUND_RECORD_FAILED', manualReviewRequired: true, providerDelivery: 'SENT' }
      });
      expect(replay.passengerRefund).toMatchObject({ attempted: false, manualReviewRequired: true });
      expect(paymentDoc().passengerRefundPending).toMatchObject({
        status: 'MANUAL_REVIEW_REQUIRED',
        code: 'REFUND_RECORD_FAILED',
        providerDelivery: 'SENT'
      });
      expectDriverCreditedOnce();
    });

    it('reserva de reembolso sem desfecho de uma execução anterior bloqueia nova chamada', async () => {
      seedSandboxPayment({ refundInProgress: true, refundStatus: 'PROCESSING', refundRequestId: 'left_by_crash' });
      mockProcessRefund.mockResolvedValue({ success: true, refundId: 'should_not_happen' });

      const result = await settle();

      expect(mockProcessRefund).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        passengerRefundManualReviewRequired: true,
        passengerRefund: {
          attempted: false,
          skippedReason: 'PASSENGER_REFUND_PREVIOUS_ATTEMPT_UNRESOLVED',
          refundAmountCents: 3646
        }
      });
      expect(paymentDoc().passengerRefundPending).toMatchObject({
        status: 'MANUAL_REVIEW_REQUIRED',
        code: 'PASSENGER_REFUND_PREVIOUS_ATTEMPT_UNRESOLVED',
        amountCents: 3646
      });
      expectDriverCreditedOnce();
    });

    it('pendência manual que não pôde ser gravada não sai como sucesso e não reenvia o estorno', async () => {
      seedSandboxPayment();
      mockProcessRefund.mockResolvedValue(ambiguousTimeout);
      const recordSpy = jest.spyOn(service, 'recordPassengerRefundPending')
        .mockResolvedValueOnce({ success: false, error: 'firestore down' });

      const first = await settle();

      expect(first).toMatchObject({
        success: false,
        code: 'PASSENGER_REFUND_PENDING_RECORD_FAILED',
        retryable: true,
        driverCredited: true
      });

      const second = await settle();

      expect(recordSpy).toHaveBeenCalledTimes(2);
      expect(mockProcessRefund).toHaveBeenCalledTimes(1);
      expect(second).toMatchObject({
        success: true,
        passengerRefundManualReviewRequired: true,
        passengerRefund: { skippedReason: 'PASSENGER_REFUND_PREVIOUS_FAILURE_UNCLASSIFIED' }
      });
      expect(paymentDoc().passengerRefundPending).toMatchObject({ status: 'MANUAL_REVIEW_REQUIRED' });
      expectDriverCreditedOnce();
    });
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

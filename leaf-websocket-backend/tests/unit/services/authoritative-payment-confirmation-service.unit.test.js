const {
  resolveAuthoritativePaymentConfirmation,
} = require('../../../services/authoritative-payment-confirmation-service');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

function createFirestoreWithDocs(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const collectionsRead = [];

  const firestore = {
    collectionsRead,
    collection(collectionName) {
      collectionsRead.push(collectionName);
      return {
        doc(docId) {
          const path = `${collectionName}/${docId}`;
          return {
            async get() {
              return {
                exists: docs.has(path),
                data: () => docs.get(path),
              };
            },
          };
        },
        where(field, _operator, value) {
          return {
            limit() {
              return {
                async get() {
                  const matches = [];
                  for (const [path, data] of docs.entries()) {
                    if (!path.startsWith(`${collectionName}/`)) continue;
                    if (data?.[field] !== value) continue;
                    matches.push({
                      data: () => data,
                    });
                  }
                  return {
                    empty: matches.length === 0,
                    docs: matches,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return firestore;
}

describe('authoritative-payment-confirmation-service', () => {
  it('accepts a provider-verified socket confirmation materialized in payment_holdings', async () => {
    const firestore = createFirestoreWithDocs({
      'payment_holdings/booking_1': {
        status: 'in_holding',
        source: 'socket_confirmPayment_provider_verified',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 3840,
      },
    });

    const result = await resolveAuthoritativePaymentConfirmation({
      firestore,
      paymentService: { getPaymentStatus: jest.fn() },
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 3840,
    });

    expect(result).toMatchObject({
      success: true,
      source: 'socket_confirmPayment_provider_verified',
    });
  });

  it('rejects local cache payment status as provider proof', async () => {
    const paymentService = {
      getPaymentStatus: jest.fn().mockResolvedValue({
        success: true,
        status: 'in_holding',
        source: 'booking_cache',
        chargeId: 'charge_1',
        amount: 3840,
      }),
    };

    const result = await resolveAuthoritativePaymentConfirmation({
      firestore: createFirestoreWithDocs(),
      paymentService,
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 3840,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
    });
  });

  it('uses only sandbox payment collections for a sealed sandbox intent', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      paymentProfileSource: 'payment_intent',
      testUserSandbox: true,
    });
    const firestore = createFirestoreWithDocs({
      'payment_holdings/booking_sandbox': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_sandbox',
        amount: 3840,
      },
      'sandbox_payment_holdings/booking_sandbox': {
        status: 'in_holding',
        source: 'sandbox_provider_verification',
        chargeId: 'charge_sandbox',
        paymentId: 'charge_sandbox',
        amount: 3840,
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox',
      },
    });
    const paymentService = { getPaymentStatus: jest.fn() };

    const result = await resolveAuthoritativePaymentConfirmation({
      firestore,
      paymentService,
      bookingId: 'booking_sandbox',
      references: ['charge_sandbox'],
      expectedAmountInCents: 3840,
      paymentContext: {
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox',
      },
    });

    expect(result).toMatchObject({
      success: true,
      source: 'sandbox_provider_verification',
    });
    expect(new Set(firestore.collectionsRead)).toEqual(new Set([
      'sandbox_payment_holdings',
      'sandbox_ride_payments',
    ]));
    expect(paymentService.getPaymentStatus).not.toHaveBeenCalled();
  });

  it.each([
    [
      'lost',
      { providerEnvironment: 'sandbox', financialNamespace: 'sandbox' },
      'FINANCIAL_SANDBOX_CONTEXT_LOST',
    ],
    [
      'tampered',
      (() => {
        const context = sealFinancialContext({
          providerEnvironment: 'sandbox',
          paymentProfileId: 'qa-sandbox',
          testUserSandbox: true,
        });
        return {
          financialContext: { ...context, contextId: 'tampered' },
          financialNamespace: 'sandbox',
          providerEnvironment: 'sandbox',
        };
      })(),
      'FINANCIAL_CONTEXT_TAMPERED',
    ],
  ])('fails before Firestore/provider reads when sandbox context is %s', async (_case, paymentContext, code) => {
    const firestore = createFirestoreWithDocs();
    const paymentService = { getPaymentStatus: jest.fn() };

    const result = await resolveAuthoritativePaymentConfirmation({
      firestore,
      paymentService,
      bookingId: 'booking_sandbox',
      references: ['charge_sandbox'],
      expectedAmountInCents: 3840,
      paymentContext,
    });

    expect(result).toMatchObject({ success: false, code });
    expect(firestore.collectionsRead).toEqual([]);
    expect(paymentService.getPaymentStatus).not.toHaveBeenCalled();
  });

  it('passes the sealed intent context to provider status and rejects a production response', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      testUserSandbox: true,
    });
    const paymentContext = {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
    };
    const paymentService = {
      getPaymentStatus: jest.fn().mockResolvedValue({
        success: true,
        status: 'in_holding',
        source: 'woovi_provider',
        amount: 3840,
        providerEnvironment: 'production',
      }),
    };

    const result = await resolveAuthoritativePaymentConfirmation({
      firestore: createFirestoreWithDocs(),
      paymentService,
      bookingId: 'booking_sandbox',
      references: ['charge_sandbox'],
      expectedAmountInCents: 3840,
      paymentContext,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
    });
    expect(paymentService.getPaymentStatus).toHaveBeenCalledWith(
      'charge_sandbox',
      paymentContext,
    );
  });
});

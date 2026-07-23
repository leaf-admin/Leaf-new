const {
  __private: {
    resolveAuthoritativePaymentConfirmation,
  },
} = require('../../../bootstrap/register-socket-confirm-payment-handler');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

function createFirestoreWithDocs(seed = {}) {
  const docs = new Map(Object.entries(seed));

  return {
    collection(collectionName) {
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
}

describe('register-socket-confirm-payment-handler payment proof guard', () => {
  it('rejects a socket-originated holding as authoritative payment evidence', async () => {
    const firestore = createFirestoreWithDocs({
      'payment_holdings/booking_1': {
        status: 'in_holding',
        source: 'socket_confirmPayment',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785,
      },
    });
    const paymentService = {
      getPaymentStatus: jest.fn().mockResolvedValue({
        success: true,
        status: 'in_holding',
        source: 'payment_holding_doc',
        amount: 8785,
      }),
    };

    const result = await resolveAuthoritativePaymentConfirmation({
      paymentService,
      firestore,
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 8785,
    });

    expect(result).toMatchObject({
      success: false,
      code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
    });
  });

  it('accepts a Woovi webhook holding as authoritative payment evidence', async () => {
    const firestore = createFirestoreWithDocs({
      'payment_holdings/booking_1': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785,
      },
    });
    const paymentService = {
      getPaymentStatus: jest.fn(),
    };

    const result = await resolveAuthoritativePaymentConfirmation({
      paymentService,
      firestore,
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 8785,
    });

    expect(result).toMatchObject({
      success: true,
      source: 'woovi_webhook',
    });
    expect(paymentService.getPaymentStatus).not.toHaveBeenCalled();
  });

  it('accepts a direct Woovi provider status as authoritative payment evidence', async () => {
    const firestore = createFirestoreWithDocs();
    const paymentService = {
      getPaymentStatus: jest.fn().mockResolvedValue({
        success: true,
        status: 'in_holding',
        source: 'woovi_provider',
        chargeId: 'charge_1',
        amount: 8785,
      }),
    };

    const result = await resolveAuthoritativePaymentConfirmation({
      paymentService,
      firestore,
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 8785,
    });

    expect(result).toMatchObject({
      success: true,
      source: 'woovi_provider',
    });
    expect(paymentService.getPaymentStatus).toHaveBeenCalledWith('charge_1');
  });

  it('keeps a sealed sandbox confirmation out of operational payment collections', async () => {
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
    const firestore = createFirestoreWithDocs({
      'payment_holdings/booking_1': {
        status: 'in_holding',
        source: 'woovi_webhook',
        chargeId: 'charge_1',
        amount: 9999,
      },
      'sandbox_payment_holdings/booking_1': {
        status: 'in_holding',
        source: 'sandbox_provider_verification',
        chargeId: 'charge_1',
        paymentId: 'charge_1',
        amount: 8785,
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox',
      },
    });
    const collectionSpy = jest.spyOn(firestore, 'collection');
    const paymentService = { getPaymentStatus: jest.fn() };

    const result = await resolveAuthoritativePaymentConfirmation({
      paymentService,
      firestore,
      bookingId: 'booking_1',
      references: ['charge_1'],
      expectedAmountInCents: 8785,
      paymentContext,
    });

    expect(result).toMatchObject({
      success: true,
      source: 'sandbox_provider_verification',
    });
    expect(new Set(collectionSpy.mock.calls.map(([name]) => name))).toEqual(new Set([
      'sandbox_payment_holdings',
      'sandbox_ride_payments',
    ]));
    expect(paymentService.getPaymentStatus).not.toHaveBeenCalled();
  });
});

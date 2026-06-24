const {
  resolveAuthoritativePaymentConfirmation,
} = require('../../../services/authoritative-payment-confirmation-service');

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
});

const { DisputeReviewService } = require('../../../services/dispute-review-service');

function createFirestoreMock() {
  const store = new Map();
  return {
    store,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return {
                exists: store.has(id),
                id,
                data: () => store.get(id)
              };
            },
            async set(value, options = {}) {
              const current = store.get(id) || {};
              store.set(id, options.merge ? { ...current, ...value } : value);
            }
          };
        },
        async get() {
          return {
            docs: Array.from(store.entries()).map(([id, data]) => ({
              id,
              data: () => data
            }))
          };
        }
      };
    }
  };
}

describe('dispute-review-service', () => {
  it('creates dispute and processes refund on approval', async () => {
    const firestore = createFirestoreMock();
    const paymentService = {
      processRefund: jest.fn(async () => ({
        success: true,
        refundId: 'refund-1'
      }))
    };
    const service = new DisputeReviewService({
      firebase: { getFirestore: () => firestore },
      paymentService
    });

    const dispute = await service.createDispute({
      bookingId: 'booking-1',
      chargeId: 'charge-1',
      userId: 'passenger-1',
      reasonCode: 'SERVICE_FAILURE',
      amount: 1299
    });

    const decided = await service.decideDispute(dispute.disputeId, {
      decision: 'APPROVED_REFUND',
      actorId: 'ops-1',
      resolutionNote: 'Falha operacional',
      refundAmount: 1299
    });

    expect(paymentService.processRefund).toHaveBeenCalledWith('charge-1', 1299, 'Falha operacional');
    expect(decided.status).toBe('APPROVED_REFUND');
    expect(decided.refundResult).toEqual(expect.objectContaining({ refundId: 'refund-1' }));
  });
});

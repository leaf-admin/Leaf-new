const { PassengerTrustService, STATUS } = require('../../../services/passenger-trust-service');

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
                data: () => store.get(id)
              };
            },
            async set(value, options = {}) {
              const current = store.get(id) || {};
              store.set(id, options.merge ? { ...current, ...value } : value);
            }
          };
        }
      };
    }
  };
}

describe('passenger-trust-service', () => {
  it('moves passenger to watchlist when score crosses threshold', async () => {
    const firestore = createFirestoreMock();
    const service = new PassengerTrustService({
      firebase: { getFirestore: () => firestore }
    });

    const profile = await service.recordSignal('passenger-1', 'confirmed_report');

    expect(profile.trustScore).toBe(20);
    expect(profile.trustStatus).toBe(STATUS.ACTIVE);

    const updated = await service.recordSignal('passenger-1', 'chargeback_abuse');

    expect(updated.trustScore).toBe(55);
    expect(updated.trustStatus).toBe(STATUS.WATCHLIST);
  });

  it('blocks and unblocks passenger via manual action', async () => {
    const firestore = createFirestoreMock();
    const service = new PassengerTrustService({
      firebase: { getFirestore: () => firestore }
    });

    const blocked = await service.blockPassenger('passenger-2', {
      operatorId: 'ops-1',
      reasonCode: 'fraud_confirmed'
    });
    expect(blocked.trustStatus).toBe(STATUS.HARD_BLOCKED);

    const eligibility = await service.checkEligibility('passenger-2');
    expect(eligibility.allowed).toBe(false);
    expect(eligibility.code).toBe('PASSENGER_HARD_BLOCKED');

    const unblocked = await service.unblockPassenger('passenger-2', {
      operatorId: 'ops-1',
      reasonCode: 'manual_review_clear'
    });
    expect(unblocked.trustStatus).toBe(STATUS.ACTIVE);

    const eligibilityAfter = await service.checkEligibility('passenger-2');
    expect(eligibilityAfter.allowed).toBe(true);
  });
});

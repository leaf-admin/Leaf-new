const { OperationalAreaPolicyService } = require('../../../services/operational-area-policy-service');

function createFirestoreMock() {
  const store = new Map();

  return {
    store,
    collection() {
      return {
        async get() {
          return {
            docs: Array.from(store.entries()).map(([id, data]) => ({
              id,
              data: () => data
            }))
          };
        },
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
        }
      };
    }
  };
}

describe('operational-area-policy-service', () => {
  it('blocks new requests when restricted policy has insufficient supply', async () => {
    const firestore = createFirestoreMock();
    const redisValues = new Map();
    const service = new OperationalAreaPolicyService({
      firebase: { getFirestore: () => firestore },
      redis: {
        getConnection: () => ({
          get: jest.fn(async (key) => redisValues.get(key) || '0'),
          incr: jest.fn(async (key) => {
            const next = Number(redisValues.get(key) || 0) + 1;
            redisValues.set(key, String(next));
            return next;
          }),
          expire: jest.fn(async () => 1)
        })
      }
    });

    const policy = await service.createPolicy({
      city: 'rio',
      regionHash: 'abc123',
      dispatchMode: 'restricted',
      minAvailableDrivers: 3,
      actorId: 'ops-1'
    });
    await service.activatePolicy(policy.policyId, { actorId: 'ops-1' });

    const decision = await service.evaluateCreateBooking({
      city: 'rio',
      regionHash: 'abc123',
      openRequests: 5,
      availableDrivers: 1
    });

    expect(decision.allowed).toBe(false);
    expect(decision.dispatchMode).toBe('restricted');
    expect(decision.reasons).toContain('available_drivers_below_min:1<3');
  });

  it('counts accepted requests per minute for active policy', async () => {
    const firestore = createFirestoreMock();
    const redisValues = new Map();
    const redis = {
      get: jest.fn(async (key) => redisValues.get(key) || '0'),
      incr: jest.fn(async (key) => {
        const next = Number(redisValues.get(key) || 0) + 1;
        redisValues.set(key, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1)
    };
    const service = new OperationalAreaPolicyService({
      firebase: { getFirestore: () => firestore },
      redis: { getConnection: () => redis }
    });

    const policy = await service.createPolicy({
      city: 'rio',
      regionHash: '*',
      dispatchMode: 'monitoring',
      maxNewRequestsPerMinute: 2,
      actorId: 'ops-1'
    });
    const activePolicy = await service.activatePolicy(policy.policyId, { actorId: 'ops-1' });

    await service.recordAcceptedRequest(activePolicy, 'abc123');
    const count = await service.getCurrentMinuteRequests(activePolicy, 'abc123');

    expect(count).toBe(1);
    expect(redis.incr).toHaveBeenCalled();
  });
});

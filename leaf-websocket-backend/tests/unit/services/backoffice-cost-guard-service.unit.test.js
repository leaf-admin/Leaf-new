const { BackofficeCostGuardService } = require('../../../services/backoffice-cost-guard-service');

function createRedisMock() {
  const store = new Map();
  const hashStore = new Map();
  return {
    get: jest.fn(async (key) => store.get(key) || null),
    incrby: jest.fn(async (key, delta) => {
      const next = Number(store.get(key) || 0) + Number(delta || 0);
      store.set(key, String(next));
      return next;
    }),
    hincrby: jest.fn(async (key, field, delta) => {
      const hash = hashStore.get(key) || {};
      hash[field] = String(Number(hash[field] || 0) + Number(delta || 0));
      hashStore.set(key, hash);
      return Number(hash[field]);
    }),
    hgetall: jest.fn(async (key) => hashStore.get(key) || {}),
    expire: jest.fn(async () => 1)
  };
}

function createService(env = {}) {
  const redis = createRedisMock();
  const previous = {};
  Object.keys(env).forEach((key) => {
    previous[key] = process.env[key];
    process.env[key] = env[key];
  });
  const service = new BackofficeCostGuardService({
    redis: {
      ensureConnection: jest.fn().mockResolvedValue(true),
      getConnection: jest.fn(() => redis)
    }
  });
  Object.keys(env).forEach((key) => {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  });
  return { service, redis };
}

describe('backoffice-cost-guard-service', () => {
  it('estimates known backoffice route reads and records daily usage', async () => {
    const { service, redis } = createService({
      BACKOFFICE_FIRESTORE_DAILY_READ_BUDGET: '1000'
    });

    const first = await service.recordEndpointReadEstimate('support.queue.backlog', {
      limit: 100,
      offset: 0
    });
    const second = await service.recordEndpointReadEstimate('audit.logs', {
      limit: 50
    });

    expect(first.estimatedFirestoreReads).toBe(125);
    expect(second.estimatedFirestoreReads).toBe(60);
    expect(second.dailyEstimatedFirestoreReads).toBe(185);
    expect(second.budgetStatus).toBe('ok');
    expect(redis.incrby).toHaveBeenCalledTimes(2);
    expect(redis.hincrby).toHaveBeenCalledTimes(2);
  });

  it('classifies budget thresholds predictably', async () => {
    const { service } = createService({
      BACKOFFICE_FIRESTORE_DAILY_READ_BUDGET: '1000',
      BACKOFFICE_FIRESTORE_WARNING_RATIO: '0.5',
      BACKOFFICE_FIRESTORE_DANGER_RATIO: '0.8'
    });

    await service.recordEndpointReadEstimate('audit.stats');
    const snapshot = await service.getDailyUsageSnapshot();

    expect(snapshot.dailyEstimatedFirestoreReads).toBe(1000);
    expect(snapshot.budgetStatus).toBe('limit');
    expect(snapshot.budgetUsagePercent).toBe(100);
  });

  it('treats command center cache hits as zero Firestore reads', () => {
    const { service } = createService();

    expect(service.estimateRouteReadCost('ops.commandCenter', { cacheStatus: 'HIT' })).toBe(0);
    expect(service.estimateRouteReadCost('ops.commandCenter', { cacheStatus: 'MISS' })).toBe(360);
  });
});

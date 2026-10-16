jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

jest.mock('../../../services/driver-activation-state-service', () => {
  const actual = jest.requireActual('../../../services/driver-activation-state-service');
  return {
    ...actual,
    resolveDriverActivationState: jest.fn()
  };
});

describe('driver-eligibility-service activation gate cache', () => {
  const originalEnv = { ...process.env };
  let redis;
  let store;
  let service;
  let activationService;

  const blocked = { state: 'DRIVER_ACTIVATION_SUSPENDED', canGoOnline: false };
  const approved = { state: 'DRIVER_ACTIVATION_APPROVED', canGoOnline: true };

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      LEAF_LAUNCH_PROFILE: 'full',
      LEAF_PILOT_CONTROLLED: 'false'
    };
    delete process.env.DRIVER_ACTIVATION_GATE_CACHE_TTL_SECONDS;

    store = new Map();
    redis = {
      get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
      set: jest.fn(async (key, value) => {
        store.set(key, value);
        return 'OK';
      }),
      hgetall: jest.fn().mockResolvedValue({}),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1)
    };
    require('../../../utils/redis-pool').getConnection.mockReturnValue(redis);
    activationService = require('../../../services/driver-activation-state-service');
    service = require('../../../services/driver-eligibility-service');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('resolves live by default and refreshes the cache', async () => {
    activationService.resolveDriverActivationState.mockResolvedValue(blocked);

    const result = await service.isDriverEligibleForRide('driver_1', null);

    expect(result.eligible).toBe(false);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      'driver_activation_gate:driver_1',
      JSON.stringify(blocked),
      'EX',
      20
    );
  });

  it('uses the cached gate only when the caller allows it', async () => {
    store.set('driver_activation_gate:driver_1', JSON.stringify(blocked));
    activationService.resolveDriverActivationState.mockResolvedValue(approved);

    const cachedResult = await service.isDriverEligibleForRide('driver_1', null, {}, {
      allowCachedActivation: true
    });
    expect(cachedResult.eligible).toBe(false);
    expect(activationService.resolveDriverActivationState).not.toHaveBeenCalled();

    // A committing caller (accept, go online) ignores the cache.
    await service.isDriverEligibleForRide('driver_1', null);
    expect(activationService.resolveDriverActivationState).toHaveBeenCalledTimes(1);
  });

  it('falls back to a live read on a cache miss', async () => {
    activationService.resolveDriverActivationState.mockResolvedValue(blocked);

    await service.isDriverEligibleForRide('driver_1', null, {}, { allowCachedActivation: true });

    expect(activationService.resolveDriverActivationState).toHaveBeenCalledTimes(1);
    expect(store.has('driver_activation_gate:driver_1')).toBe(true);
  });

  it('never caches an unavailable activation state', async () => {
    activationService.resolveDriverActivationState.mockRejectedValue(new Error('rtdb down'));

    const result = await service.isDriverEligibleForRide('driver_1', null, {}, {
      allowCachedActivation: true
    });

    expect(result.eligible).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('can be switched off', async () => {
    process.env.DRIVER_ACTIVATION_GATE_CACHE_TTL_SECONDS = '0';
    jest.resetModules();
    require('../../../utils/redis-pool').getConnection.mockReturnValue(redis);
    activationService = require('../../../services/driver-activation-state-service');
    service = require('../../../services/driver-eligibility-service');
    activationService.resolveDriverActivationState.mockResolvedValue(blocked);
    store.set('driver_activation_gate:driver_1', JSON.stringify(approved));

    const result = await service.isDriverEligibleForRide('driver_1', null, {}, {
      allowCachedActivation: true
    });

    expect(result.eligible).toBe(false);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

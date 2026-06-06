jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn((path) => `https://backend.leaf.test${path}`),
}));

describe('RuntimeConfigService', () => {
  const originalFetch = global.fetch;
  const originalDateNow = Date.now;
  let AsyncStorage;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    AsyncStorage = require('@react-native-async-storage/async-storage');
    Date.now = jest.fn(() => 1_000_000);
    global.fetch = jest.fn();
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockResolvedValue();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalDateNow;
  });

  function loadServiceClass() {
    return require('../src/services/RuntimeConfigService');
  }

  it('starts with conservative local defaults that are not operational overrides', () => {
    const { RuntimeConfigService } = loadServiceClass();
    const service = new RuntimeConfigService();

    expect(service.getCachedConfigSync().source).toBe('mobile_conservative_default');
    expect(service.hasOperationalConfigSync()).toBe(false);
    expect(service.getOperationalFeatureGatesSync()).toEqual({});
    expect(service.getMapsRoutingPolicySync().clientDirectGoogleFallback).toBe(false);
  });

  it('fetches runtime config from backend and persists a normalized cache', async () => {
    const { RuntimeConfigService } = loadServiceClass();
    const service = new RuntimeConfigService();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        config: {
          source: 'backend_env_and_overrides',
          schemaVersion: 1,
          cacheTtlSeconds: 120,
          featureGates: {
            smartPushEnabled: true,
          },
          mapsRoutingPolicy: {
            clientDirectGoogleFallback: true,
          },
        },
      }),
    });

    const config = await service.initialize({ forceRefresh: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://backend.leaf.test/api/app/runtime-config',
      expect.objectContaining({ method: 'GET' })
    );
    expect(config.source).toBe('backend_env_and_overrides');
    expect(config.receivedAt).toBe(1_000_000);
    expect(service.hasOperationalConfigSync()).toBe(true);
    expect(service.getOperationalFeatureGatesSync().smartPushEnabled).toBe(true);
    expect(service.getMapsRoutingPolicySync().clientDirectGoogleFallback).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@leaf_runtime_config',
      expect.stringContaining('backend_env_and_overrides')
    );
  });

  it('uses last valid stale config when backend is unavailable', async () => {
    const { RuntimeConfigService } = loadServiceClass();
    const service = new RuntimeConfigService();
    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({
      source: 'backend_env_and_overrides',
      schemaVersion: 1,
      cacheTtlSeconds: 1,
      staleTtlSeconds: 900,
      receivedAt: 940_000,
      featureGates: {
        dynamicPricingEnabled: false,
      },
    }));
    global.fetch.mockRejectedValueOnce(new Error('network down'));

    const config = await service.initialize();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(config.source).toBe('backend_env_and_overrides');
    expect(service.hasOperationalConfigSync()).toBe(true);
    expect(service.getOperationalFeatureGatesSync().dynamicPricingEnabled).toBe(false);
  });

  it('falls back to conservative defaults when cache and backend are unavailable', async () => {
    const { RuntimeConfigService } = loadServiceClass();
    const service = new RuntimeConfigService();
    AsyncStorage.getItem.mockResolvedValueOnce('{broken-json');
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ success: false, error: 'runtime_config_unavailable' }),
    });

    const config = await service.initialize({ forceRefresh: true });

    expect(config.source).toBe('mobile_conservative_default');
    expect(config.paymentRuntime.appMayCallProviderDirectly).toBe(false);
    expect(config.mapsRoutingPolicy.clientDirectGoogleFallback).toBe(false);
    expect(service.hasOperationalConfigSync()).toBe(false);
  });
});

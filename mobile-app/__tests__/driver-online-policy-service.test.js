jest.mock('@react-native-firebase/auth', () => {
  const authFn = jest.fn();
  return {
    __esModule: true,
    default: authFn,
  };
});

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn((path) => `https://backend.leaf.test${path}`),
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('DriverOnlinePolicyService', () => {
  const originalFetch = global.fetch;
  let auth;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn();
    auth = require('@react-native-firebase/auth').default;
    auth.mockReturnValue({
      currentUser: {
        getIdToken: jest.fn().mockResolvedValue('firebase-token'),
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function loadService() {
    return require('../src/services/DriverOnlinePolicyService');
  }

  it('requests online policy with Firebase bearer auth', async () => {
    const { DriverOnlinePolicyService } = loadService();
    const service = new DriverOnlinePolicyService();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        canGoOnline: true,
        blockers: [],
      }),
    });

    const policy = await service.getPolicy();

    expect(policy.canGoOnline).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://backend.leaf.test/api/drivers/me/online-policy',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-token',
        }),
      })
    );
  });

  it('normalizes liveness blockers as kycRequired', async () => {
    const { DriverOnlinePolicyService } = loadService();
    const service = new DriverOnlinePolicyService();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        canGoOnline: false,
        requiresLiveness: true,
        blockers: [{
          code: 'IDENTITY_VERIFICATION_REQUIRED',
          message: 'Por segurança, precisamos validar sua identidade.',
        }],
      }),
    });

    const policy = await service.evaluateOnlineIntent();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://backend.leaf.test/api/drivers/me/online-intent',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('online'),
      })
    );
    expect(policy.canGoOnline).toBe(false);
    expect(policy.kycRequired).toBe(true);
    expect(policy.reason).toBe('Por segurança, precisamos validar sua identidade.');
  });

  it('fails closed when user is not authenticated', async () => {
    const { DriverOnlinePolicyService } = loadService();
    const service = new DriverOnlinePolicyService();
    auth.mockReturnValue({ currentUser: null });

    const policy = await service.getPolicy();

    expect(policy.success).toBe(false);
    expect(policy.canGoOnline).toBe(false);
    expect(policy.code).toBe('ONLINE_POLICY_UNAVAILABLE');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

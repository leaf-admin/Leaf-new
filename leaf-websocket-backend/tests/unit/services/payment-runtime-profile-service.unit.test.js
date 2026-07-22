const SERVICE_PATH = '../../../services/payment-runtime-profile-service';

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const TEST_ENV_PREFIXES = ['WOOVI_', 'PAYMENT_SANDBOX_'];

function clearPaymentRuntimeEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (key === 'NODE_ENV' || TEST_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete process.env[key];
    }
  }
}

describe('PaymentRuntimeProfileService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    clearPaymentRuntimeEnvironment();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadClass() {
    return require(SERVICE_PATH).PaymentRuntimeProfileService;
  }

  it('uses the backend default Woovi environment when no profile matches', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_API_TOKEN = 'production-token';

    const PaymentRuntimeProfileService = loadClass();
    const service = new PaymentRuntimeProfileService({ cacheTtlMs: 1 });
    const profile = await service.resolveProfile({ passengerId: 'passenger-a' });

    expect(profile.profileId).toBe('env-default');
    expect(profile.environment).toBe('production');
    expect(profile.classificationUnavailable).toBe(true);
    expect(profile.wooviConfig.apiToken).toBe('production-token');
  });

  it('routes allowlisted users to sandbox using sandbox-specific credentials', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_API_TOKEN = 'production-token';
    process.env.WOOVI_SANDBOX_API_TOKEN = 'sandbox-token';
    process.env.PAYMENT_SANDBOX_USER_IDS = 'passenger-a';
    process.env.PAYMENT_SANDBOX_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const PaymentRuntimeProfileService = loadClass();
    const service = new PaymentRuntimeProfileService({ cacheTtlMs: 1 });
    const profile = await service.resolveProfile({ passengerId: 'passenger-a' });

    expect(profile.profileId).toBe('env-sandbox-allowlist');
    expect(profile.environment).toBe('sandbox');
    expect(profile.classificationUnavailable).toBe(false);
    expect(profile.wooviConfig.apiToken).toBe('sandbox-token');
    expect(profile.wooviConfig.baseUrl).toContain('sandbox');
  });

  it('ignores env sandbox allowlists without a short-lived expiration', async () => {
    process.env.WOOVI_ENVIRONMENT = 'production';
    process.env.WOOVI_API_TOKEN = 'production-token';
    process.env.WOOVI_SANDBOX_API_TOKEN = 'sandbox-token';
    process.env.PAYMENT_SANDBOX_USER_IDS = 'passenger-a';

    const PaymentRuntimeProfileService = loadClass();
    const service = new PaymentRuntimeProfileService({ cacheTtlMs: 1 });
    const profile = await service.resolveProfile({ passengerId: 'passenger-a' });

    expect(profile.profileId).toBe('env-default');
    expect(profile.environment).toBe('production');
  });

  it('requires short-lived sandbox profiles with explicit allowlist', () => {
    const PaymentRuntimeProfileService = loadClass();
    const service = new PaymentRuntimeProfileService({ cacheTtlMs: 1 });

    expect(service.validateProfilePayload({
      environment: 'sandbox',
      scope: 'users',
      userIds: ['passenger-a']
    })).toEqual({ ok: false, error: 'Perfis sandbox precisam de expiresAtIso' });

    expect(service.validateProfilePayload({
      environment: 'sandbox',
      scope: 'global',
      expiresAtIso: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })).toEqual({ ok: false, error: 'Sandbox global bloqueado por segurança' });
  });

  it('allows durable sandbox profiles only for explicit test users', () => {
    const PaymentRuntimeProfileService = loadClass();
    const service = new PaymentRuntimeProfileService({ cacheTtlMs: 1 });

    expect(service.validateProfilePayload({
      environment: 'sandbox',
      scope: 'users',
      testUserSandbox: true,
      userIds: ['passenger-a']
    })).toEqual({ ok: true, environment: 'sandbox', status: 'paused', scope: 'users' });

    expect(service.validateProfilePayload({
      environment: 'sandbox',
      scope: 'canary',
      testUserSandbox: true,
      userIds: ['passenger-a']
    })).toEqual({ ok: false, error: 'Perfis sandbox precisam de expiresAtIso' });

    expect(service.validateProfilePayload({
      environment: 'sandbox',
      scope: 'users',
      testUserSandbox: true,
      userIds: ['passenger-a'],
      phones: ['5521102938475']
    })).toEqual({ ok: false, error: 'Perfis sandbox precisam de expiresAtIso' });
  });
});

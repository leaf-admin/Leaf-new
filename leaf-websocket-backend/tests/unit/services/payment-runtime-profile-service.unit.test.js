const SERVICE_PATH = '../../../services/payment-runtime-profile-service';

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const ENV_KEYS = [
  'NODE_ENV',
  'WOOVI_ENVIRONMENT',
  'WOOVI_API_TOKEN',
  'WOOVI_SANDBOX_API_TOKEN',
  'PAYMENT_SANDBOX_USER_IDS',
  'PAYMENT_SANDBOX_PHONE_NUMBERS',
  'PAYMENT_SANDBOX_EXPIRES_AT',
  'PAYMENT_ALLOW_GLOBAL_SANDBOX_PROFILE'
];

describe('PaymentRuntimeProfileService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    for (const key of ENV_KEYS) delete process.env[key];
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
});

jest.mock('../../../services/payment-service/shared', () => ({
  firebaseConfig: { getFirestore: jest.fn() },
  getWooviConfig: jest.fn((options) => options),
  logStructured: jest.fn()
}));

const { firebaseConfig, getWooviConfig } = require('../../../services/payment-service/shared');
const Methods = require('../../../services/payment-service/02-events-and-status-cache');

describe('Woovi config for an existing sandbox charge', () => {
  let service;
  let intent;
  let profile;
  let get;
  let doc;
  let collection;

  beforeEach(() => {
    jest.clearAllMocks();
    intent = {
      found: true,
      providerEnvironment: 'sandbox',
      paymentProfileId: 'original-qa-profile',
      financialContext: {
        namespace: 'sandbox', providerEnvironment: 'sandbox',
        paymentProfileSource: 'firestore', paymentProfileId: 'original-qa-profile'
      }
    };
    profile = {
      environment: 'sandbox', provider: 'woovi', status: 'paused',
      expiresAtIso: '2020-01-01T00:00:00Z',
      authorizationAppId: 'original-sandbox-test-credential',
      clientId: 'original-client', baseUrl: 'https://api.woovi-sandbox.com/api/v1'
    };
    get = jest.fn(async () => ({ exists: true, data: () => profile }));
    doc = jest.fn(() => ({ get }));
    collection = jest.fn(() => ({ doc }));
    firebaseConfig.getFirestore.mockReturnValue({ collection });
    service = new Methods();
    service.getAdvancePaymentIntentByChargeId = jest.fn(async () => intent);
  });

  it('uses the original profile, including paused/expired profiles, rather than current user classification', async () => {
    service.paymentRuntimeProfileService = { resolveProfile: jest.fn() };
    const result = await service.resolveWooviConfigForCharge('charge-original');
    expect(collection).toHaveBeenCalledWith('payment_runtime_profiles');
    expect(doc).toHaveBeenCalledWith('original-qa-profile');
    expect(result.wooviConfig).toMatchObject({
      environment: 'sandbox', authorizationAppId: 'original-sandbox-test-credential',
      clientId: 'original-client', baseUrl: profile.baseUrl
    });
    expect(service.paymentRuntimeProfileService.resolveProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', () => get.mockResolvedValue({ exists: false })],
    ['unavailable Firestore', () => firebaseConfig.getFirestore.mockReturnValue(null)],
    ['failed lookup', () => get.mockRejectedValue(new Error('unavailable'))],
    ['production profile', () => { profile.environment = 'production'; }],
    ['other provider', () => { profile.provider = 'other'; }],
    ['conflicting profile ID', () => { intent.paymentProfileId = 'another-profile'; }],
    ['missing original ID', () => { delete intent.paymentProfileId; delete intent.financialContext.paymentProfileId; }]
  ])('does not fall back to generic credentials when the original profile is %s', async (_, setup) => {
    setup();
    await expect(service.resolveWooviConfigForCharge('charge-original')).resolves.toBeNull();
    expect(getWooviConfig).not.toHaveBeenCalled();
  });

  it.each(['sandbox', 'production'])('preserves the env-based %s config path', async (environment) => {
    intent.providerEnvironment = environment;
    intent.financialContext = { paymentProfileSource: 'env', providerEnvironment: environment };
    const result = await service.resolveWooviConfigForCharge('charge-env');
    expect(result.wooviConfig).toEqual({ environment });
    expect(collection).not.toHaveBeenCalled();
  });

  it('preserves existing operational config selection even for Firestore profiles', async () => {
    intent.providerEnvironment = 'production';
    const result = await service.resolveWooviConfigForCharge('charge-operational');
    expect(result.wooviConfig).toEqual({ environment: 'production' });
    expect(collection).not.toHaveBeenCalled();
  });

  it('does not resolve credentials for a conflicting or missing charge', async () => {
    intent = { found: false, code: 'PAYMENT_INTENT_NAMESPACE_CONFLICT' };
    await expect(service.resolveWooviConfigForCharge('charge-conflict')).resolves.toBeNull();
    expect(getWooviConfig).not.toHaveBeenCalled();
  });
});

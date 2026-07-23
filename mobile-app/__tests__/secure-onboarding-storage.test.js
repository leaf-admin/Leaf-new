const mockStorage = new Map();
const mockAuthState = {
  currentUser: { uid: 'uid-a' },
};

jest.mock('@react-native-firebase/auth', () => () => mockAuthState);

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async key => {
    mockStorage.delete(key);
  }),
  multiGet: jest.fn(async keys => keys.map(key => [key, mockStorage.get(key) ?? null])),
  multiRemove: jest.fn(async keys => {
    keys.forEach(key => mockStorage.delete(key));
  }),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digestStringAsync: jest.fn(async value => `hash:${value.length}`),
}));

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const {
  loadSensitiveData,
  saveSensitiveData,
  saveStepData,
} = require('../src/utils/secureOnboardingStorage');

describe('secure onboarding storage step preservation', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockStorage.set('@auth_uid', 'uid-a');
    mockStorage.set('@onboarding_owner_uid', 'uid-a');
    mockAuthState.currentUser = { uid: 'uid-a' };
    jest.clearAllMocks();
  });

  it('keeps sensitive data from earlier steps when credentials are saved later', async () => {
    await expect(saveSensitiveData('document_data', {
      cpf: '123.456.789-01',
      email: 'driver@leaf.app.br',
    })).resolves.toBe(true);
    await expect(saveSensitiveData('credentials', {
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
      marketingOptIn: false,
    })).resolves.toBe(true);

    await expect(loadSensitiveData('document_data')).resolves.toEqual(
      expect.objectContaining({
        cpf: '123.456.789-01',
        email: 'driver@leaf.app.br',
      }),
    );
    await expect(loadSensitiveData('credentials')).resolves.toEqual(
      expect.objectContaining({
        acceptTerms: true,
        acceptPrivacy: true,
        consentBackgroundCheck: true,
        marketingOptIn: false,
      }),
    );
  });

  it('does not read or overwrite onboarding data owned by a different Firebase session', async () => {
    mockStorage.set('@onboarding_encrypted_data', JSON.stringify({
      document_data: { cpf: '123.456.789-01' },
    }));
    mockAuthState.currentUser = { uid: 'uid-b' };

    await expect(loadSensitiveData('document_data')).resolves.toEqual({});
    await expect(saveSensitiveData('document_data', {
      cpf: '987.654.321-00',
    })).resolves.toBe(false);
    await expect(saveStepData('document_data', {
      cpf: '987.654.321-00',
      gender: 'M',
    })).resolves.toBe(false);

    expect(mockStorage.get('@onboarding_encrypted_data')).toBe(JSON.stringify({
      document_data: { cpf: '123.456.789-01' },
    }));
  });
});

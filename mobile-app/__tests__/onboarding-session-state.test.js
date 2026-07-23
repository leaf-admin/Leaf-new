const mockStorage = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key, value) => {
    mockStorage.set(key, value);
  }),
  multiGet: jest.fn(async keys => keys.map(key => [key, mockStorage.get(key) ?? null])),
  multiSet: jest.fn(async entries => {
    entries.forEach(([key, value]) => mockStorage.set(key, value));
  }),
  multiRemove: jest.fn(async keys => {
    keys.forEach(key => mockStorage.delete(key));
  }),
}));

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const {
  ONBOARDING_OWNER_UID_STORAGE_KEY,
  persistPhoneValidatedOnboardingSession,
  validateOnboardingStorageOwner,
} = require('../src/utils/onboardingSessionState');

describe('onboarding session ownership', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  it('preserves progress only when the verified UID owns the existing onboarding', async () => {
    mockStorage.set('@auth_uid', 'uid-a');
    mockStorage.set(ONBOARDING_OWNER_UID_STORAGE_KEY, 'uid-a');
    mockStorage.set('@onboarding_progress', JSON.stringify({ profile_selection: true }));
    mockStorage.set(
      'onboarding_phone_validation',
      JSON.stringify({ user: { uid: 'uid-a' }, phoneNumber: '+5521999999999' }),
    );

    await persistPhoneValidatedOnboardingSession({
      uid: 'uid-a',
      phoneNumber: '+5521999999999',
    });

    expect(JSON.parse(mockStorage.get('@onboarding_progress'))).toEqual({
      phone_validation: true,
      profile_selection: true,
    });
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  });

  it('removes every stale step before starting onboarding for a different UID', async () => {
    mockStorage.set('@auth_uid', 'uid-a');
    mockStorage.set(ONBOARDING_OWNER_UID_STORAGE_KEY, 'uid-a');
    mockStorage.set('@onboarding_progress', JSON.stringify({ credentials: true }));
    mockStorage.set('onboarding_profile_selection', JSON.stringify({ userType: 'driver' }));
    mockStorage.set('onboarding_credentials', JSON.stringify({ acceptTerms: true }));

    await persistPhoneValidatedOnboardingSession({
      uid: 'uid-b',
      phoneNumber: '+5521888888888',
    });

    expect(JSON.parse(mockStorage.get('@onboarding_progress'))).toEqual({
      phone_validation: true,
    });
    expect(mockStorage.has('onboarding_profile_selection')).toBe(false);
    expect(mockStorage.has('onboarding_credentials')).toBe(false);
    expect(mockStorage.get(ONBOARDING_OWNER_UID_STORAGE_KEY)).toBe('uid-b');
  });

  it('fails closed when the active auth UID differs from the onboarding owner', async () => {
    mockStorage.set('@auth_uid', 'uid-b');
    mockStorage.set(ONBOARDING_OWNER_UID_STORAGE_KEY, 'uid-a');

    await expect(validateOnboardingStorageOwner()).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        reason: 'OWNER_UID_MISMATCH',
      }),
    );
  });

  it('fails closed when native Firebase restored a different UID than the local session', async () => {
    mockStorage.set('@auth_uid', 'uid-a');
    mockStorage.set(ONBOARDING_OWNER_UID_STORAGE_KEY, 'uid-a');

    await expect(validateOnboardingStorageOwner({ activeAuthUid: 'uid-b' })).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        activeAuthUid: 'uid-b',
        authUid: 'uid-a',
        ownerUid: 'uid-a',
        reason: 'ACTIVE_AUTH_UID_MISMATCH',
      }),
    );
  });

  it('adopts a legacy onboarding only when its verified phone step proves the same UID', async () => {
    mockStorage.set('@auth_uid', 'uid-a');
    mockStorage.set(
      'onboarding_phone_validation',
      JSON.stringify({ user: { uid: 'uid-a' }, phoneNumber: '+5521999999999' }),
    );

    await expect(validateOnboardingStorageOwner()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        reason: 'TRUSTED_LEGACY_ADOPTED',
      }),
    );
    expect(mockStorage.get(ONBOARDING_OWNER_UID_STORAGE_KEY)).toBe('uid-a');
  });
});

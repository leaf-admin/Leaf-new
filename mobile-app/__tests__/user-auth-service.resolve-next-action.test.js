jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('@react-native-firebase/database', () => () => ({
  ref: jest.fn(() => ({
    once: jest.fn(async () => ({ exists: () => false, val: () => null }))
  }))
}));

jest.mock('@react-native-firebase/auth', () => () => ({}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined)
}));

jest.mock('../src/services/httpClient', () => ({
  apiClient: {
    post: jest.fn()
  }
}));

const UserAuthService = require('../src/services/UserAuthService').default;

describe('UserAuthService.resolveNextActionFromPayload', () => {
  test('forces OTP when legacy payload says requiresPassword without password configured', () => {
    expect(
      UserAuthService.resolveNextActionFromPayload({
        requiresPassword: true,
        hasPassword: false
      })
    ).toBe('OTP_REQUIRED');
  });

  test('allows password login when password is configured and legacy payload requires password', () => {
    expect(
      UserAuthService.resolveNextActionFromPayload({
        requiresPassword: true,
        hasPassword: true
      })
    ).toBe('PASSWORD_LOGIN');
  });

  test('ignores PASSWORD_LOGIN nextAction if backend reports no password configured', () => {
    expect(
      UserAuthService.resolveNextActionFromPayload({
        nextAction: 'PASSWORD_LOGIN',
        hasPassword: false
      })
    ).toBe('OTP_REQUIRED');
  });

  test('keeps PASSWORD_LOGIN when nextAction is explicit and password exists', () => {
    expect(
      UserAuthService.resolveNextActionFromPayload({
        nextAction: 'PASSWORD_LOGIN',
        hasPassword: true
      })
    ).toBe('PASSWORD_LOGIN');
  });

  test('defaults to OTP when payload is empty', () => {
    expect(UserAuthService.resolveNextActionFromPayload({})).toBe('OTP_REQUIRED');
  });
});

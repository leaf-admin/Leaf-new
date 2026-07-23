const mockAsyncStorageGetItem = jest.fn();

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args) => mockAsyncStorageGetItem(...args),
}));

jest.mock('../src/config/backendBaseUrl', () => ({
  buildBackendUrl: jest.fn(() => 'https://api.test/api'),
}));

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn(error => error),
}));

import authService from '../src/services/AuthService';

describe('AuthService QA request identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorageGetItem.mockImplementation(async key => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'qa-signed-id-token';
      if (key === '@auth_uid') return 'passenger_qa_1';
      if (key === '@user_data') {
        return JSON.stringify({ uid: 'passenger_qa_1', isTestUser: true });
      }
      return null;
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ success: true })),
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('uses the signed seeded QA token when the simulator has no Firebase currentUser', async () => {
    await authService.authenticatedRequest('/account/profile', {
      method: 'GET',
      timeoutMs: 1000,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/api/account/profile',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer qa-signed-id-token',
        }),
      })
    );
  });
});

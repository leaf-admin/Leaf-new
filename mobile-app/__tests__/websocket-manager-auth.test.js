const mockAsyncStorageGetItem = jest.fn();

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (...args) => mockAsyncStorageGetItem(...args),
}));

jest.mock('socket.io-client', () => jest.fn());

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn((payload, context = {}) => {
    const error = new Error(payload?.message || context?.fallbackMessage || 'Erro');
    if (payload?.code) {
      error.code = payload.code;
    }
    return error;
  }),
}));

jest.mock('../src/config/NetworkConfig', () => ({
  getWebSocketURL: jest.fn(() => 'https://socket.test'),
}));

import WebSocketManager from '../src/services/WebSocketManager';

describe('WebSocketManager auth QA bypass', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@auth_uid') return 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
          usertype: 'customer',
          isTestUser: true,
        });
      }
      return null;
    });
  });

  it('prefers a seeded QA idToken over the uid-based bypass', async () => {
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'firebase-id-token-driver-two';
      if (key === '@auth_uid') return 'F0CIj7noqrc74qdPJD80T9FCxME2';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
          usertype: 'driver',
          isTestUser: true,
        });
      }
      return null;
    });

    const manager = WebSocketManager.getInstance();
    const authPayload = await manager._buildSocketAuthPayload();

    expect(authPayload).toEqual({ token: 'firebase-id-token-driver-two' });
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
    expect(manager._buildSocketQueryPayload(authPayload)).toEqual({});
  });

  it('includes the seeded QA idToken in the authenticate event payload', async () => {
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return 'firebase-id-token-driver-two';
      if (key === '@auth_uid') return 'F0CIj7noqrc74qdPJD80T9FCxME2';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
          usertype: 'driver',
          isTestUser: true,
        });
      }
      return null;
    });

    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
    };

    await manager.authenticate('F0CIj7noqrc74qdPJD80T9FCxME2', 'driver', { force: true });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'authenticate',
      expect.objectContaining({
        uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
        userType: 'driver',
        token: 'firebase-id-token-driver-two',
      }),
    );
  });

  it('rebuilds QA bypass dynamically when authenticate is called', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
    };
    manager.qaSocketBypassState = { enabled: false, uid: null };

    await manager.authenticate('OjML1wSzdNRaynjqMRlSW1Y0LVy2', 'customer', { force: true });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'authenticate',
      expect.objectContaining({
        uid: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
        userType: 'customer',
        qaAuthBypass: true,
        qaAutomation: true,
      }),
    );
  });

  it('builds query payload for QA handshake duplication', async () => {
    const manager = WebSocketManager.getInstance();

    const authPayload = await manager._buildSocketAuthPayload();

    expect(authPayload).toEqual(
      expect.objectContaining({
        uid: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
        qaAuthBypass: true,
        qaAutomation: true,
      }),
    );
    expect(manager._buildSocketQueryPayload(authPayload)).toEqual({
      uid: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
      qaAuthBypass: 'true',
      qaAutomation: 'true',
    });
  });

  it('correlates availability responses by requestId', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
    };
    manager.isAuthenticated = true;
    manager.authenticatedUserId = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
    manager.authenticatedUserType = 'customer';

    const availabilityPromise = manager.checkRideAvailability({
      customerId: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
      carType: 'Leaf Plus',
    });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'checkRideAvailability',
      expect.objectContaining({
        customerId: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
        carType: 'Leaf Plus',
        requestId: expect.any(String),
      }),
    );

    const [, emittedPayload] = manager.socket.emit.mock.calls.find(
      ([eventName]) => eventName === 'checkRideAvailability',
    );

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: false,
      requestId: 'stale-request',
    });

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: true,
      requestId: emittedPayload.requestId,
    });

    await expect(availabilityPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        available: true,
        requestId: emittedPayload.requestId,
      }),
    );
  });
});

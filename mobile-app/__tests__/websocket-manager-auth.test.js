const mockAsyncStorageGetItem = jest.fn();
const mockFirebaseAuthState = {
  currentUser: null,
};

jest.mock('@react-native-firebase/auth', () => () => ({
  get currentUser() {
    return mockFirebaseAuthState.currentUser;
  },
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
  getApiURL: jest.fn(() => 'https://api.test'),
}));

import io from 'socket.io-client';
import { Platform } from 'react-native';
import WebSocketManager from '../src/services/WebSocketManager';

function buildJwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

describe('WebSocketManager auth QA bypass', () => {
  let originalPlatformOS;

  beforeEach(() => {
    originalPlatformOS = Platform.OS;
    WebSocketManager.instance = null;
    mockFirebaseAuthState.currentUser = null;
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

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalPlatformOS,
    });
  });

  it('prefers the persisted QA idToken over uid bypass when no Firebase user is mounted', async () => {
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

    expect(authPayload).toEqual(
      expect.objectContaining({
        token: 'firebase-id-token-driver-two',
      }),
    );
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
  });

  it('prefers the persisted QA idToken over a stale Firebase user in test mode', async () => {
    const staleGetIdToken = jest.fn(async () => 'stale-passenger-token');
    mockFirebaseAuthState.currentUser = {
      uid: 'stale-passenger-uid',
      getIdToken: staleGetIdToken,
    };
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

    expect(staleGetIdToken).not.toHaveBeenCalled();
    expect(authPayload).toEqual(
      expect.objectContaining({
        token: 'firebase-id-token-driver-two',
      }),
    );
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
  });

  it('ignores an expired persisted QA idToken and falls back to Firebase refresh', async () => {
    const freshGetIdToken = jest.fn(async () => 'fresh-firebase-token');
    mockFirebaseAuthState.currentUser = {
      uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
      getIdToken: freshGetIdToken,
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'F0CIj7noqrc74qdPJD80T9FCxME2',
          exp: Math.floor(Date.now() / 1000) - 60,
        });
      }
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
    const authPayload = await manager._buildSocketAuthPayload({ forceRefresh: true });

    expect(freshGetIdToken).toHaveBeenCalledWith(true);
    expect(authPayload).toEqual(
      expect.objectContaining({
        token: 'fresh-firebase-token',
      }),
    );
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
  });

  it('falls back to QA uid bypass when no Firebase user or persisted QA idToken exists', async () => {
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
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

    expect(authPayload).toEqual(
      expect.objectContaining({
        token: null,
        uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
        qaAuthBypass: true,
        qaAutomation: true,
      }),
    );
    expect(manager.qaSocketBypassState).toEqual({ enabled: true, uid: 'F0CIj7noqrc74qdPJD80T9FCxME2' });
    expect(manager._buildSocketQueryPayload(authPayload)).toEqual({
      uid: 'F0CIj7noqrc74qdPJD80T9FCxME2',
      qaAuthBypass: 'true',
      qaAutomation: 'true',
    });
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

  it('sends the native file Origin header accepted by production socket CORS', () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });

    const manager = WebSocketManager.getInstance();
    manager._createSocketClient(
      'wss://socket.62.169.31.231.sslip.io/socket.io?ignored=1',
      { token: 'firebase-token' },
      {},
    );

    expect(io).toHaveBeenCalledWith(
      'wss://socket.62.169.31.231.sslip.io/socket.io?ignored=1',
      expect.objectContaining({
        extraHeaders: {
          Origin: 'file://',
        },
      }),
    );
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

  it('deduplicates in-flight availability checks and reuses a short cache window', async () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      emit: jest.fn(),
      on: jest.fn(),
    };
    manager.isAuthenticated = true;
    manager.authenticatedUserId = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
    manager.authenticatedUserType = 'customer';

    const payload = {
      customerId: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
      carType: 'Leaf Plus',
      pickupLocation: { lat: -22.91, lng: -43.17 },
      destinationLocation: { lat: -22.90, lng: -43.20 },
    };

    const firstPromise = manager.checkRideAvailability(payload);
    const secondPromise = manager.checkRideAvailability(payload);

    expect(manager.socket.emit).toHaveBeenCalledTimes(1);

    const [, emittedPayload] = manager.socket.emit.mock.calls[0];

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: true,
      requestId: emittedPayload.requestId,
    });

    const [firstResult, secondResult] = await Promise.all([
      firstPromise,
      secondPromise,
    ]);

    expect(firstResult).toEqual(
      expect.objectContaining({
        success: true,
        available: true,
      }),
    );
    expect(secondResult).toEqual(
      expect.objectContaining({
        success: true,
        available: true,
      }),
    );

    const cachedResult = await manager.checkRideAvailability(payload);

    expect(manager.socket.emit).toHaveBeenCalledTimes(1);
    expect(cachedResult).toEqual(
      expect.objectContaining({
        success: true,
        available: true,
      }),
    );
  });

  it('registers sessionTerminated as a first-class server event', () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      id: 'socket-old',
      io: {
        engine: {
          transport: {
            name: 'websocket',
          },
        },
      },
      on: jest.fn(),
    };

    manager.setupListeners();

    const registration = manager.socket.on.mock.calls.find(
      ([eventName]) => eventName === 'sessionTerminated',
    );
    expect(registration).toBeTruthy();

    const listener = jest.fn();
    manager.on('sessionTerminated', listener);
    registration[1]({
      code: 'SESSION_REPLACED',
      userId: 'driver-123',
      newSocketId: 'socket-new',
      previousSocketId: 'socket-old',
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SESSION_REPLACED',
        userId: 'driver-123',
        newSocketId: 'socket-new',
        previousSocketId: 'socket-old',
        __source: 'socket_event',
      }),
    );
  });

  it('does not loop auth recovery when local backend rejects QA bypass without token', () => {
    const manager = WebSocketManager.getInstance();
    manager.socket = {
      connected: true,
      id: 'socket-qa',
      io: {
        engine: {
          transport: {
            name: 'websocket',
          },
        },
      },
      on: jest.fn(),
    };
    manager.authCredentials = {
      userId: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
      userType: 'customer',
    };
    manager.qaSocketBypassState = {
      enabled: true,
      uid: 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
    };
    const recoverSpy = jest
      .spyOn(manager, '_recoverAuthentication')
      .mockResolvedValue(true);
    const listener = jest.fn();

    manager.setupListeners();
    manager.on('auth_error', listener);

    const registration = manager.socket.on.mock.calls.find(
      ([eventName]) => eventName === 'auth_error',
    );
    expect(registration).toBeTruthy();

    registration[1]({ message: 'Token de autenticação ausente' });

    expect(recoverSpy).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Token de autenticação ausente',
        __source: 'socket_event',
      }),
    );
  });
});

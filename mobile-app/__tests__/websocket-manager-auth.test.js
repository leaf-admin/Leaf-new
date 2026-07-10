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

async function flushMicrotasks(iterations = 5) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createPendingSocketMock() {
  const handlers = new Map();
  const socket = {
    connected: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    close: jest.fn(),
    removeAllListeners: jest.fn(() => handlers.clear()),
    on: jest.fn((eventName, callback) => {
      handlers.set(eventName, callback);
    }),
    off: jest.fn((eventName) => {
      handlers.delete(eventName);
    }),
  };

  return socket;
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

  it('uses a persisted QA idToken for an explicit test user even when test mode flag is missing', async () => {
    const token = buildJwt({
      sub: 'F0CIj7noqrc74qdPJD80T9FCxME2',
      user_id: 'F0CIj7noqrc74qdPJD80T9FCxME2',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return null;
      if (key === '@qa_socket_id_token') return token;
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
        token,
      }),
    );
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
  });

  it('uses Firebase auth for real sessions even when QA storage keys exist', async () => {
    const freshGetIdToken = jest.fn(async () => 'real-firebase-token');
    mockFirebaseAuthState.currentUser = {
      uid: 'real-driver-uid',
      getIdToken: freshGetIdToken,
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'false';
      if (key === '@qa_socket_id_token') {
        return buildJwt({
          sub: 'qa-driver-uid',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
      }
      if (key === '@auth_uid') return 'real-driver-uid';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'real-driver-uid',
          usertype: 'driver',
        });
      }
      return null;
    });

    const manager = WebSocketManager.getInstance();
    const authPayload = await manager._buildSocketAuthPayload({ forceRefresh: true });

    expect(freshGetIdToken).toHaveBeenCalledWith(true);
    expect(authPayload).toEqual(
      expect.objectContaining({
        token: 'real-firebase-token',
      }),
    );
    expect(authPayload.qaAuthBypass).toBeUndefined();
    expect(manager.qaSocketBypassState).toEqual({ enabled: false, uid: null });
  });

  it('does not send QA bypass or a blank token when production has no Firebase session', async () => {
    mockFirebaseAuthState.currentUser = null;
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'false';
      if (key === '@auth_uid') return 'real-driver-uid';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'real-driver-uid',
          usertype: 'driver',
        });
      }
      return null;
    });

    const manager = WebSocketManager.getInstance();
    const authPayload = await manager._buildSocketAuthPayload();

    expect(authPayload).toEqual({
      token: null,
      authUnavailable: true,
    });
    expect(manager._buildSocketQueryPayload(authPayload)).toEqual({});
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

  it('replaces stale in-memory socket credentials with the signed QA identity during authenticate', async () => {
    const token = buildJwt({
      sub: 'passenger_qa_1',
      user_id: 'passenger_qa_1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockFirebaseAuthState.currentUser = {
      uid: 'driver_stale_1',
      getIdToken: jest.fn(async () => 'driver-stale-token'),
    };
    mockAsyncStorageGetItem.mockImplementation(async (key) => {
      if (key === '@test_mode') return 'true';
      if (key === '@qa_socket_id_token') return token;
      if (key === '@auth_uid') return 'passenger_qa_1';
      if (key === '@user_data') {
        return JSON.stringify({
          uid: 'passenger_qa_1',
          usertype: 'customer',
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

    await manager.authenticate('driver_stale_1', 'driver', { force: true });

    expect(manager.socket.emit).toHaveBeenCalledWith(
      'authenticate',
      expect.objectContaining({
        uid: 'passenger_qa_1',
        userType: 'customer',
        token,
      }),
    );
    expect(manager.authCredentials).toEqual({
      userId: 'passenger_qa_1',
      userType: 'customer',
    });
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
      'wss://socket.leaf.app.br/socket.io?ignored=1',
      { token: 'firebase-token' },
      {},
    );

    expect(io).toHaveBeenCalledWith(
      'wss://socket.leaf.app.br/socket.io?ignored=1',
      expect.objectContaining({
        extraHeaders: {
          Origin: 'file://',
        },
      }),
    );
  });

  it('waits the configured socket connect timeout without falling back to the API host', async () => {
    jest.useFakeTimers();
    const sockets = [];
    let createSocketClientSpy = null;
    let buildSocketAuthPayloadSpy = null;

    try {
      const manager = WebSocketManager.getInstance();
      buildSocketAuthPayloadSpy = jest
        .spyOn(manager, '_buildSocketAuthPayload')
        .mockResolvedValue({
          token: null,
          uid: 'qa-user',
          qaAuthBypass: true,
          qaAutomation: true,
        });
      createSocketClientSpy = jest
        .spyOn(manager, '_createSocketClient')
        .mockImplementation(() => {
          const socket = createPendingSocketMock();
          sockets.push(socket);
          return socket;
        });
      const connectPromise = manager.connect().catch((error) => error);

      await flushMicrotasks();

      expect(createSocketClientSpy).toHaveBeenCalledTimes(1);
      expect(createSocketClientSpy).toHaveBeenLastCalledWith(
        'https://socket.test',
        expect.objectContaining({
          qaAuthBypass: true,
          qaAutomation: true,
        }),
        expect.objectContaining({
          qaAuthBypass: 'true',
          qaAutomation: 'true',
        }),
      );

      await jest.advanceTimersByTimeAsync(10000);
      expect(createSocketClientSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(19999);
      expect(createSocketClientSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(createSocketClientSpy).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30000);

      const error = await connectPromise;
      expect(error.code).toBe('WS_CONNECT_TIMEOUT');
      expect(sockets[0].disconnect).toHaveBeenCalled();
    } finally {
      createSocketClientSpy?.mockRestore();
      buildSocketAuthPayloadSpy?.mockRestore();
      jest.useRealTimers();
    }
  });

  it('singleflights concurrent connect calls before socket creation', async () => {
    const manager = WebSocketManager.getInstance();
    let resolveFreshSocket;
    const connectFreshSocketSpy = jest
      .spyOn(manager, '_connectFreshSocket')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveFreshSocket = resolve;
          }),
      );

    const firstConnect = manager.connect();
    const secondConnect = manager.connect();

    expect(connectFreshSocketSpy).toHaveBeenCalledTimes(1);

    resolveFreshSocket(true);
    await expect(firstConnect).resolves.toBe(true);
    await expect(secondConnect).resolves.toBe(true);

    connectFreshSocketSpy.mockRestore();
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

  it('bypasses cached availability when forceRefresh is requested', async () => {
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

    const cachedPromise = manager.checkRideAvailability(payload);
    const [, cachedPayload] = manager.socket.emit.mock.calls[0];

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: false,
      code: 'NO_DRIVERS_AVAILABLE',
      requestId: cachedPayload.requestId,
    });

    await expect(cachedPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        available: false,
      }),
    );

    const freshPromise = manager.checkRideAvailability(payload, {
      forceRefresh: true,
    });

    expect(manager.socket.emit).toHaveBeenCalledTimes(2);

    const [, freshPayload] = manager.socket.emit.mock.calls[1];
    expect(freshPayload.requestId).not.toBe(cachedPayload.requestId);

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: true,
      requestId: freshPayload.requestId,
    });

    await expect(freshPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        available: true,
      }),
    );
  });

  it('does not cache no-driver availability results', async () => {
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
      pickupLocation: { lat: -22.857, lng: -43.309 },
      destinationLocation: { lat: -22.9727, lng: -43.1869 },
    };

    const unavailablePromise = manager.checkRideAvailability(payload);
    const [, unavailablePayload] = manager.socket.emit.mock.calls[0];

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: false,
      hasDrivers: false,
      code: 'NO_DRIVERS_AVAILABLE',
      requestId: unavailablePayload.requestId,
    });

    await expect(unavailablePromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        available: false,
      }),
    );

    const nextPromise = manager.checkRideAvailability(payload);
    expect(manager.socket.emit).toHaveBeenCalledTimes(2);

    const [, nextPayload] = manager.socket.emit.mock.calls[1];
    expect(nextPayload.requestId).not.toBe(unavailablePayload.requestId);

    manager.emit('rideAvailabilityResult', {
      success: true,
      available: true,
      hasDrivers: true,
      code: 'DRIVERS_AVAILABLE',
      requestId: nextPayload.requestId,
    });

    await expect(nextPromise).resolves.toEqual(
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

  it('exposes and clears the latest authenticated payload for runtime rehydration', () => {
    const manager = WebSocketManager.getInstance();
    const syncSpy = jest
      .spyOn(manager, 'syncActiveRideWithAck')
      .mockResolvedValue({ success: true, hasActiveRide: false });
    manager.socket = {
      connected: true,
      id: 'socket-driver',
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

    const authenticatedRegistration = manager.socket.on.mock.calls.find(
      ([eventName]) => eventName === 'authenticated',
    );
    expect(authenticatedRegistration).toBeTruthy();

    authenticatedRegistration[1]({
      success: true,
      uid: 'driver-123',
      userType: 'driver',
      driverOnline: true,
      isOnline: true,
      driverOnlineDaily: {
        sessionStartedAtMs: 1782523241715,
        effectiveMs: 420000,
      },
    });

    expect(syncSpy).toHaveBeenCalled();

    expect(manager.getConnectionStatus()).toEqual(
      expect.objectContaining({
        authenticated: true,
        userId: 'driver-123',
        userType: 'driver',
        authPayload: expect.objectContaining({
          uid: 'driver-123',
          userType: 'driver',
          driverOnline: true,
          isOnline: true,
          driverOnlineDaily: expect.objectContaining({
            effectiveMs: 420000,
          }),
        }),
      }),
    );

    syncSpy.mockRestore();

    const disconnectRegistration = manager.socket.on.mock.calls.find(
      ([eventName]) => eventName === 'disconnect',
    );
    expect(disconnectRegistration).toBeTruthy();

    disconnectRegistration[1]('transport close');

    expect(manager.getConnectionStatus()).toEqual(
      expect.objectContaining({
        authenticated: false,
        authPayload: null,
      }),
    );
  });

  it('refreshes the authenticated driver snapshot after driver status ack', async () => {
    const manager = WebSocketManager.getInstance();
    const listeners = {};
    manager.socket = {
      connected: true,
      id: 'socket-driver',
      io: {
        engine: {
          transport: {
            name: 'websocket',
          },
        },
      },
      on: jest.fn((eventName, handler) => {
        listeners[eventName] = handler;
      }),
      off: jest.fn(),
      emit: jest.fn((eventName) => {
        if (eventName === 'setDriverStatus') {
          listeners.driverStatusUpdated({
            success: true,
            driverId: 'driver-123',
            status: 'available',
            isOnline: true,
            driverOnlineDaily: {
              effectiveMs: 600000,
              sessionStartedAtMs: 1782523241715,
            },
          });
        }
      }),
    };

    manager.isAuthenticated = true;
    manager.authenticatedUserId = 'driver-123';
    manager.authenticatedUserType = 'driver';
    manager.lastAuthenticatedPayload = {
      success: true,
      uid: 'driver-123',
      userType: 'driver',
      status: 'offline',
      isOnline: false,
      driverOnline: false,
    };

    await manager.setDriverStatus('driver-123', 'available', true);

    expect(manager.getConnectionStatus().authPayload).toEqual(
      expect.objectContaining({
        uid: 'driver-123',
        userType: 'driver',
        status: 'available',
        isOnline: true,
        driverOnline: true,
        driverOnlineDaily: expect.objectContaining({
          effectiveMs: 600000,
        }),
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

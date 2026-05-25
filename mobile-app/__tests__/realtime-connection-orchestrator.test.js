const mockSocketManager = {
  connected: false,
  authenticated: false,
  userId: null,
  userType: null,
  socketId: null,
  connect: jest.fn(),
  authenticateWithAck: jest.fn(),
  clearAuthenticationState: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn(),
  getConnectionStatus: jest.fn(),
};

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => mockSocketManager),
}));

import {
  RealtimeConnectionOrchestrator,
  resolveSession,
} from '../src/services/RealtimeConnectionOrchestrator';

function syncManagerStatus() {
  mockSocketManager.isConnected.mockImplementation(
    () => mockSocketManager.connected,
  );
  mockSocketManager.getConnectionStatus.mockImplementation(() => ({
    connected: mockSocketManager.connected,
    authenticated: mockSocketManager.authenticated,
    socketId: mockSocketManager.socketId,
    userId: mockSocketManager.userId,
    userType: mockSocketManager.userType,
    isConnecting: false,
  }));
}

describe('RealtimeConnectionOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockSocketManager, {
      connected: false,
      authenticated: false,
      userId: null,
      userType: null,
      socketId: null,
    });
    syncManagerStatus();
    mockSocketManager.connect.mockImplementation(async () => {
      mockSocketManager.connected = true;
      mockSocketManager.socketId = 'socket-1';
      syncManagerStatus();
      return true;
    });
    mockSocketManager.authenticateWithAck.mockImplementation(
      async (userId, userType) => {
        mockSocketManager.authenticated = true;
        mockSocketManager.userId = userId;
        mockSocketManager.userType = userType;
        syncManagerStatus();
        return { success: true, uid: userId, userType };
      },
    );
    mockSocketManager.clearAuthenticationState.mockImplementation(() => {
      mockSocketManager.authenticated = false;
      mockSocketManager.userId = null;
      mockSocketManager.userType = null;
      syncManagerStatus();
    });
  });

  it('normalizes the realtime session from the app profile shape', () => {
    expect(
      resolveSession({
        uid: 'user-1',
        usertype: 'passageiro',
      }),
    ).toEqual({
      userId: 'user-1',
      userType: 'customer',
      key: 'user-1:customer',
    });

    expect(
      resolveSession({
        uid: 'driver-1',
        userType: 'motorista',
      }),
    ).toEqual({
      userId: 'driver-1',
      userType: 'driver',
      key: 'driver-1:driver',
    });
  });

  it('connects and authenticates once for the active profile', async () => {
    const orchestrator = new RealtimeConnectionOrchestrator(mockSocketManager);

    await expect(
      orchestrator.ensureReady({
        uid: 'user-1',
        usertype: 'customer',
      }),
    ).resolves.toBe(true);

    expect(mockSocketManager.connect).toHaveBeenCalledTimes(1);
    expect(mockSocketManager.authenticateWithAck).toHaveBeenCalledWith(
      'user-1',
      'customer',
      18000,
      expect.objectContaining({
        forceRefreshToken: false,
      }),
    );
    expect(orchestrator.getState()).toEqual(
      expect.objectContaining({
        phase: 'ready',
        ready: true,
        userId: 'user-1',
        userType: 'customer',
      }),
    );
  });

  it('does not reconnect or reauthenticate when the matching session is ready', async () => {
    Object.assign(mockSocketManager, {
      connected: true,
      authenticated: true,
      userId: 'driver-1',
      userType: 'driver',
      socketId: 'socket-ready',
    });
    syncManagerStatus();

    const orchestrator = new RealtimeConnectionOrchestrator(mockSocketManager);

    await expect(
      orchestrator.ensureReady({
        uid: 'driver-1',
        usertype: 'driver',
      }),
    ).resolves.toBe(true);

    expect(mockSocketManager.connect).not.toHaveBeenCalled();
    expect(mockSocketManager.authenticateWithAck).not.toHaveBeenCalled();
  });

  it('clears stale authentication before switching realtime users', async () => {
    Object.assign(mockSocketManager, {
      connected: true,
      authenticated: true,
      userId: 'old-user',
      userType: 'customer',
      socketId: 'socket-ready',
    });
    syncManagerStatus();

    const orchestrator = new RealtimeConnectionOrchestrator(mockSocketManager);

    await expect(
      orchestrator.ensureReady({
        uid: 'driver-1',
        usertype: 'driver',
      }),
    ).resolves.toBe(true);

    expect(mockSocketManager.clearAuthenticationState).toHaveBeenCalledWith({
      disconnect: false,
    });
    expect(mockSocketManager.connect).not.toHaveBeenCalled();
    expect(mockSocketManager.authenticateWithAck).toHaveBeenCalledWith(
      'driver-1',
      'driver',
      18000,
      expect.any(Object),
    );
  });
});

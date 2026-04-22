jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
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

function createSocketDouble({ emitImpl } = {}) {
  const listeners = new Map();

  return {
    connected: true,
    on: jest.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
    }),
    off: jest.fn((event, handler) => {
      const set = listeners.get(event);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        listeners.delete(event);
      }
    }),
    emit: jest.fn((event, payload) => {
      if (typeof emitImpl === 'function') {
        emitImpl({ event, payload, listeners });
      }
    }),
  };
}

describe('WebSocketManager.setDriverStatus', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
  });

  it('captures an immediate success response emitted right after setDriverStatus', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, listeners }) => {
        if (event !== 'setDriverStatus') return;
        const handlers = Array.from(listeners.get('driverStatusUpdated') || []);
        handlers.forEach((handler) =>
          handler({
            success: true,
            driverId: 'driver_1',
            status: 'available',
            isOnline: true,
          })
        );
      },
    });

    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.setDriverStatus('driver_1', 'available', true, { timeoutMs: 50 })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        driverId: 'driver_1',
        isOnline: true,
      })
    );

    expect(socket.on).toHaveBeenCalledWith('driverStatusUpdated', expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith(
      'setDriverStatus',
      expect.objectContaining({
        driverId: 'driver_1',
        status: 'available',
        isOnline: true,
      })
    );
  });

  it('accepts canonical and legacy success events for the same driver', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, listeners }) => {
        if (event !== 'setDriverStatus') return;
        const handlers = Array.from(listeners.get('driver_status_updated') || []);
        handlers.forEach((handler) =>
          handler({
            success: true,
            driverId: 'driver_1',
            status: 'available',
            isOnline: true,
          })
        );
      },
    });

    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.setDriverStatus('driver_1', 'available', true, { timeoutMs: 50 })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        driverId: 'driver_1',
      })
    );
  });

  it('ignores unrelated driver status events instead of resolving the wrong request', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, listeners }) => {
        if (event !== 'setDriverStatus') return;
        const handlers = Array.from(listeners.get('driverStatusUpdated') || []);
        handlers.forEach((handler) =>
          handler({
            success: true,
            driverId: 'other_driver',
            status: 'available',
            isOnline: true,
          })
        );
      },
    });

    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.setDriverStatus('driver_1', 'available', true, { timeoutMs: 20 })
    ).rejects.toMatchObject({
      code: 'SET_DRIVER_STATUS_TIMEOUT',
    });
  });
});

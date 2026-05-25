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

  const addListener = (event, handler, once = false) => {
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
    }
    listeners.get(event).add({ handler, once });
  };

  const trigger = (event, payload) => {
    const entries = Array.from(listeners.get(event) || []);
    entries.forEach((entry) => {
      entry.handler(payload);
      if (entry.once) {
        listeners.get(event)?.delete(entry);
      }
    });
  };

  return {
    connected: true,
    on: jest.fn((event, handler) => addListener(event, handler, false)),
    once: jest.fn((event, handler) => addListener(event, handler, true)),
    off: jest.fn((event, handler) => {
      const eventListeners = listeners.get(event);
      if (!eventListeners) return;
      Array.from(eventListeners).forEach((entry) => {
        if (entry.handler === handler) {
          eventListeners.delete(entry);
        }
      });
    }),
    emit: jest.fn((event, payload, ack) => {
      if (typeof emitImpl === 'function') {
        emitImpl({ event, payload, ack, trigger });
      }
    }),
  };
}

describe('WebSocketManager FCM and notification actions', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('captures an immediate FCM registration response emitted after registerFCMToken', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, trigger }) => {
        if (event === 'registerFCMToken') {
          trigger('fcmTokenRegistered', {
            success: true,
            userId: 'user_1',
          });
        }
      },
    });
    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.registerFCMToken({ fcmToken: 'token-1', userId: 'user_1' })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        userId: 'user_1',
      })
    );

    expect(socket.once).toHaveBeenCalledWith('fcmTokenRegistered', expect.any(Function));
    expect(socket.emit).toHaveBeenCalledWith(
      'registerFCMToken',
      expect.objectContaining({ fcmToken: 'token-1' })
    );
  });

  it('sends arrived notification actions and ignores unrelated responses', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, payload, trigger }) => {
        if (event === 'notificationAction') {
          trigger('notificationActionSuccess', {
            success: true,
            bookingId: payload.bookingId,
            action: 'other_action',
          });
          trigger('notificationActionSuccess', {
            success: true,
            bookingId: payload.bookingId,
            action: payload.action,
          });
        }
      },
    });
    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.sendNotificationAction('arrived_at_pickup', 'booking-1')
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking-1',
        action: 'arrived_at_pickup',
      })
    );

    expect(socket.emit).toHaveBeenCalledWith('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId: 'booking-1',
    });
  });

  it('ignores unscoped notification action responses', async () => {
    jest.useFakeTimers();
    const socket = createSocketDouble({
      emitImpl: ({ event, trigger }) => {
        if (event === 'notificationAction') {
          trigger('notificationActionSuccess', { success: true });
        }
      },
    });
    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    const pending = manager.sendNotificationAction('arrived_at_pickup', 'booking-1');
    jest.advanceTimersByTime(10000);

    await expect(pending).rejects.toThrow('Notification action timeout');
    jest.useRealTimers();
  });

  it('routes start_trip notification actions through the canonical startTrip command', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, payload, ack }) => {
        if (event === 'startTrip') {
          ack({
            success: true,
            bookingId: payload.bookingId,
          });
        }
      },
    });
    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.sendNotificationAction('start_trip', 'booking-2', {
        location: { lat: -22.9, lng: -43.2 },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking-2',
        action: 'start_trip',
      })
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'startTrip',
      expect.objectContaining({
        bookingId: 'booking-2',
        startLocation: { lat: -22.9, lng: -43.2 },
      }),
      expect.any(Function)
    );
    expect(socket.emit).not.toHaveBeenCalledWith(
      'notificationAction',
      expect.any(Object)
    );
  });

  it('routes cancel_ride notification actions through the canonical cancelRide command', async () => {
    const socket = createSocketDouble({
      emitImpl: ({ event, payload, trigger }) => {
        if (event === 'cancelRide') {
          trigger('rideCancelled', {
            success: true,
            bookingId: payload.bookingId,
          });
        }
      },
    });
    const manager = WebSocketManager.getInstance();
    manager.socket = socket;

    await expect(
      manager.sendNotificationAction('cancel_ride', 'booking-3')
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking-3',
        action: 'cancel_ride',
      })
    );

    expect(socket.emit).toHaveBeenCalledWith('cancelRide', {
      bookingId: 'booking-3',
      cancellationFee: 0,
      reason: 'Cancelado pela notificação',
    });
  });
});

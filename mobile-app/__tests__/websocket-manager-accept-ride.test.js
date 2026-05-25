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
import rideCostTelemetryService from '../src/services/RideCostTelemetryService';

function createSocketMock() {
  const handlers = new Map();

  return {
    connected: true,
    emit: jest.fn(),
    on: jest.fn((eventName, callback) => {
      const eventHandlers = handlers.get(eventName) || new Set();
      eventHandlers.add(callback);
      handlers.set(eventName, eventHandlers);
    }),
    off: jest.fn((eventName, callback) => {
      const eventHandlers = handlers.get(eventName);
      if (!eventHandlers) {
        return;
      }
      eventHandlers.delete(callback);
      if (eventHandlers.size === 0) {
        handlers.delete(eventName);
      }
    }),
    trigger(eventName, payload) {
      const eventHandlers = Array.from(handlers.get(eventName) || []);
      eventHandlers.forEach((callback) => callback(payload));
    },
  };
}

describe('WebSocketManager acceptRide correlation', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
    rideCostTelemetryService.resetForTests();
  });

  it('ignores rideAccepted events from another booking until the requested booking is confirmed', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.authenticatedUserId = 'driver_one_uid';

    let settled = false;
    const acceptPromise = manager
      .acceptRide('booking_target', { driverId: 'driver_one_uid' })
      .then((value) => {
        settled = true;
        return value;
      });

    socket.trigger('rideAccepted', {
      success: true,
      bookingId: 'booking_other',
      driverId: 'driver_one_uid',
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    socket.trigger('rideAccepted', {
      success: true,
      bookingId: 'booking_target',
      driverId: 'driver_one_uid',
    });

    await expect(acceptPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_target',
        driverId: 'driver_one_uid',
      }),
    );
  });

  it('ignores rideAccepted events for another driver even when the booking id matches', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.authenticatedUserId = 'driver_one_uid';

    let settled = false;
    const acceptPromise = manager
      .acceptRide('booking_target', { driverId: 'driver_one_uid' })
      .then((value) => {
        settled = true;
        return value;
      });

    socket.trigger('rideAccepted', {
      success: true,
      bookingId: 'booking_target',
      driverId: 'driver_two_uid',
    });
    await Promise.resolve();

    expect(settled).toBe(false);

    socket.trigger('rideAccepted', {
      success: true,
      bookingId: 'booking_target',
      driverId: 'driver_one_uid',
    });

    await expect(acceptPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_target',
        driverId: 'driver_one_uid',
      }),
    );
  });

  it('does not leak telemetryContext into the acceptRide socket payload', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.authenticatedUserId = 'driver_one_uid';
    manager.authenticatedUserType = 'driver';

    const acceptPromise = manager.acceptRide('booking_target', {
      driverId: 'driver_one_uid',
      telemetryContext: {
        bookingId: 'booking_target',
        sourceMeta: { userId: 'driver_one_uid', userType: 'driver' },
      },
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'acceptRide',
      expect.objectContaining({
        rideId: 'booking_target',
        driverId: 'driver_one_uid',
      }),
    );
    expect(socket.emit.mock.calls[0][1]).not.toHaveProperty('telemetryContext');

    socket.trigger('rideAccepted', {
      success: true,
      bookingId: 'booking_target',
      driverId: 'driver_one_uid',
    });

    await expect(acceptPromise).resolves.toEqual(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_target',
      }),
    );
  });
});

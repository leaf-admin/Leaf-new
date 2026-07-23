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

describe('WebSocketManager activeRideSync rehydration', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
  });

  it('rehydrates tripStarted only once for repeated sync snapshots of the same booking/status', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.setupListeners();

    const tripStartedSpy = jest.fn();
    manager.on('tripStarted', tripStartedSpy);

    const snapshot = {
      success: true,
      hasActiveRide: true,
      bookingId: 'booking_started_1',
      status: 'IN_PROGRESS',
      pickupLocation: { lat: -23.56, lng: -46.65, add: 'Origem' },
      destinationLocation: { lat: -23.57, lng: -46.66, add: 'Destino' },
    };

    socket.trigger('activeRideSync', snapshot);
    socket.trigger('activeRideSync', snapshot);
    socket.trigger('activeRideSync', { ...snapshot, syncedAt: '2026-04-07T22:00:00.000Z' });

    expect(tripStartedSpy).toHaveBeenCalledTimes(1);
    expect(tripStartedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        bookingId: 'booking_started_1',
        rehydrated: true,
      }),
    );
  });

  it('allows a lifecycle rehydration again after the active ride is cleared', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.setupListeners();

    const tripStartedSpy = jest.fn();
    manager.on('tripStarted', tripStartedSpy);

    const snapshot = {
      success: true,
      hasActiveRide: true,
      bookingId: 'booking_started_2',
      status: 'STARTED',
      pickupLocation: { lat: -23.56, lng: -46.65, add: 'Origem' },
      destinationLocation: { lat: -23.57, lng: -46.66, add: 'Destino' },
    };

    socket.trigger('activeRideSync', snapshot);
    socket.trigger('activeRideSync', {
      success: true,
      hasActiveRide: false,
      bookingId: 'booking_started_2',
      status: 'COMPLETED',
    });
    socket.trigger('activeRideSync', snapshot);

    expect(tripStartedSpy).toHaveBeenCalledTimes(2);
  });

  it('does not rehydrate terminal activeRideSync snapshots as active lifecycle', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.setupListeners();

    const activeRideRehydratedSpy = jest.fn();
    const rideAcceptedSpy = jest.fn();
    const tripStartedSpy = jest.fn();
    const activeRideSyncSpy = jest.fn();
    manager.on('activeRideRehydrated', activeRideRehydratedSpy);
    manager.on('rideAccepted', rideAcceptedSpy);
    manager.on('tripStarted', tripStartedSpy);
    manager.on('activeRideSync', activeRideSyncSpy);

    manager.rehydratedRideLifecycleByBooking.set(
      'booking_terminal_sync',
      'booking_terminal_sync:ACCEPTED',
    );
    manager.dispatchedLifecycleEventsByBooking.set(
      'booking_terminal_sync:tripStarted',
      Date.now(),
    );
    manager.lastLifecycleBookingByEvent.set(
      'tripStarted',
      'booking_terminal_sync',
    );

    socket.trigger('activeRideSync', {
      success: true,
      hasActiveRide: true,
      terminal: true,
      bookingId: 'booking_terminal_sync',
      status: 'COMPLETED',
      pickupLocation: { lat: -23.56, lng: -46.65, add: 'Origem' },
      destinationLocation: { lat: -23.57, lng: -46.66, add: 'Destino' },
    });

    expect(activeRideRehydratedSpy).not.toHaveBeenCalled();
    expect(rideAcceptedSpy).not.toHaveBeenCalled();
    expect(tripStartedSpy).not.toHaveBeenCalled();
    expect(activeRideSyncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        terminal: true,
        status: 'COMPLETED',
        bookingId: 'booking_terminal_sync',
      }),
    );
    expect(manager.rehydratedRideLifecycleByBooking.has('booking_terminal_sync')).toBe(false);
    expect(manager.dispatchedLifecycleEventsByBooking.has('booking_terminal_sync:tripStarted')).toBe(false);
    expect(manager.lastLifecycleBookingByEvent.has('tripStarted')).toBe(false);
    expect(manager._getLifecycleSnapshotBookingFallback()).toBe('');
  });

  it('deduplicates repeated tripStarted server events for the same booking until the booking is cleared', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.setupListeners();

    const tripStartedSpy = jest.fn();
    manager.on('tripStarted', tripStartedSpy);

    const payload = {
      success: true,
      bookingId: 'booking_started_3',
      status: 'IN_PROGRESS',
    };

    socket.trigger('tripStarted', payload);
    socket.trigger('tripStarted', payload);

    expect(tripStartedSpy).toHaveBeenCalledTimes(1);

    socket.trigger('tripCompleted', {
      success: true,
      bookingId: 'booking_started_3',
    });
    socket.trigger('tripStarted', payload);

    expect(tripStartedSpy).toHaveBeenCalledTimes(2);
  });

  it('deduplicates repeated tripStarted server events even when the payload omits bookingId', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.lastActiveRideSnapshot = {
      bookingId: 'booking_started_4',
    };
    manager.setupListeners();

    const tripStartedSpy = jest.fn();
    manager.on('tripStarted', tripStartedSpy);

    socket.trigger('tripStarted', {
      success: true,
      status: 'IN_PROGRESS',
    });
    socket.trigger('tripStarted', {
      success: true,
      status: 'IN_PROGRESS',
    });

    expect(tripStartedSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated tripStarted server events using the last lifecycle booking fallback', () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;
    manager.setupListeners();

    const tripStartedSpy = jest.fn();
    manager.on('tripStarted', tripStartedSpy);

    socket.trigger('tripStarted', {
      success: true,
      bookingId: 'booking_started_5',
      status: 'IN_PROGRESS',
    });
    socket.trigger('tripStarted', {
      success: true,
      status: 'IN_PROGRESS',
    });

    expect(tripStartedSpy).toHaveBeenCalledTimes(1);
    expect(tripStartedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_started_5',
        __source: 'socket_event',
      }),
    );
  });
});

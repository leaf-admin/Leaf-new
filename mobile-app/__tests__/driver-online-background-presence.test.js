import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import locationBufferService from '../src/services/LocationBufferService';
import WebSocketManager from '../src/services/WebSocketManager';
import prototypeDriverTripAssistantService from '../src/services/PrototypeDriverTripAssistantService';
import BackgroundLocationService from '../src/services/BackgroundLocationService';
import realtimeConnectionOrchestrator from '../src/services/RealtimeConnectionOrchestrator';

jest.mock('../src/services/RealtimeConnectionOrchestrator', () => ({
  __esModule: true, default: { ensureReady: jest.fn().mockResolvedValue(true) },
}));

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(),
  },
}));

jest.mock('../src/services/BackgroundLocationService', () => ({
  __esModule: true,
  default: {
    checkPermissions: jest.fn().mockResolvedValue({ foreground: true, background: true }),
    startBackgroundTracking: jest.fn().mockResolvedValue(undefined),
    stopBackgroundTracking: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../src/services/PersistentRideNotificationService', () => ({
  __esModule: true,
  default: {
    requestPermissions: jest.fn().mockResolvedValue(true),
    isNotificationActive: jest.fn(() => false),
    showRideNotification: jest.fn().mockResolvedValue(undefined),
    updateRideNotification: jest.fn().mockResolvedValue(undefined),
    dismissRideNotification: jest.fn().mockResolvedValue(undefined),
  },
}));

const FIX = { lat: -22.97, lng: -43.36, heading: 12, speed: 3, timestamp: 1710000000000 };

describe('driver online with the app in the background', () => {
  let socketManager;
  const originalAppState = AppState.currentState;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    locationBufferService.activeTripContextCache = null;
    locationBufferService.setDriverPresenceContext(null);
    locationBufferService.backgroundReconnectPromise = null;
    locationBufferService.lastBackgroundReconnectAt = null;
    prototypeDriverTripAssistantService.onlinePresenceKey = null;
    prototypeDriverTripAssistantService.lastTrackingSessionKey = '';
    socketManager = {
      getConnectionStatus: jest.fn(() => ({ authenticated: true })),
      isConnected: jest.fn(() => true),
      emitToServer: jest.fn(),
    };
    WebSocketManager.getInstance.mockReturnValue(socketManager);
    AppState.currentState = 'background';
  });

  afterAll(() => {
    AppState.currentState = originalAppState;
  });

  it('drops a background fix when the driver is neither online nor on a trip', async () => {
    const result = await locationBufferService.addDriverLocationFromBackground(FIX);
    expect(result).toEqual({ buffered: false, reason: 'no_active_trip' });
    expect(socketManager.emitToServer).not.toHaveBeenCalled();
  });

  it('sends presence from the background task for an online idle driver, at most once per interval', async () => {
    locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });

    const first = await locationBufferService.addDriverLocationFromBackground(FIX);
    const second = await locationBufferService.addDriverLocationFromBackground(FIX);

    expect(first.reason).toBe('presence_sent');
    expect(second.reason).toBe('presence_throttled');
    expect(socketManager.emitToServer).toHaveBeenCalledTimes(1);
    expect(socketManager.emitToServer).toHaveBeenCalledWith(
      'updateLocation',
      expect.objectContaining({
        driverId: 'driver_1',
        lat: FIX.lat,
        lng: FIX.lng,
        isInTrip: false,
        source: 'background_presence',
      }),
    );
    expect(await AsyncStorage.getItem('@location_buffer')).toBeNull();
  });

  it('leaves presence to the runtime heartbeat while the app is in front', async () => {
    AppState.currentState = 'active';
    locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });

    const result = await locationBufferService.addDriverLocationFromBackground(FIX);

    expect(result.reason).toBe('foreground_heartbeat_active');
    expect(socketManager.emitToServer).not.toHaveBeenCalled();
  });

  it('does not send presence without an authenticated socket', async () => {
    socketManager.getConnectionStatus.mockReturnValue({ authenticated: false });
    locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });

    const result = await locationBufferService.addDriverLocationFromBackground(FIX);

    expect(result.reason).toBe('socket_unavailable');
    expect(socketManager.emitToServer).not.toHaveBeenCalled();
  });

  it('asks the existing orchestrator to reconnect an online driver without waiting for foreground', async () => {
    socketManager.isConnected.mockReturnValue(false);
    socketManager.getConnectionStatus.mockReturnValue({ authenticated: false, userId: 'driver_1' });
    locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });
    await locationBufferService.addDriverLocationFromBackground(FIX);
    await Promise.resolve();
    expect(realtimeConnectionOrchestrator.ensureReady).toHaveBeenCalledWith(
      { userId: 'driver_1', userType: 'driver' }, expect.objectContaining({ reason: 'background_location' }),
    );
    expect(socketManager.emitToServer).not.toHaveBeenCalled();
  });

  it('buffers an accepted ride fix and coalesces reconnect attempts instead of blocking the native task', async () => {
    socketManager.isConnected.mockReturnValue(false);
    socketManager.getConnectionStatus.mockReturnValue({ authenticated: false, userId: 'driver_1' });
    await locationBufferService.setActiveTripContext({ bookingId: 'booking_1', driverId: 'driver_1', tripStatus: 'accepted' });
    let finish;
    realtimeConnectionOrchestrator.ensureReady.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = await locationBufferService.addDriverLocationFromBackground(FIX);
    const second = await locationBufferService.addDriverLocationFromBackground({ ...FIX, timestamp: FIX.timestamp + 1000 });
    expect(first).toMatchObject({ buffered: true, bookingId: 'booking_1' });
    expect(second).toMatchObject({ buffered: true, bookingId: 'booking_1' });
    expect(realtimeConnectionOrchestrator.ensureReady).toHaveBeenCalledTimes(1);
    finish(false);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('does not reconnect another account using a persisted driver context', async () => {
    socketManager.isConnected.mockReturnValue(false);
    socketManager.getConnectionStatus.mockReturnValue({ authenticated: false, userId: 'other-user' });
    locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });
    await locationBufferService.addDriverLocationFromBackground(FIX);
    expect(realtimeConnectionOrchestrator.ensureReady).not.toHaveBeenCalled();
  });

  it('waits for the retry interval after a failed background reconnection', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(FIX.timestamp);
    try {
      socketManager.isConnected.mockReturnValue(false);
      socketManager.getConnectionStatus.mockReturnValue({ authenticated: false, userId: 'driver_1' });
      locationBufferService.setDriverPresenceContext({ driverId: 'driver_1' });
      realtimeConnectionOrchestrator.ensureReady.mockResolvedValue(true)
        .mockRejectedValueOnce(new Error('network unavailable'));
      await locationBufferService.addDriverLocationFromBackground(FIX);
      await locationBufferService.backgroundReconnectPromise;
      await locationBufferService.addDriverLocationFromBackground(FIX);
      expect(realtimeConnectionOrchestrator.ensureReady).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(FIX.timestamp + 10000);
      await locationBufferService.addDriverLocationFromBackground(FIX);
      await locationBufferService.backgroundReconnectPromise;
      expect(realtimeConnectionOrchestrator.ensureReady).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it('keeps the location service running after a ride ends while the driver stays online', async () => {
    await prototypeDriverTripAssistantService.setOnlinePresence({ online: true, driverId: 'driver_1' });
    expect(BackgroundLocationService.startBackgroundTracking).toHaveBeenCalledTimes(1);
    expect(locationBufferService.getDriverPresenceContext()).toEqual({ driverId: 'driver_1' });

    await prototypeDriverTripAssistantService.clearSession();
    expect(BackgroundLocationService.stopBackgroundTracking).not.toHaveBeenCalled();

    await prototypeDriverTripAssistantService.setOnlinePresence({ online: false });
    expect(BackgroundLocationService.stopBackgroundTracking).toHaveBeenCalledTimes(1);
    expect(locationBufferService.getDriverPresenceContext()).toBeNull();
  });

  it('does not stop the service when the driver goes offline during an active ride session', async () => {
    await prototypeDriverTripAssistantService.setOnlinePresence({ online: true, driverId: 'driver_1' });
    prototypeDriverTripAssistantService.lastTrackingSessionKey = 'booking_1:started';

    await prototypeDriverTripAssistantService.setOnlinePresence({ online: false });

    expect(BackgroundLocationService.stopBackgroundTracking).not.toHaveBeenCalled();
  });

  it('stops the service at the end of a ride when the driver is offline', async () => {
    await prototypeDriverTripAssistantService.setOnlinePresence({ online: false });
    BackgroundLocationService.stopBackgroundTracking.mockClear();

    await prototypeDriverTripAssistantService.clearSession();

    expect(BackgroundLocationService.stopBackgroundTracking).toHaveBeenCalledTimes(1);
  });
});

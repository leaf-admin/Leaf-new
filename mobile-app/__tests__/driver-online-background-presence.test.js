import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import locationBufferService from '../src/services/LocationBufferService';
import WebSocketManager from '../src/services/WebSocketManager';
import prototypeDriverTripAssistantService from '../src/services/PrototypeDriverTripAssistantService';
import BackgroundLocationService from '../src/services/BackgroundLocationService';

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

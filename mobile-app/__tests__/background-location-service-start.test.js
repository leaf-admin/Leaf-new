const mockLocation = {
  Accuracy: { Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
};
const mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

jest.mock('expo-location', () => mockLocation);
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('../src/utils/Logger', () => ({ __esModule: true, default: mockLogger }));
jest.mock('../src/services/AndroidPermissionDisclosure', () => ({
  BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY: 'k',
  requestBackgroundLocationPermissionWithDisclosure: jest.fn(),
  requestForegroundLocationPermissionWithDisclosure: jest.fn(),
}));

const { AppState } = require('react-native');

function nativeRejection(cause) {
  const error = new Error(
    `Call to function 'ExpoLocation.startLocationUpdatesAsync' has been rejected.\n→ Caused by: ${cause}`
  );
  error.code = 'ERR_UNEXPECTED';
  return error;
}

describe('BackgroundLocationService start/stop', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    AppState.currentState = 'active';
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLocation.startLocationUpdatesAsync.mockResolvedValue(undefined);
    mockLocation.stopLocationUpdatesAsync.mockResolvedValue(undefined);
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(false);
    const { BackgroundLocationService } = require('../src/services/BackgroundLocationService');
    service = new BackgroundLocationService();
  });

  it('logs the real native message instead of only the code', async () => {
    mockLocation.startLocationUpdatesAsync.mockRejectedValue(
      nativeRejection('java.lang.IllegalStateException: boom')
    );
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await service.startBackgroundTracking();

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const logged = mockLogger.error.mock.calls[0][0];
    expect(typeof logged).toBe('string');
    expect(logged).toContain('[ERR_UNEXPECTED]');
    expect(logged).toContain('Caused by: java.lang.IllegalStateException: boom');
    expect(logged).toContain('task nativa registrada: true');
  });

  it('reports an unchanged failure through console.error only once and keeps it observable', async () => {
    mockLocation.startLocationUpdatesAsync.mockRejectedValue(nativeRejection('java.lang.SecurityException: x'));

    await service.startBackgroundTracking();
    await service.startBackgroundTracking();
    await service.startBackgroundTracking();

    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(3);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const status = service.getTrackingStatus();
    expect(status.isTracking).toBe(false);
    expect(status.lastStartFailure).toMatchObject({ code: 'ERR_UNEXPECTED', count: 3 });
    expect(status.lastStartFailure.message).toContain('SecurityException');
  });

  it('reports again when the failure changes and clears it on success', async () => {
    mockLocation.startLocationUpdatesAsync
      .mockRejectedValueOnce(nativeRejection('A'))
      .mockRejectedValueOnce(nativeRejection('B'))
      .mockResolvedValueOnce(undefined);

    await service.startBackgroundTracking();
    await service.startBackgroundTracking();
    expect(mockLogger.error).toHaveBeenCalledTimes(2);

    await service.startBackgroundTracking();
    expect(service.getTrackingStatus()).toEqual({ isTracking: true, lastStartFailure: null });
  });

  it('is a no-op when already tracking and shares one attempt between concurrent callers', async () => {
    await Promise.all([service.startBackgroundTracking(), service.startBackgroundTracking()]);
    await service.startBackgroundTracking();

    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('does not touch the native module while the app is not active', async () => {
    AppState.currentState = 'background';
    await service.startBackgroundTracking();
    expect(mockLocation.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(service.getTrackingStatus().lastStartFailure).toBeNull();
  });

  it('stops a natively registered task even when this JS context never started it', async () => {
    mockLocation.hasStartedLocationUpdatesAsync.mockResolvedValue(true);

    await service.stopBackgroundTracking();

    expect(mockLocation.stopLocationUpdatesAsync).toHaveBeenCalledWith('background-location-task');
    expect(service.getTrackingStatus().isTracking).toBe(false);
  });

  it('does not call native stop when nothing is registered', async () => {
    await service.stopBackgroundTracking();
    expect(mockLocation.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('notifies subscribers of a start failure, of the recovery and of the stop, and does not retry the native start', async () => {
    const listener = jest.fn();
    const unsubscribe = service.subscribeTrackingStatus(listener);
    mockLocation.startLocationUpdatesAsync.mockRejectedValueOnce(
      nativeRejection(
        "java.lang.NullPointerException: Attempt to invoke interface method 'java.util.Map android.content.SharedPreferences.getAll()' on a null object reference"
      )
    );

    await service.startBackgroundTracking();

    // The stale native TaskService cannot be reset from JS: exactly one native attempt.
    expect(mockLocation.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        isTracking: false,
        lastStartFailure: expect.objectContaining({ code: 'ERR_UNEXPECTED', count: 1 }),
      })
    );

    await service.startBackgroundTracking();
    expect(listener).toHaveBeenLastCalledWith({ isTracking: true, lastStartFailure: null });

    await service.stopBackgroundTracking();
    expect(listener).toHaveBeenLastCalledWith({ isTracking: false, lastStartFailure: null });

    const callsBeforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    await service.startBackgroundTracking();
    expect(listener).toHaveBeenCalledTimes(callsBeforeUnsubscribe);
  });

  it('keeps working when a status subscriber throws', async () => {
    service.subscribeTrackingStatus(() => {
      throw new Error('listener boom');
    });

    await service.startBackgroundTracking();

    expect(service.getTrackingStatus().isTracking).toBe(true);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});

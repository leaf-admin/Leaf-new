const mockPlatform = { OS: 'ios' };
const mockLeafRideActivity = {
  isAvailable: jest.fn(),
  startOrUpdate: jest.fn(),
  end: jest.fn()
};
const mockFeatureFlagService = {
  getFlag: jest.fn()
};
const mockWebSocketManager = {
  registerRideLiveActivityToken: jest.fn()
};

jest.mock('react-native', () => ({
  Platform: mockPlatform,
  NativeModules: {
    LeafRideActivity: mockLeafRideActivity
  }
}));

jest.mock('../src/services/FeatureFlagService', () => ({
  __esModule: true,
  default: mockFeatureFlagService
}));

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => mockWebSocketManager)
  }
}));

jest.mock('../src/utils/Logger', () => ({
  warn: jest.fn(),
  log: jest.fn(),
  error: jest.fn()
}));

const RideLiveActivityService = require('../src/services/RideLiveActivityService').default;

describe('RideLiveActivityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'ios';
    mockFeatureFlagService.getFlag.mockResolvedValue(true);
    mockLeafRideActivity.isAvailable.mockResolvedValue({ available: true });
    mockLeafRideActivity.startOrUpdate.mockResolvedValue({
      success: true,
      pushToken: 'live-activity-token'
    });
    mockLeafRideActivity.end.mockResolvedValue({ success: true });
    mockWebSocketManager.registerRideLiveActivityToken.mockResolvedValue({ success: true });
    RideLiveActivityService.availabilityPromise = null;
    RideLiveActivityService.available = null;
    RideLiveActivityService.activeActivities = new Map();
    RideLiveActivityService.registeredTokenKeys = new Set();
  });

  it('keeps Live Activities disabled outside iOS or when the remote flag is off', async () => {
    mockPlatform.OS = 'android';
    await expect(RideLiveActivityService.isAvailable()).resolves.toBe(false);

    mockPlatform.OS = 'ios';
    RideLiveActivityService.availabilityPromise = null;
    mockFeatureFlagService.getFlag.mockResolvedValue(false);

    await expect(RideLiveActivityService.isAvailable()).resolves.toBe(false);
    expect(mockLeafRideActivity.isAvailable).not.toHaveBeenCalled();
  });

  it('starts or updates the native activity and registers its APNs push token once', async () => {
    const result = await RideLiveActivityService.startOrUpdate({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Ana',
      estimatedTime: 8,
      distance: 3.25,
      fare: 'R$ 42,00',
      destination: { address: 'Barra Shopping' },
      pickup: { address: 'Estr. do Rio Grande' }
    });

    expect(result).toEqual({
      handled: true,
      success: true,
      activityId: 'ride:passenger:booking-1',
      surface: 'ios_activitykit'
    });
    expect(mockLeafRideActivity.startOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      activityId: 'ride:passenger:booking-1',
      bookingId: 'booking-1',
      role: 'passenger',
      phase: 'accepted',
      title: '8 min',
      subtitle: 'Ana está a caminho',
      distanceText: '3,3 km',
      fareLabel: 'R$ 42,00',
      progress: 0.35
    }));
    expect(mockWebSocketManager.registerRideLiveActivityToken).toHaveBeenCalledTimes(1);
    expect(mockWebSocketManager.registerRideLiveActivityToken).toHaveBeenCalledWith({
      activityId: 'ride:passenger:booking-1',
      bookingId: 'booking-1',
      rideId: 'booking-1',
      role: 'passenger',
      platform: 'ios',
      pushToken: 'live-activity-token'
    });

    await RideLiveActivityService.startOrUpdate({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer'
    });

    expect(mockWebSocketManager.registerRideLiveActivityToken).toHaveBeenCalledTimes(1);
  });

  it('ends the native activity for terminal ride statuses', async () => {
    RideLiveActivityService.activeActivities.set('booking-2', 'ride:driver:booking-2');

    const result = await RideLiveActivityService.startOrUpdate({
      bookingId: 'booking-2',
      status: 'completed',
      userType: 'driver'
    });

    expect(result).toEqual({
      handled: true,
      success: true,
      activityId: 'ride:driver:booking-2'
    });
    expect(mockLeafRideActivity.startOrUpdate).not.toHaveBeenCalled();
    expect(mockLeafRideActivity.end).toHaveBeenCalledWith(expect.objectContaining({
      activityId: 'ride:driver:booking-2',
      bookingId: 'booking-2',
      role: 'driver',
      phase: 'completed',
      endedAt: expect.any(String)
    }));
    expect(RideLiveActivityService.activeActivities.has('booking-2')).toBe(false);
  });
});

let notificationSequence = 0;
const mockRegisteredHandlers = new Map();
let mockNotificationPolicy = {
  enabled: true,
  persistentRideNotificationsEnabled: true,
};

const mockNotifications = {
  AndroidImportance: { HIGH: 'HIGH' },
  AndroidNotificationPriority: { HIGH: 'HIGH' },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve(`notification-${++notificationSequence}`)),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
  getPresentedNotificationsAsync: jest.fn(() => Promise.resolve([])),
};
const mockNativeRideNotification = {
  showOrUpdate: jest.fn(() => Promise.resolve({
    success: true,
    notificationId: 'leaf-ride-status-43001',
    androidNotificationId: 43001,
  })),
  dismiss: jest.fn(() => Promise.resolve(true)),
};
const mockNativeModules = {};

jest.mock('expo-notifications', () => mockNotifications);
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
  NativeModules: mockNativeModules,
}));
jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../src/services/FCMNotificationService', () => ({
  registerNotificationHandler: jest.fn((type, handler) => {
    mockRegisteredHandlers.set(type, handler);
  }),
}));
jest.mock('../src/services/AndroidPermissionDisclosure', () => ({
  requestExpoNotificationsPermissionWithDisclosure: jest.fn((Notifications, options) =>
    Notifications.requestPermissionsAsync(options)
  ),
}));
jest.mock('../src/services/RuntimeConfigService', () => ({
  __esModule: true,
  default: {
    getNotificationPolicySync: jest.fn(() => mockNotificationPolicy),
  },
}));

let serviceUnderTest = null;
const loadService = () => {
  serviceUnderTest = require('../src/services/PersistentRideNotificationService').default;
  return serviceUnderTest;
};
const AsyncStorage = require('@react-native-async-storage/async-storage');

describe('PersistentRideNotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegisteredHandlers.clear();
    mockNotificationPolicy = {
      enabled: true,
      persistentRideNotificationsEnabled: true,
    };
    notificationSequence = 0;
    delete mockNativeModules.LeafRideNotification;
    mockNativeRideNotification.showOrUpdate.mockClear();
    mockNativeRideNotification.dismiss.mockClear();
    AsyncStorage.clear();
    jest.resetModules();
  });

  afterEach(() => {
    serviceUnderTest?.stopPeriodicUpdate?.();
    serviceUnderTest = null;
  });

  it('initializes the Android persistent ride channel and FCM handler', async () => {
    const service = loadService();

    await service.initialize();

    expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'ride_status',
      expect.objectContaining({
        name: 'Status da Corrida',
        importance: 'HIGH',
      })
    );
    expect(mockRegisteredHandlers.has('ride_status_update')).toBe(true);
  });

  it('creates a sticky Android notification with ride status content', async () => {
    const service = loadService();

    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      estimatedTime: 4,
      tripEstimatedTime: 12,
      pickup: { address: 'Rua de Partida, 100' },
    });

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Carlos está a caminho',
          body: expect.stringContaining('Chegada ao embarque em 4 min'),
          sticky: true,
          autoDismiss: false,
          data: expect.objectContaining({
            type: 'ride_status',
            bookingId: 'booking-1',
            status: 'accepted',
          }),
        }),
        trigger: { channelId: 'ride_status' },
      })
    );
    expect(service.isNotificationActive()).toBe(true);
  });

  it('does not create ride notification when runtime policy disables it', async () => {
    mockNotificationPolicy = {
      enabled: true,
      persistentRideNotificationsEnabled: false,
    };
    const service = loadService();

    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      estimatedTime: 4,
    });

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(service.isNotificationActive()).toBe(false);
  });

  it('updates the persistent notification from a ride_status_update FCM payload', async () => {
    const service = loadService();

    await service.initialize();
    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
    });

    const handler = mockRegisteredHandlers.get('ride_status_update');
    await handler({
      data: {
        bookingId: 'booking-1',
        status: 'started',
        userType: 'customer',
        destination: JSON.stringify({ address: 'Leblon' }),
        estimatedTime: '9',
        tripEstimatedTime: '9',
      },
    });

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'A caminho de Leblon',
          body: expect.stringContaining('Chegada prevista em 9 min'),
          data: expect.objectContaining({
            bookingId: 'booking-1',
            status: 'started',
          }),
        }),
      })
    );
  });

  it('uses the native Android notification slot for in-place updates when available', async () => {
    mockNativeModules.LeafRideNotification = mockNativeRideNotification;
    const service = loadService();

    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      pickupEstimatedTime: 4,
    });

    await service.updateRideNotification({
      bookingId: 'booking-1',
      status: 'started',
      userType: 'customer',
      driverName: 'Carlos',
      destination: { address: 'Barra Shopping' },
      tripEstimatedTime: 12,
    });

    expect(mockNativeRideNotification.showOrUpdate).toHaveBeenCalledTimes(2);
    expect(mockNativeRideNotification.showOrUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        channelId: 'ride_status',
        notificationId: 'leaf-ride-status-43001',
        title: 'A caminho de Barra Shopping',
        bookingId: 'booking-1',
        status: 'started',
      })
    );
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(service.getCurrentNotificationId()).toBe('leaf-ride-status-43001');
  });

  it('dismisses the native Android notification slot without recreating Expo notifications', async () => {
    mockNativeModules.LeafRideNotification = mockNativeRideNotification;
    const service = loadService();

    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
    });

    await service.dismissRideNotification('booking-1');

    expect(mockNativeRideNotification.dismiss).toHaveBeenCalledTimes(1);
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(service.isNotificationActive()).toBe(false);
  });

  it('suppresses duplicate ride status payloads for the same booking state', async () => {
    const service = loadService();

    await service.initialize();
    const handler = mockRegisteredHandlers.get('ride_status_update');
    const payload = {
      data: {
        bookingId: 'booking-1',
        status: 'accepted',
        userType: 'customer',
        driverName: 'Carlos',
        estimatedTime: '4',
      },
    };

    await handler(payload);
    await handler(payload);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('cleans presented ride notifications for the same booking before replacing it', async () => {
    mockNotifications.getPresentedNotificationsAsync.mockResolvedValueOnce([
      {
        identifier: 'old-notification',
        request: {
          content: {
            data: {
              type: 'ride_status',
              bookingId: 'booking-1',
            },
          },
        },
      },
    ]);
    const service = loadService();

    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      estimatedTime: 4,
      pickup: { address: 'Rua de Partida, 100' },
    });

    expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledWith('old-notification');
  });

  it('renders pickup and trip ETA timeline details without extra backend calls', async () => {
    const service = loadService();
    const phaseStartedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    const content = service.generateNotificationContent({
      bookingId: 'booking-1',
      status: 'accepted',
      userType: 'customer',
      driverName: 'Carlos',
      pickup: { address: 'Rua de Partida, 100' },
      destination: { address: 'Leblon' },
      pickupEstimatedTime: 6,
      tripEstimatedTime: 18,
      phaseStartedAt,
    });

    expect(content.title).toBe('Carlos está a caminho');
    expect(content.body).toContain('Chegada ao embarque em 4 min');
    expect(content.body).toContain('Embarque: Rua de Partida, 100');
    expect(content.body).toContain('Viagem estimada: 18 min');
    expect(content.body).toMatch(/[█░]{10} \d+%/);
  });

  it('dismisses the notification when the ride is completed or cancelled', async () => {
    const service = loadService();

    await service.initialize();
    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'started',
      userType: 'driver',
      destination: { address: 'Leblon' },
    });

    const handler = mockRegisteredHandlers.get('ride_status_update');
    await handler({
      data: {
        bookingId: 'booking-1',
        status: 'completed',
      },
    });

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
    expect(mockNotifications.dismissNotificationAsync).toHaveBeenCalledWith('notification-1');
    expect(service.isNotificationActive()).toBe(false);
  });

  it('dismisses the notification when backend sends canceled status', async () => {
    const service = loadService();

    await service.initialize();
    await service.showRideNotification({
      bookingId: 'booking-1',
      status: 'started',
      userType: 'customer',
      destination: { address: 'Leblon' },
    });

    const handler = mockRegisteredHandlers.get('ride_status_update');
    await handler({
      data: {
        bookingId: 'booking-1',
        status: 'canceled',
      },
    });

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-1');
    expect(service.isNotificationActive()).toBe(false);
  });
});

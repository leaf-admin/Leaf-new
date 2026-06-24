const mockOnMessage = jest.fn(() => jest.fn());
const mockOnNotificationOpenedApp = jest.fn(() => jest.fn());
const mockGetInitialNotification = jest.fn(() => Promise.resolve(null));
const mockSetBackgroundMessageHandler = jest.fn();
const mockGetToken = jest.fn(() => Promise.resolve('mock_token'));
const mockRequestPermission = jest.fn(() => Promise.resolve(1));
const mockHasPermission = jest.fn(() => Promise.resolve(1));
const mockPlatform = {
  OS: 'android',
  Version: 32,
};
const mockAlert = {
  alert: jest.fn((_title, _message, buttons = []) => {
    const confirmButton = buttons.find(button => button.text === 'Concordo e continuar') || buttons[1] || buttons[0];
    confirmButton?.onPress?.();
  }),
};
const mockPermissionsAndroid = {
  PERMISSIONS: {
    POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
  },
  check: jest.fn(() => Promise.resolve(true)),
  request: jest.fn(() => Promise.resolve('granted')),
};
let mockAppStateListener;
const mockAppStateSubscriptionRemove = jest.fn();
const mockAppState = {
  currentState: 'active',
  addEventListener: jest.fn((event, listener) => {
    mockAppStateListener = listener;
    return { remove: mockAppStateSubscriptionRemove };
  }),
};
const mockDevice = {
  isDevice: false,
};
let mockAuthState = { uid: 'user_1', userType: 'customer' };
let mockStoreListener;
const mockWsManager = {
  isConnected: jest.fn(() => true),
  connect: jest.fn(),
  registerFCMToken: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};
const mockMessaging = () => ({
  onMessage: mockOnMessage,
  onNotificationOpenedApp: mockOnNotificationOpenedApp,
  getInitialNotification: mockGetInitialNotification,
  setBackgroundMessageHandler: mockSetBackgroundMessageHandler,
  getToken: mockGetToken,
  requestPermission: mockRequestPermission,
  hasPermission: mockHasPermission,
});
mockMessaging.AuthorizationStatus = {
  AUTHORIZED: 1,
  PROVISIONAL: 2,
  DENIED: 0,
};

jest.mock('@react-native-firebase/messaging', () => mockMessaging);

jest.mock('react-native', () => ({
  AppState: mockAppState,
  Alert: mockAlert,
  Platform: mockPlatform,
  PermissionsAndroid: mockPermissionsAndroid,
}));

jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDevice.isDevice;
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/state/appStore', () => ({
  store: {
    getState: jest.fn(() => ({ auth: mockAuthState })),
    subscribe: jest.fn((listener) => {
      mockStoreListener = listener;
      return jest.fn();
    }),
  },
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => mockWsManager),
}));

jest.mock('../src/services/TestUserService', () => ({}));

const FCMNotificationService = require('../src/services/FCMNotificationService').default;
const {
  registerFCMBackgroundMessageHandler,
  resetFCMBackgroundMessageHandlerForTests,
} = require('../src/services/FCMBackgroundMessageHandler');
const AsyncStorage = require('@react-native-async-storage/async-storage');
const Logger = require('../src/utils/Logger');

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

describe('FCMNotificationService initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetFCMBackgroundMessageHandlerForTests();
    FCMNotificationService.destroy();
    resetFCMBackgroundMessageHandlerForTests();
    mockDevice.isDevice = false;
    mockPlatform.OS = 'android';
    mockPlatform.Version = 32;
    mockAlert.alert.mockClear();
    mockAppState.currentState = 'active';
    mockAppStateListener = null;
    globalThis.navigationRef = undefined;
    mockAuthState = { uid: 'user_1', userType: 'customer' };
    mockStoreListener = null;
    mockGetToken.mockResolvedValue('mock_token');
    mockHasPermission.mockResolvedValue(1);
    mockRequestPermission.mockResolvedValue(1);
    mockPermissionsAndroid.check.mockResolvedValue(true);
    mockPermissionsAndroid.request.mockResolvedValue('granted');
    AsyncStorage.getItem.mockResolvedValue(null);
    AsyncStorage.setItem.mockResolvedValue();
    AsyncStorage.removeItem.mockResolvedValue();
    mockWsManager.isConnected.mockReturnValue(true);
    mockWsManager.connect.mockResolvedValue();
    mockWsManager.registerFCMToken.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
    FCMNotificationService.destroy();
  });

  it('initializes messaging handlers only once for duplicate calls', async () => {
    await Promise.all([
      FCMNotificationService.initialize(),
      FCMNotificationService.initialize(),
    ]);

    expect(FCMNotificationService.isServiceInitialized()).toBe(true);
    expect(mockOnMessage).toHaveBeenCalledTimes(1);
    expect(mockOnNotificationOpenedApp).toHaveBeenCalledTimes(1);
    expect(mockSetBackgroundMessageHandler).toHaveBeenCalledTimes(1);
  });

  it('does not block initialization waiting for websocket token registration', async () => {
    mockDevice.isDevice = true;
    mockWsManager.isConnected.mockReturnValue(false);

    await FCMNotificationService.initialize();

    expect(FCMNotificationService.isServiceInitialized()).toBe(true);
    await flushMicrotasks();

    expect(mockWsManager.on).toHaveBeenCalledWith('authenticated', expect.any(Function));
    expect(mockWsManager.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockWsManager.connect).not.toHaveBeenCalled();
    expect(mockWsManager.registerFCMToken).not.toHaveBeenCalled();
  });

  it('deduplicates duplicate backend token registrations while one is in flight', async () => {
    mockDevice.isDevice = true;
    let resolveRegistration;
    mockWsManager.registerFCMToken.mockImplementation(
      () => new Promise(resolve => {
        resolveRegistration = resolve;
      })
    );

    const first = FCMNotificationService.scheduleTokenBackendUpdate('mock_token');
    const second = FCMNotificationService.scheduleTokenBackendUpdate('mock_token');

    expect(second).toBe(first);
    expect(mockWsManager.registerFCMToken).toHaveBeenCalledTimes(1);

    resolveRegistration();
    await first;
  });

  it('requests Android 13 POST_NOTIFICATIONS before getting an FCM token', async () => {
    mockDevice.isDevice = true;
    mockPlatform.Version = 33;
    mockPermissionsAndroid.check.mockResolvedValue(false);
    mockPermissionsAndroid.request.mockResolvedValue(mockPermissionsAndroid.RESULTS.GRANTED);

    await FCMNotificationService.getFCMToken();

    expect(mockPermissionsAndroid.check).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
    expect(mockAlert.alert).toHaveBeenCalledWith(
      'Notificações da Leaf',
      expect.stringContaining('corridas'),
      expect.any(Array),
      expect.objectContaining({ cancelable: true })
    );
    expect(mockPermissionsAndroid.request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  it('does not request an FCM token when Android notification permission is denied', async () => {
    mockDevice.isDevice = true;
    mockPlatform.Version = 33;
    mockPermissionsAndroid.check.mockResolvedValue(false);
    mockPermissionsAndroid.request.mockResolvedValue(mockPermissionsAndroid.RESULTS.DENIED);

    const token = await FCMNotificationService.getFCMToken();

    expect(token).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('re-registers the current token when the authenticated user changes', async () => {
    mockDevice.isDevice = true;
    await FCMNotificationService.initialize();
    await FCMNotificationService.backendTokenRegistrationPromise;

    expect(mockWsManager.registerFCMToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', fcmToken: 'mock_token' })
    );

    mockAuthState = { uid: 'user_2', userType: 'driver' };
    mockStoreListener();
    await FCMNotificationService.backendTokenRegistrationPromise;

    expect(mockWsManager.registerFCMToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_2', userType: 'driver', fcmToken: 'mock_token' })
    );
  });

  it('revalidates the current token when websocket authenticates an already logged session', async () => {
    mockDevice.isDevice = true;
    mockAuthState = { uid: 'driver_1', userType: 'driver' };

    await FCMNotificationService.initialize();
    await FCMNotificationService.backendTokenRegistrationPromise;

    const authenticatedListener = mockWsManager.on.mock.calls.find(
      ([eventName]) => eventName === 'authenticated'
    )?.[1];

    expect(authenticatedListener).toEqual(expect.any(Function));
    expect(mockWsManager.registerFCMToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'driver_1', userType: 'driver', fcmToken: 'mock_token' })
    );

    mockAuthState = { uid: 'driver_1', profile: { uid: 'driver_1', userType: 'driver' } };
    authenticatedListener({ uid: 'driver_1', userType: 'driver' });
    await FCMNotificationService.backendTokenRegistrationPromise;

    expect(mockWsManager.registerFCMToken).toHaveBeenCalledTimes(2);
    expect(mockWsManager.registerFCMToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'driver_1', userType: 'driver', fcmToken: 'mock_token' })
    );
  });

  it('does not duplicate background notifications already in the queue', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([
      {
        messageId: 'message_1',
        backgroundQueueKey: 'message_1',
        data: { type: 'trip_update' },
        processed: false,
      },
    ]));

    await FCMNotificationService.saveBackgroundNotification({
      messageId: 'message_1',
      data: { type: 'trip_update' },
    });

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('recovers the background notification queue when persisted JSON is corrupted', async () => {
    AsyncStorage.getItem.mockResolvedValue('{broken-json');

    await FCMNotificationService.saveBackgroundNotification({
      messageId: 'message_after_corruption',
      data: { type: 'trip_update' },
    });

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('backgroundNotifications');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'backgroundNotifications',
      expect.stringContaining('message_after_corruption')
    );
  });

  it('does not throw when native background handler registration is unavailable', () => {
    mockSetBackgroundMessageHandler.mockImplementationOnce(() => {
      throw new Error('native module not ready');
    });

    expect(registerFCMBackgroundMessageHandler()).toBe(false);
    expect(Logger.warn).toHaveBeenCalledWith(
      '⚠️ Handler FCM background indisponível:',
      'native module not ready'
    );
  });

  it('catches failures while saving a top-level background FCM message', async () => {
    let backgroundCallback;
    mockSetBackgroundMessageHandler.mockImplementationOnce((callback) => {
      backgroundCallback = callback;
    });
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('storage unavailable'));

    expect(registerFCMBackgroundMessageHandler()).toBe(true);
    await backgroundCallback({
      messageId: 'background_message_1',
      data: { type: 'trip_update' },
    });

    expect(Logger.error).toHaveBeenCalledWith(
      '❌ Erro ao salvar mensagem FCM em background:',
      expect.any(Error)
    );
  });

  it('processes queued background notifications without saving them again', async () => {
    const queuedNotifications = [
      {
        messageId: 'message_2',
        backgroundQueueKey: 'message_2',
        data: { type: 'trip_update' },
        processed: false,
      },
    ];
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify(queuedNotifications));
    const tripHandler = jest
      .spyOn(FCMNotificationService, 'handleTripUpdate')
      .mockResolvedValue();

    await FCMNotificationService.processPendingNotifications();

    expect(tripHandler).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [, persisted] = AsyncStorage.setItem.mock.calls[0];
    expect(JSON.parse(persisted)).toEqual([
      expect.objectContaining({ messageId: 'message_2', processed: true }),
    ]);

    tripHandler.mockRestore();
  });

  it('does not consume queued background notifications during initialization', async () => {
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([
      {
        messageId: 'message_init',
        backgroundQueueKey: 'message_init',
        data: { type: 'trip_update' },
        processed: false,
      },
    ]));
    const tripHandler = jest
      .spyOn(FCMNotificationService, 'handleTripUpdate')
      .mockResolvedValue();

    await FCMNotificationService.initialize();
    await flushMicrotasks();

    expect(tripHandler).not.toHaveBeenCalled();

    tripHandler.mockRestore();
  });

  it('processes queued background notifications after a matching handler is registered post-initialization', async () => {
    jest.useFakeTimers();
    const customHandler = jest.fn().mockResolvedValue();
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([
      {
        messageId: 'message_late_handler',
        backgroundQueueKey: 'message_late_handler',
        data: { type: 'late_push_type', bookingId: 'booking_late' },
        processed: false,
      },
    ]));

    await FCMNotificationService.initialize();
    FCMNotificationService.registerNotificationHandler('late_push_type', customHandler);
    await jest.advanceTimersByTimeAsync(50);

    expect(customHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message_late_handler',
        data: expect.objectContaining({ bookingId: 'booking_late' }),
      })
    );
    const [, persisted] = AsyncStorage.setItem.mock.calls[0];
    expect(JSON.parse(persisted)).toEqual([
      expect.objectContaining({ messageId: 'message_late_handler', processed: true }),
    ]);
  });

  it('processes queued background notifications when the app returns to foreground', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    await FCMNotificationService.initialize();
    expect(mockAppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    const tripHandler = jest
      .spyOn(FCMNotificationService, 'handleTripUpdate')
      .mockResolvedValue();
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([
      {
        messageId: 'message_resume',
        backgroundQueueKey: 'message_resume',
        data: { type: 'trip_update' },
        processed: false,
      },
    ]));

    mockAppStateListener('background');
    mockAppStateListener('active');
    await flushMicrotasks();

    expect(tripHandler).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message_resume' })
    );

    tripHandler.mockRestore();
  });

  it('processes queued background notifications with registered custom handlers', async () => {
    const customHandler = jest.fn().mockResolvedValue();
    FCMNotificationService.registerNotificationHandler('ride_status_update', customHandler);
    AsyncStorage.getItem.mockResolvedValue(JSON.stringify([
      {
        messageId: 'message_custom',
        backgroundQueueKey: 'message_custom',
        data: { type: 'ride_status_update', bookingId: 'booking_1' },
        processed: false,
      },
    ]));

    await FCMNotificationService.processPendingNotifications();

    expect(customHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'message_custom',
        data: expect.objectContaining({ bookingId: 'booking_1' }),
      })
    );
    const [, persisted] = AsyncStorage.setItem.mock.calls[0];
    expect(JSON.parse(persisted)).toEqual([
      expect.objectContaining({ messageId: 'message_custom', processed: true }),
    ]);
  });

  it('navigates trip push opens to the active passenger trip route', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'trip_update',
        bookingId: 'booking_1',
        status: 'accepted',
      },
    });

    expect(target).toEqual(
      expect.objectContaining({
        routeName: 'RobotaxiPrototypeTrip',
        params: expect.objectContaining({
          bookingId: 'booking_1',
          status: 'accepted',
          source: 'push',
        }),
      })
    );
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.objectContaining({ bookingId: 'booking_1' })
    );
  });

  it('navigates driver document request pushes to the driver documents route', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'driver_document_request',
        documentType: 'cnh',
        userType: 'driver',
      },
    });

    expect(target).toEqual(
      expect.objectContaining({
        routeName: 'RobotaxiPrototypeDriverDocuments',
        params: expect.objectContaining({
          notificationType: 'driver_document_request',
          userType: 'driver',
          documentType: 'cnh',
        }),
      })
    );
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeDriverDocuments',
      expect.objectContaining({ documentType: 'cnh' })
    );
  });

  it('navigates waitlist pushes to the isolated driver waitlist status route', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'driver_waitlist_update',
        waitlistEvent: 'approved',
        status: 'approved',
        userType: 'driver',
      },
    });

    expect(target).toEqual(
      expect.objectContaining({
        routeName: 'RobotaxiPrototypeDriverWaitlistStatus',
        params: expect.objectContaining({
          notificationType: 'driver_waitlist_update',
          status: 'approved',
          userType: 'driver',
        }),
      })
    );
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeDriverWaitlistStatus',
      expect.objectContaining({ status: 'approved' })
    );
  });

  it('navigates identity reverification pushes to the prototype home with challenge context', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'kyc_reverification_required',
        userType: 'driver',
        requirement: 'IDENTITY_REVERIFICATION',
        challengeId: 'idrev_abc123',
        reason: 'Por segurança, precisamos validar sua identidade.',
      },
    });

    expect(target).toEqual(
      expect.objectContaining({
        routeName: 'RobotaxiPrototype',
        params: expect.objectContaining({
          notificationType: 'kyc_reverification_required',
          userType: 'driver',
          requirement: 'IDENTITY_REVERIFICATION',
          challengeId: 'idrev_abc123',
        }),
      })
    );
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototype',
      expect.objectContaining({
        requirement: 'IDENTITY_REVERIFICATION',
        challengeId: 'idrev_abc123',
      })
    );
  });

  it('retries push navigation after the root navigation ref becomes ready', () => {
    jest.useFakeTimers();
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = { current: null };

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'trip_update',
        bookingId: 'booking_pending_ref',
      },
    });

    expect(target.routeName).toBe('RobotaxiPrototypeTrip');
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    globalThis.navigationRef.current = navigationRef;
    jest.advanceTimersByTime(300);

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.objectContaining({ bookingId: 'booking_pending_ref' })
    );
    jest.useRealTimers();
  });

  it('continues retrying cold-start push navigation beyond the first few readiness checks', async () => {
    jest.useFakeTimers();
    const navigate = jest.fn();
    const isReady = jest.fn(() => isReady.mock.calls.length >= 20);
    globalThis.navigationRef = {
      current: {
        isReady,
        navigate,
      },
    };

    const target = FCMNotificationService.navigateToScreen({
      data: {
        type: 'trip_update',
        bookingId: 'booking_cold_start',
      },
    });

    expect(target.routeName).toBe('RobotaxiPrototypeTrip');
    expect(navigate).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(19 * 300);

    expect(navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.objectContaining({
        bookingId: 'booking_cold_start',
        source: 'push',
      })
    );
  });

  it('does not navigate to untrusted push route names', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    FCMNotificationService.navigateToScreen({
      data: {
        screen: 'DangerousInternalRoute',
      },
    });

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'Notifications',
      expect.objectContaining({
        originalScreen: 'DangerousInternalRoute',
      })
    );
  });

  it('maps legacy push screen names to canonical Robotaxi routes when the notification type is known', () => {
    const navigationRef = {
      isReady: jest.fn(() => true),
      navigate: jest.fn(),
    };
    globalThis.navigationRef = navigationRef;

    const paymentTarget = FCMNotificationService.navigateToScreen({
      data: {
        screen: 'PaymentSuccess',
        type: 'payment_success',
        bookingId: 'booking_payment_success',
      },
    });
    const searchTarget = FCMNotificationService.navigateToScreen({
      data: {
        routeName: 'DriverSearch',
        type: 'trip_update',
        bookingId: 'booking_trip_update',
        status: 'accepted',
      },
    });

    expect(paymentTarget.routeName).toBe('RobotaxiPrototypePaymentSuccess');
    expect(searchTarget.routeName).toBe('RobotaxiPrototypeTrip');
    expect(navigationRef.navigate).toHaveBeenNthCalledWith(
      1,
      'RobotaxiPrototypePaymentSuccess',
      expect.objectContaining({
        bookingId: 'booking_payment_success',
        source: 'push',
      })
    );
    expect(navigationRef.navigate).toHaveBeenNthCalledWith(
      2,
      'RobotaxiPrototypeTrip',
      expect.objectContaining({
        bookingId: 'booking_trip_update',
        status: 'accepted',
        source: 'push',
      })
    );
  });
});

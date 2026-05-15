const mockOnMessage = jest.fn(() => jest.fn());
const mockOnNotificationOpenedApp = jest.fn(() => jest.fn());
const mockGetInitialNotification = jest.fn(() => Promise.resolve(null));
const mockSetBackgroundMessageHandler = jest.fn();
const mockGetToken = jest.fn(() => Promise.resolve('mock_token'));
const mockDevice = {
  isDevice: false,
};
const mockWsManager = {
  isConnected: jest.fn(() => true),
  connect: jest.fn(),
  registerFCMToken: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock('@react-native-firebase/messaging', () => () => ({
  onMessage: mockOnMessage,
  onNotificationOpenedApp: mockOnNotificationOpenedApp,
  getInitialNotification: mockGetInitialNotification,
  setBackgroundMessageHandler: mockSetBackgroundMessageHandler,
  getToken: mockGetToken,
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
    getState: jest.fn(() => ({ auth: { uid: 'user_1', userType: 'customer' } })),
  },
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => mockWsManager),
}));

jest.mock('../src/services/TestUserService', () => ({}));

const FCMNotificationService = require('../src/services/FCMNotificationService').default;

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

describe('FCMNotificationService initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FCMNotificationService.destroy();
    mockDevice.isDevice = false;
    mockGetToken.mockResolvedValue('mock_token');
    mockWsManager.isConnected.mockReturnValue(true);
    mockWsManager.connect.mockResolvedValue();
  });

  afterEach(() => {
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

    expect(mockWsManager.on).toHaveBeenCalledTimes(1);
    expect(mockWsManager.connect).toHaveBeenCalledTimes(1);
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
});

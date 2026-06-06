const events = [];

const mockPlatform = {
  OS: 'android',
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
    READ_PHONE_STATE: 'android.permission.READ_PHONE_STATE',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
  },
  check: jest.fn(() => Promise.resolve(false)),
  request: jest.fn(() => Promise.resolve('granted')),
};

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(() => {
    events.push('native-foreground');
    return Promise.resolve({ status: 'granted', granted: true });
  }),
  getBackgroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied', canAskAgain: true })),
  requestBackgroundPermissionsAsync: jest.fn(() => {
    events.push('native-background');
    return Promise.resolve({ status: 'granted', granted: true });
  }),
};

const mockAsyncStorage = {
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
};

jest.mock('react-native', () => ({
  Alert: mockAlert,
  PermissionsAndroid: mockPermissionsAndroid,
  Platform: mockPlatform,
}));

jest.mock('expo-location', () => mockLocation);

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

const {
  BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY,
  requestBackgroundLocationPermissionWithDisclosure,
  requestForegroundLocationPermissionWithDisclosure,
  requestPostNotificationsPermissionWithDisclosure,
  setAndroidPermissionDisclosurePresenter,
} = require('../src/services/AndroidPermissionDisclosure');

describe('AndroidPermissionDisclosure', () => {
  let unregisterPresenter;

  beforeEach(() => {
    events.length = 0;
    jest.clearAllMocks();
    mockPlatform.OS = 'android';
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: true });
    mockLocation.getBackgroundPermissionsAsync.mockResolvedValue({ status: 'denied', canAskAgain: true });
    mockLocation.requestForegroundPermissionsAsync.mockImplementation(() => {
      events.push('native-foreground');
      return Promise.resolve({ status: 'granted', granted: true });
    });
    mockLocation.requestBackgroundPermissionsAsync.mockImplementation(() => {
      events.push('native-background');
      return Promise.resolve({ status: 'granted', granted: true });
    });
  });

  afterEach(() => {
    unregisterPresenter?.();
    unregisterPresenter = null;
  });

  it('shows the Leaf disclosure before requesting foreground location on Android', async () => {
    unregisterPresenter = setAndroidPermissionDisclosurePresenter(async (config) => {
      events.push(`disclosure-${config.kind}`);
      return true;
    });

    const result = await requestForegroundLocationPermissionWithDisclosure();

    expect(result.status).toBe('granted');
    expect(events).toEqual(['disclosure-foreground-location', 'native-foreground']);
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('does not request foreground location when the Leaf disclosure is declined', async () => {
    unregisterPresenter = setAndroidPermissionDisclosurePresenter(async (config) => {
      events.push(`disclosure-${config.kind}`);
      return false;
    });

    const result = await requestForegroundLocationPermissionWithDisclosure();

    expect(result.status).toBe('denied');
    expect(result.granted).toBe(false);
    expect(events).toEqual(['disclosure-foreground-location']);
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('fails closed for foreground location when the Leaf modal presenter is unavailable', async () => {
    const result = await requestForegroundLocationPermissionWithDisclosure();

    expect(result.status).toBe('denied');
    expect(result.granted).toBe(false);
    expect(events).toEqual([]);
    expect(mockAlert.alert).not.toHaveBeenCalled();
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('shows the Leaf disclosure before requesting background location on Android', async () => {
    unregisterPresenter = setAndroidPermissionDisclosurePresenter(async (config) => {
      events.push(`disclosure-${config.kind}`);
      return true;
    });

    const result = await requestBackgroundLocationPermissionWithDisclosure();

    expect(result.status).toBe('granted');
    expect(events).toEqual(['disclosure-background-location', 'native-background']);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY,
      'true'
    );
    expect(mockLocation.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps non-location Android disclosures exempt from the friendly alert patch fallback', async () => {
    const result = await requestPostNotificationsPermissionWithDisclosure();

    expect(result).toBe('granted');
    expect(mockAlert.alert).toHaveBeenCalledTimes(1);
    const alertOptions = mockAlert.alert.mock.calls[0][3];
    expect(alertOptions.__skipFriendlyAlertPatch).toBe(true);
    expect(mockPermissionsAndroid.request).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
  });
});

const mockRemoveItem = jest.fn(() => Promise.resolve());
const mockMultiRemove = jest.fn(() => Promise.resolve());

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: mockRemoveItem,
  multiRemove: mockMultiRemove,
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/state/appStore', () => ({
  store: {
    getState: () => ({
      settingsdata: {
        settings: {},
      },
    }),
  },
}));

jest.mock('../src/services/canonical/registrationService', () => ({
  checkUserExists: jest.fn(),
}));

jest.mock('../src/services/canonical/locationService', () => ({
  storeAddresses: jest.fn(() => jest.fn()),
}));

const mockAuth = {
  currentUser: { uid: 'driver-1' },
  signOut: jest.fn(() => Promise.resolve()),
};
const mockUserRef = {
  off: jest.fn(),
  once: jest.fn(() => Promise.resolve({ val: () => ({ usertype: 'driver' }) })),
  update: jest.fn(() => Promise.resolve()),
};
const mockWalletRef = { off: jest.fn() };
const mockNotificationsRef = { off: jest.fn() };
const mockLicenseRef = {
  put: jest.fn(() => Promise.resolve()),
  getDownloadURL: jest.fn(() => Promise.resolve('https://cdn.leaf/license.jpg')),
};
const mockProfileImageRef = {
  put: jest.fn(() => Promise.resolve()),
  putFile: jest.fn(() => Promise.resolve()),
  getDownloadURL: jest.fn(() => Promise.resolve('https://cdn.leaf/profile.jpg')),
};
const mockSavedAddressChildRef = {
  update: jest.fn(() => Promise.resolve()),
};
const mockSavedAddressesRef = {
  once: jest.fn(() => Promise.resolve({
    val: () => ({
      home: {
        name: 'Casa',
        description: 'Antigo',
      },
    }),
  })),
  child: jest.fn(() => mockSavedAddressChildRef),
  push: jest.fn(() => Promise.resolve()),
};

const mockSingleUserRef = jest.fn(() => mockUserRef);

jest.mock('../src/services/canonical/firebaseConfig', () => ({
  firebase: {
    config: { projectId: 'leaf-test' },
    auth: mockAuth,
    storage: {
      ref: jest.fn(() => mockLicenseRef),
    },
    singleUserRef: mockSingleUserRef,
    walletHistoryRef: jest.fn(() => mockWalletRef),
    userNotificationsRef: jest.fn(() => mockNotificationsRef),
    driverDocsRef: jest.fn(() => mockLicenseRef),
    driverDocsRefBack: jest.fn(() => mockLicenseRef),
    verifyIdImageRef: jest.fn(() => mockLicenseRef),
    profileImageRef: jest.fn(() => mockProfileImageRef),
  },
}));

const {
  logOut,
  saveAddresses,
  signOff,
  updateProfile,
  updateProfileImage,
} = require('../src/services/canonical/profileService');

describe('profileService canonical actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.currentUser = { uid: 'driver-1' };
    mockUserRef.once.mockResolvedValue({ val: () => ({ usertype: 'driver' }) });
    mockSingleUserRef.mockImplementation(() => mockUserRef);
  });

  it('updates profile documents through canonical Firebase refs', async () => {
    const payload = {
      firstName: 'Carlos',
      licenseImage: 'license-blob',
    };

    await updateProfile(payload)(jest.fn());

    expect(mockLicenseRef.put).toHaveBeenCalledWith('license-blob');
    expect(mockUserRef.update).toHaveBeenCalledWith({
      firstName: 'Carlos',
      licenseImage: 'https://cdn.leaf/license.jpg',
    });
  });

  it('keeps driver profile image changes locked', async () => {
    await expect(updateProfileImage('image-blob')).rejects.toThrow('PROFILE_IMAGE_LOCKED_FOR_DRIVER');

    expect(mockProfileImageRef.put).not.toHaveBeenCalled();
    expect(mockProfileImageRef.putFile).not.toHaveBeenCalled();
  });

  it('logs out through signOff and keeps logOut as the same contract', async () => {
    const dispatch = jest.fn();

    await logOut()(dispatch);

    expect(logOut).toBe(signOff);
    expect(mockUserRef.off).toHaveBeenCalled();
    expect(mockWalletRef.off).toHaveBeenCalled();
    expect(mockNotificationsRef.off).toHaveBeenCalled();
    expect(mockUserRef.update).toHaveBeenCalledWith({ driverActiveStatus: false });
    expect(mockAuth.signOut).toHaveBeenCalled();
    expect(mockRemoveItem).toHaveBeenCalledWith('@auth_uid');
    expect(mockMultiRemove).toHaveBeenCalledWith([
      '@user_data',
      '@auth_token',
      '@auth_uid',
      'fcmToken',
    ]);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'USER_SIGN_OUT',
      payload: null,
    });
  });

  it('updates an existing saved address by name', async () => {
    const rootUserRef = {
      child: jest.fn(() => mockSavedAddressesRef),
    };
    mockSingleUserRef.mockReturnValue(rootUserRef);

    await saveAddresses('customer-1', {
      add: 'Rua das Palmeiras, 10',
      lat: -22.9,
      lng: -43.1,
    }, 'Casa');

    expect(mockSavedAddressesRef.child).toHaveBeenCalledWith('home');
    expect(mockSavedAddressChildRef.update).toHaveBeenCalledWith({
      description: 'Rua das Palmeiras, 10',
      lat: -22.9,
      lng: -43.1,
      count: 1,
      name: 'Casa',
    });
    expect(mockSavedAddressesRef.push).not.toHaveBeenCalled();
  });
});

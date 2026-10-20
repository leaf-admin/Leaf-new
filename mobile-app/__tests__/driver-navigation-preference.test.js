import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

const mockShowLeafChoiceSheet = jest.fn();
jest.mock('../src/components/design-system/LeafChoiceSheet', () => ({
  showLeafChoiceSheet: (...args) => mockShowLeafChoiceSheet(...args),
}));

const {
  choosePreferredNavigationApp,
  claimAutoNavigationOpen,
  getPreferredNavigationApp,
  navigationAppOptions,
  openPreferredDriverNavigation,
  setAutoNavigationEnabled,
  setPreferredNavigationApp,
} = require('../src/services/driverNavigationPreference');

const pickup = { latitude: -22.9208, longitude: -43.4060 };

describe('driver navigation preference', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockShowLeafChoiceSheet.mockReset();
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    Linking.openURL.mockClear();
    Linking.canOpenURL.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('offers Apple Maps only on iOS', () => {
    expect(navigationAppOptions('android').map((o) => o.key)).toEqual(['waze', 'google_maps']);
    expect(navigationAppOptions('ios').map((o) => o.key)).toEqual(['waze', 'google_maps', 'apple_maps']);
  });

  it('asks once, remembers the app and then opens it directly', async () => {
    mockShowLeafChoiceSheet.mockResolvedValueOnce('waze');

    await openPreferredDriverNavigation({ coordinate: pickup, phase: 'pickup' });
    expect(mockShowLeafChoiceSheet).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://waze.com/ul?ll=-22.9208,-43.406&navigate=yes');
    expect(await getPreferredNavigationApp()).toBe('waze');

    await openPreferredDriverNavigation({ coordinate: pickup, phase: 'destination' });
    expect(mockShowLeafChoiceSheet).toHaveBeenCalledTimes(1);
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
  });

  it('opens Google Maps with driving directions', async () => {
    await setPreferredNavigationApp('google_maps');
    await openPreferredDriverNavigation({ coordinate: pickup });
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.google.com/maps/dir/?api=1&destination=-22.9208,-43.406&travelmode=driving&dir_action=navigate');
  });

  it('does not open anything when the driver dismisses the first question', async () => {
    mockShowLeafChoiceSheet.mockResolvedValueOnce(null);
    expect(await openPreferredDriverNavigation({ coordinate: pickup })).toBeNull();
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(await getPreferredNavigationApp()).toBeNull();
  });

  it('"ask every time" clears the saved app', async () => {
    await setPreferredNavigationApp('waze');
    mockShowLeafChoiceSheet.mockResolvedValueOnce('ask');
    expect(await choosePreferredNavigationApp({ allowAskEveryTime: true })).toBeNull();
    expect(await getPreferredNavigationApp()).toBeNull();
  });

  it('opens automatically once per ride and phase, and never when turned off', async () => {
    expect(await claimAutoNavigationOpen('booking_1', 'pickup')).toBe(true);
    expect(await claimAutoNavigationOpen('booking_1', 'pickup')).toBe(false);
    expect(await claimAutoNavigationOpen('booking_1', 'destination')).toBe(true);
    expect(await claimAutoNavigationOpen('', 'pickup')).toBe(false);

    await setAutoNavigationEnabled(false);
    expect(await claimAutoNavigationOpen('booking_2', 'pickup')).toBe(false);
  });

  it('ignores an unknown stored app', async () => {
    await AsyncStorage.setItem('leaf:driver-navigation-app:v1', 'apple_maps');
    const original = Platform.OS;
    Platform.OS = 'android';
    try {
      expect(await getPreferredNavigationApp()).toBeNull();
    } finally {
      Platform.OS = original;
    }
  });
});

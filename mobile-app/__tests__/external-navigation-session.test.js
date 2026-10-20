import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import {
  closeExternalNavigation,
  getRecentExternalNavigation,
  rememberExternalNavigation,
} from '../src/services/externalNavigationSession';

jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(() => Promise.resolve()) }));

describe('external navigation at the end of the ride', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    Platform.OS = 'android';
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  it('remembers the navigation app opened during the ride, for a few hours only', async () => {
    await rememberExternalNavigation('google_maps', 1000);
    expect(await getRecentExternalNavigation(2000)).toEqual({ app: 'google_maps', label: 'Google Maps' });
    expect(await getRecentExternalNavigation(1000 + 7 * 60 * 60 * 1000)).toBeNull();
    await rememberExternalNavigation('unknown_app', 3000);
    expect(await getRecentExternalNavigation(3000)).toEqual({ app: 'google_maps', label: 'Google Maps' });
  });

  it('asks Google Maps to leave navigation with a map point, and forgets the session', async () => {
    await rememberExternalNavigation('google_maps');
    await closeExternalNavigation({ app: 'google_maps', coordinate: { latitude: -22.98, longitude: -43.36 } });
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith('android.intent.action.VIEW', {
      data: 'geo:-22.98,-43.36?z=16',
      packageName: 'com.google.android.apps.maps',
      className: 'com.google.android.maps.MapsActivity',
      flags: 0x10000000,
    });
    expect(await getRecentExternalNavigation()).toBeNull();
  });

  it('opens Waze so the driver ends the route there', async () => {
    await closeExternalNavigation({ app: 'waze' });
    expect(Linking.openURL).toHaveBeenCalledWith('waze://');
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { Alert, Linking } from 'react-native';
import { useMobilePreferences } from '../src/components/MobilePreferencesProvider';
import FCMNotificationService from '../src/services/FCMNotificationService';
import { isLeafVoiceAvailable } from '../src/services/LeafVoiceGuidanceService';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiSettingsScreen from '../src/screens/prototype/RobotaxiSettingsScreen';
import { CURRENT_SURFACE_STATUS } from '../src/screens/prototype/currentSurfaceStatus';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { ROBOTAXI_SETTINGS_ITEMS } from '../src/screens/prototype/robotaxiSettingsConfig';

jest.mock('../src/components/MobilePreferencesProvider', () => ({ useMobilePreferences: jest.fn() }));
jest.mock('../src/services/FCMNotificationService', () => ({ __esModule: true, default: { hasNotificationPermission: jest.fn(), requestUserPermission: jest.fn(), getFCMToken: jest.fn().mockResolvedValue('token') } }));
jest.mock('../src/services/LeafVoiceGuidanceService', () => ({ isLeafVoiceAvailable: jest.fn(), stopLeafNavigationVoice: jest.fn().mockResolvedValue() }));

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock('../src/components/prototype/PrototypeScreenTransition', () => {
  const React = require('react');
  return ({ children }) => <>{children}</>;
});

jest.mock('../src/components/prototype/PrototypeDismissibleSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});

jest.mock('../src/hooks/useAccountDeletionFlow', () => ({
  useAccountDeletionFlow: () => ({ promptAccountDeletion: jest.fn() }),
}));

jest.mock('../src/hooks/useAccountSessionReset', () => ({
  useAccountSessionReset: () => ({ resetSessionToStart: jest.fn() }),
}));

jest.mock('react-redux', () => ({
  useSelector: jest.fn(selector => selector({ auth: { profile: { uid: 'customer_1' } } })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('live Leaf settings surface', () => {
  let preferences;
  let navigation;
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    preferences = { preferences: { trafficLayerEnabled: true, voiceGuidanceEnabled: false }, ready: true, loading: false, saving: false, error: '', refresh: jest.fn(), update: jest.fn().mockResolvedValue({}) };
    useMobilePreferences.mockImplementation(() => preferences);
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'customer_1' }, activeRole: 'customer' });
    FCMNotificationService.hasNotificationPermission.mockResolvedValue(true);
    FCMNotificationService.requestUserPermission.mockResolvedValue(true);
    isLeafVoiceAvailable.mockResolvedValue(true);
    navigation = { navigate: jest.fn(), replace: jest.fn(), addListener: jest.fn() };
  });
  afterEach(() => jest.restoreAllMocks());
  const screen = () => render(<RobotaxiSettingsScreen navigation={navigation} route={{ key: 'settings' }} />);

  it('exposes notifications and locale for passengers without driver-only toggles', async () => {
    const ui = screen();
    await waitFor(() => expect(ui.getByText('Ativadas no dispositivo')).toBeTruthy());
    expect(ui.getByText('Português do Brasil')).toBeTruthy();
    expect(ui.queryByTestId('robotaxi-settings-row-voice')).toBeNull();
    expect(ui.queryByTestId('robotaxi-settings-row-traffic')).toBeNull();
    fireEvent.press(ui.getByLabelText('Privacidade'));
    expect(navigation.navigate).toHaveBeenCalledWith('PrivacyPolicy');
  });

  it('saves the traffic preference for the driver', async () => {
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'driver_1' }, activeRole: 'driver' });
    const ui = screen();
    expect(ui.getByTestId('robotaxi-settings-switch-traffic').props.accessibilityState.checked).toBe(true);
    fireEvent(ui.getByTestId('robotaxi-settings-switch-traffic'), 'valueChange', false);
    await waitFor(() => expect(preferences.update).toHaveBeenCalledWith({ trafficLayerEnabled: false }));
  });

  it('opens OS settings for granted notifications instead of faking a server mute', async () => {
    const ui = screen();
    await waitFor(() => expect(ui.getByText('Ativadas no dispositivo')).toBeTruthy());
    fireEvent.press(ui.getByLabelText('Notificações'));
    await waitFor(() => expect(Linking.openSettings).toHaveBeenCalled());
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('requests notifications only after a user action and handles denial', async () => {
    FCMNotificationService.hasNotificationPermission.mockResolvedValue(false);
    FCMNotificationService.requestUserPermission.mockResolvedValue(false);
    const ui = screen();
    await waitFor(() => expect(ui.getByText('Desativadas no dispositivo')).toBeTruthy());
    expect(FCMNotificationService.requestUserPermission).not.toHaveBeenCalled();
    fireEvent.press(ui.getByLabelText('Notificações'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Notificações desativadas', expect.any(String), expect.any(Array)));
  });

  it('enables voice for drivers only after confirming native availability', async () => {
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'driver_1' }, activeRole: 'driver' });
    const ui = screen();
    fireEvent(ui.getByTestId('robotaxi-settings-switch-voice'), 'valueChange', true);
    await waitFor(() => expect(preferences.update).toHaveBeenCalledWith({ voiceGuidanceEnabled: true }));
    expect(isLeafVoiceAvailable).toHaveBeenCalled();
  });

  it('registers push after permission is granted from the settings surface', async () => {
    FCMNotificationService.hasNotificationPermission.mockResolvedValue(false);
    const ui = screen();
    await waitFor(() => expect(ui.getByText('Desativadas no dispositivo')).toBeTruthy());
    fireEvent.press(ui.getByLabelText('Notificações'));
    await waitFor(() => expect(FCMNotificationService.getFCMToken).toHaveBeenCalledTimes(1));
    expect(ui.getByText('Ativadas no dispositivo')).toBeTruthy();
  });

  it('does not save voice enabled when the native voice is unavailable', async () => {
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'driver_1' }, activeRole: 'driver' });
    isLeafVoiceAvailable.mockResolvedValue(false);
    const ui = screen();
    fireEvent(ui.getByTestId('robotaxi-settings-switch-voice'), 'valueChange', true);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Voz indisponível', expect.any(String)));
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('shows retry and disables toggles until real preferences load', async () => {
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'driver_1' }, activeRole: 'driver' });
    preferences.ready = false;
    preferences.error = 'Offline';
    const ui = screen();
    expect(ui.getByTestId('robotaxi-settings-switch-traffic').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(ui.getByTestId('robotaxi-settings-retry'));
    expect(preferences.refresh).toHaveBeenCalledWith({ forceRefresh: true });
    await act(async () => {});
  });

  it('keeps the confirmed value and reports failed persistence', async () => {
    usePrototypeRideRuntime.mockReturnValue({ riderProfile: { uid: 'driver_1' }, activeRole: 'driver' });
    preferences.update.mockRejectedValue(new Error('Sem conexão'));
    const ui = screen();
    fireEvent(ui.getByTestId('robotaxi-settings-switch-traffic'), 'valueChange', false);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Configuração não salva', 'Sem conexão'));
    expect(ui.getByTestId('robotaxi-settings-switch-traffic').props.accessibilityState.checked).toBe(true);
  });

  it('assigns current status to every implemented setting', async () => {
    Object.values(ROBOTAXI_SETTINGS_ITEMS).forEach(item => expect(item.status).toBe('current'));
    const ui = screen();
    fireEvent.press(ui.getByLabelText('Idioma'));
    expect(Alert.alert).toHaveBeenCalledWith('Idioma do aplicativo', expect.stringContaining('Português do Brasil'));
    await act(async () => {});
  });
});

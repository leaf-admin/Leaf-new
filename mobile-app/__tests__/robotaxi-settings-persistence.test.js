import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RobotaxiSettingsScreen from '../src/screens/prototype/RobotaxiSettingsScreen';
import { CURRENT_SURFACE_STATUS } from '../src/screens/prototype/currentSurfaceStatus';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { ROBOTAXI_SETTINGS_ITEMS } from '../src/screens/prototype/robotaxiSettingsConfig';

const mockGetPreferences = jest.fn();
const mockUpdatePreferences = jest.fn();

jest.mock('../src/services/MobilePreferencesService', () => ({
  __esModule: true,
  default: {
    getPreferences: (...args) => mockGetPreferences(...args),
    updatePreferences: (...args) => mockUpdatePreferences(...args),
  },
}));

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

describe('RobotaxiSettingsScreen current renderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrototypeRideRuntime.mockReturnValue({
      riderProfile: { uid: 'customer_1' },
    });
    mockGetPreferences.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  });

  it('renders only current account actions without calling the remote preference adapter', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), addListener: jest.fn() };
    const screen = render(
      <RobotaxiSettingsScreen navigation={navigation} route={{ key: 'settings' }} />,
    );

    const disabledRows = [
      'robotaxi-settings-row-notifications',
      'robotaxi-settings-row-language',
      'robotaxi-settings-row-traffic',
      'robotaxi-settings-row-voice',
    ];
    disabledRows.forEach(testID => expect(screen.queryByTestId(testID)).toBeNull());

    expect(screen.queryByText('Em breve')).toBeNull();
    expect(screen.queryByTestId('robotaxi-settings-loading')).toBeNull();
    expect(screen.queryByText('Configurações indisponíveis')).toBeNull();
    expect(mockGetPreferences).not.toHaveBeenCalled();
    expect(mockUpdatePreferences).not.toHaveBeenCalled();

    const currentRows = [
      'robotaxi-settings-row-privacy',
      'robotaxi-settings-row-logout',
      'robotaxi-settings-row-delete-account',
      'robotaxi-settings-open-support',
    ];
    currentRows.forEach(testID => {
      expect(screen.getByTestId(testID).props.accessibilityState).toEqual({ disabled: false });
    });

    fireEvent.press(screen.getByLabelText('Privacidade'));
    expect(navigation.navigate).toHaveBeenCalledWith('PrivacyPolicy');
    fireEvent.press(screen.getByLabelText('Falar com suporte'));
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototypeSupport');
  });

  it('assigns one canonical status to every setting item', () => {
    const items = Object.values(ROBOTAXI_SETTINGS_ITEMS);
    const allowedStatuses = Object.values(CURRENT_SURFACE_STATUS);

    items.forEach(item => expect(allowedStatuses).toContain(item.status));
    expect(ROBOTAXI_SETTINGS_ITEMS.notifications.status).toBe(CURRENT_SURFACE_STATUS.DISABLED);
    expect(ROBOTAXI_SETTINGS_ITEMS.privacy.status).toBe(CURRENT_SURFACE_STATUS.CURRENT);
  });

  it('keeps human accessibility labels on the current surface', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), addListener: jest.fn() };
    const screen = render(
      <RobotaxiSettingsScreen navigation={navigation} route={{ key: 'settings' }} />,
    );

    expect(screen.getByLabelText('Fechar configurações')).toBeTruthy();
    expect(screen.getByLabelText('Privacidade')).toBeTruthy();
    expect(screen.getByLabelText('Sair da conta')).toBeTruthy();
    expect(screen.getByLabelText('Excluir conta')).toBeTruthy();
    expect(screen.getByLabelText('Falar com suporte')).toBeTruthy();
  });
});

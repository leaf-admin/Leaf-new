import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RobotaxiMenuScreen from '../src/screens/prototype/RobotaxiMenuScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => false }));
jest.mock('react-redux', () => ({ useSelector: selector => selector({ auth: { profile: {} } }) }));
jest.mock('../src/hooks/useAccountSessionReset', () => ({ useAccountSessionReset: () => ({ resetSessionToStart: jest.fn() }) }));
jest.mock('../src/components/prototype/LeafVisualElements', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LeafAccountCard: () => <View />, LeafObjectIcon: () => <View /> };
});

jest.mock('../src/config/pilotLaunchProfile', () => ({
  getPilotLaunchFeatureSnapshot: () => ({ referralProgramsEnabled: false }),
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('RobotaxiMenuScreen availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrototypeRideRuntime.mockReturnValue({ activeRole: 'customer' });
  });

  it('covers the retained map with an opaque full-size account root', () => {
    const screen = render(<RobotaxiMenuScreen navigation={{ navigate: jest.fn() }} route={{ key: 'account', params: { rootTab: true } }} />);
    const { StyleSheet } = require('react-native');
    expect(StyleSheet.flatten(screen.getByTestId('robotaxi-menu-screen').props.style)).toEqual(expect.objectContaining({ flex: 1, backgroundColor: '#FFFFFF' }));
  });

  it('hides out-of-pilot items while current items still navigate', () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const screen = render(
      <RobotaxiMenuScreen navigation={navigation} route={{ key: 'menu' }} />,
    );

    expect(screen.queryByTestId('robotaxi-menu-item-passenger-invites')).toBeNull();
    expect(screen.queryByText('Fora do piloto')).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototypeInvites');

    fireEvent.press(screen.getByTestId('leaf-account-group-settings'));
    const settingsRow = screen.getByTestId('robotaxi-menu-item-settings');
    expect(settingsRow.props.accessibilityHint).toBe('Conta, privacidade e suporte');

    fireEvent.press(screen.getByTestId('robotaxi-menu-close-button'));
    fireEvent.press(screen.getByTestId('leaf-account-group-profile'));
    const profileRow = screen.getByTestId('robotaxi-menu-item-edit-profile');
    expect(profileRow.props.accessibilityState).toEqual({ disabled: false });
    fireEvent.press(profileRow);
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeProfile', { returnToAccount: true, editProfile: true });
  });
});

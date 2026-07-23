import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RobotaxiMenuScreen from '../src/screens/prototype/RobotaxiMenuScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';

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

    const profileRow = screen.getByTestId('robotaxi-menu-item-edit-profile');
    expect(profileRow.props.accessibilityState).toEqual({ disabled: false });
    fireEvent.press(profileRow);
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototypeProfile');
  });
});

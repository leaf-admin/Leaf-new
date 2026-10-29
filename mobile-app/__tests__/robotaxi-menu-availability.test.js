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
  return {
    LeafAccountCard: () => <View />,
    LeafObjectIcon: () => <View />,
    resolveLeafAccountMetrics: () => ({ rating: '5,00', trips: 12, membership: '4 meses', initials: 'LT' }),
  };
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

    // Um nível só: as linhas abrem a tela final, sem subtela de grupo.
    expect(screen.queryByTestId('leaf-account-group-settings')).toBeNull();
    const settingsRow = screen.getByTestId('robotaxi-menu-item-settings');
    expect(settingsRow.props.accessibilityHint).toBe('Notificações, senha e privacidade');
    ['payment-info', 'achievements', 'privacy-account-deletion'].forEach(key =>
      expect(screen.queryByTestId(`robotaxi-menu-item-${key}`)).toBeNull());

    // Preferências de viagem ficam na seção Viagens, com título de seção (lista agrupada).
    fireEvent.press(screen.getByTestId('robotaxi-menu-item-ride-preferences'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeafRidePreferences', expect.anything());
    expect(screen.getByText('Viagens')).toBeTruthy();
    expect(screen.getByText('Suporte')).toBeTruthy();

    // O cabeçalho abre o cartão de membro em tela cheia.
    fireEvent.press(screen.getByTestId('leaf-account-card'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeafMemberCard');
  });

  it('lists driver items in one level and shows activation only while pending', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn() };
    usePrototypeRideRuntime.mockReturnValue({ activeRole: 'driver', driverCanGoOnline: false });
    const pending = render(<RobotaxiMenuScreen navigation={navigation} route={{ key: 'menu' }} />);
    ['driver-earnings', 'driver-history', 'driver-activation', 'driver-documents', 'driver-vehicles', 'help', 'settings']
      .forEach(key => expect(pending.getByTestId(`robotaxi-menu-item-${key}`)).toBeTruthy());
    expect(pending.queryByTestId('robotaxi-menu-item-driver-waitlist-invites')).toBeNull();
    pending.unmount();

    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'driver',
      driverCanGoOnline: true,
      driverActivationRemote: { documents: { cnh: { status: 'approved' }, crlv: { status: 'approved' } }, vehicle: { plate: 'abc1d23' } },
    });
    const approved = render(<RobotaxiMenuScreen navigation={navigation} route={{ key: 'menu' }} />);
    expect(approved.queryByTestId('robotaxi-menu-item-driver-activation')).toBeNull();
    // Estado à direita vem do runtime: documentos em dia e a placa do veículo.
    expect(approved.getByText('Em dia')).toBeTruthy();
    expect(approved.getByText('ABC1D23')).toBeTruthy();
    fireEvent.press(approved.getByTestId('robotaxi-menu-item-driver-earnings'));
    expect(navigation.navigate).toHaveBeenCalledWith('EarningsReport', expect.objectContaining({ source: 'driver-menu' }));
  });
});

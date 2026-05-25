import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';

import RobotaxiProfileScreen from '../src/screens/prototype/RobotaxiProfileScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { useDispatch, useSelector } from 'react-redux';

jest.mock('react-redux', () => ({
  useDispatch: jest.fn(),
  useSelector: jest.fn(),
}));

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: {
    getIdToken: jest.fn(() => Promise.resolve('review-token')),
  },
  signOut: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/services/AccountDeletionService', () => ({
  requestAuthenticatedAccountDeletion: jest.fn(() =>
    Promise.resolve({ message: 'Sua conta foi excluída com sucesso.' })
  ),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({
    clearAuthenticationState: jest.fn(),
    disconnect: jest.fn(),
  })),
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
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

describe('RobotaxiProfileScreen account deletion entry point', () => {
  beforeEach(() => {
    useDispatch.mockReturnValue(jest.fn());
    useSelector.mockImplementation((selector) =>
      selector({
        auth: {
          profile: {
            uid: 'review-user',
            firstName: 'Leaf',
            lastName: 'Passageiro Teste',
            phoneNumber: '+5521102938475',
            email: 'review@leaf.app.br',
          },
        },
      })
    );

    usePrototypeRideRuntime.mockReturnValue({
      riderProfile: { preference: 'Sem preferencia cadastrada' },
      activeRole: 'customer',
      driverCanGoOnline: false,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps an explicit account deletion shortcut visible on profile and opens confirmation directly', () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile' }} />
    );

    expect(screen.getByTestId('profile-account-deletion-shortcut')).toBeTruthy();
    expect(screen.getByTestId('profile-logout-shortcut')).toBeTruthy();
    expect(screen.getByText('Sair da conta')).toBeTruthy();
    expect(screen.getByText('Excluir conta')).toBeTruthy();

    fireEvent.press(screen.getByTestId('profile-account-deletion-shortcut'));

    expect(navigation.replace).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Excluir Conta',
      expect.stringContaining('irreversível'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancelar', style: 'cancel' }),
        expect.objectContaining({ text: 'Excluir Conta', style: 'destructive' }),
      ]),
    );
  });

  it('keeps logout visible on profile and asks for confirmation before leaving the account', () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile' }} />
    );

    fireEvent.press(screen.getByTestId('profile-logout-shortcut'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Sair da conta',
      expect.stringContaining('Tem certeza'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancelar', style: 'cancel' }),
        expect.objectContaining({ text: 'Sair', style: 'destructive' }),
      ]),
    );
  });
});

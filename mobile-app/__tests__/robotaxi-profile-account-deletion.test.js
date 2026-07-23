import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import RobotaxiProfileScreen from '../src/screens/prototype/RobotaxiProfileScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { useDispatch, useSelector } from 'react-redux';

const mockGetCurrentProfile = jest.fn();
const mockUpsertCurrentProfile = jest.fn();

jest.mock('../src/services/MobileProfileService', () => ({
  __esModule: true,
  default: {
    getCurrentProfileOrThrow: (...args) => mockGetCurrentProfile(...args),
    upsertCurrentProfileOrThrow: (...args) => mockUpsertCurrentProfile(...args),
  },
}));

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
  const updateRiderProfile = jest.fn();

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
      updateRiderProfile,
    });
    mockGetCurrentProfile.mockResolvedValue({
      uid: 'review-user',
      name: 'Leaf Passageiro Teste',
      phoneNumber: '+5521102938475',
      email: 'review@leaf.app.br',
    });
    mockUpsertCurrentProfile.mockResolvedValue({
      uid: 'review-user',
      name: 'Leaf Atualizado',
      phone: '+5521102938475',
      email: 'review@leaf.app.br',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps an explicit account deletion shortcut visible on profile and opens confirmation directly', async () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile' }} />
    );

    await waitFor(() => expect(screen.getByTestId('profile-account-deletion-shortcut')).toBeTruthy());
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

  it('keeps logout visible on profile and asks for confirmation before leaving the account', async () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile' }} />
    );

    await waitFor(() => expect(screen.getByTestId('profile-logout-shortcut')).toBeTruthy());
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

  it('edits personal data through the authenticated profile persistence contract', async () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn() };
    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile' }} />
    );

    await waitFor(() => expect(screen.getByText('Dados pessoais')).toBeTruthy());
    fireEvent.press(screen.getByText('Dados pessoais'));
    expect(screen.getByTestId('robotaxi-profile-phone-readonly')).toBeTruthy();
    expect(screen.queryByTestId('robotaxi-profile-input-phone')).toBeNull();
    expect(screen.getByText('Para alterar o telefone, será necessária uma nova validação de segurança. Em breve.')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('robotaxi-profile-input-name'), 'Leaf Atualizado');
    fireEvent.press(screen.getByText('Salvar dados'));

    await waitFor(() => {
      expect(mockUpsertCurrentProfile).toHaveBeenCalledWith({
        name: 'Leaf Atualizado',
        email: 'review@leaf.app.br',
      });
      expect(updateRiderProfile).toHaveBeenCalledWith({
        name: 'Leaf Atualizado',
        email: 'review@leaf.app.br',
      });
    });
  });

  it('keeps first-profile creation available when the authenticated account returns 404', async () => {
    mockGetCurrentProfile.mockRejectedValueOnce(
      Object.assign(new Error('Perfil não encontrado'), { status: 404 })
    );
    const navigation = { navigate: jest.fn(), replace: jest.fn() };
    const screen = render(
      <RobotaxiProfileScreen navigation={navigation} route={{ key: 'profile-first-write' }} />
    );

    await waitFor(() => expect(screen.getByText('Dados pessoais')).toBeTruthy());
    expect(screen.queryByTestId('robotaxi-profile-error')).toBeNull();

    fireEvent.press(screen.getByText('Dados pessoais'));
    expect(screen.getByTestId('robotaxi-profile-editor')).toBeTruthy();
  });
});

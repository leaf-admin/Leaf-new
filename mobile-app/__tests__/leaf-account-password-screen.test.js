import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@react-native-firebase/auth', () => () => ({ currentUser: { phoneNumber: '+5521999990000' } }));
jest.mock('../src/services/UserAuthService', () => ({ setupPassword: jest.fn() }));
jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({ usePrototypeRideRuntime: () => ({ riderProfile: {} }) }));

import UserAuthService from '../src/services/UserAuthService';
import LeafAccountPasswordScreen, { validateAccountPassword } from '../src/screens/prototype/LeafAccountPasswordScreen';

describe('LeafAccountPasswordScreen', () => {
  it('mirrors the backend password rule', () => {
    expect(validateAccountPassword('curta1', 'curta1')).toBe('Use pelo menos 8 caracteres.');
    expect(validateAccountPassword('somenteletras', 'somenteletras')).toBe('Misture letras e números.');
    expect(validateAccountPassword('senha1234', 'senha12345')).toBe('As senhas não conferem.');
    expect(validateAccountPassword('senha1234', 'senha1234')).toBe('');
  });

  it('saves the optional password for the signed-in phone', async () => {
    UserAuthService.setupPassword.mockResolvedValue({ success: true });
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(<LeafAccountPasswordScreen navigation={navigation} />);

    fireEvent.changeText(getByTestId('leaf-account-password-input'), 'senha1234');
    fireEvent.changeText(getByTestId('leaf-account-password-confirm-input'), 'senha1234');
    fireEvent.press(getByTestId('leaf-account-password-save'));

    await waitFor(() => expect(UserAuthService.setupPassword).toHaveBeenCalledWith('+5521999990000', 'senha1234'));
    expect(await findByTestId('leaf-account-password-saved')).toBeTruthy();
  });

  it('does not call the backend when the confirmation differs', () => {
    UserAuthService.setupPassword.mockClear();
    const { getByTestId, getByText } = render(<LeafAccountPasswordScreen navigation={{ canGoBack: () => true, goBack: jest.fn() }} />);

    fireEvent.changeText(getByTestId('leaf-account-password-input'), 'senha1234');
    fireEvent.changeText(getByTestId('leaf-account-password-confirm-input'), 'outra1234');
    fireEvent.press(getByTestId('leaf-account-password-save'));

    expect(UserAuthService.setupPassword).not.toHaveBeenCalled();
    expect(getByText('As senhas não conferem.')).toBeTruthy();
  });

  it('explains the password is required when opened from the withdrawal', async () => {
    UserAuthService.setupPassword.mockResolvedValue({ success: true });
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, getByText, findByText } = render(
      <LeafAccountPasswordScreen navigation={navigation} route={{ params: { purpose: 'withdrawal' } }} />
    );

    expect(getByText('Crie sua senha do app')).toBeTruthy();
    fireEvent.changeText(getByTestId('leaf-account-password-input'), 'senha1234');
    fireEvent.changeText(getByTestId('leaf-account-password-confirm-input'), 'senha1234');
    fireEvent.press(getByTestId('leaf-account-password-save'));

    expect(await findByText('Voltar ao saque')).toBeTruthy();
    fireEvent.press(getByTestId('leaf-account-password-done'));
    expect(navigation.goBack).toHaveBeenCalled();
  });
});

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ForgotPasswordStep from '../src/components/auth/steps/ForgotPasswordStep';
import UserAuthService from '../src/services/UserAuthService';

jest.mock('@react-native-firebase/auth', () => jest.fn(() => ({ currentUser: null })));

jest.mock('../src/services/UserAuthService', () => ({
  __esModule: true,
  default: {
    requestPasswordReset: jest.fn(),
    resetPassword: jest.fn(),
    loginWithPassword: jest.fn(),
    setupPassword: jest.fn(),
    recordAttempt: jest.fn(),
  },
}));

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const renderStep = () => render(
  <ForgotPasswordStep phoneNumber="+5521999990000" onPasswordReset={jest.fn()} onBack={jest.fn()} />
);

describe('ForgotPasswordStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('offers Reenviar immediately when sending the code fails', async () => {
    UserAuthService.requestPasswordReset.mockRejectedValueOnce(new Error('network'));

    const screen = renderStep();

    await waitFor(() => {
      expect(screen.getByText('Reenviar')).toBeTruthy();
    });
    expect(screen.queryByText(/Reenviar em/)).toBeNull();
    expect(Alert.alert).toHaveBeenCalledWith('Erro', 'Não foi possível enviar o código. Tente novamente.');

    UserAuthService.requestPasswordReset.mockResolvedValueOnce({
      verificationId: 'verification-1',
      channel: 'sms',
    });
    fireEvent.press(screen.getByText('Reenviar'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Sucesso', 'Código enviado por SMS.');
    });
    expect(UserAuthService.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Reenviar em 60s')).toBeTruthy();
  });

  test.each([
    ['whatsapp', 'Código enviado pelo WhatsApp.'],
    ['sms', 'Código enviado por SMS.'],
    [undefined, 'Código enviado.'],
  ])('names the delivery channel %s in the confirmation', async (channel, message) => {
    UserAuthService.requestPasswordReset.mockResolvedValueOnce({
      verificationId: 'verification-1',
      channel,
    });

    renderStep();

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Sucesso', message);
    });
  });
});

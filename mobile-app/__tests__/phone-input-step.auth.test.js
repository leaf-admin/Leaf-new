import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PhoneInputStep, { normalizePhoneInputValue } from '../src/components/auth/steps/PhoneInputStep';

const mockSignInWithPhoneNumber = jest.fn();
const mockSignInWithCustomToken = jest.fn();

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@react-native-firebase/auth', () => () => ({
  signInWithPhoneNumber: mockSignInWithPhoneNumber,
  signInWithCustomToken: mockSignInWithCustomToken,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../src/config/reviewAccounts', () => ({
  isReviewAccount: jest.fn(() => false),
  getReviewAccountInfo: jest.fn(() => null),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowCustomOtpFallback: jest.fn(() => false),
  allowQaOtpForceFlow: jest.fn(() => false),
  allowReviewAccess: jest.fn(() => false),
  isE2ETestBuild: jest.fn(() => false),
  isSimulatorBuild: jest.fn(() => false),
}));

jest.mock('../src/services/httpClient', () => ({
  post: jest.fn(),
}));

jest.mock('../src/services/UserAuthService', () => ({
  __esModule: true,
    default: {
      resolvePhoneAuthFlow: jest.fn(async () => ({
        nextAction: 'OTP_REQUIRED',
        passwordFallbackAvailable: false,
        requiresPassword: false,
        hasPassword: false,
        source: 'test',
    })),
    loginWithPassword: jest.fn(),
  },
}));

jest.mock('../src/utils/secureOnboardingStorage', () => ({
  saveStepData: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/components/auth/common/ContinueButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return function MockContinueButton({ onPress, disabled, text, testID, accessibilityLabel }) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      >
        <Text>{text}</Text>
      </TouchableOpacity>
    );
  };
});

describe('PhoneInputStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSignInWithPhoneNumber.mockReset();
    mockSignInWithCustomToken.mockReset();
    mockSignInWithPhoneNumber.mockResolvedValue({ confirm: jest.fn() });
    mockSignInWithCustomToken.mockResolvedValue({ user: null });

    const apiClient = require('../src/services/httpClient');
    apiClient.post.mockReset();

    const runtimeAccessPolicy = require('../src/config/runtimeAccessPolicy');
    const reviewAccounts = require('../src/config/reviewAccounts');
    runtimeAccessPolicy.allowQaOtpForceFlow.mockReset();
    runtimeAccessPolicy.allowCustomOtpFallback.mockReset();
    runtimeAccessPolicy.allowReviewAccess.mockReset();
    runtimeAccessPolicy.isE2ETestBuild.mockReset();
    runtimeAccessPolicy.isSimulatorBuild.mockReset();
    runtimeAccessPolicy.allowQaOtpForceFlow.mockReturnValue(false);
    runtimeAccessPolicy.allowCustomOtpFallback.mockReturnValue(false);
    runtimeAccessPolicy.allowReviewAccess.mockReturnValue(false);
    runtimeAccessPolicy.isE2ETestBuild.mockReturnValue(false);
    runtimeAccessPolicy.isSimulatorBuild.mockReturnValue(false);
    reviewAccounts.isReviewAccount.mockReset();
    reviewAccounts.getReviewAccountInfo.mockReset();
    reviewAccounts.isReviewAccount.mockReturnValue(false);
    reviewAccounts.getReviewAccountInfo.mockReturnValue(null);

    const UserAuthService = require('../src/services/UserAuthService').default;
    UserAuthService.resolvePhoneAuthFlow.mockReset();
    UserAuthService.loginWithPassword.mockReset();
    UserAuthService.resolvePhoneAuthFlow.mockResolvedValue({
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: false,
      requiresPassword: false,
      hasPassword: false,
      source: 'test',
    });

    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  test('shows a clear rate limit message when firebase throttles phone auth', async () => {
    mockSignInWithPhoneNumber.mockRejectedValue({
      code: 'auth/too-many-requests',
      nativeErrorCode: 17010,
      message: 'Firebase: Too many requests.',
    });

    const { getByTestId } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21998991886');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Limite de Tentativas',
        'Voce fez muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
        undefined,
        undefined,
      );
    });
  });

  test('routes controlled QA phones through custom OTP without firebase custom token login', async () => {
    const onVerificationSent = jest.fn();
    const apiClient = require('../src/services/httpClient');
    const runtimeAccessPolicy = require('../src/config/runtimeAccessPolicy');

    runtimeAccessPolicy.allowQaOtpForceFlow.mockReturnValue(true);

    apiClient.post
      .mockResolvedValueOnce({
        data: {
          success: true,
          verificationId: 'vid_test',
        },
      })
    const { getByTestId } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={onVerificationSent}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21102938475');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(mockSignInWithCustomToken).not.toHaveBeenCalled();
      expect(onVerificationSent).toHaveBeenCalledWith(
        expect.objectContaining({ isCustomOtp: true }),
        '+5521102938475',
        false,
      );
    });
  });

  test('keeps OTP flow for existing account when password is not configured', async () => {
    const onVerificationSent = jest.fn();
    const UserAuthService = require('../src/services/UserAuthService').default;
    const firebaseConfirmation = { confirm: jest.fn() };

    UserAuthService.resolvePhoneAuthFlow.mockResolvedValueOnce({
      exists: true,
      uid: 'firebase-user-123',
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: false,
      requiresPassword: false,
      hasPassword: false,
      source: 'firebase_auth',
    });
    mockSignInWithPhoneNumber.mockResolvedValueOnce(firebaseConfirmation);

    const { getByTestId } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={onVerificationSent}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21102938475');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith('+5521102938475');
      expect(onVerificationSent).toHaveBeenCalledWith(
        firebaseConfirmation,
        '+5521102938475',
        true,
      );
    });
  });

  test('keeps OTP as default even when account has password configured', async () => {
    const UserAuthService = require('../src/services/UserAuthService').default;
    const onVerificationSent = jest.fn();
    const firebaseConfirmation = { confirm: jest.fn() };

    UserAuthService.resolvePhoneAuthFlow.mockResolvedValueOnce({
      exists: true,
      uid: 'customer-with-password',
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: true,
      requiresPassword: false,
      hasPassword: true,
      source: 'password_credentials',
    });
    mockSignInWithPhoneNumber.mockResolvedValueOnce(firebaseConfirmation);

    const { getByTestId, queryByText } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={onVerificationSent}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21102938475');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith('+5521102938475');
      expect(onVerificationSent).toHaveBeenCalledWith(
        firebaseConfirmation,
        '+5521102938475',
        true,
      );
      expect(queryByText('Esse passo ajuda a manter sua conta segura.')).not.toBeNull();
    });
  });

  test('routes controlled review account to inline password login without OTP preflight', async () => {
    const UserAuthService = require('../src/services/UserAuthService').default;
    const reviewAccounts = require('../src/config/reviewAccounts');

    reviewAccounts.getReviewAccountInfo.mockReturnValue({
      phoneNumber: '21123456789',
      fullPhoneNumber: '+5521123456789',
      userType: 'driver',
      skipOTP: true,
    });

    const { getByTestId, queryByText, getByPlaceholderText } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21123456789');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(UserAuthService.resolvePhoneAuthFlow).not.toHaveBeenCalled();
      expect(mockSignInWithPhoneNumber).not.toHaveBeenCalled();
      expect(queryByText('Ja tenho senha')).toBeNull();
      expect(queryByText('Entrar')).not.toBeNull();
      expect(getByPlaceholderText('Senha')).toBeTruthy();
    });
  });

  test('shows only the invalid password message when inline login fails', async () => {
    const UserAuthService = require('../src/services/UserAuthService').default;
    const reviewAccounts = require('../src/config/reviewAccounts');

    reviewAccounts.getReviewAccountInfo.mockReturnValue({
      phoneNumber: '21123456789',
      fullPhoneNumber: '+5521123456789',
      userType: 'driver',
      skipOTP: true,
    });
    UserAuthService.loginWithPassword.mockRejectedValueOnce(new Error('invalid credentials'));

    const { getByTestId, queryByText } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21123456789');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(getByTestId('auth-password-input')).toBeTruthy();
    });

    fireEvent.changeText(getByTestId('auth-password-input'), 'senha-invalida');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(UserAuthService.loginWithPassword).toHaveBeenCalledWith(
        '+5521123456789',
        'senha-invalida',
      );
      expect(queryByText('Senha incorreta.')).not.toBeNull();
      expect(queryByText('Senha incorreta ou conta sem senha configurada.')).toBeNull();
    });
  });

  test('enables explicit password fallback only when user chooses "Ja tenho senha"', async () => {
    const UserAuthService = require('../src/services/UserAuthService').default;

    UserAuthService.resolvePhoneAuthFlow.mockResolvedValueOnce({
      exists: true,
      uid: 'customer-with-password',
      nextAction: 'OTP_REQUIRED',
      passwordFallbackAvailable: true,
      requiresPassword: false,
      hasPassword: true,
      source: 'password_credentials',
    });

    const { getByTestId, queryByText } = render(
      <PhoneInputStep
        onSwitchToRegister={jest.fn()}
        onVerificationSent={jest.fn()}
      />,
    );

    fireEvent.changeText(getByTestId('auth-phone-input'), '21102938475');
    await waitFor(() => {
      expect(getByTestId('auth-password-fallback-btn').props.disabled).toBeFalsy();
    });

    fireEvent.press(getByTestId('auth-password-fallback-btn'));

    await waitFor(() => {
      expect(queryByText('Esse passo ajuda a manter sua conta segura.')).toBeNull();
      expect(queryByText('Ja tenho senha')).toBeNull();
      expect(queryByText('Entrar')).not.toBeNull();
    }, { timeout: 3000 });
  });

  test('normalizes pasted E.164 phone input into local 11-digit format', () => {
    expect(normalizePhoneInputValue('+55 21 10293-8475')).toBe('21102938475');
    expect(normalizePhoneInputValue('21102938475')).toBe('21102938475');
    expect(normalizePhoneInputValue('+5521123456789')).toBe('21123456789');
  });
});

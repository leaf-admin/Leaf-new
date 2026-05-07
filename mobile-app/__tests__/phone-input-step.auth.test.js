import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PhoneInputStep from '../src/components/auth/steps/PhoneInputStep';

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

jest.mock('../src/config/reviewAccounts', () => ({
  isReviewAccount: jest.fn(() => false),
  getReviewAccountInfo: jest.fn(() => null),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowCustomOtpFallback: jest.fn(() => false),
  allowQaOtpForceFlow: jest.fn(() => false),
  allowReviewAccess: jest.fn(() => false),
}));

jest.mock('../src/services/httpClient', () => ({
  post: jest.fn(),
}));

jest.mock('../src/services/UserAuthService', () => ({
  __esModule: true,
  default: {
    resolvePhoneAuthFlow: jest.fn(async () => ({
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

    fireEvent.changeText(getByTestId('auth-phone-input'), '11999999999');
    fireEvent.press(getByTestId('auth-continue-btn'));

    await waitFor(() => {
      expect(mockSignInWithCustomToken).not.toHaveBeenCalled();
      expect(onVerificationSent).toHaveBeenCalledWith(
        expect.objectContaining({ isCustomOtp: true }),
        '+5511999999999',
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
      requiresPassword: true,
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
});

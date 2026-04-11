import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import PhoneInputStep from '../src/components/auth/steps/PhoneInputStep';

const mockSignInWithPhoneNumber = jest.fn();

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
});

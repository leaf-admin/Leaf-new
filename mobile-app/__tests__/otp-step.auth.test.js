import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import OTPStep from '../src/components/auth/steps/OTPStep';

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@react-native-firebase/auth', () => () => ({
  signInWithCustomToken: jest.fn(),
  signInWithPhoneNumber: jest.fn(),
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

jest.mock('../src/components/design-system/AnimatedButton', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return {
    AnimatedButton: ({ onPress, title, testID, accessibilityLabel }) => (
      <TouchableOpacity onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowQaOtpForceFlow: jest.fn(() => false),
  allowReviewAccess: jest.fn(() => false),
  isDevelopmentBuild: jest.fn(() => true),
}));

jest.mock('../src/services/httpClient', () => ({
  post: jest.fn(),
}));

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyMessage: jest.fn((message) => message),
}));

describe('OTPStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  async function fillOtp(getByTestId, value = '123456') {
    for (let index = 0; index < value.length; index += 1) {
      fireEvent.changeText(getByTestId(`auth-otp-digit-${index}`), value[index]);
    }
  }

  test('shows a friendly message for invalid OTP', async () => {
    const confirmation = {
      confirm: jest.fn().mockRejectedValue(new Error('invalid-verification-code')),
    };

    const { getByTestId } = render(
      <OTPStep
        phoneNumber="+5521102938475"
        confirmation={confirmation}
        onVerified={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await fillOtp(getByTestId, '123456');

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Código não confirmado',
        'Código inválido. Verifique o código recebido por SMS e tente novamente.',
        undefined,
        undefined,
      );
    });
  });

  test('shows a friendly message for expired OTP', async () => {
    const confirmation = {
      confirm: jest.fn().mockRejectedValue(new Error('code expired')),
    };

    const { getByTestId } = render(
      <OTPStep
        phoneNumber="+5521102938475"
        confirmation={confirmation}
        onVerified={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await fillOtp(getByTestId, '654321');

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Código não confirmado',
        'Código expirado. Solicite um novo código.',
        undefined,
        undefined,
      );
    });
  });

  test('shows a friendly message for a reused OTP', async () => {
    const confirmation = {
      confirm: jest.fn().mockRejectedValue(new Error('code already used')),
    };

    const { getByTestId } = render(
      <OTPStep
        phoneNumber="+5521102938475"
        confirmation={confirmation}
        onVerified={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    await fillOtp(getByTestId, '111111');

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Código não confirmado',
        'Esse código já foi utilizado. Solicite um novo código.',
        undefined,
        undefined,
      );
    });
  });
});

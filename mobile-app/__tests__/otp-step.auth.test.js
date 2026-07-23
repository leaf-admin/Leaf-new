import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import OTPStep, { assertVerifiedOtpIdentity } from '../src/components/auth/steps/OTPStep';
import { saveStepData } from '../src/utils/secureOnboardingStorage';

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockSignInWithCustomToken = jest.fn();
const mockSignInWithPhoneNumber = jest.fn();
let mockCurrentUser = null;

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: mockCurrentUser,
  signInWithCustomToken: mockSignInWithCustomToken,
  signInWithPhoneNumber: mockSignInWithPhoneNumber,
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
    mockCurrentUser = null;
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
      expect(saveStepData).not.toHaveBeenCalled();
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

  test('accepts the verified user only when UID and phone match the native Firebase session', () => {
    const credentialUser = {
      uid: 'uid-a',
      phoneNumber: '+5521998991886',
    };

    expect(assertVerifiedOtpIdentity({
      requestedPhone: '+55 (21) 99899-1886',
      credentialUser,
      currentUser: { ...credentialUser },
    })).toBe(credentialUser);
  });

  test('fails closed when OTP result and native Firebase session have different UIDs', () => {
    expect(() => assertVerifiedOtpIdentity({
      requestedPhone: '+5521998991886',
      credentialUser: { uid: 'uid-a', phoneNumber: '+5521998991886' },
      currentUser: { uid: 'uid-b', phoneNumber: '+5521998991886' },
    })).toThrow('A sessão autenticada não corresponde ao telefone confirmado.');
  });

  test('fails closed when the authenticated phone differs from the requested phone', () => {
    expect(() => assertVerifiedOtpIdentity({
      requestedPhone: '+5521998991886',
      credentialUser: { uid: 'uid-a', phoneNumber: '+5521123456789' },
      currentUser: { uid: 'uid-a', phoneNumber: '+5521123456789' },
    })).toThrow('O telefone autenticado não corresponde ao número informado.');
  });
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import ProfileDataStep from '../src/components/auth/steps/ProfileDataStep';

jest.mock('../src/utils/secureOnboardingStorage', () => ({
  saveStepData: jest.fn(),
}));

describe('ProfileDataStep submission state', () => {
  it('labels profile fields, password visibility controls, and consent state for assistive technology', () => {
    const { getByTestId } = render(
      <ProfileDataStep
        onSubmitted={jest.fn()}
        onBack={jest.fn()}
        initialData={{
          profileSelection: { userType: 'customer' },
          fullName: 'QA Passenger',
          email: 'qa.passenger@example.com',
          credentials: {
            password: 'StrongPass123',
            confirmPassword: 'StrongPass123',
            acceptTerms: true,
            acceptPrivacy: false,
          },
        }}
      />,
    );

    expect(getByTestId('auth-profile-full-name-input').props.accessibilityLabel).toBe('Nome completo');
    expect(getByTestId('auth-profile-email-input').props.accessibilityLabel).toBe('E-mail');
    expect(getByTestId('auth-profile-password-input').props.accessibilityLabel).toBe('Senha');
    expect(getByTestId('auth-profile-confirm-password-input').props.accessibilityLabel).toBe('Confirmar senha');
    expect(getByTestId('auth-profile-password-visibility-btn').props.accessibilityLabel).toBe('Mostrar senha');
    expect(getByTestId('auth-profile-terms-consent').props.accessibilityRole).toBe('checkbox');
    expect(getByTestId('auth-profile-terms-consent').props.accessibilityState).toEqual({ checked: true });
    expect(getByTestId('auth-profile-privacy-consent').props.accessibilityState).toEqual({ checked: false });
  });

  it('disables final signup while the account is being saved', () => {
    const onSubmitted = jest.fn();
    const { getByLabelText } = render(
      <ProfileDataStep
        onSubmitted={onSubmitted}
        onBack={jest.fn()}
        isSubmitting
        initialData={{
          profileSelection: { userType: 'customer' },
          fullName: 'QA Passenger',
          email: 'qa.passenger@example.com',
          credentials: {
            password: 'StrongPass123',
            confirmPassword: 'StrongPass123',
            acceptTerms: true,
            acceptPrivacy: true,
          },
        }}
      />,
    );

    const submitButton = getByLabelText('Salvando...');
    expect(submitButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(submitButton);
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

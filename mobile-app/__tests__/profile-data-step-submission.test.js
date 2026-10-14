import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import ProfileDataStep from '../src/components/auth/steps/ProfileDataStep';

jest.mock('../src/utils/secureOnboardingStorage', () => ({
  saveStepData: jest.fn(),
}));

const passenger = (overrides = {}) => ({
  profileSelection: { userType: 'customer' },
  fullName: 'QA Passenger',
  ...overrides,
});

describe('ProfileDataStep', () => {
  it('asks the passenger only for name, optional e-mail and one legal consent (no password)', () => {
    const { getByTestId, queryByTestId } = render(
      <ProfileDataStep onSubmitted={jest.fn()} onBack={jest.fn()} initialData={passenger()} />,
    );

    expect(getByTestId('auth-profile-full-name-input').props.accessibilityLabel).toBe('Nome e sobrenome');
    expect(getByTestId('auth-profile-email-input').props.accessibilityLabel).toBe('E-mail');
    expect(queryByTestId('auth-profile-password-input')).toBeNull();
    expect(getByTestId('auth-profile-legal-consent').props.accessibilityRole).toBe('checkbox');
    expect(getByTestId('auth-profile-legal-consent').props.accessibilityState).toEqual({ checked: false });
  });

  it('submits without e-mail once the passenger accepts the terms', () => {
    const onSubmitted = jest.fn();
    const { getByTestId } = render(
      <ProfileDataStep onSubmitted={onSubmitted} onBack={jest.fn()} initialData={passenger()} />,
    );

    fireEvent.press(getByTestId('auth-profile-legal-consent'));
    fireEvent.press(getByTestId('auth-profile-submit'));

    expect(onSubmitted).toHaveBeenCalledWith({
      fullName: 'QA Passenger',
      email: '',
      acceptTerms: true,
      acceptPrivacy: true,
    });
  });

  it('blocks an invalid optional e-mail', () => {
    const onSubmitted = jest.fn();
    const { getByTestId } = render(
      <ProfileDataStep
        onSubmitted={onSubmitted}
        onBack={jest.fn()}
        initialData={passenger({ email: 'nao-e-email', acceptTerms: true, acceptPrivacy: true })}
      />,
    );

    fireEvent.press(getByTestId('auth-profile-submit'));
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('asks the driver only for the name', () => {
    const onSubmitted = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <ProfileDataStep
        onSubmitted={onSubmitted}
        onBack={jest.fn()}
        initialData={{ profileSelection: { userType: 'driver' }, fullName: 'Maria Souza' }}
      />,
    );

    expect(queryByTestId('auth-profile-email-input')).toBeNull();
    fireEvent.press(getByTestId('auth-profile-submit'));
    expect(onSubmitted).toHaveBeenCalledWith({ fullName: 'Maria Souza' });
  });

  it('disables final signup while the account is being saved', () => {
    const onSubmitted = jest.fn();
    const { getByLabelText } = render(
      <ProfileDataStep
        onSubmitted={onSubmitted}
        onBack={jest.fn()}
        isSubmitting
        initialData={passenger({ acceptTerms: true, acceptPrivacy: true })}
      />,
    );

    const submitButton = getByLabelText('Salvando…');
    expect(submitButton.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(submitButton);
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

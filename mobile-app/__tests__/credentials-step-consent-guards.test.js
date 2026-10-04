import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import CredentialsStep from '../src/components/auth/steps/CredentialsStep';

describe('CredentialsStep driver consent guards', () => {
  const initialData = {
    profileSelection: { userType: 'driver' },
  };

  it('keeps completion blocked until all three required consents are granted', () => {
    const onCreated = jest.fn();
    const { getByLabelText, getByText } = render(
      <CredentialsStep
        initialData={initialData}
        onCreated={onCreated}
        onBack={jest.fn()}
      />,
    );
    const completeButton = getByLabelText('Concluir');

    expect(completeButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(completeButton);
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.press(getByText('Aceito os Termos de Uso *'));
    fireEvent.press(getByText('Aceito a Política de Privacidade *'));

    expect(getByLabelText('Concluir').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(getByLabelText('Concluir'));
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.press(
      getByText('Autorizo checagem de antecedentes criminais e validação regulatória *'),
    );

    expect(getByLabelText('Concluir').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );
    fireEvent.press(getByLabelText('Concluir'));

    expect(onCreated).toHaveBeenCalledWith({
      acceptTerms: true,
      acceptPrivacy: true,
      consentBackgroundCheck: true,
      marketingOptIn: false,
    });
  });

  it('disables finalization while the profile is being saved', () => {
    const onCreated = jest.fn();
    const { getByLabelText } = render(
      <CredentialsStep
        initialData={{
          ...initialData,
          acceptTerms: true,
          acceptPrivacy: true,
          consentBackgroundCheck: true,
        }}
        onCreated={onCreated}
        onBack={jest.fn()}
        isSubmitting
      />,
    );

    const submitButton = getByLabelText('Finalizando...');
    expect(submitButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(submitButton);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('announces required driver consents as labeled checkboxes with their checked state', () => {
    const { getByTestId } = render(
      <CredentialsStep
        initialData={{
          ...initialData,
          acceptTerms: true,
          acceptPrivacy: false,
          consentBackgroundCheck: false,
        }}
        onCreated={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(getByTestId('auth-credentials-terms-consent').props.accessibilityRole).toBe('checkbox');
    expect(getByTestId('auth-credentials-terms-consent').props.accessibilityState).toEqual({ checked: true });
    expect(getByTestId('auth-credentials-privacy-consent').props.accessibilityState).toEqual({ checked: false });
    expect(getByTestId('auth-driver-background-check-consent').props.accessibilityLabel)
      .toContain('checagem de antecedentes');
    expect(getByTestId('auth-driver-marketing-consent').props.accessibilityLabel)
      .toContain('comunicações promocionais');
  });
});

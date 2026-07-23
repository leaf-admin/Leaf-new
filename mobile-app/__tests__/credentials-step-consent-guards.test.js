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
});

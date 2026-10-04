import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import DriverEmailStep from '../src/components/auth/steps/DriverEmailStep';

describe('DriverEmailStep submission state', () => {
  it('uses spoken labels instead of automation identifiers', () => {
    const { getByTestId } = render(
      <DriverEmailStep onSubmitted={jest.fn()} onBack={jest.fn()} />,
    );

    expect(getByTestId('driver-email-input').props.accessibilityLabel).toBe('E-mail');
    expect(getByTestId('driver-email-input').props.accessibilityHint).toContain('Opcional');
    expect(getByTestId('driver-email-continue-btn').props.accessibilityLabel).toBe('Finalizar cadastro');
    expect(getByTestId('driver-email-skip-btn').props.accessibilityLabel).toBe('Preencher depois');
    expect(getByTestId('driver-email-skip-btn').props.accessibilityRole).toBe('button');
  });

  it('disables both finish and skip actions while onboarding is being saved', () => {
    const onSubmitted = jest.fn();
    const { getByTestId } = render(
      <DriverEmailStep
        onSubmitted={onSubmitted}
        onBack={jest.fn()}
        isSubmitting
      />,
    );

    const finishButton = getByTestId('driver-email-continue-btn');
    const skipButton = getByTestId('driver-email-skip-btn');

    expect(finishButton.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(skipButton.props.accessibilityState).toEqual({ disabled: true });
    fireEvent.press(finishButton);
    fireEvent.press(skipButton);
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

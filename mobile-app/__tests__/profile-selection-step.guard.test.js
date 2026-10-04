import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ProfileSelectionStep from '../src/components/auth/steps/ProfileSelectionStep';
import { saveStepData } from '../src/utils/secureOnboardingStorage';

jest.mock('../src/utils/secureOnboardingStorage', () => ({
  saveStepData: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/utils/Logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('ProfileSelectionStep explicit choice guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not preselect passenger and only enables continue after an explicit choice', async () => {
    const onProfileSelected = jest.fn();
    const { getByTestId } = render(
      <ProfileSelectionStep
        onProfileSelected={onProfileSelected}
        onBack={jest.fn()}
      />,
    );

    expect(getByTestId('auth-profile-selection-continue-btn').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    fireEvent.press(getByTestId('auth-profile-selection-continue-btn'));
    expect(onProfileSelected).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('auth-profile-option-driver'));
    await waitFor(() => {
      expect(saveStepData).toHaveBeenCalledWith('profile_selection', { userType: 'driver' });
    });
    expect(getByTestId('auth-profile-selection-continue-btn').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: false }),
    );

    fireEvent.press(getByTestId('auth-profile-selection-continue-btn'));
    expect(onProfileSelected).toHaveBeenCalledWith(
      expect.objectContaining({ userType: 'driver' }),
    );
  });

  it('exposes readable role names and the selected state to screen readers', async () => {
    const { getByTestId } = render(
      <ProfileSelectionStep onProfileSelected={jest.fn()} onBack={jest.fn()} />,
    );
    const passenger = getByTestId('auth-profile-option-customer');
    const driver = getByTestId('auth-profile-option-driver');

    expect(getByTestId('auth-profile-selection-continue-btn').props.accessibilityLabel).toBe('Continuar');
    expect(passenger.props.accessibilityRole).toBe('button');
    expect(passenger.props.accessibilityLabel).toBe(
      'Quero viajar. Solicite viagens com experiência premium',
    );
    expect(passenger.props.accessibilityState).toEqual({ selected: false });

    fireEvent.press(driver);
    await waitFor(() => {
      expect(getByTestId('auth-profile-option-driver').props.accessibilityState)
        .toEqual({ selected: true });
    });
  });
});

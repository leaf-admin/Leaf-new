import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, right: 0, bottom: 20, left: 0 }) }));
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: View };
});

import { WelcomeScreen } from '../src/components/onboarding/onboardingSteps';

describe('WelcomeScreen', () => {
  it('shows the city welcome with only the headline, the start button and the driver link', () => {
    const onStart = jest.fn();
    const onStartDriver = jest.fn();
    const { getByText, queryByTestId, getByTestId, getByLabelText } = render(
      <WelcomeScreen onStart={onStart} onStartDriver={onStartDriver} />
    );

    expect(getByText('Feito no Rio.')).toBeTruthy();
    expect(getByLabelText('Leaf')).toBeTruthy();
    expect(queryByTestId('onboarding-welcome-pitch')).toBeNull();

    fireEvent.press(getByTestId('onboarding-welcome-start'));
    fireEvent.press(getByTestId('onboarding-welcome-driver'));
    expect(onStart).toHaveBeenCalled();
    expect(onStartDriver).toHaveBeenCalled();
  });
});

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import EditorialOnboardingScreen from '../src/components/auth/common/EditorialOnboardingLayout';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  return {
    SafeAreaInsetsContext: ReactModule.createContext({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }),
  };
});

const mockUseWindowDimensions = jest.spyOn(
  require('react-native'),
  'useWindowDimensions',
);

describe('EditorialOnboardingScreen', () => {
  beforeEach(() => {
    mockUseWindowDimensions.mockReturnValue({
      width: 390,
      height: 852,
      scale: 3,
      fontScale: 1,
    });
  });

  test('keeps a growing footer in flow beside scroll content without covering the form', () => {
    const { getByTestId } = render(
      <EditorialOnboardingScreen
        title="Bem-vindo à Leaf"
        footer={<Text>Continuar</Text>}
        showBack={false}
      >
        <Text>Formulário</Text>
      </EditorialOnboardingScreen>,
    );

    const scrollView = getByTestId('editorial-onboarding-scroll');
    const footer = getByTestId('editorial-onboarding-sticky-footer');
    expect(StyleSheet.flatten(scrollView.props.contentContainerStyle).paddingBottom).toBe(20);
    expect(StyleSheet.flatten(footer.props.style).position).not.toBe('absolute');

    fireEvent(footer, 'layout', {
      nativeEvent: {
        layout: { x: 0, y: 0, width: 390, height: 360 },
      },
    });

    expect(
      StyleSheet.flatten(scrollView.props.contentContainerStyle).paddingBottom,
    ).toBe(20);
    expect(StyleSheet.flatten(scrollView.props.style).flex).toBe(1);
  });

  test('moves the footer into the scroll content at accessibility text sizes', () => {
    mockUseWindowDimensions.mockReturnValue({
      width: 390,
      height: 852,
      scale: 3,
      fontScale: 1.8,
    });

    const { getByTestId, queryByTestId } = render(
      <EditorialOnboardingScreen
        title="Bem-vindo à Leaf"
        footer={<Text>Continuar</Text>}
        showBack={false}
      >
        <Text>Formulário</Text>
      </EditorialOnboardingScreen>,
    );

    expect(getByTestId('editorial-onboarding-inline-footer')).toBeTruthy();
    expect(queryByTestId('editorial-onboarding-sticky-footer')).toBeNull();
  });
});

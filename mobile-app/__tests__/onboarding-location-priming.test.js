import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
};
jest.mock('expo-location', () => mockLocation);

import { LocationPrimingStep } from '../src/components/onboarding/onboardingSteps';
import {
  getForegroundLocationDisclosureText,
  requestForegroundLocationPermissionAfterInAppDisclosure,
} from '../src/services/AndroidPermissionDisclosure';

describe('onboarding location priming', () => {
  const originalOS = Platform.OS;
  afterEach(() => { Platform.OS = originalOS; jest.clearAllMocks(); });

  it('carries the full Android prominent disclosure on the priming screen', () => {
    Platform.OS = 'android';
    const disclosure = getForegroundLocationDisclosureText();
    expect(disclosure).toContain('A Leaf não usa sua localização para anúncios');

    const onEnable = jest.fn();
    const { getByTestId, getByText } = render(
      <LocationPrimingStep disclosure={disclosure} onEnable={onEnable} onSkip={jest.fn()} />,
    );
    expect(getByTestId('onboarding-location-disclosure')).toBeTruthy();
    fireEvent.press(getByText('Concordo e ativar'));
    expect(onEnable).toHaveBeenCalled();
  });

  it('shows no disclosure block on iOS (the system prompt explains)', () => {
    Platform.OS = 'ios';
    expect(getForegroundLocationDisclosureText()).toBe('');
  });

  it('asks the system only when the permission can still be requested', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'undetermined', canAskAgain: true });
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    await expect(requestForegroundLocationPermissionAfterInAppDisclosure()).resolves.toEqual({ status: 'granted' });

    mockLocation.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    await requestForegroundLocationPermissionAfterInAppDisclosure();
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

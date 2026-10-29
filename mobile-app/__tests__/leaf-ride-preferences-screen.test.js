import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
const mockUpdate = jest.fn();
jest.mock('../src/components/MobilePreferencesProvider', () => ({
  useMobilePreferences: () => ({
    preferences: { rideTemperature: 'any', rideSound: 'any', rideComfortAsked: false },
    update: mockUpdate,
    saving: false,
  }),
}));

import LeafRidePreferencesScreen from '../src/screens/prototype/LeafRidePreferencesScreen';
import { buildRideComfortFromPreferences } from '../src/services/MobilePreferencesService';

describe('LeafRidePreferencesScreen', () => {
  beforeEach(() => mockUpdate.mockReset());

  it('saves the temperature and sound and marks the question as answered', async () => {
    mockUpdate.mockResolvedValue({});
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId } = render(<LeafRidePreferencesScreen navigation={navigation} />);

    fireEvent.press(getByTestId('leaf-ride-preferences-temperature-cool'));
    fireEvent.press(getByTestId('leaf-ride-preferences-sound-quiet'));
    fireEvent.press(getByTestId('leaf-ride-preferences-save'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({
      rideTemperature: 'cool',
      rideSound: 'quiet',
      rideComfortAsked: true,
    }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('lets the passenger skip on first use without choosing', async () => {
    mockUpdate.mockResolvedValue({});
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, getByText } = render(
      <LeafRidePreferencesScreen navigation={navigation} route={{ params: { firstUse: true } }} />
    );

    expect(getByText('Como você prefere viajar?')).toBeTruthy();
    fireEvent.press(getByTestId('leaf-ride-preferences-skip'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ rideComfortAsked: true }));
  });

  it('sends only real choices into the booking', () => {
    expect(buildRideComfortFromPreferences({ rideTemperature: 'cool', rideSound: 'any' })).toEqual({ temperature: 'cool', sound: 'any' });
    expect(buildRideComfortFromPreferences({ rideTemperature: 'any', rideSound: 'any' })).toBeNull();
    expect(buildRideComfortFromPreferences(null)).toBeNull();
  });
});

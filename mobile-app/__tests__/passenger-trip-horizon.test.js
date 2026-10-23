import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PassengerTripHorizon from '../src/screens/prototype/PassengerTripHorizon';
import { LeafTripProgressTrack } from '../src/components/prototype/LeafRideUI';

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Ionicons: ({ name }) => <Text>{name}</Text> };
});

describe('Horizonte passenger ride card', () => {
  it('keeps the real arrival, gross fare, vehicle, remaining distance and addresses', () => {
    const screen = render(<PassengerTripHorizon
      arrivalLabel="Chegada às 14:28" etaLabel="8 min" distanceLabel="4,9 km" fareLabel="R$ 41,84"
      vehicleLabel="Leaf Plus" origin="R. das Pastorinhas, 4" destination="Via Parque Shopping"
      progress={0.65} progressKey="ride-1"
      fieldTestIDs={{ eta_final: 'eta', fare: 'fare', route_progress: 'fill', distance_remaining: 'distance' }}
    />);
    expect(screen.getByTestId('eta').props.children).toBe('Chegada às 14:28');
    expect(screen.getByTestId('fare').props.children).toBe('R$ 41,84');
    expect(screen.getByTestId('distance').props.children).toBe('4,9 km restantes');
    expect(screen.getByText('R. das Pastorinhas, 4')).toBeTruthy();
    expect(screen.getByText('Via Parque Shopping')).toBeTruthy();
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(65);
    expect(screen.queryByText('car-sport')).toBeNull();
    expect(screen.queryByText('location')).toBeNull();
  });

  it('uses the full rail from zero and clamps progress without a car marker', () => {
    const screen = render(<LeafTripProgressTrack variant="line" progress={-1} progressKey="ride-1" testID="rail" fillTestID="fill" />);
    fireEvent(screen.getByTestId('rail'), 'layout', { nativeEvent: { layout: { width: 200 } } });
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(0);
    screen.rerender(<LeafTripProgressTrack variant="line" progress={2} progressKey="ride-1" testID="rail" fillTestID="fill" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(100);
    screen.rerender(<LeafTripProgressTrack variant="line" progress={0} progressKey="ride-2" testID="rail" fillTestID="fill" />);
    expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(0);
    expect(screen.queryByText('car-sport')).toBeNull();
  });

  it('preserves the existing progress presentation for other callers', () => {
    const screen = render(<LeafTripProgressTrack progress={0.5} progressKey="other-screen" />);
    expect(screen.getByText('car-sport')).toBeTruthy();
    expect(screen.getByText('location')).toBeTruthy();
  });
});

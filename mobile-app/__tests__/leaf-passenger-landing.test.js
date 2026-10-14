import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import LeafPassengerLanding from '../src/screens/prototype/home/LeafPassengerLanding';

const insets = { top: 62, bottom: 34, left: 0, right: 0 };
const anchor = { x: 200, y: 420 };

describe('Leaf passenger landing', () => {
  it('floats over the map: no map card, destination first', () => {
    const screen = render(<LeafPassengerLanding insets={insets} pickupLabel="34 Ellis St" pickupAnchor={anchor} />);
    expect(screen.getByText('Para onde?')).toBeTruthy();
    expect(screen.getByText('34 Ellis St')).toBeTruthy();
    expect(screen.queryByTestId('leaf-home-map-frame')).toBeNull();
    expect(screen.queryByText('Destinos recentes')).toBeNull();
  });

  it('pins "Seu embarque" just below the pickup point on the map', () => {
    const screen = render(<LeafPassengerLanding insets={insets} pickupLabel="34 Ellis St" pickupAnchor={anchor} />);
    const label = screen.getByTestId('passenger-home-pickup-input');
    let node = label;
    while (node && !(StyleSheet.flatten(node.props?.style) || {}).position) node = node.parent;
    const style = StyleSheet.flatten(node.props.style);
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(anchor.y + 18);
  });

  it('shows no pickup label until the pickup point is on screen', () => {
    const screen = render(<LeafPassengerLanding insets={insets} pickupLabel="34 Ellis St" />);
    expect(screen.queryByTestId('passenger-home-pickup-input')).toBeNull();
  });

  it('keeps all existing home actions and voice long press', () => {
    const onDestinationPress = jest.fn(), onVoicePress = jest.fn(), onPickupPress = jest.fn();
    const onSettingsPress = jest.fn(), onRecenterPress = jest.fn();
    const screen = render(<LeafPassengerLanding insets={insets} pickupAnchor={anchor}
      onDestinationPress={onDestinationPress} onVoicePress={onVoicePress}
      onPickupPress={onPickupPress} onSettingsPress={onSettingsPress} onRecenterPress={onRecenterPress} />);
    fireEvent.press(screen.getByTestId('passenger-home-destination-input'));
    fireEvent(screen.getByTestId('passenger-home-destination-input'), 'longPress');
    fireEvent.press(screen.getByTestId('passenger-home-pickup-input'));
    fireEvent.press(screen.getByTestId('leaf-home-preferences'));
    fireEvent.press(screen.getByTestId('prototype-top-left-control'));
    [onDestinationPress, onVoicePress, onPickupPress, onSettingsPress, onRecenterPress].forEach(handler => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

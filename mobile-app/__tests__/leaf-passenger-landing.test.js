import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import LeafPassengerLanding from '../src/screens/prototype/home/LeafPassengerLanding';

const insets = { top: 62, bottom: 34, left: 0, right: 0 };

describe('Leaf passenger landing', () => {
  it('keeps the home focused on destination and the map', () => {
    const screen = render(<LeafPassengerLanding insets={insets} pickupLabel="34 Ellis St" />);
    expect(screen.getByText('Para onde?')).toBeTruthy();
    expect(screen.getByText('34 Ellis St')).toBeTruthy();
    expect(screen.queryByText('Destinos recentes')).toBeNull();
    expect(screen.queryByText('Aparecem aqui depois da primeira viagem.')).toBeNull();
    const frame = StyleSheet.flatten(screen.getByTestId('leaf-home-map-frame').props.style);
    expect(frame.flex).toBe(1);
    expect(frame.height).toBeUndefined();
    expect(frame.maxHeight).toBeUndefined();
    const root = StyleSheet.flatten(screen.getByTestId('leaf-passenger-landing').props.style);
    expect(root.paddingTop).toBe(78);
    expect(root.paddingBottom).toBe(118);
  });

  it('keeps all existing home actions and voice long press', () => {
    const onDestinationPress = jest.fn(), onVoicePress = jest.fn(), onPickupPress = jest.fn();
    const onSettingsPress = jest.fn(), onRecenterPress = jest.fn();
    const screen = render(<LeafPassengerLanding insets={insets}
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

  it('uses the measured map area without covering the pickup row', () => {
    const onMapFrame = jest.fn();
    const screen = render(<LeafPassengerLanding insets={insets} onMapFrame={onMapFrame} />);
    const frame = screen.getByTestId('leaf-home-map-frame');
    fireEvent(frame, 'layout', { nativeEvent: { layout: { x: 24, y: 226, width: 345, height: 530 } } });
    expect(onMapFrame).toHaveBeenLastCalledWith({ left: 24, top: 226, width: 345, height: 472 });
    fireEvent(frame, 'layout', { nativeEvent: { layout: { x: 24, y: 164, width: 327, height: 300 } } });
    expect(onMapFrame).toHaveBeenLastCalledWith({ left: 24, top: 164, width: 327, height: 242 });
    fireEvent(frame, 'layout', { nativeEvent: { layout: { x: 24, y: 164, width: 327, height: 40 } } });
    expect(onMapFrame).toHaveBeenLastCalledWith({ left: 24, top: 164, width: 327, height: 0 });
  });
});

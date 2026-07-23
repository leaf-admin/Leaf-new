import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PrototypeTopControls } from '../src/components/prototype/PrototypeScaffold';

describe('PrototypeTopControls accessibility contract', () => {
  it('gives standard map and menu icon buttons explicit names and stable test ids', () => {
    const onPressLeft = jest.fn();
    const onPressRight = jest.fn();
    const screen = render(
      <PrototypeTopControls
        insets={{ top: 0 }}
        leftIcon="locate"
        rightIcon="menu"
        onPressLeft={onPressLeft}
        onPressRight={onPressRight}
      />
    );

    fireEvent.press(screen.getByLabelText('Centralizar mapa'));
    fireEvent.press(screen.getByLabelText('Abrir menu'));

    expect(screen.getByTestId('prototype-top-left-control')).toBeTruthy();
    expect(screen.getByTestId('prototype-top-right-control')).toBeTruthy();
    expect(onPressLeft).toHaveBeenCalledTimes(1);
    expect(onPressRight).toHaveBeenCalledTimes(1);
  });

  it('labels the back icon as a navigation action', () => {
    const screen = render(
      <PrototypeTopControls
        insets={{ top: 0 }}
        leftIcon="arrow-back"
        rightIcon="locate"
        onPressLeft={jest.fn()}
        onPressRight={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Voltar')).toBeTruthy();
    expect(screen.getAllByLabelText('Centralizar mapa')).toHaveLength(1);
  });
});

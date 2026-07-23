import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  PrototypeMenuCloseButton,
  PrototypeMenuRow,
} from '../src/components/prototype/PrototypeMenuSurface';

describe('Prototype menu accessibility contract', () => {
  it('exposes menu rows as named buttons without leaking test ids as labels', () => {
    const onPress = jest.fn();
    const screen = render(
      <PrototypeMenuRow
        icon="person-outline"
        title="Editar perfil"
        subtitle="Dados pessoais e preferências"
        onPress={onPress}
        testID="robotaxi-menu-item-edit-profile"
        accessibilityLabel="Editar perfil"
        accessibilityHint="Dados pessoais e preferências"
      />
    );

    const row = screen.getByLabelText('Editar perfil');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityHint).toBe('Dados pessoais e preferências');
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses a human label for the close action', () => {
    const screen = render(
      <PrototypeMenuCloseButton
        onPress={jest.fn()}
        testID="robotaxi-menu-close-button"
        accessibilityLabel="Fechar menu"
      />
    );

    expect(screen.getByLabelText('Fechar menu')).toBeTruthy();
  });
});

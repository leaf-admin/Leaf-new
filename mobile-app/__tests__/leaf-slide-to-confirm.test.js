import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import LeafSlideToConfirm from '../src/components/design-system/LeafSlideToConfirm';

const activate = async (screen) => {
  await act(async () => {
    fireEvent(screen.getByTestId('slide'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  });
};

describe('LeafSlideToConfirm', () => {
  it('stays confirmed with the busy label when the action went through', async () => {
    const onConfirm = jest.fn(() => Promise.resolve(true));
    const screen = render(
      <LeafSlideToConfirm testID="slide" label="Deslize para encerrar" busyLabel="Encerrando..." onConfirm={onConfirm} />
    );

    await activate(screen);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Encerrando...')).toBeTruthy();
    expect(screen.getByTestId('slide').props.accessibilityState).toEqual({ disabled: true, busy: true });

    await activate(screen);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('returns to the start and can be used again when the driver backs out', async () => {
    const onConfirm = jest.fn(() => Promise.resolve(undefined));
    const screen = render(
      <LeafSlideToConfirm testID="slide" label="Deslize para encerrar" busyLabel="Encerrando..." onConfirm={onConfirm} />
    );

    await activate(screen);
    expect(screen.getByText('Deslize para encerrar')).toBeTruthy();
    expect(screen.getByTestId('slide').props.accessibilityState).toEqual({ disabled: false, busy: false });

    await activate(screen);
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('returns to the start when the action fails', async () => {
    const onConfirm = jest.fn(() => Promise.reject(new Error('falhou')));
    const screen = render(
      <LeafSlideToConfirm testID="slide" label="Deslize para encerrar" busyLabel="Encerrando..." onConfirm={onConfirm} />
    );

    await activate(screen);
    expect(screen.getByText('Deslize para encerrar')).toBeTruthy();
  });
});

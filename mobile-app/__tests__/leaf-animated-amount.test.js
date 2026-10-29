import React from 'react';
import { act, render } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));

import LeafAnimatedAmount, { formatBrlAmount, parseBrlAmount, resetLeafAnimatedAmountMemory } from '../src/components/design-system/LeafAnimatedAmount';

describe('LeafAnimatedAmount', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('parses and formats BRL amounts', () => {
    expect(parseBrlAmount('R$ 1.075,75')).toBe(1075.75);
    expect(formatBrlAmount(41.65)).toBe('R$ 41,65');
  });

  it('floats the rise as a "+ R$" chip when the balance goes up after the settle window', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const screen = render(<LeafAnimatedAmount label="R$ 1.034,10" showDelta />);
    expect(screen.queryByTestId('leaf-animated-amount-delta')).toBeNull();

    now.mockReturnValue(20_000);
    screen.rerender(<LeafAnimatedAmount label="R$ 1.075,75" showDelta />);
    expect(screen.getByText('+ R$ 41,65')).toBeTruthy();
    now.mockRestore();
  });

  it('does not show a chip when the value goes down or without showDelta', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const down = render(<LeafAnimatedAmount label="R$ 100,00" showDelta />);
    now.mockReturnValue(20_000);
    down.rerender(<LeafAnimatedAmount label="R$ 90,00" showDelta />);
    expect(down.queryByTestId('leaf-animated-amount-delta')).toBeNull();

    now.mockReturnValue(1_000);
    const plain = render(<LeafAnimatedAmount label="R$ 100,00" />);
    now.mockReturnValue(20_000);
    plain.rerender(<LeafAnimatedAmount label="R$ 140,00" />);
    expect(plain.queryByTestId('leaf-animated-amount-delta')).toBeNull();
    act(() => { jest.runOnlyPendingTimers(); });
    now.mockRestore();
  });

  it('shows the rise on a new mount when the remembered amount was lower (home after the receipt)', () => {
    resetLeafAnimatedAmountMemory();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const before = render(<LeafAnimatedAmount label="R$ 0,00" showDelta memoryKey="pill" />);
    before.unmount();

    now.mockReturnValue(2_000);
    const after = render(<LeafAnimatedAmount label="R$ 8,30" showDelta memoryKey="pill" />);
    expect(after.getByText('+ R$ 8,30')).toBeTruthy();
    now.mockRestore();
  });

  it('ignores a loading zero on a new mount and shows no false rise', () => {
    resetLeafAnimatedAmountMemory();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    render(<LeafAnimatedAmount label="R$ 8,30" showDelta memoryKey="pill2" />).unmount();

    now.mockReturnValue(2_000);
    const screen = render(<LeafAnimatedAmount label="R$ 0,00" showDelta memoryKey="pill2" />);
    screen.rerender(<LeafAnimatedAmount label="R$ 8,30" showDelta memoryKey="pill2" />);
    expect(screen.queryByTestId('leaf-animated-amount-delta')).toBeNull();
    now.mockRestore();
  });
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import DriverIntroStep from '../src/components/auth/steps/DriverIntroStep';

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('DriverIntroStep', () => {
  it('shows what the driver keeps, every fee and the requirements before any document', () => {
    const onContinue = jest.fn();
    const screen = render(<DriverIntroStep onContinue={onContinue} onBack={jest.fn()} />);

    expect(screen.getByText('Como funciona dirigir na Leaf')).toBeTruthy();
    expect(screen.getByText('você fica com R$ 28,01')).toBeTruthy();
    expect(screen.getByText(/Nas 25 primeiras corridas, você fica com R\$ 29,01/)).toBeTruthy();
    ['promo', 'service', 'processing', 'toll', 'withdrawal', 'subscription', 'cancel'].forEach((key) => {
      expect(screen.getByTestId(`auth-driver-intro-fee-${key}`)).toBeTruthy();
    });
    expect(screen.getByText(/CNH com EAR/)).toBeTruthy();
    expect(screen.getByText(/até 10 anos de fabricação/)).toBeTruthy();
    expect(screen.queryByText(/woovi/i)).toBeNull();

    fireEvent.press(screen.getByTestId('auth-driver-intro-continue-btn'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

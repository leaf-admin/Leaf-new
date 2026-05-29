import React from 'react';
import { act } from 'react-test-renderer';
import { render, waitFor } from '@testing-library/react-native';

import WooviPaymentModal from '../src/components/payment/WooviPaymentModal';
import WooviService from '../src/services/WooviService';

jest.useFakeTimers();

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('react-native-elements', () => ({
  Icon: () => null,
}));

jest.mock('react-native-qrcode-svg', () => 'QRCode');

jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: { uid: 'auth_passenger_1' },
}));

jest.mock('../src/components/design-system/robotaxiPrototypeTokens', () => ({
  color: {
    bg: { panel: '#fff', canvas: '#f6f6f6' },
    text: { primary: '#111', secondary: '#666', muted: '#999' },
    accent: { primary: '#0a0' },
    surface: { primary: '#fff', secondary: '#f8f8f8', elevated: '#fff', panel: '#fff' },
    border: { subtle: '#ddd', separator: '#e5e5e5' },
    semantic: { success: '#0a0', danger: '#a00', warning: '#aa0' },
    feedback: { success: '#0a0', danger: '#a00' },
    shadow: { base: '#000' },
  },
  typography: {
    subtitle: { size: 18, lineHeight: 24 },
    body: { size: 14, lineHeight: 20 },
    caption: { size: 12, lineHeight: 16 },
    micro: { size: 10, lineHeight: 14 },
  },
  radius: { lg: 18, md: 14, sm: 10, pill: 999 },
  spacing: { xxs: 4, xs: 6, sm: 8, md: 12, lg: 16, xl: 20 },
  elevation: {
    card: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
    panel: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
    soft: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  },
}));

jest.mock('../src/theme/runtimeTokens', () => ({
  fonts: {
    Regular: 'System',
    Medium: 'System',
    SemiBold: 'System',
    Bold: 'System',
  },
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
  })),
}));

jest.mock('../src/services/PaymentBypassService', () => ({
  shouldUseBypass: jest.fn().mockResolvedValue(false),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowForcedPaymentBypass: jest.fn(() => false),
}));

jest.mock('../src/services/WooviService', () => ({
  simulateTestWebhook: jest.fn(),
  getPaymentStatus: jest.fn(),
  processAdvancePayment: jest.fn(),
  cancelPayment: jest.fn(),
}));

describe('WooviPaymentModal qaAutoConfirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for backend payment confirmation before advancing the ride flow', async () => {
    WooviService.simulateTestWebhook.mockResolvedValue({
      success: true,
      message: 'Webhook de teste processado com sucesso',
    });
    WooviService.getPaymentStatus
      .mockResolvedValueOnce({
        success: true,
        status: 'ACTIVE',
      })
      .mockResolvedValueOnce({
        success: true,
        status: 'in_holding',
      });

    const onPaymentConfirmed = jest.fn();
    const onClose = jest.fn();

    render(
      <WooviPaymentModal
        visible
        onClose={onClose}
        onPaymentConfirmed={onPaymentConfirmed}
        tripData={{
          rideId: 'temp_ride_123',
          pickup: { add: 'Origem' },
          drop: { add: 'Destino' },
          carType: 'Leaf Plus',
          estimatedFare: 13.42,
        }}
        estimates={{ estimateFare: 13.42 }}
        passengerId="passenger_1"
        passengerName="Passageira Leaf"
        passengerEmail="passageira@leaf.app.br"
        prefilledPaymentData={{
          chargeId: 'charge_123',
          rideId: 'temp_ride_123',
          amount: 13.42,
          amountInCents: 1342,
          qrCodeText: 'pix-code',
        }}
        qaAutoConfirm
      />,
    );

    await waitFor(() => {
      expect(WooviService.simulateTestWebhook).not.toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(900);
    });

    await waitFor(() => {
      expect(WooviService.simulateTestWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'charge_123',
          rideId: 'temp_ride_123',
          passengerId: 'passenger_1',
          amountInCents: 1342,
        }),
      );
      expect(WooviService.getPaymentStatus).toHaveBeenCalledWith('charge_123');
    });

    expect(onPaymentConfirmed).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(WooviService.getPaymentStatus).toHaveBeenCalledTimes(2);
      expect(WooviService.getPaymentStatus).not.toHaveBeenCalledWith('temp_ride_123');
      expect(onPaymentConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeId: 'charge_123',
          rideId: 'temp_ride_123',
          amount: 13.42,
          amountInCents: 1342,
        }),
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
    });

    expect(onClose).toHaveBeenCalled();
  });
});

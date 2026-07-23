import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiPaymentFailedScreen from '../src/screens/prototype/RobotaxiPaymentFailedScreen';
import { clearRidePaymentSession } from '../src/services/RidePaymentSessionService';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';

jest.mock('../src/services/RidePaymentSessionService', () => ({
  clearRidePaymentSession: jest.fn(),
}));

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock('../src/components/prototype/PrototypeScreenTransition', () => {
  const React = require('react');
  return ({ children }) => <>{children}</>;
});

jest.mock('../src/components/prototype/PrototypeDismissibleSheet', () => {
  const React = require('react');
  const { View } = require('react-native');

  return ({ children, onClose, sheetStyle }) => (
    <View
      testID="prototype-dismissible-sheet"
      onClose={onClose}
      style={sheetStyle}
    >
      {children}
    </View>
  );
});

jest.mock('../src/components/prototype/PrototypeUI', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  return {
    CardHandle: () => <View testID="card-handle" />,
    PrototypeCard: ({ children, ...props }) => <View {...props}>{children}</View>,
    PrototypePrimaryButton: ({
      label,
      onPress,
      style,
      textStyle,
      icon,
      iconColor,
    }) => (
      <TouchableOpacity
        testID={`payment-failed-button-${label}`}
        onPress={onPress}
        style={style}
      >
        <Text testID={`payment-failed-icon-${label}`} style={{ color: iconColor }}>
          {icon}
        </Text>
        <Text testID={`payment-failed-button-label-${label}`} style={textStyle}>
          {label}
        </Text>
      </TouchableOpacity>
    ),
  };
});

describe('RobotaxiPaymentFailedScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrototypeRideRuntime.mockReturnValue({
      confirmedBookingRetryAvailable: false,
      retryConfirmedBookingMaterialization: jest.fn(),
    });
    clearRidePaymentSession.mockResolvedValue(true);
  });

  it('keeps retry as the single explicit recovery decision', () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const retryParams = {
      initialSelectedPlan: 'plus',
      openPixOnReady: true,
    };

    const screen = render(
      <RobotaxiPaymentFailedScreen
        navigation={navigation}
        route={{
          key: 'payment-failed-test',
          params: {
            title: 'Falha ao gerar pagamento',
            errorMessage: 'Sua sessão expirou. Entre novamente para continuar.',
            retryRouteName: 'RobotaxiPrototypeDestination',
            retryParams,
          },
        }}
      />,
    );

    expect(screen.getByText('Falha ao gerar pagamento')).toBeTruthy();
    expect(screen.getByText('Sua sessão expirou. Entre novamente para continuar.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('payment-failed-button-Tentar novamente'));
    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototype',
      {},
    );

    expect(screen.queryByTestId('payment-failed-button-Voltar ao mapa')).toBeNull();
  });

  it('retries only booking materialization when Pix is already confirmed', async () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const bookingPayload = {
      destination: {
        name: 'Leblon',
        address: 'Leblon, Rio de Janeiro',
        coordinate: { latitude: -22.984, longitude: -43.223 },
      },
      originAddress: 'Avenida Atlântica',
      originCoordinate: { latitude: -22.971, longitude: -43.182 },
      vehicle: 'Leaf Plus',
      fare: 19.38,
      paymentMethod: 'pix',
      paymentConfirmation: {
        chargeId: 'charge_confirmed_retry',
        rideId: 'temp_ride_confirmed_retry',
        amountInCents: 1938,
        quoteLockId: 'quote_lock_confirmed_retry',
      },
    };
    const retryConfirmedBookingMaterialization = jest.fn().mockResolvedValue({
      success: true,
      bookingId: 'booking_confirmed_retry',
      bookingPayload,
      passengerId: 'passenger_sandbox',
      paymentSession: {
        chargeId: 'charge_confirmed_retry',
        paymentSessionId: 'payment_session_confirmed_retry',
        contextKey: 'payment_context_confirmed_retry',
      },
    });
    usePrototypeRideRuntime.mockReturnValue({
      confirmedBookingRetryAvailable: true,
      retryConfirmedBookingMaterialization,
    });

    const screen = render(
      <RobotaxiPaymentFailedScreen
        navigation={navigation}
        route={{
          key: 'payment-failed-confirmed-retry',
          params: {
            title: 'Corrida não solicitada',
            errorMessage: 'Alta demanda. Tente novamente.',
            retryConfirmedBooking: true,
          },
        }}
      />,
    );

    fireEvent.press(screen.getByTestId('payment-failed-button-Tentar novamente'));

    await waitFor(() => {
      expect(retryConfirmedBookingMaterialization).toHaveBeenCalledTimes(1);
      expect(clearRidePaymentSession).toHaveBeenCalledWith({
        passengerId: 'passenger_sandbox',
        paymentSessionId: 'payment_session_confirmed_retry',
        contextKey: 'payment_context_confirmed_retry',
        chargeId: 'charge_confirmed_retry',
      });
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypePaymentSuccess',
        expect.objectContaining({
          destination: 'Leblon',
          fare: 19.38,
          autoAdvance: true,
        }),
      );
    });
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototype',
      expect.anything(),
    );
  });

  it('fails closed when the confirmed Pix retry context is unavailable', () => {
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
    };
    const retryConfirmedBookingMaterialization = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      confirmedBookingRetryAvailable: false,
      retryConfirmedBookingMaterialization,
    });

    const screen = render(
      <RobotaxiPaymentFailedScreen
        navigation={navigation}
        route={{
          key: 'payment-failed-missing-confirmation',
          params: {
            retryConfirmedBooking: true,
          },
        }}
      />,
    );

    expect(
      screen.getByText(/Não foi possível recuperar com segurança a confirmação deste Pix/),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('payment-failed-button-Tentar novamente'));

    expect(retryConfirmedBookingMaterialization).not.toHaveBeenCalled();
    expect(clearRidePaymentSession).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});

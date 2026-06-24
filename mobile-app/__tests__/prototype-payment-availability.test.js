import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import RobotaxiPaymentScreen from '../src/screens/prototype/RobotaxiPaymentScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';

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
  return ({ children }) => <View>{children}</View>;
});

jest.mock('../src/components/payment/SecurePaymentBadge', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="secure-payment-badge" />;
});

jest.mock('../src/components/payment/WooviPaymentModal', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return ({ visible, tripData, quoteLockId }) =>
    visible ? (
      <View testID="mock-woovi-payment-modal">
        <Text>{tripData?.drop?.add || 'Pix aberto'}</Text>
        <Text testID="mock-woovi-payment-amount">{tripData?.estimatedFare}</Text>
        <Text testID="mock-woovi-payment-quote-lock-id">{quoteLockId || 'no-lock'}</Text>
      </View>
    ) : null;
});

jest.mock('../src/components/prototype/LeafRideUI', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  const renderText = value => (value ? <Text>{value}</Text> : null);

  return {
    leafRideColors: {
      dangerText: '#D7153A',
      text: '#171412',
    },
    leafButtonMetrics: {
      height: 48,
      radius: 24,
    },
    LeafButton: ({
      label,
      onPress,
      disabled = false,
      testID,
      accessibilityLabel,
      style,
    }) => (
      <TouchableOpacity
        disabled={disabled}
        onPress={disabled ? undefined : onPress}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={style}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    LeafDivider: ({ style }) => <View style={style} />,
    LeafInfoRow: ({ title, subtitle, style }) => (
      <View style={style}>
        {renderText(title)}
        {renderText(subtitle)}
      </View>
    ),
    LeafMetricRow: ({ metrics = [] }) => (
      <View>
        {metrics.map(metric => (
          <View key={`${metric.label}-${metric.value}`}>
            {renderText(metric.value)}
            {renderText(metric.label)}
          </View>
        ))}
      </View>
    ),
    LeafRideSheet: ({
      children,
      onLayout,
      style,
      testID,
      accessibilityLabel,
    }) => (
      <View
        onLayout={onLayout}
        style={style}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    ),
    LeafStateHeader: ({ title, subtitle, rightLabel }) => (
      <View>
        {renderText(title)}
        {renderText(subtitle)}
        {renderText(rightLabel)}
      </View>
    ),
  };
});

function buildRuntime(overrides = {}) {
  return {
    selectedDestination: null,
    currentAddress: 'Carioca Shopping',
    currentCoordinate: { latitude: -22.8529, longitude: -43.3106 },
    profileUid: 'passenger_1',
    riderProfile: {
      uid: 'passenger_1',
      name: 'Passageira Leaf',
      email: 'passageira@leaf.app.br',
    },
    checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
    paymentState: { status: 'idle' },
    selectDestination: jest.fn().mockResolvedValue({ ok: true }),
    requestRide: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function buildRouteParams(overrides = {}) {
  return {
    autoOpenPix: true,
    destination: 'Mercadão de Madureira',
    destinationAddress: 'Mercadão de Madureira',
    destinationCoordinate: { latitude: -22.8714, longitude: -43.3375 },
    originAddress: 'Carioca Shopping',
    vehicle: 'Leaf Plus',
    fare: 38.4,
    quoteSessionId: 'quote_session_payment_test',
    quoteLockId: 'ql_payment_test',
    quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
    ...overrides,
  };
}

describe('RobotaxiPaymentScreen availability gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not auto-open Pix when driver/geofence availability fails', async () => {
    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: false,
      code: 'OUT_OF_COVERAGE',
      message: 'Região ainda não atendida pela Leaf.',
    });
    const requestRide = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ checkRideAvailability, requestRide }),
    );

    const screen = render(
      <RobotaxiPaymentScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{ params: buildRouteParams() }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByTestId('mock-woovi-payment-modal')).toBeNull();
    expect(screen.getByText('Região ainda não atendida pela Leaf.')).toBeTruthy();
    expect(requestRide).not.toHaveBeenCalled();
  });

  it('auto-opens Pix only after availability passes', async () => {
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ checkRideAvailability }),
    );

    const screen = render(
      <RobotaxiPaymentScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{ params: buildRouteParams() }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('mock-woovi-payment-modal')).toBeTruthy();
    });
    expect(screen.getByTestId('mock-woovi-payment-quote-lock-id').props.children).toBe(
      'ql_payment_test',
    );
    expect(screen.getByTestId('mock-woovi-payment-amount').props.children).toBe(38.4);
  });

  it('does not auto-open Pix without a locked backend quote', async () => {
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ checkRideAvailability }),
    );

    const screen = render(
      <RobotaxiPaymentScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{
          params: buildRouteParams({
            quoteSessionId: null,
            quoteLockId: null,
            quoteLockExpiresAt: null,
          }),
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Cotação expirada, ausente ou sem valor. Recalcule a tarifa antes de pagar.'),
      ).toBeTruthy();
    });

    expect(checkRideAvailability).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-woovi-payment-modal')).toBeNull();
  });

  it('does not auto-open Pix with a backend lock but without a positive locked amount', async () => {
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ checkRideAvailability }),
    );

    const screen = render(
      <RobotaxiPaymentScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{
          params: buildRouteParams({
            fare: null,
            selectedFare: null,
          }),
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('Cotação expirada, ausente ou sem valor. Recalcule a tarifa antes de pagar.'),
      ).toBeTruthy();
    });

    expect(screen.getByText('Cotação pendente')).toBeTruthy();
    expect(screen.queryByText('R$ 22,43')).toBeNull();
    expect(checkRideAvailability).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mock-woovi-payment-modal')).toBeNull();
  });

  it('uses the locked backend quote amount instead of a stale route fare', async () => {
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ checkRideAvailability }),
    );

    const screen = render(
      <RobotaxiPaymentScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{
          params: buildRouteParams({
            fare: 81.59,
            selectedFare: 81.59,
            quoteLockId: 'ql_current_backend_quote',
            quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
            initialPricingQuote: {
              quoteLockId: 'ql_current_backend_quote',
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              quote: {
                estimatedFare: 80.39,
                quoteLockId: 'ql_current_backend_quote',
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              },
            },
          }),
        }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('mock-woovi-payment-modal')).toBeTruthy();
    });

    expect(screen.getByText('R$ 80,39')).toBeTruthy();
    expect(screen.queryByText('R$ 81,59')).toBeNull();
    expect(screen.getByTestId('mock-woovi-payment-amount').props.children).toBe(80.39);
    expect(screen.getByTestId('mock-woovi-payment-quote-lock-id').props.children).toBe(
      'ql_current_backend_quote',
    );
  });
});

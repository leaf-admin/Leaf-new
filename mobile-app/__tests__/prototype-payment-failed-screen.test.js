import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RobotaxiPaymentFailedScreen from '../src/screens/prototype/RobotaxiPaymentFailedScreen';

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
});

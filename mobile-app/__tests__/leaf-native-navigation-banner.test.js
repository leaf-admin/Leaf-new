import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import LeafNativeNavigationBanner from '../src/screens/prototype/home/LeafNativeNavigationBanner';
import { usePrototypeMapOcclusion } from '../src/screens/prototype/prototypeMapOcclusion';

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

const baseNavigationModel = {
  isVisible: true,
  currentInstruction: 'Vire à direita na Av. Atlântica',
  maneuverDistanceLabel: '180 m',
  maneuverDistanceTargetLabel: 'a próxima curva',
  remainingDistanceLabel: '2 km',
  etaLabel: '7 min',
  isOffRoute: false,
  offRouteMessage: '',
};

describe('LeafNativeNavigationBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the active instruction, route summary and hide action', () => {
    const onHide = jest.fn();
    const { getByLabelText, getByTestId, getByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        insetsTop={24}
        navigationModel={baseNavigationModel}
        onHide={onHide}
      />,
    );

    expect(getByText('Vire à direita na Av. Atlântica')).toBeTruthy();
    expect(getByTestId('leaf-native-turn-right-glyph')).toBeTruthy();
    expect(getByText('180 m até a próxima curva')).toBeTruthy();
    expect(getByText('2 km')).toBeTruthy();
    expect(getByText('7 min')).toBeTruthy();
    expect(usePrototypeMapOcclusion).toHaveBeenCalledWith(
      expect.objectContaining({
        occludedTop: 156,
      }),
    );

    fireEvent.press(getByLabelText('Ocultar navegação LEAF'));

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('uses destination copy when there are no more curves', () => {
    const { getByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        insetsTop={24}
        navigationModel={{
          ...baseNavigationModel,
          maneuverDistanceLabel: '3 km',
          maneuverDistanceTargetLabel: 'o destino',
        }}
      />,
    );

    expect(getByText('3 km até o destino')).toBeTruthy();
  });

  it('uses the left-turn maneuver glyph when the instruction asks for it', () => {
    const { getByTestId, getByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        insetsTop={24}
        navigationModel={{
          ...baseNavigationModel,
          currentInstruction: 'Vire à esquerda na Rua Jardim Botânico',
        }}
      />,
    );

    expect(getByText('Vire à esquerda na Rua Jardim Botânico')).toBeTruthy();
    expect(getByTestId('leaf-native-turn-left-glyph')).toBeTruthy();
  });

  it('switches copy when the driver is off-route', () => {
    const { getByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        navigationModel={{
          ...baseNavigationModel,
          isOffRoute: true,
          offRouteMessage: 'Fora da rota. Volte para o traçado no mapa.',
        }}
      />,
    );

    expect(getByText('Fora da rota')).toBeTruthy();
    expect(getByText('Fora da rota. Volte para o traçado no mapa.')).toBeTruthy();
  });

  it('does not render when navigation is hidden', () => {
    const { queryByTestId } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        navigationModel={{
          ...baseNavigationModel,
          isVisible: false,
        }}
      />,
    );

    expect(queryByTestId('leaf-native-navigation-banner')).toBeNull();
    expect(usePrototypeMapOcclusion).toHaveBeenCalledWith(
      expect.objectContaining({
        occludedTop: 0,
      }),
    );
  });
});

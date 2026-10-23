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
    const onOpenNavigation = jest.fn();
    const { getByLabelText, getByTestId, getByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        insetsTop={24}
        navigationModel={baseNavigationModel}
        onOpenNavigation={onOpenNavigation}
        onHide={onHide}
      />,
    );

    expect(getByText('Vire à direita na Av. Atlântica')).toBeTruthy();
    expect(getByTestId('leaf-native-turn-right-glyph')).toBeTruthy();
    expect(getByText('180 m')).toBeTruthy();
    expect(getByText('próxima curva')).toBeTruthy();
    expect(getByText('2 km · 7 min')).toBeTruthy();
    expect(getByText('Abrir navegador')).toBeTruthy();
    expect(usePrototypeMapOcclusion).toHaveBeenCalledWith(
      expect.objectContaining({
        // The initial camera clearance reserves the whole new banner.
        occludedTop: 274,
      }),
    );

    fireEvent.press(getByLabelText('Navegar com Waze ou Google Maps'));
    expect(onOpenNavigation).toHaveBeenCalledTimes(1);

    fireEvent.press(getByLabelText('Ocultar navegação LEAF'));

    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('updates camera clearance from the actual banner height', () => {
    const { getByTestId } = render(
      <LeafNativeNavigationBanner routeKey="home" insetsTop={24} navigationModel={baseNavigationModel} />,
    );
    fireEvent(getByTestId('leaf-native-navigation-banner'), 'layout', {
      nativeEvent: { layout: { width: 294, height: 198 } },
    });
    expect(usePrototypeMapOcclusion).toHaveBeenLastCalledWith(expect.objectContaining({ occludedTop: 304 }));
  });

  it('uses the provider maneuver when the instruction does not name a direction', () => {
    const { getByTestId } = render(
      <LeafNativeNavigationBanner routeKey="home" navigationModel={{
        ...baseNavigationModel, currentInstruction: 'Pegue a saída indicada', maneuver: 'RAMP_RIGHT',
      }} />,
    );
    expect(getByTestId('leaf-native-turn-right-glyph')).toBeTruthy();
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

    expect(getByText('3 km')).toBeTruthy();
    expect(getByText('destino')).toBeTruthy();
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

  it('does not surface the off-route banner in the current UI', () => {
    const { queryByTestId, queryByText } = render(
      <LeafNativeNavigationBanner
        routeKey="home"
        navigationModel={{
          ...baseNavigationModel,
          isOffRoute: true,
          offRouteMessage: 'Fora da rota. Volte para o traçado no mapa.',
        }}
      />,
    );

    expect(queryByTestId('leaf-native-navigation-banner')).toBeNull();
    expect(queryByText('Fora da rota')).toBeNull();
    expect(queryByText('Fora da rota. Volte para o traçado no mapa.')).toBeNull();
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

import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockAnimateToRegion = jest.fn();
const mockFitToCoordinates = jest.fn();
const mockAnimateCamera = jest.fn();

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children, ...props }) => <View {...props}>{children}</View>;
  const MockMapView = React.forwardRef(({ children, mapPadding, testID }, ref) => {
    React.useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
      fitToCoordinates: mockFitToCoordinates,
    }));

    return <View testID={testID} mapPadding={mapPadding}>{children}</View>;
  });

  return {
    __esModule: true,
    default: MockMapView,
    Circle: MockView,
    Marker: MockView,
    Polyline: MockView,
    PROVIDER_GOOGLE: 'google',
  };
});

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children }) => <View>{children}</View>;

  return {
    __esModule: true,
    default: MockView,
    Path: MockView,
    Rect: MockView,
  };
});

const prototypeMapLayerModule = require('../src/components/prototype/PrototypeMapLayer');
const PrototypeMapLayer = prototypeMapLayerModule.default;
const { resolveRouteRenderCoordinates, resolveVehicleColorToken } = prototypeMapLayerModule;

describe('PrototypeMapLayer route viewport fitting', () => {
  const baseRegion = {
    latitude: -22.881,
    longitude: -43.343,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };
  const routeCoordinates = [
    { latitude: -22.881, longitude: -43.343 },
    { latitude: -22.8825, longitude: -43.345 },
  ];
  const visibleRouteRegion = {
    latitude: -22.8832,
    longitude: -43.344,
    latitudeDelta: 0.014,
    longitudeDelta: 0.014,
  };

  it('does not render a two-point partial route while route animation is waiting for its first frame', () => {
    expect(resolveRouteRenderCoordinates({
      hasRoute: true,
      displayedRouteCoordinates: [],
      staticRouteCoordinates: routeCoordinates,
      shouldAnimateRoute: true,
    })).toEqual([]);

    expect(resolveRouteRenderCoordinates({
      hasRoute: true,
      displayedRouteCoordinates: [],
      staticRouteCoordinates: routeCoordinates,
      shouldAnimateRoute: false,
    })).toEqual(routeCoordinates);
  });

  it('resolves vehicle marker color from fallback fields when the primary value is empty', () => {
    expect(resolveVehicleColorToken('', null, 'BRANCO')).toBe('white');
    expect(resolveVehicleColorToken(undefined, '', 'grafite')).toBe('gray');
    expect(resolveVehicleColorToken(null, '#D7A623')).toBe('yellow');
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockAnimateCamera.mockClear();
    mockAnimateToRegion.mockClear();
    mockFitToCoordinates.mockClear();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('uses the visible route region instead of generic fit when bottomsheet viewport is supplied', () => {
    const { getByTestId } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        viewportPadding={{ top: 128, right: 44, bottom: 440, left: 44 }}
        routeViewportRegion={visibleRouteRegion}
        forceRegionUpdate
      />,
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(mockAnimateToRegion).toHaveBeenCalledWith(visibleRouteRegion, expect.any(Number));
    expect(mockFitToCoordinates).not.toHaveBeenCalled();
    expect(getByTestId('prototype-map-view').props.mapPadding).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('falls back to fitToCoordinates with viewport padding when no explicit route viewport region exists', () => {
    const { getByTestId } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        viewportPadding={{ top: 128, right: 44, bottom: 440, left: 44 }}
        forceRegionUpdate
      />,
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(mockFitToCoordinates).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        edgePadding: expect.objectContaining({
          top: 128,
          right: 44,
          left: 44,
        }),
      }),
    );
    expect(getByTestId('prototype-map-view').props.mapPadding).toEqual({
      top: 128,
      right: 44,
      bottom: 440,
      left: 44,
    });
  });

  it('re-applies the canonical home region when no route geometry exists', () => {
    render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        viewportPadding={{ top: 128, right: 44, bottom: 440, left: 44 }}
        forceRegionUpdate
      />,
    );

    expect(mockAnimateToRegion).toHaveBeenCalledWith(baseRegion, 0);
    expect(mockFitToCoordinates).not.toHaveBeenCalled();
  });

  it('does not infer synthetic styling from a short real route', () => {
    const { UNSAFE_getAllByProps } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        routeSynthetic={false}
        routeSource="explicit"
        animateRoute={false}
      />,
    );

    expect(UNSAFE_getAllByProps({ strokeWidth: 7.5 }).length).toBeGreaterThan(0);
    expect(() => UNSAFE_getAllByProps({ strokeWidth: 7 })).toThrow();
  });

  it('uses synthetic styling only when the route provenance says fallback', () => {
    const { UNSAFE_getAllByProps } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        routeSynthetic
        routeSource="fallback"
        animateRoute={false}
      />,
    );

    expect(UNSAFE_getAllByProps({ strokeWidth: 7 }).length).toBeGreaterThan(0);
  });

  it('does not paint an explicit traffic route with one uniform route color', () => {
    const trafficSegments = [
      {
        level: 'normal',
        color: '#198754',
        coordinates: [
          routeCoordinates[0],
          { latitude: -22.8818, longitude: -43.344 },
        ],
      },
      {
        level: 'moderate',
        color: '#F59E0B',
        coordinates: [
          { latitude: -22.8818, longitude: -43.344 },
          routeCoordinates[1],
        ],
      },
    ];

    const { UNSAFE_getAllByProps } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        routeTrafficSegments={trafficSegments}
        routeMainColor="#123456"
        animateRoute={false}
      />,
    );

    expect(() => UNSAFE_getAllByProps({ strokeColor: '#123456' })).toThrow();
    expect(UNSAFE_getAllByProps({ strokeColor: '#198754' }).length).toBeGreaterThan(0);
    expect(UNSAFE_getAllByProps({ strokeColor: '#F59E0B' }).length).toBeGreaterThan(0);
  });
});

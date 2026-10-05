import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockAnimateToRegion = jest.fn();
const mockFitToCoordinates = jest.fn();
const mockAnimateCamera = jest.fn();
jest.mock('../src/components/MobilePreferencesProvider', () => {
  const React = require('react');
  const Context = React.createContext({ preferences: { trafficLayerEnabled: true } });
  return { useMobilePreferences: () => React.useContext(Context), TestPreferencesProvider: Context.Provider };
});
const { TestPreferencesProvider } = require('../src/components/MobilePreferencesProvider');

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children, ...props }) => <View {...props}>{children}</View>;
  const MockMapView = React.forwardRef(({
    children,
    mapPadding,
    testID,
    region,
    initialRegion,
    ...props
  }, ref) => {
    React.useImperativeHandle(ref, () => ({
      animateCamera: mockAnimateCamera,
      animateToRegion: mockAnimateToRegion,
      fitToCoordinates: mockFitToCoordinates,
    }));

    return (
      <View
        {...props}
        testID={testID}
        mapPadding={mapPadding}
        region={region}
        initialRegion={initialRegion}
      >
        {children}
      </View>
    );
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
  const MockView = ({ children, ...props }) => <View {...props}>{children}</View>;

  return {
    __esModule: true,
    default: MockView,
    Path: MockView,
    Rect: MockView,
    SvgXml: MockView,
  };
});

const prototypeMapLayerModule = require('../src/components/prototype/PrototypeMapLayer');
const PrototypeMapLayer = prototypeMapLayerModule.default;
const {
  resolveRouteAnimationEnabled,
  resolveRouteRenderCoordinates,
  resolveVehicleColorToken,
} = prototypeMapLayerModule;

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

  it('renders the shared SVG vehicle in the native map marker', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';
    try {
      const screen = render(<PrototypeMapLayer
        region={baseRegion}
        driverCoordinate={routeCoordinates[0]}
        driverHeading={90}
        driverVehicleColor="prata"
      />);
      const vehicle = screen.getByTestId('leaf-vehicle-vector');
      expect(vehicle.props.xml).toContain('linearGradient');
      expect(vehicle.props.xml).toContain('#B6B8BC');
      expect(vehicle.props.xml).not.toContain('<image');
      screen.unmount();
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it.each(['ios', 'android'])('anchors the blue location dot to the Google SDK coordinate on %s', os => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = os;
    try {
      const screen = render(<PrototypeMapLayer region={baseRegion} userCoordinate={routeCoordinates[0]} />);
      expect(screen.getByTestId('prototype-map-view').props.provider).toBe('google');
      expect(screen.getByTestId('prototype-map-view').props.paddingAdjustmentBehavior).toBe('automatic');
      const marker = screen.getByTestId('map-user-location-marker');
      expect(marker.props.coordinate).toEqual(routeCoordinates[0]);
      expect(marker.props.anchor).toEqual({ x: 0.5, y: 0.5 });
      expect(screen.getAllByTestId('leaf-location-marker')).toHaveLength(1);
      expect(screen.getByTestId('leaf-location-marker')).toHaveStyle({ width: 32, height: 32 });
      expect(screen.getByTestId('leaf-location-marker-dot')).toHaveStyle({ backgroundColor: '#007AFF' });
      screen.rerender(<PrototypeMapLayer region={baseRegion} userCoordinate={routeCoordinates[0]} hideUserMarker />);
      expect(screen.queryByTestId('map-user-location-marker')).toBeNull();
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it('keeps the same native map while its home frame expands to the full viewport', () => {
    const mapRef = React.createRef();
    const framed = { left: 24, top: 226, width: 345, height: 472, right: undefined, bottom: undefined };
    const expanded = { left: 0, top: 0, width: 393, height: 852, right: undefined, bottom: undefined };
    const screen = render(<PrototypeMapLayer mapRef={mapRef} region={baseRegion} containerStyle={framed} />);
    const nativeMap = screen.getByTestId('prototype-map-view');
    expect(screen.getByTestId('prototype-map-container')).toHaveStyle({ left: 24, top: 226, width: 345, height: 472 });
    screen.rerender(<PrototypeMapLayer mapRef={mapRef} region={baseRegion} containerStyle={expanded} />);
    expect(screen.getByTestId('prototype-map-view')).toBe(nativeMap);
    expect(screen.getByTestId('prototype-map-container')).toHaveStyle({ left: 0, top: 0, width: 393, height: 852 });
  });

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

  it('disables progressive route drawing when reduced motion is enabled', () => {
    expect(resolveRouteAnimationEnabled({
      animateRoute: true,
      isTestEnv: false,
      reduceMotion: true,
    })).toBe(false);

    expect(resolveRouteAnimationEnabled({
      animateRoute: true,
      isTestEnv: false,
      reduceMotion: false,
    })).toBe(true);
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

  it('gates Google traffic with both backend policy and the confirmed account preference', () => {
    const surface = (trafficLayerEnabled, policy = true) => <TestPreferencesProvider value={{ preferences: { trafficLayerEnabled } }}><PrototypeMapLayer region={baseRegion} showTraffic={policy} /></TestPreferencesProvider>;
    const screen = render(surface(true));
    expect(screen.getByTestId('prototype-map-view').props.showsTraffic).toBe(true);
    screen.rerender(surface(false));
    expect(screen.getByTestId('prototype-map-view').props.showsTraffic).toBe(false);
    screen.rerender(surface(true, false));
    expect(screen.getByTestId('prototype-map-view').props.showsTraffic).toBe(false);
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

  it('retains the last native iOS region prop when relinquishing camera control', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';

    try {
      const { getByTestId, rerender } = render(
        <PrototypeMapLayer
          mapRef={React.createRef()}
          region={baseRegion}
          userCoordinate={routeCoordinates[0]}
          routeCoordinates={routeCoordinates}
          routeViewportRegion={visibleRouteRegion}
          forceRegionUpdate
        />,
      );

      expect(getByTestId('prototype-map-view').props.initialRegion).toEqual(baseRegion);
      expect(getByTestId('prototype-map-view').props.region).toEqual(visibleRouteRegion);

      rerender(
        <PrototypeMapLayer
          mapRef={React.createRef()}
          region={baseRegion}
          userCoordinate={routeCoordinates[0]}
          routeCoordinates={routeCoordinates}
          routeViewportRegion={visibleRouteRegion}
          forceRegionUpdate={false}
        />,
      );
      expect(getByTestId('prototype-map-view').props.region).toBe(visibleRouteRegion);
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it('keeps the native region prop stable and suspends camera writes during manual hold', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';

    try {
      const { getByTestId } = render(
        <PrototypeMapLayer
          mapRef={React.createRef()}
          region={baseRegion}
          userCoordinate={routeCoordinates[0]}
          routeCoordinates={routeCoordinates}
          routeViewportRegion={visibleRouteRegion}
          forceRegionUpdate
          manualCameraHoldMs={1000}
        />,
      );

      mockAnimateToRegion.mockClear();
      act(() => {
        getByTestId('prototype-map-view').props.onPanDrag({ nativeEvent: {} });
      });
      expect(getByTestId('prototype-map-view').props.region).toBe(visibleRouteRegion);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(mockAnimateToRegion).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(1020);
      });
      expect(getByTestId('prototype-map-view').props.region).toEqual(visibleRouteRegion);
      expect(mockAnimateToRegion).toHaveBeenCalledWith(visibleRouteRegion, 180);
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it('zeros native padding when iOS controls a fallback region without route geometry', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';

    try {
      const { getByTestId } = render(
        <PrototypeMapLayer
          mapRef={React.createRef()}
          region={baseRegion}
          userCoordinate={routeCoordinates[0]}
          viewportPadding={{ top: 151, right: 24, bottom: 418, left: 24 }}
          forceRegionUpdate
        />,
      );
      const map = getByTestId('prototype-map-view');

      expect(map.props.region).toEqual(baseRegion);
      expect(map.props.mapPadding).toEqual({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
    } finally {
      Platform.OS = originalPlatform;
    }
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

  it('emits route animation telemetry without affecting the map surface', () => {
    const onRouteAnimationEvent = jest.fn();

    render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        routeSource="backend"
        onRouteAnimationEvent={onRouteAnimationEvent}
        animateRoute={false}
      />,
    );

    expect(onRouteAnimationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'static',
        routeSource: 'backend',
        routeSynthetic: false,
        configuredDurationMs: 0,
        reducedMotion: false,
        visiblePointCount: expect.any(Number),
      }),
    );
  });
});

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockAnimateToRegion = jest.fn();
const mockFitToCoordinates = jest.fn();
const mockAnimateCamera = jest.fn();
const mockPointForCoordinate = jest.fn();
const mockGetCamera = jest.fn();
const mockMarkerNativeProps = jest.fn();
const mockMarkerRenders = jest.fn();
let mockMarkerImperativeEnabled = false;
const mockCaptureRef = jest.fn();
jest.mock('react-native-view-shot', () => ({ captureRef: (...args) => mockCaptureRef(...args) }));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'), useReducedMotion: () => false,
}));
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
      pointForCoordinate: mockPointForCoordinate,
      getCamera: mockGetCamera,
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
    Marker: React.forwardRef((props, ref) => {
      mockMarkerRenders(props);
      React.useImperativeHandle(ref, () => ({ setNativeProps: next => {
        if (!mockMarkerImperativeEnabled) throw new Error('Mock native updates unavailable');
        mockMarkerNativeProps(next);
      } }));
      return <MockView {...props} />;
    }),
    Polyline: jest.fn(MockView),
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

  it.each(['android', 'ios'])('uses SDK padding for driver-follow perspective without shifting passenger previews on %s', os => {
    const { Platform } = require('react-native');
    const previousPlatform = Platform.OS;
    Platform.OS = os;
    const padding = { top: 340, bottom: 240, left: 0, right: 0 };
    const props = { region: baseRegion, routeCoordinates, routeViewportRegion: visibleRouteRegion,
      navigationCameraPadding: padding };
    const screen = render(<PrototypeMapLayer {...props} mapSafetyProfile="driver" />);
    try {
      expect(screen.getByTestId('prototype-map-view').props.mapPadding).toEqual(padding);
      screen.rerender(<PrototypeMapLayer {...props} mapSafetyProfile="default" />);
      expect(screen.getByTestId('prototype-map-view').props.mapPadding).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    } finally { screen.unmount(); Platform.OS = previousPlatform; }
  });

  it('snapshots the complete Android driver artwork once, keeping its image centred on the route', async () => {
    const { Platform, PixelRatio, StyleSheet } = require('react-native');
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    mockCaptureRef.mockResolvedValue('data:image/png;base64,driver-art');
    const props = { region: baseRegion, userCoordinate: routeCoordinates[0],
      driverCoordinate: routeCoordinates[0], currentLocationMarkerMode: 'car',
      routeCoordinates, animateRoute: false };
    const screen = render(<PrototypeMapLayer {...props} />, { createNodeMock: () => ({}) });
    try {
      fireEvent(screen.getByTestId('driver-vehicle-bitmap-source'), 'layout', {
        nativeEvent: { layout: { width: 56, height: 56 } },
      });
      await act(async () => { jest.advanceTimersByTime(100); await Promise.resolve(); });
      expect(mockCaptureRef).toHaveBeenCalledTimes(1);
      expect(mockCaptureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        result: 'data-uri', width: PixelRatio.getPixelSizeForLayoutSize(56),
        height: PixelRatio.getPixelSizeForLayoutSize(56),
      }));
      const marker = screen.getByTestId('map-user-vehicle-marker');
      expect(marker.props.image).toEqual({ uri: 'data:image/png;base64,driver-art' });
      expect(marker.props.anchor).toEqual({ x: 0.5, y: 0.5 });
      expect(StyleSheet.flatten(marker.props.style)).toMatchObject({ width: 56, height: 56 });
      expect(screen.queryByTestId('driver-vehicle-bitmap-source')).toBeNull();
      screen.rerender(<PrototypeMapLayer {...props} userCoordinate={routeCoordinates[1]} driverCoordinate={routeCoordinates[1]} />);
      await act(async () => { jest.advanceTimersByTime(1500); });
      expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    } finally {
      screen.unmount(); Platform.OS = previousPlatform; mockCaptureRef.mockClear();
    }
  });

  it('updates the registered paint, replaces the shape and recovers from a failed custom image', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'ios';
    try {
      const props = { region: baseRegion, driverCoordinate: routeCoordinates[0], driverHeading: 90 };
      const screen = render(<PrototypeMapLayer {...props} driverVehicleColor="Branco" />);
      expect(screen.getByTestId('leaf-vehicle-vector').props.xml).toContain('#F0F0F1');
      screen.rerender(<PrototypeMapLayer {...props} driverVehicleColor="Marrom" />);
      expect(screen.getByTestId('leaf-vehicle-vector').props.xml).toContain('#896955');
      screen.rerender(<PrototypeMapLayer {...props} driverVehicleColor="Marrom" driverMarkerShapeKey="halloween_pumpkin" />);
      expect(screen.getByTestId('leaf-vehicle-vector').props.xml).toContain('#E7933E');
      screen.rerender(<PrototypeMapLayer {...props} driverVehicleColor="Prata" driverMarkerAssetUrl="https://cdn.leaf.test/custom.webp" />);
      fireEvent(screen.getByTestId('leaf-vehicle-campaign-image'), 'error', {});
      expect(screen.getByTestId('leaf-vehicle-vector').props.xml).toContain('#B6B8BC');
      screen.unmount();
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it.each([['Marrom', 'brown'], ['Bege', 'beige'], ['Laranja', 'orange'], ['Roxo', 'purple'], ['Rosa', 'pink'], ['BRANCA', 'white'], ['PRETA', 'black'], ['VERMELHA', 'red'], ['AMARELA', 'yellow'], ['ROXA', 'purple']])
    ('recognizes the registered color %s', (label, token) => expect(resolveVehicleColorToken(label)).toBe(token));

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

  it.each(['android', 'ios'])('shows a single car for a driver looking at their own map on %s, even when GPS and navigation diverge', os => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = os;
    try {
      const gps = routeCoordinates[0];
      const snappedToRoute = { latitude: gps.latitude + 0.0004, longitude: gps.longitude + 0.0004 };
      const screen = render(
        <PrototypeMapLayer
          region={baseRegion}
          userCoordinate={gps}
          driverCoordinate={snappedToRoute}
          driverMarkerMode="car"
          currentLocationMarkerMode="car"
        />
      );
      const cars = [
        ...screen.queryAllByTestId('map-user-vehicle-marker'),
        ...screen.queryAllByTestId('map-driver-vehicle-marker'),
      ];
      expect(cars).toHaveLength(1);
    } finally {
      Platform.OS = originalPlatform;
    }
  });

  it('keeps the assigned driver car for the passenger on Android', () => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = 'android';
    try {
      const screen = render(
        <PrototypeMapLayer region={baseRegion} userCoordinate={routeCoordinates[0]} driverCoordinate={routeCoordinates[1]} driverMarkerMode="car" />
      );
      expect(screen.queryAllByTestId('map-driver-vehicle-marker')).toHaveLength(1);
      expect(screen.queryAllByTestId('map-user-vehicle-marker')).toHaveLength(0);
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
    require('react-native').AppState.currentState = 'active';
    mockAnimateCamera.mockClear();
    mockAnimateToRegion.mockClear();
    mockFitToCoordinates.mockClear();
    mockPointForCoordinate.mockReset().mockResolvedValue({ x: 120, y: 240 });
    mockGetCamera.mockReset().mockResolvedValue({ heading: 0 });
  });

  it.each(['car', 'dot'])('keeps native cars positioned without projection queries with current location mode %s', async (currentLocationMarkerMode) => {
    const { AppState, Platform } = require('react-native');
    const previousState = AppState.currentState;
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    AppState.currentState = 'active';
    const screen = render(<PrototypeMapLayer
      mapRef={React.createRef()}
      region={baseRegion}
      userCoordinate={routeCoordinates[0]}
      driverCoordinate={routeCoordinates[1]}
      driverMarkerMode="car"
      currentLocationMarkerMode={currentLocationMarkerMode}
      mapCameraHeading={90}
    />);
    try {
      await act(async () => { jest.advanceTimersByTime(400); });
      expect(screen.getAllByTestId(currentLocationMarkerMode === 'car'
        ? 'map-user-vehicle-marker' : 'map-driver-vehicle-marker')).toHaveLength(1);
      expect(mockPointForCoordinate).not.toHaveBeenCalled();
    } finally {
      screen.unmount();
      AppState.currentState = previousState;
      Platform.OS = previousPlatform;
    }
  });

  it('avoids camera inspection for native markers before, during and after Waze', async () => {
    const { AppState, Platform } = require('react-native');
    const previousState = AppState.currentState;
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    AppState.currentState = 'active';
    let onAppState;
    const remove = jest.fn();
    const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      onAppState = listener;
      return { remove };
    });
    const mapRef = React.createRef();
    const screen = render(<PrototypeMapLayer mapRef={mapRef} region={baseRegion} mapCameraHeading={90} />);
    try {
      await act(async () => {});
      expect(mockGetCamera).not.toHaveBeenCalled();
      mockGetCamera.mockClear();
      act(() => onAppState('background'));
      screen.rerender(<PrototypeMapLayer mapRef={mapRef} region={visibleRouteRegion} mapCameraHeading={180} />);
      await act(async () => { jest.advanceTimersByTime(500); });
      expect(mockGetCamera).not.toHaveBeenCalled();
      act(() => onAppState('active'));
      await act(async () => {});
      expect(mockGetCamera).not.toHaveBeenCalled();
      screen.unmount();
      expect(remove).toHaveBeenCalled();
    } finally {
      screen.unmount();
      subscription.mockRestore();
      AppState.currentState = previousState;
      Platform.OS = previousPlatform;
    }
  });

  it.each([['android', 'car'], ['android', 'dot'], ['ios', 'dot']])(
    'moves the visible %s car (%s) between fixes without re-rendering route polylines', (os, ownMode) => {
      const { Platform } = require('react-native');
      const { Polyline } = require('react-native-maps');
      const previousPlatform = Platform.OS;
      Platform.OS = os;
      const start = { latitude: -22.881, longitude: -43.343 };
      const end = { latitude: -22.8808, longitude: -43.343 };
      const props = { region: baseRegion, driverCoordinate: start, userCoordinate: start,
        currentLocationMarkerMode: ownMode, animateRoute: false,
        routeCoordinates: [start, { latitude: -22.879, longitude: -43.343 }] };
      const screen = render(<PrototypeMapLayer {...props} />);
      const id = ownMode === 'car' ? 'map-user-vehicle-marker' : 'map-driver-vehicle-marker';
      try {
        act(() => jest.advanceTimersByTime(1700));
        screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} userCoordinate={end} />);
        expect(screen.getByTestId(id).props.coordinate.latitude).toBeCloseTo(start.latitude, 8);
        Polyline.mockClear();
        act(() => jest.advanceTimersByTime(425));
        const midway = screen.getByTestId(id).props.coordinate.latitude;
        expect(midway).toBeGreaterThan(start.latitude);
        expect(midway).toBeLessThan(end.latitude);
        expect(Polyline).not.toHaveBeenCalled();
        act(() => jest.advanceTimersByTime(500));
        // The existing bounded route prediction may already be just ahead of the fix.
        expect(Math.abs(screen.getByTestId(id).props.coordinate.latitude - end.latitude)).toBeLessThan(0.00002);
        expect(Polyline).not.toHaveBeenCalled();
      } finally { screen.unmount(); Platform.OS = previousPlatform; }
    });

  it.each(['hidden', 'background'])('stops visual frames when %s and resumes at the latest fix', reason => {
    const { AppState, Platform } = require('react-native');
    const { Polyline } = require('react-native-maps');
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    let onAppState;
    const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
      onAppState = listener;
      return { remove: jest.fn() };
    });
    const start = { latitude: -22.881, longitude: -43.343 };
    const end = { latitude: -22.8808, longitude: -43.343 };
    const latest = { latitude: -22.8806, longitude: -43.343 };
    const props = { region: baseRegion, userCoordinate: start, driverCoordinate: start,
      currentLocationMarkerMode: 'car', animateRoute: false };
    const screen = render(<PrototypeMapLayer {...props} />);
    try {
      act(() => jest.advanceTimersByTime(1700));
      screen.rerender(<PrototypeMapLayer {...props} userCoordinate={end} driverCoordinate={end} />);
      act(() => jest.advanceTimersByTime(200));
      if (reason === 'background') act(() => onAppState('background'));
      screen.rerender(<PrototypeMapLayer {...props} userCoordinate={latest} driverCoordinate={latest}
        motionEnabled={reason !== 'hidden'} />);
      Polyline.mockClear();
      const frames = jest.spyOn(global, 'requestAnimationFrame');
      try {
        act(() => jest.advanceTimersByTime(6000));
        expect(Polyline).not.toHaveBeenCalled();
        expect(frames).not.toHaveBeenCalled();
      } finally { frames.mockRestore(); }
      if (reason === 'background') act(() => onAppState('active'));
      screen.rerender(<PrototypeMapLayer {...props} userCoordinate={latest} driverCoordinate={latest} />);
      expect(screen.getByTestId('map-user-vehicle-marker').props.coordinate).toEqual(latest);
    } finally { screen.unmount(); subscription.mockRestore(); Platform.OS = previousPlatform; }
  });

  it('bounds prediction after a missing GPS fix and stops scheduling visual frames', () => {
    const { Platform } = require('react-native');
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    const start = { latitude: -22.881, longitude: -43.343 };
    const end = { latitude: -22.8808, longitude: -43.343 };
    const props = { region: baseRegion, driverCoordinate: start, animateRoute: false,
      routeCoordinates: [start, { latitude: -22.879, longitude: -43.343 }] };
    const screen = render(<PrototypeMapLayer {...props} />);
    try {
      act(() => jest.advanceTimersByTime(1700));
      screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} />);
      act(() => jest.advanceTimersByTime(6000));
      const last = screen.getByTestId('map-driver-vehicle-marker').props.coordinate;
      expect(last.latitude).toBeGreaterThan(end.latitude);
      // 18 m/s maximum, 4.2 s maximum prediction: less than 76 m beyond the fix.
      expect((last.latitude - end.latitude) * 111195).toBeLessThanOrEqual(76);
      const frames = jest.spyOn(global, 'requestAnimationFrame');
      try {
        act(() => jest.advanceTimersByTime(6000));
        expect(screen.getByTestId('map-driver-vehicle-marker').props.coordinate).toEqual(last);
        expect(frames).not.toHaveBeenCalled();
      } finally { frames.mockRestore(); }
    } finally { screen.unmount(); Platform.OS = previousPlatform; }
  });

  it('follows a right-angle route instead of cutting across the corner', () => {
    const start = { latitude: -22.881, longitude: -43.343 };
    const corner = { latitude: -22.8809, longitude: -43.343 };
    const end = { latitude: -22.8809, longitude: -43.3429 };
    const props = { region: baseRegion, driverCoordinate: start, animateRoute: false,
      routeCoordinates: [start, corner, end] };
    const screen = render(<PrototypeMapLayer {...props} />);
    try {
      act(() => jest.advanceTimersByTime(1700));
      screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} />);
      for (let index = 0; index < 8; index++) {
        act(() => jest.advanceTimersByTime(100));
        const current = screen.getByTestId('map-driver-vehicle-marker').props.coordinate;
        expect(Math.min(Math.abs(current.longitude - start.longitude),
          Math.abs(current.latitude - corner.latitude))).toBeLessThan(0.0000001);
      }
    } finally { screen.unmount(); }
  });

  it('retargets an in-flight marker from its visible pose and cancels frames on unmount', () => {
    const start = { latitude: -22.881, longitude: -43.343 };
    const end = { latitude: -22.8808, longitude: -43.343 };
    const next = { latitude: -22.8806, longitude: -43.343 };
    const props = { region: baseRegion, driverCoordinate: start, driverHeading: 350, animateRoute: false };
    const screen = render(<PrototypeMapLayer {...props} />);
    try {
      act(() => jest.advanceTimersByTime(1700));
      screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} driverHeading={10} />);
      act(() => jest.advanceTimersByTime(200));
      const marker = screen.getByTestId('map-driver-vehicle-marker');
      const visible = marker.props.coordinate;
      expect(marker.props.rotation > 350 || marker.props.rotation < 10).toBe(true);
      screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={next} driverHeading={10} />);
      expect(screen.getByTestId('map-driver-vehicle-marker').props.coordinate).toEqual(visible);
      screen.unmount();
      const frames = jest.spyOn(global, 'requestAnimationFrame');
      try {
        act(() => jest.advanceTimersByTime(6000));
        expect(frames).not.toHaveBeenCalled();
      } finally { frames.mockRestore(); }
    } finally { screen.unmount(); }
  });

  it('keeps native-only region callbacks free of camera and projection queries', async () => {
    const { Platform } = require('react-native');
    const previousPlatform = Platform.OS;
    Platform.OS = 'android';
    const screen = render(<PrototypeMapLayer region={baseRegion} mapRef={React.createRef()} />);
    try {
      for (let index = 0; index < 30; index++) {
        fireEvent(screen.getByTestId('prototype-map-view'), 'regionChange', {
          ...baseRegion, latitude: baseRegion.latitude + index * 0.000001,
        });
        await act(async () => { jest.advanceTimersByTime(17); });
      }
      expect(mockGetCamera).not.toHaveBeenCalled();
      expect(mockPointForCoordinate).not.toHaveBeenCalled();
    } finally { screen.unmount(); Platform.OS = previousPlatform; }
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
      expect(mockAnimateToRegion).toHaveBeenCalledWith(visibleRouteRegion, 450);
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

  it.each(['ios', 'android'])('keeps the fallback region when a pickup route disappears within metres on %s', os => {
    const { Platform } = require('react-native');
    const originalPlatform = Platform.OS;
    Platform.OS = os;
    try {
      const pickup = { latitude: -22.920809, longitude: -43.406063 };
      const nearbyDriver = { latitude: pickup.latitude + 0.00001, longitude: pickup.longitude };
      const fallback = { ...pickup, latitudeDelta: 0.006, longitudeDelta: 0.006 };
      const props = { mapRef: React.createRef(), region: fallback, forceRegionUpdate: true,
        userCoordinate: pickup, driverCoordinate: nearbyDriver, originCoordinate: nearbyDriver, destinationCoordinate: pickup };
      const screen = render(<PrototypeMapLayer {...props} routeCoordinates={[nearbyDriver, pickup]} routeViewportRegion={visibleRouteRegion} />);
      mockFitToCoordinates.mockClear();
      mockAnimateToRegion.mockClear();
      screen.rerender(<PrototypeMapLayer {...props} routeCoordinates={[]} routeViewportRegion={null} />);
      act(() => { jest.runOnlyPendingTimers(); });
      expect(mockAnimateToRegion).toHaveBeenCalledWith(fallback, expect.any(Number));
      expect(mockFitToCoordinates).not.toHaveBeenCalled();
      screen.unmount();
    } finally { Platform.OS = originalPlatform; }
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

  it('keeps the full route visible when traffic covers only a small part of it', () => {
    const { UNSAFE_getAllByProps } = render(
      <PrototypeMapLayer
        mapRef={React.createRef()}
        region={baseRegion}
        userCoordinate={routeCoordinates[0]}
        routeCoordinates={routeCoordinates}
        routeTrafficSegments={[
          {
            level: 'normal',
            color: '#198754',
            coordinates: [
              routeCoordinates[0],
              {
                latitude: routeCoordinates[0].latitude + 0.0001,
                longitude: routeCoordinates[0].longitude + 0.0001,
              },
            ],
          },
        ]}
        routeMainColor="#123456"
        animateRoute={false}
      />,
    );

    expect(UNSAFE_getAllByProps({ strokeColor: '#123456' }).length).toBeGreaterThan(0);
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

it('updates the native vehicle pose without reconciling the marker for each straight-line frame', () => {
  const { Platform } = require('react-native');
  const previousPlatform = Platform.OS;
  Platform.OS = 'android';
  mockMarkerImperativeEnabled = true;
  const start = { latitude: -22.881, longitude: -43.343 };
  const end = { latitude: -22.8808, longitude: -43.343 };
  const props = { region: baseRegion, driverCoordinate: start, animateRoute: false,
    routeCoordinates: [start, { latitude: -22.879, longitude: -43.343 }] };
  const screen = render(<PrototypeMapLayer {...props} />);
  try {
    act(() => jest.advanceTimersByTime(1700));
    screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} />);
    mockMarkerNativeProps.mockClear();
    mockMarkerRenders.mockClear();
    act(() => jest.advanceTimersByTime(500));
    expect(mockMarkerNativeProps.mock.calls.length).toBeGreaterThan(3);
    expect(mockMarkerRenders.mock.calls.length).toBeLessThanOrEqual(1);
    const latest = mockMarkerNativeProps.mock.calls.at(-1)[0];
    expect(latest.coordinate.latitude).toBeGreaterThan(start.latitude);
    expect(latest.coordinate.longitude).toBeCloseTo(start.longitude, 6);
    expect(latest.rotation).toBeCloseTo(0, 4);
    screen.rerender(<PrototypeMapLayer {...props} driverCoordinate={end} motionEnabled={false} />);
    mockMarkerNativeProps.mockClear();
    act(() => jest.advanceTimersByTime(6000));
    expect(mockMarkerNativeProps).not.toHaveBeenCalled();
  } finally {
    screen.unmount();
    mockMarkerImperativeEnabled = false;
    Platform.OS = previousPlatform;
  }
});

});

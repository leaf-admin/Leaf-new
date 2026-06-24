import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiDriverOfferScreen, {
  DRIVER_OFFER_RENDERED_CARD_FIELDS,
} from '../src/screens/prototype/RobotaxiDriverOfferScreen';
import RobotaxiDriverSearchScreen from '../src/screens/prototype/RobotaxiDriverSearchScreen';
import RobotaxiDriverTripScreen, {
  DRIVER_TRIP_RENDERED_CARD_FIELDS,
} from '../src/screens/prototype/RobotaxiDriverTripScreen';
import RobotaxiNoDriversScreen from '../src/screens/prototype/RobotaxiNoDriversScreen';
import RobotaxiPaymentSuccessScreen from '../src/screens/prototype/RobotaxiPaymentSuccessScreen';
import RobotaxiTripScreen, {
  PASSENGER_TRIP_RENDERED_CARD_FIELDS,
} from '../src/screens/prototype/RobotaxiTripScreen';
import RobotaxiReceiptScreen from '../src/screens/prototype/RobotaxiReceiptScreen';
import RobotaxiRatingScreen from '../src/screens/prototype/RobotaxiRatingScreen';
import RobotaxiTripHistoryScreen from '../src/screens/prototype/RobotaxiTripHistoryScreen';
import RobotaxiChatScreen from '../src/screens/prototype/RobotaxiChatScreen';
import RobotaxiCancellationScreen from '../src/screens/prototype/RobotaxiCancellationScreen';
import RatingService from '../src/services/RatingService';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { resolveMeaningfulAddress } from '../src/screens/prototype/addressLabelUtils';
import {
  allowForcedPaymentBypass,
  allowTestUserTools,
} from '../src/config/runtimeAccessPolicy';
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  validateRideCardRenderedFields,
} from '../src/screens/prototype/rideCardContract';

jest.mock('@react-navigation/native', () => ({
  StackActions: {
    replace: jest.fn((name, params) => ({ type: 'REPLACE', payload: { name, params } })),
  },
  useIsFocused: jest.fn(() => true),
}));

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock('../src/components/prototype/PrototypeScreenTransition', () => {
  const React = require('react');
  return ({ children }) => <>{children}</>;
});

jest.mock('../src/components/prototype/DriverSearchRadar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View />;
});

jest.mock('../src/components/prototype/PrototypeMapLayer', () => {
  const React = require('react');
  const MapView = require('react-native-maps').default;

  const MockPrototypeMapLayer = ({
    interactionEnabled = true,
    onMapLayout,
    routeCoordinates,
    routeTrafficSegments,
    showTraffic,
    routeViewportRegion,
    viewportPadding,
  }) => (
    <MapView
      testID="prototype-map-view"
      accessibilityLabel="prototype-map-view"
      mapPadding={viewportPadding}
      routeCoordinates={routeCoordinates}
      routeTrafficSegments={routeTrafficSegments}
      routeViewportRegion={routeViewportRegion}
      showTraffic={showTraffic}
      onLayout={onMapLayout}
      pitchEnabled={interactionEnabled}
      rotateEnabled={interactionEnabled}
      scrollEnabled={interactionEnabled}
      zoomEnabled={interactionEnabled}
    />
  );

  return {
    __esModule: true,
    default: MockPrototypeMapLayer,
  };
});

jest.mock('../src/components/prototype/PrototypeDismissibleSheet', () => {
  const React = require('react');
  const { TouchableOpacity, View } = require('react-native');
  return ({
    children,
    onClose,
    backdropDismissEnabled = true,
    dragEnabled = true,
  }) => (
    <View
      testID="prototype-dismissible-sheet"
      accessibilityLabel="prototype-dismissible-sheet"
      backdropDismissEnabled={backdropDismissEnabled}
      dragEnabled={dragEnabled}
    >
      <View
        testID="prototype-dismissible-sheet-backdrop"
        accessibilityLabel="prototype-dismissible-sheet-backdrop"
        pointerEvents={backdropDismissEnabled ? 'auto' : 'none'}
      >
        <TouchableOpacity
          testID="prototype-dismissible-sheet-backdrop-pressable"
          accessibilityLabel="prototype-dismissible-sheet-backdrop-pressable"
          onPress={backdropDismissEnabled ? onClose : undefined}
        />
      </View>
      {children}
    </View>
  );
});

jest.mock('../src/components/prototype/PrototypeUI', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  return {
    CardHandle: () => null,
    PrototypeCard: ({ children, ...props }) => <View {...props}>{children}</View>,
    PrototypePrimaryButton: ({ label, onPress, testID, accessibilityLabel, disabled }) => (
      <TouchableOpacity
        onPress={onPress}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../src/components/payment/WooviPaymentModal', () => {
  const React = require('react');
  return () => null;
});

jest.mock('../src/components/prototype/LeafRideUI', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  const leafRideColors = {
    bg: '#F7F8F4',
    sheet: '#FFFFFF',
    sheetTranslucent: '#FFFFFF',
    text: '#171412',
    secondary: '#756F68',
    muted: '#827B73',
    line: '#E9E2D8',
    borderStrong: '#E2DAD0',
    field: '#F7F8F4',
    leaf: '#1A330E',
    leafLight: '#EEF3EA',
    accent: '#1A330E',
    accentDark: '#102307',
    accentSoft: '#EEF3EA',
    accentBorder: '#D9E3D3',
    blue: '#F3F5F2',
    blueText: '#514B45',
    warning: '#F7F8F4',
    warningText: '#7A6337',
    danger: '#FFF1F2',
    dangerText: '#D7153A',
  };

  const leafButtonMetrics = Object.freeze({
    height: 48,
    radius: 24,
    iconSize: 16,
    iconGap: 6,
  });

  const renderText = (value, props = {}) => (
    value ? <Text {...props}>{value}</Text> : null
  );

  const LeafAnimatedPressable = ({
    children,
    disabled = false,
    onPress,
    testID,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    style,
  }) => (
    <TouchableOpacity
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState || { disabled }}
      style={style}
    >
      {children}
    </TouchableOpacity>
  );

  return {
    leafRideColors,
    leafButtonMetrics,
    LeafAnimatedPressable,
    LeafButton: ({
      label,
      onPress,
      disabled = false,
      testID,
      accessibilityLabel,
      style,
      textStyle,
    }) => (
      <LeafAnimatedPressable
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={style}
      >
        <Text style={textStyle}>{label}</Text>
      </LeafAnimatedPressable>
    ),
    LeafDivider: ({ style }) => <View style={style} />,
    LeafDriverIdentity: ({
      name,
      rating,
      vehicle,
      plate,
      style,
      testID,
      fieldTestIDs = {},
    }) => (
      <View style={style} testID={testID}>
        <View testID={fieldTestIDs.avatar} />
        {renderText(name, { testID: fieldTestIDs.name })}
        {renderText(rating, { testID: fieldTestIDs.meta })}
        {renderText(plate || '--', { testID: fieldTestIDs.plate })}
        {renderText(vehicle, { testID: fieldTestIDs.vehicle })}
      </View>
    ),
    LeafEmptyState: ({
      title,
      message,
      loading = false,
      actionLabel,
      onActionPress,
      testID,
    }) => (
      <View testID={testID}>
        {loading ? <Text>loading</Text> : null}
        {renderText(title)}
        {renderText(message)}
        {actionLabel ? (
          <TouchableOpacity onPress={onActionPress}>
            <Text>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ),
    LeafInfoRow: ({ title, subtitle, right, style }) => (
      <View style={style}>
        {renderText(title)}
        {renderText(subtitle)}
        {renderText(right)}
      </View>
    ),
    LeafMetric: ({ value, label, style }) => (
      <View style={style}>
        {renderText(value)}
        {renderText(label)}
      </View>
    ),
    LeafMetricRow: ({ metrics = [], style }) => (
      <View style={style}>
        {metrics.map((metric) => (
          <View key={`${metric.label}-${metric.value}`}>
            {renderText(metric.value)}
            {renderText(metric.label)}
          </View>
        ))}
      </View>
    ),
    LeafPersonIdentity: ({
      name,
      meta,
      right,
      style,
      testID,
      fieldTestIDs = {},
    }) => (
      <View style={style} testID={testID}>
        <View testID={fieldTestIDs.avatar} />
        {renderText(name, { testID: fieldTestIDs.name })}
        {renderText(meta, { testID: fieldTestIDs.meta })}
        {renderText(right, { testID: fieldTestIDs.right })}
      </View>
    ),
    LeafPill: ({ label, style, testID }) => (
      <Text style={style} testID={testID}>
        {label}
      </Text>
    ),
    LeafProgressBar: ({ progress = 0, fillTestID }) => (
      <View>
        <View
          testID={fillTestID}
          style={[{ width: `${Math.round(Math.max(0, Math.min(1, Number(progress) || 0)) * 100)}%` }]}
        />
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
    LeafRouteProgress: ({
      originLabel,
      destinationLabel,
      arrivalLabel,
      style,
      testID,
      fieldTestIDs = {},
    }) => (
      <View style={style} testID={testID}>
        {renderText(originLabel, { testID: fieldTestIDs.origin })}
        {renderText(destinationLabel, { testID: fieldTestIDs.destination })}
        <View testID={fieldTestIDs.progress} />
        {renderText(arrivalLabel)}
      </View>
    ),
    LeafStateHeader: ({ title, subtitle, rightLabel, insetsTop = 0 }) => (
      <View testID="leaf-state-header" insetsTop={insetsTop}>
        {renderText(title)}
        {renderText(subtitle)}
        {renderText(rightLabel)}
      </View>
    ),
  };
});

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children }) => <View>{children}</View>;
  const MockMapView = React.forwardRef(
    (
      {
	        accessibilityLabel,
	        children,
	        mapPadding,
	        onLayout,
	        pitchEnabled,
	        routeCoordinates,
	        routeTrafficSegments,
        routeViewportRegion,
        rotateEnabled,
        scrollEnabled,
        showTraffic,
        testID,
        zoomEnabled,
      },
      ref,
    ) => {
      React.useImperativeHandle(ref, () => ({
        animateToRegion: jest.fn(),
        fitToCoordinates: jest.fn(),
      }));
      return (
        <View
	          accessibilityLabel={accessibilityLabel}
	          mapPadding={mapPadding}
	          onLayout={onLayout}
	          pitchEnabled={pitchEnabled}
	          routeCoordinates={routeCoordinates}
          routeTrafficSegments={routeTrafficSegments}
          routeViewportRegion={routeViewportRegion}
          rotateEnabled={rotateEnabled}
          scrollEnabled={scrollEnabled}
          showTraffic={showTraffic}
          testID={testID}
          zoomEnabled={zoomEnabled}
        >
          {children}
        </View>
      );
    },
  );
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockView,
    Polyline: MockView,
    Polygon: MockView,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('../src/services/RatingService', () => ({
  submitRating: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowForcedPaymentBypass: jest.fn(() => false),
  allowTestUserTools: jest.fn(() => false),
}));

function buildPassengerRuntime(overrides = {}) {
  return {
    bookingStatus: 'accepted',
    selectedDestination: { name: 'Aeroporto Santos Dumont', address: 'Centro, Rio de Janeiro' },
    selectedVehicle: 'Leaf Plus',
    selectedFare: 38.4,
    tripDistanceKm: 8.2,
    tripDurationMin: 14,
    tripArrivalText: 'Chegada em 14 min',
    boardingRemainingSec: 90,
    activeBooking: {
      driverDistanceToPickupKm: 8.2,
      estimatedArrivalToPickupMin: 14,
    },
    driverInfo: { id: 'driver_1', name: 'Motorista Leaf', model: 'Leaf Plus', plate: 'LEF-2042' },
    rideExtension: { status: 'idle' },
    operationalContinuation: { status: 'idle' },
    paymentMethod: 'pix',
    activeBookingId: 'booking_1',
    currentAddress: 'Rua A, 10',
    profileUid: 'customer_1',
    riderProfile: { name: 'Passageira Leaf', email: 'passageira@leaf.app.br' },
    endTripEarlyFlow: jest.fn(),
    respondOperationalContinuationFlow: jest.fn(),
    ...overrides,
  };
}

function buildDriverRuntime(overrides = {}) {
  return {
    bookingStatus: 'accepted',
    driverActiveRide: {
      bookingId: 'booking_1',
      pickupAddress: 'Rua A, 10',
      dropoffAddress: 'Aeroporto Santos Dumont',
      fare: 38.4,
      estimatedDriverNetAmount: 31.8,
      destinationCoordinate: { latitude: -22.9, longitude: -43.17 },
    },
    selectedDestination: { name: 'Aeroporto Santos Dumont', coordinate: { latitude: -22.9, longitude: -43.17 } },
    selectedFare: 38.4,
    currentAddress: 'Rua A, 10',
    tripDistanceKm: 8.2,
    tripDurationMin: 14,
    tripArrivalText: 'Chegada em 14 min',
    boardingRemainingSec: 90,
    markDriverArrived: jest.fn().mockResolvedValue(undefined),
    startTripFlow: jest.fn().mockResolvedValue(undefined),
    completeTripFlow: jest.fn().mockResolvedValue(undefined),
    lastError: '',
    ...overrides,
  };
}

function buildReceiptRuntime(overrides = {}) {
  return {
    tripHistory: [
      {
        id: 'trip_1',
        fare: 38.4,
        value: 'R$ 38,40',
        driverNetAmount: 31.8,
        totalFees: 6.6,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        route: 'Rua A -> Aeroporto Santos Dumont',
        pickupAddress: 'Rua A, 10, Centro, Rio de Janeiro',
        destinationAddress: 'Praça Senador Salgado Filho, Centro, Rio de Janeiro',
        paymentMethod: 'pix',
        driverId: 'driver_1',
        driverName: 'Motorista Leaf',
        passengerId: 'customer_1',
        passengerName: 'Passageira Leaf',
      },
    ],
    lastReceipt: {
      id: 'trip_1',
      fare: 38.4,
      value: 'R$ 38,40',
      driverNetAmount: 31.8,
      totalFees: 6.6,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      route: 'Rua A -> Aeroporto Santos Dumont',
      pickupAddress: 'Rua A, 10, Centro, Rio de Janeiro',
      destinationAddress: 'Praça Senador Salgado Filho, Centro, Rio de Janeiro',
      paymentMethod: 'pix',
      driverId: 'driver_1',
      driverName: 'Motorista Leaf',
      passengerId: 'customer_1',
      passengerName: 'Passageira Leaf',
    },
    activeRole: 'customer',
    driverTripMeta: {},
    dismissCompletedReceipt: jest.fn(),
    ...overrides,
  };
}

function projectViewportY({ coordinate, region, mapHeight }) {
  return mapHeight / 2 - ((coordinate.latitude - region.latitude) / region.latitudeDelta) * mapHeight;
}

function projectViewportX({ coordinate, region, mapWidth }) {
  return mapWidth / 2 + ((coordinate.longitude - region.longitude) / region.longitudeDelta) * mapWidth;
}

function expectRouteInsideVisibleMapViewport({ coordinates, mapView, mapWidth, mapHeight }) {
  const routeViewportRegion = mapView.props.routeViewportRegion;
  const mapPadding = mapView.props.mapPadding || {};
  const top = Number(mapPadding.top) || 0;
  const bottom = Number(mapPadding.bottom) || 0;
  const left = Number(mapPadding.left) || 0;
  const right = Number(mapPadding.right) || 0;

  expect(routeViewportRegion).toEqual(expect.objectContaining({
    latitude: expect.any(Number),
    latitudeDelta: expect.any(Number),
    longitude: expect.any(Number),
    longitudeDelta: expect.any(Number),
  }));

  coordinates.forEach(coordinate => {
    const x = projectViewportX({ coordinate, region: routeViewportRegion, mapWidth });
    const y = projectViewportY({ coordinate, region: routeViewportRegion, mapHeight });
    expect(x).toBeGreaterThanOrEqual(left);
    expect(x).toBeLessThanOrEqual(mapWidth - right);
    expect(y).toBeGreaterThanOrEqual(top);
    expect(y).toBeLessThanOrEqual(mapHeight - bottom);
  });
}

function expectCriticalRideCardFieldsRendered(screen, role, state, renderedFields) {
  const result = validateRideCardRenderedFields(role, state, renderedFields, {
    includeImportant: false,
    requireTestIDs: true,
    queryByTestId: screen.queryByTestId,
  });

  expect({
    missing: result.missing.map((field) => field.id),
    missingRenderTargets: result.missingRenderTargets.map((field) => field.id),
    missingRendered: result.missingRendered.map((field) => field.id),
  }).toEqual({
    missing: [],
    missingRenderTargets: [],
    missingRendered: [],
  });
}

describe('prototype ride screens', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    allowForcedPaymentBypass.mockReturnValue(false);
    allowTestUserTools.mockReturnValue(false);
    require('@react-navigation/native').useIsFocused.mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps implemented ride surfaces covered by the card contract', () => {
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.PASSENGER,
        RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
        PASSENGER_TRIP_RENDERED_CARD_FIELDS.accepted,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.PASSENGER,
        RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED,
        PASSENGER_TRIP_RENDERED_CARD_FIELDS.arrived,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.PASSENGER,
        RIDE_CARD_STATES.PASSENGER_IN_TRIP,
        PASSENGER_TRIP_RENDERED_CARD_FIELDS.started,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.DRIVER,
        RIDE_CARD_STATES.DRIVER_NEW_OFFER,
        DRIVER_OFFER_RENDERED_CARD_FIELDS,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.DRIVER,
        RIDE_CARD_STATES.DRIVER_TO_PICKUP,
        DRIVER_TRIP_RENDERED_CARD_FIELDS.accepted,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.DRIVER,
        RIDE_CARD_STATES.DRIVER_AT_PICKUP,
        DRIVER_TRIP_RENDERED_CARD_FIELDS.arrived,
      ).ok
    ).toBe(true);
    expect(
      validateRideCardRenderedFields(
        RIDE_CARD_ROLES.DRIVER,
        RIDE_CARD_STATES.DRIVER_IN_TRIP,
        DRIVER_TRIP_RENDERED_CARD_FIELDS.started,
      ).ok
    ).toBe(true);
  });

  it('renders critical contract fields with concrete card testIDs', () => {
    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'accepted' }));
    const passengerAccepted = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      passengerAccepted,
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
      PASSENGER_TRIP_RENDERED_CARD_FIELDS.accepted
    );
    passengerAccepted.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'arrived' }));
    const passengerArrived = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      passengerArrived,
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED,
      PASSENGER_TRIP_RENDERED_CARD_FIELDS.arrived
    );
    passengerArrived.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'started' }));
    const passengerStarted = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      passengerStarted,
      RIDE_CARD_ROLES.PASSENGER,
      RIDE_CARD_STATES.PASSENGER_IN_TRIP,
      PASSENGER_TRIP_RENDERED_CARD_FIELDS.started
    );
    passengerStarted.unmount();

    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [
        {
          bookingId: 'booking_1',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          distanceKm: 0.7,
          tripDistanceKm: 8.2,
          pickupEtaMin: 4,
          tripDurationMin: 14,
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
        },
      ],
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });
    const driverOffer = render(<RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      driverOffer,
      RIDE_CARD_ROLES.DRIVER,
      RIDE_CARD_STATES.DRIVER_NEW_OFFER,
      DRIVER_OFFER_RENDERED_CARD_FIELDS
    );
    driverOffer.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildDriverRuntime({ bookingStatus: 'accepted' }));
    const driverAccepted = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      driverAccepted,
      RIDE_CARD_ROLES.DRIVER,
      RIDE_CARD_STATES.DRIVER_TO_PICKUP,
      DRIVER_TRIP_RENDERED_CARD_FIELDS.accepted
    );
    driverAccepted.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildDriverRuntime({ bookingStatus: 'arrived' }));
    const driverArrived = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    expectCriticalRideCardFieldsRendered(
      driverArrived,
      RIDE_CARD_ROLES.DRIVER,
      RIDE_CARD_STATES.DRIVER_AT_PICKUP,
      DRIVER_TRIP_RENDERED_CARD_FIELDS.arrived
    );
    driverArrived.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildDriverRuntime({ bookingStatus: 'started' }));
    const driverStarted = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    fireEvent.press(driverStarted.getByText('Detalhes'));
    expectCriticalRideCardFieldsRendered(
      driverStarted,
      RIDE_CARD_ROLES.DRIVER,
      RIDE_CARD_STATES.DRIVER_IN_TRIP,
      DRIVER_TRIP_RENDERED_CARD_FIELDS.started
    );
  });

  it('renders accepted passenger trip without pickup distance or ETA instead of blanking', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        activeBooking: {},
        driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
        tripDistanceKm: null,
        tripDurationMin: null,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByTestId('passenger-trip-screen')).toBeTruthy();
    expect(screen.getByText('Pronto para iniciar a viagem')).toBeTruthy();
  });

  it('drives the offer screen into the driver trip surface on acceptance', async () => {
    const acceptDriverOffer = jest.fn().mockResolvedValue(undefined);
    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [
        {
          bookingId: 'booking_1',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          distanceKm: 0.7,
          tripDistanceKm: 8.2,
          pickupEtaMin: 4,
          tripDurationMin: 14,
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
          preferences: {
            temperatureLabel: 'Ar-condicionado ligado',
            soundLabel: 'Pouca conversa',
          },
        },
      ],
      acceptDriverOffer,
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { getByText } = render(
      <RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Preferências')).toBeTruthy();
    expect(getByText('Ar-condicionado ligado')).toBeTruthy();
    expect(getByText('Pouca conversa')).toBeTruthy();
    expect(getByText('14 min · 8,2 km de viagem')).toBeTruthy();
    expect(getByText('PIX confirmado')).toBeTruthy();

    fireEvent.press(getByText('Aceitar corrida'));

    await waitFor(() => {
      expect(acceptDriverOffer).toHaveBeenCalled();
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototype',
        expect.objectContaining({
          bookingId: 'booking_1',
          source: 'driver-offer-accepted',
        })
      );
    });
  });

  it('keeps paid driver offers locked until explicit accept, reject, or timeout', () => {
    const rejectDriverOffer = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [
        {
          bookingId: 'booking_1',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          distanceKm: 0.7,
          tripDistanceKm: 8.2,
          pickupEtaMin: 4,
          tripDurationMin: 14,
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
        },
      ],
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer,
      lastError: '',
    });

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const { getByTestId } = render(
      <RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('prototype-map-view').props.routeCoordinates).toEqual([]);
    expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
    expect(getByTestId('prototype-dismissible-sheet-backdrop').props.pointerEvents).toBe('none');

    fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    expect(rejectDriverOffer).not.toHaveBeenCalled();
  });

  it('blocks navigator removal while a paid driver offer is pending', () => {
    let beforeRemoveListener = null;
    const unsubscribe = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [
        {
          bookingId: 'booking_1',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          pricingSnapshotLocked: true,
        },
      ],
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return unsubscribe;
      }),
    };
    const screen = render(
      <RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />,
    );
    const event = { preventDefault: jest.fn() };

    expect(navigation.addListener).toHaveBeenCalledWith(
      'beforeRemove',
      expect.any(Function),
    );
    beforeRemoveListener(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
    screen.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('permits only the acknowledged driver-offer rejection action', async () => {
    let beforeRemoveListener = null;
    const rejectDriverOffer = jest.fn().mockResolvedValue({ ok: true });
    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [
        {
          bookingId: 'booking_1',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          pricingSnapshotLocked: true,
        },
      ],
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer,
      lastError: '',
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return jest.fn();
      }),
    };
    const screen = render(
      <RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />,
    );

    fireEvent.press(screen.getByTestId('driver-offer-screen-reject-button'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));

    const canonicalEvent = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    beforeRemoveListener(canonicalEvent);

    expect(rejectDriverOffer).toHaveBeenCalledWith(
      expect.any(Object),
      'Recusada pelo motorista.',
    );
    expect(canonicalEvent.preventDefault).not.toHaveBeenCalled();
    screen.unmount();
  });

  it('auto-dismisses the driver offer screen when only a stale route request remains', async () => {
    usePrototypeRideRuntime.mockReturnValue({
      driverOffers: [],
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const routeRequest = {
      bookingId: 'booking_stale',
      pickupAddress: 'Rua A, 10',
      dropoffAddress: 'Destino Teste',
      estimatedDriverNetAmount: 15.01,
      pricingSnapshotLocked: true,
      payout: 'R$ 15,01',
    };

    const screen = render(
      <RobotaxiDriverOfferScreen
        navigation={navigation}
        route={{ params: { request: routeRequest } }}
      />
    );

    expect(screen.getAllByText('Destino Teste').length).toBeGreaterThan(0);

    await waitFor(
      () => {
        expect(navigation.goBack).toHaveBeenCalled();
      },
      { timeout: 5500 }
    );
  });

  it('keeps driver trip CTAs aligned with accepted, arrived and started states', async () => {
    const acceptedRuntime = buildDriverRuntime({ bookingStatus: 'accepted' });
    usePrototypeRideRuntime.mockReturnValue(acceptedRuntime);
    const acceptedNavigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const acceptedScreen = render(
      <RobotaxiDriverTripScreen navigation={acceptedNavigation} route={{ params: {} }} />
    );

    expect(acceptedScreen.getByText('Indo buscar')).toBeTruthy();
    expect(acceptedScreen.getByText(/Preferências padrão/)).toBeTruthy();
    expect(acceptedScreen.getByLabelText('Cancelar')).toBeTruthy();
    fireEvent.press(
      acceptedScreen.getByLabelText('driver-live-primary-action-arrive-button')
    );
    await waitFor(() => expect(acceptedRuntime.markDriverArrived).toHaveBeenCalled());

    const arrivedRuntime = buildDriverRuntime({ bookingStatus: 'arrived' });
    usePrototypeRideRuntime.mockReturnValue(arrivedRuntime);
    const arrivedNavigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const arrivedScreen = render(
      <RobotaxiDriverTripScreen navigation={arrivedNavigation} route={{ params: {} }} />
    );

    expect(arrivedScreen.getByText('Código da corrida')).toBeTruthy();
    expect(arrivedScreen.queryByText(/Aguard/i)).toBeNull();
    expect(arrivedScreen.getByLabelText('Chat')).toBeTruthy();
    fireEvent.press(
      arrivedScreen.getByLabelText('driver-live-primary-action-start-button')
    );
    await waitFor(() => expect(arrivedRuntime.startTripFlow).toHaveBeenCalled());

    const backendFinalDriverReceipt = {
      ...buildReceiptRuntime().lastReceipt,
      id: 'booking_1',
      bookingId: 'booking_1',
      rideId: 'booking_1',
      tripId: 'booking_1',
      viewerRole: 'driver',
      receiptRole: 'driver',
      driverId: 'driver_1',
      passengerId: 'customer_1',
    };
    const startedRuntime = buildDriverRuntime({
      bookingStatus: 'started',
      driverActiveRide: {
        ...buildDriverRuntime().driverActiveRide,
        driverId: 'driver_1',
        passengerId: 'customer_1',
      },
      completeTripFlow: jest.fn().mockResolvedValue({
        success: true,
        receipt: backendFinalDriverReceipt,
      }),
    });
    usePrototypeRideRuntime.mockReturnValue(startedRuntime);
    const startedNavigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const startedScreen = render(
      <RobotaxiDriverTripScreen navigation={startedNavigation} route={{ params: {} }} />
    );

    expect(startedScreen.getByText('A caminho de Aeroporto Santos Dumont')).toBeTruthy();
    fireEvent.press(startedScreen.getByTestId('driver-trip-chat-button'));
    expect(startedNavigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeChat',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'driver-trip',
        bookingStatus: 'started',
      })
    );
    fireEvent.press(startedScreen.getByTestId('driver-trip-report-button'));
    expect(startedNavigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupport',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'driver-trip',
        bookingStatus: 'started',
      })
    );
    fireEvent.press(
      startedScreen.getByLabelText('driver-live-primary-action-complete-button')
    );
    await waitFor(() => {
      expect(startedRuntime.completeTripFlow).toHaveBeenCalled();
      expect(startedNavigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fare: 38.4,
          fromTrip: true,
          grossAmount: 38.4,
          receipt: expect.objectContaining({
            id: 'booking_1',
            viewerRole: 'driver',
            receiptRole: 'driver',
            driverId: 'driver_1',
            passengerId: 'customer_1',
            authoritativeSnapshot: true,
            financialSnapshotSource: 'backend_final',
          }),
          viewerRole: 'driver',
          receiptRole: 'driver',
          driverId: 'driver_1',
          passengerId: 'customer_1',
        })
      );
    });

    const receiptParams = startedNavigation.navigate.mock.calls.find(
      ([routeName]) => routeName === 'RobotaxiPrototypeReceipt',
    )?.[1];
    startedScreen.unmount();

    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'driver',
        lastReceipt: null,
        tripHistory: [],
      }),
    );
    const receiptScreen = render(
      <RobotaxiReceiptScreen
        navigation={{ navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() }}
        route={{ params: receiptParams }}
      />,
    );

    expect(receiptScreen.getByTestId('driver-receipt-rate-passenger-button').props.accessibilityState).toEqual({ disabled: false });
  });

  it('passes passenger active ride context when opening chat during an active trip', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'started' }));
    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(screen.getAllByTestId('passenger-trip-message-button')[0]);

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeChat',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );
  });

  it('passes passenger active ride context when opening cancellation during an active trip', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'accepted' }));
    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(screen.getAllByTestId('passenger-trip-cancel-button')[0]);

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeCancellation',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'accepted',
      })
    );
  });

  it('passes driver active ride context when opening cancellation during pickup', () => {
    usePrototypeRideRuntime.mockReturnValue(buildDriverRuntime({ bookingStatus: 'accepted' }));
    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(screen.getAllByTestId('driver-trip-cancel-button')[0]);

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeCancellation',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'driver-trip',
        bookingStatus: 'accepted',
      })
    );
  });

  it('uses the driver cancellation flow with scoped booking context', async () => {
    const cancelRideSearch = jest.fn();
    const cancelActiveRideFlow = jest.fn().mockResolvedValue({ success: true });
    usePrototypeRideRuntime.mockReturnValue({
      activeBookingId: null,
      bookingStatus: 'accepted',
      driverActiveRide: {
        bookingId: 'booking_driver_cancel',
        status: 'accepted',
      },
      cancelRideSearch,
      cancelActiveRideFlow,
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiCancellationScreen
        navigation={navigation}
        route={{
          key: 'driver-cancel',
          params: {
            bookingId: 'booking_driver_cancel',
            bookingStatus: 'accepted',
            source: 'driver-trip',
          },
        }}
      />
    );

    fireEvent.press(screen.getByTestId('passenger-cancellation-confirm-button'));

    await waitFor(() => {
      expect(cancelActiveRideFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking_driver_cancel',
          source: 'driver-trip',
          bookingStatus: 'accepted',
          reason: 'Cancelado pelo motorista.',
        })
      );
    });
    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('renders completed search cancellation as terminal without sending another cancel command', () => {
    const cancelRideSearch = jest.fn();
    const cancelActiveRideFlow = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      bookingStatus: 'idle',
      cancelRideSearch,
      cancelActiveRideFlow,
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiCancellationScreen
        navigation={navigation}
        route={{
          key: 'search-cancelled',
          params: {
            bookingId: 'booking_search_cancelled',
            bookingStatus: 'canceled',
            completed: true,
            source: 'search',
          },
        }}
      />
    );

    expect(screen.getByText('Corrida cancelada')).toBeTruthy();
    expect(screen.queryByText('Continuar corrida')).toBeNull();

    fireEvent.press(screen.getByTestId('passenger-cancellation-confirm-button'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(cancelActiveRideFlow).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('treats completed cancellation aliases as terminal without sending another cancel command', () => {
    const cancelRideSearch = jest.fn();
    const cancelActiveRideFlow = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeBookingId: 'booking_completed_alias',
      bookingStatus: 'trip_completed',
      cancelRideSearch,
      cancelActiveRideFlow,
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiCancellationScreen
        navigation={navigation}
        route={{
          key: 'trip-completed-cancellation-alias',
          params: {
            bookingId: 'booking_completed_alias',
            bookingStatus: 'trip_completed',
            source: 'passenger-trip',
          },
        }}
      />
    );

    expect(screen.getByText('Corrida encerrada')).toBeTruthy();

    fireEvent.press(screen.getByTestId('passenger-cancellation-confirm-button'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(cancelActiveRideFlow).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('never dismisses terminal cancellation back to a previous active ride surface', () => {
    const cancelRideSearch = jest.fn();
    const cancelActiveRideFlow = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeBookingId: 'booking_terminal_cancel',
      bookingStatus: 'completed',
      cancelRideSearch,
      cancelActiveRideFlow,
    });
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiCancellationScreen
        navigation={navigation}
        route={{
          key: 'terminal-cancellation-dismiss',
          params: {
            bookingId: 'booking_terminal_cancel',
            bookingStatus: 'completed',
            source: 'passenger-trip',
          },
        }}
      />
    );

    fireEvent.press(screen.getByTestId('prototype-dismissible-sheet-backdrop-pressable'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(cancelActiveRideFlow).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('shows chat load failures as an error state instead of an empty conversation', async () => {
    const loadChatSession = jest.fn().mockRejectedValue(new Error('socket down'));
    usePrototypeRideRuntime.mockReturnValue({
      loadChatSession,
      sendChatMessage: jest.fn(),
      chatMessages: [],
      chatLoading: false,
      chatSending: false,
      chatError: 'Serviço de chat indisponível.',
    });

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiChatScreen
        navigation={navigation}
        route={{
          key: 'chat-test',
          params: {
            bookingId: 'booking_1',
            bookingStatus: 'started',
            source: 'passenger-trip',
          },
        }}
      />
    );

    expect(loadChatSession).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );

    expect(screen.getByTestId('prototype-chat-error-state')).toBeTruthy();
    expect(screen.getByText('Serviço de chat indisponível.')).toBeTruthy();
    expect(screen.queryByText('Sem mensagens para esta corrida.')).toBeNull();

    fireEvent.press(screen.getByTestId('prototype-chat-retry-button'));

    await waitFor(() => {
      expect(loadChatSession).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking_1',
          forceReload: true,
          source: 'passenger-trip',
        })
      );
    });

    fireEvent.press(screen.getByLabelText('robotaxi-chat-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );
  });

  it('routes completed chat aliases back to receipt with canonical status', () => {
    const loadChatSession = jest.fn().mockResolvedValue({ messages: [] });
    usePrototypeRideRuntime.mockReturnValue({
      loadChatSession,
      sendChatMessage: jest.fn(),
      chatMessages: [],
      chatLoading: false,
      chatSending: false,
      chatError: '',
    });

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiChatScreen
        navigation={navigation}
        route={{
          key: 'chat-completed-alias',
          params: {
            bookingId: 'booking_1',
            bookingStatus: 'trip_completed',
            source: 'passenger-trip',
          },
        }}
      />
    );

    expect(loadChatSession).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'completed',
      })
    );

    fireEvent.press(screen.getByLabelText('robotaxi-chat-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'completed',
      })
    );
  });

  it('labels a driver trip gross fallback as bruto instead of líquido', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverActiveRide: {
          bookingId: 'booking_gross_only',
          status: 'started',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          fare: 38.4,
          grossFare: 38.4,
          destinationCoordinate: { latitude: -22.9, longitude: -43.17 },
        },
        selectedFare: 38.4,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(screen.getAllByText('R$ 38,40').length).toBeGreaterThan(0);
    expect(screen.getByText('bruto')).toBeTruthy();
    expect(screen.queryByText('líquido')).toBeNull();
  });

  it.each(['accepted', 'driver_arrived', 'arrived', 'trip_started', 'started', 'operational_interrupted', 'searching_replacement'])(
    'keeps driver trip state %s from regressing through sheet backdrop actions',
    (bookingStatus) => {
      usePrototypeRideRuntime.mockReturnValue(buildDriverRuntime({ bookingStatus }));

      const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
      const { getByTestId } = render(
        <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />
      );

      expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
      expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
      expect(getByTestId('prototype-dismissible-sheet-backdrop').props.pointerEvents).toBe('none');

      fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    }
  );

  it('keeps driver active trip visible when rehydrated from activeBooking with an active alias status', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'in_trip',
        activeBookingId: 'booking_driver_alias_only',
        activeBooking: {
          bookingId: 'booking_driver_alias_only',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          destinationCoordinate: { latitude: -22.9, longitude: -43.17 },
        },
        driverActiveRide: null,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />,
    );

    expect(screen.queryByText('Nenhuma corrida ativa')).toBeNull();
    expect(screen.getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(screen.getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
  });

  it('keeps a protected driver trip fail-visible when active status arrives without booking identity', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'trip_started',
        activeBookingId: null,
        activeBooking: null,
        driverActiveRide: null,
        driverTripMeta: null,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />,
    );

    expect(screen.getByTestId('driver-trip-missing-identity-title')).toBeTruthy();
    expect(screen.getByText('Sincronizando corrida')).toBeTruthy();
    expect(screen.queryByText('Nenhuma corrida ativa')).toBeNull();
    expect(screen.getByTestId('driver-trip-missing-identity-button').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(screen.getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);

    fireEvent.press(screen.getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('keeps a protected passenger trip fail-visible when active status arrives without ride identity', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'trip_started',
        activeBookingId: null,
        activeBooking: null,
        driverActiveRide: null,
        driverInfo: null,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />,
    );

    expect(screen.getByTestId('passenger-trip-missing-identity-title')).toBeTruthy();
    expect(screen.getByText('Validando dados do motorista')).toBeTruthy();
    expect(screen.queryByTestId('passenger-trip-driver-identity')).toBeNull();
    expect(screen.queryByTestId('passenger-trip-message-button')).toBeNull();
    expect(screen.queryByTestId('passenger-trip-cancel-button')).toBeNull();
    expect(screen.getByTestId('passenger-trip-missing-identity-button').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(screen.getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);

    fireEvent.press(screen.getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('does not regress the driver trip surface when the ride payload status is stale', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverActiveRide: {
          bookingId: 'booking_started_with_stale_payload',
          status: 'accepted',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          destinationCoordinate: { latitude: -22.9, longitude: -43.17 },
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />,
    );

    expect(screen.getByText('A caminho de Aeroporto Santos Dumont')).toBeTruthy();
    expect(screen.getByTestId('driver-trip-route-progress')).toBeTruthy();
    expect(screen.getByLabelText('driver-live-primary-action-complete-button')).toBeTruthy();
    expect(screen.queryByLabelText('driver-live-primary-action-arrive-button')).toBeNull();
  });

  it.each(['accepted', 'arrived', 'started', 'operational_interrupted', 'searching_replacement'])(
    'blocks navigator removal while the driver trip is %s',
    (bookingStatus) => {
      let beforeRemoveListener = null;
      const unsubscribe = jest.fn();
      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => true),
        goBack: jest.fn(),
        addListener: jest.fn((eventName, listener) => {
          if (eventName === 'beforeRemove') {
            beforeRemoveListener = listener;
          }
          return unsubscribe;
        }),
      };
      usePrototypeRideRuntime.mockReturnValue(
        buildDriverRuntime({ bookingStatus }),
      );

      const screen = render(
        <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />,
      );
      const event = { preventDefault: jest.fn() };

      expect(navigation.addListener).toHaveBeenCalledWith(
        'beforeRemove',
        expect.any(Function),
      );
      expect(beforeRemoveListener).toEqual(expect.any(Function));
      beforeRemoveListener(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(navigation.goBack).not.toHaveBeenCalled();
      screen.unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['operational_interrupted', 'Corrida interrompida'],
    ['searching_replacement', 'Continuidade em andamento'],
  ])(
    'keeps the driver on a protected holding surface during %s',
    (bookingStatus, expectedTitle) => {
      usePrototypeRideRuntime.mockReturnValue(
        buildDriverRuntime({
          bookingStatus,
          operationalContinuation: {
            message: 'Aguardando a confirmação canônica da corrida.',
          },
        }),
      );
      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => true),
        goBack: jest.fn(),
      };

      const screen = render(
        <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />,
      );

      expect(screen.getByTestId('driver-trip-operational-hold-title')).toHaveTextContent(expectedTitle);
      expect(screen.getByText('Aguardando a confirmação canônica da corrida.')).toBeTruthy();
      expect(screen.getByTestId('driver-trip-operational-hold-button').props.accessibilityState.disabled).toBe(true);
      expect(screen.queryByText('Nenhuma corrida ativa')).toBeNull();
      expect(screen.getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
      expect(screen.getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
    },
  );

  it('moves the passenger trip surface to receipt when the trip is completed', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'completed' }));

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fare: 38.4,
          fromTrip: true,
          grossAmount: 38.4,
        }),
      );
    });
  });

  it('moves the passenger trip surface to receipt when completion arrives as an alias', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'TRIP_COMPLETED' }));

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fare: 38.4,
          fromTrip: true,
          grossAmount: 38.4,
        }),
      );
    });
  });

  it('replaces the completed driver trip surface with its receipt', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({ bookingStatus: 'completed' }),
    );
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fromTrip: true,
        }),
      );
      expect(navigation.navigate).not.toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.any(Object),
      );
    });
  });

  it('replaces the completed driver trip surface with its receipt when completion arrives as an alias', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({ bookingStatus: 'early_ended_by_rider' }),
    );
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fromTrip: true,
        }),
      );
    });
  });

  it('keeps the active passenger trip sheet from dismissing back to map-only state', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'started' }));

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);

    fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it.each(['accepted', 'arrived', 'started', 'operational_interrupted', 'searching_replacement'])(
    'keeps passenger trip state %s from regressing when the map itself is tapped',
    (bookingStatus) => {
      usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus }));

      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => true),
        goBack: jest.fn(),
      };
      const screen = render(
        <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />
      );

      fireEvent.press(screen.getByTestId('prototype-map-view'));

      expect(screen.getByLabelText('passenger-trip-screen')).toBeTruthy();
      expect(screen.queryByTestId('passenger-home-destination-input')).toBeNull();
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.replace).not.toHaveBeenCalledWith(
        'RobotaxiPrototype',
        expect.any(Object),
      );
    }
  );

  it('shows a passenger ride sync warning without dismissing the active trip surface', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'started',
        rideLocalSync: {
          status: 'pending',
          bookingId: 'booking_1',
          pendingEventType: 'complete_trip',
          message: 'Aguardando confirmação do servidor.',
        },
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByTestId('passenger-trip-local-sync-pill')).toBeTruthy();
    expect(screen.getByText('Atualização pendente')).toBeTruthy();
    expect(screen.getByLabelText('passenger-trip-screen')).toBeTruthy();
  });

  it('shows a passenger driver signal warning without dismissing the active trip surface', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'started',
        driverLocationHeartbeat: {
          bookingId: 'booking_1',
          lastReceivedAt: Date.now() - 76000,
          stale: true,
          ageSeconds: 76,
        },
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByTestId('passenger-trip-driver-signal-pill')).toBeTruthy();
    expect(screen.getByText('Sinal do motorista instável')).toBeTruthy();
    expect(screen.getByText('Última localização há 1 min. Mantendo o último ponto confirmado.')).toBeTruthy();
    expect(screen.getByLabelText('passenger-trip-screen')).toBeTruthy();
  });

  it('shows a driver ride sync warning on an active lifecycle state', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'arrived',
        rideLocalSync: {
          status: 'offline',
          bookingId: 'booking_1',
          message: 'Sem conexão. Mantendo o último estado confirmado da corrida.',
        },
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByTestId('driver-trip-local-sync-pill')).toBeTruthy();
    expect(screen.getByText('Sem conexão')).toBeTruthy();
    expect(screen.getByLabelText('driver-live-trip-screen')).toBeTruthy();
  });

  it('keeps the driver active trip surface during partial ride rehydration', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        activeBookingId: 'booking_partial',
        driverActiveRide: null,
        activeBooking: {
          bookingId: 'booking_partial',
          pickupAddress: 'Rua A, 10',
          dropoffAddress: 'Aeroporto Santos Dumont',
          customerName: 'Passageira Leaf',
          grossFare: 38.4,
          estimatedDriverNetAmount: 31.8,
          tripDistanceKm: 8.2,
          tripDurationMin: 14,
        },
        selectedDestination: {
          name: 'Aeroporto Santos Dumont',
          coordinate: { latitude: -22.9, longitude: -43.17 },
        },
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByLabelText('driver-live-trip-screen')).toBeTruthy();
    expect(screen.queryByText('Nenhuma corrida ativa')).toBeNull();
    expect(screen.getByText('A caminho de Aeroporto Santos Dumont')).toBeTruthy();
    expect(screen.getByLabelText('driver-live-primary-action-complete-button')).toBeTruthy();
    expect(screen.getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(screen.getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
  });

  it.each(['accepted', 'arrived', 'started'])(
    'keeps passenger trip state %s from regressing through sheet backdrop actions',
    (bookingStatus) => {
      usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus }));

      const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
      const { getByTestId } = render(
        <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />
      );

      expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
      expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);
      expect(getByTestId('prototype-dismissible-sheet-backdrop').props.pointerEvents).toBe('none');

      fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    }
  );

  it.each(['accepted', 'arrived', 'started', 'operational_interrupted', 'searching_replacement'])(
    'blocks navigator removal while the passenger trip is %s',
    (bookingStatus) => {
      let beforeRemoveListener = null;
      const unsubscribe = jest.fn();
      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => true),
        goBack: jest.fn(),
        addListener: jest.fn((eventName, listener) => {
          if (eventName === 'beforeRemove') {
            beforeRemoveListener = listener;
          }
          return unsubscribe;
        }),
      };
      usePrototypeRideRuntime.mockReturnValue(
        buildPassengerRuntime({ bookingStatus }),
      );

      const screen = render(
        <RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />,
      );
      const event = { preventDefault: jest.fn() };

      expect(navigation.addListener).toHaveBeenCalledWith(
        'beforeRemove',
        expect.any(Function),
      );
      expect(beforeRemoveListener).toEqual(expect.any(Function));
      beforeRemoveListener(event);

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(navigation.goBack).not.toHaveBeenCalled();
      screen.unmount();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    },
  );

  it('renders the passenger trip as a compact summary while the driver is on the way', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'accepted' }));

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByLabelText('passenger-trip-compact-summary')).toBeTruthy();
    expect(screen.getByText('14 min até chegar')).toBeTruthy();
    expect(screen.getByText('Motorista está a caminho')).toBeTruthy();
    expect(screen.getByText('Motorista Leaf')).toBeTruthy();
    expect(screen.getByText('LEF-2042')).toBeTruthy();
    expect(screen.getByText('Leaf Plus')).toBeTruthy();
    expect(screen.getByText('Cor não informada')).toBeTruthy();
    expect(screen.getByText('8 km até o embarque')).toBeTruthy();
    expect(screen.getByText('Rua A, 10')).toBeTruthy();
    expect(screen.getByText('Aeroporto Santos Dumont')).toBeTruthy();
    expect(screen.getByLabelText('Mensagem')).toBeTruthy();
    expect(screen.getByLabelText('Ligar')).toBeTruthy();
    expect(screen.getByText('Compartilhar')).toBeTruthy();
    expect(screen.getByLabelText('Cancelar corrida')).toBeTruthy();
    expect(screen.queryByText('Cancelar corrida')).toBeNull();
  });

  it.each(['accepted', 'arrived', 'started', 'operational_interrupted', 'searching_replacement'])(
    'keeps the active passenger map interactive and padded above the sheet in %s',
    (bookingStatus) => {
      const shortRouteCoordinates = [
        { latitude: -22.881, longitude: -43.343 },
        { latitude: -22.8825, longitude: -43.345 },
      ];
      usePrototypeRideRuntime.mockReturnValue(
        buildPassengerRuntime({
          bookingStatus,
          activeBooking: {
            driverDistanceToPickupKm: 0.7,
            estimatedArrivalToPickupMin: 4,
            driverToPickupRouteCoordinates: shortRouteCoordinates,
            routeCoordinates: shortRouteCoordinates,
          },
        }),
      );

      const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
      const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
      const mapWidth = 360;
      const mapHeight = 640;
      const mapView = screen.getByTestId('prototype-map-view');
      fireEvent(mapView, 'layout', {
        nativeEvent: { layout: { width: mapWidth, height: mapHeight } },
      });
      const measuredMapView = screen.getByTestId('prototype-map-view');

      expect(measuredMapView.props.scrollEnabled).toBe(true);
      expect(measuredMapView.props.zoomEnabled).toBe(true);
      expect(measuredMapView.props.rotateEnabled).toBe(true);
      expect(measuredMapView.props.mapPadding.top).toBeGreaterThanOrEqual(128);
      expect(measuredMapView.props.mapPadding.bottom).toBeGreaterThanOrEqual(392);
      expectRouteInsideVisibleMapViewport({
        coordinates: shortRouteCoordinates,
        mapView: measuredMapView,
        mapWidth,
        mapHeight,
      });
	    }
	  );

  it('caps tall active passenger sheets before they can hide the route viewport', () => {
    const shortRouteCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.8825, longitude: -43.345 },
    ];
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'operational_interrupted',
        activeBooking: {
          bookingId: 'booking_passenger_tall_sheet',
          routeCoordinates: shortRouteCoordinates,
        },
        operationalContinuation: {
          status: 'passenger_decision_pending',
          bookingId: 'booking_passenger_tall_sheet',
          message: 'Aguardando decisão do passageiro.',
        },
      }),
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    const mapWidth = 360;
    const mapHeight = 640;
    const mapView = screen.getByTestId('prototype-map-view');
    fireEvent(mapView, 'layout', {
      nativeEvent: { layout: { width: mapWidth, height: mapHeight } },
    });
    fireEvent(screen.getByTestId('passenger-trip-screen'), 'layout', {
      nativeEvent: { layout: { width: mapWidth, height: 560 } },
    });

    const measuredMapView = screen.getByTestId('prototype-map-view');
    expect(measuredMapView.props.mapPadding.bottom).toBeLessThanOrEqual(420);
    expectRouteInsideVisibleMapViewport({
      coordinates: shortRouteCoordinates,
      mapView: measuredMapView,
      mapWidth,
      mapHeight,
    });
  });

  it('does not render a synthetic active passenger route while waiting for canonical route coordinates', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        currentCoordinate: { latitude: -22.881, longitude: -43.343 },
        driverInfo: {
          id: 'driver_1',
          name: 'Motorista Leaf',
          coordinate: { latitude: -22.882, longitude: -43.344 },
        },
        activeBooking: {
          pickupLocation: { latitude: -22.883, longitude: -43.345 },
          driverDistanceToPickupKm: 0.7,
          estimatedArrivalToPickupMin: 4,
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    const mapView = screen.getByTestId('prototype-map-view');

    expect(mapView.props.routeCoordinates).toEqual([]);
    expect(mapView.props.routeViewportRegion).toBeNull();
    expect(mapView.props.showTraffic).toBe(false);
  });

  it('passes canonical traffic-colored route segments to the active passenger map', () => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.882, longitude: -43.344 },
      { latitude: -22.883, longitude: -43.345 },
    ];
    const routeTrafficSegments = [
      {
        level: 'moderate',
        color: '#F59E0B',
        coordinates: [routeCoordinates[0], routeCoordinates[1]],
      },
      {
        level: 'heavy',
        color: '#DC2626',
        coordinates: [routeCoordinates[1], routeCoordinates[2]],
      },
    ];
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        activeBooking: {
          driverToPickupRouteCoordinates: routeCoordinates,
          driverToPickupTrafficSegments: routeTrafficSegments,
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    const mapView = screen.getByTestId('prototype-map-view');

    expect(mapView.props.routeCoordinates).toEqual(routeCoordinates);
    expect(mapView.props.routeTrafficSegments).toEqual(routeTrafficSegments);
    expect(mapView.props.showTraffic).toBe(true);
    expect(mapView.props.routeViewportRegion).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
  });

  it('keeps the paid driver offer route inside the visible map viewport above the sheet', () => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.887, longitude: -43.331 },
      { latitude: -22.893, longitude: -43.32 },
    ];
    usePrototypeRideRuntime.mockReturnValue({
      currentCoordinate: routeCoordinates[0],
      driverCoordinate: routeCoordinates[0],
      driverOffers: [
        {
          bookingId: 'booking_offer_route',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          pickupCoordinate: routeCoordinates[routeCoordinates.length - 1],
          pickupRouteCoordinates: routeCoordinates,
          distanceKm: 0.7,
          tripDistanceKm: 8.2,
          pickupEtaMin: 4,
          tripDurationMin: 14,
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
        },
      ],
      driverTripMeta: {},
      profile: {},
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />);
    const mapView = screen.getByTestId('prototype-map-view');

    expect(mapView.props.routeCoordinates).toEqual(routeCoordinates);
    expect(mapView.props.routeViewportRegion).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
    expect(mapView.props.mapPadding.top).toBeGreaterThanOrEqual(118);
    expect(mapView.props.mapPadding.bottom).toBeGreaterThan(300);
    expect(mapView.props.scrollEnabled).toBe(false);
  });

  it('recalculates the paid driver offer route viewport from the measured map layout', () => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.887, longitude: -43.331 },
      { latitude: -22.893, longitude: -43.32 },
    ];
    usePrototypeRideRuntime.mockReturnValue({
      currentCoordinate: routeCoordinates[0],
      driverCoordinate: routeCoordinates[0],
      driverOffers: [
        {
          bookingId: 'booking_offer_measured_route',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
          pickupCoordinate: routeCoordinates[routeCoordinates.length - 1],
          pickupRouteCoordinates: routeCoordinates,
          distanceKm: 0.7,
          tripDistanceKm: 8.2,
          pickupEtaMin: 4,
          tripDurationMin: 14,
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
        },
      ],
      driverTripMeta: {},
      profile: {},
      acceptDriverOffer: jest.fn(),
      rejectDriverOffer: jest.fn(),
      lastError: '',
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiDriverOfferScreen navigation={navigation} route={{ params: {} }} />);
    const initialMapView = screen.getByTestId('prototype-map-view');
    const initialViewportRegion = initialMapView.props.routeViewportRegion;

    fireEvent(initialMapView, 'layout', {
      nativeEvent: { layout: { width: 360, height: 640 } },
    });

    const measuredMapView = screen.getByTestId('prototype-map-view');
    expect(measuredMapView.props.routeViewportRegion).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
    expect(measuredMapView.props.routeViewportRegion).not.toEqual(initialViewportRegion);
    expect(measuredMapView.props.mapPadding.bottom).toBeGreaterThanOrEqual(356);
    expectRouteInsideVisibleMapViewport({
      coordinates: routeCoordinates,
      mapView: measuredMapView,
      mapWidth: 360,
      mapHeight: 640,
    });
  });

  it('restores the driver in-trip map with canonical route viewport and traffic segments', () => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.887, longitude: -43.331 },
      { latitude: -22.9, longitude: -43.17 },
    ];
    const routeTrafficSegments = [
      {
        level: 'moderate',
        color: '#F59E0B',
        coordinates: [routeCoordinates[0], routeCoordinates[1]],
      },
      {
        level: 'heavy',
        color: '#DC2626',
        coordinates: [routeCoordinates[1], routeCoordinates[2]],
      },
    ];
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        currentCoordinate: routeCoordinates[0],
        driverCoordinate: routeCoordinates[0],
        driverActiveRide: {
          bookingId: 'booking_driver_route',
          status: 'started',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          destinationCoordinate: routeCoordinates[routeCoordinates.length - 1],
          routeCoordinates,
          routeTrafficSegments,
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
        },
        selectedDestination: {
          name: 'Mercadão de Madureira',
          coordinate: routeCoordinates[routeCoordinates.length - 1],
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    const mapView = screen.getByTestId('prototype-map-view');

    expect(mapView.props.routeCoordinates).toEqual(routeCoordinates);
    expect(mapView.props.routeTrafficSegments).toEqual(routeTrafficSegments);
    expect(mapView.props.showTraffic).toBe(true);
    expect(mapView.props.routeViewportRegion).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
    expect(mapView.props.mapPadding.top).toBeGreaterThanOrEqual(118);
    expect(mapView.props.mapPadding.bottom).toBeGreaterThan(300);
    expect(mapView.props.scrollEnabled).toBe(true);
    expect(screen.getByTestId('driver-trip-route-progress')).toBeTruthy();
  });

  it.each(['accepted', 'arrived'])(
    'keeps the driver-to-pickup route interactive, traffic-colored, and fitted above the sheet in %s',
    (bookingStatus) => {
      const pickupRouteCoordinates = [
        { latitude: -22.881, longitude: -43.343 },
        { latitude: -22.887, longitude: -43.331 },
        { latitude: -22.893, longitude: -43.32 },
      ];
      const pickupTrafficSegments = [
        {
          level: 'moderate',
          color: '#F59E0B',
          coordinates: [pickupRouteCoordinates[0], pickupRouteCoordinates[1]],
        },
        {
          level: 'heavy',
          color: '#DC2626',
          coordinates: [pickupRouteCoordinates[1], pickupRouteCoordinates[2]],
        },
      ];
      usePrototypeRideRuntime.mockReturnValue(
        buildDriverRuntime({
          bookingStatus,
          currentCoordinate: pickupRouteCoordinates[0],
          driverCoordinate: pickupRouteCoordinates[0],
          driverActiveRide: {
            bookingId: 'booking_driver_pickup_route',
            status: bookingStatus,
            pickupAddress: 'Carioca Shopping',
            dropoffAddress: 'Mercadão de Madureira',
            pickupCoordinate: pickupRouteCoordinates[pickupRouteCoordinates.length - 1],
            pickupRouteCoordinates,
            driverToPickupTrafficSegments: pickupTrafficSegments,
            fare: 38.4,
            estimatedDriverNetAmount: 31.8,
          },
        }),
      );

      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => false),
        goBack: jest.fn(),
      };
      const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
      const mapView = screen.getByTestId('prototype-map-view');
      fireEvent(mapView, 'layout', {
        nativeEvent: { layout: { width: 360, height: 640 } },
      });

      const measuredMapView = screen.getByTestId('prototype-map-view');
      expect(measuredMapView.props.routeCoordinates).toEqual(pickupRouteCoordinates);
      expect(measuredMapView.props.routeTrafficSegments).toEqual(pickupTrafficSegments);
      expect(measuredMapView.props.showTraffic).toBe(true);
      expect(measuredMapView.props.scrollEnabled).toBe(true);
      expect(measuredMapView.props.zoomEnabled).toBe(true);
      expect(measuredMapView.props.mapPadding.top).toBeGreaterThanOrEqual(118);
      expect(measuredMapView.props.mapPadding.bottom).toBeGreaterThan(300);
      expectRouteInsideVisibleMapViewport({
        coordinates: pickupRouteCoordinates,
        mapView: measuredMapView,
        mapWidth: 360,
        mapHeight: 640,
      });
    },
  );

  it.each(['started', 'operational_interrupted', 'searching_replacement'])(
    'recalculates the active driver trip route viewport from the measured map layout in %s',
    (bookingStatus) => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.887, longitude: -43.331 },
      { latitude: -22.9, longitude: -43.17 },
    ];
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus,
        currentCoordinate: routeCoordinates[0],
        driverCoordinate: routeCoordinates[0],
        driverActiveRide: {
          bookingId: 'booking_driver_measured_route',
          status: bookingStatus,
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          destinationCoordinate: routeCoordinates[routeCoordinates.length - 1],
          routeCoordinates,
          routeTrafficSegments: [],
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
        },
        selectedDestination: {
          name: 'Mercadão de Madureira',
          coordinate: routeCoordinates[routeCoordinates.length - 1],
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    const initialMapView = screen.getByTestId('prototype-map-view');
    const initialViewportRegion = initialMapView.props.routeViewportRegion;

    fireEvent(initialMapView, 'layout', {
      nativeEvent: { layout: { width: 360, height: 640 } },
    });

    const measuredMapView = screen.getByTestId('prototype-map-view');
    expect(measuredMapView.props.routeViewportRegion).toEqual(expect.objectContaining({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    }));
    expect(measuredMapView.props.routeViewportRegion).not.toEqual(initialViewportRegion);
    expect(measuredMapView.props.mapPadding.bottom).toBeGreaterThanOrEqual(318);
    expect(measuredMapView.props.scrollEnabled).toBe(true);
    expectRouteInsideVisibleMapViewport({
      coordinates: routeCoordinates,
      mapView: measuredMapView,
      mapWidth: 360,
      mapHeight: 640,
    });
    }
	  );

  it('caps tall active driver sheets before they can hide the route viewport', () => {
    const routeCoordinates = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.887, longitude: -43.331 },
      { latitude: -22.9, longitude: -43.17 },
    ];
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        currentCoordinate: routeCoordinates[0],
        driverCoordinate: routeCoordinates[0],
        driverActiveRide: {
          bookingId: 'booking_driver_tall_sheet',
          status: 'started',
          pickupAddress: 'Carioca Shopping',
          dropoffAddress: 'Mercadão de Madureira',
          destinationCoordinate: routeCoordinates[routeCoordinates.length - 1],
          routeCoordinates,
          fare: 38.4,
          estimatedDriverNetAmount: 31.8,
        },
        selectedDestination: {
          name: 'Mercadão de Madureira',
          coordinate: routeCoordinates[routeCoordinates.length - 1],
        },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />);
    const mapWidth = 360;
    const mapHeight = 640;
    const mapView = screen.getByTestId('prototype-map-view');
    fireEvent(mapView, 'layout', {
      nativeEvent: { layout: { width: mapWidth, height: mapHeight } },
    });
    fireEvent(screen.getByTestId('driver-live-trip-screen'), 'layout', {
      nativeEvent: { layout: { width: mapWidth, height: 560 } },
    });

    const measuredMapView = screen.getByTestId('prototype-map-view');
    expect(measuredMapView.props.mapPadding.bottom).toBeLessThanOrEqual(420);
    expectRouteInsideVisibleMapViewport({
      coordinates: routeCoordinates,
      mapView: measuredMapView,
      mapWidth,
      mapHeight,
    });
  });

  it('keeps the started passenger trip compact with visible route progress and icon-only actions', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'started' }));

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByLabelText('passenger-trip-compact-summary')).toBeTruthy();
    const mapView = screen.getByTestId('prototype-map-view');
    expect(mapView.props.scrollEnabled).toBe(true);
    expect(mapView.props.zoomEnabled).toBe(true);
    expect(mapView.props.rotateEnabled).toBe(true);
    expect(mapView.props.mapPadding.top).toBeGreaterThanOrEqual(128);
    expect(mapView.props.mapPadding.bottom).toBeGreaterThanOrEqual(420);
    expect(screen.getByTestId('passenger-trip-route-progress')).toBeTruthy();
    expect(screen.getByTestId('passenger-trip-started-action-dock')).toBeTruthy();
    expect(screen.getByLabelText('Chat')).toBeTruthy();
    expect(screen.getByLabelText('Compartilhar')).toBeTruthy();
    expect(screen.getByLabelText('Alterar destino')).toBeTruthy();
    expect(screen.getByLabelText('Encerrar agora')).toBeTruthy();
    expect(screen.queryByLabelText('passenger-trip-collapse-button')).toBeNull();
    expect(screen.getByLabelText('passenger-trip-screen')).toBeTruthy();
    expect(screen.queryByText('Chat')).toBeNull();
    expect(screen.queryByText('Suporte')).toBeNull();
    expect(screen.queryByText('Compartilhar')).toBeNull();
    expect(screen.queryByText('Alterar destino')).toBeNull();
    expect(screen.queryByText('Encerrar agora')).toBeNull();

    fireEvent.press(screen.getByTestId('passenger-trip-support-button'));
    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupport',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );
  });

  it('hydrates accepted passenger vehicle and pickup ETA from active ride aliases', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
        activeBooking: {
          driverDistanceToPickupKm: 0.42,
          estimatedArrivalToPickupMin: 3,
          driver: {
            vehicle: {
              model: 'Honda City',
              plate: 'RJA2D41',
              color: 'Branco',
            },
          },
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByText('3 min até o embarque')).toBeTruthy();
    expect(screen.getByText('420 m até o embarque')).toBeTruthy();
    expect(screen.getByText('RJA2D41')).toBeTruthy();
    expect(screen.getByText('Honda City')).toBeTruthy();
    expect(screen.getByText('Branco')).toBeTruthy();
    expect(screen.queryByText('Placa pendente')).toBeNull();
    expect(screen.queryByText('Cor não informada')).toBeNull();
  });

  it('uses pickup ETA instead of the full trip distance when pickup distance is unavailable', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        tripDistanceKm: 8,
        activeBooking: {
          estimatedArrivalToPickupMin: 3,
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getAllByText('3 min até o embarque').length).toBeGreaterThan(0);
    expect(screen.queryByText('8 km até o embarque')).toBeNull();
  });

  it('updates passenger boarding timer copy as pickup urgency changes', () => {
    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'arrived', boardingRemainingSec: 90 }));
    const activeTimer = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expect(activeTimer.getByText('Motorista chegou')).toBeTruthy();
    expect(activeTimer.getAllByText('1:30').length).toBeGreaterThan(0);
    expect(activeTimer.getByText('Prossiga para o embarque')).toBeTruthy();
    activeTimer.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'arrived', boardingRemainingSec: 25 }));
    const urgentTimer = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expect(urgentTimer.getAllByText('0:25').length).toBeGreaterThan(0);
    expect(urgentTimer.getByText('Embarque urgente')).toBeTruthy();
    urgentTimer.unmount();

    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'arrived', boardingRemainingSec: 0 }));
    const expiredTimer = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);
    expect(expiredTimer.getAllByText('0:00').length).toBeGreaterThan(0);
    expect(expiredTimer.getByText('Uma taxa poderá ser aplicada')).toBeTruthy();
  });

  it('opens rating from the passenger receipt with the real trip payload', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildReceiptRuntime());

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { getByTestId, getByText, queryByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Corrida concluída')).toBeTruthy();
    expect(getByText('Detalhes do valor')).toBeTruthy();
    expect(getByText('Motorista')).toBeTruthy();
    expect(getByText('Motorista Leaf')).toBeTruthy();
    expect(getByText('Avaliar viagem')).toBeTruthy();
    expect(getByText('Veículo não informado')).toBeTruthy();
    expect(getByText('Placa não informada')).toBeTruthy();
    expect(queryByText('Honda City branco · 4,9')).toBeNull();
    expect(queryByText('RJA2D41')).toBeNull();

    fireEvent.press(getByTestId('passenger-receipt-rate-trip-button'));

    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.objectContaining({
        fromReceipt: true,
        reviewerType: 'passenger',
        tripId: 'trip_1',
        targetUserId: 'driver_1',
      })
    );
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.any(Object)
    );
  });

  it('renders canonical vehicle model, color and plate on the passenger receipt', () => {
    const baseRuntime = buildReceiptRuntime();
    const receiptWithVehicle = {
      ...baseRuntime.lastReceipt,
      vehicleLabel: 'Honda City',
      vehicleColor: 'BRANCO',
      vehiclePlate: 'RJA2D41',
    };
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        lastReceipt: receiptWithVehicle,
        tripHistory: [receiptWithVehicle],
      })
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('passenger-receipt-vehicle-model-color').props.children).toBe(
      'Honda City · BRANCO'
    );
    expect(getByTestId('passenger-receipt-vehicle-plate').props.children).toBe('RJA2D41');
  });

  it('uses receipt owner scope instead of stale activeRole when selecting receipt surface', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'driver',
        profileUid: 'customer_1',
        profile: { uid: 'customer_1' },
      })
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, getByText, queryByTestId, queryByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('passenger-receipt-screen')).toBeTruthy();
    expect(queryByTestId('driver-receipt-screen')).toBeNull();
    expect(getByText('Total pago')).toBeTruthy();
    expect(getByText('Avaliar viagem')).toBeTruthy();
    expect(queryByText('Valor recebido')).toBeNull();
    expect(queryByTestId('driver-receipt-rate-passenger-button')).toBeNull();
  });

  it('keeps passenger rating available when the completed receipt is missing driverId but runtime still has it', () => {
    const fallbackDriverId = 'driver_fallback_1';
    const completedReceiptWithoutDriverId = {
      ...buildReceiptRuntime().lastReceipt,
      id: 'trip_without_driver_id',
      driverId: null,
      driverName: 'Motorista Leaf',
    };
    const previousReceiptWithDriverId = {
      ...buildReceiptRuntime().lastReceipt,
      id: 'trip_previous_with_driver_id',
      driverId: fallbackDriverId,
      driverName: 'Motorista Leaf',
    };

    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        lastReceipt: completedReceiptWithoutDriverId,
        tripHistory: [previousReceiptWithDriverId],
        driverInfo: { id: fallbackDriverId, name: 'Motorista Leaf' },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
	    const { getAllByText, getByTestId, getByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );
    const rateButton = getByTestId('passenger-receipt-rate-trip-button');

    expect(getByText('Avaliar viagem')).toBeTruthy();
    expect(rateButton.props.accessibilityState?.disabled).toBe(false);
    expect(rateButton.props.disabled).not.toBe(true);

    fireEvent.press(rateButton);

    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.objectContaining({
        fromReceipt: true,
        reviewerType: 'passenger',
        tripId: 'trip_without_driver_id',
        targetUserId: fallbackDriverId,
      })
    );
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.any(Object)
    );
  });

  it('removes an inactive passenger receipt from the Android accessibility tree', () => {
    require('@react-navigation/native').useIsFocused.mockReturnValue(false);
    usePrototypeRideRuntime.mockReturnValue(buildReceiptRuntime());

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { queryByTestId, UNSAFE_getByProps } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );
    const receipt = UNSAFE_getByProps({ testID: 'passenger-receipt-screen' });

    expect(queryByTestId('passenger-receipt-screen')).toBeNull();
    expect(receipt.props.accessibilityElementsHidden).toBe(true);
    expect(receipt.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(receipt.props.pointerEvents).toBe('none');
  });

  it('dismisses the passenger receipt into the map without re-locking the completed trip state', () => {
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({ dismissCompletedReceipt })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(() => getByTestId('passenger-receipt-back-to-map-button')).not.toThrow();
    fireEvent.press(getByTestId('passenger-receipt-back-to-map-button'));

    expect(dismissCompletedReceipt).toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('closes a completed-trip passenger receipt directly to the map even with stack history', () => {
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({ dismissCompletedReceipt })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true } }}
      />
    );

    fireEvent.press(getByTestId('passenger-receipt-back-to-map-button'));

    expect(dismissCompletedReceipt).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('handles Android back on a completed-trip receipt as a terminal close', () => {
    const dismissCompletedReceipt = jest.fn();
    let beforeRemoveListener = null;
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({ dismissCompletedReceipt })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return jest.fn();
      }),
    };

    render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true } }}
      />
    );

    expect(navigation.addListener).toHaveBeenCalledWith(
      'beforeRemove',
      expect.any(Function),
    );

    const event = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    beforeRemoveListener(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('shows an explicit recovery state when a completed passenger receipt has not hydrated yet', async () => {
    const dismissCompletedReceipt = jest.fn();
    const recoverCompletedReceipt = jest.fn(() => new Promise(() => {}));
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        tripHistory: [],
        lastReceipt: null,
        dismissCompletedReceipt,
        recoverCompletedReceipt,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, getAllByText, queryByText } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true } }}
      />
    );

    expect(getByTestId('receipt-recovery-state-card')).toBeTruthy();
    expect(getByText('Recibo final pendente')).toBeTruthy();
    expect(getByText('Recibo pendente')).toBeTruthy();
    expect(queryByText(/reconciliação/i)).toBeNull();
    expect(getAllByText('--').length).toBeGreaterThan(0);

    const rateButton = getByTestId('passenger-receipt-rate-trip-button');
    expect(rateButton.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(rateButton);
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.any(Object)
    );

    await waitFor(() => {
      expect(recoverCompletedReceipt).toHaveBeenCalledWith({
        reason: 'receipt_screen_missing_payload',
      });
    });

    fireEvent.press(getByTestId('passenger-receipt-back-to-map-button'));

    expect(dismissCompletedReceipt).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('uses the route booking id when recovering a completed receipt without payload', async () => {
    const recoverCompletedReceipt = jest.fn(() => new Promise(() => {}));
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        tripHistory: [],
        lastReceipt: null,
        recoverCompletedReceipt,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, bookingId: 'booking_receipt_recovery' } }}
      />
    );

    await waitFor(() => {
      expect(recoverCompletedReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          explicitBookingId: 'booking_receipt_recovery',
        }),
      );
    });
  });

  it('prefers a backend-final runtime receipt over minimal route receipt params', () => {
    const recoverCompletedReceipt = jest.fn();
    const backendFinalReceipt = {
      ...buildReceiptRuntime().lastReceipt,
      id: 'booking_backend_final_receipt',
      bookingId: 'booking_backend_final_receipt',
      fare: 83.4,
      grossAmount: 83.4,
      value: 'R$ 83,40',
      driverNetAmount: 78.08,
      totalFees: 5.32,
      pickupAddress: 'Carioca Shopping',
      destinationAddress: 'Mercadão de Madureira',
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
    };
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        tripHistory: [backendFinalReceipt],
        lastReceipt: backendFinalReceipt,
        recoverCompletedReceipt,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, queryByText } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{
          params: {
            fromTrip: true,
            bookingId: 'booking_backend_final_receipt',
            fare: 27.5,
            grossAmount: 27.5,
            pickupAddress: 'Origem local antiga',
            destinationAddress: 'Destino local antigo',
          },
        }}
      />,
    );

    expect(getByText('R$ 83,40')).toBeTruthy();
    expect(getByText('Carioca Shopping')).toBeTruthy();
    expect(getByText('Mercadão de Madureira')).toBeTruthy();
    expect(queryByText('R$ 27,50')).toBeNull();
    expect(queryByText('Origem local antiga')).toBeNull();
    expect(getByTestId('passenger-receipt-rate-trip-button').props.accessibilityState?.disabled).toBe(false);
    expect(recoverCompletedReceipt).not.toHaveBeenCalled();
  });

  it('does not present a zero-value receipt as final when the financial snapshot is incomplete', async () => {
    const dismissCompletedReceipt = jest.fn();
    const recoverCompletedReceipt = jest.fn(() => new Promise(() => {}));
    const incompleteReceipt = {
      id: 'trip_incomplete_financial',
      driverId: 'driver_1',
      driverName: 'Motorista Leaf',
      passengerId: 'customer_1',
      passengerName: 'Passageira Leaf',
      paymentMethod: 'pix',
    };
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        tripHistory: [incompleteReceipt],
        lastReceipt: incompleteReceipt,
        dismissCompletedReceipt,
        recoverCompletedReceipt,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, getAllByText, queryByText } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true } }}
      />
    );

    expect(getByTestId('receipt-recovery-state-card')).toBeTruthy();
    expect(getByText('Recibo final indisponível')).toBeTruthy();
    expect(getByText('Recibo pendente')).toBeTruthy();
    expect(queryByText(/reconciliação/i)).toBeNull();
    expect(getByText('Origem em verificação')).toBeTruthy();
    expect(getByText('Destino em verificação')).toBeTruthy();
    expect(getAllByText('--').length).toBeGreaterThan(0);
    expect(queryByText('R$ 0,00')).toBeNull();

    const rateButton = getByTestId('passenger-receipt-rate-trip-button');
    expect(rateButton.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(rateButton);
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.any(Object)
    );

    await waitFor(() => {
      expect(recoverCompletedReceipt).toHaveBeenCalledWith({
        reason: 'receipt_screen_incomplete_financial_contract',
        explicitBookingId: 'trip_incomplete_financial',
      });
    });
  });

  it('does not present a gross-valued receipt as final without backend-final provenance', async () => {
    const dismissCompletedReceipt = jest.fn();
    const recoverCompletedReceipt = jest.fn(() => new Promise(() => {}));
    const untrustedReceipt = {
      ...buildReceiptRuntime().lastReceipt,
      id: 'trip_untrusted_snapshot',
      fare: 38.4,
      grossAmount: 38.4,
      driverNetAmount: 31.8,
      totalFees: 6.6,
      authoritativeSnapshot: false,
      financialSnapshotSource: 'socket_fallback',
    };
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        tripHistory: [untrustedReceipt],
        lastReceipt: untrustedReceipt,
        dismissCompletedReceipt,
        recoverCompletedReceipt,
      }),
    );
    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, queryByText } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true } }}
      />,
    );

    expect(getByTestId('receipt-recovery-state-card')).toBeTruthy();
    expect(getByText('Recibo final indisponível')).toBeTruthy();
    expect(getByText('Recibo pendente')).toBeTruthy();
    expect(queryByText(/reconciliação/i)).toBeNull();
    expect(queryByText('R$ 38,40')).toBeNull();
    expect(getByTestId('passenger-receipt-rate-trip-button').props.accessibilityState?.disabled).toBe(true);

    await waitFor(() => {
      expect(recoverCompletedReceipt).toHaveBeenCalledWith({
        reason: 'receipt_screen_incomplete_financial_contract',
        explicitBookingId: 'trip_untrusted_snapshot',
      });
    });
  });

  it('closes the passenger receipt after rating without navigating back into itself', () => {
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({ dismissCompletedReceipt })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, fromRating: true } }}
      />
    );

    fireEvent.press(getByTestId('passenger-receipt-back-to-map-button'));

    expect(dismissCompletedReceipt).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('routes post-ride issue reporting through support triage', () => {
    usePrototypeRideRuntime.mockReturnValue(buildReceiptRuntime());

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('passenger-receipt-report-issue-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupport',
      expect.objectContaining({
        fromReceipt: true,
        initialTopicId: 'billing',
        bookingId: 'trip_1',
        source: 'receipt',
        bookingStatus: 'completed',
        receipt: expect.objectContaining({ id: 'trip_1' }),
      })
    );
  });

  it('replaces the passenger back CTA with a close affordance in the header', () => {
    usePrototypeRideRuntime.mockReturnValue(buildReceiptRuntime());

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, queryByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('passenger-receipt-back-to-map-button')).toBeTruthy();
    expect(queryByText('Voltar para o mapa')).toBeNull();
  });

  it('renders the driver receipt with the resolved destination address and a visible back action', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'driver',
        tripHistory: [
          buildReceiptRuntime().tripHistory[0],
          {
            id: 'trip_2',
            fare: 24.5,
            value: 'R$ 24,50',
            date: '03 abr 2026',
            pickupAddress: '1540 Mission St',
            destinationAddress: '1 Ferry Building',
            passengerId: 'customer_2',
            passengerName: 'Passageiro 2',
          },
        ],
      })
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
	    const { getAllByText, getByTestId, getByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Valor recebido')).toBeTruthy();
    expect(getByText('Rota final da corrida')).toBeTruthy();
    expect(getByText('Tempo e distância finais')).toBeTruthy();
    expect(getByText('Praça Senador Salgado Filho')).toBeTruthy();
    expect(getByTestId('driver-receipt-back-to-map-button')).toBeTruthy();
  });

  it('dismisses the driver receipt through the shared back action', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'driver',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-receipt-back-to-map-button'));

    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('renders the dedicated trip history screen with the modern trip summary layout', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'driver',
        tripHistory: [
          {
            id: 'trip_1',
            date: '02 abr 2026',
            fare: 16.5,
            driverNetAmount: 15.01,
            totalFees: 1.49,
            value: 'R$ 15,01',
            pickupAddress: '1540 Mission St',
            dropoffAddress: '1 Ferry Building',
          },
        ],
      })
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getAllByText, getByText } = render(
      <RobotaxiTripHistoryScreen navigation={navigation} route={{ key: 'trip-history' }} />
    );

    expect(getByText('Corridas concluidas')).toBeTruthy();
    expect(getByText('Viagens')).toBeTruthy();
    expect(getByText('Recibos, trajetos e valores liquidos em uma leitura direta.')).toBeTruthy();
    expect(getByText('1540 Mission St')).toBeTruthy();
    expect(getByText('1 Ferry Building')).toBeTruthy();
    expect(getAllByText('R$ 15,01')).toHaveLength(2);
  });

  it('prefers destinationAddress in trip history rows when dropoffAddress is absent', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildReceiptRuntime({
        activeRole: 'customer',
        tripHistory: [
          {
            id: 'trip_2',
            date: '07 abr 2026',
            value: 'R$ 22,40',
            pickupAddress: 'Rua A, 10',
            destinationAddress: 'Praça Senador Salgado Filho, Centro, Rio de Janeiro',
          },
        ],
      })
    );

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByText, queryByText } = render(
      <RobotaxiTripHistoryScreen navigation={navigation} route={{ key: 'trip-history' }} />
    );

    expect(getByText('Praça Senador Salgado Filho, Centro, Rio de Janeiro')).toBeTruthy();
    expect(queryByText('Destino indisponivel')).toBeNull();
  });

  it('renders the passenger search card with time progress, rotating status and route summary', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        searchingElapsedSeconds: 12,
        selectedVehicle: 'Leaf Plus',
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
        },
        currentAddress: '1540 Mission St, San Francisco',
        cancelRideSearch: jest.fn(),
        lastError: '',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByText, getByTestId } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Detalhes da corrida')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-elapsed').props.children).toBe('00:12');
    expect(getByText('Buscando motorista')).toBeTruthy();
    expect(getByText('Buscando em 6 km de diâmetro neste momento')).toBeTruthy();
    expect(getByText('Raio de busca expandido')).toBeTruthy();
    expect(getByText('Preço protegido')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-progress-fill').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: '7%',
        }),
      ])
    );
    expect(getByText('Ponto de partida')).toBeTruthy();
    expect(getByText('Destino')).toBeTruthy();
    expect(getByText('1540 Mission St')).toBeTruthy();
    expect(getByText('Ferry Building')).toBeTruthy();
  });

  it('renders booking finalization separately from driver search while createBooking is pending', () => {
    const cancelRideSearch = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'requesting',
        searchingElapsedSeconds: 44,
        selectedVehicle: 'Leaf Plus',
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
        },
        currentAddress: '1540 Mission St, San Francisco',
        activeBookingId: '',
        activeBooking: {
          status: 'REQUESTING',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
        paymentState: {
          status: 'processing',
          paymentId: 'pix_pending_create',
          chargeId: 'pix_pending_create',
        },
        cancelRideSearch,
        lastError: '',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getAllByText, getByText, getByTestId, queryByTestId, queryByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('passenger-booking-finalizing-sheet')).toBeTruthy();
    expect(queryByTestId('passenger-driver-search-sheet')).toBeNull();
    expect(queryByText('Buscando motorista')).toBeNull();
    expect(getAllByText('Criando corrida').length).toBeGreaterThan(0);
    expect(getByText('Pagamento confirmado. Estamos criando sua corrida com segurança.')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-elapsed').props.children).toBe('Criando corrida');

    fireEvent.press(getByTestId('passenger-driver-search-cancel-button'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('does not promote the passenger to driver-on-way before the driver accepts', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'AWAITING_RESPONSE',
        searchingElapsedSeconds: 18,
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
        },
        currentAddress: '1540 Mission St, San Francisco',
        activeBookingId: 'booking_pre_accept',
        paymentState: {
          status: 'confirmed',
          paymentId: 'pix_pre_accept',
          confirmedAt: '2026-06-22T20:00:00.000Z',
        },
        activeBooking: {
          bookingId: 'booking_pre_accept',
          status: 'AWAITING_RESPONSE',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
          driver: {
            id: 'driver_notified_1',
            name: 'Motorista Notificado',
          },
          paymentData: { confirmedAt: '2026-06-22T20:00:00.000Z' },
        },
        driverInfo: {
          id: 'driver_notified_1',
          name: 'Motorista Notificado',
          model: 'Leaf Plus',
          plate: 'LEF-2042',
        },
        lastError: '',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { getByText, getByTestId } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Buscando motorista')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-elapsed')).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.any(Object)
    );
  });

  it('keeps the passenger search surface locked against passive backdrop dismissal', () => {
    const cancelRideSearch = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        searchingElapsedSeconds: 12,
        selectedVehicle: 'Leaf Plus',
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
        },
        currentAddress: '1540 Mission St, San Francisco',
        cancelRideSearch,
        lastError: '',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);

    fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('waits for the canonical cancellation ACK before leaving the search screen', async () => {
    let resolveCancellation;
    const cancelRideSearch = jest.fn(() => new Promise((resolve) => {
      resolveCancellation = resolve;
    }));
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        searchingElapsedSeconds: 44,
        activeBooking: { bookingId: 'booking_cancel_ack' },
        cancelRideSearch,
        lastError: '',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
	    const { getAllByText, getByTestId, getByText } = render(
	      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
	    );

    fireEvent.press(getByTestId('passenger-driver-search-cancel-button'));

    expect(cancelRideSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_cancel_ack',
        source: 'search',
        bookingStatus: 'searching',
      })
    );
    expect(getByText('Cancelando...')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();

    resolveCancellation({ success: true });

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeCancellation',
        expect.objectContaining({
          bookingId: 'booking_cancel_ack',
          source: 'search',
          bookingStatus: 'searching',
        })
      );
    });
  });

  it('keeps the active search visible and exposes support when cancellation fails', async () => {
    const cancelRideSearch = jest
      .fn()
      .mockRejectedValue(new Error('Servidor não confirmou o cancelamento.'));
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        searchingElapsedSeconds: 180,
        activeBooking: { bookingId: 'booking_cancel_failed' },
        cancelRideSearch,
        lastError: '',
      })
    );

	    const navigation = {
	      navigate: jest.fn(),
	      replace: jest.fn(),
	      canGoBack: jest.fn(() => true),
	      goBack: jest.fn(),
	    };
	    const { getAllByText, getByTestId, getByText } = render(
	      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
	    );

    fireEvent.press(getByTestId('passenger-driver-search-cancel-button'));

    await waitFor(() => {
      expect(getByText('Servidor não confirmou o cancelamento.')).toBeTruthy();
    });
    expect(getByText('Buscando motorista')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('passenger-driver-search-support-button'));
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiMenuHelp', {
      source: 'driver_search',
      bookingId: 'booking_cancel_failed',
    });
  });

  it('blocks navigator removal while a confirmed passenger search is active', () => {
    let beforeRemoveListener = null;
    const unsubscribe = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        activeBooking: { bookingId: 'booking_search_1' },
        paymentState: { status: 'confirmed', paymentId: 'pix_1' },
      }),
    );
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return unsubscribe;
      }),
    };
    const screen = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />,
    );
    const event = { preventDefault: jest.fn() };

    expect(navigation.addListener).toHaveBeenCalledWith(
      'beforeRemove',
      expect.any(Function),
    );
    beforeRemoveListener(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
    screen.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('uses persisted booking labels when the search screen is rehydrated without selectedDestination', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        searchingElapsedSeconds: 28,
        selectedDestination: null,
        currentAddress: '',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
        cancelRideSearch: jest.fn(),
        lastError: '',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByText } = render(
      <RobotaxiDriverSearchScreen
        navigation={navigation}
        route={{ params: { destination: 'Destino', originAddress: '' } }}
      />
    );

    expect(getByText('1540 Mission St')).toBeTruthy();
    expect(getByText('Ferry Building')).toBeTruthy();
  });

  it('forwards pickup and destination labels from payment success into the search route', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        selectedDestination: null,
        currentAddress: '',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
      })
    );

    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { destination: 'Destino', autoAdvance: true, vehicle: 'Leaf Plus' } }}
      />
    );

    await waitFor(
      () => {
        expect(navigation.replace).toHaveBeenCalledWith(
          'RobotaxiPrototypeDriverSearch',
          expect.objectContaining({
            destination: 'Destino',
            destinationAddress: 'Ferry Building, San Francisco',
            originAddress: '1540 Mission St, San Francisco',
            vehicle: 'Leaf Plus',
          })
        );
      },
      { timeout: 2000 }
    );
  });

  it('does not expose map dismissal from payment success while the paid ride is active', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        selectedDestination: null,
        currentAddress: '',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
      })
    );

    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { getByTestId, queryByText } = render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { destination: 'Destino', autoAdvance: false, vehicle: 'Leaf Plus' } }}
      />
    );

    expect(queryByText('Voltar ao mapa')).toBeNull();
    expect(getByTestId('prototype-dismissible-sheet').props.backdropDismissEnabled).toBe(false);
    expect(getByTestId('prototype-dismissible-sheet').props.dragEnabled).toBe(false);

    fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('routes payment success to receipt when completion arrives before search transition', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({ bookingStatus: 'trip_completed' }),
    );

    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const { queryByText } = render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { autoAdvance: false } }}
      />,
    );

    expect(queryByText('Voltar ao mapa')).toBeNull();
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_1',
          fromTrip: true,
        }),
      );
    });
  });

  it.each([
    ['cancelled', 'RobotaxiPrototypeCancellation'],
    ['no_drivers_available', 'RobotaxiPrototypeNoDrivers'],
  ])('routes payment success terminal status %s to %s', async (bookingStatus, expectedRoute) => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({ bookingStatus }),
    );

    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const { queryByText } = render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { autoAdvance: false } }}
      />,
    );

    expect(queryByText('Voltar ao mapa')).toBeNull();
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        expectedRoute,
        expect.any(Object),
      );
    });
  });

  it.each([
    'operational_interrupted',
    'passenger_decision_pending',
    'searching_replacement',
    'reassignment_pending',
    'searching_replacement_driver',
  ])('routes payment success operational status %s to the active trip surface', async (bookingStatus) => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({ bookingStatus }),
    );

    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { autoAdvance: false } }}
      />,
    );

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeTrip',
        expect.objectContaining({
          driverName: expect.any(String),
        }),
      );
    });
  });

  it('blocks passive payment-success removal but permits the canonical search transition', () => {
    let beforeRemoveListener = null;
    const unsubscribe = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({ bookingStatus: 'searching' }),
    );
    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return unsubscribe;
      }),
    };
    const screen = render(
      <RobotaxiPaymentSuccessScreen
        navigation={navigation}
        route={{ params: { autoAdvance: false } }}
      />,
    );
    const passiveEvent = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };

    beforeRemoveListener(passiveEvent);
    expect(passiveEvent.preventDefault).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('passenger-payment-success-continue-button'));
    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeDriverSearch',
      expect.any(Object),
    );

    const canonicalEvent = {
      preventDefault: jest.fn(),
      data: { action: { type: 'REPLACE', payload: { name: 'RobotaxiPrototypeDriverSearch' } } },
    };
    beforeRemoveListener(canonicalEvent);

    expect(canonicalEvent.preventDefault).not.toHaveBeenCalled();
    screen.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('ignores generic placeholder labels when resolving an address', () => {
    expect(resolveMeaningfulAddress('Sua localização atual', '1540 Mission St, San Francisco')).toBe(
      '1540 Mission St, San Francisco'
    );
    expect(resolveMeaningfulAddress('Origem atual', '')).toBe('');
    expect(resolveMeaningfulAddress('Destino', 'Ferry Building, San Francisco')).toBe(
      'Ferry Building, San Francisco'
    );
  });

  it('stops rendering the search sheet once the request reaches a terminal no-drivers state', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
        searchingElapsedSeconds: 31,
        selectedDestination: null,
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
        cancelRideSearch: jest.fn(),
        lastError: 'Nenhum motorista disponível no momento.',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { queryByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByText('Buscando motorista')).toBeNull();
  });

  it('routes a terminal completed passenger search directly to receipt', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'trip_completed',
        activeBookingId: 'booking_search_completed',
        activeBooking: {
          bookingId: 'booking_search_completed',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
        lastError: '',
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { queryByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />,
    );

    expect(queryByText('Buscando motorista')).toBeNull();
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_search_completed',
          fare: 38.4,
          fromTrip: true,
          grossAmount: 38.4,
        }),
      );
    });
  });

  it.each([
    'operational_interrupted',
    'passenger_decision_pending',
    'searching_replacement',
    'reassignment_pending',
    'searching_replacement_driver',
  ])('routes passenger search operational status %s to the active trip surface', async (bookingStatus) => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus,
        activeBookingId: 'booking_operational_search',
        activeBooking: {
          bookingId: 'booking_operational_search',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
        lastError: '',
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    render(<RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeTrip',
        expect.objectContaining({
          driverName: expect.any(String),
        }),
      );
    });
  });

  it('keeps a paid active passenger search visible during transient idle hydration', () => {
    const cancelRideSearch = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
        activeBookingId: 'booking_paid_sync',
        searchingElapsedSeconds: 31,
        selectedDestination: null,
        currentAddress: '',
        paymentState: {
          status: 'confirmed',
          paymentId: 'pix_paid_1',
          confirmedAt: '2026-06-22T20:00:00.000Z',
          paymentAmount: 27.5,
        },
        selectedFare: 80,
        activeBooking: {
          bookingId: 'booking_paid_sync',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
          estimatedFare: 80,
          paymentData: { confirmedAt: '2026-06-22T20:00:00.000Z', paymentAmount: 27.5 },
        },
        cancelRideSearch,
        lastError: '',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const { getAllByText, getByTestId, getByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Buscando motorista')).toBeTruthy();
    expect(getByText('sincronizando estado')).toBeTruthy();
    expect(getByText('Sincronizando...')).toBeTruthy();
    expect(getByText('1540 Mission St')).toBeTruthy();
    expect(getByText('Ferry Building')).toBeTruthy();
    expect(getAllByText('R$ 27,50').length).toBeGreaterThan(0);
    expect(() => getByText('R$ 80,00')).toThrow();

    fireEvent.press(getByTestId('passenger-driver-search-cancel-button'));
    fireEvent.press(getByTestId('passenger-driver-search-support-button'));

    expect(cancelRideSearch).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiMenuHelp', {
      source: 'driver_search',
      bookingId: 'booking_paid_sync',
    });
  });

  it('routes a paid active passenger search to no-drivers on terminal no-driver aliases', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'no_drivers_available',
        activeBookingId: 'booking_no_driver_terminal',
        searchingElapsedSeconds: 31,
        selectedDestination: null,
        currentAddress: '',
        paymentState: {
          status: 'confirmed',
          paymentId: 'pix_paid_no_driver',
          confirmedAt: '2026-06-22T20:00:00.000Z',
          paymentAmount: 27.5,
        },
        activeBooking: {
          bookingId: 'booking_no_driver_terminal',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
          paymentData: {
            paymentAmount: 27.5,
            confirmedAt: '2026-06-22T20:00:00.000Z',
          },
        },
        lastError: '',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { queryByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByText('Buscando motorista')).toBeNull();
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeNoDrivers',
        expect.objectContaining({
          reason: expect.stringMatching(/motoristas disponíveis/i),
        }),
      );
    });
  });

	  it('passes the paid gross fare, not stale estimates, when search advances to active trip', async () => {
	    usePrototypeRideRuntime.mockReturnValue(
	      buildPassengerRuntime({
	        bookingStatus: 'accepted',
	        selectedFare: 80,
	        paymentState: {
	          status: 'confirmed',
	          paymentAmount: 'R$ 27,50',
	          confirmedAt: '2026-06-22T20:00:00.000Z',
	        },
	        activeBooking: {
	          bookingId: 'booking_paid_accept',
	          pickupLocation: { add: '1540 Mission St, San Francisco' },
	          destinationLocation: { add: 'Ferry Building, San Francisco' },
	          estimatedFare: 80,
	          fare: 80,
	          paymentData: {
	            paymentAmount: 27.5,
	            confirmedAt: '2026-06-22T20:00:00.000Z',
	          },
	        },
	        lastError: '',
	      })
	    );

	    const navigation = {
	      navigate: jest.fn(),
	      replace: jest.fn(),
	      canGoBack: jest.fn(() => false),
	      goBack: jest.fn(),
	    };
	    render(<RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />);

	    await waitFor(() => {
	      expect(navigation.replace).toHaveBeenCalledWith(
	        'RobotaxiPrototypeTrip',
	        expect.objectContaining({
	          selectedFare: 27.5,
	        }),
	      );
	    });
	  });

  it('clears the preview route when leaving the no drivers screen back to the map', () => {
    const clearFlowPreview = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
        clearFlowPreview,
        selectedDestination: { name: 'Ferry Building' },
        selectedVehicle: 'Leaf Plus',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiNoDriversScreen
        navigation={navigation}
        route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
      />
    );

    fireEvent.press(getByTestId('passenger-no-drivers-back-to-map-button'));

    expect(clearFlowPreview).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('clears the preview route before retrying another destination from no drivers', () => {
    const clearFlowPreview = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
        clearFlowPreview,
        selectedDestination: { name: 'Ferry Building' },
        selectedVehicle: 'Leaf Plus',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId } = render(
      <RobotaxiNoDriversScreen
        navigation={navigation}
        route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
      />
    );

    fireEvent.press(getByTestId('passenger-no-drivers-retry-button'));

    expect(clearFlowPreview).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototypeDestination');
  });

  it.each(['notified', 'pending_driver', 'waiting_driver'])(
    'does not flash the no-drivers terminal sheet while search alias %s is active',
    async (bookingStatus) => {
      const clearFlowPreview = jest.fn();
      usePrototypeRideRuntime.mockReturnValue(
        buildPassengerRuntime({
          bookingStatus,
          clearFlowPreview,
          selectedDestination: { name: 'Ferry Building' },
          selectedVehicle: 'Leaf Plus',
        }),
      );

      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => false),
        goBack: jest.fn(),
      };
      const { queryByTestId } = render(
        <RobotaxiNoDriversScreen
          navigation={navigation}
          route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
        />,
      );

      expect(queryByTestId('passenger-no-drivers-screen')).toBeNull();
      await waitFor(() => {
        expect(navigation.replace).toHaveBeenCalledWith(
          'RobotaxiPrototypeDriverSearch',
          expect.any(Object),
        );
      });
    },
  );

  it('routes a completed no-drivers surface to receipt with canonical ride context', async () => {
    const clearFlowPreview = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'trip_completed',
        activeBookingId: 'booking_no_drivers_completed',
        activeBooking: {
          bookingId: 'booking_no_drivers_completed',
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
          grossFare: 42.25,
        },
        clearFlowPreview,
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
        },
        selectedFare: 42.25,
        selectedVehicle: 'Leaf Plus',
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    render(
      <RobotaxiNoDriversScreen
        navigation={navigation}
        route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
      />,
    );

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_no_drivers_completed',
          fare: 42.25,
          fromTrip: true,
          grossAmount: 42.25,
        }),
      );
    });
  });

  it('submits the driver rating, closes the completed cycle, and returns to the map', async () => {
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'driver',
      profile: { uid: 'driver_1' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = buildReceiptRuntime().lastReceipt;
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'driver',
            tripId: 'trip_1',
            targetUserId: 'customer_1',
            targetName: 'Passageira Leaf',
            receipt,
          },
        }}
      />,
    );

    fireEvent.press(getByTestId('passenger-rating-submit-button'));

    await waitFor(() => {
      expect(RatingService.submitRating).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: 'trip_1',
          reviewerType: 'driver',
          targetUserId: 'customer_1',
          passengerId: 'customer_1',
          rating: 5,
        }),
      );
      expect(markTripRating).toHaveBeenCalledWith(
        'trip_1',
        expect.objectContaining({
          driverRatedPassengerValue: 5,
        }),
      );
      expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    });
  });

  it('skips driver rating into a clean map instead of reopening the receipt', () => {
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'driver',
      profile: { uid: 'driver_1' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'driver',
            tripId: 'trip_1',
            targetUserId: 'customer_1',
            targetName: 'Passageira Leaf',
            receipt: buildReceiptRuntime().lastReceipt,
          },
        }}
      />,
    );

    fireEvent.press(getByTestId('rating-skip-to-map-button'));

    expect(RatingService.submitRating).not.toHaveBeenCalled();
    expect(markTripRating).not.toHaveBeenCalled();
    expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.any(Object),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('keeps the driver rating surface open when submission fails', async () => {
    RatingService.submitRating.mockRejectedValueOnce(new Error('rating unavailable'));
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'driver',
      profile: { uid: 'driver_1' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'driver',
            tripId: 'trip_1',
            targetUserId: 'customer_1',
            targetName: 'Passageira Leaf',
            receipt: buildReceiptRuntime().lastReceipt,
          },
        }}
      />,
    );

    fireEvent.press(getByTestId('passenger-rating-submit-button'));

    await waitFor(() => {
      expect(RatingService.submitRating).toHaveBeenCalled();
    });
    expect(markTripRating).not.toHaveBeenCalled();
    expect(dismissCompletedReceipt).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });

  it('submits the passenger rating, closes the completed cycle, and returns to the map', async () => {
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = buildReceiptRuntime().lastReceipt;
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt,
          },
        }}
      />
    );

    fireEvent.press(getByTestId('passenger-rating-air-conditioning-yes'));
    fireEvent.press(getByTestId('passenger-rating-submit-button'));

    await waitFor(() => {
      expect(RatingService.submitRating).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: 'trip_1',
          reviewerType: 'passenger',
          targetUserId: 'driver_1',
          rating: 5,
        })
      );
      expect(markTripRating).toHaveBeenCalledWith(
        'trip_1',
        expect.objectContaining({
          passengerRatedDriverValue: 5,
        })
      );
      expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    });
  });

  it('marks the passenger receipt with the backend-confirmed rating on idempotent replay', async () => {
    RatingService.submitRating.mockResolvedValueOnce({
      success: true,
      ratingId: 'rating_existing',
      idempotentReplay: true,
      rating: 4,
      comment: 'Persistida no backend',
    });
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = buildReceiptRuntime().lastReceipt;
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt,
          },
        }}
      />
    );

    fireEvent.press(getByTestId('passenger-rating-air-conditioning-yes'));
    fireEvent.press(getByTestId('passenger-rating-submit-button'));

    await waitFor(() => {
      expect(markTripRating).toHaveBeenCalledWith(
        'trip_1',
        expect.objectContaining({
          passengerRatedDriverValue: 4,
          passengerRatedDriverComment: 'Persistida no backend',
        })
      );
      expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
    });
  });

  it('skips receipt-launched rating into a clean map instead of reopening the receipt', () => {
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const receipt = buildReceiptRuntime().lastReceipt;
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt,
          },
        }}
      />
    );

    fireEvent.press(getByTestId('rating-skip-to-map-button'));

    expect(RatingService.submitRating).not.toHaveBeenCalled();
    expect(markTripRating).not.toHaveBeenCalled();
    expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.any(Object)
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('handles Android back on rating as a terminal close to the map', () => {
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    let beforeRemoveListener = null;
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
      addListener: jest.fn((eventName, listener) => {
        if (eventName === 'beforeRemove') {
          beforeRemoveListener = listener;
        }
        return jest.fn();
      }),
    };

    render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt: buildReceiptRuntime().lastReceipt,
          },
        }}
      />
    );

    expect(navigation.addListener).toHaveBeenCalledWith(
      'beforeRemove',
      expect.any(Function),
    );

    const event = { preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } };
    beforeRemoveListener(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('auto-submits the passenger rating when qa params request it', async () => {
    allowTestUserTools.mockReturnValue(true);

    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = buildReceiptRuntime().lastReceipt;
    render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt,
            qaAutoSubmit: '1',
            qaAirConditioningOk: '1',
            qaAutoSubmitDelayMs: '10',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(RatingService.submitRating).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId: 'trip_1',
          reviewerType: 'passenger',
          targetUserId: 'driver_1',
          rating: 5,
        })
      );
      expect(markTripRating).toHaveBeenCalledWith(
        'trip_1',
        expect.objectContaining({
          passengerRatedDriverValue: 5,
        })
      );
      expect(dismissCompletedReceipt).toHaveBeenCalledTimes(1);
      expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    });
  });

  it('keeps the completed cycle open when rating submission fails', async () => {
    RatingService.submitRating.mockRejectedValueOnce(new Error('rating unavailable'));
    const markTripRating = jest.fn();
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
      dismissCompletedReceipt,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const { getByTestId } = render(
      <RobotaxiRatingScreen
        navigation={navigation}
        route={{
          params: {
            fromReceipt: true,
            reviewerType: 'passenger',
            tripId: 'trip_1',
            targetUserId: 'driver_1',
            targetName: 'Motorista Leaf',
            receipt: buildReceiptRuntime().lastReceipt,
          },
        }}
      />
    );

    fireEvent.press(getByTestId('passenger-rating-air-conditioning-yes'));
    fireEvent.press(getByTestId('passenger-rating-submit-button'));

    await waitFor(() => {
      expect(RatingService.submitRating).toHaveBeenCalled();
    });
    expect(markTripRating).not.toHaveBeenCalled();
    expect(dismissCompletedReceipt).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototype');
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });
});

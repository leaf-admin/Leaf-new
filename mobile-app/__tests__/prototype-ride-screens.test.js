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
      <TouchableOpacity
        testID="prototype-dismissible-sheet-backdrop"
        accessibilityLabel="prototype-dismissible-sheet-backdrop"
        onPress={backdropDismissEnabled ? onClose : undefined}
      />
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

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children }) => <View>{children}</View>;
  return {
    __esModule: true,
    default: MockView,
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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

    const startedRuntime = buildDriverRuntime({ bookingStatus: 'started' });
    usePrototypeRideRuntime.mockReturnValue(startedRuntime);
    const startedNavigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const startedScreen = render(
      <RobotaxiDriverTripScreen navigation={startedNavigation} route={{ params: {} }} />
    );

    expect(startedScreen.getByText('A caminho de Aeroporto Santos Dumont')).toBeTruthy();
    fireEvent.press(
      startedScreen.getByLabelText('driver-live-primary-action-complete-button')
    );
    await waitFor(() => {
      expect(startedRuntime.completeTripFlow).toHaveBeenCalled();
      expect(startedNavigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', { fromTrip: true });
    });
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(
      <RobotaxiDriverTripScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(screen.getAllByText('R$ 38,40').length).toBeGreaterThan(0);
    expect(screen.getByText('bruto')).toBeTruthy();
    expect(screen.queryByText('líquido')).toBeNull();
  });

  it('moves the passenger trip surface to receipt when the trip is completed', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'completed' }));

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', { fromTrip: true });
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

      fireEvent.press(getByTestId('prototype-dismissible-sheet-backdrop'));

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalledWith('RobotaxiPrototype');
      expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
    }
  );

  it('renders the passenger trip as a compact summary while the driver is on the way', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'accepted' }));

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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

  it('keeps the started passenger trip expanded instead of collapsing to compact summary', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'started' }));

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.queryByLabelText('passenger-trip-compact-summary')).toBeNull();
    expect(screen.queryByLabelText('passenger-trip-collapse-button')).toBeNull();
    expect(screen.getByLabelText('passenger-trip-screen')).toBeTruthy();
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.objectContaining({
        fromReceipt: true,
        reviewerType: 'passenger',
        tripId: 'trip_1',
        targetUserId: 'driver_1',
      })
    );
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, getByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );
    const rateButton = getByTestId('passenger-receipt-rate-trip-button');

    expect(getByText('Avaliar viagem')).toBeTruthy();
    expect(rateButton.props.accessibilityState?.disabled).toBe(false);
    expect(rateButton.props.disabled).not.toBe(true);

    fireEvent.press(rateButton);

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeRating',
      expect.objectContaining({
        fromReceipt: true,
        reviewerType: 'passenger',
        tripId: 'trip_without_driver_id',
        targetUserId: fallbackDriverId,
      })
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
    const { getByTestId, getByText } = render(
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
    const { getByTestId, getByText } = render(
      <RobotaxiDriverSearchScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('passenger-driver-search-cancel-button'));

    expect(cancelRideSearch).toHaveBeenCalledTimes(1);
    expect(getByText('Cancelando...')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();

    resolveCancellation({ success: true });

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeCancellation',
        { source: 'search' }
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
    const { getByTestId, getByText } = render(
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
    const { getByText } = render(
      <RobotaxiNoDriversScreen
        navigation={navigation}
        route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
      />
    );

    fireEvent.press(getByText('Voltar ao mapa'));

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
    const { getByText } = render(
      <RobotaxiNoDriversScreen
        navigation={navigation}
        route={{ params: { reason: 'Nenhum motorista disponível no momento.' } }}
      />
    );

    fireEvent.press(getByText('Tentar com outro destino'));

    expect(clearFlowPreview).toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledWith('RobotaxiPrototypeDestination');
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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
      expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
    });
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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
      expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototype');
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

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
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
    expect(navigation.navigate).not.toHaveBeenCalledWith('RobotaxiPrototype');
  });
});

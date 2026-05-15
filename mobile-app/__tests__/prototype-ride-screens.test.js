import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiDriverOfferScreen from '../src/screens/prototype/RobotaxiDriverOfferScreen';
import RobotaxiDriverSearchScreen from '../src/screens/prototype/RobotaxiDriverSearchScreen';
import RobotaxiDriverTripScreen from '../src/screens/prototype/RobotaxiDriverTripScreen';
import RobotaxiNoDriversScreen from '../src/screens/prototype/RobotaxiNoDriversScreen';
import RobotaxiPaymentSuccessScreen from '../src/screens/prototype/RobotaxiPaymentSuccessScreen';
import RobotaxiTripScreen from '../src/screens/prototype/RobotaxiTripScreen';
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
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
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
    activeBooking: null,
    selectedVehicle: 'Leaf Plus',
    selectedFare: 38.4,
    tripDistanceKm: 8.2,
    tripDurationMin: 14,
    tripArrivalText: 'Chegada em 14 min',
    boardingRemainingSec: 90,
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

describe('prototype ride screens', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    allowForcedPaymentBypass.mockReturnValue(false);
    allowTestUserTools.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
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
          pricingSnapshotLocked: true,
          payout: 'R$ 31,80',
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

    fireEvent.press(getByText('Aceitar corrida'));

    await waitFor(() => {
      expect(acceptDriverOffer).toHaveBeenCalled();
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeDriverTrip',
        expect.objectContaining({
          request: expect.objectContaining({ bookingId: 'booking_1' }),
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

    expect(screen.getByText('Detalhes da corrida')).toBeTruthy();

    await waitFor(
      () => {
        expect(navigation.goBack).toHaveBeenCalled();
      },
      { timeout: 2000 }
    );
  });

  it('keeps driver trip CTAs aligned with accepted, arrived and started states', async () => {
    const acceptedRuntime = buildDriverRuntime({ bookingStatus: 'accepted' });
    usePrototypeRideRuntime.mockReturnValue(acceptedRuntime);
    const acceptedNavigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const acceptedScreen = render(
      <RobotaxiDriverTripScreen navigation={acceptedNavigation} route={{ params: {} }} />
    );

    expect(acceptedScreen.getByText('Dirija até o local de embarque de Passageiro Leaf')).toBeTruthy();
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

    expect(arrivedScreen.getByText('Passageiro em embarque')).toBeTruthy();
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

    expect(startedScreen.getByText('Viagem em andamento')).toBeTruthy();
    fireEvent.press(
      startedScreen.getByLabelText('driver-live-primary-action-complete-button')
    );
    await waitFor(() => {
      expect(startedRuntime.completeTripFlow).toHaveBeenCalled();
      expect(startedNavigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', { fromTrip: true });
    });
  });

  it('moves the passenger trip surface to receipt when the trip is completed', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'completed' }));

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', { fromTrip: true });
    });
  });

  it('renders the passenger trip as a compact summary while the driver is on the way', () => {
    usePrototypeRideRuntime.mockReturnValue(buildPassengerRuntime({ bookingStatus: 'accepted' }));

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const screen = render(<RobotaxiTripScreen navigation={navigation} route={{ params: {} }} />);

    expect(screen.getByLabelText('passenger-trip-compact-summary')).toBeTruthy();
    expect(screen.getByText('Motorista a caminho do embarque')).toBeTruthy();
    expect(screen.getByText('Acompanhe a aproximacao e prepare-se para embarcar com seguranca.')).toBeTruthy();
    expect(screen.getByText('Motorista Leaf')).toBeTruthy();
    expect(screen.getByText('Leaf Plus • LEF-2042')).toBeTruthy();
    expect(screen.getByText('Tempo')).toBeTruthy();
    expect(screen.getByText('Distância')).toBeTruthy();
    expect(screen.getByText('Valor')).toBeTruthy();
    expect(screen.getByText('Cancelar corrida')).toBeTruthy();
  });

  it('opens rating from the passenger receipt with the real trip payload', async () => {
    usePrototypeRideRuntime.mockReturnValue(buildReceiptRuntime());

    const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, getByText } = render(
      <RobotaxiReceiptScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Corrida concluída')).toBeTruthy();
    expect(getByText('Detalhes do valor')).toBeTruthy();
    expect(getByText('Motorista')).toBeTruthy();
    expect(getByText('Motorista Leaf')).toBeTruthy();
    expect(getByText('Avaliar viagem')).toBeTruthy();

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
    expect(getByText('Corridas recentes')).toBeTruthy();
    expect(getByText('1 Ferry Building')).toBeTruthy();
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

    expect(getByText('Procurando motorista')).toBeTruthy();
    expect(getByText('Leaf Plus')).toBeTruthy();
    expect(getByText('Busca ativa')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-elapsed').props.children).toBe('00:12');
    expect(getByText('de 03:00 de janela ativa')).toBeTruthy();
    expect(getByText('Buscando em 6 km de diâmetro neste momento')).toBeTruthy();
    expect(getByTestId('passenger-driver-search-status-message').props.children).toBe(
      'Expandindo o raio de busca'
    );
    expect(getByTestId('passenger-driver-search-message-dot-2').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: 18,
        }),
      ])
    );
    expect(getByTestId('passenger-driver-search-progress-fill').props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          width: '7%',
        }),
      ])
    );
    expect(getByText('Partida')).toBeTruthy();
    expect(getByText('Chegada')).toBeTruthy();
    expect(getByText('1540 Mission St')).toBeTruthy();
    expect(getByText('Ferry Building')).toBeTruthy();
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

    expect(queryByText('Procurando motorista')).toBeNull();
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

  it('submits the passenger rating and returns to receipt', async () => {
    const markTripRating = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
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
      expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', {
        fromTrip: true,
        fromRating: true,
      });
    });
  });

  it('auto-submits the passenger rating when qa params request it', async () => {
    allowTestUserTools.mockReturnValue(true);

    const markTripRating = jest.fn();
    usePrototypeRideRuntime.mockReturnValue({
      activeRole: 'customer',
      profile: { uid: 'customer_1' },
      driverInfo: { id: 'driver_1', name: 'Motorista Leaf' },
      lastReceipt: buildReceiptRuntime().lastReceipt,
      markTripRating,
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
      expect(navigation.navigate).toHaveBeenCalledWith('RobotaxiPrototypeReceipt', {
        fromTrip: true,
        fromRating: true,
      });
    });
  });
});

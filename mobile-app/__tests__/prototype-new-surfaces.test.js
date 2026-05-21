import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiDriverDocumentsScreen from '../src/screens/prototype/RobotaxiDriverDocumentsScreen';
import RobotaxiDriverWaitlistScreen from '../src/screens/prototype/RobotaxiDriverWaitlistScreen';
import RobotaxiInvitesScreen from '../src/screens/prototype/RobotaxiInvitesScreen';
import RobotaxiPaymentMethodsScreen from '../src/screens/prototype/RobotaxiPaymentMethodsScreen';
import RobotaxiPublicTripTrackingScreen from '../src/screens/prototype/RobotaxiPublicTripTrackingScreen';
import RobotaxiShareTripScreen from '../src/screens/prototype/RobotaxiShareTripScreen';
import RobotaxiSupportTicketScreen from '../src/screens/prototype/RobotaxiSupportTicketScreen';
import RobotaxiVehiclesScreen from '../src/screens/prototype/RobotaxiVehiclesScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { createReferralInvite, loadMyReferralInvites } from '../src/services/runtime/referralProgramService';
import { joinDriverWaitlist, loadDriverWaitlistStatus } from '../src/services/runtime/driverWaitlistService';
import { getPaymentMethods } from '../src/services/runtime/paymentMethodsService';

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

jest.mock('../src/components/prototype/PrototypeDismissibleSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});

jest.mock('react-redux', () => ({
  useSelector: jest.fn(selector => selector({ auth: { profile: { uid: 'customer_1' } } })),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/runtime/paymentMethodsService', () => ({
  getPaymentMethods: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/runtime/referralProgramService', () => ({
  acceptReferralInvite: jest.fn().mockResolvedValue({ invite: { id: 'accepted_1', code: 'PSG-OK', status: 'accepted' } }),
  createReferralInvite: jest.fn().mockResolvedValue({
    invite: { id: 'invite_1', code: 'PSG-123', status: 'pending', type: 'passenger_referral' },
    usage: null,
  }),
  loadMyReferralInvites: jest.fn().mockResolvedValue({ sent: [], received: [] }),
}));

jest.mock('../src/services/runtime/driverWaitlistService', () => ({
  joinDriverWaitlist: jest.fn().mockResolvedValue({
    success: true,
    position: 12,
    estimatedWaitTime: 84,
    city: { cityLabel: 'Rio de Janeiro', pendingDrivers: 11, approvedDrivers: 42 },
  }),
  loadDriverWaitlistStatus: jest.fn().mockResolvedValue({
    waitListStatus: 'none',
    position: null,
    city: { cityLabel: 'Rio de Janeiro', pendingDrivers: 11, approvedDrivers: 42 },
  }),
}));

function buildRuntime(overrides = {}) {
  return {
    activeBookingId: 'booking_1',
    activeBooking: {
      id: 'booking_1',
      driverName: 'Motorista Leaf',
      vehicleModel: 'Nissan Leaf',
      vehiclePlate: 'LEF-2042',
    },
    bookingStatus: 'accepted',
    currentAddress: 'Rua A, 10',
    selectedDestination: {
      name: 'Shopping Leblon',
      address: 'Av. Afrânio de Melo Franco, 290',
    },
    selectedVehicle: 'Nissan Leaf',
    tripArrivalText: 'Chega em 8 min',
    tripDurationMin: 8,
    profileUid: 'customer_1',
    driverInfo: {
      id: 'driver_1',
      name: 'Motorista Leaf',
      rating: '4.98',
      vehicleModel: 'Nissan Leaf',
      vehiclePlate: 'LEF-2042',
    },
    openSupportTicket: jest.fn().mockResolvedValue({ ticket: { id: 'SUP-123' } }),
    supportLoading: false,
    supportError: '',
    driverActivationRemote: {
      updatedAt: '2026-05-19T10:00:00Z',
      documents: {
        cnh: { status: 'approved' },
        crlv: { status: 'in_review' },
      },
      vehicle: {
        model: 'Nissan Leaf',
        plate: 'LEF-2042',
        year: 2025,
      },
    },
    documentAnalysisState: {},
    driverCanGoOnline: false,
    refreshDriverActivationRemote: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function buildNavigation(overrides = {}) {
  return {
    navigate: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => false),
    ...overrides,
  };
}

describe('prototype new surfaces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePrototypeRideRuntime.mockReturnValue(buildRuntime());
  });

  it('renders the dedicated share trip surface and opens the public preview', () => {
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiShareTripScreen
        navigation={navigation}
        route={{ key: 'share-trip', params: { tripId: 'trip_1' } }}
      />
    );

    expect(screen.getByText('Acompanhar viagem')).toBeTruthy();
    expect(screen.getByText('Copiar link')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();

    fireEvent.press(screen.getByText('Prévia'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypePublicTracking',
      expect.objectContaining({
        tripId: 'trip_1',
        destination: 'Shopping Leblon',
        driverName: 'Motorista Leaf',
      })
    );
  });

  it('renders the public trip tracking surface with driver and route essentials', () => {
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiPublicTripTrackingScreen
        navigation={navigation}
        route={{
          key: 'public-trip',
          params: {
            tripId: 'trip_1',
            publicLink: 'https://leaf.app.br/viagem/trip_1',
          },
        }}
      />
    );

    expect(screen.getByText('Viagem em tempo real')).toBeTruthy();
    expect(screen.getByText('Chega em 8 min')).toBeTruthy();
    expect(screen.getByText('Motorista Leaf')).toBeTruthy();
    expect(screen.getByText('LEF-2042')).toBeTruthy();

    fireEvent.press(screen.getByText('Voltar para a viagem'));
    expect(navigation.navigate).toHaveBeenCalledWith('Splash');
  });

  it('renders payment methods with the PIX pilot fallback', async () => {
    getPaymentMethods.mockResolvedValueOnce([]);
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiPaymentMethodsScreen
        navigation={navigation}
        route={{ key: 'payment-methods', params: {} }}
      />
    );

    expect(screen.getByText('Métodos de pagamento')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('PIX é o padrão do piloto')).toBeTruthy();
      expect(screen.getByText('Adicionar método')).toBeTruthy();
    });
  });

  it('renders passenger invites and creates a referral invite', async () => {
    loadMyReferralInvites.mockResolvedValueOnce({
      sent: [{ id: 'invite_old', code: 'PSG-OLD', status: 'pending', type: 'passenger_referral' }],
      received: [],
    });
    createReferralInvite.mockResolvedValueOnce({
      invite: { id: 'invite_1', code: 'PSG-123', status: 'pending', type: 'passenger_referral' },
    });

    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiInvitesScreen
        navigation={navigation}
        route={{ key: 'invites', params: {} }}
      />
    );

    expect(screen.getByText('Convide passageiros')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('PSG-OLD')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('robotaxi-invites-target-input'), '+5521999999999');
    fireEvent.press(screen.getByText('Criar convite'));

    await waitFor(() => {
      expect(createReferralInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'passenger',
          inviteePhone: '+5521999999999',
        })
      );
      expect(screen.getByText('PSG-123')).toBeTruthy();
    });
  });

  it('renders driver waitlist and creates a driver invite', async () => {
    createReferralInvite.mockResolvedValueOnce({
      invite: { id: 'driver_invite_1', code: 'DRV-123', status: 'pending', type: 'driver_referral' },
    });

    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiDriverWaitlistScreen
        navigation={navigation}
        route={{ key: 'driver-waitlist', params: {} }}
      />
    );

    expect(screen.getByText('Waitlist e convites')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Rio de Janeiro')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Entrar na waitlist'));

    await waitFor(() => {
      expect(joinDriverWaitlist).toHaveBeenCalledWith({ city: 'Rio de Janeiro' });
    });

    fireEvent.changeText(screen.getByLabelText('robotaxi-driver-invite-target-input'), 'driver@leaf.app.br');
    fireEvent.press(screen.getByText('Criar convite'));

    await waitFor(() => {
      expect(createReferralInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'driver',
          inviteeEmail: 'driver@leaf.app.br',
        })
      );
      expect(screen.getByText('DRV-123')).toBeTruthy();
    });
  });

  it('submits a dedicated support ticket and exposes the created state', async () => {
    const runtime = buildRuntime();
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={navigation}
        route={{ key: 'support-ticket', params: { type: 'trip' } }}
      />
    );

    expect(screen.getByText('Abrir ticket')).toBeTruthy();

    fireEvent.changeText(
      screen.getByLabelText('robotaxi-support-ticket-description'),
      'Motorista não encontrou o ponto combinado.',
    );
    fireEvent.press(screen.getByText('Enviar ticket'));

    await waitFor(() => {
      expect(runtime.openSupportTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trip',
          priority: 'N3',
        })
      );
      expect(screen.getByText('Ticket #SUP-123 criado')).toBeTruthy();
    });
  });

  it('renders driver documents and vehicle management surfaces', () => {
    const navigation = buildNavigation();
    const docs = render(
      <RobotaxiDriverDocumentsScreen
        navigation={navigation}
        route={{ key: 'driver-documents', params: {} }}
      />
    );

    expect(docs.getByText('Documentos')).toBeTruthy();
    expect(docs.getByText('CNH com EAR')).toBeTruthy();
    expect(docs.getByText('Abrir ativação')).toBeTruthy();

    const vehicles = render(
      <RobotaxiVehiclesScreen
        navigation={navigation}
        route={{ key: 'vehicles', params: {} }}
      />
    );

    expect(vehicles.getByText('Veículos')).toBeTruthy();
    expect(vehicles.getAllByText('Nissan Leaf').length).toBeGreaterThan(0);
    expect(vehicles.getAllByText('LEF-2042').length).toBeGreaterThan(0);
    expect(vehicles.getByText('Adicionar ou trocar veículo')).toBeTruthy();
  });
});

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiDriverDocumentsScreen from '../src/screens/prototype/RobotaxiDriverDocumentsScreen';
import RobotaxiDriverActivationScreen from '../src/screens/prototype/RobotaxiDriverActivationScreen';
import RobotaxiDriverWaitlistScreen from '../src/screens/prototype/RobotaxiDriverWaitlistScreen';
import RobotaxiDriverWaitlistStatusScreen from '../src/screens/prototype/RobotaxiDriverWaitlistStatusScreen';
import RobotaxiInvitesScreen from '../src/screens/prototype/RobotaxiInvitesScreen';
import RobotaxiPublicTripTrackingScreen from '../src/screens/prototype/RobotaxiPublicTripTrackingScreen';
import RobotaxiShareTripScreen from '../src/screens/prototype/RobotaxiShareTripScreen';
import RobotaxiComplainScreen from '../src/screens/prototype/RobotaxiComplainScreen';
import RobotaxiSupportScreen from '../src/screens/prototype/RobotaxiSupportScreen';
import RobotaxiSupportTicketScreen from '../src/screens/prototype/RobotaxiSupportTicketScreen';
import RobotaxiVehiclesScreen from '../src/screens/prototype/RobotaxiVehiclesScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { createReferralInvite, loadMyReferralInvites } from '../src/services/runtime/referralProgramService';
import { joinDriverWaitlist, loadDriverWaitlistStatus } from '../src/services/runtime/driverWaitlistService';

const mockListVehicles = jest.fn();

jest.mock('../src/services/MobileVehicleService', () => ({
  __esModule: true,
  default: {
    listVehicles: (...args) => mockListVehicles(...args),
    addVehicle: jest.fn(),
    selectVehicle: jest.fn(),
    removeVehicle: jest.fn(),
  },
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

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
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
    criteria: { cityActive: true, waitListEnabled: true, documentsComplete: true },
  }),
  leaveDriverWaitlist: jest.fn().mockResolvedValue({ success: true }),
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
    reportIncident: jest.fn().mockResolvedValue({ incident: { id: 'INC-123' } }),
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
    mockListVehicles.mockResolvedValue([
      {
        id: 'vehicle_1',
        brand: 'Nissan',
        model: 'Leaf',
        plate: 'LEF-2042',
        year: 2025,
        status: 'approved',
        isActive: true,
      },
    ]);
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
    expect(screen.queryByText('WhatsApp')).toBeNull();

    fireEvent.press(screen.getByTestId('robotaxi-share-more-actions'));
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

  it('normalizes public trip tracking lifecycle aliases before rendering status', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      bookingStatus: 'trip_started',
    }));
    const screen = render(
      <RobotaxiPublicTripTrackingScreen
        navigation={buildNavigation()}
        route={{
          key: 'public-trip-started-alias',
          params: {
            tripId: 'trip_1',
          },
        }}
      />
    );

    expect(screen.getAllByText('Em viagem').length).toBeGreaterThan(0);
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
      expect(screen.getByText('Ativa')).toBeTruthy();
      expect(screen.getByText('Habilitada')).toBeTruthy();
      expect(screen.getByText('Completos')).toBeTruthy();
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

  it('blocks waitlist entry when city criteria cannot be confirmed', async () => {
    loadDriverWaitlistStatus.mockResolvedValueOnce(null);

    const screen = render(
      <RobotaxiDriverWaitlistScreen
        navigation={buildNavigation()}
        route={{ key: 'driver-waitlist-unavailable', params: {} }}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('robotaxi-driver-waitlist-unavailable-state')).toBeTruthy();
      expect(screen.getByText('Indisponível')).toBeTruthy();
    });

    const joinButton = screen.getByTestId('robotaxi-driver-waitlist-join-button');
    expect(joinButton.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(joinButton);
    expect(joinDriverWaitlist).not.toHaveBeenCalled();
  });

  it('renders the isolated driver waitlist status surface and joins from the app', async () => {
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiDriverWaitlistStatusScreen
        navigation={navigation}
        route={{ key: 'driver-waitlist-status', params: {} }}
      />
    );

    expect(loadDriverWaitlistStatus).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('Lista de espera')).toBeTruthy();
      expect(screen.getByText('Entre na lista da sua cidade')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('robotaxi-driver-waitlist-status-join-button'));

    await waitFor(() => {
      expect(joinDriverWaitlist).toHaveBeenCalledWith({ city: 'Rio de Janeiro' });
      expect(screen.getByText('Sua vaga está na fila')).toBeTruthy();
    });
  });

  it('submits a dedicated support ticket and exposes the created state', async () => {
    const runtime = buildRuntime();
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={navigation}
        route={{
          key: 'support-ticket',
          params: {
            type: 'trip',
            bookingId: 'booking_1',
            source: 'passenger-trip',
            bookingStatus: 'started',
          },
        }}
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
          bookingId: 'booking_1',
          source: 'passenger-trip',
          bookingStatus: 'started',
        })
      );
      expect(screen.getByText('Ticket #SUP-123 criado')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Acompanhar ticket'));

    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupportThread',
      expect.objectContaining({
        ticketId: 'SUP-123',
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );
  });

  it('opens a prefilled identity review ticket without offering another support decision', async () => {
    const runtime = buildRuntime();
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={buildNavigation()}
        route={{
          key: 'support-ticket-identity-review',
          params: {
            type: 'account',
            subject: 'Revisão de identidade',
            description: 'A validação de identidade não foi concluída. Acredito que houve um engano e solicito uma análise.',
            source: 'kyc_identity_mismatch_appeal',
            kycEvidenceId: 'evidence_01HZX9',
            kycReviewCaseId: 'case_01HZX9',
            kycChallengeId: 'challenge_01HZX9',
            requirement: 'IDENTITY_REVERIFICATION',
            reviewAvailable: true,
            similarityScore: 0.12,
            referenceImageUrl: 'https://storage.example/private-selfie.jpg',
          },
        }}
      />
    );

    expect(screen.getByLabelText('robotaxi-support-ticket-subject').props.value).toBe(
      'Revisão de identidade',
    );
    expect(screen.getByLabelText('robotaxi-support-ticket-description').props.value).toContain(
      'solicito uma análise',
    );
    expect(screen.getByTestId('robotaxi-support-ticket-type-account')).toBeTruthy();
    expect(screen.queryByTestId('robotaxi-support-ticket-type-payment')).toBeNull();
    expect(screen.queryByTestId('robotaxi-support-ticket-type-trip')).toBeNull();

    fireEvent.press(screen.getByLabelText('robotaxi-support-ticket-submit'));

    await waitFor(() => {
      expect(runtime.openSupportTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'account',
          priority: 'N2',
          subject: 'Revisão de identidade',
          source: 'kyc_identity_mismatch_appeal',
          kycEvidenceId: 'evidence_01HZX9',
          kycReviewCaseId: 'case_01HZX9',
          kycChallengeId: 'challenge_01HZX9',
          requirement: 'IDENTITY_REVERIFICATION',
          reviewAvailable: true,
        }),
      );
    });

    const submittedPayload = runtime.openSupportTicket.mock.calls[0][0];
    expect(submittedPayload).not.toHaveProperty('similarityScore');
    expect(submittedPayload).not.toHaveProperty('referenceImageUrl');
  });

  it('does not expose a technical backend error in the identity review ticket', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      supportError: 'AWS CompareFaces evidence signedUrl is unavailable (status 503)',
    }));
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={buildNavigation()}
        route={{
          key: 'support-ticket-identity-review-error',
          params: {
            source: 'kyc_identity_mismatch_appeal',
            kycEvidenceId: 'evidence_01HZX9',
          },
        }}
      />
    );

    expect(screen.getByText(
      'Não foi possível solicitar a análise agora. Tente novamente em instantes.',
    )).toBeTruthy();
    expect(screen.queryByText(/AWS|CompareFaces|signedUrl|status 503/i)).toBeNull();
  });

  it('returns a direct support ticket close to the canonical active ride route', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      bookingStatus: 'started',
    }));
    const navigation = buildNavigation({ canGoBack: jest.fn(() => false) });
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={navigation}
        route={{
          key: 'support-ticket-direct',
          params: {
            type: 'trip',
            bookingId: 'booking_1',
            source: 'passenger-trip',
            bookingStatus: 'started',
          },
        }}
      />
    );

    fireEvent.press(screen.getByLabelText('robotaxi-support-ticket-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeTrip',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      })
    );
  });

  it('returns completed support ticket aliases to the canonical receipt route', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      bookingStatus: 'trip_completed',
    }));
    const navigation = buildNavigation({ canGoBack: jest.fn(() => false) });
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={navigation}
        route={{
          key: 'support-ticket-completed-alias',
          params: {
            type: 'payment',
            bookingId: 'booking_1',
            source: 'passenger-trip',
            bookingStatus: 'trip_completed',
          },
        }}
      />
    );

    fireEvent.press(screen.getByLabelText('robotaxi-support-ticket-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.objectContaining({
        bookingId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'completed',
      })
    );
  });

  it('keeps receipt support scoped with billing priority and canonical return route', async () => {
    const runtime = buildRuntime({
      activeBookingId: null,
      bookingStatus: 'idle',
    });
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const navigation = buildNavigation({ canGoBack: jest.fn(() => false) });
    const receipt = { id: 'trip_1', status: 'completed' };
    const screen = render(
      <RobotaxiSupportScreen
        navigation={navigation}
        route={{
          key: 'support-receipt',
          params: {
            bookingId: 'trip_1',
            bookingStatus: 'completed',
            fromReceipt: true,
            initialTopicId: 'billing',
            receipt,
            source: 'receipt',
          },
        }}
      />
    );

    fireEvent.press(screen.getByLabelText('robotaxi-support-primary-action'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupportTicket',
      expect.objectContaining({
        bookingId: 'trip_1',
        bookingStatus: 'completed',
        priority: 'N2',
        severity: 'payment',
        source: 'receipt',
        type: 'payment',
      })
    );

    fireEvent.press(screen.getByTestId('robotaxi-support-option-safety'));
    fireEvent.press(screen.getByLabelText('robotaxi-support-primary-action'));

    await waitFor(() => {
      expect(runtime.reportIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'trip_1',
          bookingStatus: 'completed',
          priority: 'N1',
          severity: 'safety',
          source: 'receipt',
          type: 'safety',
        })
      );
    });

    fireEvent.press(screen.getByLabelText('robotaxi-support-more-actions'));
    fireEvent.press(screen.getByLabelText('robotaxi-support-open-complain'));
    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeComplain',
      expect.objectContaining({
        bookingId: 'trip_1',
        priority: 'N1',
        severity: 'safety',
        source: 'receipt',
        type: 'safety',
      })
    );

    fireEvent.press(screen.getByLabelText('robotaxi-support-close-button'));
    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.objectContaining({
        bookingId: 'trip_1',
        source: 'receipt',
      })
    );
  });

  it('routes general support chat to the current ticket composer without a booking', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      activeBookingId: null,
      activeBooking: null,
      bookingStatus: 'idle',
      driverActiveRide: null,
      driverTripMeta: null,
    }));
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiSupportScreen
        navigation={navigation}
        route={{
          key: 'support-general',
          params: {},
        }}
      />
    );

    expect(screen.queryByLabelText('robotaxi-support-open-chat')).toBeNull();
    fireEvent.press(screen.getByLabelText('robotaxi-support-more-actions'));
    fireEvent.press(screen.getByLabelText('robotaxi-support-open-chat'));

    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupportTicket',
      expect.objectContaining({
        source: 'support',
        type: 'payment',
      })
    );
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeChat',
      expect.any(Object)
    );
  });

  it('opens the current ticket thread after a general ticket without trip scope', async () => {
    const runtime = buildRuntime({
      activeBookingId: null,
      activeBooking: null,
      bookingStatus: 'idle',
    });
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiSupportTicketScreen
        navigation={navigation}
        route={{
          key: 'support-ticket-general',
          params: {
            type: 'trip',
            source: 'support-ticket',
          },
        }}
      />
    );

    fireEvent.changeText(
      screen.getByLabelText('robotaxi-support-ticket-description'),
      'Preciso de ajuda com minha conta.',
    );
    fireEvent.press(screen.getByText('Enviar ticket'));

    await waitFor(() => {
      expect(screen.getByText('Ticket #SUP-123 criado')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Acompanhar ticket'));

    expect(navigation.replace).toHaveBeenCalledWith(
      'RobotaxiPrototypeSupportThread',
      expect.objectContaining({
        source: 'support-ticket',
        ticketId: 'SUP-123',
        ticket: expect.objectContaining({ id: 'SUP-123' }),
      })
    );
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeChat',
      expect.any(Object)
    );
  });

  it('returns completed support aliases to the canonical receipt route', () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({
      activeBookingId: null,
      bookingStatus: 'trip_completed',
    }));
    const navigation = buildNavigation({ canGoBack: jest.fn(() => false) });
    const screen = render(
      <RobotaxiSupportScreen
        navigation={navigation}
        route={{
          key: 'support-completed-alias',
          params: {
            bookingId: 'trip_1',
            bookingStatus: 'trip_completed',
            source: 'passenger-trip',
          },
        }}
      />
    );

    fireEvent.press(screen.getByLabelText('robotaxi-support-close-button'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.objectContaining({
        bookingId: 'trip_1',
        source: 'passenger-trip',
        bookingStatus: 'completed',
      })
    );
  });

  it('submits scoped complaints with severity and priority metadata', async () => {
    const runtime = buildRuntime();
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const navigation = buildNavigation();
    const screen = render(
      <RobotaxiComplainScreen
        navigation={navigation}
        route={{
          key: 'complain-active',
          params: {
            bookingId: 'booking_1',
            bookingStatus: 'started',
            severity: 'payment',
            source: 'passenger-trip',
            type: 'payment',
          },
        }}
      />
    );

    fireEvent.changeText(
      screen.getByLabelText('robotaxi-complain-description'),
      'Valor cobrado não confere com o recibo.',
    );
    fireEvent.press(screen.getByLabelText('robotaxi-complain-submit'));

    await waitFor(() => {
      expect(runtime.openSupportTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking_1',
          bookingStatus: 'started',
          priority: 'N2',
          severity: 'payment',
          source: 'passenger-trip',
          type: 'complaint-payment',
        })
      );
    });
  });

  it('submits complaints with canonical completed booking status aliases', async () => {
    const runtime = buildRuntime();
    usePrototypeRideRuntime.mockReturnValue(runtime);
    const screen = render(
      <RobotaxiComplainScreen
        navigation={buildNavigation()}
        route={{
          key: 'complain-completed-alias',
          params: {
            bookingId: 'booking_1',
            bookingStatus: 'trip_completed',
            severity: 'payment',
            source: 'passenger-trip',
            type: 'payment',
          },
        }}
      />
    );

    fireEvent.changeText(
      screen.getByLabelText('robotaxi-complain-description'),
      'Valor cobrado não confere com o recibo.',
    );
    fireEvent.press(screen.getByLabelText('robotaxi-complain-submit'));

    await waitFor(() => {
      expect(runtime.openSupportTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking_1',
          bookingStatus: 'completed',
          source: 'passenger-trip',
          type: 'complaint-payment',
        })
      );
    });
  });

  it('renders driver documents and vehicle management surfaces', async () => {
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
    await waitFor(() => {
      expect(vehicles.getAllByText('Nissan Leaf').length).toBeGreaterThan(0);
      expect(vehicles.getAllByText(/LEF-2042/).length).toBeGreaterThan(0);
      expect(vehicles.getByText('Adicionar veículo')).toBeTruthy();
    });
  });

  it('uses the canonical CRLV vehicle identity on driver activation instead of a hardcoded vehicle label', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        driverActivation: {
          stages: {
            driver_data_activation: {
              status: 'approved',
              checklist: {
                cnhEar: true,
                vehicleRegistration: true,
                backgroundCheckConsent: true,
              },
            },
            face_validation: {
              status: 'approved',
              checklist: {
                facialValidation: true,
              },
            },
            vehicle_activation: {
              status: 'approved',
              checklist: {
                crlv: true,
              },
            },
          },
        },
        driverActivationRemote: {
          activationState: 'ACTIVE',
          checklist: {
            vehicleRegistration: true,
          },
          documents: {
            cnh: { status: 'approved' },
            crlv: {
              status: 'approved',
              data: {
                modelo: 'Nissan Leaf',
                cor: 'PRATA',
                placa: 'LEF-2042',
              },
            },
          },
        },
        documentAnalysisState: {},
      })
    );

    const screen = render(
      <RobotaxiDriverActivationScreen
        navigation={buildNavigation()}
        route={{ key: 'driver-activation', params: {} }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Nissan Leaf PRATA · LEF-2042')).toBeTruthy();
    });
    expect(screen.queryByText('Honda City branco')).toBeNull();
  });

  it('keeps the canonical vehicle pending after CRLV approval until the backend vehicle gate is complete', async () => {
    const navigation = buildNavigation();
    const localActivation = {
      stages: {
        driver_data_activation: {
          status: 'approved',
          checklist: {
            cnhEar: true,
            vehicleRegistration: true,
            backgroundCheckConsent: true,
          },
        },
        face_validation: {
          status: 'action_required',
          checklist: { facialValidation: false },
        },
        vehicle_activation: {
          status: 'approved',
          checklist: { crlv: true },
        },
      },
    };
    const crlvDocument = {
      status: 'approved',
      data: {
        modelo: 'Honda City',
        cor: 'BRANCO',
        placa: 'RJA-2D41',
      },
    };

    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        driverActivation: localActivation,
        driverActivationRemote: {
          activationState: 'VEHICLE_PENDING',
          checklist: { vehicleRegistration: false },
          blockingReason: 'Cadastro canônico do veículo pendente.',
          documents: {
            cnh: { status: 'approved' },
            crlv: crlvDocument,
          },
          vehicle: {
            approved: false,
            model: 'Honda City',
            color: 'BRANCO',
            plate: 'RJA-2D41',
          },
        },
      })
    );

    const screen = render(
      <RobotaxiDriverActivationScreen
        navigation={navigation}
        route={{ key: 'driver-activation-partial', params: {} }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Cadastro do veículo pendente')).toBeTruthy();
    });
    expect(screen.queryByText('Atualizado após CRLV')).toBeNull();
    expect(screen.queryByText('Automático')).toBeNull();
    expect(screen.queryByText('Honda City BRANCO · RJA-2D41')).toBeNull();
    expect(screen.queryByText('Iniciar validação')).toBeNull();
    fireEvent.press(screen.getByTestId('driver-activation-continue-button'));
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototype',
      expect.objectContaining({ requirement: 'LIVENESS_REQUIRED' }),
    );

    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        driverActivation: localActivation,
        driverActivationRemote: {
          activationState: 'APPROVED_NEEDS_LIVENESS',
          requiresLiveness: true,
          checklist: { vehicleRegistration: true },
          documents: {
            cnh: { status: 'approved' },
            crlv: crlvDocument,
          },
          vehicle: {
            approved: true,
            active: true,
            model: 'Honda City',
            color: 'BRANCO',
            plate: 'RJA-2D41',
          },
        },
      })
    );
    screen.rerender(
      <RobotaxiDriverActivationScreen
        navigation={navigation}
        route={{ key: 'driver-activation-partial', params: {} }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Honda City BRANCO · RJA-2D41')).toBeTruthy();
      expect(screen.getByText('Iniciar validação')).toBeTruthy();
    });
    expect(screen.queryByText('Cadastro do veículo pendente')).toBeNull();
  });

  it('refreshes driver activation again whenever the activation screen receives focus', async () => {
    const refreshDriverActivationRemote = jest.fn().mockResolvedValue(undefined);
    let focusHandler = null;
    const navigation = buildNavigation({
      addListener: jest.fn((eventName, handler) => {
        if (eventName === 'focus') {
          focusHandler = handler;
        }
        return jest.fn();
      }),
    });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        profile: { uid: 'driver_focus_refresh' },
        refreshDriverActivationRemote,
      })
    );

    render(
      <RobotaxiDriverActivationScreen
        navigation={navigation}
        route={{ key: 'driver-activation-focus', params: {} }}
      />
    );

    await waitFor(() => {
      expect(refreshDriverActivationRemote).toHaveBeenCalledTimes(1);
      expect(focusHandler).toEqual(expect.any(Function));
    });

    await act(async () => {
      focusHandler();
      await Promise.resolve();
    });

    expect(refreshDriverActivationRemote).toHaveBeenCalledTimes(2);
  });

  it('surfaces rejected driver documents as actionable review states instead of pending', async () => {
    const runtime = buildRuntime({
      driverActivation: {
        stages: {
          driver_data_activation: {
            status: 'action_required',
            checklist: {
              cnhEar: false,
              vehicleRegistration: false,
              backgroundCheckConsent: false,
            },
          },
        },
      },
      driverActivationRemote: {
        documents: {
          cnh: {
            status: 'rejected',
            reason: 'Documento ilegível',
          },
          crlv: {
            status: 'needs_attention',
            reason: 'Cor do veículo ausente',
          },
        },
      },
      documentAnalysisState: {
        byType: {
          cnh: {
            status: 'rejected',
            reason: 'Documento ilegível',
          },
          crlv: {
            status: 'needs_attention',
            reason: 'Cor do veículo ausente',
          },
        },
      },
    });
    usePrototypeRideRuntime.mockReturnValue(runtime);

    const docs = render(
      <RobotaxiDriverDocumentsScreen
        navigation={buildNavigation()}
        route={{ key: 'driver-documents', params: {} }}
      />
    );

    expect(docs.getAllByText('revisar').length).toBeGreaterThanOrEqual(2);
    expect(docs.queryByText('pendente')).toBeNull();
    docs.unmount();

    const activation = render(
      <RobotaxiDriverActivationScreen
        navigation={buildNavigation()}
        route={{ key: 'driver-activation', params: {} }}
      />
    );

    await waitFor(() => {
      expect(activation.getAllByText('Reenviar').length).toBeGreaterThanOrEqual(2);
      expect(activation.getByText('Documento ilegível')).toBeTruthy();
      expect(activation.getByText('Cor do veículo ausente')).toBeTruthy();
    });
  });

  it('opens the canonical KYC flow instead of approving facial validation locally', () => {
    const navigation = buildNavigation();
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        driverActivation: {
          stages: {
            driver_data_activation: {
              status: 'approved',
              checklist: {
                cnhEar: true,
                vehicleRegistration: true,
                backgroundCheckConsent: true,
              },
            },
            face_validation: {
              status: 'action_required',
              checklist: { facialValidation: false },
            },
            vehicle_activation: {
              status: 'approved',
              checklist: { crlv: true },
            },
          },
        },
        driverActivationRemote: {
          activationState: 'APPROVED_NEEDS_LIVENESS',
          requiresLiveness: true,
          checklist: { vehicleRegistration: true },
          documents: {
            cnh: { status: 'approved' },
            crlv: { status: 'approved' },
          },
        },
      })
    );

    const screen = render(
      <RobotaxiDriverActivationScreen
        navigation={navigation}
        route={{ key: 'driver-activation', params: {} }}
      />
    );

    fireEvent.press(screen.getByText('Iniciar validação'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototype',
      expect.objectContaining({
        notificationType: 'kyc_activation_required',
        requirement: 'LIVENESS_REQUIRED',
      })
    );
  });

  it('opens the document picker once when continuing driver activation', async () => {
    const DocumentPicker = require('expo-document-picker');
    DocumentPicker.getDocumentAsync.mockResolvedValueOnce({ canceled: true });
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({
        driverActivation: {
          stages: {
            driver_data_activation: {
              status: 'action_required',
              checklist: {
                cnhEar: false,
                vehicleRegistration: false,
                backgroundCheckConsent: false,
              },
            },
          },
        },
        driverActivationRemote: { documents: {} },
      })
    );

    const screen = render(
      <RobotaxiDriverActivationScreen
        navigation={buildNavigation()}
        route={{ key: 'driver-activation', params: {} }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Enviar')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('driver-activation-continue-button'));

    await waitFor(() => {
      expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1);
    });
  });
});

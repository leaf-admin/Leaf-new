import React from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiHomeScreen, {
  buildDriverIdentityReviewTicketParams,
  buildDriverIdentitySupportStorageKey,
  buildDestinationFareQuoteRouteKey,
  buildTrafficSegmentsFromDirectionsRoute,
  getHomeQuoteLockExpiresAtMs,
  normalizeHomeQuoteRefreshBudget,
  resolveHomeCategoryFarePresentation,
  resolveHomeQuoteExpiryAction,
  shouldProcessHomeQuoteExpiry,
} from '../src/screens/prototype/RobotaxiHomeScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
import { fetchDynamicPricingQuote } from '../src/services/runtime/pricingQuoteService';
import {
  resolvePassengerAutoRoute,
  shouldAutoSyncPassengerRoute,
} from '../src/screens/prototype/passengerFlowRouting';

const mockUseNavigationState = jest.fn((selector) =>
  selector({
    index: 0,
    routes: [{ name: 'RobotaxiPrototype', key: 'home' }],
  })
);
const mockUseIsFocused = jest.fn(() => true);
const mockPrototypeMapLayer = jest.fn(({ children }) => <View>{children}</View>);
const mockGetForegroundPermissionsAsync = jest.fn(() =>
  Promise.resolve({ status: 'granted' })
);

jest.mock('../src/screens/prototype/prototypeRideRuntime', () => ({
  usePrototypeRideRuntime: jest.fn(),
  extractPrototypeDriverKycFailureContext: jest.fn((error = {}) => {
    const payload = error?.payload && typeof error.payload === 'object' ? error.payload : {};
    const responseData = error?.response?.data && typeof error.response.data === 'object'
      ? error.response.data
      : {};
    const sources = [error, payload, responseData];
    const firstValue = (field) => sources
      .find((source) => source?.[field] !== undefined && source?.[field] !== null)
      ?.[field] ?? null;
    const reviewSource = sources.find(
      (source) => typeof source?.reviewAvailable === 'boolean',
    );
    return {
      challengeId: firstValue('challengeId'),
      requirement: firstValue('requirement'),
      evidenceId: firstValue('evidenceId'),
      reviewCaseId: firstValue('reviewCaseId'),
      reviewAvailable: reviewSource?.reviewAvailable ?? null,
    };
  }),
}));

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: (...args) => mockGetForegroundPermissionsAsync(...args),
}));

jest.mock('@react-navigation/native', () => ({
  useIsFocused: (...args) => mockUseIsFocused(...args),
  useNavigationState: (...args) => mockUseNavigationState(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockView = ({ children }) => <View>{children}</View>;
  return {
    __esModule: true,
    default: MockView,
    Polygon: MockView,
    Marker: MockView,
    Polyline: MockView,
  };
});

jest.mock('../src/components/prototype/PrototypeScreenTransition', () => {
  const React = require('react');
  return ({ children }) => <>{children}</>;
});

jest.mock('../src/components/prototype/PrototypeMapLayer', () => {
  return (...args) => mockPrototypeMapLayer(...args);
});

jest.mock('../src/components/prototype/PrototypeScaffold', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PrototypeBottomIsland: () => <View testID="passenger-bottom-island" />,
    PrototypeTopControls: () => <View testID="prototype-top-controls" />,
  };
});

jest.mock('../src/screens/prototype/home/PassengerHomeOverlay', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  const PassengerHomeOverlay = ({
    pickupLabel,
    pickupAddress,
    pickupCoordinate,
    destinationSearchActive,
    destinationSearchResults = [],
    onDestinationPress,
    onDestinationResultPress,
    categoryVisible,
    categoryOptions = [],
    selectedCategoryId,
    onCategoryConfirm,
    categoryConfirmDisabled,
    categoryConfirmLabel,
  }) => {
    const selectedCategory =
      categoryOptions.find((item) => item?.id === selectedCategoryId) ||
      categoryOptions[0] ||
      null;

    return (
      <View testID="passenger-home-overlay">
        <Text>{pickupLabel}</Text>
        <Text>{pickupAddress}</Text>
        <Text testID="passenger-home-overlay-pickup-coordinate">
          {pickupCoordinate
            ? `${pickupCoordinate.latitude},${pickupCoordinate.longitude}`
            : 'none'}
        </Text>
        <TouchableOpacity
          testID="mock-passenger-destination-open"
          onPress={onDestinationPress}
        >
          <Text>Abrir destino</Text>
        </TouchableOpacity>
        {destinationSearchActive
          ? destinationSearchResults.map((item, index) => (
              <TouchableOpacity
                key={item?.id || index}
                testID={`mock-passenger-destination-result-${index}`}
                onPress={() => onDestinationResultPress?.(item)}
              >
                <Text>{item?.name || item?.address || 'Destino'}</Text>
              </TouchableOpacity>
            ))
          : null}
        {categoryVisible ? (
          <View testID="mock-passenger-category-card">
            <Text testID="mock-passenger-category-description">
              {selectedCategory?.description || ''}
            </Text>
            <Text testID="mock-passenger-category-price">
              {selectedCategory?.priceLabel || ''}
            </Text>
            <Text testID="mock-passenger-category-arrival">
              {selectedCategory?.arrivalLabel || ''}
            </Text>
            <TouchableOpacity
              testID="mock-passenger-category-confirm"
              disabled={categoryConfirmDisabled}
              onPress={onCategoryConfirm}
            >
              <Text>{categoryConfirmLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };
  const PassengerHomeOverlaySkeleton = () => (
    <View testID="passenger-home-overlay-skeleton" />
  );

  return {
    __esModule: true,
    default: PassengerHomeOverlay,
    PassengerHomeOverlaySkeleton,
    PASSENGER_HOME_CARD_METRICS: {
      horizontalInset: 24,
      bottomOffset: 16,
      categoryBottomOffset: 41,
      height: 142,
      borderRadius: 28,
    },
  };
});

jest.mock('../src/screens/prototype/home/DriverHomeOverlay', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  const isDriverIdentitySupportRequired = (remoteActivation = {}) => {
    const activationState = String(
      remoteActivation?.activationState || remoteActivation?.state || '',
    ).toUpperCase();
    const hasFailedDocument = Object.values(
      remoteActivation?.documents || {},
    ).some(document =>
      ['failed', 'rejected', 'denied'].includes(
        String(document?.status || '').toLowerCase(),
      ),
    );
    const kycBlocked =
      remoteActivation?.kyc?.blocked === true ||
      ['blocked', 'rejected', 'failed', 'denied'].includes(
        String(remoteActivation?.kyc?.status || '').toLowerCase(),
      );
    const blockingReason = String(
      remoteActivation?.blockingReason || '',
    ).toUpperCase();

    return (
      (
        activationState === 'REJECTED' &&
        blockingReason.includes('KYC') &&
        !hasFailedDocument
      ) ||
      (
        ['REJECTED', 'SUSPENDED', 'BLOCKED'].includes(activationState) &&
        kycBlocked
      )
    );
  };

  return {
    __esModule: true,
    isDriverIdentitySupportRequired,
    default: ({
      onToggleOnline,
      onOpenActivation,
      onOpenIdentitySupport,
      driverCanGoOnline,
      driverActivationResolved,
      driverIdentitySupportRequired,
      driverActivationRemote,
    }) => {
      const supportRequired =
        driverIdentitySupportRequired === true ||
        isDriverIdentitySupportRequired(driverActivationRemote);
      const activationBlocked =
        !supportRequired &&
        driverActivationResolved === true &&
        driverCanGoOnline !== true &&
        driverActivationRemote?.canAttemptOnline !== true;
      const hasFailedDocument = Object.values(
        driverActivationRemote?.documents || {},
      ).some(document =>
        ['failed', 'rejected', 'denied'].includes(
          String(document?.status || '').toLowerCase(),
        ),
      );
      return (
        <TouchableOpacity
          testID="driver-home-toggle-online"
          onPress={
            supportRequired
              ? onOpenIdentitySupport
              : activationBlocked
                ? onOpenActivation
                : onToggleOnline
          }
        >
          <Text>
            {supportRequired
              ? 'Falar com suporte'
              : activationBlocked
                ? hasFailedDocument
                  ? 'Ação necessária'
                  : 'Em análise'
                : 'Ficar online'}
          </Text>
        </TouchableOpacity>
      );
    },
  };
});

jest.mock('../src/screens/prototype/home/DriverLiveRideOverlay', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  const ActualDriverLiveRideOverlay = jest.requireActual(
    '../src/screens/prototype/home/DriverLiveRideOverlay',
  ).default;
  return (props) => {
    if (props.driverActiveRide?.bookingId === 'booking_driver_viewport_contract') {
      return <ActualDriverLiveRideOverlay {...props} />;
    }

    return (
      <View testID="driver-live-ride-overlay-wrap" onLayout={props.onCardLayout}>
        <View testID="driver-live-trip-card">
          <View testID="driver-live-trip-compact-summary" />
          <View testID="driver-live-passenger-identity" />
          <View testID="driver-live-primary-action-complete-button" />
        </View>
        <TouchableOpacity testID="mock-driver-live-chat" onPress={props.onOpenChat}>
          <Text>Abrir chat atual</Text>
        </TouchableOpacity>
      </View>
    );
  };
});

jest.mock('../src/screens/prototype/home/DriverTripStatusBanner', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View />;
});

jest.mock('../src/screens/prototype/prototypeMapOcclusion', () => ({
  subscribePrototypeMapOcclusion: jest.fn(() => jest.fn()),
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock('../src/screens/prototype/prototypeMapRoute', () => ({
  clearPrototypeMapRoute: jest.fn(),
  getPrototypeMapRoute: jest.fn(() => ({ coordinates: [] })),
  setPrototypeMapRoute: jest.fn(),
  subscribePrototypeMapRoute: jest.fn(() => jest.fn()),
}));

jest.mock('../src/services/runtime/pricingQuoteService', () => ({
  fetchDynamicPricingQuote: jest.fn(),
}));

jest.mock('../src/screens/prototype/passengerFlowRouting', () => ({
  resolvePassengerAutoRoute: jest.fn(() => null),
  shouldAutoSyncPassengerRoute: jest.fn(() => false),
}));

jest.mock('../src/services/DriverExternalNavigationService', () => ({
  openDriverExternalNavigation: jest.fn(),
}));

jest.mock('../src/services/DriverAvailabilityService', () => ({
  __esModule: true,
  default: {
    startMonitoring: jest.fn(),
    stopMonitoring: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    getAvailableDrivers: jest.fn(() => []),
  },
}));

jest.mock('../src/services/runtime/h3MapService', () => ({
  fetchH3CellsForRegion: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: { getInstance: jest.fn(() => ({ on: jest.fn(), off: jest.fn() })) },
}));

jest.mock('../src/services/KYCService', () => ({
  __esModule: true,
  default: {
    getPreferredLivenessMode: jest.fn(() => Promise.resolve({ success: true, mode: 'aws' })),
    verifyDriver: jest.fn(() => Promise.resolve({ success: true, data: { isMatch: true } })),
    verifyDriverWithAwsReference: jest.fn(() =>
      Promise.resolve({ success: true, data: { isMatch: true } })
    ),
    getAwsProviderName: jest.fn(() => 'aws_rekognition_face_liveness'),
  },
}));

jest.mock('../src/services/NativeAwsLivenessService', () => ({
  __esModule: true,
  default: {
    isAvailable: jest.fn(() => true),
  },
}));

jest.mock('../src/components/KYC/KYCCameraScreen', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return ({ onCapture }) => (
    <TouchableOpacity testID="driver-kyc-camera" onPress={() => onCapture('selfie://ok')}>
      <Text>Validar identidade</Text>
    </TouchableOpacity>
  );
});

jest.mock('../src/components/KYC/AWSNativeLivenessScreen', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({ onSuccess }) => (
      <TouchableOpacity
        testID="driver-kyc-aws-native"
        onPress={() => onSuccess({ sessionId: 'aws-session-1' })}
      >
        <Text>Iniciar validação facial</Text>
      </TouchableOpacity>
    ),
  };
});

function buildDriverRuntime(overrides = {}) {
  return {
    activeRole: 'driver',
    ready: true,
    initializing: false,
    presentationSyncing: false,
    profile: {
      uid: 'driver_1',
      userType: 'driver',
      usertype: 'driver',
      name: 'Driver Test',
    },
    currentCoordinate: { latitude: -23.55, longitude: -46.63 },
    currentHeading: 0,
    driverCoordinate: { latitude: -23.55, longitude: -46.63 },
    trafficLayerEnabled: false,
    clearFlowPreview: jest.fn(),
    bookingStatus: 'idle',
    activeBooking: null,
    selectedDestination: null,
    selectedVehicle: null,
    tripDistanceKm: null,
    searchingElapsedSeconds: 0,
    unreadNotificationCount: 0,
    driverOnline: false,
    driverOnlinePending: false,
    driverCanGoOnline: true,
    driverActivationResolved: true,
    paymentMethod: 'pix',
    driverInfo: { id: 'driver_1', name: 'Driver Test' },
    setDriverOnline: jest.fn().mockResolvedValue({ success: true, isOnline: true }),
    refreshDriverActivationRemote: jest.fn().mockResolvedValue(undefined),
    tripHistory: [],
    driverOffers: [],
    driverActiveRide: null,
    driverExtensionRequest: { status: 'idle' },
    driverTripAssist: { status: '' },
    acceptDriverOffer: jest.fn(),
    rejectDriverOffer: jest.fn(),
    respondToDriverExtension: jest.fn(),
    interruptRideOperationalFlow: jest.fn(),
    markDriverArrived: jest.fn(),
    startTripFlow: jest.fn(),
    completeTripFlow: jest.fn(),
    ...overrides,
  };
}

function buildPassengerRuntime(overrides = {}) {
  return {
    activeRole: 'customer',
    ready: true,
    initializing: false,
    presentationSyncing: false,
    profile: {
      uid: 'customer_1',
      userType: 'customer',
      usertype: 'customer',
      name: 'Passenger Test',
    },
    currentCoordinate: { latitude: -23.55, longitude: -46.63 },
    currentHeading: 0,
    driverCoordinate: null,
    trafficLayerEnabled: false,
    clearFlowPreview: jest.fn(),
    bookingStatus: 'idle',
    activeBooking: null,
    selectedDestination: null,
    selectedVehicle: null,
    tripDistanceKm: null,
    searchingElapsedSeconds: 0,
    unreadNotificationCount: 0,
    driverOnline: false,
    driverOnlinePending: false,
    driverCanGoOnline: false,
    driverActivationResolved: true,
    paymentMethod: 'pix',
    driverInfo: null,
    setDriverOnline: jest.fn(),
    tripHistory: [],
    driverOffers: [],
    driverActiveRide: null,
    driverExtensionRequest: { status: 'idle' },
    driverTripAssist: null,
    acceptDriverOffer: jest.fn(),
    rejectDriverOffer: jest.fn(),
    cancelRideSearch: jest.fn(),
    endTripEarlyFlow: jest.fn(),
    respondOperationalContinuationFlow: jest.fn(),
    respondToDriverExtension: jest.fn(),
    interruptRideOperationalFlow: jest.fn(),
    markDriverArrived: jest.fn(),
    startTripFlow: jest.fn(),
    completeTripFlow: jest.fn(),
    dismissCompletedReceipt: jest.fn(),
    currentAddress: '1540 Mission St, San Francisco',
    ...overrides,
  };
}

describe('driver online toggle', () => {
  it('builds an identity review ticket with only opaque safe references', () => {
    const params = buildDriverIdentityReviewTicketParams(
      {
        evidenceId: 'evidence_01HZX9',
        reviewCaseId: 'case_01HZX9',
        challengeId: 'https://storage.example/private-selfie.jpg',
        requirement: 'identity_reverification',
        reviewAvailable: true,
        similarityScore: 0.12,
        sourceImageHash: 'sensitive-hash',
        referenceImageUrl: 'https://storage.example/private-selfie.jpg',
      },
      { challengeId: 'challenge_01HZX9' },
    );

    expect(params).toEqual({
      type: 'account',
      selectedType: 'account',
      subject: 'Revisão de identidade',
      description: 'A validação de identidade não foi concluída. Acredito que houve um engano e solicito uma análise.',
      source: 'kyc_identity_mismatch_appeal',
      kycEvidenceId: 'evidence_01HZX9',
      kycReviewCaseId: 'case_01HZX9',
      kycChallengeId: 'challenge_01HZX9',
      requirement: 'IDENTITY_REVERIFICATION',
      reviewAvailable: true,
    });
    expect(params).not.toHaveProperty('similarityScore');
    expect(params).not.toHaveProperty('sourceImageHash');
    expect(params).not.toHaveProperty('referenceImageUrl');
  });

  it('keeps selected passenger fare hidden while the backend quote is pending', () => {
    expect(
      resolveHomeCategoryFarePresentation({
        isSelectedCategory: true,
        quotePending: true,
        backendFare: null,
        localFare: 83.42,
      }),
    ).toEqual({
      fare: null,
      priceLabel: 'Calculando',
    });
  });

  it('uses the backend fare over the local estimate once the quote is ready', () => {
    expect(
      resolveHomeCategoryFarePresentation({
        isSelectedCategory: true,
        quotePending: false,
        backendFare: 54.73,
        localFare: 83.42,
      }),
    ).toEqual({
      fare: 54.73,
      priceLabel: 'R$ 54,73',
    });
  });

  it('keeps a precomputed fare visible while a selected category quote refreshes', () => {
    expect(
      resolveHomeCategoryFarePresentation({
        isSelectedCategory: true,
        quotePending: true,
        backendFare: null,
        localFare: 83.42,
        allowLocalEstimateWhilePending: true,
      }),
    ).toEqual({
      fare: 83.42,
      priceLabel: 'R$ 83,42',
    });
  });

  it('does not show a local fare while the selected backend quote is required', () => {
    expect(
      resolveHomeCategoryFarePresentation({
        isSelectedCategory: true,
        quotePending: false,
        backendQuoteRequired: true,
        backendFare: null,
        localFare: 83.42,
      }),
    ).toEqual({
      fare: null,
      priceLabel: 'Calculando',
    });
  });

  it('does not fall back to a local fare when the selected quote is unavailable', () => {
    expect(
      resolveHomeCategoryFarePresentation({
        isSelectedCategory: true,
        quotePending: false,
        backendQuoteRequired: true,
        quoteUnavailable: true,
        backendFare: null,
        localFare: 83.42,
      }),
    ).toEqual({
      fare: null,
      priceLabel: '--',
    });
  });

  it('automatically refreshes an expired home quote at most twice', () => {
    const firstExpiry = resolveHomeQuoteExpiryAction({
      automaticRefreshCount: 0,
    });
    const secondExpiry = resolveHomeQuoteExpiryAction({
      automaticRefreshCount: firstExpiry.nextAutomaticRefreshCount,
    });
    const thirdExpiry = resolveHomeQuoteExpiryAction({
      automaticRefreshCount: secondExpiry.nextAutomaticRefreshCount,
    });

    expect(firstExpiry).toEqual({
      action: 'refresh',
      nextAutomaticRefreshCount: 1,
    });
    expect(secondExpiry).toEqual({
      action: 'refresh',
      nextAutomaticRefreshCount: 2,
    });
    expect(thirdExpiry).toEqual({
      action: 'await_user',
      nextAutomaticRefreshCount: 2,
    });
  });

  it('recovers a stale quote refresh budget for the still-active route cycle', () => {
    expect(
      normalizeHomeQuoteRefreshBudget({
        budget: { key: 'stale-route', count: 2 },
        cycleKey: 'active-route',
      }),
    ).toEqual({
      key: 'active-route',
      count: 0,
    });
    expect(
      normalizeHomeQuoteRefreshBudget({
        budget: { key: 'active-route', count: 1 },
        cycleKey: 'active-route',
      }),
    ).toEqual({
      key: 'active-route',
      count: 1,
    });
  });

  it('processes each expired home quote only once across timeout and watchdog checks', () => {
    expect(
      shouldProcessHomeQuoteExpiry({
        expiresAtMs: 2000,
        nowMs: 1999,
        expiryKey: 'quote-a:2000',
      }),
    ).toBe(false);
    expect(
      shouldProcessHomeQuoteExpiry({
        expiresAtMs: 2000,
        nowMs: 2000,
        expiryKey: 'quote-a:2000',
      }),
    ).toBe(true);
    expect(
      shouldProcessHomeQuoteExpiry({
        expiresAtMs: 2000,
        nowMs: 2001,
        expiryKey: 'quote-a:2000',
        handledExpiryKey: 'quote-a:2000',
      }),
    ).toBe(false);
  });

  it('caps a home quote validity at two minutes after it is received', () => {
    const receivedAtMs = Date.parse('2026-08-03T05:00:00.000Z');

    expect(
      getHomeQuoteLockExpiresAtMs({
        receivedAtMs,
        quoteLockExpiresAt: '2026-08-03T11:00:00.000Z',
      }),
    ).toBe(receivedAtMs + 2 * 60 * 1000);
    expect(
      getHomeQuoteLockExpiresAtMs({
        receivedAtMs,
        quoteLockExpiresAt: '2026-08-03T05:01:00.000Z',
      }),
    ).toBe(receivedAtMs + 60 * 1000);
  });

  it('uses the passenger quote lock precision for the destination route key', () => {
    expect(
      buildDestinationFareQuoteRouteKey(
        { latitude: -22.9207879, longitude: -43.406031 },
        { latitude: -22.8710707, longitude: -43.3360867 },
      ),
    ).toBe('-22.921|-43.406|-22.871|-43.336');
  });

  it('renders full-route traffic when only route totals carry congestion timing', () => {
    const coordinates = [
      { latitude: -22.8537, longitude: -43.3096 },
      { latitude: -22.8702, longitude: -43.3401 },
      { latitude: -22.8771, longitude: -43.3432 },
    ];

    expect(buildTrafficSegmentsFromDirectionsRoute({
      duration_without_traffic: 756,
      duration_in_traffic: 1130,
      steps: [{ polylinePoints: '' }],
    }, coordinates)).toEqual([
      {
        coordinates,
        level: 'heavy',
        color: '#DC2626',
      },
    ]);
  });

  it('prefers explicit backend traffic segments over route-level congestion fallback', () => {
    const explicitSegments = [
      {
        coordinates: [
          { latitude: -22.8537, longitude: -43.3096 },
          { latitude: -22.8702, longitude: -43.3401 },
        ],
        level: 'normal',
        color: '#198754',
      },
      {
        coordinates: [
          { latitude: -22.8702, longitude: -43.3401 },
          { latitude: -22.8771, longitude: -43.3432 },
        ],
        level: 'heavy',
        color: '#DC2626',
      },
    ];

    expect(buildTrafficSegmentsFromDirectionsRoute({
      duration_without_traffic: 756,
      duration_in_traffic: 1130,
      trafficSegments: explicitSegments,
    }, [])).toBe(explicitSegments);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation(() => jest.fn());
    mockUseIsFocused.mockReturnValue(true);
    mockUseNavigationState.mockImplementation((selector) =>
      selector({
        index: 0,
        routes: [{ name: 'RobotaxiPrototype', key: 'home' }],
      })
    );
    resolvePassengerAutoRoute.mockReturnValue(null);
    shouldAutoSyncPassengerRoute.mockReturnValue(false);
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const kycServiceMock = require('../src/services/KYCService').default;
    kycServiceMock.getPreferredLivenessMode.mockResolvedValue({ success: true, mode: 'aws' });
    kycServiceMock.verifyDriver.mockResolvedValue({ success: true, data: { isMatch: true } });
    kycServiceMock.getAwsProviderName.mockReturnValue('aws_rekognition_face_liveness');
    const nativeAwsLivenessServiceMock = require('../src/services/NativeAwsLivenessService').default;
    nativeAwsLivenessServiceMock.isAvailable.mockReturnValue(true);
    fetchDynamicPricingQuote.mockReset();
    fetchDynamicPricingQuote.mockResolvedValue({
      estimatedFare: 20.23,
      grossEstimatedFare: 20.23,
      quoteLockId: 'quote-lock-home-retry',
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const { BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY } = require('../src/services/BackgroundLocationService');
    await AsyncStorage.setItem(BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY, 'true');
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  it('retries the same current destination after a canonical route 503 without exposing fallback fare or ETA', async () => {
    const destination = {
      id: 'place-leblon',
      name: 'Leblon',
      address: 'Rio de Janeiro - RJ, Brasil',
      coordinate: {
        latitude: -22.9842698,
        longitude: -43.223168,
      },
    };
    const routeCoordinates = [
      { latitude: -22.97045, longitude: -43.18276 },
      { latitude: -22.9768, longitude: -43.20085 },
      { latitude: -22.9842698, longitude: -43.223168 },
    ];
    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const selectDestination = jest.fn().mockResolvedValue(destination);
    const mapRoute = require('../src/screens/prototype/prototypeMapRoute');
    mapRoute.getPrototypeMapRoute.mockReturnValue({
      origin: routeCoordinates[0],
      destination: routeCoordinates[routeCoordinates.length - 1],
      coordinates: routeCoordinates,
      trafficSegments: [],
      destinationLabel: 'Leblon',
      destinationAddress: 'Rio de Janeiro - RJ, Brasil',
    });

    let directionsRequestCount = 0;
    const originalFetch = global.fetch;
    const directionsFetch = jest.fn(async (url) => {
      if (!String(url).includes('/api/places/directions')) {
        throw new Error(`Unexpected fetch in home route retry test: ${String(url)}`);
      }

      directionsRequestCount += 1;
      if (directionsRequestCount === 1) {
        return {
          ok: false,
          status: 503,
          json: jest.fn().mockResolvedValue({
            status: 'unavailable',
            code: 'canonical_route_required',
            message: 'Rota canônica indisponível para navegação.',
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          status: 'success',
          data: {
            coordinates: routeCoordinates,
            distance_in_km: 8.3,
            time_in_secs: 1080,
            trafficSegments: [],
          },
        }),
      };
    });
    global.fetch = directionsFetch;

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        currentCoordinate: routeCoordinates[0],
        currentAddress: 'Avenida Atlântica, 2213, Rio de Janeiro',
        loadRecentDestinations,
        loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
        resolveDestinationInput: jest.fn().mockResolvedValue(destination),
        selectDestination,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    try {
      const screen = render(
        <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />,
      );

      fireEvent.press(screen.getByTestId('mock-passenger-destination-open'));
      await waitFor(() => {
        expect(loadRecentDestinations).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('mock-passenger-destination-result-0')).toBeTruthy();
      });
      fireEvent.press(screen.getByTestId('mock-passenger-destination-result-0'));

      await waitFor(() => {
        expect(directionsRequestCount).toBe(1);
        expect(screen.getByText('Tentar novamente')).toBeTruthy();
      });
      expect(selectDestination).toHaveBeenCalledWith(destination);
      expect(screen.getByTestId('mock-passenger-category-description').props.children)
        .toBe('Rota indisponível no momento');
      expect(screen.getByTestId('mock-passenger-category-price').props.children)
        .toBe('--');
      expect(screen.getByTestId('mock-passenger-category-arrival').props.children)
        .toBe('--');
      expect(mapRoute.setPrototypeMapRoute).not.toHaveBeenCalled();
      expect(fetchDynamicPricingQuote).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('mock-passenger-category-confirm'));

      await waitFor(() => {
        expect(directionsRequestCount).toBe(2);
        expect(mapRoute.setPrototypeMapRoute).toHaveBeenCalledWith(
          expect.objectContaining({
            coordinates: routeCoordinates,
            destinationLabel: 'Leblon',
          }),
        );
        expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(3);
        expect(screen.getByText('Confirmar')).toBeTruthy();
      });
      expect(screen.getByTestId('mock-passenger-category-price').props.children)
        .toContain('20,23');
      expect(screen.getByTestId('mock-passenger-category-arrival').props.children)
        .not.toBe('--');
      expect(directionsFetch).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('executes exactly two automatic backend quote refreshes before requiring passenger action', async () => {
    const destination = {
      id: 'place-leblon-refresh',
      name: 'Leblon',
      address: 'Rio de Janeiro - RJ, Brasil',
      coordinate: {
        latitude: -22.9842698,
        longitude: -43.223168,
      },
    };
    const routeCoordinates = [
      { latitude: -22.97045, longitude: -43.18276 },
      { latitude: -22.9768, longitude: -43.20085 },
      { latitude: -22.9842698, longitude: -43.223168 },
    ];
    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const mapRoute = require('../src/screens/prototype/prototypeMapRoute');
    mapRoute.getPrototypeMapRoute.mockReturnValue({
      origin: routeCoordinates[0],
      destination: routeCoordinates[routeCoordinates.length - 1],
      coordinates: routeCoordinates,
      trafficSegments: [],
      destinationLabel: 'Leblon',
      destinationAddress: 'Rio de Janeiro - RJ, Brasil',
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (!String(url).includes('/api/places/directions')) {
        throw new Error(`Unexpected fetch in quote refresh test: ${String(url)}`);
      }

      return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          status: 'success',
          data: {
            coordinates: routeCoordinates,
            distance_in_km: 8.3,
            time_in_secs: 1080,
            trafficSegments: [],
          },
        }),
      };
    });
    fetchDynamicPricingQuote.mockImplementation(async () => ({
      estimatedFare: 20.23,
      grossEstimatedFare: 20.23,
      quoteLockId: `quote-lock-refresh-${fetchDynamicPricingQuote.mock.calls.length}`,
      quoteLockExpiresAt: new Date(Date.now() + 80).toISOString(),
      pricingPayload: {},
    }));

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        currentCoordinate: routeCoordinates[0],
        currentAddress: 'Avenida Atlântica, 2213, Rio de Janeiro',
        loadRecentDestinations,
        loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
        resolveDestinationInput: jest.fn().mockResolvedValue(destination),
        selectDestination: jest.fn().mockResolvedValue(destination),
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    try {
      const screen = render(
        <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />,
      );

      fireEvent.press(screen.getByTestId('mock-passenger-destination-open'));
      await waitFor(() => {
        expect(screen.getByTestId('mock-passenger-destination-result-0')).toBeTruthy();
      });
      fireEvent.press(screen.getByTestId('mock-passenger-destination-result-0'));

      await waitFor(() => {
        expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(9);
        expect(screen.getByText('Atualizar preço')).toBeTruthy();
      });

      const quoteSessionIds = fetchDynamicPricingQuote.mock.calls.map(
        ([payload]) => payload.quoteSessionId,
      );
      expect(new Set(quoteSessionIds)).toHaveProperty('size', 1);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(9);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows the daily online limit message when the backend forces the driver offline', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverOnline: false,
        driverOnlinePending: false,
        driverCanGoOnline: true,
        driverActivationResolved: true,
        driverOnlineDaily: {
          totalMs: 12 * 60 * 60 * 1000,
          effectiveMs: 12 * 60 * 60 * 1000,
          limitMs: 12 * 60 * 60 * 1000,
          limitReached: true,
        },
        driverTransientCard: {
          id: 'driver-online-limit-test',
          type: 'driver_online_daily_limit_reached',
          title: 'Tempo online encerrado',
          message: 'Você atingiu o limite de tempo online hoje.',
          visibleUntil: new Date(Date.now() + 12000).toISOString(),
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByText, getByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('driver-transient-state-card')).toBeTruthy();
    expect(getByText('Você atingiu o limite de tempo online hoje.')).toBeTruthy();
  });

  it('renders the welcome transition over the passenger home until runtime is ready', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        ready: false,
        initializing: true,
        profile: {
          uid: 'customer_1',
          userType: 'customer',
          usertype: 'customer',
          name: 'Izaak Dias',
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('prototype-home-loading')).toBeTruthy();
    expect(getByText('Bem vindo(a), Izaak')).toBeTruthy();
    expect(getByTestId('passenger-home-overlay-skeleton')).toBeTruthy();
    expect(queryByTestId('prototype-top-controls')).toBeNull();
    expect(mockPrototypeMapLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionEnabled: false,
      }),
      undefined
    );
  });

  it('replaces the passenger home with receipt when runtime is completed even before receipt hydration', async () => {
    resolvePassengerAutoRoute.mockReturnValue('RobotaxiPrototypeReceipt');
    shouldAutoSyncPassengerRoute.mockReturnValue(true);
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'completed',
        lastReceipt: null,
        tripHistory: [],
        activeBookingId: 'booking_completed_1',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_completed_1',
          fromTrip: true,
        })
      );
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeReceipt',
      expect.any(Object)
    );
  });

  it('routes terminal no-driver passenger home sync to the no-drivers surface', async () => {
    resolvePassengerAutoRoute.mockReturnValue('RobotaxiPrototypeNoDrivers');
    shouldAutoSyncPassengerRoute.mockReturnValue(true);
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'no_drivers_available',
        activeBookingId: 'booking_no_driver_1',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeNoDrivers',
        expect.objectContaining({
          bookingId: 'booking_no_driver_1',
          status: 'no_drivers_available',
        })
      );
    });
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeDriverSearch',
      expect.any(Object)
    );
  });

  it('routes terminal cancelled passenger home sync to the cancellation surface', async () => {
    resolvePassengerAutoRoute.mockReturnValue('RobotaxiPrototypeCancellation');
    shouldAutoSyncPassengerRoute.mockReturnValue(true);
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'cancelled',
        activeBookingId: 'booking_cancelled_1',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeCancellation',
        expect.objectContaining({
          bookingId: 'booking_cancelled_1',
          completed: true,
          source: 'search',
          status: 'cancelled',
        })
      );
    });
    expect(navigation.replace).not.toHaveBeenCalledWith(
      'RobotaxiPrototypeDriverSearch',
      expect.any(Object)
    );
  });

  it.each(['canceled', 'no_drivers_available', 'rejected'])(
    'renders an actionable driver home after terminal cleared status %s',
    (bookingStatus) => {
      usePrototypeRideRuntime.mockReturnValue(
        buildDriverRuntime({
          bookingStatus,
          activeBooking: null,
          activeBookingId: null,
          driverActiveRide: null,
          driverOffers: [],
        })
      );

      const navigation = {
        navigate: jest.fn(),
        replace: jest.fn(),
        canGoBack: jest.fn(() => false),
        goBack: jest.fn(),
      };

      const { getByTestId, queryByTestId } = render(
        <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
      );

      expect(getByTestId('driver-home-toggle-online')).toBeTruthy();
      expect(queryByTestId('passenger-driver-search-sheet')).toBeNull();
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.any(Object)
      );
    }
  );

  it('shows the welcome transition again when runtime hydration becomes pending', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        ready: true,
        initializing: false,
        presentationSyncing: false,
        profile: {
          uid: 'customer_1',
          userType: 'customer',
          usertype: 'customer',
          name: 'Izaak Dias',
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { queryByTestId, rerender } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    await act(async () => {});

    expect(queryByTestId('prototype-home-loading')).toBeNull();

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        ready: false,
        initializing: true,
        profile: {
          uid: 'customer_1',
          userType: 'customer',
          usertype: 'customer',
          name: 'Izaak Dias',
        },
      })
    );

    rerender(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    const loadingOverlay = queryByTestId('prototype-home-loading');
    expect(loadingOverlay).toBeTruthy();
    expect(loadingOverlay.props.accessibilityLabel).toBe('Bem vindo(a), Izaak');
    expect(mockPrototypeMapLayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        interactionEnabled: false,
      }),
      undefined
    );
  });

  it('does not trust a stale passenger pickup address when live coordinates are present', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        currentAddress: 'Rua das Pastorinhas, 12, Rio de Janeiro',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getAllByText, queryByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getAllByText('Local atual').length).toBeGreaterThan(0);
    expect(queryByText('Rua das Pastorinhas, 12')).toBeNull();
    expect(queryByText('Minha localização')).toBeNull();
  });

  it('does not expose a default pickup coordinate before live passenger location is resolved', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        currentCoordinate: null,
        currentAddress: '',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getAllByText, getByTestId, queryByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getAllByText('Local atual').length).toBeGreaterThan(0);
    expect(queryByText('Rua das Pastorinhas')).toBeNull();
    expect(getByTestId('passenger-home-overlay-pickup-coordinate')).toHaveTextContent('none');
  });

  it('uses the live passenger location as the home pickup coordinate without reusing stale text', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        currentCoordinate: { latitude: -22.853586, longitude: -43.318168 },
        currentAddress: 'Carioca Shopping, Rio de Janeiro',
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, queryByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByText('Carioca Shopping')).toBeNull();
    expect(getByTestId('passenger-home-overlay-pickup-coordinate')).toHaveTextContent(
      '-22.853586,-43.318168',
    );
    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.forceRegionUpdate).toBe(true);
    expect(latestMapProps.userCoordinate).toEqual({
      latitude: -22.853586,
      longitude: -43.318168,
    });
  });

  it('surfaces a failed online toggle result to the driver', async () => {
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: false,
      error: 'Não foi possível finalizar o modo online agora. Tente novamente.',
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Modo motorista',
        'Não foi possível finalizar o modo online agora. Tente novamente.'
      );
    });
  });

  it('starts KYC from the online action and resumes online automatically after approval', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    const setDriverOnline = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        code: 'kycRequired',
        kycRequired: true,
        reason: 'Nenhuma verificação encontrada',
        requirement: 'LIVENESS_REQUIRED',
      })
      .mockResolvedValueOnce({ success: true, isOnline: true });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(kycServiceMock.getPreferredLivenessMode).toHaveBeenCalled();
      expect(queryByTestId('driver-kyc-aws-native')).toBeTruthy();
      expect(Alert.alert).not.toHaveBeenCalledWith(
        'Modo motorista',
        expect.stringContaining('Nenhuma verificação')
      );
    });

    fireEvent.press(getByTestId('driver-kyc-aws-native'));

    await waitFor(() => {
      expect(kycServiceMock.verifyDriverWithAwsReference).toHaveBeenCalledWith(
        'driver_1',
        expect.objectContaining({
          awsSessionId: 'aws-session-1',
          requirement: 'LIVENESS_REQUIRED',
        }),
      );
      expect(setDriverOnline).toHaveBeenCalledTimes(2);
      expect(setDriverOnline).toHaveBeenLastCalledWith(true);
      expect(queryByTestId('driver-kyc-aws-native')).toBeNull();
    });
  });

  it('turns a canonical CompareFaces mismatch into a friendly identity-review ticket', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    kycServiceMock.verifyDriverWithAwsReference.mockResolvedValueOnce({
      success: false,
      status: 403,
      code: 'KYC_CHALLENGE_NOT_PASSED',
      error: 'AWS CompareFaces similarity below threshold 0.95',
      isMatch: false,
      reviewAvailable: true,
      evidenceId: 'evidence_01HZX9',
      similarityScore: 0.12,
      referenceImageUrl: 'https://storage.example/private-selfie.jpg',
    });
    const setDriverOnline = jest.fn().mockResolvedValueOnce({
      success: false,
      code: 'kycRequired',
      kycRequired: true,
      reason: 'Nenhuma verificação encontrada',
      challengeId: 'challenge_01HZX9',
      requirement: 'IDENTITY_REVERIFICATION',
    });
    const refreshDriverActivationRemote = jest
      .fn()
      .mockResolvedValue(undefined);

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        refreshDriverActivationRemote,
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(queryByTestId('driver-kyc-aws-native')).toBeTruthy();
    });

    fireEvent.press(getByTestId('driver-kyc-aws-native'));

    await waitFor(() => {
      expect(kycServiceMock.verifyDriverWithAwsReference).toHaveBeenCalledWith(
        'driver_1',
        {
          awsSessionId: 'aws-session-1',
          challengeId: 'challenge_01HZX9',
          requirement: 'IDENTITY_REVERIFICATION',
        },
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        'Identidade não confirmada',
        'Por segurança, não foi possível liberar o modo motorista. Se você acredita que houve um engano, solicite uma análise.',
        expect.any(Array),
      );
      expect(queryByTestId('driver-kyc-aws-native')).toBeNull();
      expect(getByText('Falar com suporte')).toBeTruthy();
    });

    expect(setDriverOnline).toHaveBeenCalledTimes(1);
    expect(refreshDriverActivationRemote).toHaveBeenCalledTimes(1);
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const supportStorageKey =
      buildDriverIdentitySupportStorageKey('driver_1');
    await waitFor(() => {
      const storageCall = AsyncStorage.setItem.mock.calls.find(
        ([key]) => key === supportStorageKey,
      );
      expect(storageCall).toBeTruthy();
      expect(JSON.parse(storageCall[1])).toEqual(
        expect.objectContaining({
          kycEvidenceId: 'evidence_01HZX9',
          kycChallengeId: 'challenge_01HZX9',
          requirement: 'IDENTITY_REVERIFICATION',
        }),
      );
      expect(storageCall[1]).not.toMatch(
        /similarity|referenceImageUrl|private-selfie/i,
      );
    });
    const [alertTitle, alertMessage, alertButtons] = Alert.alert.mock.calls.at(-1);
    expect(`${alertTitle} ${alertMessage}`).not.toMatch(
      /AWS|CompareFaces|KYC_|similarity|threshold|status\s*403|evidence_/i,
    );
    expect(alertButtons).toHaveLength(1);
    expect(alertButtons[0]?.text).toBe('Solicitar análise');

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeSupportTicket',
        expect.objectContaining({
          type: 'account',
          selectedType: 'account',
          subject: 'Revisão de identidade',
          description: 'A validação de identidade não foi concluída. Acredito que houve um engano e solicito uma análise.',
          source: 'kyc_identity_mismatch_appeal',
          kycEvidenceId: 'evidence_01HZX9',
          kycChallengeId: 'challenge_01HZX9',
          requirement: 'IDENTITY_REVERIFICATION',
          reviewAvailable: true,
        }),
      );
    });

    const [, ticketParams] = navigation.navigate.mock.calls.at(-1);
    expect(`${ticketParams.subject} ${ticketParams.description}`).not.toMatch(
      /AWS|CompareFaces|KYC_|similarity|threshold|status\s*403|evidence_/i,
    );
    expect(ticketParams).not.toHaveProperty('similarityScore');
    expect(ticketParams).not.toHaveProperty('referenceImageUrl');
    expect(ticketParams).not.toHaveProperty('error');
  });

  it('clears a local identity-support gate only after a semantic canonical release', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const supportStorageKey =
      buildDriverIdentitySupportStorageKey('driver_1');
    const initialActivationRemote = {
      activationState: 'APPROVED_NEEDS_LIVENESS',
      canGoOnline: false,
      canAttemptOnline: true,
      requiresLiveness: true,
      updatedAt: '2026-07-25T20:00:00.000Z',
      kyc: {
        status: 'pending_reverify',
        blocked: false,
        reverifyRequired: true,
      },
      documents: {
        cnh: { status: 'approved' },
        crlv: { status: 'approved' },
      },
      vehicle: {
        status: 'approved',
        approved: true,
        active: true,
        identityComplete: true,
      },
    };
    kycServiceMock.verifyDriverWithAwsReference.mockResolvedValueOnce({
      success: false,
      status: 403,
      code: 'KYC_CHALLENGE_NOT_PASSED',
      isMatch: false,
      reviewAvailable: true,
      evidenceId: 'evidence_semantic_release_01',
    });
    const setDriverOnline = jest.fn().mockResolvedValueOnce({
      success: false,
      code: 'kycRequired',
      kycRequired: true,
      challengeId: 'challenge_semantic_release_01',
      requirement: 'IDENTITY_REVERIFICATION',
    });
    let runtime = buildDriverRuntime({
      driverCanGoOnline: false,
      driverActivationRemote: initialActivationRemote,
      setDriverOnline,
    });
    usePrototypeRideRuntime.mockImplementation(() => runtime);

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const route = { params: {} };
    const {
      getByTestId,
      getByText,
      queryByText,
      rerender,
    } = render(
      <RobotaxiHomeScreen navigation={navigation} route={route} />,
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));
    await waitFor(() => {
      expect(getByTestId('driver-kyc-aws-native')).toBeTruthy();
    });
    fireEvent.press(getByTestId('driver-kyc-aws-native'));

    await waitFor(() => {
      expect(getByText('Falar com suporte')).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        AsyncStorage.setItem.mock.calls.some(
          ([key]) => key === supportStorageKey,
        ),
      ).toBe(true);
    });

    runtime = buildDriverRuntime({
      driverCanGoOnline: false,
      driverActivationRemote: {
        ...initialActivationRemote,
        updatedAt: '2026-07-25T20:05:00.000Z',
      },
      setDriverOnline,
    });
    rerender(
      <RobotaxiHomeScreen navigation={navigation} route={route} />,
    );

    await waitFor(() => {
      expect(getByText('Falar com suporte')).toBeTruthy();
    });
    expect(
      AsyncStorage.removeItem.mock.calls.some(
        ([key]) => key === supportStorageKey,
      ),
    ).toBe(false);

    runtime = buildDriverRuntime({
      driverCanGoOnline: true,
      driverActivationRemote: {
        ...initialActivationRemote,
        activationState: 'ACTIVE',
        canGoOnline: true,
        requiresLiveness: false,
        updatedAt: '2026-07-25T20:10:00.000Z',
        kyc: {
          status: 'approved',
          blocked: false,
          reverifyRequired: false,
        },
      },
      setDriverOnline,
    });
    rerender(
      <RobotaxiHomeScreen navigation={navigation} route={route} />,
    );

    await waitFor(() => {
      expect(queryByText('Falar com suporte')).toBeNull();
      expect(getByText('Ficar online')).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        AsyncStorage.removeItem.mock.calls.some(
          ([key]) => key === supportStorageKey,
        ),
      ).toBe(true);
    });
  });

  it('opens support for a canonical identity rejection without local review context', async () => {
    const setDriverOnline = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverCanGoOnline: false,
        driverActivationRemote: {
          activationState: 'REJECTED',
          canGoOnline: false,
          canAttemptOnline: false,
          requiresLiveness: false,
          blockingReason: 'KYC do motorista bloqueado.',
          documents: {
            cnh: { status: 'approved' },
            crlv: { status: 'approved' },
          },
        },
        setDriverOnline,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />,
    );

    await waitFor(() => {
      expect(getByText('Falar com suporte')).toBeTruthy();
    });

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeSupportTicket',
        expect.objectContaining({
          type: 'account',
          selectedType: 'account',
          subject: 'Revisão de identidade',
          source: 'kyc_identity_mismatch_appeal',
        }),
      );
    });
    expect(setDriverOnline).not.toHaveBeenCalled();
  });

  it('restores opaque identity-review references after an app relaunch', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const storageKey = buildDriverIdentitySupportStorageKey('driver_1');
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        type: 'account',
        selectedType: 'account',
        subject: 'Revisão de identidade',
        description: 'unsafe value must not be trusted',
        source: 'unsafe_source',
        kycEvidenceId: 'evidence_persisted_01',
        kycReviewCaseId: 'case_persisted_01',
        kycChallengeId: 'challenge_persisted_01',
        requirement: 'IDENTITY_REVERIFICATION',
        reviewAvailable: true,
        referenceImageUrl: 'https://storage.example/private-selfie.jpg',
      }),
    );

    const setDriverOnline = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverCanGoOnline: false,
        driverActivationRemote: {
          activationState: 'REJECTED',
          canAttemptOnline: false,
          kyc: { blocked: true, status: 'blocked' },
        },
        setDriverOnline,
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />,
    );

    await waitFor(() => {
      expect(getByText('Falar com suporte')).toBeTruthy();
    });

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeSupportTicket',
        {
          type: 'account',
          selectedType: 'account',
          subject: 'Revisão de identidade',
          description: 'A validação de identidade não foi concluída. Acredito que houve um engano e solicito uma análise.',
          source: 'kyc_identity_mismatch_appeal',
          kycEvidenceId: 'evidence_persisted_01',
          kycReviewCaseId: 'case_persisted_01',
          kycChallengeId: 'challenge_persisted_01',
          requirement: 'IDENTITY_REVERIFICATION',
          reviewAvailable: true,
        },
      );
    });

    const [, ticketParams] = navigation.navigate.mock.calls.at(-1);
    expect(ticketParams).not.toHaveProperty('referenceImageUrl');
    expect(setDriverOnline).not.toHaveBeenCalled();
    await AsyncStorage.removeItem(storageKey);
  });

  it.each([
    [
      'document rejection',
      {
        activationState: 'DRIVER_DOCS_PENDING',
        canAttemptOnline: false,
        documents: { cnh: { status: 'failed' } },
        kyc: { blocked: false, status: 'approved' },
      },
      'Ação necessária',
    ],
    [
      'vehicle review',
      {
        activationState: 'VEHICLE_IN_REVIEW',
        canAttemptOnline: false,
        vehicle: { status: 'in_review' },
        kyc: { blocked: false, status: 'approved' },
      },
      'Em análise',
    ],
  ])(
    'clears stale identity support when the canonical gate changes to %s',
    async (_scenario, nextActivationRemote, expectedActivationLabel) => {
      const AsyncStorage = require('@react-native-async-storage/async-storage');
      const storageKey = buildDriverIdentitySupportStorageKey('driver_1');
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({
          kycEvidenceId: 'evidence_resolved_01',
          kycReviewCaseId: 'case_resolved_01',
          reviewAvailable: true,
        }),
      );

      const setDriverOnline = jest.fn();
      let runtime = buildDriverRuntime({
        driverCanGoOnline: false,
        driverActivationRemote: {
          activationState: 'REJECTED',
          canAttemptOnline: false,
          kyc: { blocked: true, status: 'blocked' },
        },
        setDriverOnline,
      });
      usePrototypeRideRuntime.mockImplementation(() => runtime);

      const navigation = {
        navigate: jest.fn(),
        canGoBack: jest.fn(() => false),
        goBack: jest.fn(),
      };
      const route = { params: {} };
      const {
        getByTestId,
        getByText,
        queryByText,
        rerender,
      } = render(
        <RobotaxiHomeScreen navigation={navigation} route={route} />,
      );

      await waitFor(() => {
        expect(getByText('Falar com suporte')).toBeTruthy();
      });
      fireEvent.press(getByTestId('driver-home-toggle-online'));
      await waitFor(() => {
        expect(navigation.navigate).toHaveBeenCalledWith(
          'RobotaxiPrototypeSupportTicket',
          expect.objectContaining({
            kycEvidenceId: 'evidence_resolved_01',
            kycReviewCaseId: 'case_resolved_01',
          }),
        );
      });
      navigation.navigate.mockClear();

      runtime = buildDriverRuntime({
        driverCanGoOnline: false,
        driverActivationRemote: nextActivationRemote,
        setDriverOnline,
      });
      rerender(
        <RobotaxiHomeScreen navigation={navigation} route={route} />,
      );

      await waitFor(() => {
        expect(queryByText('Falar com suporte')).toBeNull();
        expect(getByText(expectedActivationLabel)).toBeTruthy();
      });
      await waitFor(async () => {
        await expect(AsyncStorage.getItem(storageKey)).resolves.toBeNull();
      });

      fireEvent.press(getByTestId('driver-home-toggle-online'));

      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeDriverActivation',
      );
      expect(navigation.navigate).not.toHaveBeenCalledWith(
        'RobotaxiPrototypeSupportTicket',
        expect.anything(),
      );
      expect(setDriverOnline).not.toHaveBeenCalled();
    },
  );

  it('keeps the driver offline without opening a new liveness while identity review is pending', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: false,
      code: 'KYC_IDENTITY_REVIEW_HOLD',
      kycRequired: true,
      reviewAvailable: true,
      evidenceId: 'evidence_01HZX9',
      reviewCaseId: 'case_01HZX9',
      error: 'Sua solicitação de análise de identidade está em andamento.',
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({ setDriverOnline })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Análise em andamento',
        'Sua identidade está sendo analisada. Avisaremos assim que houver uma atualização.',
        undefined,
      );
    });
    expect(kycServiceMock.getPreferredLivenessMode).not.toHaveBeenCalled();
    expect(queryByTestId('driver-kyc-camera')).toBeNull();
  });

  it('opens the canonical KYC modal when activation explicitly requests liveness', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    const navigation = {
      navigate: jest.fn(),
      setParams: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            notificationType: 'kyc_activation_required',
            requirement: 'LIVENESS_REQUIRED',
            reason: 'Conclua a validação facial para finalizar sua ativação.',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(kycServiceMock.getPreferredLivenessMode).toHaveBeenCalled();
      expect(getByTestId('driver-kyc-aws-native')).toBeTruthy();
      expect(navigation.setParams).toHaveBeenCalledWith(
        expect.objectContaining({ notificationType: null, requirement: null })
      );
    });
  });

  it('does not open the driver KYC modal over active driver work', async () => {
    const kycServiceMock = require('../src/services/KYCService').default;
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverTripAssist: { status: 'started' },
        driverActiveRide: {
          bookingId: 'booking_active_kyc_guard',
          id: 'booking_active_kyc_guard',
          status: 'started',
          pickupAddress: '1540 Mission St, San Francisco',
          dropoffAddress: '1 Ferry Building, San Francisco',
          estimatedDriverNetAmount: 15.01,
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      setParams: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { queryByText, queryByTestId } = render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            notificationType: 'kyc_activation_required',
            requirement: 'LIVENESS_REQUIRED',
            reason: 'Conclua a validação facial para finalizar sua ativação.',
          },
        }}
      />
    );

    await act(async () => {});

    expect(kycServiceMock.getPreferredLivenessMode).not.toHaveBeenCalled();
    expect(queryByText('Conclua a validação facial para finalizar sua ativação.')).toBeNull();
    expect(queryByText('Preparando validação facial...')).toBeNull();
    expect(queryByTestId('driver-kyc-camera')).toBeNull();
    expect(navigation.setParams).not.toHaveBeenCalled();
  });

  it('closes an already visible driver KYC modal when driver work becomes active', async () => {
    let runtime = buildDriverRuntime();
    usePrototypeRideRuntime.mockImplementation(() => runtime);

    const navigation = {
      navigate: jest.fn(),
      setParams: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const route = {
      params: {
        notificationType: 'kyc_activation_required',
        requirement: 'LIVENESS_REQUIRED',
        reason: 'Conclua a validação facial para finalizar sua ativação.',
      },
    };

    const { getByTestId, queryByText, queryByTestId, rerender } = render(
      <RobotaxiHomeScreen navigation={navigation} route={route} />
    );

    await waitFor(() => {
      expect(getByTestId('driver-kyc-aws-native')).toBeTruthy();
    });

    runtime = buildDriverRuntime({
      bookingStatus: 'started',
      driverTripAssist: { status: 'started' },
      driverActiveRide: {
        bookingId: 'booking_active_kyc_close',
        id: 'booking_active_kyc_close',
        status: 'started',
        pickupAddress: '1540 Mission St, San Francisco',
        dropoffAddress: '1 Ferry Building, San Francisco',
        estimatedDriverNetAmount: 15.01,
      },
    });

    rerender(<RobotaxiHomeScreen navigation={navigation} route={route} />);

    await waitFor(() => {
      expect(queryByText('Conclua a validação facial para finalizar sua ativação.')).toBeNull();
      expect(queryByText('Preparando validação facial...')).toBeNull();
      expect(queryByTestId('driver-kyc-camera')).toBeNull();
      expect(queryByTestId('driver-kyc-aws-native')).toBeNull();
    });
  });

  it('shows location guidance and allows opening settings when location permission blocks online mode', async () => {
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: false,
      error: 'Localização inicial não disponível para ativar modo online.',
    });
    mockGetForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const openSettingsSpy = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Ative a localização para ficar online',
        expect.stringContaining('A Leaf precisa da sua localização'),
        expect.any(Array),
        expect.objectContaining({ __skipFriendlyAlertPatch: true })
      );
    });

    const [, , buttons] = Alert.alert.mock.calls.at(-1);
    expect(Array.isArray(buttons)).toBe(true);
    expect(buttons[1]?.text).toBe('Abrir Ajustes');
    buttons[1]?.onPress?.();

    await waitFor(() => {
      expect(openSettingsSpy).toHaveBeenCalled();
    });

    openSettingsSpy.mockRestore();
  });

  it('does not block online activation while persisting the background location disclosure', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const {
      BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY,
    } = require('../src/services/BackgroundLocationService');

    let resolveDisclosurePersist;
    const disclosurePersistPromise = new Promise(resolve => {
      resolveDisclosurePersist = resolve;
    });
    const originalGetItem = AsyncStorage.getItem.bind(AsyncStorage);
    const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    const getItemSpy = jest
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementation(key => {
        if (key === BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY) {
          return Promise.resolve(null);
        }
        return originalGetItem(key);
      });
    const setItemSpy = jest
      .spyOn(AsyncStorage, 'setItem')
      .mockImplementation((key, value) => {
        if (
          key === BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY &&
          value === 'true'
        ) {
          return disclosurePersistPromise;
        }
        return originalSetItem(key, value);
      });
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: true,
      isOnline: true,
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const { getByTestId, getByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(getByText('Localização em segundo plano')).toBeTruthy();
    });

    fireEvent.press(getByTestId('permission-explanation-accept-button'));

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(true);
    });

    resolveDisclosurePersist();
    await act(async () => {
      await disclosurePersistPromise;
    });
    setItemSpy.mockRestore();
    getItemSpy.mockRestore();
  });

  it('keeps driver home surfaces visible while presentation sync runs after runtime is ready', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        presentationSyncing: true,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('driver-home-toggle-online')).toBeTruthy();
    expect(queryByTestId('prototype-home-loading')).toBeNull();
  });

  it('does not render driver home surfaces while the runtime is still initializing', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        ready: false,
        initializing: true,
        presentationSyncing: true,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('prototype-home-loading')).toBeTruthy();
    expect(queryByTestId('driver-home-toggle-online')).toBeNull();
  });

  it('does not project stale route state into the map while runtime presentation is syncing', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        coordinates: [
          { latitude: -23.55, longitude: -46.63 },
          { latitude: -23.56, longitude: -46.64 },
        ],
        destination: { latitude: -23.56, longitude: -46.64 },
        destinationLabel: 'Destino stale',
        destinationAddress: 'Rua stale, 123',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        presentationSyncing: true,
        bookingStatus: 'started',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.routeCoordinates).toEqual([]);
    expect(latestMapProps.searchingMode).toBe(false);
    expect(latestMapProps.destinationCoordinate).toBeNull();
  });

  it('keeps the idle driver car marker stable instead of following device compass heading', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'idle',
        currentHeading: 187,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.currentLocationMarkerMode).toBe('car');
    expect(latestMapProps.driverHeading).toBe(0);
    expect(latestMapProps.userHeading).toBeNull();
  });

  it('keeps the traffic layer off on the idle home map even when the setting is enabled', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        trafficLayerEnabled: true,
        bookingStatus: 'idle',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.showTraffic).toBe(false);
  });

  it('keeps the traffic layer off on idle home while a stale route preview is being cleared', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        coordinates: [
          { latitude: -23.55, longitude: -46.63 },
          { latitude: -23.56, longitude: -46.64 },
        ],
        destination: { latitude: -23.56, longitude: -46.64 },
        destinationLabel: 'Destino stale',
        destinationAddress: 'Rua stale, 123',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        trafficLayerEnabled: true,
        bookingStatus: 'idle',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.routeCoordinates).toHaveLength(2);
    expect(latestMapProps.routeSynthetic).toBe(false);
    expect(latestMapProps.showTraffic).toBe(false);
  });

  it('passes fallback route provenance to the map instead of inferring from point count', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        coordinates: [
          { latitude: -23.55, longitude: -46.63 },
          { latitude: -23.555, longitude: -46.635 },
          { latitude: -23.56, longitude: -46.64 },
          { latitude: -23.565, longitude: -46.645 },
        ],
        destination: { latitude: -23.565, longitude: -46.645 },
        destinationLabel: 'Destino fallback',
        destinationAddress: 'Rua fallback, 123',
        synthetic: true,
        routeSource: 'fallback',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.routeCoordinates).toHaveLength(4);
    expect(latestMapProps.routeSynthetic).toBe(true);
    expect(latestMapProps.routeSource).toBe('fallback');
  });

  it('colors the passenger pre-booking preview route with the worst traffic level', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        coordinates: [
          { latitude: -22.8499687, longitude: -43.3110186 },
          { latitude: -22.8710707, longitude: -43.3360867 },
        ],
        trafficSegments: [
          {
            coordinates: [
              { latitude: -22.8499687, longitude: -43.3110186 },
              { latitude: -22.8710707, longitude: -43.3360867 },
            ],
            level: 'heavy',
            color: '#DC2626',
          },
        ],
        destination: { latitude: -22.8710707, longitude: -43.3360867 },
        destinationLabel: 'Mercadão de Madureira',
        destinationAddress: 'Madureira',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.routeMainColor).toBe('#DC2626');
    expect(latestMapProps.animateRoute).toBe(false);
    expect(latestMapProps.routeTrafficSegments).toEqual([
      expect.objectContaining({
        level: 'heavy',
        color: '#DC2626',
      }),
    ]);
  });

  it('keeps the traffic layer off while the passenger has an active ride search', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        trafficLayerEnabled: true,
        bookingStatus: 'searching',
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
    });

    const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
    expect(latestMapProps.showTraffic).toBe(false);
  });

  it('does not render driver home surfaces before activation state resolves on boot', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverActivationResolved: false,
        driverCanGoOnline: false,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByTestId('driver-home-toggle-online')).toBeNull();
  });

  it('keeps the driver online toggle visible without showing the welcome overlay while activation is pending', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverActivationResolved: false,
        driverCanGoOnline: true,
        driverOnline: false,
        driverOnlinePending: true,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByTestId('driver-home-toggle-online')).toBeTruthy();
    expect(queryByTestId('prototype-home-loading')).toBeNull();
  });

  it('retries the driver online QA automation when the home is stuck pending', async () => {
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: true,
      isOnline: true,
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverOnline: false,
        driverOnlinePending: true,
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaDriverAction: 'set_online',
            qaNonce: 'retry-pending-online',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(true);
    });
  });

  it('allows the driver offline QA automation to clear a stuck pending state', async () => {
    const setDriverOnline = jest.fn().mockResolvedValue({
      success: true,
      isOnline: false,
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        driverOnline: false,
        driverOnlinePending: true,
        setDriverOnline,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaDriverAction: 'set_offline',
            qaNonce: 'clear-pending-offline',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(setDriverOnline).toHaveBeenCalledWith(false);
    });
  });

  it('clears stale passenger preview data when the home map is idle again', async () => {
    const clearFlowPreview = jest.fn();

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'idle',
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
          coordinate: { latitude: 37.7955, longitude: -122.3937 },
        },
        clearFlowPreview,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(clearFlowPreview).toHaveBeenCalled();
    });
  });

  it('replaces the current route with strong pickup and destination labels when passenger search is rehydrated', async () => {
    resolvePassengerAutoRoute.mockReturnValue('RobotaxiPrototypeDriverSearch');
    shouldAutoSyncPassengerRoute.mockReturnValue(true);

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching',
        selectedDestination: null,
        selectedVehicle: 'Leaf Plus',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: 'Ferry Building, San Francisco' },
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeDriverSearch',
        expect.objectContaining({
          destination: 'Ferry Building',
          destinationAddress: 'Ferry Building, San Francisco',
          originAddress: '1540 Mission St, San Francisco',
          vehicle: 'Leaf Plus',
        })
      );
      expect(navigation.navigate).not.toHaveBeenCalledWith(
        'RobotaxiPrototypeDriverSearch',
        expect.any(Object)
      );
    });
  });

  it('replaces the current route with the passenger trip surface to avoid back-stack regression', async () => {
    resolvePassengerAutoRoute.mockReturnValue('RobotaxiPrototypeTrip');
    shouldAutoSyncPassengerRoute.mockReturnValue(true);
    mockUseIsFocused.mockReturnValue(true);
    mockUseNavigationState.mockImplementation((selector) =>
      selector({
        index: 0,
        routes: [{ name: 'RobotaxiPrototype', key: 'home' }],
      })
    );

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        selectedVehicle: 'Leaf Plus',
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
          coordinate: { latitude: 37.7955, longitude: -122.3937 },
        },
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: '1 Ferry Building, San Francisco' },
        },
        driverInfo: { name: 'Motorista Teste' },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(<RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />);

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        'RobotaxiPrototypeTrip',
        expect.objectContaining({
          destination: 'Ferry Building',
          destinationAddress: '1 Ferry Building, San Francisco',
          originAddress: '1540 Mission St, San Francisco',
          vehicle: 'Leaf Plus',
          driverName: 'Motorista Teste',
        })
      );
      expect(navigation.navigate).not.toHaveBeenCalledWith(
        'RobotaxiPrototypeTrip',
        expect.any(Object)
      );
    });
  });

  it('hides passenger home chrome while the trip overlay is on top of the map', () => {
    mockUseIsFocused.mockReturnValue(false);
    mockUseNavigationState.mockImplementation((selector) =>
      selector({
        index: 1,
        routes: [
          { name: 'RobotaxiPrototype', key: 'home' },
          { name: 'RobotaxiPrototypeTrip', key: 'trip' },
        ],
      })
    );

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: '1 Ferry Building, San Francisco' },
        },
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
          coordinate: { latitude: 37.7955, longitude: -122.3937 },
        },
        driverCoordinate: { latitude: 37.7772, longitude: -122.4193 },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByTestId('passenger-bottom-island')).toBeNull();
    expect(queryByTestId('prototype-top-controls')).toBeNull();
    expect(mockPrototypeMapLayer).toHaveBeenCalledWith(
      expect.objectContaining({ interactionEnabled: false }),
      undefined
    );
  });

  it('keeps the focused passenger active-ride map interactive and fitted above the sheet chrome', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        origin: { latitude: 37.7772, longitude: -122.4193 },
        destination: { latitude: 37.7791, longitude: -122.4171 },
        coordinates: [
          { latitude: 37.7772, longitude: -122.4193 },
          { latitude: 37.7782, longitude: -122.4182 },
          { latitude: 37.7791, longitude: -122.4171 },
        ],
        trafficSegments: [],
        destinationLabel: 'Ferry Building',
        destinationAddress: '1 Ferry Building, San Francisco',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'accepted',
        activeBookingId: 'booking_1',
        activeBooking: {
          pickupLocation: { add: '1540 Mission St, San Francisco' },
          destinationLocation: { add: '1 Ferry Building, San Francisco' },
        },
        selectedDestination: {
          name: 'Ferry Building',
          address: '1 Ferry Building, San Francisco',
          coordinate: { latitude: 37.7791, longitude: -122.4171 },
        },
        driverCoordinate: { latitude: 37.7772, longitude: -122.4193 },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const { queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
      const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
      expect(latestMapProps.interactionEnabled).toBe(true);
      expect(latestMapProps.forceRegionUpdate).toBe(true);
      expect(latestMapProps.viewportPadding).toEqual(expect.objectContaining({
        bottom: expect.any(Number),
        top: expect.any(Number),
      }));
      expect(latestMapProps.viewportPadding.bottom).toBeGreaterThanOrEqual(300);
      expect(latestMapProps.routeViewportRegion).toEqual(expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        latitudeDelta: expect.any(Number),
        longitudeDelta: expect.any(Number),
      }));
    });

    expect(queryByTestId('passenger-bottom-island')).toBeNull();
    expect(queryByTestId('prototype-top-controls')).toBeNull();
  });

  it('keeps the current driver home route fitted after measuring the integrated live-ride card', async () => {
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    const routeCoordinates = [
      { latitude: 37.7772, longitude: -122.4193 },
      { latitude: 37.7782, longitude: -122.4182 },
      { latitude: 37.7791, longitude: -122.4171 },
    ];
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        origin: routeCoordinates[0],
        destination: routeCoordinates[routeCoordinates.length - 1],
        coordinates: routeCoordinates,
        trafficSegments: [],
        destinationLabel: 'Ferry Building',
        destinationAddress: '1 Ferry Building, San Francisco',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverCoordinate: routeCoordinates[0],
        currentCoordinate: routeCoordinates[0],
        driverActiveRide: {
          bookingId: 'booking_driver_viewport_contract',
          id: 'booking_driver_viewport_contract',
          status: 'started',
          pickupAddress: '1540 Mission St, San Francisco',
          dropoffAddress: '1 Ferry Building, San Francisco',
          estimatedDriverNetAmount: 15.01,
        },
        driverTripAssist: { status: 'started' },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(screen.getByTestId('driver-live-ride-overlay-wrap')).toBeTruthy();
    expect(screen.getByTestId('driver-live-trip-card')).toBeTruthy();
    expect(screen.getByTestId('driver-live-trip-compact-summary')).toBeTruthy();
    expect(screen.getByTestId('driver-live-passenger-identity')).toBeTruthy();
    expect(screen.getByTestId('driver-live-primary-action-complete-button')).toBeTruthy();
    expect(screen.queryByTestId('driver-live-trip-screen')).toBeNull();

    const mapWidth = 360;
    const mapHeight = 640;
    await waitFor(() => {
      expect(mockPrototypeMapLayer.mock.calls.at(-1)?.[0]?.onMapLayout).toEqual(
        expect.any(Function),
      );
    });
    act(() => {
      mockPrototypeMapLayer.mock.calls.at(-1)[0].onMapLayout({
        nativeEvent: { layout: { width: mapWidth, height: mapHeight } },
      });
    });
    fireEvent(screen.getByTestId('driver-live-ride-overlay-wrap'), 'layout', {
      nativeEvent: { layout: { width: mapWidth, height: 312 } },
    });

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
      const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
      expect(latestMapProps.interactionEnabled).toBe(true);
      expect(latestMapProps.forceRegionUpdate).toBe(true);
      expect(latestMapProps.viewportPadding).toEqual(expect.objectContaining({
        bottom: expect.any(Number),
        top: expect.any(Number),
      }));
      expect(latestMapProps.viewportPadding.bottom).toBeGreaterThanOrEqual(300);
      expect(latestMapProps.routeViewportRegion).toEqual(expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        latitudeDelta: expect.any(Number),
        longitudeDelta: expect.any(Number),
      }));

      const viewport = latestMapProps.routeViewportRegion;
      const padding = latestMapProps.viewportPadding;
      const activeMinVisibleHeight = 180;
      const top = Math.min(
        Number(padding.top) || 0,
        mapHeight - activeMinVisibleHeight,
      );
      const bottom = Math.min(
        Number(padding.bottom) || 0,
        mapHeight - top - activeMinVisibleHeight,
      );
      const left = Number(padding.left) || 0;
      const right = Number(padding.right) || 0;

      routeCoordinates.forEach((coordinate) => {
        const x = mapWidth / 2 +
          ((coordinate.longitude - viewport.longitude) / viewport.longitudeDelta) * mapWidth;
        const y = mapHeight / 2 -
          ((coordinate.latitude - viewport.latitude) / viewport.latitudeDelta) * mapHeight;

        expect(x).toBeGreaterThanOrEqual(left);
        expect(x).toBeLessThanOrEqual(mapWidth - right);
        expect(y).toBeGreaterThanOrEqual(top);
        expect(y).toBeLessThanOrEqual(mapHeight - bottom);
      });
    });
  });

  it('opens the current ride chat from the driver home with role-aware context', async () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        activeBookingId: 'booking_driver_chat',
        driverActiveRide: {
          bookingId: 'booking_driver_chat',
          id: 'booking_driver_chat',
          status: 'started',
          pickupAddress: '1540 Mission St, San Francisco',
          dropoffAddress: '1 Ferry Building, San Francisco',
          passengerId: 'passenger_1',
          estimatedDriverNetAmount: 15.01,
        },
        driverTripAssist: { status: 'started' },
      }),
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />,
    );

    fireEvent.press(await screen.findByTestId('mock-driver-live-chat'));

    expect(navigation.navigate).toHaveBeenCalledWith(
      'RobotaxiPrototypeChat',
      expect.objectContaining({
        bookingId: 'booking_driver_chat',
        rideId: 'booking_driver_chat',
        tripId: 'booking_driver_chat',
        bookingStatus: 'started',
        source: 'driver-home',
        role: 'driver',
      }),
    );
  });

  it('does not force overview fitting while native driver navigation owns the camera', async () => {
    const routeCoordinates = [
      { latitude: 37.7772, longitude: -122.4193 },
      { latitude: 37.7782, longitude: -122.4182 },
      { latitude: 37.7791, longitude: -122.4171 },
    ];
    const { subscribePrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
    subscribePrototypeMapRoute.mockImplementation((callback) => {
      callback({
        origin: routeCoordinates[0],
        destination: routeCoordinates[2],
        coordinates: routeCoordinates,
        trafficSegments: [],
        destinationLabel: 'Ferry Building',
        destinationAddress: '1 Ferry Building, San Francisco',
      });
      return jest.fn();
    });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverCoordinate: routeCoordinates[0],
        currentCoordinate: routeCoordinates[0],
        driverActiveRide: {
          bookingId: 'booking_driver_started_native',
          id: 'booking_driver_started_native',
          status: 'started',
          pickupAddress: '1540 Mission St, San Francisco',
          dropoffAddress: '1 Ferry Building, San Francisco',
          estimatedDriverNetAmount: 15.01,
        },
        driverTripAssist: {
          status: 'started',
          nativeNavigation: {
            isVisible: true,
            navigationKey: 'booking_driver_started_native:destination:started',
            currentCoordinate: routeCoordinates[0],
            targetCoordinate: routeCoordinates[2],
            routeCoordinates,
            cameraHeadingDegrees: 42,
            cameraZoom: 17,
            cameraPitch: 55,
            cameraAnchorY: 0.68,
            cameraAnimationDurationMs: 800,
          },
        },
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    await waitFor(() => {
      expect(mockPrototypeMapLayer).toHaveBeenCalled();
      const latestMapProps = mockPrototypeMapLayer.mock.calls.at(-1)?.[0] || {};
      expect(latestMapProps.interactionEnabled).toBe(true);
      expect(latestMapProps.forceRegionUpdate).toBe(false);
      expect(latestMapProps.routeViewportRegion).toEqual(expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
        latitudeDelta: expect.any(Number),
        longitudeDelta: expect.any(Number),
      }));
    });
  });

  it('accepts the driver offer through the home QA automation hook', async () => {
    const acceptDriverOffer = jest.fn().mockResolvedValue({ success: true });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'searching',
        driverOffers: [
          {
            bookingId: 'booking_qa_accept',
            id: 'booking_qa_accept',
            pickupAddress: '1540 Mission St, San Francisco',
            dropoffAddress: '1 Ferry Building, San Francisco',
            estimatedDriverNetAmount: 15.01,
            pricingSnapshotLocked: true,
            payout: 'R$ 15,01',
          },
        ],
        acceptDriverOffer,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaDriverAction: 'accept_offer',
            qaNonce: 'accept-once',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(acceptDriverOffer).toHaveBeenCalledWith(
        expect.objectContaining({ bookingId: 'booking_qa_accept' })
      );
    });
  });

  it('completes the trip through the home QA automation hook and opens the receipt', async () => {
    const completeTripFlow = jest.fn().mockResolvedValue({ success: true });

    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        bookingStatus: 'started',
        driverTripAssist: { status: 'started' },
        driverActiveRide: {
          bookingId: 'booking_qa_complete',
          id: 'booking_qa_complete',
          status: 'started',
          pickupAddress: '1540 Mission St, San Francisco',
          dropoffAddress: '1 Ferry Building, San Francisco',
          estimatedDriverNetAmount: 15.01,
        },
        completeTripFlow,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaDriverAction: 'complete_trip',
            qaNonce: 'complete-once',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(completeTripFlow).toHaveBeenCalled();
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeReceipt',
        expect.objectContaining({
          bookingId: 'booking_qa_complete',
          fromTrip: true,
        })
      );
    });
  });

  it('cleans up a passenger searching replacement ride through the home QA automation hook', async () => {
    const cancelRideSearch = jest.fn().mockResolvedValue({ success: true });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'searching_replacement',
        activeBookingId: 'booking_cleanup_1',
        cancelRideSearch,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaPassengerAction: 'cleanup_active',
            qaNonce: 'cleanup-searching-replacement',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(cancelRideSearch).toHaveBeenCalled();
    });
  });

  it('ends an interrupted operational ride through the home QA automation hook', async () => {
    const respondOperationalContinuationFlow = jest.fn().mockResolvedValue({ success: true });

    usePrototypeRideRuntime.mockReturnValue(
      buildPassengerRuntime({
        bookingStatus: 'operational_interrupted',
        activeBookingId: 'booking_interrupt_1',
        operationalContinuation: {
          status: 'passenger_decision_pending',
          bookingId: 'booking_interrupt_1',
        },
        respondOperationalContinuationFlow,
      })
    );

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    render(
      <RobotaxiHomeScreen
        navigation={navigation}
        route={{
          params: {
            qaAutomation: '1',
            qaPassengerAction: 'cleanup_active',
            qaNonce: 'cleanup-operational',
          },
        }}
      />
    );

    await waitFor(() => {
      expect(respondOperationalContinuationFlow).toHaveBeenCalledWith(false);
    });
  });
});

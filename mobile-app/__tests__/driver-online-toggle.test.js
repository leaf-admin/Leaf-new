import React from 'react';
import { Alert, Linking, Text, TouchableOpacity, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import RobotaxiHomeScreen from '../src/screens/prototype/RobotaxiHomeScreen';
import { usePrototypeRideRuntime } from '../src/screens/prototype/prototypeRideRuntime';
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
  const { Text, View } = require('react-native');
  const PassengerHomeOverlay = ({ pickupLabel, pickupAddress }) => (
    <View testID="passenger-home-overlay">
      <Text>{pickupLabel}</Text>
      <Text>{pickupAddress}</Text>
    </View>
  );
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
      height: 142,
      borderRadius: 28,
    },
  };
});

jest.mock('../src/screens/prototype/home/DriverHomeOverlay', () => {
  const React = require('react');
  const { TouchableOpacity, Text } = require('react-native');
  return ({ onToggleOnline }) => (
    <TouchableOpacity testID="driver-home-toggle-online" onPress={onToggleOnline}>
      <Text>Ficar online</Text>
    </TouchableOpacity>
  );
});

jest.mock('../src/screens/prototype/home/DriverLiveRideOverlay', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View />;
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
  subscribePrototypeMapRoute: jest.fn(() => jest.fn()),
}));

jest.mock('../src/screens/prototype/passengerFlowRouting', () => ({
  resolvePassengerAutoRoute: jest.fn(() => null),
  shouldAutoSyncPassengerRoute: jest.fn(() => false),
}));

jest.mock('../src/services/DriverExternalNavigationService', () => ({
  openDriverExternalNavigation: jest.fn(),
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
    getPreferredLivenessMode: jest.fn(() => Promise.resolve({ success: true, mode: 'local' })),
    verifyDriver: jest.fn(() => Promise.resolve({ success: true, data: { isMatch: true } })),
    getAwsProviderName: jest.fn(() => 'aws_rekognition_face_liveness'),
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

jest.mock('../src/components/KYC/AWSLivenessWebViewScreen', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return ({ onSuccess }) => (
    <TouchableOpacity testID="driver-kyc-aws" onPress={() => onSuccess({ sessionId: 'aws-session-1' })}>
      <Text>Validar identidade AWS</Text>
    </TouchableOpacity>
  );
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
  beforeEach(() => {
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
    kycServiceMock.getPreferredLivenessMode.mockResolvedValue({ success: true, mode: 'local' });
    kycServiceMock.verifyDriver.mockResolvedValue({ success: true, data: { isMatch: true } });
    kycServiceMock.getAwsProviderName.mockReturnValue('aws_rekognition_face_liveness');
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    Alert.alert.mockRestore();
  });

  it('renders a passenger card skeleton with the map until the home UI is ready', () => {
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

    const { getByTestId, queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByTestId('prototype-home-loading')).toBeNull();
    expect(getByTestId('passenger-home-overlay-skeleton')).toBeTruthy();
    expect(queryByTestId('prototype-top-controls')).toBeNull();
    expect(mockPrototypeMapLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionEnabled: false,
      }),
      undefined
    );
  });

  it('does not show the welcome loader again after the home surface has hydrated', async () => {
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

    expect(queryByTestId('prototype-home-loading')).toBeNull();
  });

  it('shows the passenger pickup street and number instead of a generic location label', () => {
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

    const { getByText, queryByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(getByText('Rua das Pastorinhas, 12')).toBeTruthy();
    expect(queryByText('Minha localização')).toBeNull();
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

  it('opens the driver KYC modal when recent verification is required to go online', async () => {
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

    const { getByTestId, getByText } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    fireEvent.press(getByTestId('driver-home-toggle-online'));

    await waitFor(() => {
      expect(kycServiceMock.getPreferredLivenessMode).toHaveBeenCalled();
      expect(getByText(/Nenhuma verificação encontrada/)).toBeTruthy();
      expect(getByText('Preparando validação facial...')).toBeTruthy();
      expect(Alert.alert).not.toHaveBeenCalledWith(
        'Modo motorista',
        expect.stringContaining('Nenhuma verificação')
      );
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

  it('does not render driver home surfaces while the runtime is still stabilizing', () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildDriverRuntime({
        presentationSyncing: true,
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

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
    expect(latestMapProps.showTraffic).toBe(false);
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
      })
    );

    const navigation = { navigate: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
    const { queryByTestId } = render(
      <RobotaxiHomeScreen navigation={navigation} route={{ params: {} }} />
    );

    expect(queryByTestId('driver-home-toggle-online')).toBeNull();
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

  it('pushes strong pickup and destination labels when passenger search is rehydrated from booking data', async () => {
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
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeDriverSearch',
        expect.objectContaining({
          destination: 'Ferry Building',
          destinationAddress: 'Ferry Building, San Francisco',
          originAddress: '1540 Mission St, San Francisco',
          vehicle: 'Leaf Plus',
        })
      );
      expect(navigation.replace).not.toHaveBeenCalled();
    });
  });

  it('opens the passenger trip as an overlay over the home map instead of replacing the base route', async () => {
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
      expect(navigation.navigate).toHaveBeenCalledWith(
        'RobotaxiPrototypeTrip',
        expect.objectContaining({
          destination: 'Ferry Building',
          destinationAddress: '1 Ferry Building, San Francisco',
          originAddress: '1540 Mission St, San Francisco',
          vehicle: 'Leaf Plus',
          driverName: 'Motorista Teste',
        })
      );
      expect(navigation.replace).not.toHaveBeenCalled();
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
        { fromTrip: true }
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

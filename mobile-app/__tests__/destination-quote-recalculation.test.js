import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import RobotaxiDestinationScreen from "../src/screens/prototype/RobotaxiDestinationScreen";
import { usePrototypeRideRuntime } from "../src/screens/prototype/prototypeRideRuntime";

jest.mock("../src/screens/prototype/prototypeRideRuntime", () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapOcclusion", () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock("../src/config/runtimeAccessPolicy", () => ({
  isE2ETestBuild: jest.fn(() => false),
}));

jest.mock("react-redux", () => ({
  useSelector: jest.fn((selector) =>
    selector({
      cartypes: {
        cars: [],
      },
    }),
  ),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const { View } = require("react-native");
  const FadeIn = {
    duration: jest.fn(() => FadeIn),
    easing: jest.fn(() => FadeIn),
  };

  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props, ref) => <View ref={ref} {...props} />),
    },
    View: React.forwardRef((props, ref) => <View ref={ref} {...props} />),
    Easing: {
      bezier: jest.fn(() => "bezier"),
    },
    FadeIn,
  };
});

jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    isRecognitionAvailable: jest.fn(() => true),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));

jest.mock("../src/components/prototype/PrototypeScreenTransition", () => {
  const React = require("react");
  return ({ children }) => <>{children}</>;
});

jest.mock("../src/components/prototype/PrototypeDismissibleSheet", () => {
  const React = require("react");
  const { View } = require("react-native");
  return ({ children }) => <View>{children}</View>;
});

jest.mock("../src/components/prototype/PrototypeUI", () => {
  const React = require("react");
  const { Text, TextInput, TouchableOpacity, View } = require("react-native");

  return {
    CardHandle: () => null,
    DestinationInput: ({ value, onChangeText, placeholder }) => (
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} />
    ),
    PrototypeCard: ({ children, ...props }) => <View {...props}>{children}</View>,
    PrototypePrimaryButton: ({ label, onPress, disabled }) => (
      <TouchableOpacity onPress={onPress} disabled={disabled}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock("../src/components/payment/WooviPaymentModal", () => {
  const React = require("react");
  return () => null;
});

describe("RobotaxiDestinationScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recalculates origin and fare in the quote before payment when runtime preview changes", async () => {
    const destination = {
      id: "destination_ferry_building",
      name: "Ferry Building",
      address: "1 Ferry Building, San Francisco, CA 94105, EUA",
      coordinate: {
        latitude: 37.7955,
        longitude: -122.3937,
      },
      eta: "5",
    };

    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const selectDestination = jest.fn().mockImplementation(async (item) => item);

    let runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "1540 Mission St, San Francisco",
      currentCoordinate: {
        latitude: 37.7749,
        longitude: -122.4194,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 13.42,
      selectedDestination: destination,
      tripDistanceKm: 4.7,
      tripDurationMin: 9,
      tripArrivalText: "01:36",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations,
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination,
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
      requestRide: jest.fn(),
      requestTripExtension: jest.fn(),
      clearFlowPreview: jest.fn(),
    };

    usePrototypeRideRuntime.mockImplementation(() => runtimeSnapshot);

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ferry Building")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Ferry Building"));

    await waitFor(() => {
      expect(selectDestination).toHaveBeenCalled();
      expect(screen.getByText("R$ 13,42")).toBeTruthy();
      expect(screen.getByText("1540 Mission St, San Francisco")).toBeTruthy();
    });

    runtimeSnapshot = {
      ...runtimeSnapshot,
      currentAddress: "Pier 39, San Francisco",
      currentCoordinate: {
        latitude: 37.8087,
        longitude: -122.4098,
      },
      tripDistanceKm: 7.2,
      tripDurationMin: 14,
      tripArrivalText: "01:42",
    };

    screen.rerender(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Pier 39, San Francisco")).toBeTruthy();
      expect(screen.getByText("R$ 18,55")).toBeTruthy();
    });
  });

  it("surfaces category unavailability when regional quote availability blocks the selected plan", async () => {
    const destination = {
      id: "destination_ferry_building",
      name: "Ferry Building",
      address: "1 Ferry Building, San Francisco, CA 94105, EUA",
      coordinate: {
        latitude: 37.7955,
        longitude: -122.3937,
      },
      eta: "5",
    };

    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: false,
      message: "Categoria indisponível nesta região no momento.",
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "1540 Mission St, San Francisco",
      currentCoordinate: {
        latitude: 37.7749,
        longitude: -122.4194,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 13.42,
      selectedDestination: destination,
      tripDistanceKm: 4.7,
      tripDurationMin: 9,
      tripArrivalText: "01:36",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability,
      requestRide: jest.fn(),
      requestTripExtension: jest.fn(),
      clearFlowPreview: jest.fn(),
    }));

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Ferry Building")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Ferry Building"));

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalled();
      expect(screen.getByText("Categoria indisponível")).toBeTruthy();
      expect(
        screen.getAllByText("Categoria indisponível nesta região no momento.").length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Indisponível").length).toBeGreaterThanOrEqual(1);
    });
  });
});

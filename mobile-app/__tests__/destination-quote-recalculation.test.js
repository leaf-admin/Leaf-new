import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import RobotaxiDestinationScreen from "../src/screens/prototype/RobotaxiDestinationScreen";
import { usePrototypeRideRuntime } from "../src/screens/prototype/prototypeRideRuntime";
import { fetchDynamicPricingQuote } from "../src/services/runtime/pricingQuoteService";

jest.mock("../src/screens/prototype/prototypeRideRuntime", () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock("../src/services/runtime/pricingQuoteService", () => ({
  fetchDynamicPricingQuote: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapOcclusion", () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapRoute", () => ({
  clearPrototypeMapRoute: jest.fn(),
  setPrototypeMapRoute: jest.fn(),
  subscribePrototypeMapCamera: jest.fn(() => jest.fn()),
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
  const { Text, TouchableOpacity, View } = require("react-native");
  return ({ visible, onPaymentConfirmed, estimates, tripData }) =>
    visible ? (
      <View>
        <Text testID="mock-pix-amount">
          {Number(estimates?.estimateFare ?? tripData?.estimatedFare).toFixed(2)}
        </Text>
        <TouchableOpacity
          testID="mock-confirm-pix"
          onPress={() =>
            onPaymentConfirmed?.({
              chargeId: "charge_test_1",
              rideId: "ride_test_1",
              amountInCents: 1777,
            })
          }
        >
          <Text>Mock Pix confirmado</Text>
        </TouchableOpacity>
      </View>
    ) : null;
});

describe("RobotaxiDestinationScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchDynamicPricingQuote.mockResolvedValue({
      estimatedFare: 13.42,
      grossEstimatedFare: 13.42,
      pricingPayload: {},
    });
  });

  it("uses the pickup chosen before destination and goes straight to the quote", async () => {
    const destination = {
      id: "destination_santos_dumont",
      name: "Aeroporto Santos Dumont",
      address: "Praça Senador Salgado Filho, Centro, Rio de Janeiro, RJ",
      coordinate: {
        latitude: -22.9104,
        longitude: -43.1631,
      },
      eta: "5",
    };

    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const selectDestination = jest.fn().mockImplementation(async (item) => item);
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });

    let runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
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
      checkRideAvailability,
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
    const initialPickupParams = {
      initialPickupCoordinate: {
        latitude: -22.9755,
        longitude: -43.19,
      },
      initialPickupAddress: "Portaria 2, Taquara, Rio de Janeiro",
      initialPickupAdjustedOnMap: true,
    };

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: initialPickupParams }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Aeroporto Santos Dumont")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Aeroporto Santos Dumont"));

    await waitFor(() => {
      const { setPrototypeMapRoute } = require("../src/screens/prototype/prototypeMapRoute");
      expect(selectDestination).toHaveBeenCalled();
      expect(checkRideAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          originCoordinate: expect.objectContaining({
            latitude: -22.9755,
            longitude: -43.19,
          }),
          pickupLocation: expect.objectContaining({
            add: "Portaria 2, Taquara, Rio de Janeiro",
          }),
        }),
      );
      expect(screen.getAllByText("Confirmar").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/R\$ 13,42/)).toBeTruthy();
      expect(screen.getByText("Portaria 2, Taquara, Rio de Janeiro")).toBeTruthy();
      expect(screen.queryByTestId("passenger-pickup-map-marker")).toBeNull();
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(setPrototypeMapRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: expect.objectContaining({
            latitude: -22.9755,
            longitude: -43.19,
          }),
        }),
      );
    });

    runtimeSnapshot = {
      ...runtimeSnapshot,
      currentAddress: "Rua Jardim Botânico, 1008, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9674,
        longitude: -43.2239,
      },
      tripDistanceKm: 7.2,
      tripDurationMin: 14,
      tripArrivalText: "01:42",
    };

    screen.rerender(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: initialPickupParams }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Portaria 2, Taquara, Rio de Janeiro")).toBeTruthy();
      expect(screen.getByText(/R\$ 13,42/)).toBeTruthy();
    });

    expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
  });

  it("surfaces category unavailability when regional quote availability blocks the selected plan", async () => {
    const destination = {
      id: "destination_santos_dumont",
      name: "Aeroporto Santos Dumont",
      address: "Praça Senador Salgado Filho, Centro, Rio de Janeiro, RJ",
      coordinate: {
        latitude: -22.9104,
        longitude: -43.1631,
      },
      eta: "5",
    };

    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: false,
      message: "Destino fora da area de cobertura da Leaf",
    });

    let runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
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
      expect(screen.getByText("Aeroporto Santos Dumont")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Aeroporto Santos Dumont"));

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalled();
      expect(
        screen.getAllByText("Destino fora da area de cobertura da Leaf").length,
      ).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Indisponível").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("does not hard-disable the category from a transient no-driver precheck", async () => {
    const destination = {
      id: "destination_santos_dumont",
      name: "Aeroporto Santos Dumont",
      address: "Praça Senador Salgado Filho, Centro, Rio de Janeiro, RJ",
      coordinate: {
        latitude: -22.9104,
        longitude: -43.1631,
      },
      eta: "5",
    };

    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: false,
      code: "NO_DRIVERS_AVAILABLE",
      message: "Não há motoristas disponíveis",
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
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

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
          goBack: jest.fn(),
        }}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Aeroporto Santos Dumont")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Aeroporto Santos Dumont"));

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalled();
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(screen.queryByText("Categoria indisponível")).toBeNull();
    });
  });

  it("uses the backend dynamic pricing quote before opening PIX", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 17.77,
      pricingPayload: {
        dynamic_percentage: 18,
        passenger_notice:
          "Tarifa alta",
      },
    });

    const destination = {
      id: "destination_santos_dumont",
      name: "Aeroporto Santos Dumont",
      address: "Praça Senador Salgado Filho, Centro, Rio de Janeiro, RJ",
      coordinate: {
        latitude: -22.9104,
        longitude: -43.1631,
      },
      eta: "5",
    };

    let runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
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
      expect(screen.getByText("Aeroporto Santos Dumont")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Aeroporto Santos Dumont"));

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          carType: "Leaf Plus",
          clientEstimatedFare: expect.any(Number),
          quoteSessionId: expect.stringMatching(/^passenger_quote_/),
          pickupLocation: expect.objectContaining({
            lat: -22.9711,
            lng: -43.1822,
          }),
          destinationLocation: expect.objectContaining({
            lat: -22.9104,
            lng: -43.1631,
          }),
        }),
        expect.objectContaining({
          signal: expect.any(Object),
          headers: expect.objectContaining({
            "x-leaf-quote-session-id": expect.stringMatching(/^passenger_quote_/),
          }),
        }),
      );
      expect(screen.getByText(/R\$ 17,77/)).toBeTruthy();
      expect(screen.getByTestId("passenger-destination-quote-price-plus")).toBeTruthy();
      expect(screen.getByTestId("passenger-destination-dynamic-pricing-badge")).toBeTruthy();
      expect(screen.getByText("Tarifa alta")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(runtimeSnapshot.checkRideAvailability).toHaveBeenCalled();
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("17.77");
    });

    runtimeSnapshot = {
      ...runtimeSnapshot,
      selectedDestination: {
        ...destination,
        address: "Endereço atualizado pela prévia de rota",
      },
      tripDistanceKm: 1.2,
      tripDurationMin: 3,
      tripArrivalText: "02:00",
    };

    screen.rerender(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/R\$ 17,77/)).toBeTruthy();
    });
    expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
  });

  it("opens the post-PIX preference countdown before sending the ride request", async () => {
    const destination = {
      id: "destination_shopping_leblon",
      name: "Shopping Leblon",
      address: "Av. Afrânio de Melo Franco, Leblon, Rio de Janeiro",
      coordinate: {
        latitude: -22.9834,
        longitude: -43.217,
      },
      eta: "7",
    };
    const requestRide = jest.fn().mockResolvedValue({ id: "booking_1" });
    const loadDestinationSuggestions = jest.fn().mockResolvedValue([destination]);
    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const resolveDestinationInput = jest.fn().mockImplementation(async (item) => item);
    const selectDestination = jest.fn().mockImplementation(async (item) => item);
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    const requestTripExtension = jest.fn();
    const clearFlowPreview = jest.fn();

    const runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 21.5,
      selectedDestination: destination,
      tripDistanceKm: 6.3,
      tripDurationMin: 14,
      tripArrivalText: "01:42",
      loadDestinationSuggestions,
      loadRecentDestinations,
      resolveDestinationInput,
      selectDestination,
      checkRideAvailability,
      requestRide,
      requestTripExtension,
      clearFlowPreview,
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
      expect(screen.getByText("Shopping Leblon")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Shopping Leblon"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(screen.getAllByText("Confirmar").length).toBeGreaterThanOrEqual(1);
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-confirm-pix")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("mock-confirm-pix"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-preference-countdown-modal")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-sound-option-low_music"));
    fireEvent.press(screen.getByTestId("passenger-preference-confirm-button"));

    await waitFor(() => {
      expect(requestRide).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupLocation: expect.objectContaining({
            lat: -22.9711,
            lng: -43.1822,
            add: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
          }),
          preferences: expect.objectContaining({
            temperatureLabel: "Ar-condicionado ligado",
            soundLabel: "Música baixa",
            soundPreference: "low_music",
          }),
          fare: 17.77,
        }),
      );
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototypePaymentSuccess",
        expect.objectContaining({ autoAdvance: true }),
      );
    });
  });

  it("sends Leaf Delas preferences when the route starts with the option enabled", async () => {
    const destination = {
      id: "destination_shopping_leblon",
      name: "Shopping Leblon",
      address: "Av. Afrânio de Melo Franco, Leblon, Rio de Janeiro",
      coordinate: {
        latitude: -22.9834,
        longitude: -43.217,
      },
      eta: "7",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: true,
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.9711,
        longitude: -43.1822,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 21.5,
      selectedDestination: destination,
      tripDistanceKm: 6.3,
      tripDurationMin: 14,
      tripArrivalText: "01:42",
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
        route={{ params: { leafDelas: true } }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Shopping Leblon")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Shopping Leblon"));

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupLocation: expect.objectContaining({
            lat: -22.9711,
            lng: -43.1822,
            add: "Rua das Pastorinhas, Taquara, Rio de Janeiro",
          }),
          preferences: expect.objectContaining({
            leafDelas: true,
            femaleDriverOnly: true,
            temperatureLabel: "Ar-condicionado ligado",
            soundLabel: "Pouca conversa",
          }),
        }),
      );
    });
  });

  it("hides fare values when route guard blocks an inconsistent origin/destination pair", async () => {
    const destination = {
      id: "destination_sdu",
      name: "Aeroporto Santos Dumont",
      address: "Praça Senador Salgado Filho, Centro, Rio de Janeiro, RJ, Brasil",
      coordinate: {
        latitude: -22.9104,
        longitude: -43.1631,
      },
      eta: "5",
    };

    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: true,
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
      expect(screen.getByText("Aeroporto Santos Dumont")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Aeroporto Santos Dumont"));

      await waitFor(() => {
        expect(
          screen.getAllByText(
          "Destino fora da area de cobertura da Leaf",
          ).length,
        ).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("Indisponível").length).toBeGreaterThanOrEqual(1);
      });

    expect(checkRideAvailability).not.toHaveBeenCalled();
    expect(screen.queryAllByText(/R\$\s/).length).toBe(0);
  });
});

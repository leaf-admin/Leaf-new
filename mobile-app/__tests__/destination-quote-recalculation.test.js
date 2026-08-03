import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

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
    PrototypePrimaryButton: ({ label, onPress, disabled, ...props }) => (
      <TouchableOpacity onPress={onPress} disabled={disabled} {...props}>
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock("../src/components/payment/WooviPaymentModal", () => {
  const React = require("react");
  const { Text, TouchableOpacity, View } = require("react-native");
  return ({
    visible,
    onClose,
    onPaymentAborted,
    onPaymentConfirmed,
    onPaymentExpired,
    estimates,
    tripData,
    quoteSessionId,
    quoteLockId,
  }) => {
    const amount = Number(estimates?.estimateFare ?? tripData?.estimatedFare);
    const confirmationOverrides =
      global.__LEAF_TEST_PIX_CONFIRMATION_OVERRIDES__ || {};
    return visible ? (
      <View>
        <Text testID="mock-pix-amount">{amount.toFixed(2)}</Text>
        <Text testID="mock-pix-quote-lock-id">{quoteLockId || "no-lock"}</Text>
        <Text testID="mock-pix-pickup-lat">{String(tripData?.pickup?.lat ?? "")}</Text>
        <Text testID="mock-pix-pickup-lng">{String(tripData?.pickup?.lng ?? "")}</Text>
        <Text testID="mock-pix-drop-lat">{String(tripData?.drop?.lat ?? "")}</Text>
        <Text testID="mock-pix-car-type">{String(tripData?.carType ?? "")}</Text>
        <TouchableOpacity
          testID="mock-confirm-pix"
          onPress={() =>
            onPaymentConfirmed?.({
              chargeId: "charge_test_1",
              rideId: "ride_test_1",
              amountInCents: Math.round(amount * 100),
              quoteSessionId,
              quoteLockId,
              ...confirmationOverrides,
            })
          }
        >
          <Text>Mock Pix confirmado</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="mock-confirm-pix-and-close"
          onPress={() => {
            const confirmation = {
              chargeId: "charge_test_confirmed_close",
              rideId: "ride_test_confirmed_close",
              amountInCents: Math.round(amount * 100),
              quoteSessionId,
              quoteLockId,
            };
            onPaymentConfirmed?.(confirmation);
            onClose?.({
              reason: "confirmed",
              chargeId: confirmation.chargeId,
              rideId: confirmation.rideId,
            });
          }}
        >
          <Text>Mock Pix confirmado e fechado</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="mock-expire-pix" onPress={() => onPaymentExpired?.()}>
          <Text>Mock Pix expirado</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="mock-close-pix" onPress={() => onClose?.()}>
          <Text>Mock Pix fechado</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="mock-fail-pix-close"
          onPress={() =>
            onPaymentAborted?.({
              reason: "generation_failed",
              error: "Sua sessão expirou. Entre novamente para continuar.",
              diagnostics: { status: 401, code: "PAYMENT_AUTH_TOKEN_MISSING" },
            })
          }
        >
          <Text>Mock Pix falhou</Text>
        </TouchableOpacity>
      </View>
    ) : null;
  };
});

describe("RobotaxiDestinationScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.__LEAF_TEST_PIX_CONFIRMATION_OVERRIDES__ = null;
    fetchDynamicPricingQuote.mockReset();
    fetchDynamicPricingQuote.mockResolvedValue({
      estimatedFare: 13.42,
      grossEstimatedFare: 13.42,
      quoteLockId: "ql_default_test",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });
  });

  it("routes terminal completion to receipt with booking and fare context", async () => {
    const destination = {
      id: "destination_ferry",
      name: "Ferry Building",
      address: "1 Ferry Building, San Francisco",
      coordinate: {
        latitude: 37.7955,
        longitude: -122.3937,
      },
      eta: "8",
    };
    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    usePrototypeRideRuntime.mockReturnValue({
      bookingStatus: "trip_completed",
      activeBookingId: "booking_destination_completed",
      activeBooking: {
        bookingId: "booking_destination_completed",
        pickupLocation: { add: "1540 Mission St, San Francisco" },
        destinationLocation: { add: "1 Ferry Building, San Francisco" },
        grossFare: 51.25,
      },
      currentAddress: "1540 Mission St, San Francisco",
      currentCoordinate: {
        latitude: 37.7749,
        longitude: -122.4194,
      },
      driverInfo: { id: "driver_1", name: "Motorista Leaf" },
      activeRole: "customer",
      connecting: false,
      profileUid: "customer_1",
      riderProfile: { name: "Passageira Leaf" },
      isSocketAuthenticated: true,
      isSocketConnected: true,
      selectedVehicle: "Leaf Plus",
      selectedFare: 51.25,
      selectedDestination: destination,
      tripDistanceKm: 7.4,
      tripDurationMin: 18,
      tripArrivalText: "Chegada em 18 min",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([]),
      loadRecentDestinations: jest.fn().mockResolvedValue([]),
      resolveDestinationInput: jest.fn().mockResolvedValue(destination),
      selectDestination: jest.fn().mockResolvedValue(destination),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
      requestRide: jest.fn(),
      requestTripExtension: jest.fn(),
      clearFlowPreview: jest.fn(),
    });

    render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{
          params: {
            initialPickupAddress: "1540 Mission St, San Francisco",
            initialSelectedDestination: destination,
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototypeReceipt",
        expect.objectContaining({
          bookingId: "booking_destination_completed",
          fare: 51.25,
          fromTrip: true,
          grossAmount: 51.25,
        }),
      );
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
          allowFallback: false,
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
      quoteLockId: "ql_backend_dynamic_1777",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
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
      expect(runtimeSnapshot.checkRideAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle: "Leaf Plus",
          pickupLocation: expect.objectContaining({
            lat: -22.9711,
            lng: -43.1822,
          }),
          originCoordinate: expect.objectContaining({
            latitude: -22.9711,
            longitude: -43.1822,
          }),
        }),
        expect.objectContaining({
          forceRefresh: true,
        }),
      );
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("17.77");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_backend_dynamic_1777",
      );
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
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("17.77");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_backend_dynamic_1777",
      );
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    });
    expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
  });

  it("does not show a provisional client fare while the backend quote is pending", async () => {
    let resolveQuote;
    fetchDynamicPricingQuote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuote = resolve;
        }),
    );

    const destination = {
      id: "destination_madureira",
      name: "Mercadão de Madureira",
      address: "Av. Min. Edgard Romero, Madureira, Rio de Janeiro",
      coordinate: {
        latitude: -22.8718,
        longitude: -43.3419,
      },
      eta: "7",
    };

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Carioca Shopping, Vicente de Carvalho, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.8536,
        longitude: -43.3108,
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
      tripDistanceKm: 5.8,
      tripDurationMin: 16,
      tripArrivalText: "14:20",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
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
      expect(screen.getByText("Mercadão de Madureira")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Mercadão de Madureira"));

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("passenger-destination-quote-price-plus").props.children).toBe("--");
      expect(screen.queryByText(/R\$ 13,42/)).toBeNull();
      expect(screen.getByText("Atualizando tarifa")).toBeTruthy();
    });

    resolveQuote({
      estimatedFare: 27.5,
      grossEstimatedFare: 27.5,
      pricingPayload: {},
    });

    await waitFor(() => {
      expect(screen.getByTestId("passenger-destination-quote-price-plus").props.children).toBe("--");
      expect(screen.queryByText(/R\$ 27,50/)).toBeNull();
      expect(screen.getByText("Tarifa indisponível")).toBeTruthy();
    });
  });

  it("keeps the quoted fare stable when GPS drifts inside the locked route bucket", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 83.4,
      grossEstimatedFare: 83.4,
      quoteLockId: "ql_stable_route_bucket",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    const destination = {
      id: "destination_barra",
      name: "Barra Shopping",
      address: "Av. das Américas, Barra da Tijuca, Rio de Janeiro",
      coordinate: {
        latitude: -22.9985,
        longitude: -43.3594,
      },
      eta: "8",
    };

    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });

    let runtimeSnapshot = {
      bookingStatus: "idle",
      currentAddress: "Rua Araguaia, Taquara, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.920816,
        longitude: -43.405979,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 83.4,
      selectedDestination: destination,
      tripDistanceKm: 20.7,
      tripDurationMin: 38,
      tripArrivalText: "12:48",
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
      expect(screen.getByText("Barra Shopping")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Barra Shopping"));

    await waitFor(() => {
      expect(screen.getByText(/R\$ 83,40/)).toBeTruthy();
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
    });

    runtimeSnapshot = {
      ...runtimeSnapshot,
      currentCoordinate: {
        latitude: -22.920846,
        longitude: -43.405949,
      },
      tripDistanceKm: 20.9,
      tripDurationMin: 39,
      tripArrivalText: "12:49",
    };

    screen.rerender(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{ params: {} }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/R\$ 83,40/)).toBeTruthy();
    });

    expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("83.40");
      expect(screen.getByTestId("mock-pix-pickup-lat").props.children).toBe(
        "-22.920816",
      );
      expect(screen.getByTestId("mock-pix-pickup-lng").props.children).toBe(
        "-43.405979",
      );
      expect(screen.getByTestId("mock-pix-drop-lat").props.children).toBe(
        "-22.9985",
      );
      expect(screen.getByTestId("mock-pix-car-type").props.children).toBe(
        "Leaf Plus",
      );
    });

    fireEvent.press(screen.getByTestId("mock-confirm-pix"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-preference-countdown-modal")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-preference-confirm-button"));

    await waitFor(() => {
      expect(runtimeSnapshot.requestRide).toHaveBeenCalledWith(
        expect.objectContaining({
          pickupLocation: expect.objectContaining({
            lat: -22.920816,
            lng: -43.405979,
          }),
          originCoordinate: expect.objectContaining({
            latitude: -22.920816,
            longitude: -43.405979,
          }),
          destination: expect.objectContaining({
            coordinate: expect.objectContaining({
              latitude: -22.9985,
              longitude: -43.3594,
            }),
          }),
          vehicle: "Leaf Plus",
          routeDistanceKm: 20.7,
          routeDurationSecs: 2280,
        }),
      );
    });
  });

  it("reuses the valid home quote before direct PIX without consuming another refresh", async () => {
    const nativeSetTimeout = global.setTimeout;
    let directPixAvailabilityTimeoutSchedules = 0;
    global.setTimeout = (callback, delay, ...args) => {
      if (delay === 15000) {
        directPixAvailabilityTimeoutSchedules += 1;
      }
      return nativeSetTimeout(callback, delay, ...args);
    };
    const destination = {
      id: "destination_copacabana_palace",
      name: "Copacabana Palace",
      address: "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro",
      coordinate: {
        latitude: -22.9673111,
        longitude: -43.1789541,
      },
      eta: "4",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    const requestRide = jest.fn().mockResolvedValue({ id: "booking_direct_pix_1" });
    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "4, Rua das Pastorinhas",
      currentCoordinate: {
        latitude: -22.920772,
        longitude: -43.4060272,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 80.39,
      selectedDestination: destination,
      tripDistanceKm: 23.8,
      tripDurationMin: 22,
      tripArrivalText: "22:48",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability,
      requestRide,
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.920781,
              longitude: -43.406005,
            },
            initialPickupAddress: "4, Rua das Pastorinhas",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            openPixOnReady: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 81.59,
                grossEstimatedFare: 81.59,
                carType: "leaf_plus",
                quoteLockId: "ql_home_quote_lock_1",
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_quote_lock_1",
              quoteLockId: "ql_home_quote_lock_1",
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              routeKey: "-22.921|-43.406|-22.967|-43.179",
              distanceKm: 23.8,
              durationMin: 22,
              arrivalTime: "22:48",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicle: "Leaf Plus",
        }),
        expect.objectContaining({
          forceRefresh: true,
        }),
      );
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("81.59");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_home_quote_lock_1",
      );
    });

    expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    expect(fetchDynamicPricingQuote).not.toHaveBeenCalled();
    const timeoutSchedulesBeforeConfirmation = directPixAvailabilityTimeoutSchedules;

    fireEvent.press(screen.getByTestId("mock-confirm-pix-and-close"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-preference-countdown-modal")).toBeTruthy();
    });
    expect(directPixAvailabilityTimeoutSchedules).toBe(
      timeoutSchedulesBeforeConfirmation,
    );
    fireEvent.press(screen.getByTestId("passenger-preference-confirm-button"));

    await waitFor(() => {
      expect(requestRide).toHaveBeenCalledWith(
        expect.objectContaining({
          fare: 81.59,
          paymentConfirmation: expect.objectContaining({
            chargeId: "charge_test_confirmed_close",
            quoteLockId: "ql_home_quote_lock_1",
          }),
        }),
      );
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototypePaymentSuccess",
        expect.objectContaining({ autoAdvance: true }),
      );
    });
    expect(navigation.replace).not.toHaveBeenCalledWith(
      "RobotaxiPrototype",
      expect.anything(),
    );
    global.setTimeout = nativeSetTimeout;
  });

  const verifyDirectPixAvailabilityTimeout = async () => {
    jest.useFakeTimers();
    const fakeSetTimeout = global.setTimeout;
    let directPixTimeoutCallback = null;
    global.setTimeout = (callback, delay, ...args) => {
      if (delay === 15000) {
        directPixTimeoutCallback = callback;
        return 15000;
      }
      return fakeSetTimeout(callback, delay, ...args);
    };
    const destination = {
      id: "destination_copacabana_palace",
      name: "Copacabana Palace",
      address: "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro",
      coordinate: {
        latitude: -22.9673111,
        longitude: -43.1789541,
      },
      eta: "4",
    };
    const checkRideAvailability = jest.fn(() => new Promise(() => {}));
    const loadDestinationSuggestions = jest.fn().mockResolvedValue([destination]);
    const loadRecentDestinations = jest.fn().mockResolvedValue([destination]);
    const resolveDestinationInput = jest.fn().mockImplementation(async (item) => item);
    const selectDestination = jest.fn().mockImplementation(async (item) => item);
    const requestRide = jest.fn();
    const requestTripExtension = jest.fn();
    const clearFlowPreview = jest.fn();

    usePrototypeRideRuntime.mockReturnValue({
      bookingStatus: "idle",
      currentAddress: "Av. Meriti, 9 - Vila Kosmos",
      currentCoordinate: {
        latitude: -22.857,
        longitude: -43.309,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 80.39,
      selectedDestination: destination,
      tripDistanceKm: 23.8,
      tripDurationMin: 22,
      tripArrivalText: "22:48",
      loadDestinationSuggestions,
      loadRecentDestinations,
      resolveDestinationInput,
      selectDestination,
      checkRideAvailability,
      requestRide,
      requestTripExtension,
      clearFlowPreview,
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.857,
              longitude: -43.309,
            },
            initialPickupAddress: "Av. Meriti, 9 - Vila Kosmos",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            openPixOnReady: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 81.59,
                grossEstimatedFare: 81.59,
                carType: "leaf_plus",
                quoteLockId: "ql_home_quote_lock_pending_availability",
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_quote_lock_pending_availability",
              quoteLockId: "ql_home_quote_lock_pending_availability",
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              routeKey: "-22.857|-43.309|-22.967|-43.179",
              distanceKm: 23.8,
              durationMin: 22,
              arrivalTime: "22:48",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalled();
    });
    expect(screen.queryByText("Escolha a categoria")).toBeNull();
    expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
    expect(screen.getByTestId("passenger-destination-direct-pix-preparing")).toBeTruthy();
    expect(screen.getByText("Preparando Pix")).toBeTruthy();

    expect(directPixTimeoutCallback).toEqual(expect.any(Function));
    act(() => directPixTimeoutCallback());

    expect(navigation.replace).toHaveBeenCalledWith(
      "RobotaxiPrototype",
      expect.objectContaining({
        passengerHomeAvailabilityNotice:
          "A validação de motoristas demorou mais que o esperado. Tente solicitar novamente.",
      }),
    );
    expect(screen.queryByTestId("passenger-destination-direct-pix-preparing")).toBeNull();
    expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
    screen.unmount();
    global.setTimeout = fakeSetTimeout;
    jest.clearAllTimers();
    jest.useRealTimers();
  };

  it("returns to the initial passenger home when a direct PIX payment expires", async () => {
    const destination = {
      id: "destination_copacabana_palace",
      name: "Copacabana Palace",
      address: "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro",
      coordinate: {
        latitude: -22.9673111,
        longitude: -43.1789541,
      },
      eta: "4",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "4, Rua das Pastorinhas",
      currentCoordinate: {
        latitude: -22.920772,
        longitude: -43.4060272,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 80.39,
      selectedDestination: destination,
      tripDistanceKm: 23.8,
      tripDurationMin: 22,
      tripArrivalText: "22:48",
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.920781,
              longitude: -43.406005,
            },
            initialPickupAddress: "4, Rua das Pastorinhas",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            openPixOnReady: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 81.59,
                grossEstimatedFare: 81.59,
                carType: "leaf_plus",
                quoteLockId: "ql_home_quote_lock_expiring",
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_quote_lock_expiring",
              quoteLockId: "ql_home_quote_lock_expiring",
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              routeKey: "-22.921|-43.406|-22.967|-43.179",
              distanceKm: 23.8,
              durationMin: 22,
              arrivalTime: "22:48",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("81.59");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_home_quote_lock_expiring",
      );
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    });
    expect(fetchDynamicPricingQuote).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("mock-expire-pix"));

    await waitFor(() => {
      expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
      expect(navigation.replace).toHaveBeenCalledWith("RobotaxiPrototype", {});
      expect(screen.queryByText("Para onde vamos?")).toBeNull();
      expect(screen.queryByText("Escolha a categoria")).toBeNull();
      expect(screen.queryByText("Tempo do PIX esgotado. Gere um novo pagamento para continuar.")).toBeNull();
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    });
  });

  it("returns to the initial passenger home when a manually opened PIX payment expires", async () => {
    const destination = {
      id: "destination_barra_shopping",
      name: "BarraShopping",
      address: "Av. das Americas, 4666 - Barra da Tijuca, Rio de Janeiro",
      coordinate: {
        latitude: -22.9996,
        longitude: -43.3659,
      },
      eta: "24",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 52.74,
      grossEstimatedFare: 52.74,
      quoteLockId: "ql_manual_pix_expiry",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Av. Meriti, 9 - Vila Kosmos",
      currentCoordinate: {
        latitude: -22.857,
        longitude: -43.309,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 52.74,
      selectedDestination: destination,
      tripDistanceKm: 24,
      tripDurationMin: 34,
      tripArrivalText: "23:41",
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.857,
              longitude: -43.309,
            },
            initialPickupAddress: "Av. Meriti, 9 - Vila Kosmos",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(screen.getByText(/R\$ 52,74/)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("52.74");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_manual_pix_expiry",
      );
    });

    fireEvent.press(screen.getByTestId("mock-expire-pix"));

    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith("RobotaxiPrototype", {});
      expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
      expect(screen.queryByText("Para onde vamos?")).toBeNull();
      expect(screen.queryByText("Escolha a categoria")).toBeNull();
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    });
  });

  it("returns to the initial passenger home when direct PIX generation fails and closes", async () => {
    const destination = {
      id: "destination_barra_shopping",
      name: "BarraShopping",
      address: "Av. das Americas, 4666 - Barra da Tijuca, Rio de Janeiro",
      coordinate: {
        latitude: -22.9996,
        longitude: -43.3659,
      },
      eta: "24",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 52.74,
      grossEstimatedFare: 52.74,
      quoteLockId: "ql_home_generation_failure",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Av. Meriti, 9 - Vila Kosmos",
      currentCoordinate: {
        latitude: -22.857,
        longitude: -43.309,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 52.74,
      selectedDestination: destination,
      tripDistanceKm: 24,
      tripDurationMin: 34,
      tripArrivalText: "23:41",
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.857,
              longitude: -43.309,
            },
            initialPickupAddress: "Av. Meriti, 9 - Vila Kosmos",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            openPixOnReady: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 52.74,
                grossEstimatedFare: 52.74,
                carType: "leaf_plus",
                quoteLockId: "ql_home_generation_failure",
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_generation_failure",
              quoteLockId: "ql_home_generation_failure",
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              routeKey: "-22.857|-43.309|-22.999|-43.365",
              distanceKm: 24,
              durationMin: 34,
              arrivalTime: "23:41",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("52.74");
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
    });

    fireEvent.press(screen.getByTestId("mock-fail-pix-close"));

    await waitFor(() => {
      expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
      expect(screen.queryByText("Para onde vamos?")).toBeNull();
      expect(screen.queryByText("Escolha a categoria")).toBeNull();
      expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototype",
        expect.objectContaining({
          passengerHomeAvailabilityNotice:
            "Sua sessão expirou. Entre novamente para continuar.",
        }),
      );
    });
  });

  it("returns direct home confirmation to the home card when final availability fails", async () => {
    const destination = {
      id: "destination_barra_shopping",
      name: "BarraShopping",
      address: "Av. das Americas, 4666 - Barra da Tijuca, Rio de Janeiro",
      coordinate: {
        latitude: -22.9996,
        longitude: -43.3659,
      },
      eta: "24",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({
      available: false,
      code: "DRIVER_SERVICE_UNAVAILABLE",
      message: "Servico de corridas indisponivel.",
      candidates: 1,
      eligible: 0,
      rejections: {
        offlineOrIneligible: 1,
      },
    });

    usePrototypeRideRuntime.mockReturnValue({
      bookingStatus: "idle",
      activeBookingId: null,
      activeBooking: null,
      lastRideBookingId: null,
      selectedFare: null,
      selectedVehicle: null,
      driverInfo: null,
      riderProfile: { uid: "passenger_home_direct_unavailable" },
      profileUid: "passenger_home_direct_unavailable",
      checkRideAvailability,
      requestRide: jest.fn(),
      requestTripExtension: jest.fn(),
      clearFlowPreview: jest.fn(),
    });

    const navigation = {
      navigate: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiDestinationScreen
        navigation={navigation}
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.857,
              longitude: -43.309,
            },
            initialPickupAddress: "Av. Meriti, 9 - Vila Kosmos",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            openPixOnReady: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 52.74,
                grossEstimatedFare: 52.74,
                carType: "leaf_plus",
                quoteLockId: "ql_home_unavailable_1",
                quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_unavailable_1",
              quoteLockId: "ql_home_unavailable_1",
              quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
              routeKey: "-22.857|-43.309|-22.999|-43.365",
              distanceKm: 24,
              durationMin: 34,
              arrivalTime: "23:41",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(checkRideAvailability).toHaveBeenCalled();
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototype",
        expect.objectContaining({
          passengerHomeAvailabilityNotice:
            "Motorista encontrado, mas ainda não elegível para receber corridas.",
        }),
      );
    });

    expect(screen.queryByText("Categoria escolhida")).toBeNull();
    expect(screen.queryByTestId("mock-pix-amount")).toBeNull();
    expect(screen.queryByText("Para onde vamos?")).toBeNull();
    expect(screen.queryByText("Escolha a categoria")).toBeNull();
    expect(screen.queryByTestId("passenger-destination-confirm-button")).toBeNull();
  });

  it("refreshes the home quote by route snapshot when route keys differ", async () => {
    const destination = {
      id: "destination_carioca_shopping",
      name: "Carioca Shopping",
      address: "Av. Vicente de Carvalho, 909 - Vila da Penha, Rio de Janeiro",
      coordinate: {
        latitude: -22.84578,
        longitude: -43.31093,
      },
      eta: "12",
    };
    const pickup = {
      latitude: -22.853586,
      longitude: -43.318168,
    };
    const quoteLockExpiresAt = new Date(Date.now() + 120000).toISOString();
    const quoteRouteSnapshot = {
      pickupLocation: {
        lat: pickup.latitude,
        lng: pickup.longitude,
        address: "Carioca Shopping",
      },
      destinationLocation: {
        lat: destination.coordinate.latitude,
        lng: destination.coordinate.longitude,
        address: destination.address,
      },
      carType: "Leaf Plus",
    };
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 97.76,
      grossEstimatedFare: 97.76,
      quoteLockId: "ql_fresh_snapshot_lock",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Carioca Shopping",
      currentCoordinate: pickup,
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 84.19,
      selectedDestination: destination,
      tripDistanceKm: 2.9,
      tripDurationMin: 9,
      tripArrivalText: "18:20",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
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
        route={{
          params: {
            initialPickupCoordinate: pickup,
            initialPickupAddress: "Carioca Shopping",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 97.76,
                grossEstimatedFare: 97.76,
                carType: "Leaf Plus",
                quoteLockId: "ql_home_snapshot_lock",
                quoteLockExpiresAt,
                pricingPayload: {},
                quoteRouteSnapshot,
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_snapshot_quote",
              quoteLockId: "ql_home_snapshot_lock",
              quoteLockExpiresAt,
              routeKey: "stale-route-key-from-previous-normalization",
              quoteRouteSnapshot,
              distanceKm: 2.9,
              durationMin: 9,
              arrivalTime: "18:20",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/R\$ 97,76/)).toBeTruthy();
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
    });

    expect(fetchDynamicPricingQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        carType: "Leaf Plus",
        quoteSessionId: expect.stringMatching(/^passenger_quote_/),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-leaf-quote-session-id": expect.stringMatching(/^passenger_quote_/),
        }),
      }),
    );

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("97.76");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_fresh_snapshot_lock",
      );
    });
  });

  it("refreshes an expired home quote lock before opening PIX", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 82.41,
      grossEstimatedFare: 82.41,
      quoteLockId: "ql_fresh_after_expired_home_lock",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    const destination = {
      id: "destination_copacabana_palace",
      name: "Copacabana Palace",
      address: "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro",
      coordinate: {
        latitude: -22.9673111,
        longitude: -43.1789541,
      },
      eta: "4",
    };
    const checkRideAvailability = jest.fn().mockResolvedValue({ available: true });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "4, Rua das Pastorinhas",
      currentCoordinate: {
        latitude: -22.920772,
        longitude: -43.4060272,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 80.39,
      selectedDestination: destination,
      tripDistanceKm: 23.8,
      tripDurationMin: 22,
      tripArrivalText: "22:48",
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.920781,
              longitude: -43.406005,
            },
            initialPickupAddress: "4, Rua das Pastorinhas",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 81.59,
                grossEstimatedFare: 81.59,
                carType: "leaf_plus",
                quoteLockId: "ql_expired_home_quote_lock",
                quoteLockExpiresAt: new Date(Date.now() - 1000).toISOString(),
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_quote_lock_expired",
              quoteLockId: "ql_expired_home_quote_lock",
              quoteLockExpiresAt: new Date(Date.now() - 1000).toISOString(),
              routeKey: "-22.921|-43.406|-22.967|-43.179",
              distanceKm: 23.8,
              durationMin: 22,
              arrivalTime: "22:48",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/R\$ 82,41/)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-pix-amount").props.children).toBe("82.41");
      expect(screen.getByTestId("mock-pix-quote-lock-id").props.children).toBe(
        "ql_fresh_after_expired_home_lock",
      );
    });
  });

  it("refetches the route quote when the initial quote has no backend lock", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 80.39,
      grossEstimatedFare: 80.39,
      quoteLockId: "ql_refetched_after_missing_lock",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    const destination = {
      id: "destination_copacabana_palace",
      name: "Copacabana Palace",
      address: "Av. Atlântica, 1702 - Copacabana, Rio de Janeiro",
      coordinate: {
        latitude: -22.9673111,
        longitude: -43.1789541,
      },
      eta: "4",
    };

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "4, Rua das Pastorinhas",
      currentCoordinate: {
        latitude: -22.920772,
        longitude: -43.4060272,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 81.59,
      selectedDestination: destination,
      tripDistanceKm: 23.8,
      tripDurationMin: 22,
      tripArrivalText: "22:48",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
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
        route={{
          params: {
            initialPickupCoordinate: {
              latitude: -22.920781,
              longitude: -43.406005,
            },
            initialPickupAddress: "4, Rua das Pastorinhas",
            initialSelectedDestination: destination,
            initialSelectedPlan: "plus",
            startAtConfirmation: true,
            skipDestinationSearch: true,
            initialPricingQuote: {
              quote: {
                estimatedFare: 81.59,
                grossEstimatedFare: 81.59,
                carType: "leaf_plus",
                pricingPayload: {},
              },
              planId: "plus",
              carType: "Leaf Plus",
              quoteSessionId: "passenger_home_quote_without_lock",
              routeKey: "-22.921|-43.406|-22.967|-43.179",
              distanceKm: 23.8,
              durationMin: 22,
              arrivalTime: "22:48",
              expiresAt: Date.now() + 120000,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText(/R\$ 81,59/)).toBeNull();
      expect(screen.getByText(/R\$ 80,39/)).toBeTruthy();
    });
  });

  it("opens the post-PIX preference countdown before sending the ride request", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 17.77,
      grossEstimatedFare: 17.77,
      quoteLockId: "ql_preference_countdown_1777",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

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

    fireEvent.press(screen.getByTestId("passenger-sound-selector"));
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

  it("marks a confirmed Pix createBooking failure for materialization-only retry", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 19.38,
      grossEstimatedFare: 19.38,
      quoteLockId: "ql_queue_backpressure_retry",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    const destination = {
      id: "destination_leblon_retry",
      name: "Leblon",
      address: "Leblon, Rio de Janeiro",
      coordinate: {
        latitude: -22.984,
        longitude: -43.223,
      },
      eta: "7",
    };
    const queueError = new Error(
      "Estamos com alta demanda na sua região. Tente novamente em alguns segundos.",
    );
    queueError.code = "QUEUE_BACKPRESSURE";
    const requestRide = jest.fn().mockRejectedValue(queueError);

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Avenida Atlântica, Copacabana",
      currentCoordinate: {
        latitude: -22.971,
        longitude: -43.182,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 19.38,
      selectedDestination: destination,
      tripDistanceKm: 7,
      tripDurationMin: 19,
      tripArrivalText: "03:18",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
      requestRide,
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
      <RobotaxiDestinationScreen navigation={navigation} route={{ params: {} }} />,
    );

    await waitFor(() => {
      expect(screen.getByText("Leblon")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Leblon"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-confirm-pix")).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId("mock-confirm-pix"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-preference-confirm-button")).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId("passenger-preference-confirm-button"));

    await waitFor(() => {
      expect(requestRide).toHaveBeenCalledWith(
        expect.objectContaining({
          fare: 19.38,
          paymentMethod: "pix",
          paymentConfirmation: expect.objectContaining({
            chargeId: "charge_test_1",
            rideId: "ride_test_1",
            amountInCents: 1938,
            quoteLockId: "ql_queue_backpressure_retry",
          }),
        }),
      );
      expect(navigation.replace).toHaveBeenCalledWith(
        "RobotaxiPrototypePaymentFailed",
        expect.objectContaining({
          title: "Corrida não solicitada",
          retryConfirmedBooking: true,
          retryRouteName: "RobotaxiPrototype",
        }),
      );
    });
    expect(navigation.replace).not.toHaveBeenCalledWith(
      "RobotaxiPrototype",
      expect.anything(),
    );
  });

  it("blocks ride creation when the confirmed PIX amount differs from the locked quote", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 97.76,
      grossEstimatedFare: 97.76,
      quoteLockId: "ql_payment_amount_guard",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });
    global.__LEAF_TEST_PIX_CONFIRMATION_OVERRIDES__ = {
      amountInCents: 8419,
      quoteLockId: "ql_payment_amount_guard",
    };
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(jest.fn());

    const destination = {
      id: "destination_mercadao_madureira",
      name: "Mercadão de Madureira",
      address: "Av. Min. Edgard Romero, 239 - Madureira, Rio de Janeiro",
      coordinate: {
        latitude: -22.8712,
        longitude: -43.3376,
      },
      eta: "15",
    };
    const requestRide = jest.fn();

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "idle",
      currentAddress: "Carioca Shopping",
      currentCoordinate: {
        latitude: -22.853586,
        longitude: -43.318168,
      },
      driverInfo: null,
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 84.19,
      selectedDestination: destination,
      tripDistanceKm: 8.1,
      tripDurationMin: 18,
      tripArrivalText: "18:45",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn().mockResolvedValue({ available: true }),
      requestRide,
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
      expect(screen.getByText("Mercadão de Madureira")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Mercadão de Madureira"));

    await waitFor(() => {
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(screen.getByText(/R\$ 97,76/)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-confirm-pix")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("mock-confirm-pix"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Pagamento inconsistente",
        expect.stringContaining("diverge da cotação"),
      );
      expect(requestRide).not.toHaveBeenCalled();
      expect(screen.queryByTestId("passenger-preference-countdown-modal")).toBeNull();
    });

    alertSpy.mockRestore();
  });

  it("rechecks final availability once before blocking payment on no-driver result", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 17.77,
      grossEstimatedFare: 17.77,
      quoteLockId: "ql_final_availability_recheck",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
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

    const finalAvailabilityResponses = [
      {
        available: false,
        code: "NO_DRIVERS_AVAILABLE",
        message: "Não há motoristas disponíveis",
      },
      { available: true },
    ];
    const checkRideAvailability = jest.fn((_payload, options = {}) => {
      if (options?.forceRefresh) {
        return Promise.resolve(finalAvailabilityResponses.shift());
      }
      return Promise.resolve({ available: true });
    });

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
      expect(screen.getByTestId("passenger-destination-confirm-button")).toBeTruthy();
      expect(screen.getByText(/R\$ 17,77/)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(
      () => {
        const finalChecks = checkRideAvailability.mock.calls.filter(
          ([, options]) => options?.forceRefresh === true,
        );
        expect(finalChecks).toHaveLength(2);
        expect(finalChecks[0][1]).toEqual(
          expect.objectContaining({
            forceRefresh: true,
            requestId: expect.stringMatching(/^passenger_confirm_plus_1_/),
          }),
        );
        expect(finalChecks[1][1]).toEqual(
          expect.objectContaining({
            forceRefresh: true,
            requestId: expect.stringMatching(/^passenger_confirm_plus_2_/),
          }),
        );
        expect(screen.getByTestId("mock-pix-amount").props.children).toBe("17.77");
      },
      { timeout: 3000 },
    );
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

  it("quotes destination extensions on the backend before requesting driver approval", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce({
      estimatedFare: 42.75,
      grossEstimatedFare: 42.75,
      quoteLockId: "ql_extension_4275",
      quoteLockExpiresAt: new Date(Date.now() + 120000).toISOString(),
      pricingPayload: {},
    });

    const destination = {
      id: "destination_mercadao_madureira",
      name: "Mercadão de Madureira",
      address: "Av. Min. Edgard Romero, Madureira, Rio de Janeiro",
      coordinate: {
        latitude: -22.8721,
        longitude: -43.3387,
      },
      eta: "9",
    };
    const requestTripExtension = jest.fn().mockResolvedValue({
      success: true,
      pendingDriverDecision: true,
    });

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "started",
      currentAddress: "Carioca Shopping, Vicente de Carvalho, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.8529,
        longitude: -43.3106,
      },
      driverInfo: { name: "Motorista Leaf" },
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 27.5,
      selectedDestination: null,
      tripDistanceKm: 3.8,
      tripDurationMin: 11,
      tripArrivalText: "15:42",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn(),
      requestRide: jest.fn(),
      requestTripExtension,
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
        route={{
          params: {
            mode: "extension",
            returnRouteName: "RobotaxiPrototypeTrip",
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Mercadão de Madureira")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Mercadão de Madureira"));

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          carType: "Leaf Plus",
          quoteSessionId: expect.stringMatching(/^passenger_quote_/),
          pickupLocation: expect.objectContaining({
            lat: -22.8529,
            lng: -43.3106,
          }),
          destinationLocation: expect.objectContaining({
            lat: -22.8721,
            lng: -43.3387,
          }),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-leaf-quote-session-id": expect.stringMatching(/^passenger_quote_/),
          }),
        }),
      );
      expect(screen.getByText(/R\$ 42,75/)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    await waitFor(() => {
      expect(requestTripExtension).toHaveBeenCalledWith(
        expect.objectContaining({
          newFare: 42.75,
          routeDistanceKm: expect.any(Number),
          routeDurationSecs: expect.any(Number),
          quoteLockId: "ql_extension_4275",
          quoteSessionId: expect.stringMatching(/^passenger_quote_/),
          backendQuote: expect.objectContaining({
            estimatedFare: 42.75,
            quoteLockId: "ql_extension_4275",
          }),
        }),
      );
    });
  });

  it("blocks destination extension submission until the backend quote is available", async () => {
    fetchDynamicPricingQuote.mockResolvedValueOnce(null);

    const destination = {
      id: "destination_mercadao_madureira",
      name: "Mercadão de Madureira",
      address: "Av. Min. Edgard Romero, Madureira, Rio de Janeiro",
      coordinate: {
        latitude: -22.8721,
        longitude: -43.3387,
      },
      eta: "9",
    };
    const requestTripExtension = jest.fn();

    usePrototypeRideRuntime.mockImplementation(() => ({
      bookingStatus: "started",
      currentAddress: "Carioca Shopping, Vicente de Carvalho, Rio de Janeiro",
      currentCoordinate: {
        latitude: -22.8529,
        longitude: -43.3106,
      },
      driverInfo: { name: "Motorista Leaf" },
      profileUid: "customer_1",
      riderProfile: {
        name: "Passageira Leaf",
        email: "passageira@leaf.app.br",
      },
      selectedVehicle: "Leaf Plus",
      selectedFare: 27.5,
      selectedDestination: null,
      tripDistanceKm: 3.8,
      tripDurationMin: 11,
      tripArrivalText: "15:42",
      loadDestinationSuggestions: jest.fn().mockResolvedValue([destination]),
      loadRecentDestinations: jest.fn().mockResolvedValue([destination]),
      resolveDestinationInput: jest.fn().mockImplementation(async (item) => item),
      selectDestination: jest.fn().mockImplementation(async (item) => item),
      checkRideAvailability: jest.fn(),
      requestRide: jest.fn(),
      requestTripExtension,
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
        route={{
          params: {
            mode: "extension",
            returnRouteName: "RobotaxiPrototypeTrip",
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Mercadão de Madureira")).toBeTruthy();
    });

    fireEvent.press(screen.getByText("Mercadão de Madureira"));

    await waitFor(() => {
      expect(fetchDynamicPricingQuote).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Tarifa indisponível")).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId("passenger-destination-confirm-button"));

    expect(requestTripExtension).not.toHaveBeenCalled();
  });

  it(
    "returns home with retry guidance when direct PIX availability never settles",
    verifyDirectPixAvailabilityTimeout,
  );
});

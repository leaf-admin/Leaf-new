import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import RobotaxiReceiptScreen from "../src/screens/prototype/RobotaxiReceiptScreen";
import { usePrototypeRideRuntime } from "../src/screens/prototype/prototypeRideRuntime";

jest.mock("@react-navigation/native", () => ({
  StackActions: {
    replace: jest.fn((name, params) => ({ type: "REPLACE", payload: { name, params } })),
  },
  useIsFocused: jest.fn(() => true),
}));

jest.mock("../src/screens/prototype/prototypeRideRuntime", () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapOcclusion", () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock("../src/components/prototype/PrototypeScreenTransition", () => {
  const React = require("react");
  return ({ children }) => <>{children}</>;
});

jest.mock("../src/components/payment/SecurePaymentBadge", () => {
  const React = require("react");
  const { View } = require("react-native");
  return () => <View />;
});

jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const MockView = ({ children }) => <View>{children}</View>;
  return {
    __esModule: true,
    default: MockView,
    Marker: MockView,
    Polyline: MockView,
    PROVIDER_GOOGLE: "google",
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Ionicons: () => <View />,
  };
});

function buildRuntime(overrides = {}) {
  return {
    tripHistory: [],
    lastReceipt: null,
    activeRole: "driver",
    driverTripMeta: {},
    dismissCompletedReceipt: jest.fn(),
    ...overrides,
  };
}

describe("driver receipt screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders route-provided driver receipt data and closes back to prototype home", () => {
    const dismissCompletedReceipt = jest.fn();
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ dismissCompletedReceipt }),
    );
    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => true),
      goBack: jest.fn(),
    };
    const receipt = {
      id: "trip_route_receipt",
      fare: 25,
      finalFare: 25,
      driverNetAmount: 21.34,
      totalFees: 3.66,
      paymentMethod: "pix",
      passengerId: "passenger_1",
      passengerName: "Passageiro Rota",
      pickupAddress: "Rua Origem, Centro",
      destinationAddress: "Rua Destino, Botafogo",
      distanceKm: 4.2,
      durationMin: 16,
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("Valor recebido")).toBeTruthy();
    expect(screen.getAllByText("R$ 21,34").length).toBeGreaterThan(0);
    expect(screen.getByText("Passageiro Rota")).toBeTruthy();
    expect(screen.getByText("Rua Origem")).toBeTruthy();
    expect(screen.getByText("Rua Destino")).toBeTruthy();

    fireEvent.press(screen.getByTestId("driver-receipt-back-to-map-button"));

    expect(dismissCompletedReceipt).toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith("RobotaxiPrototype");
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("does not show a gross-only receipt as received net payout", () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime());
    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = {
      id: "trip_gross_only",
      fare: 25,
      finalFare: 25,
      paymentMethod: "pix",
      passengerId: "passenger_1",
      passengerName: "Passageiro Rota",
      pickupAddress: "Rua Origem, Centro",
      destinationAddress: "Rua Destino, Botafogo",
      distanceKm: 4.2,
      durationMin: 16,
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("Repasse pendente")).toBeTruthy();
    expect(screen.getByText("Aguardando dados de repasse")).toBeTruthy();
    expect(screen.getAllByText("R$ 25,00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Valor recebido")).toBeNull();
  });
});

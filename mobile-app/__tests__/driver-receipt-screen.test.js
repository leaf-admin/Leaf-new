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

function buildOperationalInterruptedReceipt(overrides = {}) {
  return {
    id: "trip_operational_interrupted",
    authoritativeSnapshot: true,
    financialSnapshotSource: "backend_final",
    completionType: "INTERRUPTED_OPERATIONAL_ENDED",
    fare: 1.18,
    finalFare: 1.18,
    grossAmount: 1.18,
    totalFees: 1.18,
    driverNetAmount: 0,
    originalPaidAmount: 13.42,
    estimatedRefund: 12.24,
    remainingReservedAmount: 12.24,
    paymentMethod: "pix",
    driverId: "driver_1",
    driverName: "Carlos Motorista",
    passengerId: "passenger_1",
    passengerName: "Passageiro Rota",
    pickupAddress: "Rua Origem, Centro",
    destinationAddress: "Rua Interrupção, Ipanema",
    distanceKm: 0.3,
    durationMin: 2,
    operationalContinuation: {
      status: "PASSENGER_ENDED_RIDE",
      estimatedRefund: 12.24,
      remainingReservedAmount: 12.24,
    },
    rideLegs: [
      {
        source: "operational_interrupt",
        grossAmount: 1.18,
        totalFees: 1.18,
        driverNetAmount: 0,
        metadata: {
          settlementType: "INTERRUPTED_OPERATIONAL",
        },
      },
    ],
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
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
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

  it("opens driver rating with the passenger target from the receipt", () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime());
    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = {
      id: "trip_driver_rating",
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
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

    fireEvent.press(screen.getByTestId("driver-receipt-rate-passenger-button"));

    expect(navigation.replace).toHaveBeenCalledWith(
      "RobotaxiPrototypeRating",
      expect.objectContaining({
        reviewerType: "driver",
        tripId: "trip_driver_rating",
        targetUserId: "passenger_1",
        targetName: "Passageiro Rota",
      }),
    );
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
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
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

  it("decodes only persisted slash entities on the current driver receipt", () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({ activeRole: "driver" }));
    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = {
      id: "trip_driver_encoded_address",
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
      fare: 25,
      finalFare: 25,
      driverNetAmount: 21.34,
      totalFees: 3.66,
      paymentMethod: "pix",
      passengerId: "passenger_1",
      passengerName: "Passageiro Rota",
      pickupAddress: "Av. Atlântica, s&#x2F;n - Copacabana",
      destinationAddress: "Terminal 2, Portão &#47; Sul &amp; Leste",
      distanceKm: 4.2,
      durationMin: 16,
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("s/n - Copacabana")).toBeTruthy();
    expect(screen.getByText("Portão / Sul &amp; Leste")).toBeTruthy();
    expect(screen.queryByText(/&#(?:x2f|47);/i)).toBeNull();
  });

  it("decodes persisted slash entities on the current passenger receipt", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ activeRole: "passenger" }),
    );
    const navigation = {
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };
    const receipt = {
      id: "trip_passenger_encoded_address",
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
      fare: 25,
      finalFare: 25,
      grossAmount: 25,
      totalFees: 3.66,
      driverNetAmount: 21.34,
      paymentMethod: "pix",
      driverId: "driver_1",
      driverName: "Motorista Leaf",
      pickupAddress: "Av. Atlântica, s&#x2F;n - Copacabana",
      destinationAddress: "Terminal 2, Portão &#47; Sul",
      distanceKm: 4.2,
      durationMin: 16,
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByTestId("passenger-receipt-screen")).toBeTruthy();
    expect(screen.getByText("s/n - Copacabana")).toBeTruthy();
    expect(screen.getByText("Portão / Sul")).toBeTruthy();
    expect(screen.queryByText(/&#(?:x2f|47);/i)).toBeNull();
  });

  it("shows the original Pix, estimated refund and final value for a canonical ended interruption", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ activeRole: "passenger" }),
    );
    const receipt = buildOperationalInterruptedReceipt();
    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("Pix pago original")).toBeTruthy();
    expect(screen.getByTestId("passenger-receipt-original-paid-amount")).toHaveTextContent(
      "R$ 13,42",
    );
    expect(screen.getByText("Reembolso estimado")).toBeTruthy();
    expect(screen.getByTestId("passenger-receipt-refund-amount")).toHaveTextContent(
      "R$ 12,24",
    );
    expect(screen.getByText("Valor final")).toBeTruthy();
    expect(screen.getByTestId("passenger-receipt-final-amount")).toHaveTextContent(
      "R$ 1,18",
    );
    expect(screen.queryByText("Total pago")).toBeNull();
  });

  it("keeps the driver interruption receipt on executed fare and zero net", () => {
    usePrototypeRideRuntime.mockReturnValue(buildRuntime({ activeRole: "driver" }));
    const receipt = buildOperationalInterruptedReceipt();
    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("Valor recebido")).toBeTruthy();
    expect(screen.getAllByText("R$ 0,00").length).toBeGreaterThan(0);
    expect(screen.getByText("Valor da corrida")).toBeTruthy();
    expect(screen.getAllByText("R$ 1,18").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pix pago original")).toBeNull();
    expect(screen.queryByText("Reembolso estimado")).toBeNull();
  });

  it("keeps the normal passenger receipt unchanged without the canonical interruption leg", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildRuntime({ activeRole: "passenger" }),
    );
    const receipt = buildOperationalInterruptedReceipt({ rideLegs: [] });
    const navigation = {
      replace: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn(() => false),
      goBack: jest.fn(),
    };

    const screen = render(
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{ params: { fromTrip: true, receipt } }}
      />,
    );

    expect(screen.getByText("Total pago")).toBeTruthy();
    expect(screen.getAllByText("R$ 1,18").length).toBeGreaterThan(0);
    expect(screen.queryByText("Pix pago original")).toBeNull();
    expect(screen.queryByTestId("passenger-receipt-refund-row")).toBeNull();
  });
});

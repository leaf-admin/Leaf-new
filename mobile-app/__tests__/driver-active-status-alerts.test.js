import React from "react";
import { render } from "@testing-library/react-native";

import RobotaxiDriverOfferScreen from "../src/screens/prototype/RobotaxiDriverOfferScreen";
import RobotaxiDriverTripScreen from "../src/screens/prototype/RobotaxiDriverTripScreen";
import DriverTransientStateCard from "../src/screens/prototype/home/DriverTransientStateCard";
import { usePrototypeRideRuntime } from "../src/screens/prototype/prototypeRideRuntime";

jest.mock("../src/screens/prototype/prototypeRideRuntime", () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapOcclusion", () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock("../src/screens/prototype/liveRouteTiming", () => ({
  useLiveRouteTiming: jest.fn(() => ({
    routeProgress: 0.45,
    arrivalClockLabel: "chegada 10:30",
    displayEtaMinutes: 8,
  })),
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

jest.mock("../src/components/prototype/PrototypeMapLayer", () => {
  const React = require("react");
  const { View } = require("react-native");
  return () => <View testID="prototype-map-layer" />;
});

jest.mock("../src/components/payment/SecurePaymentBadge", () => {
  const React = require("react");
  const { View } = require("react-native");
  return () => <View testID="secure-payment-badge" />;
});

jest.mock("../src/hooks/useCampaignAssetOverride", () => jest.fn(() => ({ imageUrl: "" })));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Ionicons: () => <View />,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock("../src/components/prototype/PrototypeUI", () => {
  const React = require("react");
  const { Text, TouchableOpacity, View } = require("react-native");
  return {
    PrototypeCard: ({ children, ...props }) => <View {...props}>{children}</View>,
    PrototypePrimaryButton: ({
      label,
      onPress,
      disabled,
      testID,
      accessibilityLabel,
    }) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock("../src/components/prototype/LeafRideUI", () => {
  const React = require("react");
  const { Text, TouchableOpacity, View } = require("react-native");
  return {
    LeafAnimatedPressable: ({ children, onPress, disabled, ...props }) => (
      <TouchableOpacity onPress={onPress} disabled={disabled} {...props}>
        {children}
      </TouchableOpacity>
    ),
    LeafButton: ({
      label,
      onPress,
      disabled,
      testID,
      accessibilityLabel,
      ...props
    }) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel || label}
        {...props}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
    LeafDivider: () => <View />,
    LeafPersonIdentity: ({ name, meta, testID }) => (
      <View testID={testID}>
        <Text>{name}</Text>
        <Text>{meta}</Text>
      </View>
    ),
    LeafRideSheet: ({ children, ...props }) => <View {...props}>{children}</View>,
    LeafRouteProgress: ({ testID }) => <View testID={testID} />,
    LeafStateHeader: ({ title, subtitle, rightLabel }) => (
      <View>
        <Text>{title}</Text>
        {subtitle ? <Text>{subtitle}</Text> : null}
        {rightLabel ? <Text>{rightLabel}</Text> : null}
      </View>
    ),
    leafButtonMetrics: {
      height: 48,
      radius: 16,
      iconGap: 8,
      iconSize: 16,
    },
    leafRideColors: {
      dangerText: "#8A1F2B",
      leaf: "#1A330E",
      text: "#171412",
    },
  };
});

const ACTIVATION_STATUS_MESSAGE =
  "Você precisa ativar seu status com veículo válido para ficar disponível.";

function buildBaseRuntime(overrides = {}) {
  return {
    currentCoordinate: { latitude: -22.9, longitude: -43.2 },
    currentHeading: 0,
    driverCoordinate: { latitude: -22.9, longitude: -43.2 },
    driverOffers: [],
    driverActiveRide: null,
    driverTripMeta: {},
    selectedDestination: null,
    selectedFare: 0,
    currentAddress: "Rua A",
    tripDistanceKm: 3.2,
    tripDurationMin: 12,
    tripArrivalText: "10:30",
    boardingRemainingSec: 90,
    paymentMethod: "pix",
    acceptDriverOffer: jest.fn(),
    rejectDriverOffer: jest.fn(),
    markDriverArrived: jest.fn(),
    startTripFlow: jest.fn(),
    completeTripFlow: jest.fn(),
    lastError: "",
    profile: { uid: "driver_1" },
    ...overrides,
  };
}

describe("driver active status alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hides activation and vehicle status errors on an active driver trip", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildBaseRuntime({
        bookingStatus: "started",
        lastError: ACTIVATION_STATUS_MESSAGE,
        driverActiveRide: {
          bookingId: "booking_started",
          status: "started",
          pickupAddress: "Rua A",
          dropoffAddress: "Rua B",
          passengerName: "Passageiro Leaf",
          estimatedDriverNetAmount: 21.34,
        },
      }),
    );

    const screen = render(
      <RobotaxiDriverTripScreen
        navigation={{ navigate: jest.fn(), canGoBack: jest.fn(() => false) }}
        route={{ params: {} }}
      />,
    );

    expect(screen.getByText("Passageiro Leaf")).toBeTruthy();
    expect(screen.queryByText(ACTIVATION_STATUS_MESSAGE)).toBeNull();
  });

  it("keeps generic active-trip errors visible", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildBaseRuntime({
        bookingStatus: "started",
        lastError: "Falha ao finalizar corrida.",
        driverActiveRide: {
          bookingId: "booking_started",
          status: "started",
          pickupAddress: "Rua A",
          dropoffAddress: "Rua B",
          passengerName: "Passageiro Leaf",
          estimatedDriverNetAmount: 21.34,
        },
      }),
    );

    const screen = render(
      <RobotaxiDriverTripScreen
        navigation={{ navigate: jest.fn(), canGoBack: jest.fn(() => false) }}
        route={{ params: {} }}
      />,
    );

    expect(screen.getByText("Falha ao finalizar corrida.")).toBeTruthy();
  });

  it("hides activation and vehicle status errors while a driver offer is visible", () => {
    usePrototypeRideRuntime.mockReturnValue(
      buildBaseRuntime({
        lastError: ACTIVATION_STATUS_MESSAGE,
        driverOffers: [
          {
            bookingId: "booking_offer",
            id: "booking_offer",
            pickupAddress: "Rua A",
            dropoffAddress: "Rua B",
            passengerName: "Passageiro Leaf",
            estimatedDriverNetAmount: 18.75,
            pricingSnapshotLocked: true,
            payout: "R$ 18,75",
          },
        ],
      }),
    );

    const screen = render(
      <RobotaxiDriverOfferScreen
        navigation={{
          navigate: jest.fn(),
          replace: jest.fn(),
          canGoBack: jest.fn(() => false),
        }}
        route={{ params: {} }}
      />,
    );

    expect(screen.getByText("Nova solicitação")).toBeTruthy();
    expect(screen.queryByText(ACTIVATION_STATUS_MESSAGE)).toBeNull();
  });

  it("suppresses activation transient cards during accepted or active work", () => {
    const screen = render(
      <DriverTransientStateCard
        suppressActivationStatusAlerts
        card={{
          id: "activation-status",
          type: "vehicle_required",
          title: "Ativação pendente",
          message: ACTIVATION_STATUS_MESSAGE,
        }}
      />,
    );

    expect(screen.queryByTestId("driver-transient-state-card")).toBeNull();
  });
});

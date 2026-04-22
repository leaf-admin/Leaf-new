import React from "react";
import { render } from "@testing-library/react-native";

import DriverLiveRideOverlay from "../src/screens/prototype/home/DriverLiveRideOverlay";

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Ionicons: () => <View />,
  };
});

jest.mock("../src/components/prototype/PrototypeUI", () => {
  const React = require("react");
  const { Text, TouchableOpacity, View } = require("react-native");

  return {
    PrototypeCard: ({ children, ...props }) => <View {...props}>{children}</View>,
    PrototypePrimaryButton: ({ label, onPress, disabled, accessibilityLabel }) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

describe("DriverLiveRideOverlay", () => {
  it("renders an accepted active ride without requiring driverTripMeta", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_1",
          status: "accepted",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 15.01,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="accepted"
        tripDistanceKm={2.4}
        paymentMethod="pix"
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Dirija até o local de embarque de Passageiro Leaf"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("driver-live-trip-compact-summary"),
    ).toBeTruthy();
    expect(screen.getByText("R$ 15,01")).toBeTruthy();
    expect(screen.getByText("Cheguei ao embarque")).toBeTruthy();
    expect(screen.getByLabelText("Cheguei ao embarque")).toBeTruthy();
  });

  it("keeps external navigation visible while the trip is started", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_started",
          status: "started",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 24.9,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="started"
        paymentMethod="pix"
        driverTripAssist={{
          status: "started",
          remainingDistanceLabel: "2,6 km",
          etaLabel: "8 min",
          primaryActionLabel: "Finalizar corrida",
          primaryActionEnabled: true,
        }}
        interruptRideOperationalFlow={jest.fn()}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
        onOpenNavigation={jest.fn()}
      />,
    );

    expect(screen.getByText("Navegar")).toBeTruthy();
    expect(screen.getByText("Reportar problema")).toBeTruthy();
    expect(screen.getByLabelText("Finalizar corrida")).toBeTruthy();
  });

  it("shows external navigation in the arrived state before trip start", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_arrived",
          status: "arrived",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 18.75,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="arrived"
        paymentMethod="pix"
        driverTripAssist={{
          status: "arrived",
          remainingDistanceLabel: "0 m",
          etaLabel: "2:00",
          primaryActionLabel: "Iniciar corrida",
          primaryActionEnabled: true,
        }}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
        onOpenNavigation={jest.fn()}
      />,
    );

    expect(screen.getByText("Abrir navegação")).toBeTruthy();
    expect(screen.getByLabelText("Iniciar corrida")).toBeTruthy();
  });
});

import React from "react";
import { ScrollView } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

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

    expect(screen.getByText("A caminho do embarque")).toBeTruthy();
    expect(
      screen.getByLabelText("driver-live-trip-compact-summary"),
    ).toBeTruthy();
    expect(screen.getByText("2 km")).toBeTruthy();
    expect(screen.getByText("Cheguei")).toBeTruthy();
    expect(screen.getByLabelText("Cheguei ao embarque")).toBeTruthy();
  });

  it("keeps trip actions compact while the trip is started", () => {
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
          remainingDistanceLabel: "3 km",
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

    expect(screen.getByText("A caminho de 1 Ferry Building")).toBeTruthy();
    expect(screen.queryByText("Problema")).toBeNull();
    expect(screen.getByLabelText("Reportar problema")).toBeTruthy();
    expect(screen.getByText("Encerrar")).toBeTruthy();
    expect(screen.getByLabelText("Finalizar corrida")).toBeTruthy();
  });

  it("keeps the driver sheet minimal while native navigation is visible", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_started_navigation",
          status: "started",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 24.9,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="started"
        paymentMethod="pix"
        nativeNavigationVisible
        driverTripAssist={{
          status: "started",
          remainingDistanceLabel: "3 km",
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

    expect(screen.getByText("Passageiro Leaf")).toBeTruthy();
    expect(screen.getByText("Em viagem")).toBeTruthy();
    expect(screen.getByText("8 min")).toBeTruthy();
    expect(screen.getByText("3 km")).toBeTruthy();
    expect(screen.getByText("Encerrar")).toBeTruthy();
    expect(screen.queryByText("A caminho de 1 Ferry Building")).toBeNull();
    expect(screen.queryByText("Progresso da viagem")).toBeNull();
    expect(screen.queryByText("Navegar")).toBeNull();
  });

  it("opens the active trip card without using a scroll view", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_started_expanded",
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
          remainingDistanceLabel: "3 km",
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

    fireEvent.press(screen.getByLabelText("driver-live-trip-compact-summary"));

    expect(screen.getByLabelText("driver-live-trip-collapse-button")).toBeTruthy();
    expect(screen.getAllByText("Líquido").length).toBeGreaterThan(0);
    expect(screen.getByText("Embarque")).toBeTruthy();
    expect(screen.getByText("Destino")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);
  });

  it("asks for confirmation before canceling an accepted ride", () => {
    const cancelActiveRideFlow = jest.fn();
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_cancel",
          status: "accepted",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 15.01,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="accepted"
        tripDistanceKm={0.82}
        paymentMethod="pix"
        driverTripAssist={{
          status: "accepted",
          remainingMeters: 820,
          etaMinutes: 5,
          primaryActionLabel: "Cheguei ao embarque",
          primaryActionEnabled: false,
        }}
        cancelActiveRideFlow={cancelActiveRideFlow}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
        onOpenNavigation={jest.fn()}
      />,
    );

    expect(screen.getByText("820 m")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Cancelar corrida"));
    expect(
      screen.getByText(
        "Ao cancelar a corrida cobranças podem ser aplicadas, deseja cancelar?",
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Não"));
    expect(cancelActiveRideFlow).not.toHaveBeenCalled();
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

    expect(screen.queryByText("Navegar")).toBeNull();
    expect(screen.getByLabelText("Abrir navegação")).toBeTruthy();
    expect(screen.getByLabelText("Iniciar corrida")).toBeTruthy();
  });
});

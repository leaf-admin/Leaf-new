import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

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
    PrototypePrimaryButton: ({ label, onPress, disabled, accessibilityLabel, testID }) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        testID={testID}
      >
        <Text>{label}</Text>
      </TouchableOpacity>
    ),
  };
});

describe("DriverLiveRideOverlay", () => {
  it("renders live driver offer distance and passenger pickup context from authoritative aliases", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverOffers={[
          {
            bookingId: "booking_offer_aliases",
            passenger: "Passageira Leaf",
            pickup: "Av. Meriti, 9 - Vila Kosmos, Rio de Janeiro",
            dropoff: "Av. das Américas, 4666",
            estimatedDriverNetAmount: 50.91,
            payout: "R$ 50,91",
            estimatedTripDistanceKm: 16.43,
            estimatedTripDurationMin: 31,
            eta: "6 min",
            pricingSnapshotLocked: true,
          },
        ]}
        paymentMethod="pix"
        acceptDriverOffer={jest.fn()}
        rejectDriverOffer={jest.fn()}
      />,
    );

    expect(screen.getByText("Passageira Leaf")).toBeTruthy();
    expect(screen.getByTestId("driver-live-ride-overlay-wrap")).toBeTruthy();
    expect(screen.getByTestId("driver-live-offer-card")).toBeTruthy();
    expect(screen.getByTestId("driver-live-offer-accept-button")).toBeTruthy();
    expect(screen.queryByTestId("driver-offer-screen")).toBeNull();
    expect(screen.getAllByText("R$ 50,91")).toHaveLength(1);
    expect(screen.getAllByText(/Rio de Janeiro/).length).toBeGreaterThan(0);
    expect(screen.getByText("16 km")).toBeTruthy();
    expect(screen.getByText("31 min")).toBeTruthy();
    expect(screen.queryByText("Local combinado")).toBeNull();
  });

  it("renders the authoritative offer countdown and blocks expired actions", () => {
    const acceptDriverOffer = jest.fn();
    const rejectDriverOffer = jest.fn();
    const screen = render(
      <DriverLiveRideOverlay
        driverOffers={[
          {
            bookingId: "booking_expired_offer",
            passenger: "Passageira Leaf",
            pickup: "Av. Meriti, 9",
            dropoff: "Av. das Américas, 4666",
            estimatedDriverNetAmount: 50.91,
            fare: 54.71,
            pricingSnapshotLocked: true,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          },
        ]}
        acceptDriverOffer={acceptDriverOffer}
        rejectDriverOffer={rejectDriverOffer}
      />,
    );

    expect(screen.getByTestId("driver-live-offer-response-timer")).toBeTruthy();
    expect(screen.getByText("00:00 para responder")).toBeTruthy();
    expect(
      screen.getByTestId("driver-live-offer-accept-button").props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(screen.queryByTestId("driver-live-offer-reject-button")).toBeNull();
    fireEvent.press(screen.getByTestId("driver-live-offer-details-button"));
    expect(
      screen.getByLabelText("driver-live-offer-reject-button").props
        .accessibilityState.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId("driver-live-offer-accept-button"));
    fireEvent.press(screen.getByLabelText("driver-live-offer-reject-button"));
    expect(acceptDriverOffer).not.toHaveBeenCalled();
    expect(rejectDriverOffer).not.toHaveBeenCalled();
  });

  it("removes a rejected current offer immediately and keeps stale snapshots hidden", async () => {
    let rejectRequest;
    const rejectDriverOffer = jest.fn(
      () => new Promise((resolve) => {
        rejectRequest = { resolve };
      }),
    );
    const offer = {
      bookingId: "booking_reject_current_offer",
      passenger: "Passageira Leaf",
      pickup: "Av. Meriti, 9",
      dropoff: "Av. das Américas, 4666",
      estimatedDriverNetAmount: 50.91,
      pricingSnapshotLocked: true,
      expiresAt: new Date(Date.now() + 20000).toISOString(),
    };
    const screen = render(
      <DriverLiveRideOverlay
        driverOffers={[offer]}
        acceptDriverOffer={jest.fn()}
        rejectDriverOffer={rejectDriverOffer}
      />,
    );

    fireEvent.press(screen.getByTestId("driver-live-offer-details-button"));
    fireEvent.press(screen.getByTestId("driver-live-offer-reject-button"));

    expect(rejectDriverOffer).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: offer.bookingId }),
      "Recusada pelo motorista.",
    );
    expect(screen.queryByTestId("driver-live-offer-card")).toBeNull();

    await act(async () => {
      rejectRequest.resolve({ success: true });
      await Promise.resolve();
    });

    screen.rerender(
      <DriverLiveRideOverlay
        driverOffers={[offer]}
        acceptDriverOffer={jest.fn()}
        rejectDriverOffer={rejectDriverOffer}
      />,
    );
    expect(screen.queryByTestId("driver-live-offer-card")).toBeNull();
  });

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

    expect(screen.getByText("Ponto de embarque")).toBeTruthy();
    expect(
      screen.getByLabelText("driver-live-trip-compact-summary"),
    ).toBeTruthy();
    expect(screen.getByTestId("driver-live-trip-card")).toBeTruthy();
    expect(screen.getByTestId("driver-live-passenger-identity")).toBeTruthy();
    expect(
      screen.getByTestId("driver-live-primary-action-arrive-button"),
    ).toBeTruthy();
    expect(screen.queryByTestId("driver-live-trip-screen")).toBeNull();
    expect(screen.getByText("2 km")).toBeTruthy();
    expect(screen.getByText("Cheguei ao embarque")).toBeTruthy();
    expect(screen.getByLabelText("Cheguei ao embarque")).toBeTruthy();
  });

  it("renders the started state as a floating card with progressive actions", () => {
    const onOpenChat = jest.fn();
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
        onOpenChat={onOpenChat}
      />,
    );

    expect(screen.getByText("A caminho de 1 Ferry Building")).toBeTruthy();
    const cardStyle = StyleSheet.flatten(
      screen.getByTestId("driver-live-trip-card").props.style,
    );
    const wrapStyle = StyleSheet.flatten(
      screen.getByTestId("driver-live-ride-overlay-wrap").props.style,
    );
    expect(cardStyle.marginHorizontal).toBe(24);
    expect(cardStyle.borderBottomLeftRadius).toBe(28);
    expect(cardStyle.borderBottomRightRadius).toBe(28);
    expect(wrapStyle.bottom).toBe(16);
    expect(screen.queryByTestId("driver-live-trip-navigation-button")).toBeNull();
    expect(screen.queryByTestId("driver-live-trip-report-problem-button")).toBeNull();
    expect(screen.queryByTestId("driver-live-trip-chat-button")).toBeNull();
    expect(screen.getByTestId("driver-live-trip-compact-summary")).toBeTruthy();
    expect(
      screen.getByTestId("driver-live-primary-action-complete-button"),
    ).toBeTruthy();
    expect(screen.queryByTestId("driver-trip-route-progress")).toBeNull();
    expect(screen.getByLabelText("Finalizar corrida")).toBeTruthy();

    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));

    expect(screen.getByLabelText("Abrir navegação")).toBeTruthy();
    expect(screen.getByLabelText("Abrir chat da corrida")).toBeTruthy();
    expect(screen.getByLabelText("Reportar problema")).toBeTruthy();
    expect(screen.getByText("Ocultar opções")).toBeTruthy();

    fireEvent.press(screen.getByTestId("driver-live-trip-chat-button"));
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it("exposes the current operational interruption checkpoint without standalone IDs", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_operational_interruption",
          status: "operational_interrupted",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 24.9,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="operational_interrupted"
        operationalContinuation={{
          status: "passenger_decision_pending",
          rideLegs: [
            { legId: "leg_1", driverNetAmount: 16.2 },
            { legId: "leg_2", driverNetAmount: 0 },
          ],
        }}
        paymentMethod="pix"
      />,
    );

    expect(screen.getByTestId("driver-live-ride-overlay-wrap")).toBeTruthy();
    expect(screen.getByTestId("driver-live-trip-card")).toBeTruthy();
    expect(screen.getByTestId("driver-live-trip-compact-summary")).toBeTruthy();
    expect(screen.getByTestId("driver-live-operational-hold-title")).toBeTruthy();
    expect(screen.getByTestId("driver-live-passenger-identity")).toBeTruthy();
    expect(screen.getAllByText("Aguardando decisão do passageiro")).toHaveLength(1);
    expect(screen.getByText("Decisão pendente")).toBeTruthy();
    expect(screen.getByText("R$ 0,00")).toBeTruthy();
    expect(screen.queryByText("R$ 24,90")).toBeNull();
    expect(screen.queryByTestId("driver-live-primary-action-button")).toBeNull();
    expect(screen.queryByTestId("driver-live-trip-screen")).toBeNull();
    expect(screen.queryByTestId("driver-trip-operational-hold-title")).toBeNull();

    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));

    expect(screen.getByText("TRECHO ENCERRADO")).toBeTruthy();
    expect(screen.getAllByText("Aguardando decisão do passageiro")).toHaveLength(1);
    expect(screen.getByText("R$ 0,00")).toBeTruthy();
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

    expect(screen.getAllByText("Passageiro Leaf").length).toBeGreaterThan(0);
    expect(screen.getByText("EM VIAGEM")).toBeTruthy();
    expect(screen.getByText("8 min")).toBeTruthy();
    expect(screen.getByText("3 km")).toBeTruthy();
    expect(screen.getByText("Finalizar corrida")).toBeTruthy();
    expect(screen.getByText("A caminho de 1 Ferry Building")).toBeTruthy();
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

    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));

    expect(screen.getByTestId("driver-live-trip-collapse-button")).toBeTruthy();
    expect(screen.getAllByText("Líquido").length).toBeGreaterThan(0);
    expect(screen.getByText("EMBARQUE")).toBeTruthy();
    expect(screen.getByText("DESTINO")).toBeTruthy();
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
    expect(screen.queryByLabelText("Cancelar corrida")).toBeNull();
    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));
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

    expect(screen.queryByLabelText("Abrir navegação")).toBeNull();
    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));
    expect(screen.getByLabelText("Abrir navegação")).toBeTruthy();
    expect(screen.getByLabelText("Iniciar corrida")).toBeTruthy();
  });

  it.each([
    ["driver_accepted", "Cheguei ao embarque"],
    ["arrived_at_pickup", "Iniciar viagem"],
    ["trip_started", "Finalizar corrida"],
  ])("normalizes backend trip alias %s before rendering driver actions", (bookingStatus, actionLabel) => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: `booking_${bookingStatus}`,
          status: bookingStatus,
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 18.75,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus={bookingStatus}
        paymentMethod="pix"
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
        onOpenNavigation={jest.fn()}
      />,
    );

    expect(screen.getByLabelText("driver-live-trip-compact-summary")).toBeTruthy();
    expect(screen.getByLabelText(actionLabel)).toBeTruthy();
  });
});

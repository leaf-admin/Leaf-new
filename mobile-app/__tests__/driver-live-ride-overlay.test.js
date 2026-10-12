import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import DriverLiveRideOverlay, { resolveOfferInstanceKey } from "../src/screens/prototype/home/DriverLiveRideOverlay";

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

    expect(screen.getByText("Passageira")).toBeTruthy();
    expect(screen.getByTestId("driver-live-ride-overlay-wrap")).toBeTruthy();
    expect(screen.getByTestId("driver-live-offer-card")).toBeTruthy();
    expect(screen.getByTestId("driver-live-offer-accept-button")).toBeTruthy();
    expect(screen.queryByTestId("driver-offer-screen")).toBeNull();
    expect(screen.getAllByText("R$ 50,91")).toHaveLength(1);
    expect(screen.getAllByText(/Av. Meriti, 9 - Vila Kosmos/).length).toBeGreaterThan(0);
    expect(screen.getByText(/16 km/)).toBeTruthy();
    expect(screen.getByText(/16 km · 31 min/)).toBeTruthy();
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
    expect(screen.getByText("Tempo de resposta esgotado")).toBeTruthy();
    expect(
      screen.getByTestId("driver-live-offer-accept-button").props
        .accessibilityState.disabled,
    ).toBe(true);
    expect(screen.getByTestId("driver-live-offer-reject-button").props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("driver-live-offer-details-button"));
    expect(
      screen.getByTestId("driver-live-offer-reject-button").props
        .accessibilityState.disabled,
    ).toBe(true);
    fireEvent.press(screen.getByTestId("driver-live-offer-accept-button"));
    expect(screen.getByTestId("driver-live-offer-reject-button").props.accessibilityLabel).toBe(
      "Recusar corrida",
    );
    fireEvent.press(screen.getByTestId("driver-live-offer-reject-button"));
    expect(acceptDriverOffer).not.toHaveBeenCalled();
    expect(rejectDriverOffer).not.toHaveBeenCalled();
  });

  it("keeps offer actions outside the scroll area and drops an expired offer locally", () => {
    jest.useFakeTimers();
    const expireDriverOffer = jest.fn();
    try {
      const screen = render(
        <DriverLiveRideOverlay
          driverOffers={[
            {
              bookingId: "booking_lost_clear",
              passenger: "Passageira Leaf",
              pickup: "Av. Meriti, 9",
              dropoff: "Av. das Américas, 4666",
              estimatedDriverNetAmount: 47.52,
              expiresAt: new Date(Date.now() - 1000).toISOString(),
            },
          ]}
          acceptDriverOffer={jest.fn()}
          rejectDriverOffer={jest.fn()}
          expireDriverOffer={expireDriverOffer}
        />,
      );

      const actions = screen.getByTestId("driver-live-offer-actions");
      const scrollAncestors = [];
      for (let node = actions.parent; node; node = node.parent) {
        if (node.type === ScrollView || node.type === "RCTScrollView") {
          scrollAncestors.push(node);
        }
      }
      expect(scrollAncestors).toHaveLength(0);
      expect(screen.UNSAFE_queryAllByType(ScrollView).length).toBeGreaterThan(0);

      act(() => {
        jest.advanceTimersByTime(1600);
      });
      expect(screen.queryByTestId("driver-live-offer-card")).toBeNull();
      expect(expireDriverOffer).toHaveBeenCalledTimes(1);
      expect(expireDriverOffer.mock.calls[0][0]).toEqual(
        expect.objectContaining({ bookingId: "booking_lost_clear" }),
      );
    } finally {
      jest.useRealTimers();
    }
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

    expect(screen.getAllByText("1540 Mission St").length).toBeGreaterThan(0);
    expect(screen.getByTestId("driver-live-trip-compact-summary").props.accessibilityLabel).toBe(
      "Resumo da corrida do motorista",
    );
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

  it("steps the trip card through peek, compact and expanded heights", () => {
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_heights",
          status: "accepted",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 24.9,
          passengerName: "Ana Souza",
        }}
        bookingStatus="accepted"
        driverTripAssist={{ status: "accepted", primaryActionLabel: "Cheguei ao embarque", primaryActionEnabled: true }}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
      />,
    );

    expect(screen.getByTestId("driver-live-passenger-identity")).toBeTruthy();
    fireEvent.press(screen.getByTestId("driver-live-trip-sheet-handle"));
    expect(screen.queryByTestId("driver-live-trip-compact-summary")).toBeNull();
    fireEvent.press(screen.getByTestId("driver-live-trip-sheet-handle"));
    expect(screen.queryByTestId("driver-live-passenger-identity")).toBeNull();
    expect(screen.queryByTestId("driver-live-trip-details-button")).toBeNull();
    expect(screen.getByLabelText("Cheguei ao embarque")).toBeTruthy();
    fireEvent.press(screen.getByTestId("driver-live-trip-sheet-handle"));
    expect(screen.getByTestId("driver-live-passenger-identity")).toBeTruthy();
  });

  it("ends the trip only through the slide control (or its accessibility action)", async () => {
    const completeTripFlow = jest.fn(() => Promise.resolve({ success: true }));
    const screen = render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_slide_end",
          status: "started",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 24.9,
        }}
        bookingStatus="started"
        driverTripAssist={{
          status: "started",
          primaryActionLabel: "Finalizar corrida",
          primaryActionEnabled: true,
        }}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={completeTripFlow}
      />,
    );

    const control = screen.getByTestId("driver-live-primary-action-complete-button");
    expect(screen.getByText("Deslize para encerrar")).toBeTruthy();
    fireEvent.press(control);
    expect(completeTripFlow).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent(control, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
    });
    expect(completeTripFlow).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText("Em viagem")).toBeTruthy();
    expect(screen.getByText("1 Ferry Building")).toBeTruthy();
    const cardStyle = StyleSheet.flatten(
      screen.getByTestId("driver-live-trip-card").props.style,
    );
    const wrapStyle = StyleSheet.flatten(
      screen.getByTestId("driver-live-ride-overlay-wrap").props.style,
    );
    // Floating card: inset from the sides, rounded on all corners, lifted
    // above the bottom edge (safe area + gap).
    expect(cardStyle.marginHorizontal).toBe(12);
    expect(cardStyle.borderRadius).toBe(28);
    expect(cardStyle.borderBottomLeftRadius).toBeUndefined();
    expect(wrapStyle.bottom).toBe(12);
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

    expect(screen.getByText("Trecho encerrado")).toBeTruthy();
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
    expect(screen.getByText("Em viagem")).toBeTruthy();
    expect(screen.getByText("8 min")).toBeTruthy();
    expect(screen.getByText("3 km")).toBeTruthy();
    expect(screen.getByLabelText("Finalizar corrida")).toBeTruthy();
    expect(screen.getByText("Em viagem")).toBeTruthy();
    expect(screen.getByText("1 Ferry Building")).toBeTruthy();
    expect(screen.queryByText("Progresso da viagem")).toBeNull();
    expect(screen.queryByText("Navegar")).toBeNull();
  });

  it("keeps the active trip details reachable inside a bounded scroll view", () => {
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
    expect(screen.getByText("Embarque")).toBeTruthy();
    expect(screen.getByText("Destino")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(1);
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
        "O passageiro será avisado. Cancelar depois de aceitar pode gerar cobrança.",
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Continuar corrida"));
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

    expect(screen.getByTestId("driver-live-trip-compact-summary").props.accessibilityLabel).toBe(
      "Resumo da corrida do motorista",
    );
    expect(screen.getByLabelText(actionLabel)).toBeTruthy();
  });
});

describe("DriverLiveRideOverlay boarding wait", () => {
  const ARRIVAL_MS = new Date("2026-10-12T15:00:00.000Z").getTime();
  const DEADLINE = new Date(ARRIVAL_MS + 120000).toISOString();

  const renderArrived = ({ etaLabel, cancelActiveRideFlow = jest.fn(), boardingDeadlineAt = DEADLINE }) =>
    render(
      <DriverLiveRideOverlay
        driverActiveRide={{
          bookingId: "booking_wait",
          status: "arrived",
          pickupAddress: "1540 Mission St",
          dropoffAddress: "1 Ferry Building",
          estimatedDriverNetAmount: 18.75,
          passengerName: "Passageiro Leaf",
        }}
        bookingStatus="arrived"
        paymentMethod="pix"
        boardingDeadlineAt={boardingDeadlineAt}
        driverTripAssist={{
          status: "arrived",
          remainingDistanceLabel: "0 m",
          etaLabel,
          primaryActionLabel: "Iniciar corrida",
          primaryActionEnabled: true,
        }}
        cancelActiveRideFlow={cancelActiveRideFlow}
        markDriverArrived={jest.fn()}
        startTripFlow={jest.fn()}
        completeTripFlow={jest.fn()}
        onOpenNavigation={jest.fn()}
      />,
    );

  const openCancelPrompt = (screen) => {
    fireEvent.press(screen.getByTestId("driver-live-trip-details-button"));
    fireEvent.press(screen.getByLabelText("Cancelar corrida"));
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the countdown and the plain cancel prompt before the 2 minutes are over", async () => {
    jest.setSystemTime(ARRIVAL_MS + 30000);
    const cancelActiveRideFlow = jest.fn().mockResolvedValue({ success: true });
    const screen = renderArrived({ etaLabel: "1:30", cancelActiveRideFlow });

    expect(screen.getAllByText("1:30").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Espera").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("driver-live-boarding-wait-hint")).toBeNull();
    openCancelPrompt(screen);
    expect(screen.getByText("Cancelar corrida?")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("driver-live-trip-cancel-confirm-button"));
    });
    expect(cancelActiveRideFlow).toHaveBeenCalledWith({ reason: "Cancelado pelo motorista." });
  });

  it("counts the wait up after 0:00 and does not promise a no-show before 5 minutes", async () => {
    jest.setSystemTime(ARRIVAL_MS + 192000);
    const cancelActiveRideFlow = jest.fn().mockResolvedValue({ success: true });
    const screen = renderArrived({ etaLabel: "0:00", cancelActiveRideFlow });

    expect(screen.queryByText("0:00")).toBeNull();
    expect(screen.getAllByText("3:12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Esperando").length).toBeGreaterThan(0);
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getAllByText("3:15").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("driver-live-boarding-wait-hint")).toBeNull();

    openCancelPrompt(screen);
    expect(screen.queryByText("Passageiro não apareceu?")).toBeNull();
    expect(screen.getByText("Cancelar corrida?")).toBeTruthy();
    expect(
      screen.getByText(
        "O passageiro será avisado. Antes de 5 minutos de espera no embarque, o cancelamento não conta como não comparecimento do passageiro.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("driver-live-trip-cancel-confirm-button"));
    });
    expect(cancelActiveRideFlow).toHaveBeenCalledWith({ reason: "Cancelado pelo motorista." });
  });

  it("says a cancel counts as no-show from 5 minutes on and sends the no-show reason", async () => {
    jest.setSystemTime(ARRIVAL_MS + 301000);
    const cancelActiveRideFlow = jest.fn().mockResolvedValue({ success: true });
    const screen = renderArrived({ etaLabel: "0:00", cancelActiveRideFlow });

    expect(screen.getAllByText("5:01").length).toBeGreaterThan(0);
    expect(screen.getByTestId("driver-live-boarding-wait-hint").props.children).toBe(
      "Cancelar agora conta como não comparecimento do passageiro.",
    );

    openCancelPrompt(screen);
    expect(screen.getByText("Passageiro não apareceu?")).toBeTruthy();
    expect(
      screen.getByText(
        "Você esperou 5 minutos no embarque. Ao cancelar, registramos que o passageiro não compareceu ao embarque.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId("driver-live-trip-cancel-confirm-button"));
    });
    expect(cancelActiveRideFlow).toHaveBeenCalledWith({
      reason: "Passageiro não compareceu ao embarque.",
    });
  });

  it("does not promise a no-show when the arrival time is unknown", () => {
    jest.setSystemTime(ARRIVAL_MS + 900000);
    const screen = renderArrived({ etaLabel: "0:00", boardingDeadlineAt: null });

    expect(screen.getAllByText("0:00").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("driver-live-boarding-wait-hint")).toBeNull();
    openCancelPrompt(screen);
    expect(screen.queryByText("Passageiro não apareceu?")).toBeNull();
  });
});

describe("driver offer instance key", () => {
  it("tells a re-offer of the same booking apart from the dismissed one", () => {
    const first = { bookingId: "booking_1", expiresAt: "2026-10-11T04:08:50.000Z" };
    const reoffer = { bookingId: "booking_1", expiresAt: "2026-10-11T04:09:40.000Z" };

    expect(resolveOfferInstanceKey(first)).not.toBe(resolveOfferInstanceKey(reoffer));
    expect(resolveOfferInstanceKey(first)).toBe(resolveOfferInstanceKey({ ...first }));
    expect(resolveOfferInstanceKey(null)).toBe("");
  });
});

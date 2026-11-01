import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import RideClosingCard, { resolveInitialClosingStage } from "../src/screens/prototype/RideClosingCard";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../src/hooks/useHapticFeedback", () => ({
  useHapticFeedback: () => jest.fn(),
}));

function renderCard(overrides = {}) {
  const props = {
    isDriver: false,
    amountCaption: "Corrida concluída · Pix",
    amount: "R$ 23,32",
    tripSummary: "Botafogo Praia Shopping · 7,5 km · 9 min",
    dateLabel: "31/10, 19:10",
    targetFirstName: "Ana",
    pickupTitle: "R. Prudente de Morais, 123",
    dropoffTitle: "Botafogo Praia Shopping",
    valueRows: [
      { label: "Corrida", value: "R$ 22,33" },
      { label: "Pedágio", value: "R$ 0,00" },
      { label: "Taxa Leaf", value: "R$ 0,99" },
    ],
    canRate: true,
    airConditioningAnswered: false,
    rated: false,
    detailsOpened: false,
    onAnswerAirConditioning: jest.fn().mockResolvedValue(undefined),
    onSubmitRating: jest.fn().mockResolvedValue(undefined),
    onOpenDetails: jest.fn(),
    onOpenFullReceipt: jest.fn(),
    onDone: jest.fn(),
    ...overrides,
  };
  return { props, screen: render(<RideClosingCard {...props} />) };
}

describe("ride closing card", () => {
  it("resolves the first stage for each role and state", () => {
    expect(resolveInitialClosingStage({ isDriver: false })).toBe("air");
    expect(resolveInitialClosingStage({ isDriver: false, airConditioningAnswered: true })).toBe("rate");
    expect(resolveInitialClosingStage({ isDriver: true })).toBe("rate");
    expect(resolveInitialClosingStage({ isDriver: false, rated: true })).toBe("details");
    expect(resolveInitialClosingStage({ isDriver: true, detailsOpened: true })).toBe("details");
  });

  it("asks the passenger about the air conditioning first, with no way to skip", async () => {
    const { props, screen } = renderCard();

    expect(screen.getByText("O ar ficou ligado a corrida toda?")).toBeTruthy();
    expect(screen.queryByText("Agora não")).toBeNull();
    expect(screen.queryByTestId("closing-rate-stage")).toBeNull();

    fireEvent.press(screen.getByTestId("closing-air-conditioning-no"));

    await waitFor(() => expect(screen.getByTestId("closing-rate-stage")).toBeTruthy());
    expect(props.onAnswerAirConditioning).toHaveBeenCalledWith(false);
    expect(screen.getByText("Como foi com Ana?")).toBeTruthy();
  });

  it("offers to continue only after the air conditioning answer fails", async () => {
    const onAnswerAirConditioning = jest.fn().mockRejectedValue(new Error("off"));
    const { screen } = renderCard({ onAnswerAirConditioning });

    expect(screen.queryByTestId("closing-air-conditioning-skip")).toBeNull();
    fireEvent.press(screen.getByTestId("closing-air-conditioning-yes"));

    await waitFor(() => expect(screen.getByTestId("closing-air-conditioning-error")).toBeTruthy());
    fireEvent.press(screen.getByTestId("closing-air-conditioning-skip"));

    expect(screen.getByTestId("closing-rate-stage")).toBeTruthy();
  });

  it("takes the driver straight to the rating, with nothing preselected", () => {
    const { screen } = renderCard({ isDriver: true, amount: "+ R$ 22,33" });

    expect(screen.queryByTestId("closing-air-conditioning-stage")).toBeNull();
    expect(screen.getByText("+ R$ 22,33")).toBeTruthy();
    expect(screen.getByTestId("rating-star-1").props.accessibilityState).toEqual({ checked: false });
  });

  it("finishes without sending anything when no star was chosen", async () => {
    const { props, screen } = renderCard({ airConditioningAnswered: true });

    fireEvent.press(screen.getByTestId("receipt-done-button"));

    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(props.onSubmitRating).not.toHaveBeenCalled();
  });

  it("sends a high rating without asking what happened", async () => {
    const { props, screen } = renderCard({ airConditioningAnswered: true });

    fireEvent.press(screen.getByTestId("rating-star-4"));
    expect(screen.queryByTestId("closing-low-rating")).toBeNull();
    fireEvent.press(screen.getByTestId("receipt-done-button"));

    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(props.onSubmitRating).toHaveBeenCalledWith({ rating: 4, selectedOptions: [], comment: "" });
  });

  it("collects the reason on a low rating and sends it once", async () => {
    const { props, screen } = renderCard({ airConditioningAnswered: true });

    fireEvent.press(screen.getByTestId("rating-star-3"));
    expect(screen.getByText("O que aconteceu?")).toBeTruthy();
    fireEvent.press(screen.getByText("Atraso"));
    fireEvent.changeText(screen.getByTestId("closing-rating-comment"), " Demorou no embarque ");
    fireEvent.press(screen.getByTestId("closing-view-receipt-button"));

    await waitFor(() => expect(screen.getByTestId("closing-details-stage")).toBeTruthy());
    expect(props.onOpenDetails).toHaveBeenCalled();
    expect(props.onSubmitRating).toHaveBeenCalledWith({
      rating: 3,
      selectedOptions: ["Atraso"],
      comment: "Demorou no embarque",
    });

    fireEvent.press(screen.getByTestId("receipt-done-button"));
    expect(props.onSubmitRating).toHaveBeenCalledTimes(1);
    expect(props.onDone).toHaveBeenCalled();
  });

  it("keeps the card on a failed rating and lets the person leave after the second failure", async () => {
    const onSubmitRating = jest.fn().mockRejectedValue(new Error("off"));
    const { props, screen } = renderCard({ airConditioningAnswered: true, onSubmitRating });

    fireEvent.press(screen.getByTestId("rating-star-5"));
    fireEvent.press(screen.getByTestId("receipt-done-button"));
    await waitFor(() => expect(screen.getByTestId("closing-rating-error")).toBeTruthy());
    expect(props.onDone).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId("receipt-done-button"));
    });
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(onSubmitRating).toHaveBeenCalledTimes(2);
  });

  it("hides the stars when the rating target is unavailable", () => {
    const { screen } = renderCard({ airConditioningAnswered: true, canRate: false });

    expect(screen.queryByTestId("rating-star-1")).toBeNull();
    expect(screen.getByTestId("receipt-done-button")).toBeTruthy();
  });

  it("shows the toll and the fee on the receipt card and expands to the full receipt", () => {
    const { props, screen } = renderCard({ rated: true });

    expect(screen.getByText("Pedágio")).toBeTruthy();
    expect(screen.getByText("Taxa Leaf")).toBeTruthy();
    fireEvent.press(screen.getByTestId("closing-full-receipt-button"));

    expect(props.onOpenFullReceipt).toHaveBeenCalled();
  });
});

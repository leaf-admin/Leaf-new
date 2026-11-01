import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import RobotaxiReceiptScreen from "../src/screens/prototype/RobotaxiReceiptScreen";
import RatingService from "../src/services/RatingService";
import { usePrototypeRideRuntime } from "../src/screens/prototype/prototypeRideRuntime";

jest.mock("@react-navigation/native", () => ({
  StackActions: { replace: jest.fn() },
  useIsFocused: jest.fn(() => true),
}));

jest.mock("../src/screens/prototype/prototypeRideRuntime", () => ({
  usePrototypeRideRuntime: jest.fn(),
}));

jest.mock("../src/screens/prototype/prototypeMapOcclusion", () => ({
  usePrototypeMapOcclusion: jest.fn(),
}));

jest.mock("../src/services/RatingService", () => ({
  __esModule: true,
  default: { submitRating: jest.fn(), submitAirConditioning: jest.fn() },
}));

jest.mock("../src/hooks/useHapticFeedback", () => ({
  useHapticFeedback: () => jest.fn(),
}));

jest.mock("../src/components/prototype/PrototypeScreenTransition", () => ({ children }) => <>{children}</>);

jest.mock("../src/components/payment/SecurePaymentBadge", () => () => null);

jest.mock("react-native-maps", () => {
  const { View } = require("react-native");
  const MockView = ({ children }) => <View>{children}</View>;
  return { __esModule: true, default: MockView, Marker: MockView, Polyline: MockView, PROVIDER_GOOGLE: "google" };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, bottom: 0, left: 0, right: 0 })),
}));

jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  return { Feather: () => <View />, Ionicons: () => <View /> };
});

const receipt = {
  id: "trip_closing",
  authoritativeSnapshot: true,
  financialSnapshotSource: "backend_final",
  fare: 25,
  finalFare: 25,
  toll: 4.5,
  tollFee: 4.5,
  driverNetAmount: 21.34,
  totalFees: 3.66,
  paymentMethod: "pix",
  driverId: "driver_1",
  driverName: "Carlos Motorista",
  passengerId: "passenger_1",
  passengerName: "Bruna Passageira",
  pickupAddress: "Rua Origem, Centro",
  destinationAddress: "Rua Destino, Botafogo",
  distanceKm: 4.2,
  durationMin: 16,
};

function renderScreen({ role, routeReceipt = receipt, runtime = {} }) {
  const markTripRating = jest.fn();
  const dismissCompletedReceipt = jest.fn();
  usePrototypeRideRuntime.mockReturnValue({
    tripHistory: [],
    lastReceipt: null,
    activeRole: role,
    profile: { uid: role === "driver" ? "driver_1" : "passenger_1" },
    profileUid: role === "driver" ? "driver_1" : "passenger_1",
    driverTripMeta: {},
    dismissCompletedReceipt,
    markTripRating,
    ...runtime,
  });
  const navigation = { navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
  const screen = render(
    <RobotaxiReceiptScreen
      navigation={navigation}
      route={{ params: { fromTrip: true, receipt: routeReceipt, ...(role === "driver" ? { activeRole: "driver" } : {}) } }}
    />,
  );
  return { screen, navigation, markTripRating, dismissCompletedReceipt };
}

describe("end of ride on the receipt screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RatingService.submitRating.mockResolvedValue({ success: true });
    RatingService.submitAirConditioning.mockResolvedValue({ success: true });
  });

  it("saves the passenger air conditioning answer before the rating", async () => {
    const { screen, markTripRating } = renderScreen({ role: "passenger" });

    fireEvent.press(screen.getByTestId("closing-air-conditioning-yes"));

    await waitFor(() => expect(screen.getByTestId("closing-rate-stage")).toBeTruthy());
    expect(RatingService.submitAirConditioning).toHaveBeenCalledWith({
      tripId: "trip_closing",
      airConditioningOk: true,
    });
    expect(markTripRating).toHaveBeenCalledWith("trip_closing", { airConditioningOk: true });
    expect(screen.getByText("Corrida concluída · Pix pago")).toBeTruthy();
    expect(screen.getByText("R$ 25,00")).toBeTruthy();
    expect(screen.getByText("Como foi com Carlos?")).toBeTruthy();
  });

  it("does not ask the air conditioning twice for a reopened receipt", () => {
    const { screen } = renderScreen({
      role: "passenger",
      routeReceipt: { ...receipt, airConditioningOk: false },
    });

    expect(screen.getByTestId("closing-rate-stage")).toBeTruthy();
  });

  it("shows the driver net amount and rates the passenger from the card", async () => {
    const { screen, dismissCompletedReceipt } = renderScreen({ role: "driver" });

    expect(screen.getByText("+ R$ 21,34")).toBeTruthy();
    expect(screen.getByText("Como foi com Bruna?")).toBeTruthy();
    fireEvent.press(screen.getByTestId("rating-star-5"));
    fireEvent.press(screen.getByTestId("receipt-done-button"));

    await waitFor(() => expect(dismissCompletedReceipt).toHaveBeenCalled());
    expect(RatingService.submitRating).toHaveBeenCalledWith(expect.objectContaining({
      tripId: "trip_closing",
      reviewerType: "driver",
      targetUserId: "passenger_1",
      rating: 5,
    }));
  });

  it("goes from the summary to the full receipt and back", async () => {
    const { screen } = renderScreen({ role: "driver" });

    fireEvent.press(screen.getByTestId("closing-view-receipt-button"));
    await waitFor(() => expect(screen.getByTestId("closing-details-stage")).toBeTruthy());
    expect(screen.getByTestId("driver-closing-toll-row")).toBeTruthy();
    expect(screen.getByTestId("driver-closing-fees-row")).toBeTruthy();

    fireEvent.press(screen.getByTestId("closing-full-receipt-button"));
    expect(screen.queryByTestId("ride-closing-card")).toBeNull();
    expect(screen.getByText("Valor recebido")).toBeTruthy();

    fireEvent.press(screen.getByTestId("driver-receipt-back-to-map-button"));
    expect(screen.getByTestId("closing-details-stage")).toBeTruthy();
  });

  it("does not offer stars while the final financial receipt is missing", () => {
    const { screen } = renderScreen({
      role: "driver",
      routeReceipt: { ...receipt, authoritativeSnapshot: false, financialSnapshotSource: "" },
      runtime: { recoverCompletedReceipt: jest.fn().mockResolvedValue({ recovered: false }) },
    });

    expect(screen.getByTestId("ride-closing-card")).toBeTruthy();
    expect(screen.queryByTestId("rating-star-1")).toBeNull();
    expect(screen.queryByText("+ R$ 21,34")).toBeNull();
  });
});

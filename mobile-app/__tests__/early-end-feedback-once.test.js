import React from "react";
import { render, waitFor } from "@testing-library/react-native";

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

jest.mock("../src/components/design-system/LeafChoiceSheet", () => ({
  showLeafChoiceSheet: jest.fn(() => Promise.resolve("consented")),
}));

const { showLeafChoiceSheet } = require("../src/components/design-system/LeafChoiceSheet");
const AsyncStorage = require("@react-native-async-storage/async-storage");
const {
  markEarlyEndAnswered,
  resetEarlyEndAnswerStoreForTests,
} = require("../src/screens/prototype/earlyEndAnswerStore");

function earlyEndReceipt(overrides = {}) {
  return {
    id: "booking_early_end_1",
    authoritativeSnapshot: true,
    financialSnapshotSource: "backend_final",
    completionType: "EARLY_ENDED_BY_DRIVER",
    settlementType: "EARLY_ENDED_BY_DRIVER",
    fare: 8.11,
    finalFare: 8.11,
    grossAmount: 8.11,
    totalFees: 1.29,
    driverNetAmount: 6.82,
    originalPaidAmount: 41.4,
    estimatedRefund: 33.29,
    paymentMethod: "pix",
    passengerId: "passenger_1",
    driverId: "driver_1",
    pickupAddress: "Rua Origem",
    destinationAddress: "Via Parque Shopping",
    earlyEnd: { detected: true, remainingMeters: 8103, thresholdMeters: 500 },
    ...overrides,
  };
}

function renderReceipt(receipt, reportIncident = jest.fn(() => Promise.resolve({ success: true }))) {
  usePrototypeRideRuntime.mockReturnValue({
    tripHistory: [],
    lastReceipt: null,
    activeRole: "passenger",
    driverTripMeta: {},
    dismissCompletedReceipt: jest.fn(),
    reportIncident,
  });
  const navigation = { replace: jest.fn(), navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };
  return render(<RobotaxiReceiptScreen navigation={navigation} route={{ params: { fromTrip: true, receipt } }} />);
}

describe("early-end question on the passenger receipt", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetEarlyEndAnswerStoreForTests();
    await AsyncStorage.clear?.();
  });

  it("does not ask again when this device already answered (new app session)", async () => {
    await markEarlyEndAnswered("booking_early_end_answered");
    renderReceipt(earlyEndReceipt({ id: "booking_early_end_answered" }));
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(showLeafChoiceSheet).not.toHaveBeenCalled();
  });

  it("does not ask when the server already has the passenger answer", async () => {
    renderReceipt(earlyEndReceipt({ id: "booking_early_end_server", earlyEndReviewStatus: "PASSENGER_CONSENTED" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(showLeafChoiceSheet).not.toHaveBeenCalled();
  });

  it("asks once, sends the answer and remembers it on the device", async () => {
    const reportIncident = jest.fn(() => Promise.resolve({ success: true }));
    renderReceipt(earlyEndReceipt({ id: "booking_early_end_new" }), reportIncident);
    await waitFor(() => expect(showLeafChoiceSheet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(reportIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: "early_end_consented",
      bookingId: "booking_early_end_new",
    })));
    await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "leaf:early-end-answered:v1",
      expect.stringContaining("booking_early_end_new"),
    ));
  });
});

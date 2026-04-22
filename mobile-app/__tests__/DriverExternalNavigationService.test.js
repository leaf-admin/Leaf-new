jest.mock("react-native", () => ({
  ActionSheetIOS: {
    showActionSheetWithOptions: jest.fn(),
  },
  Alert: {
    alert: jest.fn(),
  },
  Linking: {
    canOpenURL: jest.fn(),
    openURL: jest.fn(),
  },
  Platform: {
    OS: "ios",
  },
}));

const {
  ActionSheetIOS,
  Linking,
} = require("react-native");

const {
  openDriverExternalNavigation,
} = require("../src/services/DriverExternalNavigationService");

describe("DriverExternalNavigationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falls back to Google Maps web when the native scheme cannot be queried", async () => {
    ActionSheetIOS.showActionSheetWithOptions.mockImplementation(
      (_options, onSelect) => {
        onSelect(1);
      },
    );
    Linking.canOpenURL.mockRejectedValue(
      new Error("LSApplicationQueriesSchemes missing"),
    );
    Linking.openURL.mockResolvedValue(true);

    await expect(
      openDriverExternalNavigation({
        coordinate: { latitude: 37.7749, longitude: -122.4194 },
        destinationLabel: "Pickup",
        phase: "pickup",
      }),
    ).resolves.toBe("google_maps");

    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://maps.google.com/?daddr=37.7749,-122.4194&directionsmode=driving",
    );
  });

  it("falls back to Waze web when the native scheme cannot be queried", async () => {
    ActionSheetIOS.showActionSheetWithOptions.mockImplementation(
      (_options, onSelect) => {
        onSelect(2);
      },
    );
    Linking.canOpenURL.mockRejectedValue(
      new Error("LSApplicationQueriesSchemes missing"),
    );
    Linking.openURL.mockResolvedValue(true);

    await expect(
      openDriverExternalNavigation({
        coordinate: { latitude: 37.7954, longitude: -122.3936 },
        destinationLabel: "Dropoff",
        phase: "destination",
      }),
    ).resolves.toBe("waze");

    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://waze.com/ul?ll=37.7954,-122.3936&navigate=yes",
    );
  });
});

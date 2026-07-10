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
  Alert,
  Linking,
  Platform,
} = require("react-native");

const {
  openDriverExternalNavigation,
} = require("../src/services/DriverExternalNavigationService");

describe("DriverExternalNavigationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = "ios";
  });

  it("offers Apple Maps on iOS and opens the native Apple Maps URL", async () => {
    ActionSheetIOS.showActionSheetWithOptions.mockImplementation(
      (options, onSelect) => {
        expect(options.options).toEqual([
          "Cancelar",
          "Mapas da Apple",
          "Google Maps",
          "Waze",
        ]);
        onSelect(1);
      },
    );
    Linking.openURL.mockResolvedValue(true);

    await expect(
      openDriverExternalNavigation({
        coordinate: { latitude: -22.9711, longitude: -43.1822 },
        destinationLabel: "Embarque",
        phase: "pickup",
      }),
    ).resolves.toBe("apple_maps");

    expect(Linking.canOpenURL).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith(
      "http://maps.apple.com/?daddr=-22.9711,-43.1822&dirflg=d",
    );
  });

  it("falls back to Google Maps web when the native scheme cannot be queried", async () => {
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
        onSelect(3);
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

  it("offers Google Maps and Waze on Android without Apple Maps", async () => {
    Platform.OS = "android";
    Alert.alert.mockImplementation((_title, _message, actions) => {
      expect(actions.map(action => action.text)).toEqual([
        "Cancelar",
        "Google Maps",
        "Waze",
      ]);
      actions[1].onPress();
    });
    Linking.canOpenURL.mockResolvedValue(true);
    Linking.openURL.mockResolvedValue(true);

    await expect(
      openDriverExternalNavigation({
        coordinate: { latitude: -22.98, longitude: -43.36 },
        destinationLabel: "Destino",
        phase: "destination",
      }),
    ).resolves.toBe("google_maps");

    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith(
      "comgooglemaps://?daddr=-22.98,-43.36&directionsmode=driving",
    );
  });
});

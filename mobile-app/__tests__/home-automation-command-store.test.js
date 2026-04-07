const AsyncStorage = require("@react-native-async-storage/async-storage");
const {
  consumePersistedHomeAutomationCommand,
  persistHomeAutomationCommand,
} = require("../src/screens/prototype/homeAutomationCommandStore");

describe("home automation command store", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("persists and consumes a driver command for hot deeplink recovery", async () => {
    await persistHomeAutomationCommand({
      role: "driver",
      action: "accept_offer",
      bookingId: "booking_456",
      nonce: "nonce_456",
    });

    await expect(consumePersistedHomeAutomationCommand("driver")).resolves.toEqual({
      role: "driver",
      action: "accept_offer",
      bookingId: "booking_456",
      nonce: "nonce_456",
      queuedAt: null,
    });
  });

  it("ignores invalid commands without polluting storage", async () => {
    await expect(
      persistHomeAutomationCommand({
        role: "driver",
        action: "",
      })
    ).resolves.toBeNull();

    await expect(consumePersistedHomeAutomationCommand("driver")).resolves.toBeNull();
  });
});

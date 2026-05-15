const {
  isTruthyRouteParam,
  normalizePassengerAction,
  resolvePassengerHomeAutomationConfig,
} = require("../src/screens/prototype/passengerHomeAutomationConfig");

describe("passengerHomeAutomationConfig", () => {
  test("recognizes truthy route params", () => {
    expect(isTruthyRouteParam(true)).toBe(true);
    expect(isTruthyRouteParam("1")).toBe(true);
    expect(isTruthyRouteParam("true")).toBe(true);
    expect(isTruthyRouteParam("yes")).toBe(true);
    expect(isTruthyRouteParam("false")).toBe(false);
    expect(isTruthyRouteParam("")).toBe(false);
  });

  test("normalizes supported passenger actions", () => {
    expect(normalizePassengerAction("cleanup")).toBe("cleanup_active");
    expect(normalizePassengerAction("cancel-search")).toBe("cancel_search");
    expect(normalizePassengerAction("end-trip-early")).toBe("end_trip_early");
    expect(normalizePassengerAction("end-after-interruption")).toBe("end_after_interruption");
    expect(normalizePassengerAction("dismiss_receipt")).toBe("dismiss_receipt");
  });

  test("enables automation for passenger actions only in dev/e2e and on home route", () => {
    const devConfig = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "cleanup_active",
        qaNonce: "cleanup-once",
      },
      { isDriverRole: false, isHomeRoute: true, isDev: true, isE2E: false },
    );

    expect(devConfig.automationEnabled).toBe(true);
    expect(devConfig.action).toBe("cleanup_active");
    expect(devConfig.nonce).toBe("cleanup-once");
    expect(devConfig.bookingId).toBe("");

    const hiddenConfig = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "cleanup_active",
      },
      { isDriverRole: false, isHomeRoute: false, isDev: false, isE2E: false },
    );

    expect(hiddenConfig.automationEnabled).toBe(false);

    const prodConfig = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "cleanup_active",
        qaNonce: "prod-attempt",
      },
      { isDriverRole: false, isHomeRoute: true, isDev: false, isE2E: false },
    );

    expect(prodConfig.automationEnabled).toBe(false);
    expect(prodConfig.action).toBe("");
    expect(prodConfig.nonce).toBe("");
    expect(prodConfig.bookingId).toBe("");
  });

  test("keeps qa booking id for receipt and rating automation", () => {
    const config = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "rate_last_receipt",
        qaBookingId: "booking_123",
        qaNonce: "rate-once",
      },
      { isDriverRole: false, isHomeRoute: true, isDev: false, isE2E: true },
    );

    expect(config.automationEnabled).toBe(true);
    expect(config.action).toBe("rate_last_receipt");
    expect(config.bookingId).toBe("booking_123");
    expect(config.nonce).toBe("rate-once");
  });
});

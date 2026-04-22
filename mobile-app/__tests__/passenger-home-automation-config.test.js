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

  test("enables automation for passenger home actions only on home route", () => {
    const config = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "cleanup_active",
        qaNonce: "cleanup-once",
      },
      { isDriverRole: false, isHomeRoute: true, isDev: false, isE2E: false },
    );

    expect(config.automationEnabled).toBe(true);
    expect(config.action).toBe("cleanup_active");
    expect(config.nonce).toBe("cleanup-once");

    const hiddenConfig = resolvePassengerHomeAutomationConfig(
      {
        qaAutomation: "1",
        qaPassengerAction: "cleanup_active",
      },
      { isDriverRole: false, isHomeRoute: false, isDev: false, isE2E: false },
    );

    expect(hiddenConfig.automationEnabled).toBe(false);
  });
});

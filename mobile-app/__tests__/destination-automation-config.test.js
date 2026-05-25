const {
  isTruthyRouteParam,
  resolveDestinationAutomationConfig,
} = require("../src/screens/prototype/destinationAutomationConfig");

describe("destinationAutomationConfig", () => {
  test("recognizes truthy route params", () => {
    expect(isTruthyRouteParam(true)).toBe(true);
    expect(isTruthyRouteParam("1")).toBe(true);
    expect(isTruthyRouteParam("true")).toBe(true);
    expect(isTruthyRouteParam("yes")).toBe(true);
    expect(isTruthyRouteParam("false")).toBe(false);
    expect(isTruthyRouteParam("")).toBe(false);
  });

  test("enables automation in dev and keeps preset route params", () => {
    const config = resolveDestinationAutomationConfig(
      {
        e2e: "1",
        qaAutoFlow: "request",
        initialQuery: "Ferry Building",
      },
      { isExtensionFlow: false, isDev: true, isE2E: false },
    );

    expect(config.automationEnabled).toBe(true);
    expect(config.autoFlowMode).toBe("request");
    expect(config.autoSelectFirst).toBe(true);
    expect(config.autoOpenPix).toBe(true);
    expect(config.autoConfirmPix).toBe(true);
    expect(config.presetQuery).toBe("Ferry Building");
  });

  test("keeps route-param automation disabled in production contexts", () => {
    const config = resolveDestinationAutomationConfig(
      {
        e2e: "1",
        qaAutoFlow: "request",
        initialQuery: "Ferry Building",
      },
      { isExtensionFlow: false, isDev: false, isE2E: false },
    );

    expect(config.automationEnabled).toBe(false);
    expect(config.autoFlowMode).toBe("");
    expect(config.autoSelectFirst).toBe(false);
    expect(config.autoOpenPix).toBe(false);
    expect(config.autoConfirmPix).toBe(false);
    expect(config.presetQuery).toBe("");
  });

  test("disables automation for extension mode", () => {
    const config = resolveDestinationAutomationConfig(
      {
        e2e: "1",
        qaAutoFlow: "request",
        initialQuery: "Ferry Building",
      },
      { isExtensionFlow: true, isDev: true, isE2E: true },
    );

    expect(config.automationEnabled).toBe(false);
    expect(config.autoSelectFirst).toBe(false);
    expect(config.autoOpenPix).toBe(false);
    expect(config.autoConfirmPix).toBe(false);
    expect(config.presetQuery).toBe("");
  });
});

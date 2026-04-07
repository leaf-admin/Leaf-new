function isTruthyRouteParam(value) {
  if (value === true) {
    return true;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function sanitizeTextParam(value) {
  return String(value || "").trim();
}

function normalizeDriverAction(value) {
  const normalized = sanitizeTextParam(value).toLowerCase();

  if (
    normalized === "set_online" ||
    normalized === "set-online" ||
    normalized === "go_online" ||
    normalized === "go-online" ||
    normalized === "online"
  ) {
    return "set_online";
  }

  if (
    normalized === "set_offline" ||
    normalized === "set-offline" ||
    normalized === "go_offline" ||
    normalized === "go-offline" ||
    normalized === "offline"
  ) {
    return "set_offline";
  }

  if (
    normalized === "accept" ||
    normalized === "accept_offer" ||
    normalized === "accept-offer"
  ) {
    return "accept_offer";
  }

  if (
    normalized === "reject" ||
    normalized === "reject_offer" ||
    normalized === "reject-offer" ||
    normalized === "decline" ||
    normalized === "decline_offer" ||
    normalized === "decline-offer"
  ) {
    return "reject_offer";
  }

  if (
    normalized === "arrive" ||
    normalized === "arrive_pickup" ||
    normalized === "arrive-pickup" ||
    normalized === "arrived_at_pickup" ||
    normalized === "arrived-at-pickup"
  ) {
    return "arrive_pickup";
  }

  if (
    normalized === "start" ||
    normalized === "start_trip" ||
    normalized === "start-trip"
  ) {
    return "start_trip";
  }

  if (
    normalized === "complete" ||
    normalized === "complete_trip" ||
    normalized === "complete-trip" ||
    normalized === "finish_trip" ||
    normalized === "finish-trip"
  ) {
    return "complete_trip";
  }

  if (
    normalized === "interrupt" ||
    normalized === "interrupt_trip" ||
    normalized === "interrupt-trip" ||
    normalized === "interrupt_operational" ||
    normalized === "interrupt-operational" ||
    normalized === "report_problem" ||
    normalized === "report-problem"
  ) {
    return "interrupt_operational";
  }

  if (
    normalized === "accept_extension" ||
    normalized === "accept-extension"
  ) {
    return "accept_extension";
  }

  if (
    normalized === "reject_extension" ||
    normalized === "reject-extension"
  ) {
    return "reject_extension";
  }

  return "";
}

function resolveDriverHomeAutomationConfig(
  routeParams = {},
  { isDriverRole = false, isHomeRoute = false, isDev = false, isE2E = false } = {},
) {
  if (!isDriverRole) {
    return {
      automationEnabled: false,
      action: "",
      nonce: "",
      bookingId: "",
    };
  }

  const automationRequested =
    isTruthyRouteParam(routeParams?.e2e) ||
    isTruthyRouteParam(routeParams?.automation) ||
    isTruthyRouteParam(routeParams?.qaAutomation);

  const allowAutomationParams = isDev || isE2E || automationRequested;
  const action = allowAutomationParams
    ? normalizeDriverAction(
        routeParams?.qaDriverAction || routeParams?.driverAction || routeParams?.action,
      )
    : "";

  return {
    automationEnabled: Boolean(allowAutomationParams && action),
    action,
    nonce: allowAutomationParams
      ? sanitizeTextParam(routeParams?.qaNonce || routeParams?.nonce)
      : "",
    bookingId: allowAutomationParams
      ? sanitizeTextParam(routeParams?.qaBookingId || routeParams?.bookingId)
      : "",
  };
}

function resolveDriverHomeAutomationCommandConfig(
  command = null,
  { isDriverRole = false, isHomeRoute = false, isDev = false, isE2E = false } = {},
) {
  if (!command || typeof command !== "object") {
    return {
      automationEnabled: false,
      action: "",
      nonce: "",
      bookingId: "",
    };
  }

  return resolveDriverHomeAutomationConfig(
    {
      qaAutomation: "1",
      qaDriverAction: command.action,
      qaNonce: command.nonce,
      qaBookingId: command.bookingId,
    },
    {
      isDriverRole,
      isHomeRoute,
      isDev,
      isE2E,
    },
  );
}

function resolveEffectiveDriverHomeAutomationConfig(
  {
    routeParams = {},
    routeConfig = null,
    liveCommand = null,
    persistedCommand = null,
  } = {},
  { isDriverRole = false, isHomeRoute = false, isDev = false, isE2E = false } = {},
) {
  const context = {
    isDriverRole,
    isHomeRoute,
    isDev,
    isE2E,
  };
  const normalizedRouteConfig =
    routeConfig || resolveDriverHomeAutomationConfig(routeParams, context);
  const liveConfig = resolveDriverHomeAutomationCommandConfig(liveCommand, context);

  if (liveConfig.automationEnabled) {
    return liveConfig;
  }

  if (normalizedRouteConfig.automationEnabled) {
    return {
      ...normalizedRouteConfig,
      nonce:
        normalizedRouteConfig.nonce ||
        sanitizeTextParam(liveCommand?.nonce) ||
        sanitizeTextParam(persistedCommand?.nonce),
      bookingId:
        normalizedRouteConfig.bookingId ||
        sanitizeTextParam(liveCommand?.bookingId) ||
        sanitizeTextParam(persistedCommand?.bookingId),
    };
  }

  return resolveDriverHomeAutomationCommandConfig(persistedCommand, context);
}

module.exports = {
  isTruthyRouteParam,
  normalizeDriverAction,
  resolveDriverHomeAutomationConfig,
  resolveDriverHomeAutomationCommandConfig,
  resolveEffectiveDriverHomeAutomationConfig,
};

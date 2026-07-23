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

function normalizePassengerAction(value) {
  const normalized = sanitizeTextParam(value).toLowerCase();

  if (
    normalized === "cleanup_active" ||
    normalized === "cleanup-active" ||
    normalized === "cleanup" ||
    normalized === "reset_active" ||
    normalized === "reset-active"
  ) {
    return "cleanup_active";
  }

  if (
    normalized === "request_seeded_destination" ||
    normalized === "request-seeded-destination" ||
    normalized === "request_recent_destination" ||
    normalized === "request-recent-destination" ||
    normalized === "request_recent" ||
    normalized === "request-recent"
  ) {
    return "request_seeded_destination";
  }

  if (
    normalized === "cancel_search" ||
    normalized === "cancel-search" ||
    normalized === "cancel"
  ) {
    return "cancel_search";
  }

  if (
    normalized === "end_trip_early" ||
    normalized === "end-trip-early" ||
    normalized === "early_end" ||
    normalized === "early-end"
  ) {
    return "end_trip_early";
  }

  if (
    normalized === "end_after_interruption" ||
    normalized === "end-after-interruption" ||
    normalized === "end_operational" ||
    normalized === "end-operational"
  ) {
    return "end_after_interruption";
  }

  if (
    normalized === "dismiss_receipt" ||
    normalized === "dismiss-receipt" ||
    normalized === "close_receipt" ||
    normalized === "close-receipt"
  ) {
    return "dismiss_receipt";
  }

  if (
    normalized === "open_receipt" ||
    normalized === "open-receipt" ||
    normalized === "show_receipt" ||
    normalized === "show-receipt"
  ) {
    return "open_receipt";
  }

  if (
    normalized === "rate_last_receipt" ||
    normalized === "rate-last-receipt" ||
    normalized === "rate_receipt" ||
    normalized === "rate-receipt"
  ) {
    return "rate_last_receipt";
  }

  return "";
}

function resolvePassengerHomeAutomationConfig(
  routeParams = {},
  { isDriverRole = false, isHomeRoute = false, isDev = false, isE2E = false, isSimulator = false } = {},
) {
  if (isDriverRole || !isHomeRoute) {
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

  const allowAutomationParams = (isDev || isE2E || isSimulator) && automationRequested;
  const action = allowAutomationParams
    ? normalizePassengerAction(
        routeParams?.qaPassengerAction ||
          routeParams?.passengerAction ||
          routeParams?.action,
      )
    : "";

  return {
    automationEnabled: Boolean(allowAutomationParams && action),
    action,
    bookingId: allowAutomationParams
      ? sanitizeTextParam(
          routeParams?.qaBookingId ||
            routeParams?.bookingId ||
            routeParams?.rideId ||
            routeParams?.tripId,
        )
      : "",
    nonce: allowAutomationParams
      ? sanitizeTextParam(routeParams?.qaNonce || routeParams?.nonce)
      : "",
  };
}

module.exports = {
  isTruthyRouteParam,
  normalizePassengerAction,
  resolvePassengerHomeAutomationConfig,
};

function isTruthyRouteParam(value) {
  if (value === true) {
    return true;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeFlowMode(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeTextParam(value) {
  return String(value || "").trim();
}

function resolveDestinationAutomationConfig(
  routeParams = {},
  { isExtensionFlow = false, isDev = false, isE2E = false } = {},
) {
  const automationEnabled =
    isE2E ||
    isTruthyRouteParam(routeParams?.e2e) ||
    isTruthyRouteParam(routeParams?.automation) ||
    isTruthyRouteParam(routeParams?.qaAutomation);

  const allowAutomationParams = isDev || automationEnabled;
  const autoFlowMode = allowAutomationParams
    ? normalizeFlowMode(routeParams?.qaAutoFlow || routeParams?.autoFlow)
    : "";
  const presetQuery = allowAutomationParams
    ? sanitizeTextParam(
        routeParams?.qaPresetQuery ||
          routeParams?.initialQuery ||
          routeParams?.query,
      )
    : "";
  const nonce = allowAutomationParams
    ? sanitizeTextParam(routeParams?.qaNonce || routeParams?.nonce)
    : "";

  return {
    automationEnabled,
    autoFlowMode,
    autoSelectFirst:
      allowAutomationParams &&
      (autoFlowMode === "request" ||
        autoFlowMode === "extension" ||
        autoFlowMode === "quote" ||
        isTruthyRouteParam(routeParams?.qaAutoSelectFirst) ||
        isTruthyRouteParam(routeParams?.autoSelectFirst)),
    autoOpenPix:
      allowAutomationParams &&
      (autoFlowMode === "request" ||
        autoFlowMode === "extension" ||
        isTruthyRouteParam(routeParams?.qaAutoOpenPix) ||
        isTruthyRouteParam(routeParams?.autoOpenPix)),
    autoConfirmPix:
      !isExtensionFlow &&
      ((allowAutomationParams &&
        (autoFlowMode === "request" ||
          isTruthyRouteParam(routeParams?.qaAutoConfirmPix) ||
          isTruthyRouteParam(routeParams?.autoConfirmPix))) ||
        isE2E),
    nonce,
    presetQuery,
  };
}

module.exports = {
  isTruthyRouteParam,
  resolveDestinationAutomationConfig,
};

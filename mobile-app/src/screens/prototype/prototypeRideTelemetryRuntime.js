function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function resolveSourceKey(sourceMeta = {}, requestedSourceKey = "") {
  const normalizedRequestedSourceKey = sanitizeText(requestedSourceKey, "");
  if (normalizedRequestedSourceKey) {
    return normalizedRequestedSourceKey;
  }

  return `${sourceMeta.userType || "unknown"}:${sourceMeta.userId || "anonymous"}`;
}

function withTelemetryOverrides(context = {}, overrides = {}) {
  return {
    ...context,
    ...(overrides.cacheMode ? { cacheMode: overrides.cacheMode } : {}),
    ...(overrides.routeScope ? { routeScope: overrides.routeScope } : {}),
    ...(overrides.forceFresh === true ? { forceFresh: true } : {}),
    ...(overrides.surface ? { surface: overrides.surface } : {}),
  };
}

export function createPrototypeRideTelemetryRuntime({
  telemetryService,
  platformOS = "unknown",
  getRuntimeState = () => ({}),
} = {}) {
  if (!telemetryService) {
    throw new Error("telemetryService is required");
  }

  let draftContextId = null;

  function resolveSourceMeta(overrides = {}) {
    const runtimeState = getRuntimeState() || {};
    const role = String(overrides.role || runtimeState.activeRole || "passenger")
      .trim()
      .toLowerCase();
    const userType = overrides.userType || (role === "driver" ? "driver" : "customer");

    return {
      userId: overrides.userId || runtimeState.profileUid || null,
      userType,
      platform: platformOS,
      flow: "prototype",
      scenario: "robotaxi_prototype",
      surface: overrides.surface || "prototype_runtime",
    };
  }

  function resolveContext(overrides = {}) {
    const runtimeState = getRuntimeState() || {};
    const sourceMeta = resolveSourceMeta(overrides);
    const sourceKey = resolveSourceKey(sourceMeta, overrides.sourceKey);
    const bookingId =
      overrides.bookingId ||
      runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      null;

    if (bookingId) {
      return withTelemetryOverrides(
        telemetryService.ensureContext({
          bookingId,
          sourceMeta,
          sourceKey,
        }),
        overrides,
      );
    }

    if (!draftContextId) {
      draftContextId = telemetryService.ensureContext({
        sourceMeta,
        sourceKey,
      }).contextId;
    }

    return withTelemetryOverrides(
      telemetryService.ensureContext({
        contextId: draftContextId,
        sourceMeta,
        sourceKey,
      }),
      overrides,
    );
  }

  function bindToBooking(bookingId, overrides = {}) {
    const normalizedBookingId = String(bookingId || "").trim();
    if (!normalizedBookingId) {
      return null;
    }

    const sourceMeta = resolveSourceMeta(overrides);
    const boundContext = telemetryService.bindContextToBooking({
      contextId: draftContextId,
      bookingId: normalizedBookingId,
      sourceMeta,
      sourceKey: overrides.sourceKey || null,
    });
    draftContextId = null;
    return boundContext;
  }

  function rotateDraftContext(overrides = {}) {
    const sourceMeta = resolveSourceMeta(overrides);
    const sourceKey = resolveSourceKey(sourceMeta, overrides.sourceKey);
    const rotatedContext = telemetryService.rotateDraftContext({
      sourceMeta,
      sourceKey,
    });
    draftContextId = rotatedContext?.contextId || null;
    return rotatedContext;
  }

  function resetDraftContextForTests() {
    draftContextId = null;
  }

  function getDraftContextIdForTests() {
    return draftContextId;
  }

  return {
    bindToBooking,
    getDraftContextIdForTests,
    resetDraftContextForTests,
    resolveContext,
    resolveSourceMeta,
    rotateDraftContext,
  };
}

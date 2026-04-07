const ACTIVE_PASSENGER_BOOKING_STATUSES = new Set([
  "requesting",
  "searching",
  "accepted",
  "arrived",
  "started",
  "operational_interrupted",
  "searching_replacement",
]);

const ACTIVE_DRIVER_BOOKING_STATUSES = new Set([
  "searching",
  "accepted",
  "arrived",
  "started",
  "operational_interrupted",
  "searching_replacement",
]);

const CRITICAL_RUNTIME_KEYS = new Set([
  "bookingStatus",
  "activeBookingId",
  "activeBooking",
  "driverTransientCard",
  "driverOffers",
  "driverActiveRide",
  "driverOnline",
  "driverOnlinePending",
  "paymentState",
  "rideExtension",
  "driverExtensionRequest",
  "operationalContinuation",
  "lastReceipt",
]);

export function normalizeRuntimeLifecycleStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function hasPendingDriverOffer(driverOffers) {
  return Array.isArray(driverOffers) && driverOffers.some((offer) => {
    const bookingId = String(offer?.bookingId || offer?.id || "").trim();
    return Boolean(bookingId);
  });
}

export function hasActiveDriverRide(driverActiveRide) {
  const bookingId = String(
    driverActiveRide?.bookingId || driverActiveRide?.id || "",
  ).trim();
  return Boolean(bookingId);
}

export function hasVisibleDriverTransientCard(driverTransientCard) {
  const cardId = String(driverTransientCard?.id || "").trim();
  const visibleUntilMs = new Date(driverTransientCard?.visibleUntil || "").getTime();

  if (!cardId) {
    return false;
  }

  if (!Number.isFinite(visibleUntilMs)) {
    return true;
  }

  return visibleUntilMs > Date.now();
}

export function shouldFlushRuntimeSessionImmediately(
  previousState = {},
  patch = {},
  nextState = {},
) {
  const changedKeys = Object.keys(patch || {});
  if (!changedKeys.some((key) => CRITICAL_RUNTIME_KEYS.has(key))) {
    return false;
  }

  const previousStatus = normalizeRuntimeLifecycleStatus(
    previousState?.bookingStatus,
  );
  const nextStatus = normalizeRuntimeLifecycleStatus(nextState?.bookingStatus);

  if (
    changedKeys.includes("bookingStatus") &&
    previousStatus !== nextStatus &&
    (ACTIVE_PASSENGER_BOOKING_STATUSES.has(nextStatus) ||
      ACTIVE_DRIVER_BOOKING_STATUSES.has(nextStatus) ||
      nextStatus === "completed" ||
      nextStatus === "idle")
  ) {
    return true;
  }

  if (
    changedKeys.includes("activeBookingId") &&
    String(previousState?.activeBookingId || "") !==
      String(nextState?.activeBookingId || "")
  ) {
    return true;
  }

  if (
    changedKeys.includes("driverTransientCard") &&
    hasVisibleDriverTransientCard(nextState?.driverTransientCard)
  ) {
    return true;
  }

  if (
    changedKeys.includes("driverOffers") &&
    hasPendingDriverOffer(nextState?.driverOffers)
  ) {
    return true;
  }

  if (
    changedKeys.includes("driverActiveRide") &&
    hasActiveDriverRide(nextState?.driverActiveRide)
  ) {
    return true;
  }

  if (
    changedKeys.includes("driverOnline") ||
    changedKeys.includes("driverOnlinePending")
  ) {
    return true;
  }

  if (
    changedKeys.includes("paymentState") ||
    changedKeys.includes("rideExtension") ||
    changedKeys.includes("driverExtensionRequest") ||
    changedKeys.includes("operationalContinuation") ||
    changedKeys.includes("lastReceipt")
  ) {
    return true;
  }

  return false;
}

export function shouldMaintainRealtimeSessionForSnapshot(
  role,
  snapshot = {},
) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();
  const bookingStatus = normalizeRuntimeLifecycleStatus(snapshot?.bookingStatus);

  if (normalizedRole === "customer") {
    return (
      ACTIVE_PASSENGER_BOOKING_STATUSES.has(bookingStatus) ||
      Boolean(snapshot?.activeBookingId)
    );
  }

  if (normalizedRole === "driver") {
    return (
      Boolean(snapshot?.driverOnline) ||
      Boolean(snapshot?.driverOnlinePending) ||
      hasActiveDriverRide(snapshot?.driverActiveRide) ||
      hasPendingDriverOffer(snapshot?.driverOffers) ||
      ACTIVE_DRIVER_BOOKING_STATUSES.has(bookingStatus) ||
      Boolean(snapshot?.activeBookingId)
    );
  }

  return false;
}

export function shouldSyncActiveRideForSnapshot(role, snapshot = {}) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();

  if (normalizedRole === "customer") {
    return shouldMaintainRealtimeSessionForSnapshot("customer", snapshot);
  }

  if (normalizedRole === "driver") {
    return (
      Boolean(snapshot?.driverOnline) ||
      Boolean(snapshot?.driverOnlinePending) ||
      hasActiveDriverRide(snapshot?.driverActiveRide) ||
      hasPendingDriverOffer(snapshot?.driverOffers) ||
      ACTIVE_DRIVER_BOOKING_STATUSES.has(
        normalizeRuntimeLifecycleStatus(snapshot?.bookingStatus),
      ) ||
      Boolean(snapshot?.activeBookingId)
    );
  }

  return false;
}

export function shouldFlushRuntimeSessionOnAppState(appState) {
  const normalized = String(appState || "")
    .trim()
    .toLowerCase();
  return normalized === "inactive" || normalized === "background";
}

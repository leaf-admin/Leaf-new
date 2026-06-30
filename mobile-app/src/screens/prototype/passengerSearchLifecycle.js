import { SEARCH_TOTAL_DURATION_SECONDS } from "./searchPresentation";

const PASSENGER_DRIVER_SEARCH_STATUSES = new Set([
  "searching",
  "searching_replacement",
]);

const PASSENGER_PROTECTED_PRE_ACCEPT_STATUSES = new Set([
  "requesting",
  ...PASSENGER_DRIVER_SEARCH_STATUSES,
]);

export const SEARCH_TIMEOUT_RECONCILING_MESSAGE =
  "O tempo de busca terminou. Estamos confirmando o encerramento com o servidor.";

export function isPassengerSearchExpired({
  role,
  bookingStatus,
  elapsedSeconds,
}) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();

  return (
    (normalizedRole === "customer" || normalizedRole === "passenger") &&
    PASSENGER_DRIVER_SEARCH_STATUSES.has(normalizedStatus) &&
    Number(elapsedSeconds || 0) >= SEARCH_TOTAL_DURATION_SECONDS
  );
}

export function shouldPreservePassengerSearchOnIdleSync({
  role,
  syncedStatus,
  bookingStatus,
  elapsedSeconds,
  activeBookingId,
  activeBooking,
  paymentStatus,
}) {
  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();
  const normalizedSyncedStatus = String(syncedStatus || "")
    .trim()
    .toLowerCase();
  const normalizedPaymentStatus = String(paymentStatus || "")
    .trim()
    .toLowerCase();

  if (
    normalizedSyncedStatus !== "idle" ||
    !PASSENGER_PROTECTED_PRE_ACCEPT_STATUSES.has(normalizedStatus)
  ) {
    return false;
  }

  return (
    Boolean(activeBookingId) ||
    Boolean(activeBooking && typeof activeBooking === "object") ||
    ["processing", "confirmed"].includes(normalizedPaymentStatus)
  );
}

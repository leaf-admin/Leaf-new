const TRANSIENT_BOOKING_ERROR_CODES = new Set([
  "BOOKING_TIMEOUT",
  "WS_DISCONNECTED",
  "WS_CONNECT_TIMEOUT",
  "DUPLICATE_REQUEST",
  "QUEUE_BACKPRESSURE",
  "AUTH_BUSY",
  "AUTH_TIMEOUT",
  "PAYMENT_NOT_CONFIRMED",
]);

export function shouldIgnoreTransientBookingError(
  payload = {},
  runtimeSnapshot = {},
) {
  const bookingStatus = String(runtimeSnapshot?.bookingStatus || "")
    .trim()
    .toLowerCase();
  const paymentStatus = String(runtimeSnapshot?.paymentState?.status || "")
    .trim()
    .toLowerCase();
  const code = String(payload?.code || "").trim();
  const retryAfterSec = Number(payload?.retryAfterSec || 0);

  if (bookingStatus !== "requesting") {
    return false;
  }

  if (TRANSIENT_BOOKING_ERROR_CODES.has(code)) {
    return true;
  }

  return retryAfterSec > 0 && paymentStatus === "processing";
}

export { TRANSIENT_BOOKING_ERROR_CODES };

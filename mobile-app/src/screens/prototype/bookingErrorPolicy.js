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

const NO_DRIVERS_BOOKING_ERROR_CODES = new Set([
  "NO_DRIVERS",
  "NO_DRIVERS_AVAILABLE",
  "NO_DRIVERS_FOUND",
]);

export function isNoDriversBookingError(payload = {}) {
  const nestedPayload =
    payload?.payload && typeof payload.payload === "object"
      ? payload.payload
      : {};
  const code = String(payload?.code || nestedPayload?.code || "")
    .trim()
    .toUpperCase();

  if (NO_DRIVERS_BOOKING_ERROR_CODES.has(code)) {
    return true;
  }

  const message = String(
    payload?.message ||
      payload?.error ||
      payload?.rawMessage ||
      nestedPayload?.message ||
      nestedPayload?.error ||
      "",
  ).toLowerCase();

  return (
    /no[_\s-]?drivers/.test(message) ||
    /nenhum motorista/.test(message) ||
    /n[aã]o (?:h[aá]|encontramos) motoristas?/.test(message) ||
    /sem motoristas?/.test(message)
  );
}

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

export { NO_DRIVERS_BOOKING_ERROR_CODES, TRANSIENT_BOOKING_ERROR_CODES };

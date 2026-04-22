import {
  shouldIgnoreTransientBookingError,
  TRANSIENT_BOOKING_ERROR_CODES,
} from "../src/screens/prototype/bookingErrorPolicy";

describe("bookingErrorPolicy", () => {
  it("ignores transient booking errors while the request is still in flight", () => {
    expect(
      shouldIgnoreTransientBookingError(
        { code: "PAYMENT_NOT_CONFIRMED" },
        {
          bookingStatus: "requesting",
          paymentState: { status: "processing" },
        },
      ),
    ).toBe(true);
  });

  it("does not ignore booking errors after the request phase", () => {
    expect(
      shouldIgnoreTransientBookingError(
        { code: "PAYMENT_NOT_CONFIRMED" },
        {
          bookingStatus: "idle",
          paymentState: { status: "failed" },
        },
      ),
    ).toBe(false);
  });

  it("keeps the transient code list aligned with the client retry policy", () => {
    expect(TRANSIENT_BOOKING_ERROR_CODES.has("PAYMENT_NOT_CONFIRMED")).toBe(
      true,
    );
    expect(TRANSIENT_BOOKING_ERROR_CODES.has("BOOKING_TIMEOUT")).toBe(true);
  });
});

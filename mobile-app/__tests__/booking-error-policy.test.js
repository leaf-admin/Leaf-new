import {
  isNoDriversBookingError,
  NO_DRIVERS_BOOKING_ERROR_CODES,
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

  it("classifies only genuine no-driver failures as no-drivers outcomes", () => {
    expect(isNoDriversBookingError({ code: "NO_DRIVERS_AVAILABLE" })).toBe(
      true,
    );
    expect(
      isNoDriversBookingError({
        payload: { message: "Não há motoristas disponíveis agora." },
      }),
    ).toBe(true);
    expect(isNoDriversBookingError({ code: "QUEUE_BACKPRESSURE" })).toBe(
      false,
    );
    expect(NO_DRIVERS_BOOKING_ERROR_CODES.has("NO_DRIVERS_FOUND")).toBe(true);
  });
});

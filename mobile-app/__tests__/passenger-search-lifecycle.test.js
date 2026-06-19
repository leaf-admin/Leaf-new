import {
  isPassengerSearchExpired,
  shouldPreservePassengerSearchOnIdleSync,
} from "../src/screens/prototype/passengerSearchLifecycle";

describe("passenger search lifecycle", () => {
  it("preserves a fresh local search during the short active-index race", () => {
    expect(
      shouldPreservePassengerSearchOnIdleSync({
        role: "customer",
        syncedStatus: "idle",
        bookingStatus: "searching",
        elapsedSeconds: 12,
        activeBookingId: "booking_1",
        paymentStatus: "confirmed",
      }),
    ).toBe(true);
  });

  it("treats the canonical deadline as terminal instead of preserving stale search", () => {
    expect(
      isPassengerSearchExpired({
        role: "customer",
        bookingStatus: "searching",
        elapsedSeconds: 180,
      }),
    ).toBe(true);
    expect(
      shouldPreservePassengerSearchOnIdleSync({
        role: "customer",
        syncedStatus: "idle",
        bookingStatus: "searching",
        elapsedSeconds: 180,
        activeBookingId: "booking_stale",
        paymentStatus: "confirmed",
      }),
    ).toBe(false);
  });
});

import {
  dismissDriverOfferRuntimeState,
  resolveDriverOfferClearPresentation,
} from "../src/screens/prototype/driverOfferState";

describe("driverOfferState", () => {
  it("distinguishes an authoritative offer timeout from passenger cancellation", () => {
    expect(
      resolveDriverOfferClearPresentation({
        code: "DRIVER_RESPONSE_TIMEOUT",
        reason: "offer_timeout",
      }),
    ).toEqual(
      expect.objectContaining({
        isOfferTimeout: true,
        suppressReason: "offer_timeout",
        transientType: "offer_expired",
        title: "Oferta expirada",
      }),
    );
    expect(resolveDriverOfferClearPresentation({})).toEqual(
      expect.objectContaining({
        isOfferTimeout: false,
        suppressReason: "clear_ride_request",
        transientType: "rider_cancelled_before_accept",
        title: "Corrida cancelada pelo passageiro",
      }),
    );
  });

  it("dismisses a single pending offer and returns the driver to idle", () => {
    const result = dismissDriverOfferRuntimeState(
      {
        bookingStatus: "searching",
        driverOffers: [{ bookingId: "booking_1" }],
        driverActiveRide: null,
        lastError: "Recusada pelo motorista.",
      },
      "booking_1",
    );

    expect(result.didDismissOffer).toBe(true);
    expect(result.patch).toEqual(
      expect.objectContaining({
        bookingStatus: "idle",
        driverOffers: [],
        lastError: "",
      }),
    );
  });

  it("keeps searching when another offer is still available", () => {
    const result = dismissDriverOfferRuntimeState(
      {
        bookingStatus: "searching",
        driverOffers: [
          { bookingId: "booking_1" },
          { bookingId: "booking_2" },
        ],
        driverActiveRide: null,
      },
      "booking_1",
    );

    expect(result.didDismissOffer).toBe(true);
    expect(result.patch).toEqual(
      expect.objectContaining({
        driverOffers: [{ bookingId: "booking_2" }],
      }),
    );
    expect(result.patch.bookingStatus).toBeUndefined();
  });

  it("clears active booking details when the dismissed booking was active", () => {
    const result = dismissDriverOfferRuntimeState(
      {
        bookingStatus: "searching",
        activeBookingId: "booking_1",
        activeBooking: { bookingId: "booking_1" },
        driverOffers: [{ bookingId: "booking_1" }],
        driverInfo: { id: "driver_1" },
        driverCoordinate: { latitude: 1, longitude: 2 },
        boardingDeadlineAt: "2026-04-02T10:00:00.000Z",
        boardingRemainingSec: 90,
        searchingElapsedSeconds: 12,
      },
      "booking_1",
    );

    expect(result.clearedActiveBooking).toBe(true);
    expect(result.patch).toEqual(
      expect.objectContaining({
        bookingStatus: "idle",
        activeBookingId: null,
        activeBooking: null,
        driverInfo: null,
        driverCoordinate: null,
        boardingDeadlineAt: null,
        boardingRemainingSec: 0,
        searchingElapsedSeconds: 0,
      }),
    );
  });

  it("clears a passenger-cancelled offer before the driver can accept it", () => {
    const result = dismissDriverOfferRuntimeState(
      {
        bookingStatus: "searching",
        activeBookingId: "booking_cancelled_before_accept",
        activeBooking: {
          bookingId: "booking_cancelled_before_accept",
          paymentStatus: "in_holding",
        },
        driverOffers: [
          {
            bookingId: "booking_cancelled_before_accept",
            passengerName: "Leaf Passageira Teste",
          },
        ],
        driverActiveRide: null,
        lastError: "",
      },
      "booking_cancelled_before_accept",
    );

    expect(result.didDismissOffer).toBe(true);
    expect(result.clearedActiveBooking).toBe(true);
    expect(result.clearedActiveRide).toBe(false);
    expect(result.patch).toEqual(
      expect.objectContaining({
        bookingStatus: "idle",
        activeBookingId: null,
        activeBooking: null,
        driverOffers: [],
        lastError: "",
      }),
    );
  });
});

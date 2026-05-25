import {
  hasActiveDriverRide,
  hasPendingDriverOffer,
  hasVisibleDriverTransientCard,
  normalizeRuntimeLifecycleStatus,
  shouldFlushRuntimeSessionImmediately,
  shouldFlushRuntimeSessionOnAppState,
  shouldMaintainRealtimeSessionForSnapshot,
  shouldSyncActiveRideForSnapshot,
} from "../src/screens/prototype/runtimeCrashRecovery";

describe("runtimeCrashRecovery", () => {
  it("detects pending driver offers and active driver rides", () => {
    expect(hasPendingDriverOffer([{ bookingId: "booking_1" }])).toBe(true);
    expect(hasPendingDriverOffer([])).toBe(false);
    expect(hasActiveDriverRide({ bookingId: "booking_1" })).toBe(true);
    expect(hasActiveDriverRide(null)).toBe(false);
    expect(
      hasVisibleDriverTransientCard({
        id: "card_1",
        visibleUntil: new Date(Date.now() + 5000).toISOString(),
      }),
    ).toBe(true);
    expect(
      hasVisibleDriverTransientCard({
        id: "card_1",
        visibleUntil: new Date(Date.now() - 5000).toISOString(),
      }),
    ).toBe(false);
  });

  it("flushes immediately on critical ride lifecycle transitions", () => {
    expect(
      shouldFlushRuntimeSessionImmediately(
        { bookingStatus: "idle", activeBookingId: null },
        { bookingStatus: "searching", activeBookingId: "booking_1" },
        { bookingStatus: "searching", activeBookingId: "booking_1" },
      ),
    ).toBe(true);

    expect(
      shouldFlushRuntimeSessionImmediately(
        { bookingStatus: "accepted", driverOnline: false },
        { driverOnline: true, driverOnlinePending: false },
        { bookingStatus: "accepted", driverOnline: true, driverOnlinePending: false },
      ),
    ).toBe(true);

    expect(
      shouldFlushRuntimeSessionImmediately(
        { bookingStatus: "accepted", driverCoordinate: null },
        { driverCoordinate: { latitude: -23.5, longitude: -46.6 } },
        {
          bookingStatus: "accepted",
          driverCoordinate: { latitude: -23.5, longitude: -46.6 },
        },
      ),
    ).toBe(false);

    expect(
      shouldFlushRuntimeSessionImmediately(
        { bookingStatus: "idle", driverTransientCard: { id: "", visibleUntil: null } },
        {
          driverTransientCard: {
            id: "competitive_1",
            type: "accepted_by_other_driver_competitive",
            visibleUntil: new Date(Date.now() + 5000).toISOString(),
          },
        },
        {
          bookingStatus: "idle",
          driverTransientCard: {
            id: "competitive_1",
            type: "accepted_by_other_driver_competitive",
            visibleUntil: new Date(Date.now() + 5000).toISOString(),
          },
        },
      ),
    ).toBe(true);
  });

  it("keeps realtime maintenance alive for driver offers and active trips", () => {
    expect(
      shouldMaintainRealtimeSessionForSnapshot("driver", {
        driverOffers: [{ bookingId: "booking_1" }],
        driverOnline: false,
        bookingStatus: "idle",
      }),
    ).toBe(true);

    expect(
      shouldSyncActiveRideForSnapshot("driver", {
        driverOffers: [{ bookingId: "booking_1" }],
        driverOnline: false,
        bookingStatus: "idle",
      }),
    ).toBe(true);

    expect(
      shouldMaintainRealtimeSessionForSnapshot("driver", {
        driverOffers: [],
        driverActiveRide: null,
        driverOnline: false,
        bookingStatus: "idle",
      }),
    ).toBe(false);
  });

  it("keeps passenger ride flow sessions synced but ignores settled surfaces", () => {
    expect(
      shouldMaintainRealtimeSessionForSnapshot("customer", {
        bookingStatus: "accepted",
        activeBookingId: "booking_1",
      }),
    ).toBe(true);

    expect(
      shouldSyncActiveRideForSnapshot("customer", {
        bookingStatus: "completed",
        activeBookingId: null,
      }),
    ).toBe(false);

    expect(
      shouldMaintainRealtimeSessionForSnapshot("customer", {
        bookingStatus: "NO_DRIVERS_AVAILABLE",
        activeBookingId: "booking_1",
      }),
    ).toBe(false);

    expect(
      shouldSyncActiveRideForSnapshot("customer", {
        bookingStatus: "CANCELED",
        activeBookingId: "booking_1",
      }),
    ).toBe(false);
  });

  it("normalizes backend ride statuses into runtime lifecycle phases", () => {
    expect(normalizeRuntimeLifecycleStatus("AWAITING_PAYMENT")).toBe("requesting");
    expect(normalizeRuntimeLifecycleStatus("NOTIFIED")).toBe("searching");
    expect(normalizeRuntimeLifecycleStatus("MATCHED")).toBe("accepted");
    expect(normalizeRuntimeLifecycleStatus("ARRIVED")).toBe("arrived");
    expect(normalizeRuntimeLifecycleStatus("REASSIGNED_IN_PROGRESS")).toBe("started");
    expect(normalizeRuntimeLifecycleStatus("NO_DRIVERS_FOUND")).toBe("no_drivers");
    expect(normalizeRuntimeLifecycleStatus("CANCELLED")).toBe("canceled");
  });

  it("keeps driver realtime online on terminal ride status without syncing active ride", () => {
    const snapshot = {
      bookingStatus: "COMPLETED",
      activeBookingId: "booking_1",
      driverOnline: true,
    };

    expect(shouldMaintainRealtimeSessionForSnapshot("driver", snapshot)).toBe(true);
    expect(shouldSyncActiveRideForSnapshot("driver", snapshot)).toBe(false);
  });

  it("flushes when the app moves to inactive or background", () => {
    expect(shouldFlushRuntimeSessionOnAppState("inactive")).toBe(true);
    expect(shouldFlushRuntimeSessionOnAppState("background")).toBe(true);
    expect(shouldFlushRuntimeSessionOnAppState("active")).toBe(false);
  });
});

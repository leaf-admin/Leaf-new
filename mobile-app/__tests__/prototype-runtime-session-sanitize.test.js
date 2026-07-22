jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: "ExpoPushToken[test]" })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve("notification-id")),
}));

import {
  buildRuntimeProfileDispatchKey,
  buildCompletedRideEphemeralResetPatch,
  extractPrototypeDriverKycFailureContext,
  resolveAcceptedPickupDistanceKm,
  resolveRuntimeStatePatchChanges,
  sanitizePersistedRuntimeSessionForProfile,
  shouldAttemptCompletedReceiptRecovery,
  shouldDispatchRuntimeProfileRestore,
} from "../src/screens/prototype/prototypeRideRuntime";

describe("sanitizePersistedRuntimeSessionForProfile", () => {
  const passengerProfile = {
    uid: "passenger_1",
    usertype: "customer",
    role: "customer",
  };
  const driverProfile = {
    uid: "driver_1",
    usertype: "driver",
    role: "driver",
  };

  it("preserves opaque identity-review references from an online gate failure", () => {
    expect(
      extractPrototypeDriverKycFailureContext({
        code: "KYC_IDENTITY_REVIEW_HOLD",
        payload: {
          challengeId: "challenge_01HZX9",
          requirement: "IDENTITY_REVERIFICATION",
          evidenceId: "evidence_01HZX9",
          reviewCaseId: "case_01HZX9",
          reviewAvailable: true,
        },
      }),
    ).toEqual({
      challengeId: "challenge_01HZX9",
      requirement: "IDENTITY_REVERIFICATION",
      evidenceId: "evidence_01HZX9",
      reviewCaseId: "case_01HZX9",
      reviewAvailable: true,
    });
  });

  it("keeps zero as a valid accepted pickup distance instead of using trip distance fallbacks", () => {
    expect(
      resolveAcceptedPickupDistanceKm({
        payloadDistanceKm: 0,
        previewDistanceKm: 27,
        directDistanceKm: 0.002,
      }),
    ).toBe(0);

    expect(
      resolveAcceptedPickupDistanceKm({
        previewDistanceKm: 0,
        directDistanceKm: 27,
      }),
    ).toBe(0);

    expect(resolveAcceptedPickupDistanceKm({})).toBeNull();
  });

  it("does not attempt completed receipt recovery during active ride states", () => {
    expect(shouldAttemptCompletedReceiptRecovery({ bookingStatus: "accepted" })).toBe(false);
    expect(shouldAttemptCompletedReceiptRecovery({ bookingStatus: "arrived" })).toBe(false);
    expect(shouldAttemptCompletedReceiptRecovery({ bookingStatus: "started" })).toBe(false);
    expect(shouldAttemptCompletedReceiptRecovery({ bookingStatus: "completed" })).toBe(true);
    expect(shouldAttemptCompletedReceiptRecovery({ bookingStatus: "started", force: true })).toBe(true);
  });

  it("drops passenger pre-booking artifacts while keeping last known pickup location", () => {
    const restored = sanitizePersistedRuntimeSessionForProfile(
      {
        activeRole: "customer",
        bookingStatus: "idle",
        activeBookingId: null,
        activeBooking: null,
        selectedDestination: {
          name: "BarraShopping",
          coordinate: { latitude: -22.997658, longitude: -43.358127 },
        },
        quoteLock: {
          quoteLockId: "ql_old_prebooking",
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        selectedFare: 81.03,
        selectedVehicle: "Leaf Elite",
        tripDistanceKm: 24.2,
        tripDurationMin: 38,
        tripArrivalText: "00:27",
        boardingDeadlineAt: "2026-06-25T03:00:00.000Z",
        boardingRemainingSec: 90,
        searchingElapsedSeconds: 45,
        currentCoordinate: { latitude: -22.8535, longitude: -43.305 },
        currentHeading: 180,
        currentAddress: "Rua Alecrim, 489, Rio de Janeiro",
        driverInfo: { name: "Motorista antigo" },
        driverCoordinate: { latitude: -22.9, longitude: -43.2 },
        paymentState: {
          status: "failed",
          paymentId: null,
          amount: 52.22,
          method: "pix",
          error: "Nao foi possivel processar o pagamento via Pix. Tente novamente.",
          refundStatus: null,
          refundAmount: 0,
          cancellationFee: 0,
          refundId: null,
          chargeId: null,
        },
        lastError: "Nao foi possivel processar o pagamento via Pix. Tente novamente.",
      },
      passengerProfile,
    );

    expect(restored.bookingStatus).toBe("idle");
    expect(restored.activeBookingId).toBeNull();
    expect(restored.selectedDestination).toBeNull();
    expect(restored.quoteLock).toBeNull();
    expect(restored.selectedFare).toBeNull();
    expect(restored.selectedVehicle).toBe("");
    expect(restored.tripDistanceKm).toBeNull();
    expect(restored.tripDurationMin).toBeNull();
    expect(restored.tripArrivalText).toBe("");
    expect(restored.boardingDeadlineAt).toBeNull();
    expect(restored.boardingRemainingSec).toBe(0);
    expect(restored.searchingElapsedSeconds).toBe(0);
    expect(restored.currentCoordinate).toEqual({ latitude: -22.8535, longitude: -43.305 });
    expect(restored.currentHeading).toBe(180);
    expect(restored.currentAddress).toBe("Rua Alecrim, 489, Rio de Janeiro");
    expect(restored.driverInfo).toBeNull();
    expect(restored.driverCoordinate).toBeNull();
    expect(restored.driverActiveRide).toBeNull();
    expect(restored.paymentState).toEqual({
      status: "idle",
      paymentId: null,
      amount: 0,
      method: "pix",
      error: "",
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: null,
    });
    expect(restored.lastError).toBe("");
  });

  it("keeps passenger ride context when reopening an accepted active ride", () => {
    const selectedDestination = {
      name: "BarraShopping",
      coordinate: { latitude: -22.997658, longitude: -43.358127 },
    };
    const restored = sanitizePersistedRuntimeSessionForProfile(
      {
        activeRole: "customer",
        bookingStatus: "accepted",
        activeBookingId: "booking_active_1",
        selectedDestination,
        selectedFare: 81.03,
        tripDistanceKm: 24.2,
        tripDurationMin: 38,
        driverInfo: { name: "Motorista ativo" },
      },
      passengerProfile,
    );

    expect(restored.bookingStatus).toBe("accepted");
    expect(restored.activeBookingId).toBe("booking_active_1");
    expect(restored.selectedDestination).toBe(selectedDestination);
    expect(restored.selectedFare).toBe(81.03);
    expect(restored.tripDistanceKm).toBe(24.2);
    expect(restored.tripDurationMin).toBe(38);
    expect(restored.driverInfo).toEqual({ name: "Motorista ativo" });
  });

  it("drops passenger quote artifacts after a completed ride while preserving the receipt", () => {
    const lastReceipt = {
      id: "booking_completed_1",
      bookingId: "booking_completed_1",
      fare: 100,
      grossAmount: 100,
      value: "R$ 100,00",
      pickupAddress: "R. das Pastorinhas, 4",
      destinationAddress: "Copacabana Palace",
      authoritativeSnapshot: true,
      financialSnapshotSource: "backend_final",
    };
    const restored = sanitizePersistedRuntimeSessionForProfile(
      {
        activeRole: "customer",
        bookingStatus: "completed",
        activeBookingId: null,
        activeBooking: null,
        lastRideBookingId: "booking_completed_1",
        lastReceipt,
        tripHistory: [lastReceipt],
        selectedDestination: {
          name: "Copacabana Palace",
          coordinate: { latitude: -22.96722, longitude: -43.17874 },
        },
        quoteLock: {
          quoteLockId: "ql_completed_should_not_survive",
          expiresAt: new Date(Date.now() + 120000).toISOString(),
        },
        selectedFare: 100.26,
        selectedVehicle: "Leaf Plus",
        tripDistanceKm: 52,
        tripDurationMin: 66,
        tripArrivalText: "13:48",
        paymentState: {
          status: "settled",
          paymentId: "pix_1",
          amount: 100,
          method: "pix",
          error: "",
          refundStatus: null,
          refundAmount: 0,
          cancellationFee: 0,
          refundId: null,
          chargeId: "charge_1",
        },
      },
      passengerProfile,
    );

    expect(restored.bookingStatus).toBe("completed");
    expect(restored.lastReceipt).toBe(lastReceipt);
    expect(restored.tripHistory).toEqual([lastReceipt]);
    expect(restored.selectedDestination).toBeNull();
    expect(restored.quoteLock).toBeNull();
    expect(restored.selectedFare).toBeNull();
    expect(restored.selectedVehicle).toBe("");
    expect(restored.tripDistanceKm).toBeNull();
    expect(restored.tripDurationMin).toBeNull();
    expect(restored.tripArrivalText).toBe("");
    expect(restored.paymentState).toEqual({
      status: "idle",
      paymentId: null,
      amount: 0,
      method: "pix",
      error: "",
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: null,
    });
    expect(restored.terminalRideGuards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookingId: "booking_completed_1",
          status: "completed",
        }),
      ]),
    );
  });

  it("builds the terminal cleanup patch without receipt-owned data", () => {
    const patch = buildCompletedRideEphemeralResetPatch();
    expect(patch).toEqual(
      expect.objectContaining({
        selectedDestination: null,
        quoteLock: null,
        selectedFare: null,
        selectedVehicle: "",
        tripDistanceKm: null,
        tripDurationMin: null,
        searchingElapsedSeconds: 0,
      }),
    );
    expect(patch).not.toHaveProperty("paymentState");
    expect(
      buildCompletedRideEphemeralResetPatch({ resetPaymentState: true }).paymentState,
    ).toEqual({
      status: "idle",
      paymentId: null,
      amount: 0,
      method: "pix",
      error: "",
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: null,
    });
  });

  it("does not restore a stale driver online pending state without an active ride", () => {
    const restored = sanitizePersistedRuntimeSessionForProfile(
      {
        activeRole: "driver",
        bookingStatus: "idle",
        activeBookingId: null,
        driverActiveRide: null,
        driverOnline: false,
        driverOnlinePending: true,
        driverOnlineStartedAt: null,
        driverOnlineMutationSource: "bootstrap_restore_online_intent",
      },
      driverProfile,
    );

    expect(restored.driverOnline).toBe(false);
    expect(restored.driverOnlinePending).toBe(false);
    expect(restored.driverOnlineStartedAt).toBeNull();
    expect(restored.driverOnlineMutationSource).toBe(
      "bootstrap_clear_stale_online_intent",
    );
  });

  it("drops persisted driver offers because pending offers are not active rides", () => {
    const restored = sanitizePersistedRuntimeSessionForProfile(
      {
        activeRole: "driver",
        bookingStatus: "searching",
        activeBookingId: "booking_stale_offer",
        activeBooking: { bookingId: "booking_stale_offer" },
        driverActiveRide: null,
        driverOnline: true,
        driverOnlinePending: false,
        driverOnlineStartedAt: "2026-06-27T09:00:00.000Z",
        driverOnlineMutationSource: "offer_received_online_confirmed",
        driverOffers: [{ bookingId: "booking_stale_offer" }],
        currentCoordinate: { latitude: -22.857, longitude: -43.309 },
        driverCoordinate: { latitude: -22.857, longitude: -43.309 },
        currentAddress: "Av. Meriti, 9 - Vila Kosmos",
      },
      driverProfile,
    );

    expect(restored.bookingStatus).toBe("idle");
    expect(restored.activeBookingId).toBeNull();
    expect(restored.activeBooking).toBeNull();
    expect(restored.driverOffers).toEqual([]);
    expect(restored.driverOnline).toBe(false);
    expect(restored.driverOnlinePending).toBe(false);
    expect(restored.driverOnlineStartedAt).toBeNull();
    expect(restored.driverCoordinate).toBeNull();
  });
});

describe("runtime idempotency guards", () => {
  it("drops state patches that only recreate equal nested values", () => {
    const currentState = {
      profileUid: "driver_1",
      riderProfile: {
        name: "Motorista QA",
        email: "driver@example.com",
        phone: "+5521999999999",
      },
      driverOnlineDaily: {
        dayKey: "2026-06-27",
        totalMs: 120000,
        effectiveMs: 120000,
        limitReached: false,
      },
    };

    expect(
      resolveRuntimeStatePatchChanges(
        {
          profileUid: "driver_1",
          riderProfile: {
            phone: "+5521999999999",
            email: "driver@example.com",
            name: "Motorista QA",
          },
          driverOnlineDaily: {
            effectiveMs: 120000,
            totalMs: 120000,
            dayKey: "2026-06-27",
            limitReached: false,
          },
        },
        currentState,
      ),
    ).toBeNull();

    expect(
      resolveRuntimeStatePatchChanges(
        {
          profileUid: "driver_1",
          riderProfile: {
            name: "Motorista QA",
            email: "driver@example.com",
            phone: "+5521988888888",
          },
        },
        currentState,
      ),
    ).toEqual({
      riderProfile: {
        name: "Motorista QA",
        email: "driver@example.com",
        phone: "+5521988888888",
      },
    });
  });

  it("does not redispatch a materialized QA profile that is already in auth state", () => {
    const restoredProfile = {
      uid: "driver_1",
      usertype: "driver",
      role: "driver",
      profile: {
        canGoOnline: true,
        name: "Motorista QA",
      },
    };

    expect(
      shouldDispatchRuntimeProfileRestore(restoredProfile, restoredProfile),
    ).toBe(false);

    expect(
      shouldDispatchRuntimeProfileRestore(
        {
          uid: "driver_1",
          usertype: "customer",
          role: "customer",
        },
        restoredProfile,
      ),
    ).toBe(true);

    expect(
      shouldDispatchRuntimeProfileRestore(
        null,
        restoredProfile,
        buildRuntimeProfileDispatchKey(restoredProfile),
      ),
    ).toBe(false);
  });
});

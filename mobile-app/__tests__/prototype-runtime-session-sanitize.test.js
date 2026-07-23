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

const mockFirebaseSignInWithCustomToken = jest.fn();
const mockFirebaseAuthInstance = {
  currentUser: null,
  signInWithCustomToken: mockFirebaseSignInWithCustomToken,
};

jest.mock("@react-native-firebase/auth", () => () => mockFirebaseAuthInstance);

import {
  PROTOTYPE_FIREBASE_IDENTITY_MISMATCH_CODE,
  buildPrototypeChatMessageEnvelope,
  buildRuntimeProfileDispatchKey,
  buildCompletedRideEphemeralResetPatch,
  canUseDivergentQaRuntimeProfile,
  canContinuePrototypeSocketAuthentication,
  ensureFirebaseSessionForPrototype,
  isPrototypeRuntimeProfileIdentityAllowed,
  resolveAcceptedPickupDistanceKm,
  resolveRuntimeStatePatchChanges,
  resolvePrototypeChatCatchUpScope,
  sanitizePersistedRuntimeSessionForProfile,
  shouldAttemptCompletedReceiptRecovery,
  shouldDispatchRuntimeProfileRestore,
  shouldPreserveQADriverOfferOnBootstrap,
} from "../src/screens/prototype/prototypeRideRuntime";

describe("prototype Firebase identity guard", () => {
  beforeEach(() => {
    mockFirebaseSignInWithCustomToken.mockClear();
    mockFirebaseAuthInstance.currentUser = null;
  });

  it("fails closed without custom-token login when Firebase belongs to another profile", async () => {
    mockFirebaseAuthInstance.currentUser = {
      uid: "firebase-user-a",
      phoneNumber: "+5521998991886",
    };

    await expect(
      ensureFirebaseSessionForPrototype({
        uid: "qa-driver-b",
        phoneNumber: "+5521123456789",
      }),
    ).rejects.toMatchObject({
      code: PROTOTYPE_FIREBASE_IDENTITY_MISMATCH_CODE,
    });

    expect(mockFirebaseSignInWithCustomToken).not.toHaveBeenCalled();
  });

  it("accepts an already matching Firebase identity without custom-token login", async () => {
    mockFirebaseAuthInstance.currentUser = {
      uid: "firebase-user-a",
      phoneNumber: "+5521998991886",
    };

    await expect(
      ensureFirebaseSessionForPrototype({ uid: "firebase-user-a" }),
    ).resolves.toBe(true);

    expect(mockFirebaseSignInWithCustomToken).not.toHaveBeenCalled();
  });

  it("does not let the socket caller continue after a failed Firebase session gate", () => {
    expect(
      canContinuePrototypeSocketAuthentication({
        firebaseSessionReady: false,
        qaSocketTokenAvailable: false,
      }),
    ).toBe(false);

    expect(
      canContinuePrototypeSocketAuthentication({
        firebaseSessionReady: true,
        qaSocketTokenAvailable: false,
      }),
    ).toBe(true);

    expect(
      canContinuePrototypeSocketAuthentication({
        firebaseSessionReady: false,
        qaSocketTokenAvailable: true,
      }),
    ).toBe(true);
  });

  it("does not let a physical runtime cache override another Firebase UID", () => {
    expect(
      isPrototypeRuntimeProfileIdentityAllowed({
        profileUid: "cached-user-a",
        firebaseUid: "firebase-user-b",
        divergentQaProfileAllowed: false,
      }),
    ).toBe(false);
    expect(
      isPrototypeRuntimeProfileIdentityAllowed({
        profileUid: "firebase-user-b",
        firebaseUid: "firebase-user-b",
        divergentQaProfileAllowed: false,
      }),
    ).toBe(true);
  });

  it("keeps divergent profile seeding restricted to explicit simulator E2E runs", () => {
    expect(
      canUseDivergentQaRuntimeProfile({
        testUserToolsAllowed: true,
        simulatorBuild: true,
        e2eBuild: true,
      }),
    ).toBe(true);
    expect(
      canUseDivergentQaRuntimeProfile({
        testUserToolsAllowed: true,
        simulatorBuild: false,
        e2eBuild: true,
      }),
    ).toBe(false);
  });
});

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

  it("builds role-aware bilateral chat envelopes", () => {
    const passengerEnvelope = buildPrototypeChatMessageEnvelope({
      profile: passengerProfile,
      state: {
        profileUid: "passenger_1",
        activeRole: "customer",
        driverInfo: { id: "driver_1" },
      },
      bookingId: "booking_chat_1",
      chatId: "booking_chat_1",
      clientMessageId: "passenger_local_1",
      message: " Estou no embarque ",
      timestamp: "2026-07-13T12:00:00.000Z",
    });
    expect(passengerEnvelope).toEqual(
      expect.objectContaining({
        senderId: "passenger_1",
        receiverId: "driver_1",
        senderType: "passenger",
        message: "Estou no embarque",
      }),
    );

    const driverEnvelope = buildPrototypeChatMessageEnvelope({
      profile: driverProfile,
      state: {
        profileUid: "driver_1",
        activeRole: "driver",
        driverActiveRide: {
          bookingId: "booking_chat_1",
          passengerId: "passenger_1",
        },
      },
      bookingId: "booking_chat_1",
      chatId: "booking_chat_1",
      clientMessageId: "driver_local_1",
      message: "Cheguei",
    });
    expect(driverEnvelope).toEqual(
      expect.objectContaining({
        senderId: "driver_1",
        receiverId: "passenger_1",
        senderType: "driver",
      }),
    );
  });

  it("restores only non-terminal active chat sessions after reconnect", () => {
    expect(
      resolvePrototypeChatCatchUpScope({
        activeChatId: "booking_chat_1",
        activeChatBookingId: "booking_chat_1",
        bookingStatus: "started",
      }),
    ).toEqual(
      expect.objectContaining({
        bookingId: "booking_chat_1",
        chatId: "booking_chat_1",
        forceReload: true,
        source: "chat-reconnect",
      }),
    );
    expect(
      resolvePrototypeChatCatchUpScope({
        activeChatId: "booking_chat_1",
        activeChatBookingId: "booking_chat_1",
        bookingStatus: "early_ended_by_rider",
      }),
    ).toBeNull();
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

  it("preserves a seeded driver offer only when the sanitizer receives explicit QA context", () => {
    const seededOfferSession = {
      activeRole: "driver",
      bookingStatus: "searching",
      activeBookingId: "booking_qa_offer",
      activeBooking: { bookingId: "booking_qa_offer" },
      driverActiveRide: null,
      driverOnline: true,
      driverOnlinePending: false,
      driverOnlineStartedAt: "2026-07-12T15:00:00.000Z",
      driverOnlineMutationSource: "qa_seed",
      driverOffers: [{ bookingId: "booking_qa_offer" }],
      currentCoordinate: { latitude: -22.9708, longitude: -43.1819 },
      driverCoordinate: { latitude: -22.9708, longitude: -43.1819 },
      currentAddress: "Copacabana Palace, Rio de Janeiro, RJ",
    };

    const restored = sanitizePersistedRuntimeSessionForProfile(
      seededOfferSession,
      driverProfile,
      { preserveQaSeededDriverOffer: true },
    );

    expect(restored.bookingStatus).toBe("searching");
    expect(restored.activeBookingId).toBe("booking_qa_offer");
    expect(restored.activeBooking).toEqual({ bookingId: "booking_qa_offer" });
    expect(restored.driverOffers).toEqual([{ bookingId: "booking_qa_offer" }]);
    expect(restored.driverActiveRide).toBeNull();
    expect(restored.driverOnline).toBe(true);
    expect(restored.driverOnlinePending).toBe(false);
    expect(restored.driverOnlineMutationSource).toBe(
      "bootstrap_restore_qa_seeded_driver_offer",
    );
    expect(restored.currentCoordinate).toEqual({
      latitude: -22.9708,
      longitude: -43.1819,
    });
    expect(restored.driverCoordinate).toEqual({
      latitude: -22.9708,
      longitude: -43.1819,
    });
  });

  it("authorizes QA driver-offer restoration only for a live current-home seed in a controlled runtime", () => {
    const now = 1_752_336_000_000;
    const qaSeedLock = {
      scenario: "driver-offer",
      route: "leafapp://robotaxi/home",
      seededAt: now - 1_000,
      freezeUntil: now + 60_000,
    };
    const controlledContext = {
      qaSeedLock,
      now,
      testUserToolsAllowed: true,
      e2eBuild: false,
      simulatorBuild: true,
    };

    expect(shouldPreserveQADriverOfferOnBootstrap(controlledContext)).toBe(true);
    expect(
      shouldPreserveQADriverOfferOnBootstrap({
        ...controlledContext,
        testUserToolsAllowed: false,
      }),
    ).toBe(false);
    expect(
      shouldPreserveQADriverOfferOnBootstrap({
        ...controlledContext,
        e2eBuild: false,
        simulatorBuild: false,
      }),
    ).toBe(false);
    expect(
      shouldPreserveQADriverOfferOnBootstrap({
        ...controlledContext,
        qaSeedLock: { ...qaSeedLock, scenario: "driver-accepted" },
      }),
    ).toBe(false);
    expect(
      shouldPreserveQADriverOfferOnBootstrap({
        ...controlledContext,
        qaSeedLock: {
          ...qaSeedLock,
          route: "leafapp://robotaxi/driver/offer",
        },
      }),
    ).toBe(false);
    expect(
      shouldPreserveQADriverOfferOnBootstrap({
        ...controlledContext,
        qaSeedLock: { ...qaSeedLock, freezeUntil: now },
      }),
    ).toBe(false);
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

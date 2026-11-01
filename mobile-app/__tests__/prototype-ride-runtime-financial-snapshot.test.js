jest.mock('react-redux', () => ({
  useSelector: jest.fn(),
}));

jest.mock('expo-device', () => ({
  isDevice: false,
}));

jest.mock('expo-location', () => ({}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: {
    OS: 'ios',
  },
}));

jest.mock('@react-native-firebase/auth', () => () => ({}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/services/WebSocketManager', () => ({
  getInstance: jest.fn(() => ({
    isConnected: jest.fn(() => false),
    getConnectionStatus: jest.fn(() => 'disconnected'),
  })),
}));

jest.mock('../src/services/InteractiveNotificationService', () => ({}));

jest.mock('../src/services/PrototypeDriverTripAssistantService', () => ({
  __esModule: true,
  default: {},
  calculateDistanceMeters: jest.fn(() => 0),
  PICKUP_TOLERANCE_METERS: 80,
}));

jest.mock('../src/services/runtime/locationRouteBridge', () => ({
  detectInputType: jest.fn(() => 'text'),
  fetchGeocodeAddress: jest.fn(),
  fetchCoordsfromPlace: jest.fn(),
  fetchPlacesAutocomplete: jest.fn(),
  getDirectionsApi: jest.fn(),
}));

jest.mock('../src/screens/prototype/robotaxiPrototypeData', () => ({
  PROTOTYPE_ORIGIN_COORDINATE: { latitude: 0, longitude: 0 },
  resolveOperationalVehicleType: jest.fn((value) => value || 'leaf_plus'),
}));

jest.mock('../src/screens/prototype/prototypeMapRoute', () => ({
  clearPrototypeMapRoute: jest.fn(),
  getPrototypeMapRoute: jest.fn(() => ({ coordinates: [] })),
  setPrototypeMapRoute: jest.fn(),
}));

jest.mock('../src/screens/prototype/bookingErrorPolicy', () => ({
  shouldIgnoreTransientBookingError: jest.fn(() => false),
}));

jest.mock('../src/screens/prototype/driverOnlineLocationSeed', () => ({
  resolveDriverOnlineLocationSeed: jest.fn(),
}));

jest.mock('../src/screens/prototype/runtimeCrashRecovery', () => ({
  shouldFlushRuntimeSessionImmediately: jest.fn(() => false),
  shouldFlushRuntimeSessionOnAppState: jest.fn(() => false),
  shouldMaintainRealtimeSessionForSnapshot: jest.fn(() => false),
  shouldSyncActiveRideForSnapshot: jest.fn(() => false),
  normalizeRuntimeLifecycleStatus: jest.fn((value) =>
    String(value || '').trim().toLowerCase(),
  ),
}));

jest.mock('../src/screens/prototype/addressLabelUtils', () => ({
  resolveMeaningfulAddress: jest.fn((...values) =>
    values.find((value) => typeof value === 'string' && value.trim().length > 0) || '',
  ),
}));

jest.mock('../src/config/runtimeAccessPolicy', () => ({
  allowCustomOtpFallback: jest.fn(() => false),
  allowForcedPaymentBypass: jest.fn(() => false),
}));

const {
  mergeCompletedReceiptForHistory,
  normalizeCompletedTripDriverNetAmount,
  resolveCompletedTripFinancialSnapshot,
  resolveRemoteCancelSummaryContext,
  resolveDriverPayoutAmount,
  isRemoteLivenessPassed,
  resolveSyncedBookingStatus,
  hasRuntimeActiveRideContext,
  shouldPreserveActiveRideOnIdleSync,
  resolveCompletedReceiptDurationMin,
  resolveCompletedReceiptRecoveryBookingId,
  hasBackendFinalRecoveredReceiptForBooking,
  buildRuntimeReceiptFromRecoveredReceipt,
  buildDriverRoutePlanWithCanonicalDestination,
  resolveCanonicalDestinationRouteSnapshot,
  resolveCanonicalBookingRouteForRequest,
  mergeCanonicalBookingRouteSnapshot,
  buildNoDriversFoundPaymentState,
  buildConfirmedBookingMaterializationRetryContext,
  normalizeDestinationItem,
  resolveDestinationCoordinate,
  resolveReceiptEarlyEnd,
  resolveReceiptRouteGeometry,
  resolveSyncedBookingStatusForRole,
  buildBookingDestinationLabel,
} = require('../src/screens/prototype/prototypeRideRuntime');
const { getPrototypeMapRoute } = require('../src/screens/prototype/prototypeMapRoute');
const {
  calculateDistanceMeters,
} = require('../src/services/PrototypeDriverTripAssistantService');
const {
  fetchCoordsfromPlace,
} = require('../src/services/runtime/locationRouteBridge');

describe('prototype ride runtime financial snapshot', () => {
  it('selects a cached destination with location coordinates without requesting place details', async () => {
    fetchCoordsfromPlace.mockClear();
    const cachedResult = normalizeDestinationItem({
      place_id: 'cached_shopping_leblon',
      description: 'Shopping Leblon, Rio de Janeiro',
      structured_formatting: {
        main_text: 'Shopping Leblon',
        secondary_text: 'Leblon, Rio de Janeiro',
      },
      location: {
        lat: -22.9826,
        lng: -43.2167,
      },
      locationSource: 'place_coordinates',
    });

    expect(cachedResult.coordinate).toEqual({
      latitude: -22.9826,
      longitude: -43.2167,
    });

    const selectedDestination = await resolveDestinationCoordinate(cachedResult);

    expect(selectedDestination).toBe(cachedResult);
    expect(fetchCoordsfromPlace).not.toHaveBeenCalled();
  });

  it('keeps an in-memory createBooking retry only for a complete confirmed Pix context', () => {
    const context = buildConfirmedBookingMaterializationRetryContext({
      destination: {
        name: 'Leblon',
        coordinate: { latitude: -22.984, longitude: -43.223 },
      },
      originCoordinate: { latitude: -22.971, longitude: -43.182 },
      fare: 19.38,
      paymentMethod: 'pix',
      paymentConfirmation: {
        chargeId: 'charge_confirmed_retry',
        rideId: 'temp_ride_confirmed_retry',
        amountInCents: 1938,
        quoteLockId: 'quote_lock_confirmed_retry',
        paymentSessionId: 'payment_session_confirmed_retry',
        paymentContextKey: 'payment_context_confirmed_retry',
      },
    });

    expect(context).toEqual(expect.objectContaining({
      bookingPayload: expect.objectContaining({
        fare: 19.38,
        paymentMethod: 'pix',
      }),
      paymentSession: {
        chargeId: 'charge_confirmed_retry',
        paymentSessionId: 'payment_session_confirmed_retry',
        contextKey: 'payment_context_confirmed_retry',
      },
    }));
  });

  it.each([
    ['missing charge', { chargeId: '' }],
    ['missing payment reference', { rideId: '', paymentIntentId: '' }],
    ['missing quote lock', { quoteLockId: '' }],
    ['amount mismatch', { amountInCents: 1900 }],
  ])('fails closed for %s in a confirmed Pix booking retry', (_label, override) => {
    expect(buildConfirmedBookingMaterializationRetryContext({
      destination: {
        name: 'Leblon',
        coordinate: { latitude: -22.984, longitude: -43.223 },
      },
      originCoordinate: { latitude: -22.971, longitude: -43.182 },
      fare: 19.38,
      paymentMethod: 'pix',
      paymentConfirmation: {
        chargeId: 'charge_confirmed_retry',
        rideId: 'temp_ride_confirmed_retry',
        amountInCents: 1938,
        quoteLockId: 'quote_lock_confirmed_retry',
        ...override,
      },
    })).toBeNull();
  });

  it('maps the organic noDriversFound refund payload into the current runtime payment state', () => {
    expect(buildNoDriversFoundPaymentState({
      bookingId: 'booking_no_drivers_refund',
      refundStatus: 'REFUNDED',
      refundId: 'refund_no_drivers_1',
      refundAmountInCents: 1915,
      refundAmountInReais: '19.15',
    }, 'pix')).toEqual(expect.objectContaining({
      method: 'pix',
      errorCode: 'NO_DRIVERS_FOUND',
      refundStatus: 'REFUNDED',
      refundAmount: 19.15,
      refundId: 'refund_no_drivers_1',
    }));
  });

  it('only treats explicit backend liveness evidence as an approved facial validation', () => {
    expect(isRemoteLivenessPassed({
      state: 'APPROVED_NEEDS_LIVENESS',
      requiresLiveness: true,
      liveness: { passed: false },
    })).toBe(false);

    expect(isRemoteLivenessPassed({
      state: 'ACTIVE',
      requiresLiveness: false,
      liveness: { passed: true },
    })).toBe(true);

    expect(isRemoteLivenessPassed({
      activationState: 'REJECTED',
      liveness: { passed: true },
    })).toBe(false);
  });

  it('keeps an accepted-driver recovery on the continuation surface until a new driver advances it', () => {
    expect(resolveSyncedBookingStatus({
      status: 'NOTIFIED',
      recoveryMode: 'accepted_driver_reassignment',
    })).toBe('searching_replacement');

    expect(resolveSyncedBookingStatus({
      status: 'ACCEPTED',
      recoveryMode: 'accepted_driver_reassignment',
    })).toBe('accepted');
  });

  it('treats operational protected statuses as active ride context', () => {
    expect(hasRuntimeActiveRideContext({
      bookingStatus: 'operational_interrupted',
      activeBookingId: 'booking_operational_hold',
    })).toBe(true);
    expect(hasRuntimeActiveRideContext({
      bookingStatus: 'searching_replacement',
      activeBooking: { id: 'booking_replacement_search' },
    })).toBe(true);
  });

  it('preserves active rides on idle sync unless terminal authority is explicit', () => {
    const source = {
      bookingStatus: 'operational_interrupted',
      activeBookingId: 'booking_operational_hold',
    };

    expect(shouldPreserveActiveRideOnIdleSync({
      source,
      payload: { status: 'idle', hasActiveRide: false },
      syncedBookingId: 'booking_operational_hold',
    })).toBe(true);
    expect(shouldPreserveActiveRideOnIdleSync({
      source,
      payload: { status: 'idle', hasActiveRide: false, terminal: true },
      syncedBookingId: 'booking_operational_hold',
    })).toBe(false);
    expect(shouldPreserveActiveRideOnIdleSync({
      source,
      payload: { status: 'idle' },
      syncedBookingId: 'booking_other',
    })).toBe(false);
  });

  it('lets the server drop a driver pickup it no longer assigns, after the accept grace', () => {
    const source = {
      activeRole: 'driver',
      bookingStatus: 'accepted',
      activeBookingId: 'booking_reassigned',
      driverActiveRide: { bookingId: 'booking_reassigned' },
    };
    const payload = { success: true, source: 'explicit_sync', hasActiveRide: false, bookingId: null };
    const acceptedAt = 1_000_000;

    expect(shouldPreserveActiveRideOnIdleSync({
      source, payload, nowMs: acceptedAt + 10_000, driverRideAssignedAtMs: acceptedAt,
    })).toBe(true);
    expect(shouldPreserveActiveRideOnIdleSync({
      source, payload, nowMs: acceptedAt + 60_000, driverRideAssignedAtMs: acceptedAt,
    })).toBe(false);
    expect(shouldPreserveActiveRideOnIdleSync({
      source: { ...source, bookingStatus: 'started' }, payload, nowMs: acceptedAt + 60_000, driverRideAssignedAtMs: acceptedAt,
    })).toBe(true);
  });

  it('lets the server end a passenger pickup it no longer has, after the accept grace', () => {
    const source = { activeRole: 'customer', bookingStatus: 'accepted', activeBookingId: 'booking_gone' };
    const payload = { success: true, source: 'explicit_sync', hasActiveRide: false, bookingId: null };
    expect(shouldPreserveActiveRideOnIdleSync({ source, payload, nowMs: 60_000, driverRideAssignedAtMs: 50_000 })).toBe(true);
    expect(shouldPreserveActiveRideOnIdleSync({ source, payload, nowMs: 200_000, driverRideAssignedAtMs: 50_000 })).toBe(false);
  });

  it('uses the real trip time on the final receipt and keeps the plan only as fallback', () => {
    expect(resolveCompletedReceiptDurationMin({
      actualDurationSecs: 483,
      plannedDurationMinutes: 31,
    })).toBe(8);
    expect(resolveCompletedReceiptDurationMin({
      settledDurationSecs: 600,
      actualDurationSecs: 483,
      plannedDurationMinutes: 31,
    })).toBe(10);
    expect(resolveCompletedReceiptDurationMin({
      settledDurationSecs: null,
      actualDurationSecs: null,
      plannedDurationMinutes: 31,
    })).toBe(31);
  });

  it('accepts explicit receipt recovery booking ids from route-only receipt screens', () => {
    expect(resolveCompletedReceiptRecoveryBookingId({
      explicitBookingId: 'booking_receipt_route',
    })).toBe('booking_receipt_route');
    expect(resolveCompletedReceiptRecoveryBookingId(
      { explicitBookingId: 'booking_receipt_route' },
      { lastReceipt: { id: 'booking_old_receipt' } },
    )).toBe('booking_receipt_route');
    expect(resolveCompletedReceiptRecoveryBookingId(
      { bookingId: 'booking_direct', explicitBookingId: 'booking_receipt_route' },
      {},
    )).toBe('booking_direct');
  });

  it('only skips completed receipt recovery for backend-final receipts', () => {
    expect(hasBackendFinalRecoveredReceiptForBooking({
      id: 'booking_recovery',
      fare: 83.4,
      authoritativeSnapshot: false,
      financialSnapshotSource: 'local_fallback',
    }, 'booking_recovery')).toBe(false);

    expect(hasBackendFinalRecoveredReceiptForBooking({
      id: 'booking_recovery',
      fare: 83.4,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'stored_receipt_recovery',
    }, 'booking_recovery')).toBe(false);

    expect(hasBackendFinalRecoveredReceiptForBooking({
      bookingId: 'booking_recovery',
      receiptId: 'receipt_recovery',
      fare: 83.4,
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
    }, 'booking_recovery')).toBe(true);
  });

  it('prefers the locked driver payout over a later gross fare fallback', () => {
    const payout = resolveDriverPayoutAmount(
      { fare: 16.5 },
      { fare: 15.01 },
    );

    expect(payout).toBeCloseTo(15.01, 2);
  });

  it('keeps driver receipt net and fees derived from the locked trip snapshot', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      { fare: 16.5 },
      {
        selectedFare: 16.5,
        activeBooking: { estimatedFare: 16.5 },
        driverActiveRide: {
          fare: 16.5,
          estimatedDriverNetAmount: 15.01,
          estimatedTotalFees: 1.49,
          estimatedOperationalFee: 0.99,
          estimatedPaymentIntermediationFee: 0.5,
          pricingSnapshotLocked: true,
        },
        driverTripMeta: {
          fare: 15.01,
          fareLabel: 'R$ 15,01',
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(16.5, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(15.01, 2);
    expect(snapshot.totalFees).toBeCloseTo(1.49, 2);
    expect(snapshot.operationalFee).toBeCloseTo(0.99, 2);
    expect(snapshot.paymentIntermediationFee).toBeCloseTo(0.5, 2);
  });

  it('keeps the paid gross fare when completion receives a stale lower fare', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      { fare: 12.28 },
      {
        selectedFare: 12.28,
        paymentState: {
          status: 'confirmed',
          paymentId: 'pay_123',
          amount: 14.22,
        },
        driverActiveRide: {
          fare: 12.28,
          grossFare: 14.22,
          totalFees: 1.49,
          driverNetAmount: 12.28,
          pricingSnapshotLocked: true,
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(14.22, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(12.73, 2);
    expect(snapshot.totalFees).toBeCloseTo(1.49, 2);
  });

  it('uses the backend-final executed settlement after an operational interruption', () => {
    const interruptedRideLeg = {
      source: 'operational_interrupt',
      grossAmount: 0.84,
      operationalFee: 0.79,
      paymentIntermediationFee: 0.05,
      totalFees: 0.84,
      driverNetAmount: 0,
      metadata: {
        settlementType: 'INTERRUPTED_OPERATIONAL',
      },
    };
    const snapshot = resolveCompletedTripFinancialSnapshot(
      {
        bookingId: 'booking_operational_interruption_ended',
        completionType: 'INTERRUPTED_OPERATIONAL_ENDED',
        grossAmount: 0.84,
        operationalFee: 0.79,
        paymentIntermediationFee: 0.05,
        totalFees: 0.84,
        driverNetAmount: 0,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        settlement: {
          settlementType: 'INTERRUPTED_OPERATIONAL_ENDED',
          originalFare: 17.69,
          prepaidAmount: 17.69,
          executedFare: 0.84,
          estimatedRefund: 16.85,
          remainingReservedAmount: 16.85,
          rideLegSettlements: [interruptedRideLeg],
        },
        operationalContinuation: {
          status: 'PASSENGER_ENDED_RIDE',
          executedFare: 0.84,
          estimatedRefund: 16.85,
          remainingReservedAmount: 16.85,
          closedRideLeg: interruptedRideLeg,
        },
        rideLegs: [interruptedRideLeg],
      },
      {
        paymentState: {
          status: 'confirmed',
          paymentId: 'pix_original_charge',
          amount: 17.69,
        },
        activeBooking: {
          grossAmount: 17.69,
          estimatedFare: 17.69,
        },
        driverActiveRide: {
          grossAmount: 17.69,
          totalFees: 1.49,
          driverNetAmount: 16.2,
          pricingSnapshotLocked: true,
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(0.84, 2);
    expect(snapshot.operationalFee).toBeCloseTo(0.79, 2);
    expect(snapshot.paymentIntermediationFee).toBeCloseTo(0.05, 2);
    expect(snapshot.totalFees).toBeCloseTo(0.84, 2);
    expect(snapshot.driverNetAmount).toBe(0);
    expect(snapshot.estimatedRefund).toBeCloseTo(16.85, 2);
    expect(snapshot.remainingReservedAmount).toBeCloseTo(16.85, 2);
    expect(snapshot.originalPaidAmount).toBeCloseTo(17.69, 2);
    expect(snapshot.authoritativeSnapshot).toBe(true);
    expect(snapshot.financialSnapshotSource).toBe('backend_final');
  });

  it('shows the toll refund when the server saw the car avoid the booked plaza', () => {
    const previous = {
      paymentState: { status: 'confirmed', paymentId: 'pix_1', amount: 46.5 },
      activeBooking: { grossAmount: 46.5, estimatedFare: 46.5 },
      driverActiveRide: { grossAmount: 46.5, tollFee: 6.5, pricingSnapshotLocked: true },
    };
    const snapshot = resolveCompletedTripFinancialSnapshot(
      {
        bookingId: 'booking_toll_avoided',
        completionType: 'COMPLETED',
        grossAmount: 40,
        finalFare: 40,
        tollFee: 0,
        operationalFee: 1.49,
        paymentIntermediationFee: 0.5,
        totalFees: 1.99,
        driverNetAmount: 38.01,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
        tollAdjustment: {
          type: 'TOLL_NOT_CROSSED',
          bookedTollFee: 6.5,
          chargedTollFee: 0,
          refundedTollFee: 6.5,
          originalPaidAmount: 46.5,
          finalAmount: 40,
          estimatedRefund: 6.5,
        },
      },
      previous,
    );

    expect(snapshot.finalFare).toBeCloseTo(40, 2);
    expect(snapshot.tollFee).toBe(0);
    expect(snapshot.driverNetAmount).toBeCloseTo(38.01, 2);
    expect(snapshot.settlementType).toBe('TOLL_NOT_CROSSED');
    expect(snapshot.originalPaidAmount).toBeCloseTo(46.5, 2);
    expect(snapshot.estimatedRefund).toBeCloseTo(6.5, 2);

    // Without backend-final provenance the adjustment is ignored.
    const untrusted = resolveCompletedTripFinancialSnapshot(
      { grossAmount: 40, tollAdjustment: { type: 'TOLL_NOT_CROSSED', originalPaidAmount: 46.5, estimatedRefund: 6.5 } },
      previous,
    );
    expect(untrusted.settlementType).toBeUndefined();
    expect(untrusted.finalFare).toBeCloseTo(46.5, 2);
  });

  it('keeps backend-final zero toll instead of a stale locked estimate', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      {
        bookingId: 'booking_zero_toll',
        grossAmount: 34.66,
        tollFee: 0,
        operationalFee: 1.49,
        paymentIntermediationFee: 0.5,
        totalFees: 1.99,
        driverNetAmount: 32.67,
        authoritativeSnapshot: true,
        financialSnapshotSource: 'backend_final',
      },
      {
        selectedFare: 34.66,
        driverActiveRide: {
          grossAmount: 34.66,
          tollFee: 8.95,
          pricingSnapshotLocked: true,
        },
      },
    );

    expect(snapshot.tollFee).toBe(0);
    expect(snapshot.finalFare).toBeCloseTo(34.66, 2);
    expect(snapshot.totalFees).toBeCloseTo(1.99, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(32.67, 2);
    expect(snapshot.authoritativeSnapshot).toBe(true);
    expect(snapshot.financialSnapshotSource).toBe('backend_final');
  });

  it('falls back to the preserved driver payout when a local locked snapshot carries placeholder zeros', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      { fare: 78.73 },
      {
        selectedFare: 78.73,
        activeBooking: { estimatedFare: 78.73 },
        driverActiveRide: {
          fare: 78.73,
          grossFare: 78.73,
          driverNetAmount: 0,
          totalFees: 0,
          pricingSnapshotLocked: true,
        },
        driverTripMeta: {
          driverNetAmount: 75.74,
          fareLabel: 'R$ 75,74',
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(78.73, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(75.74, 2);
    expect(snapshot.totalFees).toBeCloseTo(2.99, 2);
  });

  it('does not persist the gross fare as driver net when no net snapshot exists', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      { fare: 31.8 },
      {
        selectedFare: 31.8,
        activeBooking: { estimatedFare: 31.8 },
        driverActiveRide: {
          fare: 31.8,
          grossFare: 31.8,
          pricingSnapshotLocked: true,
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(31.8, 2);
    expect(snapshot.driverNetAmount).toBeUndefined();
    expect(snapshot.totalFees).toBeUndefined();
  });

  it('recalculates net from the fee breakdown when a driver receipt repeats gross as payout', () => {
    const normalizedNet = normalizeCompletedTripDriverNetAmount({
      finalFare: 14.22,
      driverNetAmount: 14.22,
      operationalFee: 0.99,
      paymentIntermediationFee: 0.5,
      totalFees: 1.49,
    });

    expect(normalizedNet).toBeCloseTo(12.73, 2);
  });

  it('keeps estimated fees when the locked ride also carries a stale gross payout', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      { fare: 14.22 },
      {
        selectedFare: 14.22,
        activeBooking: { estimatedFare: 14.22 },
        driverActiveRide: {
          fare: 14.22,
          grossFare: 14.22,
          driverNetAmount: 14.22,
          estimatedDriverNetAmount: 12.73,
          estimatedTotalFees: 1.49,
          estimatedOperationalFee: 0.99,
          estimatedPaymentIntermediationFee: 0.5,
          pricingSnapshotLocked: true,
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(14.22, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(12.73, 2);
    expect(snapshot.totalFees).toBeCloseTo(1.49, 2);
    expect(snapshot.operationalFee).toBeCloseTo(0.99, 2);
    expect(snapshot.paymentIntermediationFee).toBeCloseTo(0.5, 2);
  });

  it('does not promote a fee-bearing completion payload without backend-final provenance', () => {
    const snapshot = resolveCompletedTripFinancialSnapshot(
      {
        bookingId: 'booking_untrusted_completion',
        fare: 14.22,
        operationalFee: 0.99,
        paymentIntermediationFee: 0.5,
        totalFees: 1.49,
        driverNetAmount: 12.73,
        authoritativeSnapshot: false,
        financialSnapshotSource: 'socket_fallback',
      },
      { selectedFare: 14.22 },
    );

    expect(snapshot.finalFare).toBeCloseTo(14.22, 2);
    expect(snapshot.authoritativeSnapshot).toBe(false);
    expect(snapshot.financialSnapshotSource).toBe('local_fallback');
  });

  it('normalizes merged completed receipts with authoritative fees', () => {
    const mergedReceipt = mergeCompletedReceiptForHistory(
      {
        id: 'booking_123',
        finalFare: 14.22,
        driverNetAmount: 12.73,
      },
      {
        id: 'booking_123',
        fare: 14.22,
        finalFare: 14.22,
        driverNetAmount: 14.22,
        operationalFee: 0.99,
        paymentIntermediationFee: 0.5,
        totalFees: 1.49,
        financialSnapshotSource: 'backend_final',
        authoritativeSnapshot: true,
      },
    );

    expect(mergedReceipt.finalFare).toBeCloseTo(14.22, 2);
    expect(mergedReceipt.driverNetAmount).toBeCloseTo(12.73, 2);
    expect(mergedReceipt.totalFees).toBeCloseTo(1.49, 2);
  });

  it('replaces an idle-sync fallback receipt with backend-final financials', () => {
    const mergedReceipt = mergeCompletedReceiptForHistory(
      {
        id: 'booking_terminal_race',
        fare: 81.17,
        finalFare: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.89,
        totalFees: 3.33,
        driverNetAmount: 77.84,
        financialSnapshotSource: 'local_fallback',
        authoritativeSnapshot: false,
      },
      {
        id: 'booking_terminal_race',
        fare: 81.17,
        finalFare: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
        financialSnapshotSource: 'backend_final',
        authoritativeSnapshot: true,
      },
    );

    expect(mergedReceipt.operationalFee).toBeCloseTo(2.44, 2);
    expect(mergedReceipt.paymentIntermediationFee).toBeCloseTo(0.65, 2);
    expect(mergedReceipt.totalFees).toBeCloseTo(3.09, 2);
    expect(mergedReceipt.driverNetAmount).toBeCloseTo(78.08, 2);
  });

  it('does not let a later recovery receipt overwrite backend-final financials', () => {
    const mergedReceipt = mergeCompletedReceiptForHistory(
      {
        id: 'booking_terminal_race',
        fare: 81.17,
        finalFare: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
        financialSnapshotSource: 'backend_final',
        authoritativeSnapshot: true,
      },
      {
        id: 'booking_terminal_race',
        fare: 81.17,
        finalFare: 81.17,
        operationalFee: 2.44,
        paymentIntermediationFee: 0.89,
        totalFees: 3.33,
        driverNetAmount: 77.84,
        financialSnapshotSource: 'stored_receipt_recovery',
        authoritativeSnapshot: true,
      },
    );

    expect(mergedReceipt.paymentIntermediationFee).toBeCloseTo(0.65, 2);
    expect(mergedReceipt.totalFees).toBeCloseTo(3.09, 2);
    expect(mergedReceipt.driverNetAmount).toBeCloseTo(78.08, 2);
    expect(mergedReceipt.financialSnapshotSource).toBe('backend_final');
    expect(mergedReceipt.authoritativeSnapshot).toBe(true);
  });

  it('preserves vehicle identity when rebuilding a runtime receipt from the API receipt', () => {
    const runtimeReceipt = buildRuntimeReceiptFromRecoveredReceipt(
      {
        receiptId: 'LEAF-booking_vehicle_recovery',
        metadata: {
          authoritativeSnapshot: true,
          financialSnapshotSource: 'backend_final',
          status: 'COMPLETED',
        },
        driver: {
          id: 'driver_1',
          name: 'Motorista Leaf',
          vehicle: {
            brand: 'Toyota',
            brandModel: 'Toyota Prius',
            model: 'Prius',
            plate: 'TES6789',
            color: 'PRETO',
          },
        },
        customer: {
          id: 'customer_1',
          name: 'Passageira Leaf',
        },
        trip: {
          pickup: { address: 'Av. Meriti, 9' },
          dropoff: { address: 'Av. das Americas, 4666' },
          distance: { actual: 27.1 },
          duration: 34,
        },
        financial: {
          totalPaid: { amount: 58.19 },
          breakdown: {
            tripFare: { amount: 58.19 },
            operationalCost: { amount: 1.63 },
            wooviFee: { amount: 0.5 },
            driverAmount: { amount: 56.06 },
          },
        },
        payment: { status: 'paid' },
      },
      {
        activeBookingId: 'booking_vehicle_recovery',
        activeBooking: null,
        driverActiveRide: null,
        driverInfo: {},
        tripHistory: [],
      },
      'booking_vehicle_recovery',
    );

    expect(runtimeReceipt.id).toBe('booking_vehicle_recovery');
    expect(runtimeReceipt.vehicleLabel).toBe('Toyota Prius');
    expect(runtimeReceipt.vehiclePlate).toBe('TES6789');
    expect(runtimeReceipt.vehicleColor).toBe('PRETO');
    expect(runtimeReceipt.fare).toBeCloseTo(58.19, 2);
    expect(runtimeReceipt.driverNetAmount).toBeCloseTo(56.06, 2);
    expect(runtimeReceipt.financialSnapshotSource).toBe('backend_final');
    expect(runtimeReceipt.authoritativeSnapshot).toBe(true);
  });

  it('promotes the canonical quote route into the active destination route plan', () => {
    const driverCoordinate = { latitude: -22.84, longitude: -43.32 };
    const pickupCoordinate = { latitude: -22.853, longitude: -43.352 };
    const destinationCoordinate = { latitude: -23.000, longitude: -43.365 };
    const fallbackDestination = [
      pickupCoordinate,
      { latitude: -22.91, longitude: -43.355 },
      destinationCoordinate,
    ];
    const canonicalDestination = [
      pickupCoordinate,
      { latitude: -22.86, longitude: -43.34 },
      { latitude: -22.9, longitude: -43.33 },
      { latitude: -22.94, longitude: -43.34 },
      { latitude: -22.97, longitude: -43.35 },
      destinationCoordinate,
    ];
    const canonicalTrafficSegments = [
      {
        level: 'heavy',
        color: '#DC2626',
        coordinates: [canonicalDestination[1], canonicalDestination[2]],
      },
    ];
    const canonicalSnapshot = resolveCanonicalDestinationRouteSnapshot({
      routeCoordinates: canonicalDestination,
      trafficSegments: canonicalTrafficSegments,
      routeDistanceKm: 27.1,
      routeDurationSecs: 2040,
    });

    const routePlan = buildDriverRoutePlanWithCanonicalDestination({
      routePlan: {
        pickupCoordinates: [driverCoordinate, pickupCoordinate],
        destinationCoordinates: fallbackDestination,
        combinedCoordinates: [driverCoordinate, pickupCoordinate, ...fallbackDestination.slice(1)],
        pickupDistanceKm: 4.8,
        pickupDurationMinutes: 7,
        destinationDistanceKm: 17,
        destinationDurationMinutes: 38,
      },
      canonicalDestinationRoute: canonicalSnapshot,
      originCoordinate: driverCoordinate,
      pickupCoordinate,
      destinationCoordinate,
    });

    expect(routePlan.destinationCoordinates).toHaveLength(canonicalDestination.length);
    expect(routePlan.destinationCoordinates).toEqual(canonicalDestination);
    expect(routePlan.destinationTrafficSegments).toEqual(canonicalTrafficSegments);
    expect(routePlan.destinationDistanceKm).toBeCloseTo(27.1, 1);
    expect(routePlan.destinationDurationMinutes).toBe(34);
    expect(routePlan.pickupCoordinates).toEqual([driverCoordinate, pickupCoordinate]);
  });

  it('keeps the sealed booking route when createBooking returns a compact acknowledgement', () => {
    const pickupCoordinate = { latitude: -22.97045, longitude: -43.18276 };
    const destinationCoordinate = { latitude: -22.9842698, longitude: -43.223168 };
    const sealedRoute = [
      pickupCoordinate,
      { latitude: -22.9721, longitude: -43.1884 },
      { latitude: -22.9753, longitude: -43.1978 },
      { latitude: -22.9788, longitude: -43.2074 },
      { latitude: -22.9822, longitude: -43.2165 },
      destinationCoordinate,
    ];

    const materializedBooking = mergeCanonicalBookingRouteSnapshot(
      {
        bookingId: 'booking_compact_ack',
        status: 'SEARCHING',
      },
      {
        bookingId: 'booking_compact_ack',
        status: 'SEARCHING',
      },
      {
        routeCoordinates: sealedRoute,
        routeDistanceKm: 5.2,
        routeDurationSecs: 780,
      },
    );

    expect(materializedBooking.routeCoordinates).toEqual(sealedRoute);
    expect(materializedBooking.routeDistanceKm).toBe(5.2);
    expect(materializedBooking.routeDurationSecs).toBe(780);
    expect(materializedBooking.tripDurationMin).toBe(13);
  });

  it('does not replace an already rich active route with a poorer fallback snapshot', () => {
    const pickupCoordinate = { latitude: -22.853, longitude: -43.352 };
    const destinationCoordinate = { latitude: -23.000, longitude: -43.365 };
    const richDestination = [
      pickupCoordinate,
      { latitude: -22.87, longitude: -43.34 },
      { latitude: -22.91, longitude: -43.33 },
      { latitude: -22.95, longitude: -43.35 },
      destinationCoordinate,
    ];
    const routePlan = buildDriverRoutePlanWithCanonicalDestination({
      routePlan: {
        pickupCoordinates: [
          { latitude: -22.84, longitude: -43.32 },
          pickupCoordinate,
        ],
        destinationCoordinates: richDestination,
        combinedCoordinates: richDestination,
        pickupDistanceKm: 4.8,
        pickupDurationMinutes: 7,
        destinationDistanceKm: 27.1,
        destinationDurationMinutes: 34,
      },
      canonicalDestinationRoute: {
        coordinates: [pickupCoordinate, destinationCoordinate],
        distanceKm: 17,
        durationMinutes: 38,
      },
      pickupCoordinate,
      destinationCoordinate,
    });

    expect(routePlan.destinationCoordinates).toEqual(richDestination);
    expect(routePlan.destinationDistanceKm).toBeCloseTo(27.1, 1);
    expect(routePlan.destinationDurationMinutes).toBe(34);
  });

  it('uses the quote-locked route when creating a booking without a rich payload route', () => {
    const originCoordinate = { latitude: -22.857, longitude: -43.309 };
    const destinationCoordinate = { latitude: -22.997, longitude: -43.358 };
    const quoteCoordinates = [
      originCoordinate,
      { latitude: -22.88, longitude: -43.32 },
      { latitude: -22.91, longitude: -43.34 },
      { latitude: -22.95, longitude: -43.35 },
      destinationCoordinate,
    ];
    const quoteLock = {
      routeKey: '-22.857:-43.309:-22.997:-43.358',
      distanceKm: 27.1,
      durationMinutes: 40,
      etaText: '13:17',
      createdAt: Date.now(),
      expiresAt: Date.now() + 120000,
      coordinates: quoteCoordinates,
    };

    const bookingRoute = resolveCanonicalBookingRouteForRequest({
      payload: {
        routeDistanceKm: 17.1,
        routeDurationSecs: 2280,
        routeCoordinates: [originCoordinate, destinationCoordinate],
      },
      quoteLock,
      originCoordinate,
      destinationCoordinate,
    });

    expect(bookingRoute.source).toBe('quoteLock');
    expect(bookingRoute.routeCoordinates).toEqual(quoteCoordinates);
    expect(bookingRoute.routeDistanceKm).toBeCloseTo(27.1, 1);
    expect(bookingRoute.routeDurationMinutes).toBe(40);
    expect(bookingRoute.routeDurationSecs).toBe(2400);
  });

  it('samples long quote-locked routes across the full path instead of truncating near the pickup', () => {
    const originCoordinate = { latitude: -22.857, longitude: -43.309 };
    const destinationCoordinate = { latitude: -22.997, longitude: -43.358 };
    const quoteCoordinates = Array.from({ length: 1000 }, (_, index) => {
      const progress = index / 999;
      return {
        latitude:
          originCoordinate.latitude +
          (destinationCoordinate.latitude - originCoordinate.latitude) * progress,
        longitude:
          originCoordinate.longitude +
          (destinationCoordinate.longitude - originCoordinate.longitude) * progress,
      };
    });
    const quoteLock = {
      routeKey: '-22.857:-43.309:-22.997:-43.358',
      distanceKm: 27.1,
      durationMinutes: 43,
      etaText: '13:45',
      createdAt: Date.now(),
      expiresAt: Date.now() + 120000,
      coordinates: quoteCoordinates,
    };

    const bookingRoute = resolveCanonicalBookingRouteForRequest({
      payload: {
        routeDistanceKm: 16.4,
        routeDurationSecs: 2280,
        routeCoordinates: [originCoordinate, destinationCoordinate],
      },
      quoteLock,
      originCoordinate,
      destinationCoordinate,
    });

    expect(bookingRoute.source).toBe('quoteLock');
    expect(bookingRoute.routeCoordinates).toHaveLength(180);
    expect(bookingRoute.routeCoordinates[0]).toEqual(originCoordinate);
    expect(bookingRoute.routeCoordinates[179]).toEqual(destinationCoordinate);
    expect(bookingRoute.routeCoordinates[90].latitude).toBeLessThan(-22.92);
    expect(bookingRoute.routeCoordinates[170].latitude).toBeLessThan(-22.98);
    expect(bookingRoute.routeDistanceKm).toBeCloseTo(27.1, 1);
    expect(bookingRoute.routeDurationMinutes).toBe(43);
  });
});

describe('prototype ride runtime receipt and recovery helpers', () => {
  const pickup = { latitude: -22.9208, longitude: -43.4061 };
  const midway = { latitude: -22.95, longitude: -43.39 };
  const destination = { latitude: -22.9827, longitude: -43.3642 };

  beforeEach(() => {
    getPrototypeMapRoute.mockReturnValue({ coordinates: [] });
    // The distance helper is mocked in this file; each test states the distance.
    calculateDistanceMeters.mockReturnValue(0);
  });

  it('flags a trip that ended far from its destination', () => {
    calculateDistanceMeters.mockReturnValue(8200);
    const earlyEnd = resolveReceiptEarlyEnd(
      { endLocation: { lat: pickup.latitude, lng: pickup.longitude } },
      {},
      destination,
    );

    expect(earlyEnd).toEqual({ remainingMeters: 8200 });
  });

  it('does not flag a trip that ended at the destination', () => {
    calculateDistanceMeters.mockReturnValue(120);
    expect(
      resolveReceiptEarlyEnd(
        { endLocation: { lat: destination.latitude + 0.0005, lng: destination.longitude } },
        {},
        destination,
      ),
    ).toBeNull();
  });

  it('measures from the last known car position when the server sends no end location', () => {
    calculateDistanceMeters.mockReturnValue(8200);
    const earlyEnd = resolveReceiptEarlyEnd({}, { driverCoordinate: pickup }, destination);

    expect(earlyEnd).toEqual({ remainingMeters: 8200 });
    expect(calculateDistanceMeters).toHaveBeenCalledWith(pickup, destination);
  });

  it('keeps the server early-end details when present', () => {
    expect(
      resolveReceiptEarlyEnd(
        { earlyEnd: { reason: 'passenger_request', remainingMeters: 1200 } },
        { driverCoordinate: destination },
        destination,
      ),
    ).toEqual({ reason: 'passenger_request', remainingMeters: 1200 });
  });

  it('cannot tell without a destination', () => {
    expect(resolveReceiptEarlyEnd({}, { driverCoordinate: pickup }, null)).toBeNull();
  });

  it('prefers a route with real geometry over a two-point straight line', () => {
    const route = resolveReceiptRouteGeometry(
      { quoteLock: { coordinates: [pickup, midway, destination] } },
      [[pickup, destination]],
    );

    expect(route).toHaveLength(3);
  });

  it('uses the route on the map when the server sends none', () => {
    getPrototypeMapRoute.mockReturnValue({ coordinates: [pickup, midway, destination] });

    expect(resolveReceiptRouteGeometry({}, [undefined])).toHaveLength(3);
  });

  it('falls back to the endpoints only when no source has geometry', () => {
    expect(resolveReceiptRouteGeometry({}, [[pickup, destination]])).toHaveLength(2);
    expect(resolveReceiptRouteGeometry({}, [])).toEqual([]);
  });

  it('sends a driver home when their accepted ride was reassigned after a disconnect', () => {
    const snapshot = { status: 'SEARCHING', recoveryMode: 'accepted_driver_reassignment' };

    expect(resolveSyncedBookingStatusForRole(snapshot, 'driver')).toBe('idle');
    expect(resolveSyncedBookingStatusForRole(snapshot, 'customer')).toBe('searching_replacement');
  });

  it('keeps the operational replacement state for a driver when it is not a disconnect recovery', () => {
    expect(
      resolveSyncedBookingStatusForRole({ status: 'SEARCHING_REPLACEMENT_DRIVER' }, 'driver'),
    ).toBe('searching_replacement');
  });

  it('sends the place name with the booking destination', () => {
    expect(
      buildBookingDestinationLabel({
        name: 'Via Parque Shopping',
        address: 'Av. Ayrton Senna, 3000 - Barra da Tijuca',
      }),
    ).toBe('Via Parque Shopping - Av. Ayrton Senna, 3000 - Barra da Tijuca');
    expect(
      buildBookingDestinationLabel({ name: 'Rua A', address: 'Rua A, 10 - Centro' }),
    ).toBe('Rua A, 10 - Centro');
    expect(buildBookingDestinationLabel({ name: 'Casa' })).toBe('Casa');
    expect(buildBookingDestinationLabel({})).toBe('Destino');
  });

  describe('remote cancel summary context', () => {
    const noShowCancel = {
      success: true,
      bookingId: 'booking_1',
      initiatedBy: 'driver',
      data: {
        reason: 'Passageiro não compareceu ao embarque.',
        cancellationFee: 3,
        refundAmount: 37.49,
        refundStatus: 'REFUNDED_PARTIAL',
      },
    };

    it('carries the amount paid before the cancel event resets the payment state', () => {
      expect(
        resolveRemoteCancelSummaryContext(noShowCancel, {
          paymentState: { status: 'paid', amount: 40.49 },
        }),
      ).toEqual({
        originalPaidAmount: 40.49,
        cancelledBy: 'driver',
        cancellationReason: 'Passageiro não compareceu ao embarque.',
      });
    });

    it('prefers a paid amount sent by the server over the local one', () => {
      const context = resolveRemoteCancelSummaryContext(
        { ...noShowCancel, data: { ...noShowCancel.data, originalPaidAmount: 41 } },
        { paymentState: { amount: 40.49 } },
      );
      expect(context.originalPaidAmount).toBe(41);
    });

    it('derives the paid amount from refund plus fee only when both came in the event', () => {
      expect(
        resolveRemoteCancelSummaryContext(noShowCancel, { paymentState: { amount: 0 } })
          .originalPaidAmount,
      ).toBe(40.49);
      expect(
        resolveRemoteCancelSummaryContext(
          { initiatedBy: 'driver', data: { refundAmount: 37.49 } },
          { paymentState: { amount: 0 } },
        ).originalPaidAmount,
      ).toBeNull();
      expect(
        resolveRemoteCancelSummaryContext(
          { initiatedBy: 'driver', data: { cancellationFee: 3 } },
          {},
        ).originalPaidAmount,
      ).toBeNull();
      expect(
        resolveRemoteCancelSummaryContext(
          { initiatedBy: 'driver', data: { cancellationFee: 3, refundAmount: 0 } },
          {},
        ).originalPaidAmount,
      ).toBeNull();
    });

    it('leaves who cancelled and why empty when the event does not say', () => {
      expect(resolveRemoteCancelSummaryContext({ message: 'Corrida cancelada' }, {})).toEqual({
        originalPaidAmount: null,
        cancelledBy: null,
        cancellationReason: null,
      });
    });
  });
});

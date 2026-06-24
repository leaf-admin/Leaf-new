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
  resolveDriverPayoutAmount,
  isRemoteLivenessPassed,
  resolveSyncedBookingStatus,
  hasRuntimeActiveRideContext,
  shouldPreserveActiveRideOnIdleSync,
  resolveCompletedReceiptRecoveryBookingId,
  hasBackendFinalRecoveredReceiptForBooking,
} = require('../src/screens/prototype/prototypeRideRuntime');

describe('prototype ride runtime financial snapshot', () => {
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
});

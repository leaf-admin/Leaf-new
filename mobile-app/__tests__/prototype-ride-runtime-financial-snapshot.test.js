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
} = require('../src/screens/prototype/prototypeRideRuntime');

describe('prototype ride runtime financial snapshot', () => {
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
          fare: 75.74,
          fareLabel: 'R$ 75,74',
        },
      },
    );

    expect(snapshot.finalFare).toBeCloseTo(78.73, 2);
    expect(snapshot.driverNetAmount).toBeCloseTo(75.74, 2);
    expect(snapshot.totalFees).toBeCloseTo(2.99, 2);
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
});

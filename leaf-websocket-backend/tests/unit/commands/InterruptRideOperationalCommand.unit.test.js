jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS',
    INTERRUPTED_OPERATIONAL: 'INTERRUPTED_OPERATIONAL'
  },
  getBookingState: jest.fn().mockResolvedValue('IN_PROGRESS'),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false }),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

const mockRedis = {
  hdel: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, callback) => callback())
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: { recordCommand: jest.fn() }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logger: { info: jest.fn() }
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/trip-location-persistence-service', () => ({
  resolveCanonicalTripMetrics: jest.fn().mockResolvedValue({
    success: true,
    source: 'server_trip_location_telemetry',
    distanceKm: 3.2,
    durationSecs: 600,
    endLocation: { lat: -22.91, lng: -43.21 },
    pointsCount: 8
  })
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  applyDeferredIdentityReverificationIfSafe: jest.fn().mockResolvedValue({
    success: true,
    applied: true
  })
}));

jest.mock('../../../services/ride-lifecycle-service', () => ({
  calculateOperationalInterruptionSettlement: jest.fn(() => ({
    settlementType: 'INTERRUPTED_OPERATIONAL',
    executedFare: 14,
    executedDistanceKm: 3.2,
    executedDurationSecs: 600,
    remainingReservedAmount: 10,
    estimatedRefund: 10
  })),
  loadBookingContext: jest.fn().mockResolvedValue({
    bookingHash: {
      customerId: 'customer_1',
      driverId: 'driver_1',
      startedAt: '2026-07-12T20:00:00.000Z',
      startLocation: { lat: -22.9, lng: -43.2 }
    },
    activeBooking: {
      customerId: 'customer_1',
      driverId: 'driver_1'
    }
  }),
  normalizeLocation: jest.fn((location) => location || null),
  persistBookingPatch: jest.fn().mockResolvedValue(undefined),
  resolveRideLegs: jest.fn(() => []),
  resolveOperationalContinuation: jest.fn(() => null),
  buildRideLegSettlement: jest.fn((payload) => ({
    legNumber: 1,
    ...payload
  })),
  buildOperationalInterruptionRecord: jest.fn((payload) => ({
    reason: payload.reason,
    pickupLocation: payload.interruptionLocation,
    closedRideLeg: payload.closedRideLeg
  })),
  parseMoneyValue: jest.fn((value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  })
}));

const lifecycleService = require('../../../services/ride-lifecycle-service');
const tripLocationPersistenceService = require('../../../services/trip-location-persistence-service');
const { clearActiveTripForDriver } = require('../../../utils/active-trip-index');
const kycPolicyService = require('../../../services/kyc-policy-service');
const InterruptRideOperationalCommand = require('../../../commands/InterruptRideOperationalCommand');

describe('InterruptRideOperationalCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores client settlement metrics and uses authenticated server telemetry', async () => {
    const command = new InterruptRideOperationalCommand({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      interruptionLocation: {
        lat: 0,
        lng: 0,
        address: 'Endereço informado pelo motorista'
      },
      distanceKm: 999,
      durationSecs: 1,
      reason: 'VEHICLE_BREAKDOWN'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(tripLocationPersistenceService.resolveCanonicalTripMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'booking_1',
        driverId: 'driver_1',
        startedAt: '2026-07-12T20:00:00.000Z',
        startLocation: { lat: -22.9, lng: -43.2 }
      })
    );
    expect(lifecycleService.calculateOperationalInterruptionSettlement).toHaveBeenCalledWith(
      expect.any(Object),
      {
        distanceKm: 3.2,
        durationSecs: 600
      }
    );
    expect(lifecycleService.persistBookingPatch).toHaveBeenCalledWith(
      expect.anything(),
      'booking_1',
      expect.objectContaining({
        interruptionLocation: expect.objectContaining({
          lat: -22.91,
          lng: -43.21,
          source: 'server_trip_location_telemetry'
        }),
        distance: 3.2,
        duration: 600
      })
    );
    expect(kycPolicyService.applyDeferredIdentityReverificationIfSafe).toHaveBeenCalledWith(
      'driver_1',
      { source: 'ride_interrupted_operational', tripId: 'booking_1' }
    );
    expect(clearActiveTripForDriver.mock.invocationCallOrder[0]).toBeLessThan(
      kycPolicyService.applyDeferredIdentityReverificationIfSafe.mock.invocationCallOrder[0]
    );
  });

  it('fails closed when canonical trip telemetry is unavailable', async () => {
    tripLocationPersistenceService.resolveCanonicalTripMetrics.mockResolvedValueOnce({
      success: false,
      code: 'CANONICAL_TRIP_TELEMETRY_UNAVAILABLE'
    });
    const command = new InterruptRideOperationalCommand({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      distanceKm: 999,
      durationSecs: 1
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Telemetria canônica indisponível');
    expect(lifecycleService.calculateOperationalInterruptionSettlement).not.toHaveBeenCalled();
    expect(lifecycleService.persistBookingPatch).not.toHaveBeenCalled();
  });
});

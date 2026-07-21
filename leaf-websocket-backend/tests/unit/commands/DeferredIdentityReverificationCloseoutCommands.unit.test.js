jest.mock('../../../events/ride.completed', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.completed' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS',
    EARLY_ENDED_BY_RIDER: 'EARLY_ENDED_BY_RIDER',
    INTERRUPTED_OPERATIONAL: 'INTERRUPTED_OPERATIONAL',
    INTERRUPTED_OPERATIONAL_ENDED: 'INTERRUPTED_OPERATIONAL_ENDED',
    REASSIGNMENT_PENDING: 'REASSIGNMENT_PENDING'
  },
  getBookingState: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false }),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

const mockRedis = {
  get: jest.fn().mockResolvedValue('booking_1'),
  del: jest.fn().mockResolvedValue(1),
  hdel: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, callback) => callback())
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: { recordCommand: jest.fn() }
}));

jest.mock('../../../utils/tracer', () => ({
  getTracer: jest.fn(() => ({
    startSpan: jest.fn(() => ({
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn()
    }))
  }))
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/trip-location-persistence-service', () => ({
  forceFinalizeTrip: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  applyDeferredIdentityReverificationIfSafe: jest.fn().mockResolvedValue({
    success: true,
    applied: true
  })
}));

jest.mock('../../../services/ride-lifecycle-service', () => ({
  calculateRiderEarlyEndSettlement: jest.fn(() => ({
    settlementType: 'EARLY_ENDED_BY_RIDER',
    executedFare: 12,
    executedDistanceKm: 2,
    executedDurationSecs: 180
  })),
  loadBookingContext: jest.fn(),
  normalizeLocation: jest.fn((location) => location || null),
  parseMoneyValue: jest.fn((value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }),
  persistBookingPatch: jest.fn().mockResolvedValue(undefined),
  resolveRideLegs: jest.fn(() => []),
  resolveOperationalContinuation: jest.fn()
}));

jest.mock('../../../services/ride-settlement-service', () => ({
  buildAuthoritativeCompletionArtifacts: jest.fn(() => ({
    stateMetadata: { completionType: 'CLOSEOUT' },
    bookingPatch: { status: 'CLOSEOUT' },
    eventData: {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      customerId: 'customer_1'
    },
    resultData: {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      customerId: 'customer_1'
    }
  })),
  buildInterruptedOperationalEndedSettlement: jest.fn(() => ({
    settlementType: 'INTERRUPTED_OPERATIONAL_ENDED'
  }))
}));

const RideStateManager = require('../../../services/ride-state-manager');
const lifecycleService = require('../../../services/ride-lifecycle-service');
const { clearActiveTripForDriver } = require('../../../utils/active-trip-index');
const kycPolicyService = require('../../../services/kyc-policy-service');
const EndRideEarlyByRiderCommand = require('../../../commands/EndRideEarlyByRiderCommand');
const RespondOperationalContinuationCommand = require('../../../commands/RespondOperationalContinuationCommand');

describe('deferred identity reverification on alternate ride closeouts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue('booking_1');
    RideStateManager.updateBookingState.mockResolvedValue(undefined);
    lifecycleService.persistBookingPatch.mockResolvedValue(undefined);
  });

  it('applies deferred reverification after a rider early-end clears the active trip', async () => {
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');
    lifecycleService.loadBookingContext.mockResolvedValue({
      bookingHash: {
        customerId: 'customer_1',
        driverId: 'driver_1'
      },
      activeBooking: {
        customerId: 'customer_1',
        driverId: 'driver_1'
      }
    });

    const command = new EndRideEarlyByRiderCommand({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      endLocation: { lat: -22.9, lng: -43.2 },
      distanceKm: 2,
      durationSecs: 180
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(clearActiveTripForDriver).toHaveBeenCalledWith(
      expect.anything(),
      'driver_1',
      'booking_1'
    );
    expect(kycPolicyService.applyDeferredIdentityReverificationIfSafe).toHaveBeenCalledWith(
      'driver_1',
      { source: 'ride_early_ended_by_rider', tripId: 'booking_1' }
    );
    expect(clearActiveTripForDriver.mock.invocationCallOrder[0]).toBeLessThan(
      kycPolicyService.applyDeferredIdentityReverificationIfSafe.mock.invocationCallOrder[0]
    );
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('applies deferred reverification after an interrupted ride is ended by the rider', async () => {
    RideStateManager.getBookingState.mockResolvedValue('INTERRUPTED_OPERATIONAL');
    lifecycleService.loadBookingContext.mockResolvedValue({
      bookingHash: {
        customerId: 'customer_1',
        driverId: 'driver_1',
        distance: 2,
        duration: 180,
        interruptionLocation: { lat: -22.9, lng: -43.2 }
      },
      activeBooking: {
        customerId: 'customer_1',
        driverId: 'driver_1'
      }
    });
    lifecycleService.resolveOperationalContinuation.mockReturnValue({
      status: 'PASSENGER_DECISION_PENDING',
      interruptedByDriverId: 'driver_1',
      pickupLocation: { lat: -22.9, lng: -43.2 },
      reason: 'VEHICLE_BREAKDOWN',
      closedRideLeg: {
        grossAmount: 12,
        distanceKm: 2,
        durationSecs: 180
      }
    });
    lifecycleService.resolveRideLegs.mockReturnValue([]);

    const command = new RespondOperationalContinuationCommand({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      continueTrip: false
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(clearActiveTripForDriver).toHaveBeenCalledWith(
      expect.anything(),
      'driver_1',
      'booking_1'
    );
    expect(kycPolicyService.applyDeferredIdentityReverificationIfSafe).toHaveBeenCalledWith(
      'driver_1',
      { source: 'ride_interrupted_operational_ended', tripId: 'booking_1' }
    );
    expect(clearActiveTripForDriver.mock.invocationCallOrder[0]).toBeLessThan(
      kycPolicyService.applyDeferredIdentityReverificationIfSafe.mock.invocationCallOrder[0]
    );
    await new Promise((resolve) => setImmediate(resolve));
  });
});

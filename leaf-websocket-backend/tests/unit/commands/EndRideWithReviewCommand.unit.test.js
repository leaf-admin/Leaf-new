jest.mock('../../../events/ride.completed', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.completed' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS',
    INTERRUPTED_OPERATIONAL: 'INTERRUPTED_OPERATIONAL',
    REASSIGNMENT_PENDING: 'REASSIGNMENT_PENDING',
    EARLY_ENDED_REVIEW: 'EARLY_ENDED_REVIEW'
  },
  getBookingState: jest.fn().mockResolvedValue('IN_PROGRESS'),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: true, bookingId: 'booking_1' }),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue('booking_1'),
    del: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1)
  })
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, fn) => fn())
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordCommand: jest.fn()
  }
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
  clearActiveTripForDriver: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/trip-location-persistence-service', () => ({
  forceFinalizeTrip: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/ride-lifecycle-service', () => ({
  loadBookingContext: jest.fn().mockResolvedValue({
    bookingHash: {
      customerId: 'customer_1',
      driverId: 'driver_1',
      tollFee: 0
    },
    activeBooking: {
      customerId: 'customer_1',
      driverId: 'driver_1'
    }
  }),
  normalizeLocation: jest.fn((location) => location),
  parseMoneyValue: jest.fn((value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }),
  persistBookingPatch: jest.fn().mockResolvedValue(undefined),
  resolveRideLegs: jest.fn().mockReturnValue([]),
  resolveOperationalContinuation: jest.fn().mockReturnValue(null)
}));

jest.mock('../../../services/ride-settlement-service', () => ({
  buildEarlyEndedReviewContext: jest.fn(() => ({
    reviewStatus: 'PENDING_MANUAL_REVIEW',
    actorId: 'support_1',
    actorType: 'SUPPORT',
    reviewCategory: 'SAFETY',
    reason: 'INCIDENT_REPORTED',
    note: ''
  })),
  buildEarlyEndedReviewSettlement: jest.fn(() => ({
    settlementType: 'EARLY_ENDED_REVIEW',
    executedFare: 12.5,
    executedDistanceKm: 2,
    executedDurationSecs: 180
  })),
  buildAuthoritativeCompletionArtifacts: jest.fn(() => ({
    stateMetadata: { completionType: 'EARLY_ENDED_REVIEW' },
    bookingPatch: { status: 'EARLY_ENDED_REVIEW' },
    eventData: {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      customerId: 'customer_1',
      endLocation: { lat: -22.9, lng: -43.1 },
      finalFare: 12.5
    },
    resultData: {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      customerId: 'customer_1',
      endLocation: { lat: -22.9, lng: -43.1 },
      finalFare: 12.5,
      distance: 2,
      duration: 180,
      settlement: { settlementType: 'EARLY_ENDED_REVIEW' },
      reviewContext: { reviewStatus: 'PENDING_MANUAL_REVIEW' },
      paymentDistribution: { status: 'UNDER_REVIEW' }
    }
  }))
}));

const RideCompletedEvent = require('../../../events/ride.completed');
const RideStateManager = require('../../../services/ride-state-manager');
const driverLockManager = require('../../../services/driver-lock-manager');
const redisPool = require('../../../utils/redis-pool');
const { clearActiveTripForDriver } = require('../../../utils/active-trip-index');
const tripLocationPersistenceService = require('../../../services/trip-location-persistence-service');
const lifecycleService = require('../../../services/ride-lifecycle-service');
const settlementService = require('../../../services/ride-settlement-service');
const EndRideWithReviewCommand = require('../../../commands/EndRideWithReviewCommand');

describe('EndRideWithReviewCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('encerra corrida em review com snapshot autoritativo e evento canônico', async () => {
    const command = new EndRideWithReviewCommand({
      bookingId: 'booking_1',
      actorId: 'support_1',
      actorType: 'support',
      endLocation: { lat: -22.9, lng: -43.1 },
      distanceKm: 2,
      durationSecs: 180,
      reviewCategory: 'SAFETY',
      reason: 'INCIDENT_REPORTED'
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      expect.anything(),
      'booking_1',
      'EARLY_ENDED_REVIEW',
      expect.objectContaining({ completionType: 'EARLY_ENDED_REVIEW' })
    );
    expect(lifecycleService.persistBookingPatch).toHaveBeenCalledWith(
      expect.anything(),
      'booking_1',
      expect.objectContaining({ status: 'EARLY_ENDED_REVIEW' })
    );
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
    expect(clearActiveTripForDriver).toHaveBeenCalledWith(expect.anything(), 'driver_1', 'booking_1');
    expect(settlementService.buildEarlyEndedReviewSettlement).toHaveBeenCalled();
    expect(RideCompletedEvent).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking_1', driverId: 'driver_1' })
    );
    expect(result.data.event.type).toBe('ride.completed');
  });
});

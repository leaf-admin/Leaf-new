jest.mock('../../../events/ride.completed', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.completed' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    COMPLETED: 'COMPLETED'
  },
  getBookingState: jest.fn(),
  isValidTransition: jest.fn(),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/payment-service', () => {
  return jest.fn().mockImplementation(() => ({
    calculateFareBreakdownFromReais: jest.fn((fare = 0, toll = 0) => ({
      grossAmount: Number(fare || 0) + Number(toll || 0),
      operationalFee: 1.2,
      paymentIntermediationFee: 0.6,
      totalFees: 1.8,
      driverNetAmount: Math.max(0, Number(fare || 0) - 1.8)
    }))
  }));
});

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn(),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logStructured: jest.fn()
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
      setAttribute: jest.fn(),
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

jest.mock('../../../services/heartbeat-service', () => ({
  getAndResetOfflineTime: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  clearBookingSnapshot: jest.fn().mockResolvedValue(undefined),
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/ride-lifecycle-service', () => ({
  resolveRideLegs: jest.fn().mockReturnValue([]),
  resolveOperationalContinuation: jest.fn().mockReturnValue(null),
  buildContinuationRideLeg: jest.fn()
}));

const RideCompletedEvent = require('../../../events/ride.completed');
const RideStateManager = require('../../../services/ride-state-manager');
const driverLockManager = require('../../../services/driver-lock-manager');
const redisPool = require('../../../utils/redis-pool');
const { clearActiveTripForDriver } = require('../../../utils/active-trip-index');
const { metrics } = require('../../../utils/prometheus-metrics');
const traceContext = require('../../../utils/trace-context');
const { getTracer } = require('../../../utils/tracer');
const lifecycleService = require('../../../services/ride-lifecycle-service');
const heartbeatService = require('../../../services/heartbeat-service');
const CompleteTripCommand = require('../../../commands/CompleteTripCommand');

describe('CompleteTripCommand', () => {
  let redis;
  let setImmediateSpy;

  beforeEach(() => {
    jest.clearAllMocks();

    redis = {
      hgetall: jest.fn().mockResolvedValue({
        driverId: 'driver_1',
        customerId: 'customer_1',
        city: 'rio-de-janeiro',
        carType: 'leaf_plus',
        estimatedFare: '42',
        paymentAmountInCents: '4200'
      }),
      hset: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue('booking_1'),
      del: jest.fn().mockResolvedValue(1),
      hdel: jest.fn().mockResolvedValue(1)
    };

    redisPool.getConnection.mockReturnValue(redis);
    RideCompletedEvent.mockImplementation((data) => ({
      toJSON: () => ({ ...data, type: 'ride.completed' })
    }));
    traceContext.runWithTraceId.mockImplementation(async (_traceId, fn) => fn());
    lifecycleService.resolveRideLegs.mockReturnValue([]);
    lifecycleService.resolveOperationalContinuation.mockReturnValue(null);
    heartbeatService.getAndResetOfflineTime.mockResolvedValue(0);
    getTracer.mockReturnValue({
      startSpan: jest.fn(() => ({
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn()
      }))
    });
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((fn) => {
      fn();
      return 0;
    });
    driverLockManager.isDriverLocked.mockResolvedValue({
      isLocked: true,
      bookingId: 'booking_1'
    });
    RideStateManager.isValidTransition.mockReturnValue(true);
  });

  afterEach(() => {
    setImmediateSpy?.mockRestore();
  });

  it('blocks trip completion when the booking state is not finishable', async () => {
    RideStateManager.getBookingState.mockResolvedValue('ACCEPTED');
    RideStateManager.isValidTransition.mockReturnValue(false);

    const command = new CompleteTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      endLocation: { lat: -23.57, lng: -46.66 },
      finalFare: 42,
      distance: 12.4,
      duration: 1320
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('estado atual');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
  });

  it('returns an idempotent success without publishing a new event when already completed', async () => {
    RideStateManager.getBookingState.mockResolvedValue('COMPLETED');
    redis.hgetall.mockResolvedValue({
      driverId: 'driver_1',
      customerId: 'customer_1',
      status: 'COMPLETED',
      city: 'rio-de-janeiro',
      carType: 'leaf_plus',
      endLocation: JSON.stringify({ lat: -23.57, lng: -46.66 }),
      finalFare: '42',
      tollFee: '0',
      distance: '12.4',
      duration: '1320'
    });

    const command = new CompleteTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      endLocation: { lat: -23.57, lng: -46.66 },
      finalFare: 42,
      distance: 12.4,
      duration: 1320
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      idempotentReplay: true,
      finalFare: 42
    });
    expect(RideStateManager.isValidTransition).not.toHaveBeenCalled();
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
    expect(redis.hset).not.toHaveBeenCalled();
    expect(RideCompletedEvent).not.toHaveBeenCalled();
    expect(metrics.recordCommand).toHaveBeenCalledWith('CompleteTrip', expect.any(Number), true);
  });

  it('completes the trip, clears active indexes and returns the canonical receipt event', async () => {
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');

    const command = new CompleteTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      endLocation: { lat: -23.57, lng: -46.66 },
      finalFare: 42,
      distance: 12.4,
      duration: 1320
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(driverLockManager.releaseLock).toHaveBeenCalledWith('driver_1');
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_1',
      'COMPLETED',
      expect.objectContaining({
        driverId: 'driver_1',
        finalFare: 42,
        distance: 12.4,
        duration: 1320
      })
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        status: 'COMPLETED',
        finalFare: '42'
      })
    );
    expect(redis.del).toHaveBeenCalledWith('customer_active_booking:customer_1');
    expect(redis.del).toHaveBeenNthCalledWith(
      2,
      'booking_search:booking_1',
      'ride_notifications:booking_1',
      'ride_excluded_drivers:booking_1'
    );
    expect(clearActiveTripForDriver).toHaveBeenCalledWith(
      redis,
      'driver_1',
      'booking_1'
    );
    expect(RideCompletedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        customerId: 'customer_1',
        finalFare: 42
      })
    );
    expect(result.data.paymentDistribution).toEqual(
      expect.objectContaining({ status: 'PENDING' })
    );
    expect(metrics.recordCommand).toHaveBeenCalledWith('CompleteTrip', expect.any(Number), true);
  });

  it('applies offline adjustment in reais and recalculates the financial snapshot', async () => {
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');
    heartbeatService.getAndResetOfflineTime.mockResolvedValue(60000);

    const command = new CompleteTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      endLocation: { lat: -23.57, lng: -46.66 },
      finalFare: 42,
      distance: 12.4,
      duration: 1320
    });

    const result = await command.execute();

    expect(result.success).toBe(true);
    expect(RideStateManager.updateBookingState).toHaveBeenCalledWith(
      redis,
      'booking_1',
      'COMPLETED',
      expect.objectContaining({
        finalFare: 41.5,
        duration: 1260,
        driverNetAmount: 39.7
      })
    );
    expect(redis.hset).toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({
        finalFare: '41.5',
        duration: '1260',
        driverNetAmount: '39.7'
      })
    );
    expect(RideCompletedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        finalFare: 41.5,
        duration: 1260
      })
    );
  });

  it('blocks trip completion when final fare diverges from paid amount', async () => {
    RideStateManager.getBookingState.mockResolvedValue('IN_PROGRESS');
    redis.hgetall.mockResolvedValue({
      driverId: 'driver_1',
      customerId: 'customer_1',
      city: 'rio-de-janeiro',
      carType: 'leaf_plus',
      estimatedFare: '15.5',
      paymentAmountInCents: '1550'
    });

    const command = new CompleteTripCommand({
      driverId: 'driver_1',
      bookingId: 'booking_1',
      endLocation: { lat: -23.57, lng: -46.66 },
      finalFare: 42,
      distance: 12.4,
      duration: 1320
    });

    const result = await command.execute();

    expect(result.success).toBe(false);
    expect(result.error).toContain('diverge');
    expect(RideStateManager.updateBookingState).not.toHaveBeenCalled();
    expect(redis.hset).not.toHaveBeenCalledWith(
      'booking:booking_1',
      expect.objectContaining({ finalFare: '42' })
    );
    expect(metrics.recordCommand).toHaveBeenCalledWith('CompleteTrip', expect.any(Number), false);
  });
});

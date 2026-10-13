'use strict';

/**
 * Encerramento antecipado pelo motorista -> billing worker.
 *
 * O evento ride.completed real do CompleteTripCommand entra no listener real do
 * worker-billing. O worker rejeita evento sem snapshot financeiro final que
 * feche com finalFare e tollFee; aqui se prova que o valor liquidado passa.
 */

const mockListeners = {};
const mockResolveCanonicalTripMetrics = jest.fn();
const mockBookingState = { value: 'IN_PROGRESS' };
const mockProcessNetDistribution = jest.fn();
const mockReleaseInflight = jest.fn();

jest.mock('../../../workers/WorkerManager', () => {
  return jest.fn().mockImplementation(() => ({
    registerListener: jest.fn((eventType, handler) => {
      mockListeners[eventType] = handler;
    }),
    start: jest.fn(),
    stop: jest.fn(),
    getStats: jest.fn(() => ({}))
  }));
});

// Mesmo contrato financeiro central usado pelo PaymentService real (política padrão).
jest.mock('../../../services/payment-service', () =>
  jest.fn().mockImplementation(() => ({
    processNetDistribution: mockProcessNetDistribution,
    calculateFareBreakdownFromReais: (fare = 0, toll = 0) => {
      const { buildRideFinancialContract } = jest.requireActual('../../../services/ride-financial-contract');
      const contract = buildRideFinancialContract({
        passengerPaidCents: Math.round(Number(fare || 0) * 100),
        tollFeeCents: Math.round(Number(toll || 0) * 100)
      });
      return {
        operationalFee: contract.leafOperationalFeeCents / 100,
        paymentIntermediationFee: contract.paymentIntermediationFeeCents / 100,
        subscriptionRetainedFee: contract.subscriptionRetainedFeeCents / 100,
        totalFees: contract.retainedTotalCents / 100,
        driverNetAmount: contract.driverNetAmountCents / 100
      };
    }
  }))
);

jest.mock('../../../services/driver-approval-service', () => ({
  getDriverWooviAccount: jest.fn().mockResolvedValue(null)
}));

jest.mock('../../../services/idempotency-service', () => ({
  generateKey: jest.fn(() => 'driver_1:billing.ride.completed:booking_1'),
  checkAndSet: jest.fn().mockResolvedValue({ isNew: true, cachedResult: null }),
  releaseInflight: mockReleaseInflight,
  cacheResult: jest.fn()
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: { COMPLETED: 'COMPLETED' },
  getBookingState: jest.fn(async () => mockBookingState.value),
  isValidTransition: jest.fn(() => true),
  updateBookingState: jest.fn(async (_redis, _bookingId, nextState) => {
    mockBookingState.value = nextState;
  })
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false }),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn()
}));

jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  runWithTraceId: jest.fn(async (_traceId, callback) => callback())
}));

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test'),
  validateAndEnsureTraceIdInEvent: jest.fn(() => 'trace_test')
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: { recordCommand: jest.fn() }
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

jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/trip-location-persistence-service', () => ({
  forceFinalizeTrip: jest.fn().mockResolvedValue(undefined),
  resolveCanonicalTripMetrics: (...args) => mockResolveCanonicalTripMetrics(...args)
}));

jest.mock('../../../services/heartbeat-service', () => ({
  getAndResetOfflineTime: jest.fn().mockResolvedValue(0)
}));

jest.mock('../../../services/pricing-h3-read-model-service', () => ({
  clearBookingSnapshot: jest.fn().mockResolvedValue(undefined),
  applyDriverSnapshot: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-referral-reward-service', () => ({
  evaluateDriverRewardsForDriver: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  applyDeferredIdentityReverificationIfSafe: jest.fn().mockResolvedValue({ success: true })
}));

const redisPool = require('../../../utils/redis-pool');
const CompleteTripCommand = require('../../../commands/CompleteTripCommand');
const { EVENT_TYPES } = require('../../../events');
require('../../../workers/worker-billing');

const PICKUP = { lat: -22.9208, lng: -43.4061 };
const DESTINATION = { lat: -22.9827, lng: -43.3642 };
const HALFWAY = { lat: -22.95175, lng: -43.38515 };

function createRedis(bookingOverrides = {}) {
  const store = {
    'booking:booking_1': {
      driverId: 'driver_1',
      customerId: 'customer_1',
      city: 'rio-de-janeiro',
      carType: 'leaf_plus',
      status: 'IN_PROGRESS',
      estimatedFare: '40',
      paymentAmountInCents: '4000',
      tollFee: '0',
      routeDistanceKm: '10',
      routeDurationSecs: '1200',
      pickupLocation: JSON.stringify(PICKUP),
      startLocation: JSON.stringify(PICKUP),
      destinationLocation: JSON.stringify(DESTINATION),
      startedAt: new Date(Date.now() - 600000).toISOString(),
      ...bookingOverrides
    }
  };
  return {
    store,
    hgetall: jest.fn(async (key) => ({ ...(store[key] || {}) })),
    hset: jest.fn(async (key, patch) => {
      store[key] = { ...(store[key] || {}), ...patch };
      return 1;
    }),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1)
  };
}

function serverSaw(position, { distanceKm = 5, durationSecs = 600 } = {}) {
  mockResolveCanonicalTripMetrics.mockResolvedValue({
    success: true,
    source: 'server_trip_location_telemetry',
    distanceKm,
    durationSecs,
    endLocation: position,
    lastReceivedAtMs: Date.now() - 5000,
    pointsCount: 42
  });
}

async function completeTrip(overrides = {}) {
  const command = new CompleteTripCommand({
    driverId: 'driver_1',
    bookingId: 'booking_1',
    endLocation: DESTINATION,
    finalFare: 40,
    distance: 10,
    duration: 1200,
    traceId: 'trace_test',
    ...overrides
  });
  return command.execute();
}

function deliverToBillingWorker(result, eventId) {
  return mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
    eventId,
    eventType: EVENT_TYPES.RIDE_COMPLETED,
    data: result.data.event
  });
}

describe('CompleteTripCommand driver early end -> billing worker', () => {
  let setImmediateSpy;
  let immediateTasks;
  const previousFlag = process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBookingState.value = 'IN_PROGRESS';
    process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT = 'true';
    redisPool.getConnection.mockReturnValue(createRedis());
    mockProcessNetDistribution.mockResolvedValue({ success: true, data: { id: 'distribution_1' } });
    immediateTasks = [];
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((fn, ...args) => {
      immediateTasks.push(Promise.resolve().then(() => fn(...args)));
      return { hasRef: () => false, ref: jest.fn(), unref: jest.fn() };
    });
  });

  afterEach(async () => {
    await Promise.allSettled(immediateTasks);
    setImmediateSpy?.mockRestore();
    if (previousFlag === undefined) {
      delete process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;
    } else {
      process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT = previousFlag;
    }
  });

  it('emits a ride.completed event that the billing worker settles on the travelled share', async () => {
    serverSaw(HALFWAY);

    const result = await completeTrip({ earlyEnd: { reason: 'passenger_request' } });

    expect(result.success).toBe(true);
    expect(result.data.event.eventType).toBe(EVENT_TYPES.RIDE_COMPLETED);
    expect(result.data.event.data).toMatchObject({
      finalFare: 20,
      tollFee: 0,
      completionType: 'EARLY_ENDED_BY_DRIVER',
      settlement: expect.objectContaining({ prepaidAmount: 40, executedFare: 20, estimatedRefund: 20 })
    });

    const billingResult = await deliverToBillingWorker(result, 'event_driver_early_end_1');

    expect(billingResult).toMatchObject({ success: true });
    expect(mockReleaseInflight).not.toHaveBeenCalled();
    expect(mockProcessNetDistribution).toHaveBeenCalledTimes(1);
    expect(mockProcessNetDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_1',
        driverId: 'driver_1',
        totalAmount: 2000,
        tollFee: 0,
        financialSnapshot: expect.objectContaining({
          authoritativeSnapshot: true,
          financialSnapshotSource: 'backend_final',
          passengerPaidCents: 2000,
          tollFeeCents: 0,
          operationalFeeCents: 99,
          paymentIntermediationFeeCents: 50,
          driverNetAmountCents: 1851,
          balanced: true
        })
      })
    );
  });

  it('is accepted by the billing worker with the toll kept whole', async () => {
    redisPool.getConnection.mockReturnValue(
      createRedis({ estimatedFare: '46.5', paymentAmountInCents: '4650', tollFee: '6.5' })
    );
    serverSaw(HALFWAY);

    const result = await completeTrip({ finalFare: 46.5, tollFee: 6.5 });
    const billingResult = await deliverToBillingWorker(result, 'event_driver_early_end_toll');

    // 6,50 + 50% × 40,00 = 26,50; o worker estorna 46,50 − 26,50 = 20,00 pelo totalAmount.
    expect(result.data.settlement).toMatchObject({
      executedFare: 26.5,
      estimatedRefund: 20,
      tollFee: 6.5,
      tollKeptWhole: true
    });
    expect(billingResult).toMatchObject({ success: true });
    expect(mockReleaseInflight).not.toHaveBeenCalled();
    expect(mockProcessNetDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: 2650,
        tollFee: 650,
        financialSnapshot: expect.objectContaining({
          passengerPaidCents: 2650,
          grossFareCents: 2000,
          tollFeeCents: 650,
          driverTollPassThroughCents: 650,
          operationalFeeCents: 99,
          paymentIntermediationFeeCents: 50,
          driverNetAmountCents: 2501,
          allocatedTotalCents: 2650,
          balanced: true
        })
      })
    );
  });

  it('still delivers the full fare to the billing worker when the settlement fails safe', async () => {
    mockResolveCanonicalTripMetrics.mockResolvedValue({
      success: false,
      code: 'CANONICAL_TRIP_TELEMETRY_UNAVAILABLE'
    });

    const result = await completeTrip({ endLocation: HALFWAY, earlyEnd: { reason: 'trip_problem' } });
    const billingResult = await deliverToBillingWorker(result, 'event_driver_full_fare');

    expect(result.data.completionType).toBeUndefined();
    expect(billingResult).toMatchObject({ success: true });
    expect(mockProcessNetDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: 4000,
        financialSnapshot: expect.objectContaining({ passengerPaidCents: 4000 })
      })
    );
  });
});

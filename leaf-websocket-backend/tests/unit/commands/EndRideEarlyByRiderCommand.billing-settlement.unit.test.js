const mockListeners = {};
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

jest.mock('../../../utils/ride-lifecycle-feature-flags', () => ({
  isMultiLegBillingEnabled: jest.fn(() => false)
}));

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: {
    IN_PROGRESS: 'IN_PROGRESS',
    REASSIGNED_IN_PROGRESS: 'REASSIGNED_IN_PROGRESS',
    EARLY_ENDED_BY_RIDER: 'EARLY_ENDED_BY_RIDER'
  },
  getBookingState: jest.fn().mockResolvedValue('IN_PROGRESS'),
  updateBookingState: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false }),
  releaseLock: jest.fn().mockResolvedValue(undefined)
}));

const mockBookingHash = {};
const mockHset = jest.fn();
const mockRedis = {
  hgetall: jest.fn(async () => ({ ...mockBookingHash })),
  hget: jest.fn().mockResolvedValue(null),
  get: jest.fn().mockResolvedValue('booking_1'),
  del: jest.fn().mockResolvedValue(1),
  hdel: jest.fn().mockResolvedValue(1),
  multi: jest.fn(() => {
    const pipeline = {
      hset: jest.fn((...args) => {
        mockHset(...args);
        return pipeline;
      }),
      hget: jest.fn(() => pipeline),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, null]])
    };
    return pipeline;
  })
};

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => mockRedis)
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
      recordException: jest.fn(),
      end: jest.fn()
    }))
  }))
}));

jest.mock('../../../utils/active-trip-index', () => ({
  clearActiveTripForDriver: jest.fn().mockResolvedValue(true)
}));

const mockResolveCanonicalTripMetrics = jest.fn().mockResolvedValue({ success: false });
jest.mock('../../../services/trip-location-persistence-service', () => ({
  forceFinalizeTrip: jest.fn().mockResolvedValue(undefined),
  resolveCanonicalTripMetrics: (...args) => mockResolveCanonicalTripMetrics(...args)
}));

jest.mock('../../../services/kyc-policy-service', () => ({
  applyDeferredIdentityReverificationIfSafe: jest.fn().mockResolvedValue({ success: true })
}));

const EndRideEarlyByRiderCommand = require('../../../commands/EndRideEarlyByRiderCommand');
const { EVENT_TYPES } = require('../../../events');
const { validateAuthoritativeFinancialSnapshot } = require('../../../services/ride-financial-contract');
require('../../../workers/worker-billing');

function setBooking(overrides = {}) {
  Object.keys(mockBookingHash).forEach((key) => delete mockBookingHash[key]);
  Object.assign(mockBookingHash, {
    bookingId: 'booking_1',
    customerId: 'customer_1',
    driverId: 'driver_1',
    status: 'IN_PROGRESS',
    estimatedFare: '45.48',
    paymentAmountInCents: '4548',
    distance: '12',
    duration: '1800',
    ...overrides
  });
}

async function endEarly() {
  const command = new EndRideEarlyByRiderCommand({
    bookingId: 'booking_1',
    customerId: 'customer_1',
    endLocation: { lat: -22.9, lng: -43.2 },
    distanceKm: 0.4,
    durationSecs: 60,
    traceId: 'trace_test'
  });
  return command.execute();
}

describe('EndRideEarlyByRiderCommand -> billing worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setBooking();
    mockProcessNetDistribution.mockResolvedValue({ success: true, data: { id: 'distribution_1' } });
  });

  it('emits a ride.completed event that the billing worker settles on the executed fare', async () => {
    const result = await endEarly();

    expect(result.success).toBe(true);
    expect(result.data.finalFare).toBe(11.37);
    expect(result.data.settlement).toMatchObject({
      prepaidAmount: 45.48,
      executedFare: 11.37,
      estimatedRefund: 34.11
    });

    const billingResult = await mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
      eventId: 'event_early_end_1',
      eventType: EVENT_TYPES.RIDE_COMPLETED,
      data: result.data.event
    });

    expect(billingResult).toMatchObject({ success: true });
    expect(mockReleaseInflight).not.toHaveBeenCalled();
    expect(mockProcessNetDistribution).toHaveBeenCalledTimes(1);
    expect(mockProcessNetDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        rideId: 'booking_1',
        driverId: 'driver_1',
        totalAmount: 1137,
        tollFee: 0,
        financialSnapshot: expect.objectContaining({
          authoritativeSnapshot: true,
          financialSnapshotSource: 'backend_final',
          passengerPaidCents: 1137,
          operationalFeeCents: 99,
          paymentIntermediationFeeCents: 50,
          driverNetAmountCents: 988,
          balanced: true
        })
      })
    );
  });

  it('persists the backend-final snapshot of the executed fare on the booking', async () => {
    const result = await endEarly();

    expect(result.data.authoritativeSnapshot).toBe(true);
    expect(validateAuthoritativeFinancialSnapshot(result.data.financialSnapshot, {
      passengerPaidCents: 1137,
      tollFeeCents: 0
    })).toMatchObject({ valid: true });

    const bookingPatch = mockHset.mock.calls.find(([key]) => key === 'booking:booking_1')[1];
    expect(bookingPatch.status).toBe('EARLY_ENDED_BY_RIDER');
    expect(bookingPatch.authoritativeSnapshot).toBe('true');
    expect(JSON.parse(bookingPatch.financialSnapshot)).toMatchObject({
      passengerPaidCents: 1137,
      driverNetAmountCents: 988
    });
  });

  it('keeps the toll whole and outside the travelled share in the executed-fare snapshot', async () => {
    setBooking({ tollFee: '4.5' });

    // 4,50 + 25% × (45,48 − 4,50) = 4,50 + 10,25 = 14,75
    const result = await endEarly();
    expect(result.data.settlement).toMatchObject({
      prepaidAmount: 45.48,
      executedFare: 14.75,
      estimatedRefund: 30.73,
      tollFee: 4.5,
      tollKeptWhole: true,
      tollChargedAmount: 4.5,
      tollCrossingVerified: false,
      tollManualRefundOnDispute: true
    });

    await mockListeners[EVENT_TYPES.RIDE_COMPLETED]({
      eventId: 'event_early_end_toll',
      eventType: EVENT_TYPES.RIDE_COMPLETED,
      data: result.data.event
    });

    expect(mockProcessNetDistribution).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: 1475,
        tollFee: 450,
        financialSnapshot: expect.objectContaining({
          passengerPaidCents: 1475,
          tollFeeCents: 450,
          driverTollPassThroughCents: 450,
          allocatedTotalCents: 1475,
          balanced: true
        })
      })
    );
  });

  it('settles the approved worked example to the cent (R$ 48,61 with a R$ 8,95 toll)', async () => {
    setBooking({ estimatedFare: '48.61', paymentAmountInCents: '4861', tollFee: '8.95' });

    const result = await endEarly();

    expect(result.data.settlement).toMatchObject({
      appliedRatio: 0.25,
      prepaidAmount: 48.61,
      executedFare: 18.87,
      estimatedRefund: 29.74,
      tollFee: 8.95,
      fareWithoutToll: 39.66,
      executedFareWithoutToll: 9.92,
      tollKeptWhole: true
    });

    const snapshot = result.data.financialSnapshot;
    expect(validateAuthoritativeFinancialSnapshot(snapshot, {
      passengerPaidCents: 1887,
      tollFeeCents: 895
    })).toMatchObject({ valid: true });
    expect(snapshot.driverNetAmountCents).toBe(1758);
    // taxa operacional + taxa de pagamento + líquido do motorista (com o pedágio) = valor executado
    expect(
      snapshot.operationalFeeCents +
        snapshot.paymentIntermediationFeeCents +
        snapshot.subscriptionRetainedFeeCents +
        snapshot.driverNetAmountCents
    ).toBe(1887);
    // valor executado + estorno = pré-pago
    expect(snapshot.passengerPaidCents + Math.round(result.data.settlement.estimatedRefund * 100)).toBe(4861);
  });

  it('refunds the toll when the server trail shows the plaza was not crossed', async () => {
    setBooking({ estimatedFare: '48.61', paymentAmountInCents: '4861', tollFee: '8.95' });
    mockResolveCanonicalTripMetrics.mockResolvedValueOnce({
      success: true,
      startedAtMs: Date.now() - 60000,
      tollCrossingsTracked: true,
      tollCrossings: []
    });

    const result = await endEarly();

    // 0 + 25% × (48,61 − 8,95) = 9,92; estorno 38,69
    expect(result.data.settlement).toMatchObject({
      executedFare: 9.92,
      estimatedRefund: 38.69,
      tollFee: 0,
      bookedTollFee: 8.95,
      tollCrossingVerified: true,
      tollKeptWhole: false
    });
    expect(validateAuthoritativeFinancialSnapshot(result.data.financialSnapshot, {
      passengerPaidCents: 992,
      tollFeeCents: 0
    })).toMatchObject({ valid: true });
  });

  it('keeps today\'s unsettled outcome when the booked toll is not below the fare', async () => {
    setBooking({ estimatedFare: '20', paymentAmountInCents: '2000', tollFee: '20' });

    const result = await endEarly();

    // Dado inconsistente: a conta antiga é mantida, o snapshot não fecha e o
    // worker de billing rejeita o evento em vez de movimentar dinheiro.
    expect(result.data.settlement).toMatchObject({
      executedFare: 5,
      estimatedRefund: 15,
      tollKeptWhole: false,
      tollRuleSkippedReason: 'TOLL_NOT_BELOW_FARE'
    });
    expect(result.data.financialSnapshot || null).toBeNull();
  });

  it('propagates the sealed financial context of the booking to the billing event', async () => {
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const financialContext = sealFinancialContext({ providerEnvironment: 'production' });
    setBooking({
      financialContext: JSON.stringify(financialContext),
      financialNamespace: financialContext.namespace,
      financialContextId: financialContext.contextId
    });

    const result = await endEarly();

    expect(result.data.event.data.financialContext).toMatchObject({
      contextId: financialContext.contextId,
      namespace: financialContext.namespace
    });
  });
});

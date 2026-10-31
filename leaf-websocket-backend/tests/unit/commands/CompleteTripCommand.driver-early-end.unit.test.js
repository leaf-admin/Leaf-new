'use strict';

/**
 * Encerramento antecipado pelo motorista dentro do CompleteTripCommand.
 *
 * A decisão e a conta usam os serviços reais (ride-early-end-service,
 * ride-lifecycle-service e o contrato financeiro). Só a telemetria da corrida,
 * o Redis e a infraestrutura são simulados.
 */

const mockResolveCanonicalTripMetrics = jest.fn();
const mockBookingState = { value: 'IN_PROGRESS' };

jest.mock('../../../events/ride.completed', () => {
  return jest.fn().mockImplementation((data) => ({
    toJSON: () => ({ ...data, type: 'ride.completed' })
  }));
});

jest.mock('../../../services/ride-state-manager', () => ({
  STATES: { COMPLETED: 'COMPLETED' },
  getBookingState: jest.fn(async () => mockBookingState.value),
  isValidTransition: jest.fn(() => true),
  updateBookingState: jest.fn(async (_redis, _bookingId, nextState) => {
    mockBookingState.value = nextState;
  })
}));

jest.mock('../../../services/payment-service', () => {
  const { buildRideFinancialContract } = jest.requireActual('../../../services/ride-financial-contract');
  return jest.fn().mockImplementation(() => ({
    calculateFareBreakdownFromReais: jest.fn((fare = 0, toll = 0, options = {}) => {
      const contract = buildRideFinancialContract({
        passengerPaidCents: Math.round(Number(fare || 0) * 100),
        tollFeeCents: Math.round(Number(toll || 0) * 100),
        driverIntroFee: options.driverIntroFee
      });
      return {
        totalFare: contract.passengerPaidCents / 100,
        tollFee: contract.tollFeeCents / 100,
        operationalFee: contract.leafOperationalFeeCents / 100,
        paymentIntermediationFee: contract.paymentIntermediationFeeCents / 100,
        subscriptionRetainedFee: 0,
        totalFees: contract.retainedTotalCents / 100,
        driverNetAmount: contract.driverNetAmountCents / 100
      };
    })
  }));
});

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: jest.fn().mockResolvedValue({ isLocked: false }),
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

jest.mock('../../../utils/trace-validator', () => ({
  validateAndEnsureTraceIdInCommand: jest.fn(() => 'trace_test')
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

const RideCompletedEvent = require('../../../events/ride.completed');
const redisPool = require('../../../utils/redis-pool');
const heartbeatService = require('../../../services/heartbeat-service');
const { validateAuthoritativeFinancialSnapshot } = require('../../../services/ride-financial-contract');
const CompleteTripCommand = require('../../../commands/CompleteTripCommand');
const driverIntroFeeService = require('../../../services/driver-intro-fee-service');
const driverLockManager = require('../../../services/driver-lock-manager');
const { buildDriverIntroFeeContext } = require('../../../services/driver-intro-fee-policy');

const PICKUP = { lat: -22.9208, lng: -43.4061 };
const DESTINATION = { lat: -22.9827, lng: -43.3642 };
const HALFWAY = { lat: -22.95175, lng: -43.38515 };
const JUST_AFTER_PICKUP = { lat: -22.9226, lng: -43.4049 };

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

function serverSaw(position, { distanceKm = 5, durationSecs = 600, ageMs = 5000, tollCrossings } = {}) {
  mockResolveCanonicalTripMetrics.mockResolvedValue({
    success: true,
    source: 'server_trip_location_telemetry',
    ...(tollCrossings ? { tollCrossings, tollCrossingsTracked: true } : {}),
    distanceKm,
    durationSecs,
    endLocation: position,
    lastReceivedAtMs: Date.now() - ageMs,
    pointsCount: 42
  });
}

function buildCommand(overrides = {}) {
  return new CompleteTripCommand({
    driverId: 'driver_1',
    bookingId: 'booking_1',
    endLocation: DESTINATION,
    finalFare: 40,
    distance: 10,
    duration: 1200,
    ...overrides
  });
}

function expectFullFare(result, redis) {
  expect(result.success).toBe(true);
  expect(result.data.finalFare).toBe(40);
  expect(result.data.completionType).toBeUndefined();
  expect(result.data.settlement).toBeUndefined();
  expect(result.data.financialSnapshot.passengerPaidCents).toBe(4000);
  expect(result.data.event.finalFare).toBe(40);
  expect(result.data.event.settlement).toBeUndefined();
  expect(redis.store['booking:booking_1'].finalFare).toBe('40');
  expect(redis.store['booking:booking_1'].settlement).toBeUndefined();
  expect(redis.store['booking:booking_1'].completionType).toBeUndefined();
}

describe('CompleteTripCommand driver early end settlement', () => {
  let redis;
  let setImmediateSpy;
  let immediateTasks;
  const previousFlag = process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBookingState.value = 'IN_PROGRESS';
    process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT = 'true';
    heartbeatService.getAndResetOfflineTime.mockResolvedValue(0);
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: false });
    redis = createRedis();
    redisPool.getConnection.mockReturnValue(redis);
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

  it('keeps a normal completion unchanged when the car reached the destination', async () => {
    serverSaw(DESTINATION, { distanceKm: 10.2, durationSecs: 1250 });

    const result = await buildCommand().execute();

    expectFullFare(result, redis);
    expect(result.data.earlyEndSettlementSkipped).toBeUndefined();
    expect(redis.store['booking:booking_1'].earlyEndSettlementSkipped).toBeUndefined();
    expect(redis.store['booking:booking_1'].status).toBe('COMPLETED');
  });

  const introContext = () => buildDriverIntroFeeContext({ driverId: 'driver_1', qualifiedCompletedRides: 24, historyVerified: true, historySnapshotId: 'synthetic-24' });

  it('settles the accepted 99-cent fee and counts the destination before unlocking the driver', async () => {
    redis.store['booking:booking_1'].driverIntroFee = JSON.stringify(introContext());
    serverSaw(DESTINATION, { distanceKm: 10, durationSecs: 1200 });
    driverLockManager.isDriverLocked.mockResolvedValue({ isLocked: true, bookingId: 'booking_1' });
    const record = jest.spyOn(driverIntroFeeService, 'recordCompletion').mockImplementation(async () => {
      expect(redis.store['booking:booking_1'].status).toBe('COMPLETED');
      expect(JSON.parse(redis.store['booking:booking_1'].driverIntroFeeCompletion)).toMatchObject({ qualified: true });
      return { qualifiedCompletedRides: 25 };
    });
    const result = await buildCommand().execute();
    expect(result.success).toBe(true);
    expect(result.data.financialSnapshot).toMatchObject({ operationalFeeCents: 49, paymentIntermediationFeeCents: 50, passengerPaidCents: 4000, driverIntroFee: introContext() });
    expect(result.data.driverIntroFeeCompletion).toMatchObject({ qualified: true, reason: 'SERVER_DESTINATION_COMPLETION' });
    expect(record).toHaveBeenCalledWith(redis, 'driver_1', 'booking_1', 'operational');
    expect(record.mock.invocationCallOrder[0]).toBeLessThan(driverLockManager.releaseLock.mock.invocationCallOrder[0]);
  });

  it('keeps the accepted fee on an early end but excludes that ride from the quota', async () => {
    redis.store['booking:booking_1'].driverIntroFee = JSON.stringify(introContext());
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });
    jest.spyOn(driverIntroFeeService, 'recordCompletion').mockResolvedValue({ qualifiedCompletedRides: 24 });
    const result = await buildCommand().execute();
    expect(result.success).toBe(true);
    expect(result.data.finalFare).toBeLessThan(40);
    expect(result.data.financialSnapshot.operationalFeeCents).toBe(49);
    expect(result.data.driverIntroFeeCompletion).toMatchObject({ qualified: false, reviewRequired: false, reason: 'EARLY_END' });
  });

  it('finishes the physical ride with its frozen fee even when counting must retry', async () => {
    redis.store['booking:booking_1'].driverIntroFee = JSON.stringify(introContext());
    serverSaw(DESTINATION);
    jest.spyOn(driverIntroFeeService, 'recordCompletion').mockRejectedValue(new Error('synthetic Redis interruption'));
    const result = await buildCommand().execute();
    expect(result.success).toBe(true);
    expect(result.data.financialSnapshot.operationalFeeCents).toBe(49);
    expect(redis.store['booking:booking_1'].status).toBe('COMPLETED');
  });

  it('does not use the client destination as proof when server telemetry is unavailable', async () => {
    redis.store['booking:booking_1'].driverIntroFee = JSON.stringify(introContext());
    mockResolveCanonicalTripMetrics.mockResolvedValue({ success: false });
    jest.spyOn(driverIntroFeeService, 'recordCompletion').mockResolvedValue({ qualifiedCompletedRides: 24 });
    const result = await buildCommand({ endLocation: DESTINATION }).execute();
    expect(result.success).toBe(true);
    expect(result.data.driverIntroFeeCompletion).toMatchObject({ qualified: false, reviewRequired: true });
    expect(result.data.financialSnapshot.operationalFeeCents).toBe(49);
  });

  it('settles on the travelled share when the server saw the car far from the destination', async () => {
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand({
      earlyEnd: { reason: 'passenger_request', remainingMeters: 4000 }
    }).execute();

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      finalFare: 20,
      tollFee: 0,
      distance: 5,
      duration: 600,
      completionType: 'EARLY_ENDED_BY_DRIVER',
      completionReason: 'passenger_request',
      endLocation: expect.objectContaining(HALFWAY),
      settlement: expect.objectContaining({
        settlementType: 'EARLY_ENDED_BY_DRIVER',
        initiatedBy: 'DRIVER',
        driverReason: 'passenger_request',
        originalFare: 40,
        prepaidAmount: 40,
        executedFare: 20,
        estimatedRefund: 20,
        appliedRatio: 0.5,
        metricsSource: 'server_trip_location_telemetry'
      }),
      earlyEnd: expect.objectContaining({ detected: true, driverReason: 'passenger_request' })
    });
    expect(result.data.earlyEnd.remainingMeters).toBeGreaterThan(3500);

    // O snapshot que o billing worker valida fecha em centavos sobre o valor liquidado:
    // é ele que faz o worker estornar a diferença e creditar o motorista pelo líquido.
    const snapshotCheck = validateAuthoritativeFinancialSnapshot(result.data.financialSnapshot, {
      passengerPaidCents: 2000,
      tollFeeCents: 0
    });
    expect(snapshotCheck.valid).toBe(true);
    expect(result.data.driverNetAmount).toBe(snapshotCheck.snapshot.driverNetAmountCents / 100);
    expect(result.data.driverNetAmount).toBeLessThan(20);
    expect(result.data.driverNetAmount).toBeGreaterThan(0);

    expect(RideCompletedEvent).toHaveBeenCalledTimes(1);
    expect(RideCompletedEvent).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'booking_1',
      finalFare: 20,
      tollFee: 0,
      completionType: 'EARLY_ENDED_BY_DRIVER',
      settlement: expect.objectContaining({ executedFare: 20, estimatedRefund: 20 }),
      financialSnapshot: expect.objectContaining({ passengerPaidCents: 2000 })
    }));

    // A corrida continua COMPLETED: só o valor e o tipo de conclusão mudam.
    const stored = redis.store['booking:booking_1'];
    expect(stored.status).toBe('COMPLETED');
    expect(stored.finalFare).toBe('20');
    expect(stored.completionType).toBe('EARLY_ENDED_BY_DRIVER');
    expect(JSON.parse(stored.settlement)).toMatchObject({ executedFare: 20, estimatedRefund: 20 });
    expect(JSON.parse(stored.earlyEndSettlement)).toMatchObject({ executedFare: 20 });
  });

  it('settles even when the driver app claims it ended at the destination', async () => {
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand({ endLocation: DESTINATION, earlyEnd: null }).execute();

    expect(result.data.completionType).toBe('EARLY_ENDED_BY_DRIVER');
    expect(result.data.finalFare).toBe(20);
    expect(result.data.settlement.driverReason).toBeNull();
    expect(result.data.completionReason).toBe('EARLY_END_BY_DRIVER');
  });

  it('never lets the client hint change the settled amount', async () => {
    const fares = [];
    for (const remainingMeters of [1, 4000, 999999, -50, 'abc']) {
      mockBookingState.value = 'IN_PROGRESS';
      redis = createRedis();
      redisPool.getConnection.mockReturnValue(redis);
      serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });
      const result = await buildCommand({
        distance: 0.1,
        duration: 1,
        earlyEnd: { reason: 'trip_problem', remainingMeters }
      }).execute();
      fares.push(result.data.finalFare);
      expect(result.data.settlement.estimatedRefund).toBe(20);
    }
    expect(fares).toEqual([20, 20, 20, 20, 20]);
  });

  it('ignores a spoofed early-end hint when the car is actually at the destination', async () => {
    serverSaw(DESTINATION, { distanceKm: 10.1, durationSecs: 1210 });

    const result = await buildCommand({
      endLocation: PICKUP,
      distance: 0.2,
      duration: 30,
      earlyEnd: { reason: 'passenger_request', remainingMeters: 8000 }
    }).execute();

    expectFullFare(result, redis);
  });

  it('applies the same 25% minimum as the rider-initiated early end', async () => {
    serverSaw(JUST_AFTER_PICKUP, { distanceKm: 0.2, durationSecs: 60 });

    const result = await buildCommand().execute();

    expect(result.data.completionType).toBe('EARLY_ENDED_BY_DRIVER');
    expect(result.data.settlement.appliedRatio).toBe(0.25);
    expect(result.data.finalFare).toBe(10);
    expect(result.data.settlement.estimatedRefund).toBe(30);
  });

  it('uses the straight line from pickup to the last position when the trail lost points', async () => {
    serverSaw(HALFWAY, { distanceKm: 0.3, durationSecs: 600 });

    const result = await buildCommand().execute();

    // ~4 km em linha reta: a trilha de 0,3 km não derruba o motorista para o mínimo.
    expect(result.data.settlement.executedDistanceKm).toBeGreaterThan(3.9);
    expect(result.data.settlement.appliedRatio).toBeGreaterThan(0.4);
    expect(result.data.finalFare).toBeGreaterThan(16);
  });

  it('keeps the full fare when the server has no driver position', async () => {
    mockResolveCanonicalTripMetrics.mockResolvedValue({
      success: false,
      code: 'CANONICAL_TRIP_TELEMETRY_UNAVAILABLE'
    });

    const result = await buildCommand({
      endLocation: HALFWAY,
      earlyEnd: { reason: 'passenger_request', remainingMeters: 4000 }
    }).execute();

    expectFullFare(result, redis);
    expect(redis.store['booking:booking_1'].earlyEndSettlementSkipped).toBeUndefined();
  });

  it('keeps the full fare when the last server position is stale', async () => {
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600, ageMs: 10 * 60 * 1000 });

    const result = await buildCommand().execute();

    expectFullFare(result, redis);
  });

  it('keeps the full fare and still completes the ride when the evaluation throws', async () => {
    mockResolveCanonicalTripMetrics.mockRejectedValue(new Error('redis down'));

    const result = await buildCommand().execute();

    expectFullFare(result, redis);
    expect(redis.store['booking:booking_1'].status).toBe('COMPLETED');
  });

  function useTollBooking({ fare, toll, ...overrides }) {
    redis = createRedis({
      estimatedFare: String(fare),
      paymentAmountInCents: String(Math.round(fare * 100)),
      tollFee: String(toll),
      ...overrides
    });
    redisPool.getConnection.mockReturnValue(redis);
  }

  function expectConsistentSettlement(result, { fare, toll, executedFare, driverNet }) {
    const { settlement, financialSnapshot } = result.data;
    const cents = (value) => Math.round(value * 100);

    expect(result.data.completionType).toBe('EARLY_ENDED_BY_DRIVER');
    expect(result.data.finalFare).toBe(executedFare);
    expect(result.data.tollFee).toBe(toll);
    expect(settlement.prepaidAmount).toBe(fare);
    expect(settlement.executedFare).toBe(executedFare);
    expect(settlement.tollFee).toBe(toll);
    expect(cents(settlement.executedFare) + cents(settlement.estimatedRefund)).toBe(cents(fare));
    expect(cents(settlement.tollFee) + cents(settlement.executedFareWithoutToll)).toBe(cents(executedFare));

    const snapshotCheck = validateAuthoritativeFinancialSnapshot(financialSnapshot, {
      passengerPaidCents: cents(executedFare),
      tollFeeCents: cents(toll)
    });
    expect(snapshotCheck.valid).toBe(true);
    expect(
      financialSnapshot.operationalFeeCents +
        financialSnapshot.paymentIntermediationFeeCents +
        financialSnapshot.subscriptionRetainedFeeCents +
        financialSnapshot.driverNetAmountCents
    ).toBe(cents(executedFare));
    expect(financialSnapshot.driverNetAmountCents).toBe(cents(driverNet));
    expect(financialSnapshot.driverNetAmountCents - financialSnapshot.tollFeeCents).toBeGreaterThan(0);
    expect(result.data.driverNetAmount).toBe(driverNet);
    expect(result.data.event.finalFare).toBe(executedFare);
    expect(result.data.event.tollFee).toBe(toll);
  }

  it('settles a toll ride ended halfway: toll whole, travelled share on the rest', async () => {
    useTollBooking({ fare: 46.5, toll: 6.5 });
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

    // 6,50 + 50% × 40,00 = 26,50; estorno 20,00.
    // Líquido: 20,00 − 0,99 − 0,50 + 6,50 de pedágio = 25,01.
    expect(result.success).toBe(true);
    expectConsistentSettlement(result, { fare: 46.5, toll: 6.5, executedFare: 26.5, driverNet: 25.01 });
    expect(result.data.settlement).toMatchObject({
      appliedRatio: 0.5,
      fareWithoutToll: 40,
      executedFareWithoutToll: 20,
      estimatedRefund: 20,
      tollKeptWhole: true,
      tollChargedAmount: 6.5,
      tollCrossingVerified: false,
      tollManualRefundOnDispute: true
    });
    expect(result.data.financialSnapshot).toMatchObject({
      operationalFeeCents: 99,
      paymentIntermediationFeeCents: 50
    });
    expect(result.data.earlyEndSettlementSkipped).toBeUndefined();

    const stored = redis.store['booking:booking_1'];
    expect(stored.finalFare).toBe('26.5');
    expect(stored.tollFee).toBe('6.5');
    expect(JSON.parse(stored.settlement)).toMatchObject({
      executedFare: 26.5,
      tollFee: 6.5,
      tollKeptWhole: true
    });
  });

  it('settles a toll ride ended almost immediately on the whole toll plus the 25% minimum', async () => {
    useTollBooking({ fare: 46.5, toll: 6.5 });
    serverSaw(JUST_AFTER_PICKUP, { distanceKm: 0.2, durationSecs: 60 });

    const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

    // 6,50 + 25% × 40,00 = 16,50; estorno 30,00. Líquido: 10,00 − 0,79 − 0,50 + 6,50 = 15,21.
    expectConsistentSettlement(result, { fare: 46.5, toll: 6.5, executedFare: 16.5, driverNet: 15.21 });
    expect(result.data.settlement).toMatchObject({
      appliedRatio: 0.25,
      executedFareWithoutToll: 10,
      estimatedRefund: 30,
      tollKeptWhole: true
    });
  });

  it('charges no toll when the server saw the car end before the plaza', async () => {
    useTollBooking({ fare: 46.5, toll: 6.5 });
    serverSaw(JUST_AFTER_PICKUP, { distanceKm: 0.2, durationSecs: 60, tollCrossings: [] });

    const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

    // 0 + 25% × 40,00 = 10,00; estorno 36,50. Líquido: 10,00 − 0,79 − 0,50 = 8,71.
    expectConsistentSettlement(result, { fare: 46.5, toll: 0, executedFare: 10, driverNet: 8.71 });
    expect(result.data.settlement).toMatchObject({
      bookedTollFee: 6.5,
      tollChargedAmount: 0,
      tollKeptWhole: false,
      tollCrossingVerified: true,
      tollManualRefundOnDispute: false,
      estimatedRefund: 36.5
    });
    expect(redis.store['booking:booking_1'].tollFee).toBe('0');
  });

  it('keeps the toll when the server saw the car cross the plaza', async () => {
    useTollBooking({ fare: 46.5, toll: 6.5 });
    serverSaw(HALFWAY, {
      distanceKm: 5,
      durationSecs: 600,
      tollCrossings: [{ id: 'p18_sapucaia', amount: 6.5, at: Date.now() - 60000 }]
    });

    const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

    expectConsistentSettlement(result, { fare: 46.5, toll: 6.5, executedFare: 26.5, driverNet: 25.01 });
    expect(result.data.settlement).toMatchObject({ tollCrossingVerified: true, tollCrossedPlazas: ['p18_sapucaia'] });
  });

  it('stays consistent when the toll is larger than the minimum charge', async () => {
    useTollBooking({ fare: 20, toll: 12 });
    serverSaw(JUST_AFTER_PICKUP, { distanceKm: 0.2, durationSecs: 60 });

    const result = await buildCommand({ finalFare: 20, tollFee: 12 }).execute();

    // 12,00 + 25% × 8,00 = 14,00; estorno 6,00. Líquido: 2,00 − 0,79 − 0,50 + 12,00 = 12,71.
    expectConsistentSettlement(result, { fare: 20, toll: 12, executedFare: 14, driverNet: 12.71 });
    expect(result.data.settlement).toMatchObject({
      executedFareWithoutToll: 2,
      estimatedRefund: 6,
      tollKeptWhole: true
    });
  });

  it('keeps the full fare when the settled share would leave the driver only the toll', async () => {
    useTollBooking({ fare: 16, toll: 12 });
    serverSaw(JUST_AFTER_PICKUP, { distanceKm: 0.2, durationSecs: 60 });

    const result = await buildCommand({ finalFare: 16, tollFee: 12 }).execute();

    // 25% × 4,00 = 1,00 não cobre as taxas: o líquido da corrida seria zero.
    expect(result.success).toBe(true);
    expect(result.data.finalFare).toBe(16);
    expect(result.data.completionType).toBeUndefined();
    expect(result.data.financialSnapshot).toMatchObject({ passengerPaidCents: 1600, tollFeeCents: 1200 });
    expect(result.data.earlyEndSettlementSkipped).toMatchObject({ reason: 'SETTLED_NET_NOT_POSITIVE' });
    expect(JSON.parse(redis.store['booking:booking_1'].earlyEndSettlementSkipped)).toMatchObject({
      reason: 'SETTLED_NET_NOT_POSITIVE'
    });
    expect(redis.store['booking:booking_1'].settlement).toBeUndefined();
  });

  it('keeps the full fare when the completion toll differs from the booked toll', async () => {
    useTollBooking({ fare: 46.5, toll: 6.5 });
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand({ finalFare: 46.5, tollFee: 9 }).execute();

    expect(result.data.finalFare).toBe(46.5);
    expect(result.data.completionType).toBeUndefined();
    expect(result.data.earlyEndSettlementSkipped).toMatchObject({ reason: 'TOLL_AMOUNT_MISMATCH' });
    expect(redis.store['booking:booking_1'].settlement).toBeUndefined();
  });

  it('keeps the full fare when the prepaid amount of the settlement is not the amount paid', async () => {
    redis = createRedis({ estimatedFare: '45', paymentAmountInCents: '4000' });
    redisPool.getConnection.mockReturnValue(redis);
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand().execute();

    expectFullFare(result, redis);
    expect(result.data.earlyEndSettlementSkipped).toMatchObject({ reason: 'PREPAID_AMOUNT_MISMATCH' });
  });

  it('does not settle without the contracted route distance', async () => {
    redis = createRedis({ routeDistanceKm: '0' });
    redisPool.getConnection.mockReturnValue(redis);
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand().execute();

    expectFullFare(result, redis);
    expect(result.data.earlyEndSettlementSkipped).toMatchObject({
      reason: 'CONTRACTED_ROUTE_UNAVAILABLE'
    });
  });

  it('does not stack the settlement on top of an offline-time review', async () => {
    heartbeatService.getAndResetOfflineTime.mockResolvedValue(180000);
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand().execute();

    expect(result.data.finalFare).toBe(40);
    expect(result.data.completionType).toBeUndefined();
    expect(result.data.settlementReviewRequired).toBe(true);
    expect(result.data.paymentDistribution.status).toBe('UNDER_REVIEW');
    expect(mockResolveCanonicalTripMetrics).not.toHaveBeenCalled();
  });

  it('changes nothing with the flag off, which is the default', async () => {
    delete process.env.ENABLE_DRIVER_EARLY_END_SETTLEMENT;
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const result = await buildCommand({
      earlyEnd: { reason: 'passenger_request', remainingMeters: 4000 }
    }).execute();

    expectFullFare(result, redis);
    expect(mockResolveCanonicalTripMetrics).not.toHaveBeenCalled();
  });

  it('is idempotent: a repeated completeTrip publishes no new event and no new settlement', async () => {
    serverSaw(HALFWAY, { distanceKm: 5, durationSecs: 600 });

    const first = await buildCommand({ earlyEnd: { reason: 'trip_problem' } }).execute();
    // O handler grava a detecção no booking depois do command.
    await redis.hset('booking:booking_1', { earlyEnd: JSON.stringify(first.data.earlyEnd) });

    // Na repetição o carro já andou: se a conta fosse refeita, o valor mudaria.
    serverSaw(DESTINATION, { distanceKm: 10, durationSecs: 1200 });
    const second = await buildCommand({ earlyEnd: { reason: 'trip_problem' } }).execute();

    expect(second.success).toBe(true);
    expect(second.data.idempotentReplay).toBe(true);
    expect(second.data.event).toBeUndefined();
    expect(second.data.finalFare).toBe(20);
    expect(second.data.completionType).toBe('EARLY_ENDED_BY_DRIVER');
    expect(second.data.settlement).toEqual(first.data.settlement);
    expect(second.data.earlyEnd).toEqual(first.data.earlyEnd);
    expect(second.data.financialSnapshot.passengerPaidCents).toBe(2000);
    expect(RideCompletedEvent).toHaveBeenCalledTimes(1);
    expect(mockResolveCanonicalTripMetrics).toHaveBeenCalledTimes(1);
  });

  describe('toll on a ride that reached the destination', () => {
    it('refunds the booked toll when the server saw the car avoid the plaza', async () => {
      useTollBooking({ fare: 46.5, toll: 6.5 });
      serverSaw(DESTINATION, { distanceKm: 10.2, durationSecs: 1250, tollCrossings: [] });

      const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

      expect(result.success).toBe(true);
      expect(result.data.completionType).toBeUndefined();
      expect(result.data.finalFare).toBe(40);
      expect(result.data.tollFee).toBe(0);
      expect(result.data.event.finalFare).toBe(40);
      expect(result.data.event.tollFee).toBe(0);
      expect(result.data.tollAdjustment).toMatchObject({
        type: 'TOLL_NOT_CROSSED',
        bookedTollFee: 6.5,
        chargedTollFee: 0,
        refundedTollFee: 6.5,
        originalPaidAmount: 46.5,
        finalAmount: 40,
        estimatedRefund: 6.5
      });
      const snapshotCheck = validateAuthoritativeFinancialSnapshot(result.data.financialSnapshot, {
        passengerPaidCents: 4000,
        tollFeeCents: 0
      });
      expect(snapshotCheck.valid).toBe(true);
      const stored = redis.store['booking:booking_1'];
      expect(stored.finalFare).toBe('40');
      expect(stored.tollFee).toBe('0');
      expect(JSON.parse(stored.tollAdjustment)).toMatchObject({ refundedTollFee: 6.5 });
    });

    it('keeps the toll when the server saw the car cross the plaza', async () => {
      useTollBooking({ fare: 46.5, toll: 6.5 });
      serverSaw(DESTINATION, {
        distanceKm: 10.2,
        durationSecs: 1250,
        tollCrossings: [{ id: 'p18_sapucaia', amount: 6.5, at: Date.now() - 60000 }]
      });

      const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

      expect(result.data.finalFare).toBe(46.5);
      expect(result.data.tollFee).toBe(6.5);
      expect(result.data.tollAdjustment).toBeUndefined();
      expect(redis.store['booking:booking_1'].tollAdjustment).toBeUndefined();
    });

    it('keeps the toll when the ride has no crossing record', async () => {
      useTollBooking({ fare: 46.5, toll: 6.5 });
      serverSaw(DESTINATION, { distanceKm: 10.2, durationSecs: 1250 });

      const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

      expect(result.data.finalFare).toBe(46.5);
      expect(result.data.tollFee).toBe(6.5);
      expect(result.data.tollAdjustment).toBeUndefined();
    });

    it('can be switched off', async () => {
      process.env.TOLL_CROSSING_REFUND_ENABLED = 'false';
      try {
        useTollBooking({ fare: 46.5, toll: 6.5 });
        serverSaw(DESTINATION, { distanceKm: 10.2, durationSecs: 1250, tollCrossings: [] });

        const result = await buildCommand({ finalFare: 46.5, tollFee: 6.5 }).execute();

        expect(result.data.finalFare).toBe(46.5);
        expect(result.data.tollAdjustment).toBeUndefined();
      } finally {
        delete process.env.TOLL_CROSSING_REFUND_ENABLED;
      }
    });
  });
});

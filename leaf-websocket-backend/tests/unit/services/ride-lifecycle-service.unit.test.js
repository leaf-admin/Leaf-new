const {
  calculateRiderEarlyEndSettlement,
  calculateOperationalInterruptionSettlement,
  buildRideLegSettlement,
  buildContinuationRideLeg,
  buildExtensionRequest,
  sumRideLegGrossFare,
  applyConfirmedRideExtension,
  resolveRideExtensionPaymentTimeoutSec,
  buildRideExtensionExpiresAt,
  isIsoDateExpired
} = require('../../../services/ride-lifecycle-service');

describe('ride-lifecycle-service', () => {
  const baseBooking = {
    estimatedFare: '40',
    paymentAmountInCents: '4000',
    routeDistanceKm: '10',
    routeDurationSecs: '600'
  };

  it('calculates early end settlement from executed distance and duration', () => {
    const settlement = calculateRiderEarlyEndSettlement(baseBooking, {
      distanceKm: 4,
      durationSecs: 240
    });

    expect(settlement.settlementType).toBe('EARLY_ENDED_BY_RIDER');
    expect(settlement.originalFare).toBe(40);
    expect(settlement.executedFare).toBe(16);
    expect(settlement.estimatedRefund).toBe(24);
    expect(settlement.remainingReservedAmount).toBe(24);
    expect(settlement.appliedRatio).toBe(0.4);
  });

  it('calculates operational interruption without minimum charge floor', () => {
    const settlement = calculateOperationalInterruptionSettlement(baseBooking, {
      distanceKm: 2.5,
      durationSecs: 150
    });

    expect(settlement.settlementType).toBe('INTERRUPTED_OPERATIONAL');
    expect(settlement.executedFare).toBe(10);
    expect(settlement.estimatedRefund).toBe(30);
  });

  it('builds a primary leg retaining fees on the driver leg', () => {
    const leg = buildRideLegSettlement({
      bookingHash: baseBooking,
      existingRideLegs: [],
      driverId: 'driver_1',
      grossAmount: 18,
      distanceKm: 4.2,
      durationSecs: 480,
      legType: 'PRIMARY',
      reason: 'INTERRUPTED_OPERATIONAL'
    });

    expect(leg.legNumber).toBe(1);
    expect(leg.driverId).toBe('driver_1');
    expect(leg.grossAmount).toBe(18);
    expect(leg.operationalFee).toBeGreaterThan(0);
    expect(leg.paymentIntermediationFee).toBeGreaterThanOrEqual(0);
    expect(leg.platformAbsorbedOperationalFee).toBe(0);
    expect(leg.driverNetAmount).toBeLessThan(18);
  });

  it('builds a continuation leg absorbing the second-leg fees', () => {
    const firstLeg = buildRideLegSettlement({
      bookingHash: baseBooking,
      existingRideLegs: [],
      driverId: 'driver_1',
      grossAmount: 16,
      distanceKm: 4,
      durationSecs: 240,
      legType: 'PRIMARY',
      reason: 'INTERRUPTED_OPERATIONAL'
    });

    const continuationLeg = buildContinuationRideLeg({
      bookingHash: baseBooking,
      existingRideLegs: [firstLeg],
      driverId: 'driver_2',
      finalFare: 40,
      distanceKm: 6,
      durationSecs: 360,
      rescueBonus: 0
    });

    expect(sumRideLegGrossFare([firstLeg, continuationLeg])).toBe(40);
    expect(continuationLeg.legNumber).toBe(2);
    expect(continuationLeg.legType).toBe('CONTINUATION');
    expect(continuationLeg.grossAmount).toBe(24);
    expect(continuationLeg.operationalFee).toBe(0);
    expect(continuationLeg.paymentIntermediationFee).toBe(0);
    expect(continuationLeg.platformAbsorbedOperationalFee).toBeGreaterThan(0);
    expect(continuationLeg.platformAbsorbedPaymentIntermediationFee).toBeGreaterThanOrEqual(0);
    expect(continuationLeg.driverNetAmount).toBe(24);
  });

  it('builds ride extension expiration using configured timeout', () => {
    const previous = process.env.RIDE_EXTENSION_PAYMENT_TIMEOUT_SEC;
    process.env.RIDE_EXTENSION_PAYMENT_TIMEOUT_SEC = '90';

    const timeoutSec = resolveRideExtensionPaymentTimeoutSec();
    const expiresAt = buildRideExtensionExpiresAt(new Date('2026-03-28T20:00:00.000Z'));

    expect(timeoutSec).toBe(90);
    expect(expiresAt).toBe('2026-03-28T20:01:30.000Z');
    expect(isIsoDateExpired(expiresAt, Date.parse('2026-03-28T20:01:31.000Z'))).toBe(true);
    expect(isIsoDateExpired(expiresAt, Date.parse('2026-03-28T20:01:29.000Z'))).toBe(false);

    if (previous === undefined) {
      delete process.env.RIDE_EXTENSION_PAYMENT_TIMEOUT_SEC;
    } else {
      process.env.RIDE_EXTENSION_PAYMENT_TIMEOUT_SEC = previous;
    }
  });

  it('aggregates confirmed extension payment and keeps operational costs explicit', async () => {
    const activeExtensionRequest = {
      requestId: 'ext_1',
      status: 'PENDING_PAYMENT',
      requestedBy: 'customer_1',
      currentFare: 80,
      newFare: 91.23,
      fareDelta: 11.23,
      diffFare: 11.98,
      passengerPayableFare: 91.98,
      paymentAmountBeforeExtensionCents: 8000,
      extensionChargeAmount: 11.98,
      extensionChargeAmountCents: 1198,
      extensionOperationalCost: 0.75,
      extensionOperationalCostCents: 75,
      routeRecalculationCost: 0.25,
      routeRecalculationCostCents: 25,
      paymentIntermediationFee: 0.5,
      paymentIntermediationFeeCents: 50,
      chargeId: 'charge_ext_1',
      newEndLocation: { lat: -22.99, lng: -43.31, add: 'Novo destino' }
    };
    const activeBookingRaw = JSON.stringify({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      driverId: 'driver_1',
      estimatedFare: 80
    });
    const hsetCalls = [];
    const pipeline = {
      hset: jest.fn((...args) => {
        hsetCalls.push(args);
        return pipeline;
      }),
      hget: jest.fn(() => pipeline),
      exec: jest.fn().mockResolvedValue([
        [null, 1],
        [null, activeBookingRaw]
      ])
    };
    const redis = {
      hgetall: jest.fn(async () => ({
        customerId: 'customer_1',
        driverId: 'driver_1',
        estimatedFare: '80',
        paymentAmountInCents: '8000',
        activeExtensionRequest: JSON.stringify(activeExtensionRequest)
      })),
      hget: jest.fn(async (_key, field) => (field === 'extensionHistory' ? '[]' : activeBookingRaw)),
      hset: jest.fn().mockResolvedValue(1),
      multi: jest.fn(() => pipeline)
    };

    const result = await applyConfirmedRideExtension({
      redis,
      bookingId: 'booking_1',
      chargeId: 'charge_ext_1',
      amountInCents: 1198,
      io: null,
      source: 'unit_test'
    });

    expect(result.success).toBe(true);
    expect(result.payload).toMatchObject({
      passengerPayableFare: 91.98,
      diffFare: 11.98,
      fareDelta: 11.23,
      extensionOperationalCost: 0.75
    });
    const bookingPatch = hsetCalls.find(([key]) => key === 'booking:booking_1')?.[1];
    expect(bookingPatch).toMatchObject({
      estimatedFare: '91.98',
      contractedRideFare: '91.23',
      paymentAmountInCents: '9198',
      extensionPaidAmountInCents: '1198',
      extensionOperationalCostCents: '75',
      extensionRouteRecalculationCostCents: '25',
      extensionPaymentIntermediationFeeCents: '50'
    });
  });

  it('uses the contracted ride fare, not prior operational costs, for chained extension deltas', () => {
    const previous = process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS;
    process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS = '25';

    try {
      const extension = buildExtensionRequest({
        bookingHash: {
          contractedRideFare: '91.23',
          estimatedFare: '91.98',
          paymentAmountInCents: '9198'
        },
        customerId: 'customer_1',
        newEndLocation: { lat: -22.99, lng: -43.31 },
        newFare: 100
      });

      expect(extension.currentFare).toBe(91.23);
      expect(extension.fareDelta).toBe(8.77);
      expect(extension.diffFare).toBe(9.52);
      expect(extension.passengerPayableFare).toBe(101.5);
    } finally {
      if (previous === undefined) {
        delete process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS;
      } else {
        process.env.RIDE_EXTENSION_ROUTE_RECALCULATION_COST_CENTS = previous;
      }
    }
  });
});

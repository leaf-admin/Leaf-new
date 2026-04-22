const {
  calculateRiderEarlyEndSettlement,
  calculateOperationalInterruptionSettlement,
  buildRideLegSettlement,
  buildContinuationRideLeg,
  sumRideLegGrossFare,
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
});

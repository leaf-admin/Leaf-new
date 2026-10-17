const {
  calculateExecutedFareSettlement,
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

  describe('early-end toll rule (toll whole + travelled share of the fare without it)', () => {
    const tollBooking = (overrides = {}) => ({
      estimatedFare: '48.61',
      paymentAmountInCents: '4861',
      tollFee: '8.95',
      routeDistanceKm: '10',
      routeDurationSecs: '600',
      ...overrides
    });
    const cents = (value) => Math.round(value * 100);

    it('settles the approved example at toll + 25% of the fare without toll', () => {
      const settlement = calculateRiderEarlyEndSettlement(tollBooking(), { distanceKm: 0.1, durationSecs: 5 });

      // 8,95 + 25% × (48,61 − 8,95) = 8,95 + 9,92 = 18,87 (antes: 25% × 48,61 = 12,15)
      expect(settlement).toMatchObject({
        settlementType: 'EARLY_ENDED_BY_RIDER',
        originalFare: 48.61,
        prepaidAmount: 48.61,
        appliedRatio: 0.25,
        tollFee: 8.95,
        fareWithoutToll: 39.66,
        executedFareWithoutToll: 9.92,
        executedFare: 18.87,
        estimatedRefund: 29.74,
        remainingReservedAmount: 29.74,
        tollKeptWhole: true,
        tollChargedAmount: 8.95,
        tollCrossingVerified: false,
        tollManualRefundOnDispute: true
      });
    });

    it('charges no toll when the trip telemetry saw no plaza crossed', () => {
      const settlement = calculateRiderEarlyEndSettlement(tollBooking(), {
        distanceKm: 0,
        durationSecs: 5,
        tollCrossing: { verified: true, crossedTollFee: 0, plazas: [] }
      });

      // 0 + 25% × (48,61 − 8,95) = 9,92; estorno 38,69
      expect(settlement).toMatchObject({
        tollFee: 0,
        bookedTollFee: 8.95,
        executedFareWithoutToll: 9.92,
        executedFare: 9.92,
        estimatedRefund: 38.69,
        tollKeptWhole: false,
        tollChargedAmount: 0,
        tollCrossingVerified: true,
        tollCrossedPlazas: [],
        tollManualRefundOnDispute: false
      });
    });

    it('charges the booked toll when the crossed plaza was seen, capped at the booked amount', () => {
      const crossed = calculateRiderEarlyEndSettlement(tollBooking(), {
        distanceKm: 2,
        durationSecs: 120,
        tollCrossing: { verified: true, crossedTollFee: 8.95, plazas: ['p10a_transolimpica'] }
      });
      const overCrossed = calculateRiderEarlyEndSettlement(tollBooking(), {
        distanceKm: 2,
        durationSecs: 120,
        tollCrossing: { verified: true, crossedTollFee: 30, plazas: ['a', 'b'] }
      });

      expect(crossed).toMatchObject({ tollFee: 8.95, tollKeptWhole: true, tollCrossingVerified: true });
      expect(crossed.tollCrossedPlazas).toEqual(['p10a_transolimpica']);
      expect(overCrossed.tollFee).toBe(8.95);
      expect(cents(overCrossed.executedFare) + cents(overCrossed.estimatedRefund)).toBe(4861);
    });

    it('keeps the booked toll whole when crossings were not tracked', () => {
      const settlement = calculateRiderEarlyEndSettlement(tollBooking(), {
        distanceKm: 0,
        durationSecs: 5,
        tollCrossing: { verified: false, crossedTollFee: null, plazas: [] }
      });

      expect(settlement).toMatchObject({ tollFee: 8.95, executedFare: 18.87, tollManualRefundOnDispute: true });
    });

    it('never scales the toll, whatever the travelled share', () => {
      [[0, 0], [2, 120], [5, 300], [7.5, 450], [10, 600], [14, 900]].forEach(([distanceKm, durationSecs]) => {
        const settlement = calculateRiderEarlyEndSettlement(tollBooking(), { distanceKm, durationSecs });

        expect(cents(settlement.executedFare)).toBe(895 + Math.round(3966 * settlement.appliedRatio));
        expect(cents(settlement.executedFare) + cents(settlement.estimatedRefund)).toBe(4861);
        expect(settlement.executedFare).toBeLessThanOrEqual(settlement.prepaidAmount);
        expect(settlement.estimatedRefund).toBeGreaterThanOrEqual(0);
        expect(settlement.tollChargedAmount).toBe(8.95);
      });
    });

    it('produces exactly today\'s numbers for rides without toll', () => {
      const fares = ['7.9', '12.34', '19.99', '33.33', '40', '45.48', '48.61', '77.77', '101.01', '250.05'];
      const progress = [[0, 0], [0.4, 60], [3.3, 200], [5, 300], [9.99, 599], [10, 600]];
      const noTollVariants = [{}, { tollFee: '0' }, { tollFee: '' }, { tollFee: 'abc' }, { tollFee: null }, { tollFee: '-3' }];

      fares.forEach((fare) => {
        progress.forEach(([distanceKm, durationSecs]) => {
          noTollVariants.forEach((variant) => {
            const booking = {
              estimatedFare: fare,
              paymentAmountInCents: String(Math.round(Number(fare) * 100)),
              routeDistanceKm: '10',
              routeDurationSecs: '600',
              ...variant
            };
            // Conta de hoje: proporção × tarifa inteira, sem a regra do pedágio.
            const today = calculateExecutedFareSettlement(booking, {
              distanceKm,
              durationSecs,
              settlementType: 'EARLY_ENDED_BY_RIDER',
              minChargeRatio: 0.25
            });
            const settlement = calculateRiderEarlyEndSettlement(booking, { distanceKm, durationSecs });

            expect(settlement).toEqual(today);
            expect(settlement.executedFare).toBe(
              Math.round(Number(fare) * settlement.appliedRatio * 100) / 100
            );
            expect(settlement.tollKeptWhole).toBeUndefined();
            expect(settlement.fareWithoutToll).toBeUndefined();
          });
        });
      });
    });

    it('treats a missing or non-numeric toll as no toll', () => {
      ['abc', '', null, undefined, 'NaN', '-3'].forEach((tollFee) => {
        const settlement = calculateRiderEarlyEndSettlement(tollBooking({ tollFee }), { distanceKm: 0.1, durationSecs: 5 });

        expect(settlement.executedFare).toBe(12.15);
        expect(settlement.estimatedRefund).toBe(36.46);
        expect(settlement.tollKeptWhole).toBeUndefined();
      });
    });

    it('keeps the old numbers and flags the settlement when the toll is not below the fare', () => {
      ['20', '25'].forEach((tollFee) => {
        const settlement = calculateRiderEarlyEndSettlement(
          tollBooking({ estimatedFare: '20', paymentAmountInCents: '2000', tollFee }),
          { distanceKm: 0.1, durationSecs: 5 }
        );

        expect(settlement).toMatchObject({
          executedFare: 5,
          estimatedRefund: 15,
          tollKeptWhole: false,
          tollRuleSkippedReason: 'TOLL_NOT_BELOW_FARE'
        });
        expect(settlement.tollChargedAmount).toBeUndefined();
      });
    });

    it('never charges more than was prepaid and never returns a negative refund', () => {
      // Pedágio quase do tamanho da tarifa: pedágio + mínimo continua dentro do pré-pago.
      const nearFare = calculateRiderEarlyEndSettlement(
        tollBooking({ estimatedFare: '20', paymentAmountInCents: '2000', tollFee: '19.99' }),
        { distanceKm: 0.1, durationSecs: 5 }
      );
      expect(nearFare.executedFare).toBe(19.99);
      expect(nearFare.estimatedRefund).toBe(0.01);

      // Corrida inteira percorrida: cobra o pré-pago, estorno zero.
      const full = calculateRiderEarlyEndSettlement(tollBooking(), { distanceKm: 30, durationSecs: 3000 });
      expect(full.executedFare).toBe(48.61);
      expect(full.estimatedRefund).toBe(0);

      // Pré-pago acima da tarifa estimada: a tarifa contratual acompanha o pré-pago.
      const overPrepaid = calculateRiderEarlyEndSettlement(
        tollBooking({ estimatedFare: '40', paymentAmountInCents: '4861' }),
        { distanceKm: 0.1, durationSecs: 5 }
      );
      expect(overPrepaid.executedFare).toBeLessThanOrEqual(overPrepaid.prepaidAmount);
      expect(cents(overPrepaid.executedFare) + cents(overPrepaid.estimatedRefund)).toBe(4861);
    });

    it('does not apply the toll rule to operational interruption or to the generic calculation', () => {
      const interruption = calculateOperationalInterruptionSettlement(tollBooking(), { distanceKm: 2.5, durationSecs: 150 });
      expect(interruption.executedFare).toBe(12.15);
      expect(interruption.estimatedRefund).toBe(36.46);
      expect(interruption.tollKeptWhole).toBeUndefined();

      const generic = calculateExecutedFareSettlement(tollBooking(), { distanceKm: 2.5, durationSecs: 150, minChargeRatio: 0 });
      expect(generic.executedFare).toBe(12.15);
      expect(generic.tollKeptWhole).toBeUndefined();
    });
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

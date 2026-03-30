const {
  buildEarlyEndedReviewContext,
  buildEarlyEndedReviewSettlement,
  buildInterruptedOperationalEndedSettlement,
  buildAuthoritativeCompletionArtifacts
} = require('../../../services/ride-settlement-service');

describe('ride-settlement-service', () => {
  test('buildEarlyEndedReviewSettlement marca revisão manual e preserva métricas executadas', () => {
    const settlement = buildEarlyEndedReviewSettlement(
      {
        estimatedFare: 40,
        paymentAmountInCents: 4000,
        routeDistanceKm: 10,
        routeDurationSecs: 1200
      },
      {
        distanceKm: 4,
        durationSecs: 360,
        actorId: 'support_1',
        actorType: 'support',
        reviewCategory: 'SAFETY',
        reason: 'INCIDENT_REPORTED',
        note: 'passageiro reportou incidente'
      }
    );

    expect(settlement.settlementType).toBe('EARLY_ENDED_REVIEW');
    expect(settlement.reviewRequired).toBe(true);
    expect(settlement.reviewStatus).toBe('PENDING_MANUAL_REVIEW');
    expect(settlement.reviewCategory).toBe('SAFETY');
    expect(settlement.reviewReason).toBe('INCIDENT_REPORTED');
    expect(settlement.executedFare).toBeGreaterThanOrEqual(0);
  });

  test('buildInterruptedOperationalEndedSettlement consolida refund e legs', () => {
    const settlement = buildInterruptedOperationalEndedSettlement(
      {
        estimatedFare: 30,
        paymentAmountInCents: 3000,
        tollFee: 2
      },
      {
        operationalContinuation: {
          estimatedRefund: 12,
          remainingReservedAmount: 12,
          executedFare: 18
        },
        rideLegs: [
          { grossAmount: 18, distanceKm: 3, durationSecs: 420 }
        ]
      }
    );

    expect(settlement.settlementType).toBe('INTERRUPTED_OPERATIONAL_ENDED');
    expect(settlement.executedFare).toBe(18);
    expect(settlement.estimatedRefund).toBe(12);
    expect(settlement.rideLegSettlements).toHaveLength(1);
  });

  test('buildAuthoritativeCompletionArtifacts cria aliases compatíveis para review', () => {
    const completion = buildAuthoritativeCompletionArtifacts({
      bookingHash: { tollFee: 1.5 },
      bookingId: 'booking_1',
      status: 'EARLY_ENDED_REVIEW',
      completedAt: '2026-03-30T02:00:00.000Z',
      completionType: 'EARLY_ENDED_REVIEW',
      completionReason: 'INCIDENT_REPORTED',
      endLocation: { lat: -22.9, lng: -43.1 },
      finalFare: 14,
      distance: 2.5,
      duration: 300,
      settlement: { settlementType: 'EARLY_ENDED_REVIEW', executedFare: 14 },
      reviewContext: buildEarlyEndedReviewContext({
        actorId: 'support_1',
        actorType: 'support',
        reviewCategory: 'SAFETY',
        reason: 'INCIDENT_REPORTED'
      }),
      driverId: 'driver_1',
      customerId: 'customer_1'
    });

    expect(completion.bookingPatch.reviewSettlement).toEqual(
      expect.objectContaining({ settlementType: 'EARLY_ENDED_REVIEW' })
    );
    expect(completion.bookingPatch.reviewStatus).toBe('PENDING_MANUAL_REVIEW');
    expect(completion.eventData.reviewContext).toEqual(
      expect.objectContaining({ reviewCategory: 'SAFETY' })
    );
    expect(completion.resultData.paymentDistribution).toEqual(
      expect.objectContaining({ status: 'UNDER_REVIEW' })
    );
  });
});

const { buildTripCompletedPayload } = require('../../../utils/trip-completion-payload');

describe('trip-completion-payload', () => {
  test('inclui reviewContext quando presente', () => {
    const payload = buildTripCompletedPayload({
      bookingId: 'booking_1',
      bookingData: {},
      endLocation: { lat: -22.9, lng: -43.1 },
      distance: 2,
      duration: 180,
      fareBreakdown: {
        totalFare: 12.5,
        operationalFee: 1,
        paymentIntermediationFee: 0.5,
        totalFees: 1.5,
        driverNetAmount: 11
      },
      completionType: 'EARLY_ENDED_REVIEW',
      reviewContext: {
        reviewStatus: 'PENDING_MANUAL_REVIEW',
        reviewCategory: 'SAFETY'
      }
    });

    expect(payload.reviewContext).toEqual(
      expect.objectContaining({
        reviewStatus: 'PENDING_MANUAL_REVIEW',
        reviewCategory: 'SAFETY'
      })
    );
  });
});

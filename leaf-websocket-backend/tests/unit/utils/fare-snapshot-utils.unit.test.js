const {
  buildEstimatedFareSnapshot,
  resolveEstimatedFareSnapshot,
} = require('../../../utils/fare-snapshot-utils');

describe('fare-snapshot-utils', () => {
  it('builds an estimated fare snapshot from the authoritative fare calculation', () => {
    const paymentService = {
      calculateFareBreakdownFromReais: jest.fn(() => ({
        operationalFee: 2.4,
        paymentIntermediationFee: 0.61,
        totalFees: 3.01,
        driverNetAmount: 15.39,
      })),
    };

    expect(buildEstimatedFareSnapshot(paymentService, 18.4, 0)).toEqual({
      estimatedOperationalFee: 2.4,
      estimatedPaymentIntermediationFee: 0.61,
      estimatedTotalFees: 3.01,
      estimatedDriverNetAmount: 15.39,
    });
    expect(paymentService.calculateFareBreakdownFromReais).toHaveBeenCalledWith(
      18.4,
      0,
    );
  });

  it('prefers the persisted snapshot over any later recalculation', () => {
    const paymentService = {
      calculateFareBreakdownFromReais: jest.fn(() => ({
        operationalFee: 9.99,
        paymentIntermediationFee: 0.99,
        totalFees: 10.98,
        driverNetAmount: 7.42,
      })),
    };

    expect(
      resolveEstimatedFareSnapshot({
        payload: {
          estimatedOperationalFee: 2.4,
          estimatedPaymentIntermediationFee: 0.61,
          estimatedTotalFees: 3.01,
          estimatedDriverNetAmount: 15.39,
        },
        paymentService,
        estimatedFare: 18.4,
      }),
    ).toEqual({
      estimatedOperationalFee: 2.4,
      estimatedPaymentIntermediationFee: 0.61,
      estimatedTotalFees: 3.01,
      estimatedDriverNetAmount: 15.39,
    });
    expect(paymentService.calculateFareBreakdownFromReais).not.toHaveBeenCalled();
  });
});

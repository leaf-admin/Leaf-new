const ReceiptService = require('../../../services/receipt-service');

describe('ReceiptService financial snapshot', () => {
  it('preserves the final backend fee breakdown instead of recalculating it', () => {
    const service = new ReceiptService();
    service.paymentService.calculateFareBreakdownFromReais = jest.fn(() => ({
      operationalFee: 2.44,
      paymentIntermediationFee: 0.89,
      totalFees: 3.33,
      driverNetAmount: 77.84,
    }));

    const financial = service.calculateFinancialBreakdown({
      finalPrice: 81.17,
      operationalFee: 2.44,
      paymentIntermediationFee: 0.65,
      totalFees: 3.09,
      driverNetAmount: 78.08,
      fareBreakdown: {
        operationalFee: 2.44,
        paymentIntermediationFee: 0.65,
        totalFees: 3.09,
        driverNetAmount: 78.08,
      },
    });

    expect(financial.totalPaid.amount).toBeCloseTo(81.17, 2);
    expect(financial.breakdown.operationalCost.amount).toBeCloseTo(2.44, 2);
    expect(financial.breakdown.wooviFee.amount).toBeCloseTo(0.65, 2);
    expect(financial.breakdown.driverAmount.amount).toBeCloseTo(78.08, 2);
    expect(financial.totals.retainedFees).toBeCloseTo(3.09, 2);
  });
});

const {
  buildRideFinancialContract,
  resolveOperationalFee,
  resolvePaymentIntermediationFee
} = require('../../../services/ride-financial-contract');

describe('ride-financial-contract', () => {
  it.each([
    [850, 79, 'up_to_10'],
    [1000, 79, 'up_to_10'],
    [1001, 99, '10_to_25'],
    [2500, 99, '10_to_25'],
    [2501, 149, '25_to_50'],
    [5000, 149, '25_to_50'],
    [7500, 225, 'above_50_percent']
  ])('resolves operational fee for %s cents', (grossFareCents, expectedFee, expectedType) => {
    expect(resolveOperationalFee(grossFareCents)).toEqual({
      feeCents: expectedFee,
      feeType: expectedType
    });
  });

  it('applies minimum payment intermediation fee for regular low fares', () => {
    expect(resolvePaymentIntermediationFee(2500)).toBe(50);
  });

  it('keeps toll as pass-through and balances the full passenger payment', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 3250,
      tollFeeCents: 750
    });

    expect(contract).toMatchObject({
      passengerPaidCents: 3250,
      grossFareCents: 2500,
      tollFeeCents: 750,
      driverTollPassThroughCents: 750,
      leafOperationalFeeCents: 99,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 3101,
      retainedTotalCents: 149,
      allocatedTotalCents: 3250,
      balanced: true
    });
  });

  it('clamps fees instead of creating an unbalanced settlement for anomalous tiny fares', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 80,
      tollFeeCents: 0
    });

    expect(contract).toMatchObject({
      passengerPaidCents: 80,
      grossFareCents: 80,
      leafOperationalFeeCents: 79,
      paymentIntermediationFeeCents: 1,
      driverNetAmountCents: 0,
      allocatedTotalCents: 80,
      balanced: true
    });
    expect(contract.feePolicy.paymentIntermediationFeeClamped).toBe(true);
  });

  it('treats subscription retention as part of retained value without breaking balance', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 3000,
      tollFeeCents: 0,
      subscriptionRetainedFeeCents: 300
    });

    expect(contract.retainedTotalCents).toBe(
      contract.leafOperationalFeeCents + contract.paymentIntermediationFeeCents + 300
    );
    expect(contract.driverNetAmountCents + contract.retainedTotalCents).toBe(3000);
    expect(contract.balanced).toBe(true);
  });
});

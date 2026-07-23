const {
  buildAuthoritativeFinancialSnapshot,
  buildPaymentInclusiveCharge,
  buildRideFinancialContract,
  describeFinancialPolicy,
  resolveOperationalFee,
  resolvePaymentIntermediationFee,
  toCents,
  validateAuthoritativeFinancialSnapshot
} = require('../../../services/ride-financial-contract');

describe('ride-financial-contract', () => {
  it('describes the active financial policy with an explicit approval id', () => {
    expect(describeFinancialPolicy()).toMatchObject({
      policyId: 'runtime_tiered_percent_above_50_v1',
      currency: 'BRL',
      operationalFee: {
        upTo10Cents: 79,
        from10To25Cents: 99,
        from25To50Cents: 149,
        above50Model: 'percentage',
        above50Percentage: 0.03
      },
      paymentIntermediation: {
        percentage: 0.008,
        minimumCents: 50
      }
    });
  });

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

  it('grosses up an incremental charge to cover the new Pix processing fee', () => {
    expect(buildPaymentInclusiveCharge({
      baseAmountCents: 1123,
      operationalCostCents: 25
    })).toMatchObject({
      baseAmountCents: 1123,
      operationalCostCents: 25,
      paymentIntermediationFeeCents: 50,
      passengerChargeCents: 1198,
      netCoveredCents: 1148,
      roundingBufferCents: 0,
      balanced: true
    });
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

  it('exports toCents helper that returns non-negative integer', () => {
    expect(toCents(1000)).toBe(1000);
    expect(toCents(0)).toBe(0);
    expect(toCents(-100)).toBe(0);
    expect(toCents(99.7)).toBe(100);
    expect(toCents('abc')).toBe(0);
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
  });

  it('explicitly separates passenger gross amount from toll pass-through in high-fare rides', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 10000,
      tollFeeCents: 1500
    });

    expect(contract).toMatchObject({
      passengerPaidCents: 10000,
      grossFareCents: 8500,
      tollFeeCents: 1500,
      driverTollPassThroughCents: 1500
    });
    expect(contract.driverNetAmountCents + contract.retainedTotalCents).toBe(10000);
    expect(contract.balanced).toBe(true);
  });

  it('applies percentage-based operational fee for fares above R$ 50', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 10000,
      tollFeeCents: 0
    });

    expect(contract).toMatchObject({
      grossFareCents: 10000,
      leafOperationalFeeCents: 300,
      paymentIntermediationFeeCents: 80,
      driverNetAmountCents: 9620
    });
    expect(contract.feePolicy.operationalFeeType).toBe('above_50_percent');
    expect(contract.balanced).toBe(true);
  });

  it('clamps subscription retention to available remainder after fees and toll', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 5000,
      tollFeeCents: 1000,
      subscriptionRetainedFeeCents: 99999
    });

    expect(contract.subscriptionRetainedFeeCents).toBeLessThan(99999);
    expect(contract.feePolicy.subscriptionRetainedFeeClamped).toBe(true);
    expect(contract.driverNetAmountCents).toBe(0);
    expect(contract.balanced).toBe(true);
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

  it('builds an immutable backend-final snapshot that balances exactly in cents', () => {
    const snapshot = buildAuthoritativeFinancialSnapshot({
      passengerPaidCents: 3250,
      tollFeeCents: 750,
      operationalFeeCents: 99,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 3101
    });

    expect(snapshot).toMatchObject({
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 3250,
      grossFareCents: 2500,
      retainedTotalCents: 149,
      allocatedTotalCents: 3250,
      balanced: true
    });
  });

  it('rejects a backend-final snapshot that does not allocate the full passenger payment', () => {
    const result = validateAuthoritativeFinancialSnapshot({
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 3250,
      tollFeeCents: 750,
      operationalFeeCents: 99,
      paymentIntermediationFeeCents: 50,
      driverNetAmountCents: 3000
    });

    expect(result).toMatchObject({
      valid: false,
      code: 'FINANCIAL_SNAPSHOT_UNBALANCED'
    });
  });
});

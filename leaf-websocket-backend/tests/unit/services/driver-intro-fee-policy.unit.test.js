const {
  DRIVER_INTRO_FEE_POLICY,
  buildDriverIntroFeeContext
} = require('../../../services/driver-intro-fee-policy');
const {
  buildRideFinancialContract,
  buildAuthoritativeFinancialSnapshot,
  validateAuthoritativeFinancialSnapshot
} = require('../../../services/ride-financial-contract');

function context(count, extra = {}) {
  return buildDriverIntroFeeContext({
    driverId: 'driver-existing',
    qualifiedCompletedRides: count,
    historyVerified: true,
    historySnapshotId: 'verified-history-2026-10-22',
    ...extra
  });
}

describe('approved first 25 destination completions policy', () => {
  it.each([0, 1, 24])('grants the fixed Leaf fee with %i qualifying completions', (count) => {
    expect(context(count)).toMatchObject({
      policyId: DRIVER_INTRO_FEE_POLICY.policyId,
      driverId: 'driver-existing',
      qualifiedCompletedRides: count,
      eligible: true,
      operationalFeeCents: 99,
      historySnapshotId: 'verified-history-2026-10-22'
    });
  });

  it.each([25, 26, 1000])('returns to the existing table after %i completions', (count) => {
    expect(context(count)).toMatchObject({ eligible: false, operationalFeeCents: null });
  });

  it.each([-1, 0.5, '0', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid completion count (%s)', (count) => {
      expect(() => context(count)).toThrow();
    }
  );

  it.each([
    { historyVerified: false },
    { historyVerified: 'true' },
    { historySnapshotId: '' },
    { driverId: '' }
  ])('does not interpret missing history or identity as zero rides: %p', (extra) => {
    expect(() => context(0, extra)).toThrow();
  });

  it.each([850, 1000, 1001, 2500, 2501, 5000, 7500, 10000])(
    'charges 99 cents plus the unchanged Pix fee on a %i-cent ride', (fare) => {
      const base = buildRideFinancialContract({ passengerPaidCents: fare });
      const promoted = buildRideFinancialContract({ passengerPaidCents: fare, driverIntroFee: context(24) });
      expect(promoted.leafOperationalFeeCents).toBe(99);
      expect(promoted.paymentIntermediationFeeCents).toBe(base.paymentIntermediationFeeCents);
      expect(promoted.driverNetAmountCents).toBe(fare - 99 - base.paymentIntermediationFeeCents);
      expect(promoted.balanced).toBe(true);
      expect(promoted.feePolicy.driverIntroFee).toEqual(context(24));
    }
  );

  it.each([[850, 79], [2000, 99], [4000, 149], [7500, 225]])(
    'uses the current table for the 26th ride (%i cents)', (fare, expectedFee) => {
      const contract = buildRideFinancialContract({ passengerPaidCents: fare, driverIntroFee: context(25) });
      expect(contract.leafOperationalFeeCents).toBe(expectedFee);
    }
  );

  it('keeps a previously resolved context independent of the next completion', () => {
    const acceptedContext = context(24);
    context(25);
    expect(Object.isFrozen(acceptedContext)).toBe(true);
    expect(buildRideFinancialContract({ passengerPaidCents: 7500, driverIntroFee: acceptedContext }))
      .toMatchObject({ leafOperationalFeeCents: 99, driverNetAmountCents: 7341 });
  });

  it('preserves the accepted policy through serialization and final snapshot validation', () => {
    const driverIntroFee = JSON.parse(JSON.stringify(context(24)));
    const snapshot = buildAuthoritativeFinancialSnapshot({
      passengerPaidCents: 7500,
      operationalFeeCents: 99,
      paymentIntermediationFeeCents: 60,
      driverNetAmountCents: 7341,
      driverIntroFee
    });
    expect(validateAuthoritativeFinancialSnapshot(JSON.parse(JSON.stringify(snapshot))))
      .toMatchObject({ valid: true, snapshot: { driverIntroFee: context(24) } });
    expect(validateAuthoritativeFinancialSnapshot(snapshot, { driverId: 'driver-other' }))
      .toMatchObject({ valid: false, code: 'DRIVER_INTRO_FEE_DRIVER_MISMATCH' });
  });

  it('rejects a balanced final snapshot with a different fee than the accepted promotion', () => {
    expect(validateAuthoritativeFinancialSnapshot({
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 7500,
      operationalFeeCents: 225,
      paymentIntermediationFeeCents: 60,
      driverNetAmountCents: 7215,
      driverIntroFee: context(24)
    })).toMatchObject({ valid: false, code: 'DRIVER_INTRO_FEE_SNAPSHOT_MISMATCH' });
  });

  it('preserves toll pass-through and subscription retention', () => {
    expect(buildRideFinancialContract({
      passengerPaidCents: 10000,
      tollFeeCents: 2000,
      subscriptionRetainedFeeCents: 300,
      driverIntroFee: context(0)
    })).toMatchObject({
      passengerPaidCents: 10000,
      driverTollPassThroughCents: 2000,
      leafOperationalFeeCents: 99,
      paymentIntermediationFeeCents: 80,
      subscriptionRetainedFeeCents: 300,
      driverNetAmountCents: 9521,
      balanced: true
    });
  });

  it('preserves existing clamps for a fare smaller than the approved fee', () => {
    expect(buildRideFinancialContract({ passengerPaidCents: 80, driverIntroFee: context(0) }))
      .toMatchObject({ leafOperationalFeeCents: 80, paymentIntermediationFeeCents: 0, driverNetAmountCents: 0, balanced: true });
  });

  it('rejects an unknown policy instead of applying a free-form fee override', () => {
    expect(() => buildRideFinancialContract({
      passengerPaidCents: 7500,
      driverIntroFee: { ...context(0), policyId: 'custom', operationalFeeCents: 0 }
    })).toThrow();
  });

  it('derives eligibility and the fee from the count rather than trusting supplied values', () => {
    const contract = buildRideFinancialContract({
      passengerPaidCents: 7500,
      driverIntroFee: { ...context(25), eligible: true, operationalFeeCents: 0 }
    });
    expect(contract.leafOperationalFeeCents).toBe(225);
    expect(contract.feePolicy.driverIntroFee).toMatchObject({ eligible: false, operationalFeeCents: null });
  });
});

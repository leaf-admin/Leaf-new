const {
  DRIVER_INTRO_FEE_POLICY,
  buildDriverIntroFeeContext,
  normalizeDriverIntroFeeContext
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
      paymentFeeIncluded: true,
      pixExcessChargedToDriver: true,
      leafFeeCents: 49,
      historySnapshotId: 'verified-history-2026-10-22'
    });
  });

  it.each([25, 26, 1000])('returns to the existing table after %i completions', (count) => {
    expect(context(count)).toMatchObject({ eligible: false, operationalFeeCents: null, leafFeeCents: null });
  });

  it.each([0, 25, 1000])('grants every ride offered until 30/11 in Brasília with %i completions', (count) => {
    expect(context(count, { offeredAt: '2026-12-01T02:59:59.999Z' })).toMatchObject({
      eligible: true,
      operationalFeeCents: 99,
      leafFeeCents: 49,
      offeredAt: '2026-12-01T02:59:59.999Z',
      eligibleUntil: '2026-12-01T03:00:00.000Z'
    });
  });

  it('returns to the existing table for a ride offered from 01/12 in Brasília', () => {
    expect(context(0, { offeredAt: '2026-12-01T03:00:00.000Z' }))
      .toMatchObject({ eligible: false, operationalFeeCents: null, leafFeeCents: null });
  });

  it.each(['not-a-date', 123, {}])('rejects an unreadable offer time %p', (offeredAt) => {
    expect(() => context(0, { offeredAt })).toThrow('DRIVER_INTRO_FEE_CONTEXT_INVALID');
  });

  it('settles a stored date context by its offer time, not the settlement time', () => {
    const stored = JSON.parse(JSON.stringify(context(30, { offeredAt: '2026-11-30T23:00:00.000Z' })));
    expect(normalizeDriverIntroFeeContext(stored)).toMatchObject({ eligible: true, operationalFeeCents: 99, qualifiedCompletedRides: 30 });
    const legacy = JSON.parse(JSON.stringify(context(30)));
    expect(normalizeDriverIntroFeeContext(legacy)).toMatchObject({ eligible: false, operationalFeeCents: null });
    expect(legacy).not.toHaveProperty('offeredAt');
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
    'keeps 49 cents for Leaf and charges the real Pix on a %i-cent ride', (fare) => {
      const base = buildRideFinancialContract({ passengerPaidCents: fare });
      const promoted = buildRideFinancialContract({ passengerPaidCents: fare, driverIntroFee: context(24) });
      expect(promoted.leafOperationalFeeCents).toBe(49);
      expect(promoted.paymentIntermediationFeeCents).toBe(base.paymentIntermediationFeeCents);
      expect(promoted.driverNetAmountCents).toBe(fare - 49 - base.paymentIntermediationFeeCents);
      expect(promoted.feePolicy.paymentIntermediationFeeClamped).toBe(false);
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
      .toMatchObject({ leafOperationalFeeCents: 49, paymentIntermediationFeeCents: 60, driverNetAmountCents: 7391 });
  });

  it('preserves the accepted policy through serialization and final snapshot validation', () => {
    const driverIntroFee = JSON.parse(JSON.stringify(context(24)));
    const snapshot = buildAuthoritativeFinancialSnapshot({
      passengerPaidCents: 7500,
      operationalFeeCents: 49,
      paymentIntermediationFeeCents: 60,
      driverNetAmountCents: 7391,
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
      leafOperationalFeeCents: 49,
      paymentIntermediationFeeCents: 80,
      subscriptionRetainedFeeCents: 300,
      driverNetAmountCents: 9571,
      balanced: true
    });
  });

  it('preserves existing clamps for a fare smaller than the approved fee', () => {
    expect(buildRideFinancialContract({ passengerPaidCents: 80, driverIntroFee: context(0) }))
      .toMatchObject({ leafOperationalFeeCents: 30, paymentIntermediationFeeCents: 50, driverNetAmountCents: 0, balanced: true });
  });

  it('keeps the whole promotional fee at R$ 0,99 while the Pix stays at its minimum', () => {
    expect(buildRideFinancialContract({ passengerPaidCents: 3000, driverIntroFee: context(0) }))
      .toMatchObject({ leafOperationalFeeCents: 49, paymentIntermediationFeeCents: 50, retainedTotalCents: 99, driverNetAmountCents: 2901, balanced: true });
  });

  it.each([[6250, 50, 99], [6300, 50, 99], [8000, 64, 113], [10000, 80, 129], [20000, 160, 209]])(
    'charges the Pix above its minimum to the driver on a %i-cent ride', (fare, pix, total) => {
      const contract = buildRideFinancialContract({ passengerPaidCents: fare, driverIntroFee: context(0) });
      expect(contract).toMatchObject({
        leafOperationalFeeCents: 49,
        paymentIntermediationFeeCents: pix,
        retainedTotalCents: total,
        driverNetAmountCents: fare - total,
        balanced: true
      });
      expect(contract.feePolicy).toMatchObject({ paymentIntermediationFeeClamped: false, operationalFeeClamped: false });
    }
  );

  it('charges the Pix on the toll to the driver too', () => {
    expect(buildRideFinancialContract({ passengerPaidCents: 10000, tollFeeCents: 2000, driverIntroFee: context(0) }))
      .toMatchObject({ leafOperationalFeeCents: 49, paymentIntermediationFeeCents: 80, driverTollPassThroughCents: 2000, driverNetAmountCents: 9871, balanced: true });
  });

  it('honors the fixed-total terms of a ride accepted on 2026-10-31 terms', () => {
    const { pixExcessChargedToDriver, leafFeeCents, ...accepted } = context(0);
    const driverIntroFee = JSON.parse(JSON.stringify(accepted));
    const contract = buildRideFinancialContract({ passengerPaidCents: 20000, driverIntroFee });
    expect(contract).toMatchObject({ leafOperationalFeeCents: 0, paymentIntermediationFeeCents: 99, driverNetAmountCents: 19901, balanced: true });
    expect(contract.feePolicy).toMatchObject({ requestedPaymentIntermediationFeeCents: 160, paymentIntermediationFeeClamped: true });
    const snapshot = buildAuthoritativeFinancialSnapshot({
      passengerPaidCents: 7500,
      operationalFeeCents: 39,
      paymentIntermediationFeeCents: 60,
      driverNetAmountCents: 7401,
      driverIntroFee
    });
    expect(validateAuthoritativeFinancialSnapshot(snapshot)).toMatchObject({ valid: true });
  });

  it('rejects a final snapshot that absorbs Pix under the current terms', () => {
    expect(validateAuthoritativeFinancialSnapshot({
      authoritativeSnapshot: true,
      financialSnapshotSource: 'backend_final',
      passengerPaidCents: 10000,
      operationalFeeCents: 19,
      paymentIntermediationFeeCents: 80,
      driverNetAmountCents: 9901,
      driverIntroFee: context(0)
    })).toMatchObject({ valid: false, code: 'DRIVER_INTRO_FEE_SNAPSHOT_MISMATCH' });
  });

  it('honors the Pix-separate terms of a ride accepted before the change', () => {
    const { paymentFeeIncluded, ...accepted } = context(24);
    const driverIntroFee = JSON.parse(JSON.stringify(accepted));
    expect(buildRideFinancialContract({ passengerPaidCents: 7500, driverIntroFee }))
      .toMatchObject({ leafOperationalFeeCents: 99, paymentIntermediationFeeCents: 60, driverNetAmountCents: 7341, balanced: true });
    const snapshot = buildAuthoritativeFinancialSnapshot({
      passengerPaidCents: 7500,
      operationalFeeCents: 99,
      paymentIntermediationFeeCents: 60,
      driverNetAmountCents: 7341,
      driverIntroFee
    });
    expect(validateAuthoritativeFinancialSnapshot(snapshot)).toMatchObject({ valid: true });
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

const { buildSeedState, mergeCheckpoint, normalizeState } = require('../../../services/driver-intro-fee-state');
const { assessDestinationCompletion } = require('../../../utils/driver-intro-fee-completion');

const seed = (count = 0) => buildSeedState({ driverId: 'driver-1', qualifiedCompletedRides: count, historySnapshotId: 'verified-seed', historyThrough: '2026-10-22T00:00:00.000Z' });
const checkpoint = (ids, baseline = 0) => ({ ...seed(baseline), completedBookingIds: ids, qualifiedCompletedRides: Math.min(25, baseline + ids.length) });

describe('bounded, durable introductory fee state', () => {
  it('saturates existing history above 25 without resetting eligibility', () => {
    expect(seed(54)).toMatchObject({ baselineCount: 25, qualifiedCompletedRides: 25, eligible: false, completedBookingIds: [] });
  });
  it('deduplicates retries and out-of-order checkpoints', () => {
    const newer = checkpoint(['ride-a', 'ride-b']);
    expect(mergeCheckpoint(newer, checkpoint(['ride-a']))).toEqual(newer);
    expect(mergeCheckpoint(checkpoint(['ride-a']), checkpoint(['ride-b']))).toMatchObject({ qualifiedCompletedRides: 2, completedBookingIds: ['ride-a', 'ride-b'] });
  });
  it('caps state at the 25th completion and derives ineligibility', () => {
    expect(mergeCheckpoint(checkpoint([], 24), checkpoint(['ride-25'], 24)))
      .toMatchObject({ qualifiedCompletedRides: 25, eligible: false, operationalFeeCents: null });
  });
  it('does not persist a Redis lease or its runtime generation', () => {
    const merged = mergeCheckpoint(seed(), { ...checkpoint(['ride-a']), inflightBookingId: 'ride-b', generation: 'generation-1' });
    expect(merged).not.toHaveProperty('inflightBookingId');
    expect(merged).not.toHaveProperty('generation');
  });
  it('preserves a pending review when an older checkpoint arrives', () => {
    expect(mergeCheckpoint({ ...seed(), reviewRequiredBookingId: 'unverified-ride' }, seed()))
      .toMatchObject({ reviewRequiredBookingId: 'unverified-ride' });
  });
  it.each([
    { historySnapshotId: 'other-history' }, { driverId: 'other-driver' },
    { approvedGeneration: 'other-generation' }, { historyThrough: '2026-10-21T00:00:00Z' }
  ])('refuses incompatible checkpoint %p', (change) => {
    expect(() => mergeCheckpoint(seed(), { ...seed(), ...change })).toThrow('CHECKPOINT_CONFLICT');
  });
  it.each([
    { baselineCount: -1 }, { qualifiedCompletedRides: 1 }, { historyVerified: false },
    { completedBookingIds: ['duplicate', 'duplicate'], qualifiedCompletedRides: 2 },
    { completedBookingIds: {} }, { historyThrough: 'unknown' }, { namespace: 'sandbox' }
  ])('refuses invalid stored state %p', (change) => {
    expect(() => normalizeState({ ...seed(), ...change })).toThrow();
  });
});

describe('destination completion evidence', () => {
  const nowMs = Date.parse('2026-10-22T12:00:00Z');
  const destination = { lat: -22.9, lng: -43.2 };
  const booking = { destinationLocation: JSON.stringify(destination) };
  const metrics = { success: true, endLocation: destination, lastReceivedAtMs: nowMs };
  it('counts fresh canonical server telemetry near the destination', () => {
    expect(assessDestinationCompletion({ booking, metrics, nowMs })).toMatchObject({ qualified: true, reviewRequired: false });
  });
  it('does not count a server position away from the destination', () => {
    expect(assessDestinationCompletion({ booking, metrics: { ...metrics, endLocation: { lat: -23, lng: -43.2 } }, nowMs }))
      .toMatchObject({ qualified: false, reviewRequired: false, reason: 'EARLY_END' });
  });
  it.each([null, { success: false }, { ...metrics, lastReceivedAtMs: nowMs - 121000 }, { ...metrics, lastReceivedAtMs: nowMs + 6000 }, { ...metrics, endLocation: { lat: null, lng: -43.2 } }])
    ('requires review for missing/stale canonical evidence (%p)', (candidate) => {
      expect(assessDestinationCompletion({ booking: { ...booking, endLocation: destination }, metrics: candidate, nowMs }))
        .toMatchObject({ qualified: false, reviewRequired: true });
    });
  it('excludes early ending even if client endLocation claims the destination', () => {
    expect(assessDestinationCompletion({ booking, metrics, earlyEnd: { applied: true }, nowMs }))
      .toMatchObject({ qualified: false, reviewRequired: false });
  });
});

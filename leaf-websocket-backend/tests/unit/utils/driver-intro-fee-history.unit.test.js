const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { auditDriverIntroFeeHistory, classifyHistoricalRide } = require('../../../utils/driver-intro-fee-history');

const destination = { lat: -22.9, lng: -43.2 };
const endLocation = { lat: -22.9001, lng: -43.2001 };
function ride(bookingId = 'ride-1', extra = {}) {
  return {
    bookingId,
    driverId: 'driver-existing',
    status: 'COMPLETED',
    destinationLocation: destination,
    endLocation,
    completedAt: '2026-10-21T12:00:00Z',
    ...extra
  };
}
function input(rides = [], driver = {}) {
  return {
    schemaVersion: 1,
    exportedThrough: '2026-10-22T12:00:00Z',
    drivers: [{ driverId: 'driver-existing', registeredAt: '2026-01-01T00:00:00Z', historyCompleteFromRegistration: true, ...driver }],
    rides
  };
}
function audit(rides, driver) {
  return auditDriverIntroFeeHistory(input(rides, driver)).drivers[0];
}

describe('offline reconciliation of driver introductory fee history', () => {
  it.each([[0, true], [24, true], [25, false], [26, false]])(
    'deduplicates and counts %i destination candidates without resetting old drivers', (count, eligibleCandidate) => {
      const history = Array.from({ length: count }, (_, index) => ride(`ride-${index}`));
      expect(audit([...history, ...history])).toMatchObject({
        destinationCandidateCount: count,
        duplicateSnapshotCount: count,
        eligibleCandidate
      });
    }
  );

  it.each(['CANCELLED', 'CANCELED', 'EARLY_ENDED_BY_RIDER', 'EARLY_ENDED_BY_DRIVER', 'EARLY_ENDED_REVIEW', 'INTERRUPTED_OPERATIONAL_ENDED'])
    ('does not count %s', (status) => {
      expect(audit([ride('ride-1', { status })])).toMatchObject({ destinationCandidateCount: 0, unresolved: [] });
    });

  it.each([
    { settlement: { settlementType: 'EARLY_ENDED_BY_DRIVER' } },
    { settlement: JSON.stringify({ settlementType: 'EARLY_ENDED_BY_RIDER' }) },
    { earlyEndSettlement: { settlementType: 'INTERRUPTED_OPERATIONAL' } },
    { completionType: 'EARLY_ENDED_REVIEW' },
    { earlyEnd: JSON.stringify({ detected: true }) },
    { driverEarlyEndSkipped: { reason: 'SETTLEMENT_ERROR', remainingMeters: 2000 } },
    { endLocation: { lat: -23, lng: -43.2 } }
  ])('excludes early endings even when the stored status is COMPLETED: %p', (extra) => {
    expect(audit([ride('ride-1', extra)])).toMatchObject({
      destinationCandidateCount: 0,
      excluded: [expect.objectContaining({ bookingId: 'ride-1' })]
    });
  });

  it.each([
    { endLocation: null },
    { endLocation: { lat: null, lng: -43.2 } },
    { endLocation: { lat: '', lng: -43.2 } },
    { destinationLocation: { lat: 200, lng: -43.2 } },
    { destinationLocation: 'broken-json' },
    { completedAt: null },
    { completedAt: '2025-12-31T23:59:59Z' },
    { completedAt: '2026-10-23T00:00:00Z' },
    { status: 'legacy-unknown' }
  ])('leaves insufficient or invalid evidence unresolved: %p', (extra) => {
    expect(audit([ride('ride-1', extra)])).toMatchObject({
      destinationCandidateCount: 0,
      eligibleCandidate: null,
      unresolved: [expect.objectContaining({ bookingId: 'ride-1' })]
    });
  });

  it('requires declared lifetime coverage even for a newly registered driver with no rides', () => {
    expect(audit([], { historyCompleteFromRegistration: false }))
      .toMatchObject({ destinationCandidateCount: 0, eligibleCandidate: null });
    expect(audit([], { registeredAt: null })).toMatchObject({ eligibleCandidate: null });
  });

  it('reports incomplete coverage even with more than 25 candidate rides', () => {
    expect(audit(Array.from({ length: 26 }, (_, index) => ride(`ride-${index}`)), { historyCompleteFromRegistration: false }))
      .toMatchObject({ destinationCandidateCount: 26, eligibleCandidate: null });
  });

  it('does not silently choose one of conflicting snapshots', () => {
    expect(audit([ride(), ride('ride-1', { status: 'CANCELLED' })])).toMatchObject({
      destinationCandidateCount: 0,
      unresolved: [{ bookingId: 'ride-1', reason: 'CONFLICTING_SNAPSHOTS' }],
      eligibleCandidate: null
    });
  });

  it('leaves reassigned driver snapshots for reconciliation rather than counting both drivers', () => {
    const history = input([ride(), ride('ride-1', { driverId: 'driver-other' })]);
    history.drivers.push({ ...history.drivers[0], driverId: 'driver-other' });
    for (const driver of auditDriverIntroFeeHistory(history).drivers) {
      expect(driver).toMatchObject({ destinationCandidateCount: 0, eligibleCandidate: null });
      expect(driver.unresolved).toContainEqual({ bookingId: 'ride-1', reason: 'CONFLICTING_DRIVER' });
    }
  });

  it.each([
    { financialNamespace: 'sandbox' },
    { providerEnvironment: 'sandbox' },
    { paymentProviderEnvironment: 'sandbox' },
    { financialContext: JSON.stringify({ namespace: 'sandbox' }) },
    { testUserSandbox: true },
    { financialNamespace: 'operational', financialContext: { namespace: 'sandbox' } }
  ])('does not consume the real promotion for sandbox rides: %p', (extra) => {
    expect(classifyHistoricalRide(ride('sandbox-ride', extra))).toEqual({ classification: 'excluded', reason: 'SANDBOX' });
  });

  it('handles Firestore timestamp exports and JSON coordinates', () => {
    expect(audit([ride('ride-1', {
      completedAt: { _seconds: Date.parse('2026-10-21T12:00:00Z') / 1000 },
      endLocation: JSON.stringify(endLocation),
      destinationLocation: JSON.stringify(destination)
    })])).toMatchObject({ destinationCandidateCount: 1 });
  });

  it('does not confuse a toll-only refund with an early ending', () => {
    expect(audit([ride('ride-1', { tollAdjustment: { type: 'TOLL_NOT_CROSSED' } })]))
      .toMatchObject({ destinationCandidateCount: 1 });
  });

  it('reports missing booking IDs and orphan driver snapshots', () => {
    expect(audit([ride(null)])).toMatchObject({ eligibleCandidate: null, unresolved: [{ bookingId: null, reason: 'MISSING_BOOKING_ID' }] });
    expect(auditDriverIntroFeeHistory(input([ride('ride-1', { driverId: 'missing-driver' })])))
      .toMatchObject({ orphanSnapshotCount: 1, drivers: [expect.objectContaining({ eligibleCandidate: null })] });
  });

  it('always requires human verification and never emits an activation context', () => {
    const report = auditDriverIntroFeeHistory(input([ride()]));
    expect(report).toMatchObject({ requiresHumanVerification: true, mode: 'offline_reconciliation_only', arrivalThresholdMeters: 500 });
    expect(report.drivers[0]).not.toHaveProperty('historyVerified');
    expect(report.drivers[0]).not.toHaveProperty('driverIntroFee');
  });

  it('rejects malformed or ambiguous manifests', () => {
    expect(() => auditDriverIntroFeeHistory({})).toThrow();
    expect(() => auditDriverIntroFeeHistory({ ...input(), exportedThrough: null })).toThrow();
    const history = input();
    history.drivers.push(history.drivers[0]);
    expect(() => auditDriverIntroFeeHistory(history)).toThrow();
  });

  it('runs the offline CLI without changing the input and fingerprints the export', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-intro-fee-'));
    try {
      const source = path.join(directory, 'synthetic-history.json');
      const serialized = JSON.stringify(input([ride()]));
      fs.writeFileSync(source, serialized);
      const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../../scripts/audit-driver-intro-fee-history.cjs'), source], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({ inputSha256: expect.stringMatching(/^[a-f0-9]{64}$/), requiresHumanVerification: true });
      expect(fs.readFileSync(source, 'utf8')).toBe(serialized);
      const invalid = spawnSync(process.execPath, [path.resolve(__dirname, '../../../scripts/audit-driver-intro-fee-history.cjs'), '--apply'], { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toBe('');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

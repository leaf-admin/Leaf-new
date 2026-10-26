const summary = require('../../../services/metrics-projection-summary');
const store = require('../../../services/metrics-projection-store');
const ride = { createdAt: new Date('2026-10-26T02:59:59Z'), status: 'COMPLETED', driverId: 'driver',
  finalPrice: 81.17, driverNetAmount: 78.42, authoritativeSnapshot: true, financialSnapshotSource: 'backend_final' };

describe('canonical analytics contributions', () => {
  test('São Paulo day is independent of the host timezone', () => {
    expect(summary.contribution('rides/a', ride).day).toBe('2026-10-25');
    expect(summary.dayKey('2026-10-26T03:00:00Z')).toBe('2026-10-26');
    const window = summary.calendarWindow('custom', '2026-10-01', '2026-10-31');
    expect(window.start.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-11-01T02:59:59.999Z');
    expect(() => summary.calendarWindow('custom', '2026-09-01', '2026-10-31')).toThrow();
  });

  test('correction reverses the previous contribution before adding the new one', () => {
    const before = summary.contribution('rides/a', ride);
    const after = summary.contribution('rides/a', { ...ride, finalPrice: 55 });
    const result = summary.mergeMetrics(summary.mergeMetrics(before.metrics, before.metrics, -1), after.metrics);
    expect(result.requests).toBe(1); expect(result.revenueUnits).toBe(55000000);
    expect(() => summary.mergeMetrics({}, before.metrics, -1)).toThrow('parity');
  });

  test('unreconciled ride never contributes estimated revenue or known earnings', () => {
    const result = summary.contribution('rides/a', { ...ride, authoritativeSnapshot: false });
    expect(result.metrics.completed).toBe(1); expect(result.metrics.reconciled).toBe(0);
    expect(result.metrics.revenueUnits).toBe(0);
    expect(result.driver).toMatchObject({ pendingFinancialTrips: 1, driverNetMinor: 0 });
  });

  test('sandbox has a context-specific key and cannot enter operational namespace', () => {
    expect(() => summary.contribution('sandbox_rides/a', ride)).toThrow('context');
    const a = summary.contribution('sandbox_rides/a', { ...ride, financialContextId: 'qa-a' });
    const b = summary.contribution('sandbox_rides/a', { ...ride, financialContextId: 'qa-b' });
    expect(summary.bucketId(a)).not.toBe(summary.bucketId(b));
    expect(() => summary.contribution('rides/a', { ...ride, financialNamespace: 'sandbox' })).toThrow('namespace');
  });

  test('distribution uses its own canonical amount in cents', () => {
    expect(summary.contribution('payment_distributions/a', { createdAt: ride.createdAt,
      retainedFees: { operationalFee: 99 }, calculation: { operationalFee: 149 } }).metrics.feeUnits).toBe(990000);
  });

  test('disabled writer preserves the existing call without creating work', async () => {
    const prior = process.env.ENABLE_OPS_METRIC_WRITES; delete process.env.ENABLE_OPS_METRIC_WRITES;
    try {
      const ref = { update: jest.fn().mockResolvedValue('stored') };
      const firestore = { batch: jest.fn() };
      await expect(store.write(firestore, ref, ride, { method: 'update' })).resolves.toBe('stored');
      expect(ref.update).toHaveBeenCalledWith(ride); expect(firestore.batch).not.toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.ENABLE_OPS_METRIC_WRITES; else process.env.ENABLE_OPS_METRIC_WRITES = prior;
    }
  });
});

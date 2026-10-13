const {
  buildRuntimeHistorySeries,
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripDisplayAmount,
  resolveTripDisplayLabel,
  resolveTripNetAmount,
} = require('../src/screens/prototype/tripFinancialSummary');

describe('trip financial summary', () => {
  it('formats brazilian currency with thousand separators', () => {
    expect(formatCurrencyBRL(1234.5)).toBe('R$ 1.234,50');
    expect(formatCurrencyBRL(15.01)).toBe('R$ 15,01');
  });

  it('resolves driver totals from net snapshot fields while preserving gross and fees', () => {
    const summary = buildTripFinancialTotals(
      [
        {
          id: 'trip_1',
          fare: 16.5,
          driverNetAmount: 15.01,
          totalFees: 1.49,
        },
        {
          id: 'trip_2',
          fare: 21.3,
          driverNetAmount: 19.1,
          totalFees: 2.2,
        },
      ],
      { role: 'driver' },
    );

    expect(summary.count).toBe(2);
    expect(summary.totalGross).toBeCloseTo(37.8, 2);
    expect(summary.totalNet).toBeCloseTo(34.11, 2);
    expect(summary.totalFees).toBeCloseTo(3.69, 2);
  });

  it('keeps passenger display values on gross and driver display values on net', () => {
    const trip = {
      fare: 16.5,
      driverNetAmount: 15.01,
      totalFees: 1.49,
    };

    expect(resolveTripDisplayAmount(trip, { role: 'driver' })).toBeCloseTo(15.01, 2);
    expect(resolveTripDisplayAmount(trip, { role: 'passenger' })).toBeCloseTo(16.5, 2);
  });

  it('keeps unknown driver net separate from a confirmed zero', () => {
    const trip = {
      fare: 16.5,
      grossFare: 16.5,
    };

    expect(resolveTripNetAmount(trip)).toBe(0);
    expect(resolveTripDisplayAmount(trip, { role: 'driver' })).toBeNull();
    expect(resolveTripDisplayLabel(trip, { role: 'driver' })).toBe('--');
    expect(resolveTripDisplayAmount(trip, { role: 'passenger' })).toBeCloseTo(16.5, 2);
  });

  it('shows an explicit zero net as zero and tracks incomplete totals', () => {
    const explicitZero = {
      grossAmount: 25,
      driverNetAmount: 0,
      totalFees: 25,
    };
    const summary = buildTripFinancialTotals([
      explicitZero,
      { grossAmount: 25 },
    ], { role: 'driver' });

    expect(resolveTripDisplayAmount(explicitZero, { role: 'driver' })).toBe(0);
    expect(resolveTripDisplayLabel(explicitZero, { role: 'driver' })).toBe('R$ 0,00');
    expect(summary.netKnownCount).toBe(1);
    expect(summary.count).toBe(2);
  });

  it('groups runtime history by completion day for earnings charts', () => {
    const series = buildRuntimeHistorySeries([
      {
        id: 'trip_1',
        completedAt: '2026-04-03T10:00:00.000Z',
        fare: 16.5,
        driverNetAmount: 15.01,
        totalFees: 1.49,
      },
      {
        id: 'trip_2',
        completedAt: '2026-04-03T14:00:00.000Z',
        fare: 20,
        driverNetAmount: 18,
        totalFees: 2,
      },
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].completedCount).toBe(2);
    expect(series[0].grossAmount).toBeCloseTo(36.5, 2);
    expect(series[0].netAmount).toBeCloseTo(33.01, 2);
    expect(series[0].feeAmount).toBeCloseTo(3.49, 2);
  });

  it('keeps a daily repasse unknown when one completed trip has no net evidence', () => {
    const series = buildRuntimeHistorySeries([
      {
        id: 'trip_with_net',
        completedAt: '2026-04-03T10:00:00.000Z',
        grossAmount: 25,
        driverNetAmount: 21.34,
        totalFees: 3.66,
      },
      {
        id: 'trip_without_net',
        completedAt: '2026-04-03T14:00:00.000Z',
        grossAmount: 20,
      },
    ]);

    expect(series).toHaveLength(1);
    expect(series[0].completedCount).toBe(2);
    expect(series[0].grossAmount).toBe(45);
    expect(series[0].netAmount).toBeNull();
    expect(series[0].feeAmount).toBeNull();
  });
});

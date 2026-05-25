const {
  buildRuntimeHistorySeries,
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripDisplayAmount,
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
});

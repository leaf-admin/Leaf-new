const { getPeakHours } = require('../../../services/dashboard/reportMetrics');

describe('dashboard report metrics', () => {
  it('returns every hour tied for peak when there are no trips', () => {
    expect(getPeakHours([])).toHaveLength(24);
    expect(getPeakHours([])).toEqual(expect.arrayContaining(['0:00', '23:00']));
  });

  it('returns all tied peak hours using the legacy report contract', () => {
    const bookings = [
      { tripdate: new Date(2026, 4, 29, 8, 10) },
      { tripdate: new Date(2026, 4, 29, 8, 40) },
      { tripdate: new Date(2026, 4, 29, 17, 20) },
      { tripdate: new Date(2026, 4, 29, 17, 45) },
      { tripdate: new Date(2026, 4, 29, 20, 0) },
    ];

    expect(getPeakHours(bookings)).toEqual(['8:00', '17:00']);
  });
});

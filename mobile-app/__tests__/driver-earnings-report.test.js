import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../src/services/DriverBalanceService', () => ({
  __esModule: true,
  default: { getAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer test' })) },
}));

const {
  buildDriverHistoryStats,
  fetchDriverEarningsReport,
  getCachedDriverEarningsReport,
  resetDriverEarningsReportCache,
  resolveServerPeriodEarnings,
  resolveServerTodayEarnings,
  selectDriverTodayEarnings,
  toLocalDateKey,
  useDriverEarningsReport,
} = require('../src/screens/prototype/driverEarningsReport');

const NOW = new Date(2026, 9, 12, 15, 30);
const TODAY = toLocalDateKey(NOW);

function buildReport(overrides = {}) {
  return {
    tripsToday: 11,
    dailySeries: [
      { date: '2026-10-11', amount: 120, grossAmount: 140, feeAmount: 20, completedCount: 4 },
      { date: TODAY, amount: 461.52, grossAmount: 520.1, feeAmount: 58.58, completedCount: 11 },
    ],
    totalCompletedRides: 37,
    totalNetAmount: 1480.9,
    dailySeriesWindowDays: 30,
    ...overrides,
  };
}

function mockFetchReport(report) {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ success: true, report }),
  });
}

describe('driver earnings report', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetDriverEarningsReportCache();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("reads today's net, gross, fees and ride count from the server day slot", () => {
    expect(resolveServerTodayEarnings(buildReport(), NOW)).toEqual({
      dateKey: TODAY,
      net: 461.52,
      gross: 520.1,
      fees: 58.58,
      count: 11,
    });
  });

  it('has no server value for today when the report lacks the current day', () => {
    expect(resolveServerTodayEarnings(null, NOW)).toBeNull();
    expect(resolveServerTodayEarnings({ dailySeries: [] }, NOW)).toBeNull();
    const yesterdayReport = buildReport({
      dailySeries: [{ date: '2026-10-11', amount: 120, completedCount: 4 }],
    });
    expect(resolveServerTodayEarnings(yesterdayReport, NOW)).toBeNull();
  });

  it('prefers the server value over the receipts stored on the phone', () => {
    const summary = selectDriverTodayEarnings({
      report: buildReport(),
      localTotals: { totalNet: 418.41, totalGross: 470, totalFees: 51.59, count: 10 },
      now: NOW,
    });
    expect(summary).toMatchObject({ source: 'server', net: 461.52, count: 11 });
  });

  it("falls back to the local sum of today's receipts without a server value", () => {
    const summary = selectDriverTodayEarnings({
      report: null,
      localTotals: { totalNet: 76.9, totalGross: 90, totalFees: 13.1, count: 2 },
      now: NOW,
    });
    expect(summary).toEqual({
      source: 'local',
      dateKey: TODAY,
      net: 76.9,
      gross: 90,
      fees: 13.1,
      count: 2,
    });
  });

  it('never lowers the fallback total because a receipt fell out of the stored list', () => {
    const before = selectDriverTodayEarnings({
      report: null,
      localTotals: { totalNet: 423.02, totalGross: 470, totalFees: 46.98, count: 12 },
      now: NOW,
    });
    const after = selectDriverTodayEarnings({
      report: null,
      localTotals: { totalNet: 418.41, totalGross: 465, totalFees: 46.59, count: 12 },
      previousFallback: before,
      now: NOW,
    });
    expect(after.net).toBe(423.02);

    const nextDay = selectDriverTodayEarnings({
      report: null,
      localTotals: { totalNet: 38.5, totalGross: 44, totalFees: 5.5, count: 1 },
      previousFallback: before,
      now: new Date(2026, 9, 13, 8, 0),
    });
    expect(nextDay.net).toBe(38.5);
  });

  it('exposes the server window totals with the period they cover', () => {
    expect(resolveServerPeriodEarnings(buildReport())).toEqual({
      count: 37,
      net: 1480.9,
      windowDays: 30,
    });
    expect(resolveServerPeriodEarnings(null)).toBeNull();
    expect(resolveServerPeriodEarnings({ totalCompletedRides: 3 })).toBeNull();
  });

  it('labels the Atividade totals with the server period and never sums a truncated list', () => {
    const loadedListStats = [
      { key: 'rides', label: 'Concluídas', value: '10' },
      { key: 'amount', label: 'Total líquido', value: 'R$ 170,00' },
    ];

    expect(
      buildDriverHistoryStats({
        loadedListStats,
        serverPeriod: resolveServerPeriodEarnings(buildReport()),
        historyComplete: false,
      }),
    ).toEqual([
      { key: 'rides', label: 'Concluídas · 30 dias', value: '37' },
      { key: 'amount', label: 'Total líquido · 30 dias', value: 'R$ 1.480,90' },
    ]);

    expect(buildDriverHistoryStats({ loadedListStats, serverPeriod: null, historyComplete: false })).toEqual([
      { key: 'rides', label: 'Concluídas', value: 'Indisponível' },
      { key: 'amount', label: 'Total líquido', value: 'Indisponível' },
    ]);

    expect(
      buildDriverHistoryStats({ loadedListStats, serverPeriod: null, historyComplete: true }),
    ).toBe(loadedListStats);
  });

  it('reads the existing earnings endpoint and shares one request in flight', async () => {
    const report = buildReport();
    mockFetchReport(report);

    const [first, second] = await Promise.all([
      fetchDriverEarningsReport('driver_1'),
      fetchDriverEarningsReport('driver_1'),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/api\/drivers\/driver_1\/earnings$/);
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(first).toEqual({ success: true, report });
    expect(second).toBe(first);
    expect(getCachedDriverEarningsReport('driver_1')).toBe(report);
  });

  it('keeps the last server report when a refresh fails', async () => {
    const report = buildReport();
    mockFetchReport(report);
    await fetchDriverEarningsReport('driver_1');

    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const failed = await fetchDriverEarningsReport('driver_1');

    expect(failed.success).toBe(false);
    expect(getCachedDriverEarningsReport('driver_1')).toBe(report);
  });

  it('loads on focus and after a ride ends, not on every render or while unfocused', async () => {
    const report = buildReport();
    mockFetchReport(report);

    const hook = renderHook(props => useDriverEarningsReport(props), {
      initialProps: { driverId: 'driver_1', enabled: false, refreshKey: '' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(hook.result.current.report).toBeNull();

    hook.rerender({ driverId: 'driver_1', enabled: true, refreshKey: '' });
    await waitFor(() => expect(hook.result.current.report).toBe(report));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    hook.rerender({ driverId: 'driver_1', enabled: true, refreshKey: '' });
    hook.rerender({ driverId: 'driver_1', enabled: true, refreshKey: '' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // A ride is running: no request. It ends (completed or cancelled): one more.
    hook.rerender({ driverId: 'driver_1', enabled: false, refreshKey: '' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      hook.rerender({ driverId: 'driver_1', enabled: true, refreshKey: 'receipt_2' });
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last server value on screen when a later load fails', async () => {
    const report = buildReport();
    mockFetchReport(report);
    const hook = renderHook(props => useDriverEarningsReport(props), {
      initialProps: { driverId: 'driver_1', enabled: true, refreshKey: '' },
    });
    await waitFor(() => expect(hook.result.current.report).toBe(report));

    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    hook.rerender({ driverId: 'driver_1', enabled: true, refreshKey: 'receipt_2' });
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.report).toBe(report);
  });

  it('reports a failed first load so the screen can fall back', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const hook = renderHook(props => useDriverEarningsReport(props), {
      initialProps: { driverId: 'driver_1', enabled: true, refreshKey: '' },
    });
    expect(hook.result.current.pending).toBe(true);
    await waitFor(() => expect(hook.result.current.failed).toBe(true));
    expect(hook.result.current.report).toBeNull();
    expect(hook.result.current.pending).toBe(false);
  });
});

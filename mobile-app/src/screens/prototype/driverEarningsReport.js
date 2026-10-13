import { useEffect, useRef, useState } from 'react';
import { getSelfHostedApiUrl } from '../../config/ApiConfig';
import DriverBalanceService from '../../services/DriverBalanceService';
import Logger from '../../utils/Logger';
import { formatCurrencyBRL } from './tripFinancialSummary';

// Server earnings report for the driver home pill and the Atividade totals.
// Same endpoint EarningsReportScreen reads: GET /api/drivers/:id/earnings.
// The report carries a 30-day `dailySeries` (one slot per server-local day,
// `amount` = driver net) and window totals (`totalCompletedRides`,
// `totalNetAmount`). The phone's stored receipts are only a fallback.

const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_WINDOW_DAYS = 30;

// Last good report per driver, kept for the life of the JS runtime so a
// remount or a failed refresh still shows the last server value.
const lastServerReportByDriver = new Map();
const pendingRequestByDriver = new Map();

function toFiniteNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

export function toLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCachedDriverEarningsReport(driverId) {
  return lastServerReportByDriver.get(String(driverId || '').trim()) || null;
}

export function resetDriverEarningsReportCache() {
  lastServerReportByDriver.clear();
  pendingRequestByDriver.clear();
}

export async function fetchDriverEarningsReport(driverId) {
  const id = String(driverId || '').trim();
  if (!id) {
    return { success: false, error: 'missing_driver_id' };
  }

  // One request in flight per driver: focus and ride-end can fire together.
  const pending = pendingRequestByDriver.get(id);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      : null;
    try {
      let headers = {};
      try {
        headers = await DriverBalanceService.getAuthHeaders();
      } catch (headerError) {
        headers = {};
      }
      const response = await fetch(
        `${getSelfHostedApiUrl('/api')}/drivers/${encodeURIComponent(id)}/earnings`,
        { method: 'GET', headers, ...(controller ? { signal: controller.signal } : {}) },
      );
      const payload = await response.json();
      if (!payload?.success || !payload?.report || !Array.isArray(payload.report.dailySeries)) {
        return { success: false, error: payload?.message || 'invalid_earnings_report' };
      }
      lastServerReportByDriver.set(id, payload.report);
      return { success: true, report: payload.report };
    } catch (error) {
      Logger.warn('Relatório de ganhos indisponível:', error?.message);
      return { success: false, error: error?.message || 'earnings_report_failed' };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      pendingRequestByDriver.delete(id);
    }
  })();

  pendingRequestByDriver.set(id, request);
  return request;
}

// Today's slot of the server report, or null when the report has no slot for
// the phone's current day (no report yet, or a report from a previous day).
export function resolveServerTodayEarnings(report, now = new Date()) {
  const series = Array.isArray(report?.dailySeries) ? report.dailySeries : null;
  if (!series) {
    return null;
  }
  const dateKey = toLocalDateKey(now);
  const slot = series.find(item => String(item?.date || '') === dateKey);
  const net = toFiniteNumber(slot?.amount);
  const count = toFiniteNumber(slot?.completedCount);
  if (!slot || net === null || count === null) {
    return null;
  }
  return {
    dateKey,
    net: roundMoney(net),
    gross: roundMoney(toFiniteNumber(slot.grossAmount) ?? 0),
    fees: roundMoney(toFiniteNumber(slot.feeAmount) ?? 0),
    count: Math.max(0, Math.round(count)),
  };
}

// Totals of the whole server window (30 days today), or null when unknown.
export function resolveServerPeriodEarnings(report) {
  const count = toFiniteNumber(report?.totalCompletedRides);
  const net = toFiniteNumber(report?.totalNetAmount);
  if (count === null || net === null) {
    return null;
  }
  const windowDays = toFiniteNumber(report?.dailySeriesWindowDays);
  return {
    count: Math.max(0, Math.round(count)),
    net: roundMoney(net),
    windowDays: windowDays && windowDays > 0 ? Math.round(windowDays) : DEFAULT_WINDOW_DAYS,
  };
}

// Atividade summary for the driver. The list there is paged (10 per request),
// so adding up the loaded rows gives a number that is neither a total nor a
// period. The summary comes from the server report and says which period it
// covers. Without that report the loaded rows are only used when they are
// the whole history; otherwise the summary says it is unavailable.
export function buildDriverHistoryStats({
  serverPeriod = null,
  historyComplete = false,
  loadedListStats = [],
  loadedRideCount = 0,
} = {}) {
  // A server total that counts fewer rides than the list on screen is not a
  // total; do not put it above that list.
  if (serverPeriod && Number(serverPeriod.count) >= Number(loadedRideCount || 0)) {
    const periodLabel = `${serverPeriod.windowDays} dias`;
    return [
      { key: 'rides', label: `Concluídas · ${periodLabel}`, value: String(serverPeriod.count) },
      {
        key: 'amount',
        label: `Líquido · ${periodLabel}`,
        value: formatCurrencyBRL(serverPeriod.net),
      },
    ];
  }
  if (historyComplete) {
    return loadedListStats;
  }
  return [
    { key: 'rides', label: 'Concluídas', value: 'Indisponível' },
    { key: 'amount', label: 'Total líquido', value: 'Indisponível' },
  ];
}

// Picks what "Ganhos de hoje" shows. The server slot wins whenever there is
// one for today. Otherwise the local sum of today's receipts is used, and it
// never drops below what this fallback already showed today: the stored
// receipt list is capped, so a shrinking sum only means a receipt fell out.
export function selectDriverTodayEarnings({
  report = null,
  localTotals = null,
  previousFallback = null,
  now = new Date(),
} = {}) {
  const serverToday = resolveServerTodayEarnings(report, now);
  const dateKey = toLocalDateKey(now);
  const local = {
    source: 'local',
    dateKey,
    net: roundMoney(localTotals?.totalNet),
    gross: roundMoney(localTotals?.totalGross),
    fees: roundMoney(localTotals?.totalFees),
    count: Math.max(0, Math.round(Number(localTotals?.count) || 0)),
  };
  if (
    previousFallback?.source === 'local' &&
    previousFallback.dateKey === dateKey &&
    Number(previousFallback.net) > local.net
  ) {
    return serverToday && Number(serverToday.net) >= Number(previousFallback.net)
      ? { source: 'server', ...serverToday }
      : previousFallback;
  }
  // The server report can lag behind or miss rides (seen on a device: it
  // answered zero right after a ride whose receipt said + R$ 41,93). It only
  // wins when it accounts for at least what this phone already knows about.
  if (serverToday && Number(serverToday.net) >= local.net && serverToday.count >= local.count) {
    return { source: 'server', ...serverToday };
  }
  return local;
}

// Loads the report when `enabled` turns true (screen focus, ride finished or
// cancelled) and when `refreshKey` changes while enabled. No timer.
export function useDriverEarningsReport({ driverId, enabled = true, refreshKey = '' } = {}) {
  const id = String(driverId || '').trim();
  const [state, setState] = useState(() => ({
    driverId: id,
    report: getCachedDriverEarningsReport(id),
    status: 'idle',
  }));
  const liveDriverIdRef = useRef(id);
  liveDriverIdRef.current = id;

  useEffect(() => {
    if (!id || !enabled) {
      return undefined;
    }
    let cancelled = false;
    setState(current => ({
      driverId: id,
      report: current.driverId === id ? current.report : getCachedDriverEarningsReport(id),
      status: 'loading',
    }));
    fetchDriverEarningsReport(id).then(result => {
      if (cancelled || liveDriverIdRef.current !== id) {
        return;
      }
      setState(current => ({
        driverId: id,
        report: result?.success
          ? result.report
          : current.driverId === id
            ? current.report
            : getCachedDriverEarningsReport(id),
        status: result?.success ? 'loaded' : 'failed',
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, id, refreshKey]);

  // Never hand out another driver's report while the identity is changing.
  const report = state.driverId === id ? state.report : getCachedDriverEarningsReport(id);
  const status = state.driverId === id ? state.status : 'idle';
  return {
    report,
    status,
    pending: Boolean(id) && !report && status !== 'failed',
    failed: status === 'failed',
  };
}

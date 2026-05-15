const redisPool = require('../utils/redis-pool');
const alertService = require('./alert-service');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured, logError } = require('../utils/logger');

const RIDE_COST_TELEMETRY_PREFIX = 'ride_cost_telemetry';
const RIDE_COST_TELEMETRY_RECENT_INDEX = `${RIDE_COST_TELEMETRY_PREFIX}:recent`;

let lastEvaluationAt = 0;

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readNumberFromEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readIntegerFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(safeNumber(value, 0) * factor) / factor;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function isCompletedStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return ['COMPLETED', 'COMPLETE', 'FINISHED', 'FINALIZED', 'DONE'].includes(normalized);
}

function buildConfig() {
  return {
    enabled: process.env.RIDE_COST_ALERTS_ENABLED !== 'false',
    windowSize: Math.max(1, readIntegerFromEnv('RIDE_COST_ALERT_WINDOW_SIZE', 20)),
    scanMultiplier: Math.max(1, readIntegerFromEnv('RIDE_COST_ALERT_SCAN_MULTIPLIER', 4)),
    minCompletedRides: Math.max(1, readIntegerFromEnv('RIDE_COST_ALERT_MIN_COMPLETED_RIDES', 5)),
    warningBrl: readNumberFromEnv('RIDE_COST_WARNING_BRL', 0.20),
    criticalBrl: readNumberFromEnv('RIDE_COST_CRITICAL_BRL', 0.30),
    directionsWarningPerRide: readNumberFromEnv('RIDE_COST_DIRECTIONS_WARNING_PER_RIDE', 2.2),
    directionsCriticalPerRide: readNumberFromEnv('RIDE_COST_DIRECTIONS_CRITICAL_PER_RIDE', 3),
    checkIntervalMs: readIntegerFromEnv('RIDE_COST_ALERT_CHECK_INTERVAL_MS', 60_000),
  };
}

function reportStatus(report = {}, bookingHash = {}) {
  return (
    bookingHash.status ||
    bookingHash.state ||
    bookingHash.bookingStatus ||
    report.bookingSnapshot?.status ||
    report.status ||
    ''
  );
}

function reportExchangeRate(report = {}) {
  return safeNumber(
    report.totals?.cost?.exchangeRateUsdBrl,
    safeNumber(process.env.RIDE_COST_TELEMETRY_USD_BRL_RATE, safeNumber(process.env.USD_BRL_EXCHANGE_RATE, 5.18)),
  );
}

function reportAllowedCostBrl(report = {}) {
  const exchangeRate = reportExchangeRate(report);
  const cost = report.totals?.cost || {};
  const componentValues = [cost.googleUsd, cost.backendUsd, cost.infrastructureUsd]
    .map((value) => safeNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const componentUsd = componentValues.reduce((sum, value) => sum + value, 0);

  if (componentValues.length > 0 && componentUsd > 0 && exchangeRate > 0) {
    return round(componentUsd * exchangeRate, 6);
  }

  return round(safeNumber(cost.totalBrl, 0), 6);
}

function summarizeReports(entries, config) {
  const selected = entries.slice(0, config.windowSize);
  const count = selected.length;
  const totals = selected.reduce((acc, entry) => {
    acc.totalBrl += entry.totalBrl;
    acc.googleBrl += entry.googleBrl;
    acc.totalUsd += entry.totalUsd;
    acc.googleUsd += entry.googleUsd;
    acc.directionsRequests += entry.directionsRequests;
    acc.maxBrl = Math.max(acc.maxBrl, entry.totalBrl);
    acc.aboveWarning += entry.totalBrl >= config.warningBrl ? 1 : 0;
    acc.aboveCritical += entry.totalBrl >= config.criticalBrl ? 1 : 0;
    return acc;
  }, {
    totalBrl: 0,
    googleBrl: 0,
    totalUsd: 0,
    googleUsd: 0,
    directionsRequests: 0,
    maxBrl: 0,
    aboveWarning: 0,
    aboveCritical: 0,
  });

  return {
    windowSize: config.windowSize,
    scannedCompletedRides: entries.length,
    completedRides: count,
    minCompletedRides: config.minCompletedRides,
    warningBrl: config.warningBrl,
    criticalBrl: config.criticalBrl,
    directionsWarningPerRide: config.directionsWarningPerRide,
    directionsCriticalPerRide: config.directionsCriticalPerRide,
    averageBrl: count > 0 ? round(totals.totalBrl / count, 4) : 0,
    averageGoogleBrl: count > 0 ? round(totals.googleBrl / count, 4) : 0,
    averageUsd: count > 0 ? round(totals.totalUsd / count, 6) : 0,
    averageGoogleUsd: count > 0 ? round(totals.googleUsd / count, 6) : 0,
    directionsPerRide: count > 0 ? round(totals.directionsRequests / count, 3) : 0,
    maxBrl: round(totals.maxBrl, 4),
    aboveWarningCount: totals.aboveWarning,
    aboveCriticalCount: totals.aboveCritical,
    bookingIds: selected.map((entry) => entry.bookingId),
    generatedAt: new Date().toISOString(),
  };
}

class RideCostAlertService {
  async collectRecentCostSummary(options = {}) {
    const config = {
      ...buildConfig(),
      ...(options.config || {}),
    };

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const scanLimit = Math.max(config.windowSize, config.windowSize * config.scanMultiplier);
    const bookingIds = await redis.zrevrange(RIDE_COST_TELEMETRY_RECENT_INDEX, 0, scanLimit - 1);
    const entries = [];

    for (const bookingId of bookingIds) {
      const rawReport = await redis.get(`${RIDE_COST_TELEMETRY_PREFIX}:${bookingId}`);
      const report = parseJson(rawReport, null);
      if (!report || typeof report !== 'object') {
        continue;
      }

      const bookingHash = await redis.hgetall(`booking:${bookingId}`);
      if (!isCompletedStatus(reportStatus(report, bookingHash || {}))) {
        continue;
      }

      const totalBrl = reportAllowedCostBrl(report);
      if (totalBrl <= 0) {
        continue;
      }

      const exchangeRate = reportExchangeRate(report);
      const googleUsd = safeNumber(report.totals?.cost?.googleUsd, safeNumber(report.totals?.google?.estimatedCostUsd, 0));
      const totalUsd = exchangeRate > 0 ? totalBrl / exchangeRate : safeNumber(report.totals?.cost?.totalUsd, 0);
      entries.push({
        bookingId,
        totalBrl,
        totalUsd,
        googleUsd,
        googleBrl: round(googleUsd * exchangeRate, 6),
        directionsRequests: safeNumber(report.totals?.google?.directions?.requestCount, 0),
      });
    }

    const summary = summarizeReports(entries, config);
    metrics.setRideCostRecentSummary({
      windowSize: config.windowSize,
      averageBrl: summary.averageBrl,
      googleAverageBrl: summary.averageGoogleBrl,
      directionsPerRide: summary.directionsPerRide,
    });
    return summary;
  }

  async evaluateRecentRideCosts(options = {}) {
    const config = buildConfig();
    if (!config.enabled) {
      return { skipped: true, reason: 'disabled' };
    }

    const now = Date.now();
    if (!options.force && config.checkIntervalMs > 0 && now - lastEvaluationAt < config.checkIntervalMs) {
      return { skipped: true, reason: 'interval' };
    }
    lastEvaluationAt = now;

    const summary = await this.collectRecentCostSummary({ config });
    if (summary.completedRides < config.minCompletedRides) {
      logStructured('debug', 'Monitor de custo por corrida aguardando volume minimo', {
        service: 'ride-cost-alert-service',
        completedRides: summary.completedRides,
        minCompletedRides: config.minCompletedRides,
      });
      return { skipped: true, reason: 'insufficient_completed_rides', summary };
    }

    await this.sendAverageCostAlertIfNeeded(summary, config);
    await this.sendDirectionsPerRideAlertIfNeeded(summary, config);
    return { skipped: false, summary };
  }

  async sendAverageCostAlertIfNeeded(summary, config) {
    const severity = summary.averageBrl >= config.criticalBrl
      ? 'critical'
      : summary.averageBrl >= config.warningBrl
        ? 'warning'
        : null;

    if (!severity) return;

    const threshold = severity === 'critical' ? config.criticalBrl : config.warningBrl;
    metrics.recordRideCostAlert('ride_cost_average_brl', severity);
    await alertService.sendAlert({
      severity,
      metric: 'ride_cost_average_brl',
      service: 'ride-cost-monitor',
      value: summary.averageBrl,
      threshold,
      unit: ' BRL/corrida',
      message:
        `Custo medio por corrida acima do limite: R$ ${summary.averageBrl.toFixed(4)} ` +
        `nas ultimas ${summary.completedRides} corridas concluidas. Woovi excluido. ` +
        `Google medio: R$ ${summary.averageGoogleBrl.toFixed(4)}. Max: R$ ${summary.maxBrl.toFixed(4)}.`,
      metadata: {
        janela: `${summary.completedRides}/${summary.windowSize}`,
        google_medio: `R$ ${summary.averageGoogleBrl.toFixed(4)}`,
        directions_por_corrida: summary.directionsPerRide,
        acima_warning: summary.aboveWarningCount,
        acima_critical: summary.aboveCriticalCount,
        booking_ids: summary.bookingIds.slice(0, 5).join(', '),
      },
    });
  }

  async sendDirectionsPerRideAlertIfNeeded(summary, config) {
    const severity = summary.directionsPerRide >= config.directionsCriticalPerRide
      ? 'critical'
      : summary.directionsPerRide >= config.directionsWarningPerRide
        ? 'warning'
        : null;

    if (!severity) return;

    const threshold = severity === 'critical'
      ? config.directionsCriticalPerRide
      : config.directionsWarningPerRide;
    metrics.recordRideCostAlert('google_directions_per_ride', severity);
    await alertService.sendAlert({
      severity,
      metric: 'google_directions_per_ride',
      service: 'ride-cost-monitor',
      value: summary.directionsPerRide,
      threshold,
      unit: ' req/corrida',
      message:
        `Media de Directions por corrida acima do esperado: ${summary.directionsPerRide} ` +
        `nas ultimas ${summary.completedRides} corridas concluidas. Esperado normal: perto de 2.`,
      metadata: {
        janela: `${summary.completedRides}/${summary.windowSize}`,
        custo_medio: `R$ ${summary.averageBrl.toFixed(4)}`,
        google_medio: `R$ ${summary.averageGoogleBrl.toFixed(4)}`,
        booking_ids: summary.bookingIds.slice(0, 5).join(', '),
      },
    });
  }
}

module.exports = new RideCostAlertService();

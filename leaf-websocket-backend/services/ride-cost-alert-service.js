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
    // Uma corrida é anômala quando custa N vezes a mediana da janela (com 3+ corridas).
    outlierMedianMultiplier: Math.max(1, readNumberFromEnv('RIDE_COST_OUTLIER_MEDIAN_MULTIPLIER', 2)),
    autocompleteWarningPerRide: Math.max(1, readIntegerFromEnv('RIDE_COST_AUTOCOMPLETE_WARNING_PER_RIDE', 15)),
    timeZone: process.env.RIDE_COST_TIME_ZONE || 'America/Sao_Paulo',
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

function median(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && String(value).trim() !== '' && /^\d+$/.test(String(value).trim())
    ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateKeyIn(timeZone, isoOrDate) {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Quebra da corrida por SKU, em BRL, do mais caro para o mais barato. Só lê o relatório gravado.
function rideSkuBreakdown(report = {}, exchangeRate = 0) {
  const skus = report.totals?.google?.skus || {};
  return Object.entries(skus)
    .map(([key, entry]) => {
      const costUsd = safeNumber(entry?.estimatedCostUsd, 0);
      return {
        key,
        label: String(entry?.label || key),
        requests: Math.max(0, Math.round(safeNumber(entry?.requestCount, 0))),
        costUsd: round(costUsd, 6),
        costBrl: round(costUsd * exchangeRate, 4),
      };
    })
    .filter((entry) => entry.requests > 0 || entry.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
}

function skuRequests(skus = [], key) {
  return skus.filter((entry) => entry.key === key).reduce((sum, entry) => sum + entry.requests, 0);
}

// Motivos que tornam a corrida fora do padrão. A mediana vem da própria janela.
function rideAnomalies(entry, { medianBrl, count }, config) {
  const reasons = [];
  if (entry.totalBrl >= config.criticalBrl) reasons.push('acima_critico');
  else if (entry.totalBrl >= config.warningBrl) reasons.push('acima_alerta');
  if (count >= 3 && medianBrl > 0 && entry.totalBrl >= medianBrl * config.outlierMedianMultiplier) {
    reasons.push('acima_mediana');
  }
  if (entry.directionsRequests >= config.directionsCriticalPerRide) reasons.push('rotas_demais');
  if (skuRequests(entry.skus, 'autocompleteLegacyPerRequest') >= config.autocompleteWarningPerRide) {
    reasons.push('autocomplete_demais');
  }
  return reasons;
}

function publicRide(entry, anomalies, exchangeRate) {
  return {
    bookingId: entry.bookingId,
    completedAt: entry.completedAt,
    dateKey: entry.dateKey,
    totalBrl: round(entry.totalBrl, 4),
    googleBrl: round(entry.googleBrl, 4),
    otherBrl: round(Math.max(0, entry.totalBrl - entry.googleBrl), 4),
    directionsRequests: entry.directionsRequests,
    skus: entry.skus,
    anomalies,
    exchangeRateUsdBrl: exchangeRate,
  };
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

  const medianBrl = median(selected.map((entry) => entry.totalBrl));
  const rides = selected.map((entry) => publicRide(
    entry,
    rideAnomalies(entry, { medianBrl, count }, config),
    entry.exchangeRate,
  ));
  const todayKey = dateKeyIn(config.timeZone, new Date());
  const todayEntries = entries.filter((entry) => entry.dateKey && entry.dateKey === todayKey);

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
    medianBrl: round(medianBrl, 4),
    outlierMedianMultiplier: config.outlierMedianMultiplier,
    autocompleteWarningPerRide: config.autocompleteWarningPerRide,
    // Cada corrida da janela com o custo medido dela; anomalies vazio = dentro do padrão.
    rides,
    anomalousRides: rides.filter((ride) => ride.anomalies.length > 0).length,
    // Soma real das corridas concluídas hoje que estão no índice recente (não é projeção).
    today: {
      dateKey: todayKey,
      timeZone: config.timeZone,
      rides: todayEntries.length,
      totalBrl: round(todayEntries.reduce((sum, entry) => sum + entry.totalBrl, 0), 4),
      googleBrl: round(todayEntries.reduce((sum, entry) => sum + entry.googleBrl, 0), 4),
    },
    generatedAt: new Date().toISOString(),
  };
}

// Até 3 corridas fora do padrão, com o SKU que mais pesou, para o alerta apontar a corrida.
function describeAnomalousRides(summary = {}) {
  const rides = (summary.rides || []).filter((ride) => ride.anomalies?.length > 0).slice(0, 3);
  if (rides.length === 0) return 'nenhuma';
  return rides.map((ride) => {
    const top = ride.skus?.[0];
    const skuText = top ? ` ${top.label} x${top.requests}` : '';
    return `${ride.bookingId} R$ ${ride.totalBrl.toFixed(4)} (${ride.anomalies.join('+')}${skuText})`;
  }).join('; ');
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
      const completedAt = toIso(bookingHash?.completedAt) || toIso(report.updatedAt) || null;
      entries.push({
        bookingId,
        totalBrl,
        totalUsd,
        googleUsd,
        googleBrl: round(googleUsd * exchangeRate, 6),
        directionsRequests: safeNumber(report.totals?.google?.directions?.requestCount, 0),
        exchangeRate,
        completedAt,
        dateKey: completedAt ? dateKeyIn(config.timeZone, completedAt) : null,
        skus: rideSkuBreakdown(report, exchangeRate),
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
        corridas_fora_do_padrao: describeAnomalousRides(summary),
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
module.exports.describeAnomalousRides = describeAnomalousRides;

const axios = require('axios');
const cron = require('node-cron');
const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const { validateAuthoritativeFinancialSnapshot } = require('./ride-financial-contract');
const { usageDayKey: awsKycUsageDayKey } = require('./aws-kyc-cost-budget-authority');

const ROLLUP_PREFIX = 'daily_earnings_report';
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round(safeNumber(value, 0) * 100) / 100;
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
    if (Number.isFinite(value.seconds)) {
      return new Date(value.seconds * 1000);
    }
  }

  const asString = String(value).trim();
  if (/^\d{10,16}$/.test(asString)) {
    const asNumber = Number(asString);
    return new Date(asString.length === 10 ? asNumber * 1000 : asNumber);
  }

  const parsed = Date.parse(asString);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function dateKeyFor(dateInput = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const date = dateInput instanceof Date ? dateInput : parseTimestamp(dateInput) || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function previousDateKey(timeZone = DEFAULT_TIME_ZONE) {
  const now = new Date();
  return dateKeyFor(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
}

function isCompletedStatus(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return ['COMPLETED', 'COMPLETE', 'FINISHED', 'FINALIZED', 'DONE'].includes(normalized);
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const parsed = safeNumber(value, NaN);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function firstObject(...values) {
  for (const value of values) {
    const parsed = parseJson(value, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  }
  return null;
}

function centsToBrl(value) {
  return roundMoney(safeNumber(value, 0) / 100);
}

function resolveBackendFinalFinancialSnapshot(report = {}, bookingHash = {}) {
  const bookingSnapshot = report.bookingSnapshot || {};
  const paymentDistribution = firstObject(
    report.paymentDistribution,
    bookingSnapshot.paymentDistribution,
    bookingHash.paymentDistribution,
  ) || {};
  const candidate = firstObject(
    report.financialSnapshot,
    report.financialContract,
    report.financialBreakdown?.financialSnapshot,
    report.financialBreakdown?.financialContract,
    bookingSnapshot.financialSnapshot,
    bookingSnapshot.financialContract,
    bookingSnapshot.financialBreakdown?.financialSnapshot,
    bookingSnapshot.financialBreakdown?.financialContract,
    paymentDistribution.financialSnapshot,
    paymentDistribution.calculation?.financialContract,
    paymentDistribution.calculation?.financialSnapshot,
    bookingHash.financialSnapshot,
    bookingHash.financialContract,
  );
  const validation = validateAuthoritativeFinancialSnapshot(candidate || {});

  return validation.valid ? validation.snapshot : null;
}

function allowedRideCostTotalBrl(report = {}, exchangeRate = 0) {
  const cost = report.totals?.cost || {};
  const componentValues = [cost.googleUsd, cost.backendUsd, cost.infrastructureUsd]
    .map((value) => safeNumber(value, NaN))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const componentUsd = componentValues.reduce((sum, value) => sum + value, 0);

  if (componentValues.length > 0 && componentUsd > 0 && exchangeRate > 0) {
    return roundMoney(componentUsd * exchangeRate);
  }

  return roundMoney(firstPositiveNumber(
    cost.totalBrl,
    safeNumber(cost.totalUsd, 0) * exchangeRate,
  ));
}

function snapshotFromReportAndBooking(report = {}, bookingHash = {}, timeZone = DEFAULT_TIME_ZONE) {
  const status =
    bookingHash.status ||
    bookingHash.state ||
    bookingHash.bookingStatus ||
    report.bookingSnapshot?.status ||
    report.status ||
    '';
  if (!isCompletedStatus(status)) {
    return null;
  }

  const finalFinancialSnapshot = resolveBackendFinalFinancialSnapshot(report, bookingHash);
  if (!finalFinancialSnapshot) {
    return null;
  }

  const completedAt =
    parseTimestamp(bookingHash.completedAt) ||
    parseTimestamp(bookingHash.tripend) ||
    parseTimestamp(bookingHash.finishedAt) ||
    parseTimestamp(report.bookingSnapshot?.completedAt) ||
    parseTimestamp(report.updatedAt) ||
    new Date();
  const dateKey = dateKeyFor(completedAt, timeZone);
  const exchangeRate = firstPositiveNumber(
    report.totals?.cost?.exchangeRateUsdBrl,
    process.env.RIDE_COST_TELEMETRY_USD_BRL_RATE,
    process.env.USD_BRL_EXCHANGE_RATE,
    5.2,
  );
  const rideCostTotalBrl = allowedRideCostTotalBrl(report, exchangeRate);
  const googleCostTotalBrl = roundMoney(firstPositiveNumber(
    safeNumber(report.totals?.cost?.googleUsd, 0) * exchangeRate,
    safeNumber(report.totals?.google?.estimatedCostUsd, 0) * exchangeRate,
  ));
  const infrastructureCostTotalBrl = roundMoney(firstPositiveNumber(
    safeNumber(report.totals?.cost?.infrastructureUsd, 0) * exchangeRate,
    safeNumber(report.totals?.infrastructure?.estimatedCostUsd, 0) * exchangeRate,
  ));
  const firebaseCostTotalBrl = roundMoney(
    safeNumber(report.totals?.infrastructure?.firebase?.estimatedCostUsd, 0) * exchangeRate,
  );
  const grossFareTotalBrl = centsToBrl(finalFinancialSnapshot.passengerPaidCents);
  const operationalFeeTotalBrl = centsToBrl(finalFinancialSnapshot.operationalFeeCents);

  return {
    bookingId: report.bookingId || bookingHash.bookingId,
    dateKey,
    completedAt: completedAt.toISOString(),
    completedRides: 1,
    grossFareTotalBrl,
    operationalFeeTotalBrl,
    rideCostTotalBrl,
    googleCostTotalBrl,
    firebaseCostTotalBrl,
    infrastructureCostTotalBrl,
    platformNetTotalBrl: roundMoney(operationalFeeTotalBrl - rideCostTotalBrl),
    directionsRequestsTotal: safeNumber(report.totals?.google?.directions?.requestCount, 0),
  };
}

function rollupKey(dateKey) {
  return `${ROLLUP_PREFIX}:${dateKey}`;
}

function bookingSnapshotKey(bookingId) {
  return `${ROLLUP_PREFIX}:ride:${bookingId}`;
}

function sentKey(dateKey) {
  return `${ROLLUP_PREFIX}:sent:${dateKey}`;
}

function applyMultiplier(snapshot, multiplier) {
  return {
    completedRides: multiplier * safeNumber(snapshot.completedRides, 0),
    grossFareTotalBrl: multiplier * safeNumber(snapshot.grossFareTotalBrl, 0),
    operationalFeeTotalBrl: multiplier * safeNumber(snapshot.operationalFeeTotalBrl, 0),
    rideCostTotalBrl: multiplier * safeNumber(snapshot.rideCostTotalBrl, 0),
    googleCostTotalBrl: multiplier * safeNumber(snapshot.googleCostTotalBrl, 0),
    firebaseCostTotalBrl: multiplier * safeNumber(snapshot.firebaseCostTotalBrl, 0),
    infrastructureCostTotalBrl: multiplier * safeNumber(snapshot.infrastructureCostTotalBrl, 0),
    platformNetTotalBrl: multiplier * safeNumber(snapshot.platformNetTotalBrl, 0),
    directionsRequestsTotal: multiplier * safeNumber(snapshot.directionsRequestsTotal, 0),
  };
}

async function incrementRollup(redis, dateKey, delta) {
  const key = rollupKey(dateKey);
  const updates = applyMultiplier(delta, 1);
  for (const [field, value] of Object.entries(updates)) {
    if (value !== 0) {
      await redis.hincrbyfloat(key, field, value);
    }
  }
  await redis.hset(key, {
    dateKey,
    updatedAt: new Date().toISOString(),
  });
  await redis.expire(key, Number.parseInt(process.env.DAILY_EARNINGS_REPORT_TTL_SECONDS || `${60 * 60 * 24 * 120}`, 10));
  await redis.zadd(`${ROLLUP_PREFIX}:index`, Date.now(), dateKey);
}

function normalizeSummary(dateKey, hash = {}, kycUsageHash = {}) {
  const completedRides = Math.max(0, Math.round(safeNumber(hash.completedRides, 0)));
  const grossFareTotalBrl = roundMoney(hash.grossFareTotalBrl);
  const operationalFeeTotalBrl = roundMoney(hash.operationalFeeTotalBrl);
  const rideCostTotalBrl = roundMoney(hash.rideCostTotalBrl);
  const googleCostTotalBrl = roundMoney(hash.googleCostTotalBrl);
  const firebaseCostTotalBrl = roundMoney(hash.firebaseCostTotalBrl);
  const infrastructureCostTotalBrl = roundMoney(hash.infrastructureCostTotalBrl);
  const platformNetTotalBrl = roundMoney(hash.platformNetTotalBrl);
  const directionsRequestsTotal = safeNumber(hash.directionsRequestsTotal, 0);
  const kycAwsSessionsTotal = Math.max(
    0,
    Math.round(safeNumber(kycUsageHash.sessionCount, 0))
  );
  const kycAwsEstimatedCostMicros = Math.max(
    0,
    Math.round(safeNumber(kycUsageHash.estimatedCostMicros, 0))
  );
  const kycAwsEstimatedCostUsd = kycAwsEstimatedCostMicros / 1_000_000;
  const usdBrlExchangeRate = firstPositiveNumber(
    process.env.RIDE_COST_TELEMETRY_USD_BRL_RATE,
    process.env.USD_BRL_EXCHANGE_RATE,
    5.2
  );
  const kycAwsEstimatedCostBrl = roundMoney(
    kycAwsEstimatedCostUsd * usdBrlExchangeRate
  );

  return {
    dateKey,
    completedRides,
    grossFareTotalBrl,
    operationalFeeTotalBrl,
    rideCostTotalBrl,
    googleCostTotalBrl,
    firebaseCostTotalBrl,
    infrastructureCostTotalBrl,
    platformNetTotalBrl,
    directionsRequestsTotal,
    kycAwsSessionsTotal,
    kycAwsEstimatedCostMicros,
    kycAwsEstimatedCostUsd,
    kycAwsEstimatedCostBrl,
    kycAwsUsdBrlExchangeRate: usdBrlExchangeRate,
    averageRideCostBrl: completedRides > 0 ? roundMoney(rideCostTotalBrl / completedRides) : 0,
    averageGoogleCostBrl: completedRides > 0 ? roundMoney(googleCostTotalBrl / completedRides) : 0,
    averageOperationalFeeBrl: completedRides > 0 ? roundMoney(operationalFeeTotalBrl / completedRides) : 0,
    directionsPerRide: completedRides > 0 ? Math.round((directionsRequestsTotal / completedRides) * 100) / 100 : 0,
    updatedAt: hash.updatedAt || null,
  };
}

function formatBrl(value) {
  return `R$ ${roundMoney(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatUsd(value) {
  return `US$ ${safeNumber(value, 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function buildDiscordPayload(summary) {
  const healthy = summary.averageRideCostBrl <= safeNumber(process.env.RIDE_COST_WARNING_BRL, 0.2);
  const color = healthy ? 0x12b76a : 0xf79009;
  return {
    username: process.env.DISCORD_EARNINGS_USERNAME || 'Leaf Earnings',
    embeds: [
      {
        title: `Leaf earnings daily - ${summary.dateKey}`,
        description: 'Relatorio diario de corridas, custo variavel e ganho liquido da plataforma. Woovi excluido.',
        color,
        fields: [
          { name: 'Corridas concluidas', value: String(summary.completedRides), inline: true },
          { name: 'Custo total', value: formatBrl(summary.rideCostTotalBrl), inline: true },
          { name: 'Custo medio/corrida', value: formatBrl(summary.averageRideCostBrl), inline: true },
          { name: 'Taxa operacional total', value: formatBrl(summary.operationalFeeTotalBrl), inline: true },
          { name: 'Ganho liquido Leaf', value: formatBrl(summary.platformNetTotalBrl), inline: true },
          { name: 'Taxa media/corrida', value: formatBrl(summary.averageOperationalFeeBrl), inline: true },
          { name: 'Google', value: formatBrl(summary.googleCostTotalBrl), inline: true },
          { name: 'Firebase/infra variavel', value: formatBrl(summary.firebaseCostTotalBrl + summary.infrastructureCostTotalBrl), inline: true },
          { name: 'Directions/corrida', value: String(summary.directionsPerRide), inline: true },
          {
            name: 'AWS KYC estimado',
            value: `${summary.kycAwsSessionsTotal} sessoes · ${formatUsd(summary.kycAwsEstimatedCostUsd)} (≈ ${formatBrl(summary.kycAwsEstimatedCostBrl)})`,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Leaf earnings report',
        },
      },
    ],
  };
}

class DailyEarningsReportService {
  constructor() {
    this.schedulerStarted = false;
  }

  getWebhookUrl() {
    return (
      process.env.DISCORD_EARNINGS_WEBHOOK_URL ||
      process.env.DISCORD_DAILY_EARNINGS_WEBHOOK_URL ||
      process.env.LEAF_EARNINGS_DISCORD_WEBHOOK_URL ||
      ''
    );
  }

  getTimeZone() {
    return process.env.LEAF_REPORT_TIME_ZONE || DEFAULT_TIME_ZONE;
  }

  async recordCompletedRideFromReport(report = {}) {
    const bookingId = String(report.bookingId || '').trim();
    if (!bookingId) {
      return null;
    }

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const bookingHash = await redis.hgetall(`booking:${bookingId}`);
    const snapshot = snapshotFromReportAndBooking(report, bookingHash || {}, this.getTimeZone());
    if (!snapshot) {
      return null;
    }

    const snapshotKey = bookingSnapshotKey(bookingId);
    const previous = parseJson(await redis.get(snapshotKey), null);
    if (previous && previous.dateKey) {
      await incrementRollup(redis, previous.dateKey, applyMultiplier(previous, -1));
      await redis.srem(`${rollupKey(previous.dateKey)}:bookings`, bookingId);
    }

    await incrementRollup(redis, snapshot.dateKey, snapshot);
    await redis.sadd(`${rollupKey(snapshot.dateKey)}:bookings`, bookingId);
    await redis.set(snapshotKey, JSON.stringify(snapshot), 'EX', Number.parseInt(process.env.DAILY_EARNINGS_REPORT_TTL_SECONDS || `${60 * 60 * 24 * 120}`, 10));

    logStructured('info', 'Rollup diario de earnings atualizado', {
      service: 'daily-earnings-report',
      bookingId,
      dateKey: snapshot.dateKey,
      platformNetTotalBrl: snapshot.platformNetTotalBrl,
    });

    return snapshot;
  }

  async getDailySummary(dateKey = dateKeyFor(new Date(), this.getTimeZone())) {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const [hash, kycUsageHash] = await Promise.all([
      redis.hgetall(rollupKey(dateKey)),
      redis.hgetall(awsKycUsageDayKey(dateKey)),
    ]);
    return normalizeSummary(dateKey, hash || {}, kycUsageHash || {});
  }

  async sendDailyReport(dateKey = previousDateKey(this.getTimeZone()), options = {}) {
    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) {
      return { sent: false, reason: 'missing_webhook', summary: await this.getDailySummary(dateKey) };
    }

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    if (!options.force) {
      const acquired = await redis.set(sentKey(dateKey), new Date().toISOString(), 'EX', 60 * 60 * 36, 'NX');
      if (acquired !== 'OK') {
        return { sent: false, reason: 'already_sent', summary: await this.getDailySummary(dateKey) };
      }
    }

    const summary = await this.getDailySummary(dateKey);
    const sendEmpty = String(process.env.DAILY_EARNINGS_REPORT_SEND_EMPTY || 'true').toLowerCase() !== 'false';
    if (
      !sendEmpty
      && summary.completedRides <= 0
      && summary.kycAwsSessionsTotal <= 0
    ) {
      return { sent: false, reason: 'empty_day', summary };
    }

    try {
      await axios.post(webhookUrl, buildDiscordPayload(summary), {
        headers: { 'Content-Type': 'application/json' },
        timeout: Number.parseInt(process.env.DAILY_EARNINGS_REPORT_TIMEOUT_MS || '8000', 10),
      });
    } catch (error) {
      if (!options.force && typeof redis.del === 'function') {
        await redis.del(sentKey(dateKey));
      }
      throw error;
    }

    logStructured('info', 'Relatorio diario de earnings enviado', {
      service: 'daily-earnings-report',
      dateKey,
      completedRides: summary.completedRides,
      platformNetTotalBrl: summary.platformNetTotalBrl,
      kycAwsSessionsTotal: summary.kycAwsSessionsTotal,
      kycAwsEstimatedCostUsd: summary.kycAwsEstimatedCostUsd,
    });

    return { sent: true, summary };
  }

  startScheduler() {
    if (this.schedulerStarted) {
      return false;
    }
    if (String(process.env.DAILY_EARNINGS_REPORT_ENABLED || 'true').toLowerCase() === 'false') {
      return false;
    }

    const schedule = process.env.DAILY_EARNINGS_REPORT_CRON || '5 6 * * *';
    const timeZone = this.getTimeZone();
    cron.schedule(schedule, () => {
      const targetDateKey = previousDateKey(timeZone);
      this.sendDailyReport(targetDateKey).catch((error) => {
        logError(error, 'Erro ao enviar relatorio diario de earnings', {
          service: 'daily-earnings-report',
          dateKey: targetDateKey,
        });
      });
    }, { timezone: timeZone });
    this.schedulerStarted = true;

    logStructured('info', 'Relatorio diario de earnings agendado', {
      service: 'daily-earnings-report',
      schedule,
      timeZone,
    });
    return true;
  }
}

module.exports = new DailyEarningsReportService();
module.exports._private = {
  dateKeyFor,
  previousDateKey,
  snapshotFromReportAndBooking,
  normalizeSummary,
  buildDiscordPayload,
  formatBrl,
  formatUsd,
  allowedRideCostTotalBrl,
  resolveBackendFinalFinancialSnapshot,
};

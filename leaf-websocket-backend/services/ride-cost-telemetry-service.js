const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');

const RIDE_COST_TELEMETRY_PREFIX = 'ride_cost_telemetry';
const RIDE_COST_TELEMETRY_RECENT_INDEX = `${RIDE_COST_TELEMETRY_PREFIX}:recent`;
const RIDE_COST_TELEMETRY_TTL_SECONDS = Number.parseInt(
  process.env.RIDE_COST_TELEMETRY_TTL_SECONDS || `${60 * 60 * 24 * 30}`,
  10,
);

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(safeNumber(value, 0).toFixed(6));
}

function safeJsonClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function safeJsonParse(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeSourceMeta(meta = {}) {
  return {
    userId: sanitizeText(meta.userId, null),
    userType: sanitizeText(meta.userType, null),
    platform: sanitizeText(meta.platform, null),
    flow: sanitizeText(meta.flow, null),
    scenario: sanitizeText(meta.scenario, null),
    surface: sanitizeText(meta.surface, null),
    socketId: sanitizeText(meta.socketId, null),
  };
}

class RideCostTelemetryService {
  buildReportKey(bookingId) {
    return `${RIDE_COST_TELEMETRY_PREFIX}:${bookingId}`;
  }

  normalizeSourceKey({ sourceKey, userId, userType } = {}) {
    const normalizedRequested = sanitizeText(sourceKey, '');
    if (normalizedRequested) {
      return normalizedRequested;
    }

    return `${sanitizeText(userType, 'unknown')}:${sanitizeText(userId, 'anonymous')}`;
  }

  createEmptyReport(bookingId) {
    const now = new Date().toISOString();
    return {
      bookingId,
      createdAt: now,
      updatedAt: now,
      pricingSheet: null,
      sources: {},
      totals: {
        sourceCount: 0,
        google: {
          requestCount: 0,
          billableUnits: 0,
          estimatedCostUsd: 0,
          skus: {},
        },
        backend: {
          attempts: 0,
          emits: 0,
          successes: 0,
          errors: 0,
          totalLatencyMs: 0,
          commands: {},
        },
      },
    };
  }

  aggregateReport(report) {
    const totals = this.createEmptyReport(report.bookingId).totals;
    const sourceEntries = Object.values(report.sources || {});
    totals.sourceCount = sourceEntries.length;

    sourceEntries.forEach((sourceEntry) => {
      const snapshot = sourceEntry?.snapshot || {};
      const googleSkus = snapshot?.google?.skus || {};
      Object.entries(googleSkus).forEach(([skuKey, skuEntry]) => {
        const aggregateSku = totals.google.skus[skuKey] || {
          label: sanitizeText(skuEntry?.label, skuKey),
          family: sanitizeText(skuEntry?.family, null),
          unit: sanitizeText(skuEntry?.unit, null),
          requestCount: 0,
          billableUnits: 0,
          estimatedCostUsd: 0,
        };

        aggregateSku.requestCount += Math.max(0, Math.round(safeNumber(skuEntry?.requestCount, 0)));
        aggregateSku.billableUnits = Number(
          (safeNumber(aggregateSku.billableUnits, 0) + safeNumber(skuEntry?.billableUnits, 0)).toFixed(3),
        );
        aggregateSku.estimatedCostUsd = roundCurrency(
          safeNumber(aggregateSku.estimatedCostUsd, 0) + safeNumber(skuEntry?.estimatedCostUsd, 0),
        );
        totals.google.skus[skuKey] = aggregateSku;
      });

      const backendCommands = snapshot?.backend?.commands || {};
      Object.entries(backendCommands).forEach(([commandName, commandEntry]) => {
        const aggregateCommand = totals.backend.commands[commandName] || {
          attempts: 0,
          emits: 0,
          successes: 0,
          errors: 0,
          totalLatencyMs: 0,
        };

        aggregateCommand.attempts += Math.max(0, Math.round(safeNumber(commandEntry?.attempts, 0)));
        aggregateCommand.emits += Math.max(0, Math.round(safeNumber(commandEntry?.emits, 0)));
        aggregateCommand.successes += Math.max(0, Math.round(safeNumber(commandEntry?.successes, 0)));
        aggregateCommand.errors += Math.max(0, Math.round(safeNumber(commandEntry?.errors, 0)));
        aggregateCommand.totalLatencyMs += Math.max(0, Math.round(safeNumber(commandEntry?.totalLatencyMs, 0)));
        totals.backend.commands[commandName] = aggregateCommand;
      });
    });

    totals.google.requestCount = Object.values(totals.google.skus).reduce(
      (acc, skuEntry) => acc + Math.max(0, Math.round(safeNumber(skuEntry?.requestCount, 0))),
      0,
    );
    totals.google.billableUnits = Number(
      Object.values(totals.google.skus)
        .reduce((acc, skuEntry) => acc + safeNumber(skuEntry?.billableUnits, 0), 0)
        .toFixed(3),
    );
    totals.google.estimatedCostUsd = roundCurrency(
      Object.values(totals.google.skus).reduce(
        (acc, skuEntry) => acc + safeNumber(skuEntry?.estimatedCostUsd, 0),
        0,
      ),
    );

    totals.backend.attempts = Object.values(totals.backend.commands).reduce(
      (acc, commandEntry) => acc + Math.max(0, Math.round(safeNumber(commandEntry?.attempts, 0))),
      0,
    );
    totals.backend.emits = Object.values(totals.backend.commands).reduce(
      (acc, commandEntry) => acc + Math.max(0, Math.round(safeNumber(commandEntry?.emits, 0))),
      0,
    );
    totals.backend.successes = Object.values(totals.backend.commands).reduce(
      (acc, commandEntry) => acc + Math.max(0, Math.round(safeNumber(commandEntry?.successes, 0))),
      0,
    );
    totals.backend.errors = Object.values(totals.backend.commands).reduce(
      (acc, commandEntry) => acc + Math.max(0, Math.round(safeNumber(commandEntry?.errors, 0))),
      0,
    );
    totals.backend.totalLatencyMs = Object.values(totals.backend.commands).reduce(
      (acc, commandEntry) => acc + Math.max(0, Math.round(safeNumber(commandEntry?.totalLatencyMs, 0))),
      0,
    );

    return totals;
  }

  async ingestSnapshot({ bookingId, sourceKey, sourceMeta = {}, snapshot, pricingSheet = null, requestMeta = null } = {}) {
    const normalizedBookingId = sanitizeText(bookingId, '');
    if (!normalizedBookingId) {
      throw new Error('bookingId obrigatório para telemetria de custo');
    }

    const normalizedSourceKey = this.normalizeSourceKey({
      sourceKey,
      userId: sourceMeta?.userId,
      userType: sourceMeta?.userType,
    });

    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('snapshot obrigatório para telemetria de custo');
    }

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const reportKey = this.buildReportKey(normalizedBookingId);
    const rawReport = await redis.get(reportKey);
    const report = safeJsonParse(rawReport, this.createEmptyReport(normalizedBookingId));
    const now = new Date().toISOString();

    report.bookingId = normalizedBookingId;
    report.updatedAt = now;
    if (!report.createdAt) {
      report.createdAt = now;
    }
    if (pricingSheet && typeof pricingSheet === 'object') {
      report.pricingSheet = safeJsonClone(pricingSheet, null);
    }

    report.sources = report.sources || {};
    report.sources[normalizedSourceKey] = {
      sourceKey: normalizedSourceKey,
      sourceMeta: normalizeSourceMeta(sourceMeta),
      updatedAt: now,
      requestMeta: safeJsonClone(requestMeta, null),
      snapshot: safeJsonClone(snapshot, {}),
    };
    report.totals = this.aggregateReport(report);

    await redis.set(reportKey, JSON.stringify(report), 'EX', RIDE_COST_TELEMETRY_TTL_SECONDS);
    await redis.zadd(RIDE_COST_TELEMETRY_RECENT_INDEX, Date.now(), normalizedBookingId);
    await redis.expire(RIDE_COST_TELEMETRY_RECENT_INDEX, RIDE_COST_TELEMETRY_TTL_SECONDS);
    await redis.hset(`booking:${normalizedBookingId}`, {
      costTelemetryKey: reportKey,
      costTelemetryUpdatedAt: report.updatedAt,
      costTelemetryGoogleUsd: String(report.totals?.google?.estimatedCostUsd || 0),
      costTelemetryGoogleBillableUnits: String(report.totals?.google?.billableUnits || 0),
      costTelemetrySourceCount: String(report.totals?.sourceCount || 0),
    });

    logStructured('info', 'Telemetria de custo da corrida atualizada', {
      bookingId: normalizedBookingId,
      sourceKey: normalizedSourceKey,
      eventType: 'rideCostTelemetry',
      googleUsd: report.totals?.google?.estimatedCostUsd || 0,
      googleUnits: report.totals?.google?.billableUnits || 0,
    });

    return report;
  }

  async getReport(bookingId) {
    const normalizedBookingId = sanitizeText(bookingId, '');
    if (!normalizedBookingId) {
      return null;
    }

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const rawReport = await redis.get(this.buildReportKey(normalizedBookingId));
    return safeJsonParse(rawReport, null);
  }

  async getRecentReports(limit = 5) {
    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();
    const normalizedLimit = Math.max(1, Math.min(50, Math.round(safeNumber(limit, 5))));
    const bookingIds = await redis.zrevrange(RIDE_COST_TELEMETRY_RECENT_INDEX, 0, normalizedLimit - 1);
    const reports = [];
    for (const bookingId of bookingIds) {
      const report = await this.getReport(bookingId);
      if (report) {
        reports.push(report);
      }
    }
    return reports;
  }
}

module.exports = new RideCostTelemetryService();

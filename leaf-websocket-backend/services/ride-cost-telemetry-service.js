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

function readPositiveNumberFromEnv(...candidates) {
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

function roundCurrency(value) {
  return Number(safeNumber(value, 0).toFixed(6));
}

function roundUnits(value) {
  return Number(safeNumber(value, 0).toFixed(3));
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

function normalizeUserType(userType) {
  const normalized = sanitizeText(userType, 'unknown').toLowerCase();
  if (normalized === 'driver') {
    return 'driver';
  }
  if (normalized === 'customer' || normalized === 'passenger') {
    return 'customer';
  }
  return 'unknown';
}

function createEmptySkuBreakdown() {
  return {
    bySurface: {},
    byRouteScope: {},
    byCaller: {},
    byCacheMode: {},
  };
}

function createEmptyDimensionBucket() {
  return {
    requestCount: 0,
    billableUnits: 0,
    estimatedCostUsd: 0,
  };
}

function truncateDimensionValue(value, maxLength = 140) {
  const normalized = sanitizeText(value, '');
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeDimensionKey(rawValue, fallback = 'unknown') {
  const normalized = truncateDimensionValue(rawValue);
  return normalized || fallback;
}

function incrementDimensionBucket(targetMap, key, { requestCount = 0, billableUnits = 0, estimatedCostUsd = 0 } = {}) {
  const normalizedKey = normalizeDimensionKey(key);
  const existing = targetMap[normalizedKey] || createEmptyDimensionBucket();
  existing.requestCount += Math.max(0, Math.round(safeNumber(requestCount, 0)));
  existing.billableUnits = roundUnits(safeNumber(existing.billableUnits, 0) + safeNumber(billableUnits, 0));
  existing.estimatedCostUsd = roundCurrency(
    safeNumber(existing.estimatedCostUsd, 0) + safeNumber(estimatedCostUsd, 0),
  );
  targetMap[normalizedKey] = existing;
}

function mergeBreakdownMaps(targetMap = {}, incomingMap = {}) {
  Object.entries(incomingMap || {}).forEach(([rawKey, rawEntry]) => {
    const entry = rawEntry || {};
    incrementDimensionBucket(targetMap, rawKey, {
      requestCount: entry.requestCount,
      billableUnits: entry.billableUnits,
      estimatedCostUsd: entry.estimatedCostUsd,
    });
  });
  return targetMap;
}

function mergeSkuBreakdown(currentBreakdown = {}, incomingBreakdown = {}) {
  const merged = {
    ...createEmptySkuBreakdown(),
    ...(currentBreakdown || {}),
  };

  Object.keys(createEmptySkuBreakdown()).forEach((bucketName) => {
    merged[bucketName] = mergeBreakdownMaps(
      safeJsonClone(merged[bucketName], {}),
      incomingBreakdown?.[bucketName] || {},
    );
  });

  return merged;
}

function readCounterFromAliases(section = {}, aliases = []) {
  for (const alias of aliases) {
    const rawValue = section?.[alias];
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return 0;
}

function readCostFromAliases(section = {}, aliases = []) {
  for (const alias of aliases) {
    const rawValue = section?.[alias];
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return roundCurrency(parsed);
    }
  }
  return null;
}

function normalizeOperationSection(section = {}) {
  return {
    reads: readCounterFromAliases(section, ['reads', 'readOps', 'readCount']),
    writes: readCounterFromAliases(section, ['writes', 'writeOps', 'writeCount']),
    estimatedCostUsd: readCostFromAliases(section, ['estimatedCostUsd', 'totalEstimatedCostUsd']),
  };
}

const TELEMETRY_EXCHANGE_RATE_USD_BRL = readPositiveNumberFromEnv(
  process.env.RIDE_COST_TELEMETRY_USD_BRL_RATE,
  process.env.USD_BRL_EXCHANGE_RATE,
  '5.18',
);

const TELEMETRY_BUDGET_USD = readPositiveNumberFromEnv(
  process.env.RIDE_COST_TELEMETRY_BUDGET_USD,
  process.env.RIDE_COST_BUDGET_USD,
  '0.03',
);

const TELEMETRY_OPERATION_RATES = Object.freeze({
  backendAttemptUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_BACKEND_ATTEMPT_USD,
    '0',
  ),
  redisReadUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_REDIS_READ_USD,
    '0',
  ),
  redisWriteUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_REDIS_WRITE_USD,
    '0',
  ),
  firebaseReadUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_FIREBASE_READ_USD,
    '0',
  ),
  firebaseWriteUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_FIREBASE_WRITE_USD,
    '0',
  ),
  databaseReadUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_DATABASE_READ_USD,
    process.env.RIDE_COST_TELEMETRY_DB_READ_USD,
    '0',
  ),
  databaseWriteUsd: readPositiveNumberFromEnv(
    process.env.RIDE_COST_TELEMETRY_DATABASE_WRITE_USD,
    process.env.RIDE_COST_TELEMETRY_DB_WRITE_USD,
    '0',
  ),
});

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
      schemaVersion: 2,
      pricingSheet: null,
      sources: {},
      totals: {
        sourceCount: 0,
        google: {
          requestCount: 0,
          billableUnits: 0,
          estimatedCostUsd: 0,
          skus: {},
          directions: {
            requestCount: 0,
            billableUnits: 0,
            estimatedCostUsd: 0,
            byUserType: {
              driver: 0,
              customer: 0,
              unknown: 0,
            },
            bySurface: {},
            byRouteScope: {},
            byCaller: {},
            byCacheMode: {},
          },
        },
        backend: {
          attempts: 0,
          emits: 0,
          successes: 0,
          errors: 0,
          totalLatencyMs: 0,
          estimatedCostUsd: 0,
          commands: {},
        },
        infrastructure: {
          redis: {
            reads: 0,
            writes: 0,
            estimatedCostUsd: 0,
          },
          firebase: {
            reads: 0,
            writes: 0,
            estimatedCostUsd: 0,
          },
          database: {
            reads: 0,
            writes: 0,
            estimatedCostUsd: 0,
          },
          estimatedCostUsd: 0,
        },
        cost: {
          exchangeRateUsdBrl: TELEMETRY_EXCHANGE_RATE_USD_BRL,
          budgetUsd: TELEMETRY_BUDGET_USD,
          budgetBrl: roundCurrency(TELEMETRY_BUDGET_USD * TELEMETRY_EXCHANGE_RATE_USD_BRL),
          googleUsd: 0,
          backendUsd: 0,
          infrastructureUsd: 0,
          totalUsd: 0,
          totalBrl: 0,
          budgetStatus: TELEMETRY_BUDGET_USD > 0 ? 'within_budget' : 'unconfigured',
          budgetOverrunUsd: 0,
          budgetOverrunBrl: 0,
          operationRates: safeJsonClone(TELEMETRY_OPERATION_RATES, {}),
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
      const sourceMeta = normalizeSourceMeta(sourceEntry?.sourceMeta || {});
      const normalizedUserType = normalizeUserType(sourceMeta.userType);
      const googleSkus = snapshot?.google?.skus || {};
      Object.entries(googleSkus).forEach(([skuKey, skuEntry]) => {
        const aggregateSku = totals.google.skus[skuKey] || {
          label: sanitizeText(skuEntry?.label, skuKey),
          family: sanitizeText(skuEntry?.family, null),
          unit: sanitizeText(skuEntry?.unit, null),
          requestCount: 0,
          billableUnits: 0,
          estimatedCostUsd: 0,
          breakdown: createEmptySkuBreakdown(),
        };

        const requestCount = Math.max(0, Math.round(safeNumber(skuEntry?.requestCount, 0)));
        const billableUnits = safeNumber(skuEntry?.billableUnits, 0);
        const estimatedCostUsd = safeNumber(skuEntry?.estimatedCostUsd, 0);

        aggregateSku.requestCount += requestCount;
        aggregateSku.billableUnits = roundUnits(
          safeNumber(aggregateSku.billableUnits, 0) + billableUnits,
        );
        aggregateSku.estimatedCostUsd = roundCurrency(
          safeNumber(aggregateSku.estimatedCostUsd, 0) + estimatedCostUsd,
        );
        aggregateSku.breakdown = mergeSkuBreakdown(
          aggregateSku.breakdown,
          skuEntry?.breakdown || {},
        );
        totals.google.skus[skuKey] = aggregateSku;

        if (skuKey === 'directionsLegacy') {
          totals.google.directions.requestCount += requestCount;
          totals.google.directions.billableUnits = roundUnits(
            totals.google.directions.billableUnits + billableUnits,
          );
          totals.google.directions.estimatedCostUsd = roundCurrency(
            totals.google.directions.estimatedCostUsd + estimatedCostUsd,
          );
          totals.google.directions.byUserType[normalizedUserType] += requestCount;

          const breakdown = skuEntry?.breakdown || {};
          const hasBreakdown = Object.keys(breakdown || {}).length > 0;
          if (hasBreakdown) {
            totals.google.directions.bySurface = mergeBreakdownMaps(
              totals.google.directions.bySurface,
              breakdown.bySurface || {},
            );
            totals.google.directions.byRouteScope = mergeBreakdownMaps(
              totals.google.directions.byRouteScope,
              breakdown.byRouteScope || {},
            );
            totals.google.directions.byCaller = mergeBreakdownMaps(
              totals.google.directions.byCaller,
              breakdown.byCaller || {},
            );
            totals.google.directions.byCacheMode = mergeBreakdownMaps(
              totals.google.directions.byCacheMode,
              breakdown.byCacheMode || {},
            );
          } else {
            const lastMetadata = skuEntry?.lastMetadata || {};
            const fallbackBucketPayload = {
              requestCount,
              billableUnits,
              estimatedCostUsd,
            };
            incrementDimensionBucket(
              totals.google.directions.bySurface,
              lastMetadata?.telemetrySurface || lastMetadata?.surface || sourceMeta?.surface || 'unknown',
              fallbackBucketPayload,
            );
            incrementDimensionBucket(
              totals.google.directions.byRouteScope,
              lastMetadata?.routeScope || lastMetadata?.routeFamily || 'unknown',
              fallbackBucketPayload,
            );
            incrementDimensionBucket(
              totals.google.directions.byCaller,
              lastMetadata?.callerFrame || lastMetadata?.caller || 'unknown',
              fallbackBucketPayload,
            );
            incrementDimensionBucket(
              totals.google.directions.byCacheMode,
              lastMetadata?.cacheMode || 'unknown',
              fallbackBucketPayload,
            );
          }
        }
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

      const redisSection = normalizeOperationSection(snapshot?.redis || {});
      const firebaseSection = normalizeOperationSection(snapshot?.firebase || {});
      const databaseSection = normalizeOperationSection(snapshot?.database || snapshot?.db || {});

      totals.infrastructure.redis.reads += redisSection.reads;
      totals.infrastructure.redis.writes += redisSection.writes;
      totals.infrastructure.firebase.reads += firebaseSection.reads;
      totals.infrastructure.firebase.writes += firebaseSection.writes;
      totals.infrastructure.database.reads += databaseSection.reads;
      totals.infrastructure.database.writes += databaseSection.writes;

      const redisEstimatedFromRates = roundCurrency(
        (redisSection.reads * TELEMETRY_OPERATION_RATES.redisReadUsd) +
        (redisSection.writes * TELEMETRY_OPERATION_RATES.redisWriteUsd),
      );
      const firebaseEstimatedFromRates = roundCurrency(
        (firebaseSection.reads * TELEMETRY_OPERATION_RATES.firebaseReadUsd) +
        (firebaseSection.writes * TELEMETRY_OPERATION_RATES.firebaseWriteUsd),
      );
      const databaseEstimatedFromRates = roundCurrency(
        (databaseSection.reads * TELEMETRY_OPERATION_RATES.databaseReadUsd) +
        (databaseSection.writes * TELEMETRY_OPERATION_RATES.databaseWriteUsd),
      );

      totals.infrastructure.redis.estimatedCostUsd = roundCurrency(
        totals.infrastructure.redis.estimatedCostUsd +
        (redisSection.estimatedCostUsd !== null ? redisSection.estimatedCostUsd : redisEstimatedFromRates),
      );
      totals.infrastructure.firebase.estimatedCostUsd = roundCurrency(
        totals.infrastructure.firebase.estimatedCostUsd +
        (firebaseSection.estimatedCostUsd !== null ? firebaseSection.estimatedCostUsd : firebaseEstimatedFromRates),
      );
      totals.infrastructure.database.estimatedCostUsd = roundCurrency(
        totals.infrastructure.database.estimatedCostUsd +
        (databaseSection.estimatedCostUsd !== null ? databaseSection.estimatedCostUsd : databaseEstimatedFromRates),
      );
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
    totals.backend.estimatedCostUsd = roundCurrency(
      totals.backend.attempts * TELEMETRY_OPERATION_RATES.backendAttemptUsd,
    );

    totals.infrastructure.estimatedCostUsd = roundCurrency(
      totals.infrastructure.redis.estimatedCostUsd +
      totals.infrastructure.firebase.estimatedCostUsd +
      totals.infrastructure.database.estimatedCostUsd,
    );

    totals.cost.googleUsd = totals.google.estimatedCostUsd;
    totals.cost.backendUsd = totals.backend.estimatedCostUsd;
    totals.cost.infrastructureUsd = totals.infrastructure.estimatedCostUsd;
    totals.cost.totalUsd = roundCurrency(
      totals.cost.googleUsd + totals.cost.backendUsd + totals.cost.infrastructureUsd,
    );
    totals.cost.totalBrl = roundCurrency(totals.cost.totalUsd * TELEMETRY_EXCHANGE_RATE_USD_BRL);
    totals.cost.budgetBrl = roundCurrency(TELEMETRY_BUDGET_USD * TELEMETRY_EXCHANGE_RATE_USD_BRL);
    if (TELEMETRY_BUDGET_USD > 0) {
      totals.cost.budgetStatus =
        totals.cost.totalUsd > TELEMETRY_BUDGET_USD ? 'above_budget' : 'within_budget';
      totals.cost.budgetOverrunUsd = roundCurrency(
        Math.max(0, totals.cost.totalUsd - TELEMETRY_BUDGET_USD),
      );
      totals.cost.budgetOverrunBrl = roundCurrency(
        totals.cost.budgetOverrunUsd * TELEMETRY_EXCHANGE_RATE_USD_BRL,
      );
    } else {
      totals.cost.budgetStatus = 'unconfigured';
      totals.cost.budgetOverrunUsd = 0;
      totals.cost.budgetOverrunBrl = 0;
    }

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
    report.schemaVersion = 2;
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
      costTelemetryTotalUsd: String(report.totals?.cost?.totalUsd || 0),
      costTelemetryTotalBrl: String(report.totals?.cost?.totalBrl || 0),
      costTelemetryBudgetStatus: String(report.totals?.cost?.budgetStatus || 'unknown'),
      costTelemetryDirectionsRequests: String(report.totals?.google?.directions?.requestCount || 0),
      costTelemetryDriverDirectionsRequests: String(report.totals?.google?.directions?.byUserType?.driver || 0),
      costTelemetryPassengerDirectionsRequests: String(report.totals?.google?.directions?.byUserType?.customer || 0),
    });

    logStructured('info', 'Telemetria de custo da corrida atualizada', {
      bookingId: normalizedBookingId,
      sourceKey: normalizedSourceKey,
      eventType: 'rideCostTelemetry',
      googleUsd: report.totals?.google?.estimatedCostUsd || 0,
      googleUnits: report.totals?.google?.billableUnits || 0,
      totalUsd: report.totals?.cost?.totalUsd || 0,
      totalBrl: report.totals?.cost?.totalBrl || 0,
      budgetStatus: report.totals?.cost?.budgetStatus || 'unknown',
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

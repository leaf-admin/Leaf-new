import Logger from '../utils/Logger';

let resolvedAsyncStorage = null;
try {
  // eslint-disable-next-line global-require
  const asyncStorageModule = require('@react-native-async-storage/async-storage');
  resolvedAsyncStorage = asyncStorageModule?.default || asyncStorageModule;
} catch (_error) {
  resolvedAsyncStorage = null;
}

export const RIDE_TELEMETRY_GOOGLE_SKUS = Object.freeze({
  AUTOCOMPLETE_LEGACY_PER_REQUEST: 'autocompleteLegacyPerRequest',
  PLACE_DETAILS_LEGACY: 'placeDetailsLegacy',
  GEOCODING: 'geocoding',
  DIRECTIONS_LEGACY: 'directionsLegacy',
  DISTANCE_MATRIX_LEGACY_ELEMENT: 'distanceMatrixLegacyElement',
});

export const RIDE_TELEMETRY_PRICING_SHEET = Object.freeze({
  provider: 'google_maps_platform',
  currency: 'USD',
  sourceUrl: 'https://developers.google.com/maps/billing-and-pricing/pricing',
  sourceLastUpdatedAt: '2026-03-31',
  verifiedAt: '2026-04-07',
  skus: {
    [RIDE_TELEMETRY_GOOGLE_SKUS.AUTOCOMPLETE_LEGACY_PER_REQUEST]: {
      label: 'Autocomplete - Per Request',
      family: 'Places API Legacy',
      unit: 'request',
      unitPriceUsd: 0.00283,
    },
    [RIDE_TELEMETRY_GOOGLE_SKUS.PLACE_DETAILS_LEGACY]: {
      label: 'Places Details',
      family: 'Places API Legacy',
      unit: 'request',
      unitPriceUsd: 0.017,
    },
    [RIDE_TELEMETRY_GOOGLE_SKUS.GEOCODING]: {
      label: 'Geocoding',
      family: 'Places API (New)',
      unit: 'request',
      unitPriceUsd: 0.005,
    },
    [RIDE_TELEMETRY_GOOGLE_SKUS.DIRECTIONS_LEGACY]: {
      label: 'Directions',
      family: 'Routes APIs Legacy',
      unit: 'request',
      unitPriceUsd: 0.005,
    },
    [RIDE_TELEMETRY_GOOGLE_SKUS.DISTANCE_MATRIX_LEGACY_ELEMENT]: {
      label: 'Distance Matrix',
      family: 'Routes APIs Legacy',
      unit: 'element',
      unitPriceUsd: 0.005,
    },
  },
});

const RECENT_EVENT_LIMIT = 40;
const FLUSH_DEBOUNCE_MS = 1200;
const PERSISTED_REPORT_LIMIT = 60;
const RIDE_TELEMETRY_STORAGE_REPORT_PREFIX = '@ride_cost_telemetry_report_';
const RIDE_TELEMETRY_STORAGE_RECENT_KEY = '@ride_cost_telemetry_recent_reports';

function createId(prefix = 'ctx') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCurrency(value) {
  return Number(safeNumber(value, 0).toFixed(6));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeSourceMeta(meta = {}) {
  return {
    userId: sanitizeText(meta.userId, null),
    userType: sanitizeText(meta.userType, null),
    platform: sanitizeText(meta.platform, null),
    flow: sanitizeText(meta.flow, null),
    scenario: sanitizeText(meta.scenario, null),
    surface: sanitizeText(meta.surface, null),
  };
}

function mergeSourceMeta(current = {}, incoming = {}) {
  const next = { ...current };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      next[key] = value;
    }
  });
  return next;
}

function buildSourceKey(meta = {}, requestedSourceKey = '') {
  const normalizedRequested = sanitizeText(requestedSourceKey, '');
  if (normalizedRequested) {
    return normalizedRequested;
  }

  const normalizedMeta = normalizeSourceMeta(meta);
  return `${normalizedMeta.userType || 'unknown'}:${normalizedMeta.userId || 'anonymous'}`;
}

function isFallbackSourceKey(sourceKey = '') {
  const normalized = sanitizeText(sourceKey, '');
  return normalized === '' || normalized === 'unknown:anonymous';
}

function createEmptyGoogleSection() {
  return {
    skus: {},
    cache: {},
    totalBillableUnits: 0,
    totalEstimatedCostUsd: 0,
  };
}

function createEmptyBackendSection() {
  return {
    commands: {},
    totalAttempts: 0,
    totalEmits: 0,
    totalSuccesses: 0,
    totalErrors: 0,
    totalLatencyMs: 0,
  };
}

function createEmptyInfrastructureSection() {
  return {
    reads: 0,
    writes: 0,
    estimatedCostUsd: 0,
  };
}

function createEmptySkuBreakdownEntry() {
  return {
    requestCount: 0,
    billableUnits: 0,
    estimatedCostUsd: 0,
  };
}

function createEmptySkuBreakdown() {
  return {
    bySurface: {},
    byRouteScope: {},
    byCaller: {},
    byCacheMode: {},
  };
}

function normalizeDimensionValue(rawValue, fallback = 'unknown') {
  const normalized = sanitizeText(rawValue, fallback);
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= 140) {
    return normalized;
  }
  return `${normalized.slice(0, 139)}…`;
}

function incrementBreakdownBucket(targetBucket = {}, rawKey, payload = {}) {
  const key = normalizeDimensionValue(rawKey, 'unknown');
  const currentEntry = targetBucket[key] || createEmptySkuBreakdownEntry();
  currentEntry.requestCount += Math.max(0, Math.round(safeNumber(payload.requestCount, 0)));
  currentEntry.billableUnits = Number(
    (safeNumber(currentEntry.billableUnits, 0) + safeNumber(payload.billableUnits, 0)).toFixed(3),
  );
  currentEntry.estimatedCostUsd = roundCurrency(
    safeNumber(currentEntry.estimatedCostUsd, 0) + safeNumber(payload.estimatedCostUsd, 0),
  );
  targetBucket[key] = currentEntry;
  return targetBucket;
}

function mergeBreakdownBucketMaps(currentBucket = {}, incomingBucket = {}) {
  const merged = clone(currentBucket || {});
  Object.entries(incomingBucket || {}).forEach(([rawKey, rawEntry]) => {
    incrementBreakdownBucket(merged, rawKey, {
      requestCount: rawEntry?.requestCount,
      billableUnits: rawEntry?.billableUnits,
      estimatedCostUsd: rawEntry?.estimatedCostUsd,
    });
  });
  return merged;
}

function mergeSkuBreakdown(currentBreakdown = {}, incomingBreakdown = {}) {
  const merged = {
    ...createEmptySkuBreakdown(),
    ...(currentBreakdown || {}),
  };

  Object.keys(createEmptySkuBreakdown()).forEach((bucketName) => {
    merged[bucketName] = mergeBreakdownBucketMaps(
      merged[bucketName] || {},
      incomingBreakdown?.[bucketName] || {},
    );
  });

  return merged;
}

function createEmptyContextReport({ contextId, bookingId = null, sourceKey, sourceMeta = {} }) {
  const now = new Date().toISOString();
  return {
    contextId,
    bookingId: sanitizeText(bookingId, null),
    sourceKey,
    sourceMeta: normalizeSourceMeta(sourceMeta),
    createdAt: now,
    updatedAt: now,
    google: createEmptyGoogleSection(),
    backend: createEmptyBackendSection(),
    redis: createEmptyInfrastructureSection(),
    firebase: createEmptyInfrastructureSection(),
    database: createEmptyInfrastructureSection(),
    recentEvents: [],
  };
}

function upsertRecentEvent(report, event) {
  const recentEvents = Array.isArray(report.recentEvents) ? [...report.recentEvents] : [];
  recentEvents.push({
    id: createId('evt'),
    at: new Date().toISOString(),
    ...event,
  });
  report.recentEvents = recentEvents.slice(-RECENT_EVENT_LIMIT);
}

function recalculateTotals(report) {
  const googleSkus = Object.values(report.google?.skus || {});
  report.google.totalBillableUnits = Number(
    googleSkus.reduce((acc, entry) => acc + safeNumber(entry.billableUnits, 0), 0).toFixed(3),
  );
  report.google.totalEstimatedCostUsd = roundCurrency(
    googleSkus.reduce((acc, entry) => acc + safeNumber(entry.estimatedCostUsd, 0), 0),
  );

  const backendCommands = Object.values(report.backend?.commands || {});
  report.backend.totalAttempts = backendCommands.reduce(
    (acc, entry) => acc + Math.max(0, Math.round(safeNumber(entry.attempts, 0))),
    0,
  );
  report.backend.totalEmits = backendCommands.reduce(
    (acc, entry) => acc + Math.max(0, Math.round(safeNumber(entry.emits, 0))),
    0,
  );
  report.backend.totalSuccesses = backendCommands.reduce(
    (acc, entry) => acc + Math.max(0, Math.round(safeNumber(entry.successes, 0))),
    0,
  );
  report.backend.totalErrors = backendCommands.reduce(
    (acc, entry) => acc + Math.max(0, Math.round(safeNumber(entry.errors, 0))),
    0,
  );
  report.backend.totalLatencyMs = Math.max(
    0,
    Math.round(
      backendCommands.reduce((acc, entry) => acc + safeNumber(entry.totalLatencyMs, 0), 0),
    ),
  );
}

function mergeGoogleSkuMaps(current = {}, incoming = {}) {
  const merged = clone(current || {});
  Object.entries(incoming || {}).forEach(([skuKey, incomingEntry]) => {
    if (!incomingEntry || typeof incomingEntry !== 'object') {
      return;
    }

    const existingEntry = merged[skuKey] || {
      skuKey: incomingEntry.skuKey || skuKey,
      label: incomingEntry.label || null,
      family: incomingEntry.family || null,
      unit: incomingEntry.unit || null,
      unitPriceUsd: safeNumber(incomingEntry.unitPriceUsd, 0),
      requestCount: 0,
      billableUnits: 0,
      estimatedCostUsd: 0,
      breakdown: createEmptySkuBreakdown(),
      lastMetadata: null,
      lastUpdatedAt: null,
    };

    existingEntry.requestCount += Math.max(
      0,
      Math.round(safeNumber(incomingEntry.requestCount, 0)),
    );
    existingEntry.billableUnits = Number(
      (
        safeNumber(existingEntry.billableUnits, 0) +
        safeNumber(incomingEntry.billableUnits, 0)
      ).toFixed(3),
    );
    existingEntry.estimatedCostUsd = roundCurrency(
      safeNumber(existingEntry.estimatedCostUsd, 0) +
        safeNumber(incomingEntry.estimatedCostUsd, 0),
    );
    existingEntry.breakdown = mergeSkuBreakdown(
      existingEntry.breakdown,
      incomingEntry.breakdown || {},
    );
    existingEntry.lastMetadata =
      incomingEntry.lastMetadata !== null && incomingEntry.lastMetadata !== undefined
        ? clone(incomingEntry.lastMetadata)
        : existingEntry.lastMetadata;
    existingEntry.lastUpdatedAt =
      incomingEntry.lastUpdatedAt || existingEntry.lastUpdatedAt || null;
    merged[skuKey] = existingEntry;
  });
  return merged;
}

function mergeBackendCommands(current = {}, incoming = {}) {
  const merged = clone(current || {});
  Object.entries(incoming || {}).forEach(([commandName, incomingEntry]) => {
    if (!incomingEntry || typeof incomingEntry !== 'object') {
      return;
    }

    const existingEntry = merged[commandName] || {
      attempts: 0,
      emits: 0,
      successes: 0,
      errors: 0,
      totalLatencyMs: 0,
      lastLatencyMs: null,
      lastStatus: null,
      lastErrorCode: null,
      lastMetadata: null,
      lastUpdatedAt: null,
    };

    existingEntry.attempts += Math.max(0, Math.round(safeNumber(incomingEntry.attempts, 0)));
    existingEntry.emits += Math.max(0, Math.round(safeNumber(incomingEntry.emits, 0)));
    existingEntry.successes += Math.max(
      0,
      Math.round(safeNumber(incomingEntry.successes, 0)),
    );
    existingEntry.errors += Math.max(0, Math.round(safeNumber(incomingEntry.errors, 0)));
    existingEntry.totalLatencyMs += Math.max(
      0,
      Math.round(safeNumber(incomingEntry.totalLatencyMs, 0)),
    );
    existingEntry.lastLatencyMs =
      incomingEntry.lastLatencyMs ?? existingEntry.lastLatencyMs ?? null;
    existingEntry.lastStatus = incomingEntry.lastStatus || existingEntry.lastStatus || null;
    existingEntry.lastErrorCode =
      incomingEntry.lastErrorCode || existingEntry.lastErrorCode || null;
    existingEntry.lastMetadata =
      incomingEntry.lastMetadata !== null && incomingEntry.lastMetadata !== undefined
        ? clone(incomingEntry.lastMetadata)
        : existingEntry.lastMetadata;
    existingEntry.lastUpdatedAt =
      incomingEntry.lastUpdatedAt || existingEntry.lastUpdatedAt || null;
    merged[commandName] = existingEntry;
  });
  return merged;
}

function mergeRecentEventLists(current = [], incoming = []) {
  const merged = [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])]
    .filter(Boolean)
    .sort((left, right) => {
      const leftAt = Date.parse(left?.at || 0) || 0;
      const rightAt = Date.parse(right?.at || 0) || 0;
      return leftAt - rightAt;
    });
  return merged.slice(-RECENT_EVENT_LIMIT);
}

function mergeContextReports(targetReport, incomingReport, overrides = {}) {
  if (!targetReport || typeof targetReport !== 'object') {
    return incomingReport;
  }
  if (!incomingReport || typeof incomingReport !== 'object') {
    return targetReport;
  }

  targetReport.bookingId =
    sanitizeText(overrides.bookingId, null) ||
    sanitizeText(targetReport.bookingId, null) ||
    sanitizeText(incomingReport.bookingId, null);
  targetReport.sourceKey =
    sanitizeText(overrides.sourceKey, '') ||
    sanitizeText(targetReport.sourceKey, '') ||
    sanitizeText(incomingReport.sourceKey, '');
  targetReport.sourceMeta = mergeSourceMeta(
    mergeSourceMeta(targetReport.sourceMeta, incomingReport.sourceMeta),
    overrides.sourceMeta || {},
  );
  targetReport.google = {
    ...(targetReport.google || createEmptyGoogleSection()),
    skus: mergeGoogleSkuMaps(targetReport.google?.skus, incomingReport.google?.skus),
    cache: {
      ...(targetReport.google?.cache || {}),
      ...(incomingReport.google?.cache || {}),
    },
  };
  targetReport.backend = {
    ...(targetReport.backend || createEmptyBackendSection()),
    commands: mergeBackendCommands(
      targetReport.backend?.commands,
      incomingReport.backend?.commands,
    ),
  };
  targetReport.redis = {
    ...createEmptyInfrastructureSection(),
    ...(targetReport.redis || {}),
    ...(incomingReport.redis || {}),
  };
  targetReport.firebase = {
    ...createEmptyInfrastructureSection(),
    ...(targetReport.firebase || {}),
    ...(incomingReport.firebase || {}),
  };
  targetReport.database = {
    ...createEmptyInfrastructureSection(),
    ...(targetReport.database || {}),
    ...(incomingReport.database || {}),
  };
  targetReport.recentEvents = mergeRecentEventLists(
    targetReport.recentEvents,
    incomingReport.recentEvents,
  );
  targetReport.createdAt =
    targetReport.createdAt && incomingReport.createdAt
      ? new Date(
          Math.min(
            Date.parse(targetReport.createdAt) || Date.now(),
            Date.parse(incomingReport.createdAt) || Date.now(),
          ),
        ).toISOString()
      : targetReport.createdAt || incomingReport.createdAt || new Date().toISOString();
  targetReport.updatedAt = new Date(
    Math.max(
      Date.parse(targetReport.updatedAt || 0) || 0,
      Date.parse(incomingReport.updatedAt || 0) || 0,
      Date.now(),
    ),
  ).toISOString();
  recalculateTotals(targetReport);
  return targetReport;
}

class RideCostTelemetryService {
  constructor() {
    this.resetForTests();
  }

  setPublisher(publisher) {
    this.publisher = typeof publisher === 'function' ? publisher : null;
  }

  async persistContext(context = {}) {
    if (!this.storageAdapter?.setItem || !this.storageAdapter?.getItem) {
      return false;
    }

    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    if (!report?.bookingId) {
      return false;
    }

    const persistedAt = new Date().toISOString();
    const storageKey = `${RIDE_TELEMETRY_STORAGE_REPORT_PREFIX}${report.bookingId}::${report.sourceKey}`;
    const payload = {
      storageKey,
      persistedAt,
      bookingId: report.bookingId,
      sourceKey: report.sourceKey,
      sourceMeta: clone(report.sourceMeta),
      pricingSheet: clone(RIDE_TELEMETRY_PRICING_SHEET),
      snapshot: this.getSnapshot({ contextId: resolved.contextId }),
    };

    try {
      await this.storageAdapter.setItem(storageKey, JSON.stringify(payload));
      const rawRecentReports = await this.storageAdapter.getItem(RIDE_TELEMETRY_STORAGE_RECENT_KEY);
      const parsedRecentReports = rawRecentReports ? JSON.parse(rawRecentReports) : [];
      const nextRecentReports = Array.isArray(parsedRecentReports)
        ? parsedRecentReports.filter((entry) => entry?.storageKey !== storageKey)
        : [];

      nextRecentReports.unshift({
        storageKey,
        bookingId: report.bookingId,
        sourceKey: report.sourceKey,
        persistedAt,
      });

      await this.storageAdapter.setItem(
        RIDE_TELEMETRY_STORAGE_RECENT_KEY,
        JSON.stringify(nextRecentReports.slice(0, PERSISTED_REPORT_LIMIT)),
      );

      return true;
    } catch (error) {
      Logger.warn(
        '⚠️ [RideCostTelemetry] Falha ao persistir telemetria local da corrida:',
        error?.message || error,
      );
      return false;
    }
  }

  ensureContext(context = {}) {
    const sourceMeta = normalizeSourceMeta(context.sourceMeta || {});
    const bookingId = sanitizeText(context.bookingId, null);
    const requestedSourceKey = buildSourceKey(sourceMeta, context.sourceKey);
    let contextId = sanitizeText(context.contextId, '');

    if (!contextId && bookingId) {
      contextId =
        this.bookingSourceIndex.get(`${bookingId}:${requestedSourceKey}`) || '';
    }

    if (!contextId && !bookingId) {
      const draftContextId =
        this.openDraftContextBySource.get(requestedSourceKey) || '';
      if (draftContextId) {
        const draftReport = this.contexts.get(draftContextId);
        if (draftReport && !draftReport.bookingId) {
          contextId = draftContextId;
        } else {
          this.openDraftContextBySource.delete(requestedSourceKey);
        }
      }
    }

    if (!contextId) {
      contextId = bookingId
        ? `ride_${bookingId}_${requestedSourceKey}`
        : `draft_${createId(
            requestedSourceKey.replace(/[^a-z0-9:_-]/gi, '_'),
          )}`;
    }

    const existing = this.contexts.get(contextId);
    const sourceKey =
      existing &&
      !isFallbackSourceKey(existing.sourceKey) &&
      isFallbackSourceKey(requestedSourceKey)
        ? existing.sourceKey
        : requestedSourceKey;
    const report = existing || createEmptyContextReport({
      contextId,
      bookingId,
      sourceKey,
      sourceMeta,
    });
    const effectiveBookingId = bookingId || report.bookingId || null;

    report.sourceKey = sourceKey;
    report.sourceMeta = mergeSourceMeta(report.sourceMeta, sourceMeta);

    if (effectiveBookingId) {
      report.bookingId = effectiveBookingId;
      this.bookingSourceIndex.set(`${effectiveBookingId}:${sourceKey}`, contextId);
      if (this.openDraftContextBySource.get(sourceKey) === contextId) {
        this.openDraftContextBySource.delete(sourceKey);
      }
    } else {
      this.openDraftContextBySource.set(sourceKey, contextId);
    }

    report.updatedAt = new Date().toISOString();
    this.contexts.set(contextId, report);

    return {
      contextId,
      bookingId: report.bookingId,
      sourceKey,
      sourceMeta: clone(report.sourceMeta),
    };
  }

  rotateDraftContext(context = {}) {
    const sourceMeta = normalizeSourceMeta(context.sourceMeta || {});
    const sourceKey = buildSourceKey(sourceMeta, context.sourceKey);
    const currentDraftContextId = this.openDraftContextBySource.get(sourceKey) || null;

    if (currentDraftContextId) {
      this.openDraftContextBySource.delete(sourceKey);
    }

    return this.ensureContext({
      ...context,
      contextId: null,
      bookingId: null,
      sourceKey,
      sourceMeta,
    });
  }

  bindContextToBooking({ contextId, bookingId, sourceKey, sourceMeta } = {}) {
    const normalizedBookingId = sanitizeText(bookingId, null);
    if (!normalizedBookingId) {
      return null;
    }

    const resolved = this.ensureContext({
      contextId,
      sourceKey,
      sourceMeta,
    });
    let activeContextId = resolved.contextId;
    let report = this.contexts.get(activeContextId);
    const previousBookingId = sanitizeText(report?.bookingId, null);
    const targetContextId =
      this.bookingSourceIndex.get(`${normalizedBookingId}:${report.sourceKey}`) || null;

    if (targetContextId && targetContextId !== activeContextId) {
      const targetReport = this.contexts.get(targetContextId);
      if (targetReport) {
        report = mergeContextReports(targetReport, report, {
          bookingId: normalizedBookingId,
          sourceKey: targetReport.sourceKey || report.sourceKey,
          sourceMeta,
        });
        this.contexts.set(targetContextId, report);
        this.contexts.delete(activeContextId);
        if (this.flushTimers.has(activeContextId)) {
          clearTimeout(this.flushTimers.get(activeContextId));
          this.flushTimers.delete(activeContextId);
        }
        activeContextId = targetContextId;
      }
    }

    if (previousBookingId && previousBookingId !== normalizedBookingId) {
      this.bookingSourceIndex.delete(`${previousBookingId}:${report.sourceKey}`);
    }

    report.bookingId = normalizedBookingId;
    report.updatedAt = new Date().toISOString();
    this.contexts.set(activeContextId, report);
    this.bookingSourceIndex.set(`${normalizedBookingId}:${report.sourceKey}`, activeContextId);
    if (this.openDraftContextBySource.get(report.sourceKey) === activeContextId) {
      this.openDraftContextBySource.delete(report.sourceKey);
    }

    this.scheduleFlush(activeContextId);
    return {
      contextId: activeContextId,
      bookingId: normalizedBookingId,
      sourceKey: report.sourceKey,
      sourceMeta: clone(report.sourceMeta),
    };
  }

  persistContextSoon(context = {}) {
    Promise.resolve()
      .then(() => this.persistContext(context))
      .catch(() => false);
  }

  flushContextSoon(context = {}) {
    Promise.resolve()
      .then(() => this.flushContext(context))
      .catch(() => false);
  }

  recordGoogleUsage(skuKey, options = {}, context = {}) {
    const pricingEntry = RIDE_TELEMETRY_PRICING_SHEET.skus?.[skuKey];
    if (!pricingEntry) {
      Logger.warn(`⚠️ [RideCostTelemetry] SKU Google desconhecido: ${skuKey}`);
      return null;
    }

    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    const existingSku = report.google.skus[skuKey] || {
      skuKey,
      label: pricingEntry.label,
      family: pricingEntry.family,
      unit: pricingEntry.unit,
      unitPriceUsd: pricingEntry.unitPriceUsd,
      requestCount: 0,
      billableUnits: 0,
      estimatedCostUsd: 0,
      breakdown: createEmptySkuBreakdown(),
      lastMetadata: null,
      lastUpdatedAt: null,
    };
    existingSku.breakdown = mergeSkuBreakdown(existingSku.breakdown, {});

    const requestCount = Math.max(1, Math.round(safeNumber(options.requestCount, 1)));
    const billableUnits = Math.max(0, safeNumber(options.billableUnits, 1));
    const estimatedCostUsd = roundCurrency(
      options.countAsFree === true
        ? 0
        : billableUnits * safeNumber(pricingEntry.unitPriceUsd, 0),
    );

    existingSku.requestCount += requestCount;
    existingSku.billableUnits = Number((safeNumber(existingSku.billableUnits, 0) + billableUnits).toFixed(3));
    existingSku.estimatedCostUsd = roundCurrency(
      safeNumber(existingSku.estimatedCostUsd, 0) + estimatedCostUsd,
    );
    const metadata = options.metadata ? clone(options.metadata) : null;
    const breakdownPayload = { requestCount, billableUnits, estimatedCostUsd };
    incrementBreakdownBucket(
      existingSku.breakdown.bySurface,
      metadata?.telemetrySurface || metadata?.surface || context?.sourceMeta?.surface || context?.surface || 'unknown',
      breakdownPayload,
    );
    incrementBreakdownBucket(
      existingSku.breakdown.byRouteScope,
      metadata?.routeScope || metadata?.routeFamily || context?.routeScope || context?.routeFamily || 'unknown',
      breakdownPayload,
    );
    incrementBreakdownBucket(
      existingSku.breakdown.byCaller,
      metadata?.callerFrame || metadata?.caller || 'unknown',
      breakdownPayload,
    );
    incrementBreakdownBucket(
      existingSku.breakdown.byCacheMode,
      metadata?.cacheMode || context?.cacheMode || 'unknown',
      breakdownPayload,
    );
    existingSku.lastMetadata = metadata;
    existingSku.lastUpdatedAt = new Date().toISOString();

    report.google.skus[skuKey] = existingSku;
    report.updatedAt = existingSku.lastUpdatedAt;
    upsertRecentEvent(report, {
      category: 'google',
      name: skuKey,
      requestCount,
      billableUnits,
      estimatedCostUsd,
      metadata: options.metadata ? clone(options.metadata) : null,
    });
    recalculateTotals(report);
    this.contexts.set(resolved.contextId, report);
    this.scheduleFlush(resolved.contextId);

    return clone(existingSku);
  }

  recordGoogleCache(cacheKey, options = {}, context = {}) {
    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    const currentHits = Math.max(0, Math.round(safeNumber(report.google.cache?.[cacheKey], 0)));
    report.google.cache[cacheKey] = currentHits + Math.max(1, Math.round(safeNumber(options.count, 1)));
    report.updatedAt = new Date().toISOString();
    upsertRecentEvent(report, {
      category: 'google_cache',
      name: cacheKey,
      metadata: options.metadata ? clone(options.metadata) : null,
    });
    this.contexts.set(resolved.contextId, report);
    this.scheduleFlush(resolved.contextId);
    return report.google.cache[cacheKey];
  }

  recordBackendCommand(commandName, options = {}, context = {}) {
    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    const normalizedCommandName = sanitizeText(commandName, 'unknownCommand');
    const phase = sanitizeText(options.phase, 'attempt');
    const entry = report.backend.commands[normalizedCommandName] || {
      attempts: 0,
      emits: 0,
      successes: 0,
      errors: 0,
      totalLatencyMs: 0,
      lastLatencyMs: null,
      lastStatus: null,
      lastErrorCode: null,
      lastMetadata: null,
      lastUpdatedAt: null,
    };

    if (phase === 'attempt') {
      entry.attempts += 1;
    } else if (phase === 'emit') {
      entry.attempts += 1;
      entry.emits += 1;
    } else if (phase === 'success') {
      entry.successes += 1;
    } else if (phase === 'error') {
      entry.errors += 1;
      entry.lastErrorCode = sanitizeText(options.errorCode, null);
    }

    const latencyMs = Math.max(0, Math.round(safeNumber(options.latencyMs, 0)));
    if (latencyMs > 0) {
      entry.totalLatencyMs += latencyMs;
      entry.lastLatencyMs = latencyMs;
    }

    entry.lastStatus = phase;
    entry.lastMetadata = options.metadata ? clone(options.metadata) : null;
    entry.lastUpdatedAt = new Date().toISOString();
    report.backend.commands[normalizedCommandName] = entry;
    report.updatedAt = entry.lastUpdatedAt;
    upsertRecentEvent(report, {
      category: 'backend',
      name: normalizedCommandName,
      phase,
      latencyMs: latencyMs || null,
      errorCode: entry.lastErrorCode,
      metadata: options.metadata ? clone(options.metadata) : null,
    });
    recalculateTotals(report);
    this.contexts.set(resolved.contextId, report);
    this.scheduleFlush(resolved.contextId);

    return clone(entry);
  }

  buildCreateBookingPayload(context = {}) {
    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    return {
      contextId: resolved.contextId,
      sourceKey: report.sourceKey,
      sourceMeta: clone(report.sourceMeta),
      pricingSheet: clone(RIDE_TELEMETRY_PRICING_SHEET),
      snapshot: this.getSnapshot({ contextId: resolved.contextId }),
    };
  }

  getSnapshot(context = {}) {
    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    recalculateTotals(report);
    return clone({
      contextId: report.contextId,
      bookingId: report.bookingId,
      sourceKey: report.sourceKey,
      sourceMeta: report.sourceMeta,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      google: report.google,
      backend: report.backend,
      redis: report.redis || createEmptyInfrastructureSection(),
      firebase: report.firebase || createEmptyInfrastructureSection(),
      database: report.database || createEmptyInfrastructureSection(),
      recentEvents: report.recentEvents,
    });
  }

  async flushContext(context = {}) {
    if (!this.publisher) {
      return false;
    }

    const resolved = this.ensureContext(context);
    const report = this.contexts.get(resolved.contextId);
    if (!report?.bookingId) {
      return false;
    }

    try {
      const result = await this.publisher({
        bookingId: report.bookingId,
        sourceKey: report.sourceKey,
        sourceMeta: clone(report.sourceMeta),
        pricingSheet: clone(RIDE_TELEMETRY_PRICING_SHEET),
        snapshot: this.getSnapshot({ contextId: resolved.contextId }),
      });
      return result !== false;
    } catch (error) {
      Logger.warn(
        '⚠️ [RideCostTelemetry] Falha ao publicar telemetria da corrida:',
        error?.message || error,
      );
      return false;
    }
  }

  async flushAllBoundContexts() {
    const entries = Array.from(this.contexts.values())
      .filter((report) => report?.bookingId)
      .map((report) => report.contextId);
    for (const contextId of entries) {
      await this.flushContext({ contextId });
    }
  }

  scheduleFlush(contextId) {
    const normalizedContextId = sanitizeText(contextId, '');
    if (!normalizedContextId || this.flushTimers.has(normalizedContextId)) {
      return;
    }

    const report = this.contexts.get(normalizedContextId);
    if (!report?.bookingId || (!this.publisher && !this.storageAdapter?.setItem)) {
      return;
    }

    const timer = setTimeout(async () => {
      this.flushTimers.delete(normalizedContextId);
      await Promise.allSettled([
        this.flushContext({ contextId: normalizedContextId }),
        this.persistContext({ contextId: normalizedContextId }),
      ]);
    }, FLUSH_DEBOUNCE_MS);

    this.flushTimers.set(normalizedContextId, timer);
  }

  resetForTests() {
    this.contexts = new Map();
    this.bookingSourceIndex = new Map();
    this.openDraftContextBySource = new Map();
    for (const timer of this.flushTimers?.values?.() || []) {
      clearTimeout(timer);
    }
    this.flushTimers = new Map();
    this.publisher = null;
    this.storageAdapter = resolvedAsyncStorage;
  }
}

const rideCostTelemetryService = new RideCostTelemetryService();

export default rideCostTelemetryService;

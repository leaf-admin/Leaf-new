const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const paymentRuntimeProfileService = require('./payment-runtime-profile-service');
const { getPilotLaunchFlags } = require('../utils/pilot-launch-flags');
const {
  evaluateProductionReadiness,
  resolveBiometricPolicy,
  readBooleanLike
} = require('./kyc-biometric-production-policy');
const { logStructured, logError } = require('../utils/logger');

const OVERRIDES_COLLECTION = 'runtime_config_overrides';
const HISTORY_COLLECTION = 'runtime_config_history';
const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const DEFAULT_PUBLIC_CACHE_TTL_SECONDS = 60;
const DEFAULT_STALE_TTL_SECONDS = 15 * 60;

const SAFE_OVERRIDE_DOMAINS = new Set([
  'featureGates',
  'mapsRoutingPolicy',
  'notificationPolicy',
  'driverOnlinePolicy',
  'campaignSurfaces',
  'legalUrls',
  'supportPolicy',
  'biometricRuntime'
]);

const CRITICAL_DOMAINS = new Set([
  'paymentRuntime',
  'biometricRuntime',
  'driverOnlinePolicy',
  'mapsRoutingPolicy'
]);

function normalizeEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['production', 'prod'].includes(normalized)) return 'production';
  if (['sandbox', 'staging', 'stage'].includes(normalized)) return 'sandbox';
  if (normalized === 'development') return 'development';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function normalizeStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['active', 'paused', 'archived'].includes(normalized)) return normalized;
  return 'paused';
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value, fallback = false) {
  return readBooleanLike(value, fallback);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTime(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  const ms = parseTime(value);
  return ms ? new Date(ms).toISOString() : null;
}

function isExpired(record = {}, nowMs = Date.now()) {
  const expiresAtMs = parseTime(record.expiresAtIso || record.expiresAt);
  return Boolean(expiresAtMs && expiresAtMs <= nowMs);
}

function hasStarted(record = {}, nowMs = Date.now()) {
  const startsAtMs = parseTime(record.startsAtIso || record.startsAt);
  return !startsAtMs || startsAtMs <= nowMs;
}

function profileRank(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (normalized === 'users') return 10;
  if (normalized === 'phones') return 9;
  if (normalized === 'canary') return 8;
  if (normalized === 'app_review') return 7;
  if (normalized === 'global') return 1;
  return 0;
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return base;
  }

  const output = { ...(base || {}) };
  Object.entries(override).forEach(([key, value]) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  });
  return output;
}

function sanitizeOverrideConfig(config = {}) {
  const sanitized = {};
  Object.entries(config || {}).forEach(([domain, value]) => {
    if (SAFE_OVERRIDE_DOMAINS.has(domain)) {
      sanitized[domain] = value;
    }
  });
  return sanitized;
}

function sanitizeOverrideForResponse(record = {}) {
  const sanitized = {
    ...record,
    config: sanitizeOverrideConfig(record.config || {})
  };
  delete sanitized.secret;
  delete sanitized.apiKey;
  delete sanitized.token;
  delete sanitized.credentials;
  return sanitized;
}

function buildContextIdentity(context = {}) {
  const userIds = [
    context.userId,
    context.uid,
    context.passengerId,
    context.driverId,
    context.actor?.uid,
    context.actor?.id
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const phones = [
    context.phone,
    context.phoneNumber,
    context.actor?.phone,
    context.actor?.phoneNumber
  ].map(normalizeDigits).filter(Boolean);

  return { userIds, phones };
}

class RuntimeConfigService {
  constructor(options = {}) {
    this.cacheTtlMs = Number.parseInt(
      options.cacheTtlMs || process.env.RUNTIME_CONFIG_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS,
      10
    );
    this.cache = {
      loadedAt: 0,
      overrides: []
    };
  }

  getFirestore() {
    return firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null;
  }

  async loadOverrides({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache.loadedAt &&
      now - this.cache.loadedAt < this.cacheTtlMs
    ) {
      return this.cache.overrides;
    }

    const firestore = this.getFirestore();
    if (!firestore) {
      this.cache = { loadedAt: now, overrides: [] };
      return [];
    }

    try {
      const snapshot = await firestore
        .collection(OVERRIDES_COLLECTION)
        .where('status', '==', 'active')
        .limit(100)
        .get();
      const overrides = snapshot.docs.map((doc) => ({
        overrideId: doc.id,
        id: doc.id,
        ...doc.data(),
        source: 'firestore'
      }));
      this.cache = { loadedAt: now, overrides };
      return overrides;
    } catch (error) {
      logStructured('warn', 'Falha ao carregar runtime config overrides; usando defaults', {
        service: 'runtime-config-service',
        error: error.message
      });
      this.cache = { loadedAt: now, overrides: [] };
      return [];
    }
  }

  overrideMatches(override = {}, context = {}) {
    if (normalizeStatus(override.status) !== 'active') return false;
    if (isExpired(override) || !hasStarted(override)) return false;

    const scope = String(override.scope || 'global').trim().toLowerCase();
    if (scope === 'global') return true;
    if (scope === 'app_review') return Boolean(context.appReview);

    const identity = buildContextIdentity(context);
    const userIds = new Set(splitList(override.userIds));
    const phones = new Set(splitList(override.phones || override.phoneNumbers).map(normalizeDigits).filter(Boolean));

    if (scope === 'users') return identity.userIds.some((id) => userIds.has(id));
    if (scope === 'phones') return identity.phones.some((phone) => phones.has(phone));
    if (scope === 'canary') {
      return (
        identity.userIds.some((id) => userIds.has(id)) ||
        identity.phones.some((phone) => phones.has(phone))
      );
    }

    return false;
  }

  buildBaseConfig() {
    const launch = getPilotLaunchFlags();
    const biometricReadiness = evaluateProductionReadiness();
    const biometricPolicy = resolveBiometricPolicy();

    return {
      schemaVersion: 1,
      source: 'backend',
      environment: normalizeEnvironment(process.env.LEAF_ENV || process.env.APP_ENV || process.env.NODE_ENV),
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: toInt(process.env.RUNTIME_CONFIG_PUBLIC_CACHE_TTL_SECONDS, DEFAULT_PUBLIC_CACHE_TTL_SECONDS),
      staleTtlSeconds: toInt(process.env.RUNTIME_CONFIG_STALE_TTL_SECONDS, DEFAULT_STALE_TTL_SECONDS),
      paymentRuntime: {
        provider: 'woovi',
        source: 'backend_profile_service',
        appMayCallProviderDirectly: false,
        requiresBackendChargeCreation: true,
        splitRealEnabled: toBoolean(process.env.ENABLE_WOOVI_SPLIT_REAL, false),
        withdrawalsEnabled: launch.driverWithdrawalsEnabled === true,
        sandboxControlledByBackend: true
      },
      biometricRuntime: {
        strictModeEnabled: biometricPolicy.productionBiometricsEnabled === true,
        requireTrustedBiometricMatch: biometricPolicy.requireTrustedBiometricMatch === true,
        allowLegacyDeviceSignature: biometricPolicy.allowLegacyDeviceSignature === true,
        allowAwsLivenessOnlyMatch: biometricPolicy.allowAwsLivenessOnlyMatch === true,
        trustedMatchProviders: biometricPolicy.trustedMatchProviders || [],
        readiness: {
          ok: biometricReadiness.ok === true,
          state: biometricReadiness.state,
          warnings: biometricReadiness.warnings || [],
          blockers: biometricReadiness.blockers || []
        }
      },
      featureGates: {
        ...launch,
        demandPredictionEnabled: launch.demandPredictionEnabled === true,
        smartPushEnabled: launch.smartPushEnabled === true,
        biometricStrictModeEnabled: biometricPolicy.productionBiometricsEnabled === true
      },
      mapsRoutingPolicy: {
        backendOnly: true,
        clientDirectGoogleFallback: false,
        placesCacheEnabled: true,
        routesCacheEnabled: true,
        routeTrafficEnabled: toBoolean(process.env.ENABLE_TRAFFIC_ROUTE, false),
        routeAlternativesEnabled: toBoolean(process.env.ENABLE_ROUTE_ALTERNATIVES, false),
        placesCacheTtlSeconds: toInt(process.env.PLACES_CACHE_TTL_SECONDS, 30 * 24 * 60 * 60),
        routesCacheTtlSeconds: toInt(process.env.ROUTES_CACHE_TTL_SECONDS, 2 * 60)
      },
      notificationPolicy: {
        enabled: true,
        smartPushMode: launch.smartPushEnabled ? 'enabled' : 'disabled',
        persistentRideNotificationsEnabled: true,
        androidNativePersistentSlotEnabled: true,
        androidPersistentNotificationId: 43001,
        iosLiveActivityEnabled: toBoolean(process.env.ENABLE_IOS_RIDE_LIVE_ACTIVITY, false),
        iosLiveActivityMode: toBoolean(process.env.ENABLE_IOS_RIDE_LIVE_ACTIVITY, false) ? 'live_activity' : 'disabled',
        iosNotificationFallbackEnabled: true,
        dedupeWindowSeconds: toInt(process.env.NOTIFICATION_DEDUPE_WINDOW_SECONDS, 60),
        defaultTtlSeconds: toInt(process.env.NOTIFICATION_DEFAULT_TTL_SECONDS, 3600),
        androidChannels: ['ride_status', 'driver_actions', 'payments', 'default'],
        iosCategories: ['ride_status_update', 'payment_update', 'identity_reverification'],
        suppressMarketingDuringActiveRide: true
      },
      driverOnlinePolicy: {
        backendAuthoritative: true,
        requireApprovedDocuments: true,
        requireApprovedVehicle: true,
        requireLivenessWhenStale: true,
        neverInterruptActiveRide: true,
        geofenceEnforced: toBoolean(process.env.ENABLE_DRIVER_ONLINE_GEOFENCE, false),
        minimumAppVersion: process.env.DRIVER_ONLINE_MIN_APP_VERSION || null
      },
      campaignSurfaces: {
        passengerHome: true,
        driverHome: true,
        support: true,
        dashboardManaged: true
      },
      legalUrls: {
        privacy: process.env.LEAF_PRIVACY_URL || 'https://leaf.app.br/privacy',
        terms: process.env.LEAF_TERMS_URL || 'https://leaf.app.br/terms',
        deletion: process.env.LEAF_ACCOUNT_DELETION_URL || 'https://leaf.app.br/account/delete'
      },
      supportPolicy: {
        supportChatEnabled: true,
        ticketEscalationEnabled: true,
        supportCopilotMode: process.env.SUPPORT_COPILOT_MODE || 'guarded',
        autoReplyEnabled: false
      }
    };
  }

  async buildEffectiveConfig(context = {}, options = {}) {
    const base = this.buildBaseConfig();
    const overrides = await this.loadOverrides({ forceRefresh: options.forceRefresh });
    const matches = overrides
      .filter((override) => this.overrideMatches(override, context))
      .sort((left, right) => {
        const byRank = profileRank(right.scope) - profileRank(left.scope);
        if (byRank !== 0) return byRank;
        return Number(right.priority || 0) - Number(left.priority || 0);
      });

    let effective = base;
    const appliedOverrides = [];
    matches.forEach((override) => {
      const config = sanitizeOverrideConfig(override.config || {});
      if (Object.keys(config).length === 0) return;
      effective = deepMerge(effective, config);
      appliedOverrides.push({
        overrideId: override.overrideId || override.id,
        name: override.name || override.overrideId || override.id,
        scope: override.scope || 'global',
        priority: Number(override.priority || 0),
        criticalDomains: Object.keys(config).filter((domain) => CRITICAL_DOMAINS.has(domain))
      });
    });

    let paymentRuntimeSummary = null;
    try {
      paymentRuntimeSummary = await paymentRuntimeProfileService.getRuntimeSummary({
        forceRefresh: options.forceRefresh
      });
    } catch (error) {
      logStructured('warn', 'Falha ao anexar summary de payment runtime', {
        service: 'runtime-config-service',
        error: error.message
      });
    }

    return {
      ...effective,
      generatedAt: new Date().toISOString(),
      appliedOverrides,
      paymentRuntime: {
        ...effective.paymentRuntime,
        summary: paymentRuntimeSummary
          ? {
              defaultEnvironment: paymentRuntimeSummary.defaultEnvironment,
              canarySandboxEnabled: paymentRuntimeSummary.canarySandboxEnabled,
              globalSandboxEnabled: paymentRuntimeSummary.globalSandboxEnabled,
              activeProfileCount: paymentRuntimeSummary.activeProfileCount
            }
          : null
      }
    };
  }

  async listOverrides({ includeInactive = true } = {}) {
    const firestore = this.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    let query = firestore.collection(OVERRIDES_COLLECTION);
    if (!includeInactive) query = query.where('status', '==', 'active');
    const snapshot = await query.limit(100).get();
    return {
      success: true,
      overrides: snapshot.docs.map((doc) => sanitizeOverrideForResponse({
        overrideId: doc.id,
        id: doc.id,
        ...doc.data()
      }))
    };
  }

  validateOverridePayload(payload = {}) {
    const status = normalizeStatus(payload.status || 'paused');
    const scope = String(payload.scope || 'canary').trim().toLowerCase();
    const config = sanitizeOverrideConfig(payload.config || {});

    if (!['global', 'users', 'phones', 'canary', 'app_review'].includes(scope)) {
      return { ok: false, error: 'scope inválido para runtime override' };
    }
    if (!['active', 'paused', 'archived'].includes(status)) {
      return { ok: false, error: 'status inválido para runtime override' };
    }
    if (Object.keys(config).length === 0) {
      return { ok: false, error: 'config precisa conter pelo menos um domínio permitido' };
    }
    if (['users', 'phones', 'canary'].includes(scope)) {
      const hasUsers = splitList(payload.userIds).length > 0;
      const hasPhones = splitList(payload.phones || payload.phoneNumbers).length > 0;
      if (!hasUsers && !hasPhones) {
        return { ok: false, error: 'Overrides por usuário/telefone precisam de allowlist' };
      }
    }
    if (config.paymentRuntime) {
      return { ok: false, error: 'paymentRuntime é controlado por perfis de pagamento, não por override genérico' };
    }

    return { ok: true, status, scope, config };
  }

  async upsertOverride(payload = {}, actor = {}) {
    const validation = this.validateOverridePayload(payload);
    if (!validation.ok) return { success: false, error: validation.error };

    const firestore = this.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    const overrideId = String(payload.overrideId || payload.id || `runtime_${Date.now()}`).trim();
    const nowIso = new Date().toISOString();
    const actorId = actor?.uid || actor?.id || actor?.email || 'unknown';
    const ref = firestore.collection(OVERRIDES_COLLECTION).doc(overrideId);
    const existing = await ref.get();
    const record = {
      name: String(payload.name || overrideId).trim(),
      status: validation.status,
      scope: validation.scope,
      priority: Number.parseInt(payload.priority || '0', 10) || 0,
      reason: String(payload.reason || payload.description || '').trim(),
      config: validation.config,
      userIds: splitList(payload.userIds),
      phones: splitList(payload.phones || payload.phoneNumbers).map(normalizeDigits).filter(Boolean),
      startsAtIso: toIso(payload.startsAtIso || payload.startsAt),
      expiresAtIso: toIso(payload.expiresAtIso || payload.expiresAt),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
      updatedBy: actorId
    };
    if (!existing.exists) {
      record.createdAt = admin.firestore.FieldValue.serverTimestamp();
      record.createdAtIso = nowIso;
      record.createdBy = actorId;
    }

    await ref.set(record, { merge: true });
    await this.writeHistory({
      action: existing.exists ? 'runtime_override.updated' : 'runtime_override.created',
      overrideId,
      actorId,
      after: record
    });
    this.cache.loadedAt = 0;

    return {
      success: true,
      override: sanitizeOverrideForResponse({ overrideId, ...record })
    };
  }

  async updateOverrideStatus(overrideId, status, actor = {}) {
    const normalizedStatus = normalizeStatus(status);
    const firestore = this.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    const ref = firestore.collection(OVERRIDES_COLLECTION).doc(String(overrideId || '').trim());
    const snapshot = await ref.get();
    if (!snapshot.exists) return { success: false, error: 'Runtime override não encontrado' };

    const actorId = actor?.uid || actor?.id || actor?.email || 'unknown';
    const update = {
      status: normalizedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
      updatedBy: actorId
    };
    await ref.set(update, { merge: true });
    await this.writeHistory({
      action: 'runtime_override.status_updated',
      overrideId: ref.id,
      actorId,
      before: snapshot.data(),
      after: { ...snapshot.data(), ...update }
    });
    this.cache.loadedAt = 0;

    return {
      success: true,
      override: sanitizeOverrideForResponse({
        overrideId: ref.id,
        ...snapshot.data(),
        status: normalizedStatus
      })
    };
  }

  async rollbackOverride(overrideId, actor = {}) {
    return this.updateOverrideStatus(overrideId, 'paused', actor);
  }

  async writeHistory(payload = {}) {
    const firestore = this.getFirestore();
    if (!firestore) return;

    try {
      await firestore.collection(HISTORY_COLLECTION).add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: new Date().toISOString()
      });
    } catch (error) {
      logError(error, 'Falha ao persistir historico de runtime config', {
        service: 'runtime-config-service'
      });
    }
  }
}

module.exports = new RuntimeConfigService();
module.exports.RuntimeConfigService = RuntimeConfigService;

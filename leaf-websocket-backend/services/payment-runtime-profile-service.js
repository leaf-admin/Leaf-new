const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { getWooviConfig } = require('../config/woovi-config');
const { logStructured } = require('../utils/logger');

const COLLECTION = 'payment_runtime_profiles';
const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const SANDBOX_MAX_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeEnvironment(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'sandbox' ? 'sandbox' : 'production';
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
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTime(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value) {
  const ms = parseTime(value);
  return ms ? new Date(ms).toISOString() : null;
}

function isExpired(profile, nowMs = Date.now()) {
  const expiresAtMs = parseTime(profile.expiresAtIso || profile.expiresAt);
  return Boolean(expiresAtMs && expiresAtMs <= nowMs);
}

function isDurableTestUserSandboxProfile(profile = {}) {
  const environment = normalizeEnvironment(profile.environment);
  const scope = String(profile.scope || 'canary').trim().toLowerCase();
  const testUserSandbox =
    profile.testUserSandbox === true ||
    profile.testUserSandbox === 'true' ||
    profile.requiresTestUserSandbox === true ||
    profile.requiresTestUserSandbox === 'true';
  const userIds = splitList(profile.userIds || profile.passengerIds);
  const phones = splitList(profile.phones || profile.phoneNumbers);
  return (
    environment === 'sandbox' &&
    scope === 'users' &&
    testUserSandbox &&
    userIds.length > 0 &&
    phones.length === 0
  );
}

function hasStarted(profile, nowMs = Date.now()) {
  const startsAtMs = parseTime(profile.startsAtIso || profile.startsAt);
  return !startsAtMs || startsAtMs <= nowMs;
}

function profileRank(profile = {}) {
  const scope = String(profile.scope || '').trim().toLowerCase();
  if (scope === 'users') return 10;
  if (scope === 'phones') return 9;
  if (scope === 'canary') return 8;
  if (scope === 'app_review') return 7;
  if (scope === 'global') return 1;
  return 0;
}

function sanitizeForResponse(profile = {}) {
  const sanitized = { ...profile };
  delete sanitized.wooviConfig;
  delete sanitized.apiToken;
  delete sanitized.authorizationAppId;
  delete sanitized.clientSecret;
  delete sanitized.masterApiToken;
  return sanitized;
}

function summarizeProfile(profile = {}) {
  const sanitized = sanitizeForResponse(profile);
  return {
    profileId: sanitized.profileId || sanitized.id || null,
    name: sanitized.name || sanitized.profileName || 'Perfil sem nome',
    provider: sanitized.provider || 'woovi',
    environment: normalizeEnvironment(sanitized.environment),
    status: normalizeStatus(sanitized.status || 'active'),
    scope: sanitized.scope || 'global',
    source: sanitized.source || 'firestore',
    priority: Number(sanitized.priority || 0),
    startsAtIso: toIso(sanitized.startsAtIso || sanitized.startsAt),
    expiresAtIso: toIso(sanitized.expiresAtIso || sanitized.expiresAt),
    testUserSandbox: sanitized.testUserSandbox === true,
    reason: sanitized.reason || sanitized.description || ''
  };
}

class PaymentRuntimeProfileService {
  constructor(options = {}) {
    this.cacheTtlMs = Number.parseInt(
      options.cacheTtlMs || process.env.PAYMENT_RUNTIME_PROFILE_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS,
      10
    );
    this.cache = {
      loadedAt: 0,
      profiles: []
    };
  }

  buildDefaultProfile() {
    const config = getWooviConfig();
    return {
      profileId: 'env-default',
      name: 'Backend default',
      provider: 'woovi',
      environment: normalizeEnvironment(config.environment),
      source: 'env',
      scope: 'global',
      reason: 'default_backend_environment',
      wooviConfig: config
    };
  }

  buildEnvAllowlistProfiles() {
    const expiresAtIso = process.env.PAYMENT_SANDBOX_EXPIRES_AT || '';
    const profile = {
      profileId: 'env-sandbox-allowlist',
      name: 'Env sandbox allowlist',
      provider: 'woovi',
      environment: 'sandbox',
      source: 'env',
      status: 'active',
      scope: 'canary',
      reason: 'env_allowlist',
      userIds: splitList(process.env.PAYMENT_SANDBOX_USER_IDS || process.env.PAYMENT_SANDBOX_PASSENGER_IDS),
      phones: splitList(process.env.PAYMENT_SANDBOX_PHONE_NUMBERS || process.env.PAYMENT_SANDBOX_PHONES),
      expiresAtIso: expiresAtIso || null
    };

    if (profile.userIds.length === 0 && profile.phones.length === 0) return [];
    const expiresAtMs = parseTime(expiresAtIso);
    if (!expiresAtMs || isExpired(profile)) return [];
    if (expiresAtMs - Date.now() > SANDBOX_MAX_TTL_MS) return [];
    return [profile];
  }

  async loadFirestoreProfiles({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cache.loadedAt &&
      now - this.cache.loadedAt < this.cacheTtlMs
    ) {
      return this.cache.profiles;
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      this.cache = { loadedAt: now, profiles: [] };
      return [];
    }

    try {
      const snapshot = await firestore
        .collection(COLLECTION)
        .where('status', '==', 'active')
        .limit(100)
        .get();
      const profiles = snapshot.docs.map((doc) => ({
        profileId: doc.id,
        id: doc.id,
        ...doc.data(),
        source: 'firestore'
      }));
      this.cache = { loadedAt: now, profiles };
      return profiles;
    } catch (error) {
      logStructured('warn', 'Falha ao carregar perfis de pagamento; usando perfil padrão', {
        service: 'payment-runtime-profile-service',
        error: error.message
      });
      this.cache = { loadedAt: now, profiles: [] };
      return [];
    }
  }

  profileMatches(profile = {}, context = {}) {
    if (normalizeStatus(profile.status || 'active') !== 'active') return false;
    if (String(profile.provider || 'woovi').trim().toLowerCase() !== 'woovi') return false;
    if (isExpired(profile) || !hasStarted(profile)) return false;

    const scope = String(profile.scope || 'canary').trim().toLowerCase();
    const userIds = new Set([
      ...splitList(profile.userIds),
      ...splitList(profile.passengerIds)
    ]);
    const phones = new Set(splitList(profile.phones || profile.phoneNumbers).map(normalizeDigits).filter(Boolean));
    const contextUserIds = [
      context.userId,
      context.passengerId,
      context.uid,
      context.actor?.uid,
      context.actor?.id
    ].map((value) => String(value || '').trim()).filter(Boolean);
    const contextPhones = [
      context.phone,
      context.phoneNumber,
      context.actor?.phone,
      context.actor?.phoneNumber
    ].map(normalizeDigits).filter(Boolean);

    if (scope === 'global') return true;
    if (scope === 'app_review') return Boolean(context.appReview);
    if (scope === 'users') return contextUserIds.some((id) => userIds.has(id));
    if (scope === 'phones') return contextPhones.some((phone) => phones.has(phone));
    if (scope === 'canary') {
      return (
        contextUserIds.some((id) => userIds.has(id)) ||
        contextPhones.some((phone) => phones.has(phone))
      );
    }

    return false;
  }

  async resolveProfile(context = {}) {
    const defaultProfile = this.buildDefaultProfile();
    const profiles = [
      ...this.buildEnvAllowlistProfiles(),
      ...(await this.loadFirestoreProfiles())
    ];

    const matches = profiles
      .filter((profile) => this.profileMatches(profile, context))
      .sort((left, right) => {
        const byRank = profileRank(right) - profileRank(left);
        if (byRank !== 0) return byRank;
        return Number(right.priority || 0) - Number(left.priority || 0);
      });

    const selected = matches[0] || defaultProfile;
    const environment = normalizeEnvironment(selected.environment);
    const wooviConfig = selected.wooviConfig || getWooviConfig({
      environment,
      baseUrl: selected.baseUrl,
      authorizationAppId: selected.authorizationAppId,
      apiToken: selected.apiToken,
      clientId: selected.clientId,
      clientSecret: selected.clientSecret,
      masterApiToken: selected.masterApiToken,
      masterAppId: selected.masterAppId
    });

    return {
      profileId: selected.profileId || selected.id || defaultProfile.profileId,
      name: selected.name || selected.profileName || defaultProfile.name,
      provider: 'woovi',
      environment,
      scope: selected.scope || defaultProfile.scope,
      source: selected.source || defaultProfile.source,
      reason: selected.reason || selected.description || defaultProfile.reason,
      expiresAtIso: toIso(selected.expiresAtIso || selected.expiresAt),
      startsAtIso: toIso(selected.startsAtIso || selected.startsAt),
      priority: Number(selected.priority || 0),
      testUserSandbox: selected.testUserSandbox === true,
      wooviConfig
    };
  }

  async getRuntimeSummary({ forceRefresh = false } = {}) {
    const defaultProfile = this.buildDefaultProfile();
    const envProfiles = this.buildEnvAllowlistProfiles().map((profile) => ({
      ...profile,
      source: profile.source || 'env'
    }));
    const firestoreProfiles = await this.loadFirestoreProfiles({ forceRefresh });
    const allProfiles = [...envProfiles, ...firestoreProfiles];
    const activeProfiles = allProfiles
      .filter((profile) =>
        normalizeStatus(profile.status || 'active') === 'active' &&
        String(profile.provider || 'woovi').trim().toLowerCase() === 'woovi' &&
        !isExpired(profile) &&
        hasStarted(profile)
      )
      .map(summarizeProfile)
      .sort((left, right) => {
        const byPriority = Number(right.priority || 0) - Number(left.priority || 0);
        if (byPriority !== 0) return byPriority;
        return profileRank(right) - profileRank(left);
      });

    const sandboxProfiles = activeProfiles.filter((profile) => profile.environment === 'sandbox');
    const productionProfiles = activeProfiles.filter((profile) => profile.environment === 'production');
    const canarySandboxProfiles = sandboxProfiles.filter((profile) =>
      ['canary', 'users', 'phones', 'app_review'].includes(String(profile.scope || '').toLowerCase())
    );
    const globalSandboxProfiles = sandboxProfiles.filter((profile) =>
      String(profile.scope || '').toLowerCase() === 'global'
    );

    return {
      success: true,
      provider: 'woovi',
      defaultEnvironment: normalizeEnvironment(defaultProfile.environment),
      defaultProfile: summarizeProfile(defaultProfile),
      activeProfileCount: activeProfiles.length,
      sandboxProfileCount: sandboxProfiles.length,
      productionProfileCount: productionProfiles.length,
      canarySandboxEnabled: canarySandboxProfiles.length > 0,
      globalSandboxEnabled: globalSandboxProfiles.length > 0,
      profiles: activeProfiles.slice(0, 12),
      generatedAt: new Date().toISOString()
    };
  }

  validateProfilePayload(profile = {}) {
    const environment = normalizeEnvironment(profile.environment);
    const status = normalizeStatus(profile.status || 'paused');
    const scope = String(profile.scope || 'canary').trim().toLowerCase();
    const expiresAtMs = parseTime(profile.expiresAtIso || profile.expiresAt);
    const durableTestSandbox = isDurableTestUserSandboxProfile({
      ...profile,
      environment,
      scope
    });

    if (!['global', 'users', 'phones', 'canary', 'app_review'].includes(scope)) {
      return { ok: false, error: 'scope inválido para perfil de pagamento' };
    }

    if (environment === 'sandbox') {
      if (!expiresAtMs && !durableTestSandbox) {
        return { ok: false, error: 'Perfis sandbox precisam de expiresAtIso' };
      }
      if (expiresAtMs && expiresAtMs <= Date.now()) {
        return { ok: false, error: 'expiresAtIso precisa estar no futuro' };
      }
      if (expiresAtMs && expiresAtMs - Date.now() > SANDBOX_MAX_TTL_MS && !durableTestSandbox) {
        return { ok: false, error: 'Perfis sandbox podem durar no máximo 24h' };
      }
      if (
        scope === 'global' &&
        String(process.env.PAYMENT_ALLOW_GLOBAL_SANDBOX_PROFILE || 'false').toLowerCase() !== 'true'
      ) {
        return { ok: false, error: 'Sandbox global bloqueado por segurança' };
      }
    }

    if (['users', 'phones', 'canary'].includes(scope)) {
      const hasUsers = splitList(profile.userIds || profile.passengerIds).length > 0;
      const hasPhones = splitList(profile.phones || profile.phoneNumbers).length > 0;
      if (!hasUsers && !hasPhones) {
        return { ok: false, error: 'Perfis por usuário/telefone precisam de allowlist' };
      }
    }

    return { ok: true, environment, status, scope };
  }

  async listProfiles({ includeInactive = true } = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    let query = firestore.collection(COLLECTION);
    if (!includeInactive) query = query.where('status', '==', 'active');

    const snapshot = await query.limit(100).get();
    return {
      success: true,
      profiles: snapshot.docs.map((doc) => sanitizeForResponse({
        profileId: doc.id,
        id: doc.id,
        ...doc.data()
      }))
    };
  }

  async upsertProfile(profile = {}, actor = {}) {
    const validation = this.validateProfilePayload(profile);
    if (!validation.ok) return { success: false, error: validation.error };

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    const profileId = String(profile.profileId || profile.id || `profile_${Date.now()}`).trim();
    const nowIso = new Date().toISOString();
    const payload = {
      name: String(profile.name || profile.profileName || profileId).trim(),
      provider: 'woovi',
      environment: validation.environment,
      status: validation.status,
      scope: validation.scope,
      testUserSandbox:
        profile.testUserSandbox === true ||
        profile.testUserSandbox === 'true' ||
        profile.requiresTestUserSandbox === true ||
        profile.requiresTestUserSandbox === 'true',
      priority: Number.parseInt(profile.priority || '0', 10) || 0,
      reason: String(profile.reason || profile.description || '').trim(),
      userIds: splitList(profile.userIds || profile.passengerIds),
      phones: splitList(profile.phones || profile.phoneNumbers).map(normalizeDigits).filter(Boolean),
      startsAtIso: toIso(profile.startsAtIso || profile.startsAt),
      expiresAtIso: toIso(profile.expiresAtIso || profile.expiresAt),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtIso: nowIso,
      updatedBy: actor?.id || actor?.uid || actor?.email || 'unknown'
    };

    const ref = firestore.collection(COLLECTION).doc(profileId);
    const existing = await ref.get();
    if (!existing.exists) {
      payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
      payload.createdAtIso = nowIso;
      payload.createdBy = payload.updatedBy;
    }

    await ref.set(payload, { merge: true });
    this.cache.loadedAt = 0;

    return {
      success: true,
      profile: sanitizeForResponse({ profileId, ...payload })
    };
  }

  async updateProfileStatus(profileId, status, actor = {}) {
    const normalizedStatus = normalizeStatus(status);
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) return { success: false, error: 'Firestore não disponível' };

    const ref = firestore.collection(COLLECTION).doc(String(profileId || '').trim());
    const snapshot = await ref.get();
    if (!snapshot.exists) return { success: false, error: 'Perfil de pagamento não encontrado' };

    await ref.set({
      status: normalizedStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtIso: new Date().toISOString(),
      updatedBy: actor?.id || actor?.uid || actor?.email || 'unknown'
    }, { merge: true });
    this.cache.loadedAt = 0;

    return {
      success: true,
      profile: sanitizeForResponse({
        profileId: ref.id,
        ...snapshot.data(),
        status: normalizedStatus
      })
    };
  }
}

module.exports = new PaymentRuntimeProfileService();
module.exports.PaymentRuntimeProfileService = PaymentRuntimeProfileService;

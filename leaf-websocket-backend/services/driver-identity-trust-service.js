const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const {
  IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
  resolveActiveTripForDriver,
  claimIdentityVerificationWindow,
  renewIdentityVerificationWindow,
  releaseIdentityVerificationWindow
} = require('../utils/active-trip-index');
const kycPolicyService = require('./kyc-policy-service');
const driverActivationStateService = require('./driver-activation-state-service');
const canonicalDriverDocumentApprovalService = require('./canonical-driver-document-approval-service');
const redisCriticalAuthorityService = require('./redis-critical-authority-service');
const { resolveBiometricPolicy } = require('./kyc-biometric-production-policy');
const { logStructured } = require('../utils/logger');
const {
  resolveKycPersistenceScope,
  buildScopedPersistenceEnvelope,
  assertStoredRecordMatchesScope,
  assertScopedResourceName
} = require('./sandbox-persistence-context');

const TRUST_TIERS = Object.freeze({
  NEW: 'T0_NEW',
  OBSERVED: 'T1_OBSERVED',
  TRUSTED: 'T2_TRUSTED'
});

const POLICY_VERSIONS = Object.freeze({
  LEGACY: 'driver_identity_recurring_v1',
  ADAPTIVE: 'driver_identity_recurring_v2'
});

const DEFAULTS = Object.freeze({
  cadenceEnabled: false,
  policyVersion: POLICY_VERSIONS.LEGACY,
  newMaxAgeHours: 24,
  observedMaxAgeHours: 72,
  trustedMaxAgeHours: 168,
  observedMinDistinctSuccessDays: 7,
  trustedMinAgeDays: 30,
  trustedMinSuccessCount: 14,
  trustedMinDistinctSuccessDays: 14,
  randomAuditPercent: 10,
  randomAuditTimeZone: 'America/Sao_Paulo',
  randomAuditDecisionTtlSeconds: 48 * 60 * 60,
  stateCacheTtlSeconds: 5 * 60,
  canonicalSessionClaimTtlSeconds: 2 * 60,
  verificationWindowTtlSeconds: IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS
});

function boolFromEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function boundedNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function boundedInteger(value, fallback, min, max) {
  return Math.round(boundedNumber(value, fallback, min, max));
}

function numberFromEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return Number(value);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  return 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function asIso(value, fallback = null) {
  const millis = toMillis(value);
  if (!millis) return fallback;
  return new Date(millis).toISOString();
}

function normalizeTier(value) {
  return Object.values(TRUST_TIERS).includes(value) ? value : TRUST_TIERS.NEW;
}

function tierRank(tier) {
  if (tier === TRUST_TIERS.TRUSTED) return 2;
  if (tier === TRUST_TIERS.OBSERVED) return 1;
  return 0;
}

class DriverIdentityTrustService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.redis = options.redis || redisPool.getConnection();
    this.firestoreProvider = options.firestoreProvider || (() => firebaseConfig.getFirestore());
    this.canonicalDocumentApprovalService = options.canonicalDocumentApprovalService
      || canonicalDriverDocumentApprovalService;
    this.activeTripResolver = options.activeTripResolver || resolveActiveTripForDriver;
    this.activationService = options.activationService || driverActivationStateService;
    this.kycPolicyService = options.kycPolicyService || kycPolicyService;
    this.redisCriticalAuthorityService = options.redisCriticalAuthorityService
      || redisCriticalAuthorityService;
    this.resolveBiometricPolicy = options.resolveBiometricPolicy || resolveBiometricPolicy;
    this.now = options.now || (() => new Date());
    this.randomInt = options.randomInt || ((maxExclusive) => crypto.randomInt(maxExclusive));
    this.logger = options.logger || logStructured;
    this.persistenceScope = resolveKycPersistenceScope(options.persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: options.allowExplicitSandboxAccess === true
    });
    const collections = this.persistenceScope.collections;
    const resources = this.persistenceScope.kycResources;
    const scopedResource = (actual, expected, resource) => assertScopedResourceName({
      scopeInput: this.persistenceScope,
      actual: actual || expected,
      expected,
      resource
    });
    this.stateCollection = scopedResource(
      options.stateCollection,
      collections.driverIdentityTrust,
      'Colecao de confianca de identidade'
    );
    this.evidenceCollection = scopedResource(
      options.evidenceCollection,
      resources.identityTrustEvidenceCollection,
      'Subcolecao de evidencias de confianca'
    );
    this.failedEvidenceCollection = scopedResource(
      options.failedEvidenceCollection,
      collections.kycFailedBiometricEvidence,
      'Colecao de evidencias biometricas rejeitadas'
    );
    this.stepUpChallengeCollection = scopedResource(
      options.stepUpChallengeCollection,
      collections.kycStepUpChallenges,
      'Colecao de challenges KYC'
    );
    this.stateCachePrefix = scopedResource(
      options.stateCachePrefix,
      resources.identityTrustStateCachePrefix,
      'Prefixo Redis do estado de confianca'
    );
    this.randomAuditPrefix = scopedResource(
      options.randomAuditPrefix,
      resources.identityTrustRandomAuditPrefix,
      'Prefixo Redis da amostragem KYC'
    );
    this.randomAuditInFlight = new Map();
    this.canonicalSessionClaimPrefix = scopedResource(
      options.canonicalSessionClaimPrefix,
      resources.identityTrustCanonicalSessionClaimPrefix,
      'Prefixo Redis do claim canonico'
    );
    this.compatibilityVerificationPrefix = scopedResource(
      options.compatibilityVerificationPrefix,
      resources.identityTrustCompatibilityVerificationPrefix,
      'Prefixo Redis de compatibilidade KYC'
    );
    this.driverHashPrefix = scopedResource(
      options.driverHashPrefix,
      resources.identityTrustDriverHashPrefix,
      'Prefixo Redis da projecao do motorista'
    );
    this.stepUpChallengePrefix = scopedResource(
      options.stepUpChallengePrefix,
      resources.identityTrustStepUpChallengePrefix,
      'Prefixo Redis do challenge KYC'
    );
    this.stepUpActivePrefix = scopedResource(
      options.stepUpActivePrefix,
      resources.identityTrustStepUpActivePrefix,
      'Prefixo Redis do challenge ativo KYC'
    );
  }

  persistenceEnvelope(record = null) {
    return buildScopedPersistenceEnvelope(this.persistenceScope, { record });
  }

  assertRecordScope(record) {
    assertStoredRecordMatchesScope(record, this.persistenceScope);
    return record;
  }

  getConfig() {
    const env = this.env;
    const cadenceEnabled = boolFromEnv(
      env.KYC_TRUST_CADENCE_ENABLED,
      DEFAULTS.cadenceEnabled
    );
    const defaultPolicyVersion = cadenceEnabled
      ? POLICY_VERSIONS.ADAPTIVE
      : POLICY_VERSIONS.LEGACY;
    const policyVersion = String(
      env.KYC_TRUST_POLICY_VERSION || defaultPolicyVersion
    ).trim() || defaultPolicyVersion;
    const requestedPolicy = {
      newMaxAgeHours: numberFromEnv(env.KYC_TRUST_T0_MAX_AGE_HOURS, DEFAULTS.newMaxAgeHours),
      observedMaxAgeHours: numberFromEnv(
        env.KYC_TRUST_T1_MAX_AGE_HOURS,
        DEFAULTS.observedMaxAgeHours
      ),
      trustedMaxAgeHours: numberFromEnv(
        env.KYC_TRUST_T2_MAX_AGE_HOURS,
        DEFAULTS.trustedMaxAgeHours
      ),
      observedMinDistinctSuccessDays: numberFromEnv(
        env.KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS,
        DEFAULTS.observedMinDistinctSuccessDays
      ),
      trustedMinAgeDays: numberFromEnv(
        env.KYC_TRUST_T2_MIN_AGE_DAYS,
        DEFAULTS.trustedMinAgeDays
      ),
      trustedMinSuccessCount: numberFromEnv(
        env.KYC_TRUST_T2_MIN_SUCCESS_COUNT,
        DEFAULTS.trustedMinSuccessCount
      ),
      trustedMinDistinctSuccessDays: numberFromEnv(
        env.KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS,
        DEFAULTS.trustedMinDistinctSuccessDays
      ),
      randomAuditPercent: numberFromEnv(
        env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT,
        DEFAULTS.randomAuditPercent
      )
    };
    const awsSessionTtlSeconds = boundedInteger(
      env.KYC_AWS_LIVENESS_SESSION_TTL_SECONDS || env.AWS_LIVENESS_SESSION_TTL_SECONDS,
      20 * 60,
      60,
      24 * 60 * 60
    );
    const config = {
      cadenceEnabled,
      policyVersion,
      newMaxAgeHours: boundedInteger(
        requestedPolicy.newMaxAgeHours,
        DEFAULTS.newMaxAgeHours,
        1,
        24
      ),
      observedMaxAgeHours: boundedInteger(
        requestedPolicy.observedMaxAgeHours,
        DEFAULTS.observedMaxAgeHours,
        24,
        72
      ),
      trustedMaxAgeHours: boundedInteger(
        requestedPolicy.trustedMaxAgeHours,
        DEFAULTS.trustedMaxAgeHours,
        72,
        168
      ),
      observedMinDistinctSuccessDays: boundedInteger(
        requestedPolicy.observedMinDistinctSuccessDays,
        DEFAULTS.observedMinDistinctSuccessDays,
        2,
        30
      ),
      trustedMinAgeDays: boundedInteger(
        requestedPolicy.trustedMinAgeDays,
        DEFAULTS.trustedMinAgeDays,
        7,
        365
      ),
      trustedMinSuccessCount: boundedInteger(
        requestedPolicy.trustedMinSuccessCount,
        DEFAULTS.trustedMinSuccessCount,
        2,
        365
      ),
      trustedMinDistinctSuccessDays: boundedInteger(
        requestedPolicy.trustedMinDistinctSuccessDays,
        DEFAULTS.trustedMinDistinctSuccessDays,
        2,
        365
      ),
      randomAuditPercent: boundedNumber(
        requestedPolicy.randomAuditPercent,
        DEFAULTS.randomAuditPercent,
        0,
        100
      ),
      randomAuditTimeZone: String(
        env.KYC_TRUST_RANDOM_AUDIT_TIME_ZONE || DEFAULTS.randomAuditTimeZone
      ).trim() || DEFAULTS.randomAuditTimeZone,
      randomAuditDecisionTtlSeconds: boundedInteger(
        env.KYC_TRUST_RANDOM_AUDIT_DECISION_TTL_SECONDS,
        DEFAULTS.randomAuditDecisionTtlSeconds,
        24 * 60 * 60,
        7 * 24 * 60 * 60
      ),
      stateCacheTtlSeconds: boundedInteger(
        env.KYC_TRUST_STATE_CACHE_TTL_SECONDS,
        DEFAULTS.stateCacheTtlSeconds,
        30,
        30 * 60
      ),
      canonicalSessionClaimTtlSeconds: boundedInteger(
        env.KYC_CANONICAL_SESSION_CLAIM_TTL_SECONDS,
        DEFAULTS.canonicalSessionClaimTtlSeconds,
        30,
        10 * 60
      ),
      verificationWindowTtlSeconds: boundedInteger(
        env.KYC_IDENTITY_VERIFICATION_WINDOW_TTL_SECONDS,
        Math.max(DEFAULTS.verificationWindowTtlSeconds, awsSessionTtlSeconds + (5 * 60)),
        awsSessionTtlSeconds,
        24 * 60 * 60
      )
    };
    config.approvedAdaptivePolicyValid = !cadenceEnabled || (
      policyVersion === POLICY_VERSIONS.ADAPTIVE
      && requestedPolicy.newMaxAgeHours === DEFAULTS.newMaxAgeHours
      && requestedPolicy.observedMaxAgeHours === DEFAULTS.observedMaxAgeHours
      && requestedPolicy.trustedMaxAgeHours === DEFAULTS.trustedMaxAgeHours
      && requestedPolicy.observedMinDistinctSuccessDays === DEFAULTS.observedMinDistinctSuccessDays
      && requestedPolicy.trustedMinAgeDays === DEFAULTS.trustedMinAgeDays
      && requestedPolicy.trustedMinSuccessCount === DEFAULTS.trustedMinSuccessCount
      && requestedPolicy.trustedMinDistinctSuccessDays === DEFAULTS.trustedMinDistinctSuccessDays
      && requestedPolicy.randomAuditPercent === DEFAULTS.randomAuditPercent
    );
    return config;
  }

  assertApprovedAdaptivePolicy(config = this.getConfig()) {
    if (config.cadenceEnabled && !config.approvedAdaptivePolicyValid) {
      const error = new Error('Configuracao da politica adaptativa diverge do contrato versionado');
      error.code = 'KYC_TRUST_POLICY_CONFIG_INVALID';
      throw error;
    }
    return config;
  }

  getTierMaxAgeHours(tier, config = this.getConfig()) {
    if (tier === TRUST_TIERS.TRUSTED) return config.trustedMaxAgeHours;
    if (tier === TRUST_TIERS.OBSERVED) return config.observedMaxAgeHours;
    return config.newMaxAgeHours;
  }

  localDayKey(value, timeZone = this.getConfig().randomAuditTimeZone) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch (_error) {
      return date.toISOString().slice(0, 10);
    }
  }

  buildStateCacheKey(driverId) {
    return `${this.stateCachePrefix}${driverId}`;
  }

  buildRandomAuditKey(driverId, dayKey) {
    return `${this.randomAuditPrefix}${driverId}:${dayKey}`;
  }

  buildRandomAuditRef(firestore, driverId, dayKey) {
    return firestore
      .collection(this.stateCollection)
      .doc(driverId)
      .collection('random_audits')
      .doc(dayKey);
  }

  buildCanonicalSessionClaimKey(driverId, awsSessionId) {
    return `${this.canonicalSessionClaimPrefix}${sha256(`${driverId}:${awsSessionId}`)}`;
  }

  buildCompatibilityVerificationKey(driverId) {
    return `${this.compatibilityVerificationPrefix}${driverId}`;
  }

  buildDriverHashKey(driverId) {
    return `${this.driverHashPrefix}${driverId}`;
  }

  buildStepUpChallengeKey(challengeId) {
    return `${this.stepUpChallengePrefix}${challengeId}`;
  }

  buildStepUpActiveKey(driverId) {
    return `${this.stepUpActivePrefix}${driverId}`;
  }

  async cacheState(driverId, state, config = this.getConfig()) {
    if (!this.redis || !driverId || !state) return;
    this.assertRecordScope(state);
    const key = this.buildStateCacheKey(driverId);
    const payload = JSON.stringify(state);
    const revision = Number(state.stateRevision || 0);

    if (typeof this.redis.eval === 'function') {
      await this.redis.eval(
        'local current = redis.call("get", KEYS[1]); if current then local ok, decoded = pcall(cjson.decode, current); if ok and tonumber(decoded.stateRevision or 0) > tonumber(ARGV[2]) then return 0 end end; redis.call("set", KEYS[1], ARGV[1], "EX", ARGV[3]); return 1',
        1,
        key,
        payload,
        String(revision),
        String(config.stateCacheTtlSeconds)
      ).catch(() => null);
      return;
    }

    const currentRaw = await this.redis.get(key).catch(() => null);
    if (currentRaw) {
      try {
        const current = JSON.parse(currentRaw);
        this.assertRecordScope(current);
        if (Number(current.stateRevision || 0) > revision) return;
      } catch (_error) {
        // Replace malformed cache entries with the durable Firestore projection.
      }
    }
    await this.redis.set(key, payload, 'EX', config.stateCacheTtlSeconds).catch(() => null);
  }

  async readState(driverId, { bypassCache = false } = {}) {
    if (!driverId) return null;
    const config = this.getConfig();

    if (!bypassCache && this.redis) {
      const cached = await this.redis.get(this.buildStateCacheKey(driverId)).catch(() => null);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          this.assertRecordScope(parsed);
          if (Number(parsed.stateRevision || 0) > 0) return parsed;
          await this.redis.del(this.buildStateCacheKey(driverId)).catch(() => null);
        } catch (_error) {
          await this.redis.del(this.buildStateCacheKey(driverId)).catch(() => null);
        }
      }
    }

    const firestore = this.firestoreProvider();
    if (!firestore) {
      const error = new Error('Firestore indisponivel para estado canonico de identidade');
      error.code = 'KYC_TRUST_STORE_UNAVAILABLE';
      throw error;
    }

    const snapshot = await firestore.collection(this.stateCollection).doc(driverId).get();
    if (!snapshot.exists) return null;
    const state = snapshot.data() || null;
    if (state) this.assertRecordScope(state);
    if (state) await this.cacheState(driverId, state, config);
    return state;
  }

  async sampleRandomAuditOncePerDay(driverId, dayKey, config = this.getConfig()) {
    const inFlightKey = `${driverId}:${dayKey}`;
    const existing = this.randomAuditInFlight.get(inFlightKey);
    if (existing) return existing;
    const operation = this.sampleRandomAuditOncePerDayInternal(driverId, dayKey, config);
    this.randomAuditInFlight.set(inFlightKey, operation);
    try {
      return await operation;
    } finally {
      if (this.randomAuditInFlight.get(inFlightKey) === operation) {
        this.randomAuditInFlight.delete(inFlightKey);
      }
    }
  }

  async sampleRandomAuditOncePerDayInternal(driverId, dayKey, config = this.getConfig()) {
    if (config.randomAuditPercent <= 0) {
      return {
        selected: false,
        dayKey,
        percentage: config.randomAuditPercent
      };
    }
    const key = this.buildRandomAuditKey(driverId, dayKey);
    const parseDecision = (raw) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.selected !== 'boolean') return null;
        this.assertRecordScope(parsed);
        return parsed;
      } catch (_error) {
        return null;
      }
    };

    try {
      const existing = this.redis
        ? parseDecision(await this.redis.get(key).catch(() => null))
        : null;
      if (existing) return existing;

      const firestore = this.firestoreProvider();
      if (!firestore || typeof firestore.runTransaction !== 'function') {
        const error = new Error('Firestore indisponivel para decisao de auditoria aleatoria');
        error.code = 'KYC_RANDOM_AUDIT_STORE_UNAVAILABLE';
        throw error;
      }
      let candidate = null;
      const auditRef = this.buildRandomAuditRef(firestore, driverId, dayKey);
      const decision = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(auditRef);
        if (snapshot.exists) {
          const storedDecision = parseDecision(JSON.stringify(snapshot.data() || {}));
          if (!storedDecision) {
            const error = new Error('Decisao duravel de auditoria esta invalida');
            error.code = 'KYC_RANDOM_AUDIT_DECISION_INVALID';
            throw error;
          }
          return storedDecision;
        }
        if (!candidate) {
          candidate = {
            ...this.persistenceEnvelope(),
            selected: this.randomInt(10000) < Math.round(config.randomAuditPercent * 100),
            dayKey,
            percentage: config.randomAuditPercent,
            sampledAt: this.now().toISOString(),
            policyVersion: config.policyVersion
          };
        }
        transaction.set(auditRef, candidate, { merge: false });
        return candidate;
      });
      if (this.redis) {
        await this.redis.set(
          key,
          JSON.stringify(decision),
          'EX',
          config.randomAuditDecisionTtlSeconds
        ).catch(() => null);
      }
      return decision;
    } catch (error) {
      this.logger('warn', 'Falha ao persistir amostragem diaria de KYC', {
        service: 'driver-identity-trust-service',
        driverId,
        error: error.message
      });
      if (!error.code) error.code = 'KYC_RANDOM_AUDIT_STORE_UNAVAILABLE';
      throw error;
    }
  }

  evaluateState(state, config = this.getConfig()) {
    const now = this.now();
    const nowMs = now.getTime();
    const today = this.localDayKey(now, config.randomAuditTimeZone);

    if (!state) {
      return {
        allowed: false,
        verificationRequired: true,
        code: 'KYC_CANONICAL_EVIDENCE_MISSING',
        reason: 'Primeira validacao canonica de identidade necessaria.',
        tier: TRUST_TIERS.NEW,
        today
      };
    }

    if (state.status === 'revoked' || state.revokedAt) {
      return {
        allowed: false,
        verificationRequired: true,
        code: 'KYC_CANONICAL_EVIDENCE_REVOKED',
        reason: state.revocationReason || 'Evidencia de identidade revogada.',
        tier: TRUST_TIERS.NEW,
        today
      };
    }

    if (state.policyVersion !== config.policyVersion) {
      return {
        allowed: false,
        verificationRequired: true,
        code: 'KYC_TRUST_POLICY_CHANGED',
        reason: 'Politica de verificacao atualizada; nova validacao necessaria.',
        tier: TRUST_TIERS.NEW,
        today
      };
    }

    const lastVerifiedMs = toMillis(state.lastVerifiedAt);
    if (!lastVerifiedMs || lastVerifiedMs > nowMs) {
      return {
        allowed: false,
        verificationRequired: true,
        code: 'KYC_CANONICAL_EVIDENCE_INVALID',
        reason: 'Evidencia canonica de identidade invalida.',
        tier: TRUST_TIERS.NEW,
        today
      };
    }

    const tier = normalizeTier(state.trustTier);
    const computedDueAtMs = lastVerifiedMs + (
      this.getTierMaxAgeHours(tier, config) * 60 * 60 * 1000
    );
    const storedDueAtMs = toMillis(state.nextVerificationAt);
    const dueAtMs = storedDueAtMs > 0
      ? Math.min(storedDueAtMs, computedDueAtMs)
      : computedDueAtMs;

    if (nowMs >= dueAtMs) {
      return {
        allowed: false,
        verificationRequired: true,
        code: 'KYC_TRUST_CADENCE_EXPIRED',
        reason: 'Validacao periodica de identidade necessaria.',
        tier,
        dueAt: new Date(dueAtMs).toISOString(),
        today
      };
    }

    return {
      allowed: true,
      verificationRequired: false,
      code: 'KYC_TRUST_VALID',
      reason: 'Evidencia canonica de identidade valida.',
      tier,
      dueAt: new Date(dueAtMs).toISOString(),
      lastVerifiedDay: this.localDayKey(new Date(lastVerifiedMs), config.randomAuditTimeZone),
      randomAuditSatisfied: state.lastRandomAuditSatisfiedDay === today,
      today
    };
  }

  async evaluateAdaptiveCadence(driverId) {
    const config = this.getConfig();
    this.assertApprovedAdaptivePolicy(config);
    const state = await this.readState(driverId);
    let evaluation = this.evaluateState(state, config);
    if (evaluation.allowed) {
      const referenceBinding = await this.evaluateCurrentApprovedReferenceBinding(
        driverId,
        state
      );
      if (!referenceBinding.valid) {
        evaluation = {
          allowed: false,
          verificationRequired: true,
          code: referenceBinding.code,
          reason: referenceBinding.reason,
          tier: TRUST_TIERS.NEW,
          dueAt: evaluation.dueAt || null,
          today: evaluation.today
        };
      }
    }
    if (!evaluation.allowed || evaluation.tier !== TRUST_TIERS.TRUSTED) {
      return evaluation;
    }

    if (
      evaluation.lastVerifiedDay === evaluation.today
      || evaluation.randomAuditSatisfied
      || config.randomAuditPercent <= 0
    ) {
      return evaluation;
    }

    const audit = await this.sampleRandomAuditOncePerDay(
      driverId,
      evaluation.today,
      config
    );
    if (!audit.selected) {
      return {
        ...evaluation,
        randomAudit: audit
      };
    }

    return {
      allowed: false,
      verificationRequired: true,
      code: 'KYC_TRUST_RANDOM_AUDIT_REQUIRED',
      reason: 'Validacao aleatoria de identidade necessaria.',
      tier: TRUST_TIERS.TRUSTED,
      dueAt: evaluation.dueAt,
      today: evaluation.today,
      randomAudit: audit
    };
  }

  async evaluateCurrentApprovedReferenceBinding(driverId, state = {}) {
    const expectedSubmissionId = String(state.referenceSubmissionId || '').trim();
    const expectedPathSha256 = String(state.referenceDocumentPathSha256 || '').trim();
    const expectedDocumentSha256 = String(state.referenceDocumentSha256 || '').trim();
    const expectedStorageGeneration = String(state.referenceStorageGeneration || '').trim();
    if (
      !expectedSubmissionId
      || !/^[a-f0-9]{64}$/i.test(expectedPathSha256)
      || !/^[a-f0-9]{64}$/i.test(expectedDocumentSha256)
      || !/^\d+$/.test(expectedStorageGeneration)
    ) {
      return {
        valid: false,
        code: 'KYC_CANONICAL_REFERENCE_BINDING_MISSING',
        reason: 'Nova validacao necessaria para vincular a CNH atual.'
      };
    }

    let document;
    try {
      document = await this.canonicalDocumentApprovalService.requireApprovedCnh(driverId);
    } catch (_error) {
      return {
        valid: false,
        code: 'KYC_CANONICAL_REFERENCE_CHANGED',
        reason: 'A CNH aprovada mudou; nova validacao de identidade necessaria.'
      };
    }
    const submissionId = String(document.submissionId || '').trim();
    const documentPath = String(document.filePath || '').trim();
    const currentPathSha256 = sha256(documentPath);
    const valid = submissionId === expectedSubmissionId
      && currentPathSha256 === expectedPathSha256
      && String(document.documentSha256 || '').toLowerCase() === expectedDocumentSha256.toLowerCase()
      && String(document.storageGeneration || '') === expectedStorageGeneration;

    return valid
      ? { valid: true }
      : {
        valid: false,
        code: 'KYC_CANONICAL_REFERENCE_CHANGED',
        reason: 'A CNH aprovada mudou; nova validacao de identidade necessaria.'
      };
  }

  async resolveActiveTrip(driverId) {
    return this.activeTripResolver(this.redis, driverId);
  }

  async getOrCreateOnlineChallenge(driverId, cadenceEvaluation) {
    const metadata = {
      trustTier: cadenceEvaluation.tier || TRUST_TIERS.NEW,
      reasonCode: cadenceEvaluation.code,
      randomAuditDay: cadenceEvaluation.randomAudit?.selected
        ? cadenceEvaluation.today
        : null,
      policyVersion: this.getConfig().policyVersion,
      canonicalEvidenceRequired: true
    };
    if (typeof this.kycPolicyService.getOrCreateStepUpChallenge === 'function') {
      return this.kycPolicyService.getOrCreateStepUpChallenge({
        driverId,
        requirement: 'LIVENESS_REQUIRED',
        score: 100,
        source: cadenceEvaluation.randomAudit?.selected
          ? 'driver_online_random_audit'
          : 'driver_online',
        metadata,
        signals: [{
          code: cadenceEvaluation.code,
          weight: 100,
          message: cadenceEvaluation.reason,
          details: {
            tier: cadenceEvaluation.tier || TRUST_TIERS.NEW,
            dueAt: cadenceEvaluation.dueAt || null,
            randomAuditDay: metadata.randomAuditDay
          }
        }]
      });
    }

    return this.kycPolicyService.createStepUpChallenge({
      driverId,
      requirement: 'LIVENESS_REQUIRED',
      score: 100,
      source: metadata.randomAuditDay ? 'driver_online_random_audit' : 'driver_online',
      metadata,
      signals: [{
        code: cadenceEvaluation.code,
        weight: 100,
        message: cadenceEvaluation.reason
      }]
    });
  }

  async assertVerificationOutsideActiveTrip(driverId) {
    const activeTrip = await this.resolveActiveTrip(driverId);
    if (activeTrip?.tripId) {
      const error = new Error('Validacao de identidade adiada ate o fim da corrida ativa');
      error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
      error.activeTripId = activeTrip.tripId;
      throw error;
    }
    return { allowed: true };
  }

  async claimVerificationWindow(driverId, { token = null, scope = 'identity_verification' } = {}) {
    if (!driverId) {
      const error = new Error('driverId obrigatorio para reservar janela de verificacao');
      error.code = 'KYC_VERIFICATION_WINDOW_BINDING_INVALID';
      throw error;
    }
    const providedToken = token ? String(token) : null;
    const claimToken = providedToken || crypto.randomBytes(24).toString('hex');

    // Uma etapa já iniciada pode renovar exatamente o mesmo token mesmo quando
    // a autoridade entra em quarentena. O modo existingOnly nunca cria uma nova
    // janela e mantém a exclusão atômica contra corrida/policy mutation.
    if (providedToken) {
      const reuseClaim = await claimIdentityVerificationWindow(
        this.redis,
        driverId,
        claimToken,
        this.getConfig().verificationWindowTtlSeconds,
        { existingOnly: true }
      );
      if (reuseClaim.activeTripId) {
        const error = new Error('Validacao de identidade adiada ate o fim da corrida ativa');
        error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
        error.activeTripId = reuseClaim.activeTripId;
        throw error;
      }
      if (!reuseClaim.missing) {
        return {
          ...reuseClaim,
          driverId,
          scope
        };
      }
    }

    if (
      String(this.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || '').trim().toLowerCase()
      === 'redis_noeviction'
    ) {
      await this.redisCriticalAuthorityService.assertReady({
        env: this.env,
        forceRefresh: true
      });
    }

    const criticalAuthorityOptions =
      String(this.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || '').trim().toLowerCase()
        === 'redis_noeviction'
        ? {
            requiredDatasetGeneration: String(
              this.env.REDIS_CRITICAL_DATASET_GENERATION || ''
            ).trim(),
            datasetGenerationKey: String(
              this.env.REDIS_CRITICAL_DATASET_GENERATION_KEY
                || 'leaf:runtime:critical-dataset:generation'
            ).trim()
          }
        : {};

    const claim = await claimIdentityVerificationWindow(
      this.redis,
      driverId,
      claimToken,
      this.getConfig().verificationWindowTtlSeconds,
      criticalAuthorityOptions
    );
    if (claim.activeTripId) {
      const error = new Error('Validacao de identidade adiada ate o fim da corrida ativa');
      error.code = 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP';
      error.activeTripId = claim.activeTripId;
      throw error;
    }
    return {
      ...claim,
      driverId,
      scope
    };
  }

  async releaseVerificationWindow(claim = {}) {
    return releaseIdentityVerificationWindow(this.redis, claim);
  }

  async renewVerificationWindow(claim = {}) {
    return renewIdentityVerificationWindow(
      this.redis,
      claim,
      this.getConfig().verificationWindowTtlSeconds
    );
  }

  async persistOnlineDispatchBlock(driverId, gateResult = {}) {
    if (!this.redis || typeof this.redis.hset !== 'function') {
      const error = new Error('Redis indisponivel para selar bloqueio de dispatch do KYC');
      error.code = 'KYC_ONLINE_DISPATCH_BLOCK_PERSIST_FAILED';
      throw error;
    }

    const checkedAt = this.now().toISOString();
    try {
      await this.redis.hset(this.buildDriverHashKey(driverId), {
        driverId,
        dispatchEligible: 'false',
        dispatchEligibilityCode: gateResult.code || 'KYC_REQUIRED',
        dispatchEligibilityCheckedAt: checkedAt,
        updatedAt: checkedAt
      });
      return true;
    } catch (cause) {
      const error = new Error('Falha ao selar bloqueio de dispatch do KYC');
      error.code = 'KYC_ONLINE_DISPATCH_BLOCK_PERSIST_FAILED';
      error.cause = cause;
      throw error;
    }
  }

  async readCanonicalCompatibilityVerification(driverId, maxAgeHours) {
    if (!this.redis) {
      const error = new Error('Redis indisponivel para cache canonico de identidade');
      error.code = 'KYC_CANONICAL_CACHE_UNAVAILABLE';
      throw error;
    }
    const raw = await this.redis.get(this.buildCompatibilityVerificationKey(driverId));
    if (!raw) return { hasValid: false, reason: 'Evidencia canonica nao encontrada.' };

    let payload = null;
    try {
      payload = JSON.parse(raw);
      this.assertRecordScope(payload);
    } catch (_error) {
      return { hasValid: false, reason: 'Evidencia canonica invalida.' };
    }

    const timestamp = Number(payload.timestamp || 0);
    const ageMs = this.now().getTime() - timestamp;
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const hasValid = payload.mode === 'canonical_identity_trust_v1'
      && payload.success === true
      && payload.isMatch === true
      && payload.policyVersion === this.getConfig().policyVersion
      && Boolean(payload.evidenceId)
      && timestamp > 0
      && ageMs >= 0
      && ageMs < maxAgeMs;
    return {
      hasValid,
      reason: hasValid ? 'Evidencia canonica valida.' : 'Nova evidencia canonica necessaria.',
      mode: payload.mode || null,
      timestamp: timestamp || null,
      evidenceId: payload.evidenceId || null
    };
  }

  async evaluateOnlineGate(driverId) {
    if (!driverId) {
      return {
        allowed: false,
        reason: 'driverId ausente',
        code: 'driverIdMissing'
      };
    }

    let gateWindowClaim = null;
    let releaseGateWindow = true;
    const denyOnlineGate = async (gateResult) => {
      try {
        await this.persistOnlineDispatchBlock(driverId, gateResult);
        return {
          ...gateResult,
          dispatchBlockPersisted: true
        };
      } catch (error) {
        releaseGateWindow = false;
        error.onlineGateResult = gateResult;
        throw error;
      }
    };
    try {
      const activeTrip = await this.resolveActiveTrip(driverId);
      if (activeTrip?.tripId) {
        return {
          allowed: true,
          deferred: true,
          continuityOnly: true,
          reason: 'Validacao adiada ate o fim da corrida ativa.',
          code: 'KYC_DEFERRED_ACTIVE_TRIP',
          activeTripId: activeTrip.tripId
        };
      }

      const activationState = await this.activationService.resolveDriverActivationState({ driverId });
      const config = this.getConfig();
      this.assertApprovedAdaptivePolicy(config);
      const biometricPolicy = this.resolveBiometricPolicy(this.env);
      const providerDormant = this.env.DAILY_KYC_ONLINE_GATE_ENABLED === 'false'
        && !config.cadenceEnabled
        && biometricPolicy.productionBiometricsEnabled !== true;
      if (
        providerDormant
        && activationState?.canGoOnline
        && !activationState?.requiresLiveness
      ) {
        return {
          allowed: true,
          reason: 'Motorista apto pela politica canonica de ativacao.',
          code: 'driverActivationActive',
          details: activationState,
          providerDormant: true
        };
      }

      gateWindowClaim = await this.claimVerificationWindow(driverId, {
        scope: 'driver_online_gate'
      });
      if (!gateWindowClaim.acquired) {
        const error = new Error('Outra validacao de identidade ja esta em andamento');
        error.code = 'KYC_VERIFICATION_IN_PROGRESS';
        throw error;
      }

      if (activationState && !activationState.canAttemptOnline) {
        return await denyOnlineGate({
          allowed: false,
          reason: activationState.blockingReason || 'Motorista nao apto para ficar online.',
          code: activationState.requiresLiveness ? 'kycRequired' : 'driverActivationBlocked',
          requirement: activationState.requiresLiveness ? 'LIVENESS_REQUIRED' : undefined,
          details: activationState
        });
      }

      const approvalGate = await this.kycPolicyService.requireApprovedKyc(driverId);
      if (!approvalGate.allowed) {
        return await denyOnlineGate({
          allowed: false,
          reason: approvalGate.reason,
          code: approvalGate.code,
          details: approvalGate
        });
      }

      if (this.env.DAILY_KYC_ONLINE_GATE_ENABLED === 'false') {
        return {
          allowed: true,
          reason: 'Gate KYC periodico desabilitado.',
          code: 'kycGateDisabled',
          details: activationState
        };
      }

      if (typeof this.kycPolicyService.getStepUpChallenge === 'function') {
        const pendingChallenge = await this.kycPolicyService.getStepUpChallenge(null, driverId);
        if (
          pendingChallenge?.status === 'pending'
          && ['driver_online', 'driver_online_random_audit'].includes(pendingChallenge.source)
        ) {
          return await denyOnlineGate({
            allowed: false,
            reason: 'Validacao de identidade pendente antes de ficar online.',
            code: 'kycRequired',
            reasonCode: 'KYC_ONLINE_CHALLENGE_PENDING',
            requirement: pendingChallenge.requirement || 'LIVENESS_REQUIRED',
            challenge: pendingChallenge
          });
        }
      }

      if (!config.cadenceEnabled) {
        const requestedMaxAge = Number.parseInt(this.env.KYC_DAILY_MAX_AGE_HOURS || '24', 10);
        const maxAgeHours = Number.isFinite(requestedMaxAge) && requestedMaxAge > 0
          ? Math.min(requestedMaxAge, 24)
          : 24;
        const verification = await this.readCanonicalCompatibilityVerification(
          driverId,
          maxAgeHours
        );
        if (verification?.hasValid) {
          return {
            allowed: true,
            reason: 'KYC periodico valido.',
            code: 'kycValid',
            details: verification
          };
        }
        const cadenceEvaluation = {
          allowed: false,
          verificationRequired: true,
          code: 'KYC_CANONICAL_24H_REQUIRED',
          reason: verification?.reason || 'Verificacao facial necessaria.',
          tier: TRUST_TIERS.NEW,
          dueAt: null
        };
        const challenge = await this.getOrCreateOnlineChallenge(driverId, cadenceEvaluation);
        return await denyOnlineGate({
          allowed: false,
          reason: cadenceEvaluation.reason,
          code: 'kycRequired',
          requirement: 'LIVENESS_REQUIRED',
          cadence: cadenceEvaluation,
          challenge
        });
      }

      const cadence = await this.evaluateAdaptiveCadence(driverId);
      if (cadence.allowed) {
        return {
          allowed: true,
          reason: cadence.reason,
          code: cadence.code,
          cadence
        };
      }

      const challenge = await this.getOrCreateOnlineChallenge(driverId, cadence);
      return await denyOnlineGate({
        allowed: false,
        reason: cadence.reason,
        code: 'kycRequired',
        reasonCode: cadence.code,
        requirement: 'LIVENESS_REQUIRED',
        cadence,
        challenge
      });
    } catch (error) {
      if (error?.code === 'KYC_VERIFICATION_DEFERRED_ACTIVE_TRIP') {
        return {
          allowed: true,
          deferred: true,
          continuityOnly: true,
          reason: 'Validacao adiada ate o fim da corrida ativa.',
          code: 'KYC_DEFERRED_ACTIVE_TRIP',
          activeTripId: error.activeTripId || null
        };
      }
      if (
        error?.code === 'KYC_ONLINE_DISPATCH_BLOCK_PERSIST_FAILED'
        && error.onlineGateResult
      ) {
        return {
          ...error.onlineGateResult,
          dispatchBlockPersisted: false,
          retryRequired: true
        };
      }
      this.logger('warn', 'Falha no gate KYC (fail-closed)', {
        service: 'driver-identity-trust-service',
        driverId,
        error: error.message
      });
      let dispatchBlockPersisted = false;
      if (error?.code !== 'KYC_ONLINE_DISPATCH_BLOCK_PERSIST_FAILED') {
        try {
          await this.persistOnlineDispatchBlock(driverId, {
            code: 'KYC_CHECK_FAILED'
          });
          dispatchBlockPersisted = true;
        } catch (blockError) {
          releaseGateWindow = false;
          this.logger('error', 'Falha ao selar bloqueio fail-closed do KYC', {
            service: 'driver-identity-trust-service',
            driverId,
            error: blockError.message
          });
        }
      }
      return {
        allowed: false,
        reason: 'Nao foi possivel validar KYC agora.',
        code: 'KYC_CHECK_FAILED',
        dispatchBlockPersisted
      };
    } finally {
      if (gateWindowClaim?.acquired && releaseGateWindow) {
        await this.releaseVerificationWindow(gateWindowClaim).catch(() => null);
      }
    }
  }

  buildReferenceFingerprint(evidence = {}) {
    const reference = evidence.reference || {};
    if (Number(reference.bindingVersion) === 3) {
      return sha256(JSON.stringify({
        bindingVersion: 3,
        source: reference.source || null,
        documentType: reference.documentType || null,
        model: reference.model || null,
        submissionId: reference.submissionId || null,
        documentPathSha256: reference.documentPathSha256 || null,
        documentSha256: reference.documentSha256 || null,
        storageGeneration: reference.storageGeneration || null,
        approvalSource: reference.approvalSource || null,
        reviewedByHash: reference.reviewedByHash || null,
        reviewedAt: asIso(reference.reviewedAt, reference.reviewedAt || null),
        imageSha256: reference.imageSha256 || null,
        cropVersion: reference.cropVersion || null,
        createdAt: asIso(reference.createdAt, reference.createdAt || null)
      }));
    }
    return sha256(JSON.stringify({
      source: reference.source || null,
      model: reference.model || null,
      createdAt: asIso(reference.createdAt, reference.createdAt || null),
      submissionId: reference.submissionId || null
    }));
  }

  buildModelFingerprint(evidence = {}) {
    return sha256(JSON.stringify({
      livenessProvider: evidence.livenessProvider || null,
      comparisonProvider: evidence.comparisonProvider || evidence.provider || null,
      referenceModel: evidence.reference?.model || null,
      currentModel: evidence.currentModel || null,
      embeddingDimension: Number(evidence.embeddingDimension || 0),
      threshold: Number(evidence.threshold || 0),
      reviewThreshold: Number(evidence.reviewThreshold || 0)
    }));
  }

  buildCanonicalEvidenceHash(driverId, evidence, sessionHash, referenceFingerprint, modelFingerprint) {
    return sha256(JSON.stringify({
      schemaVersion: 1,
      policyVersion: this.getConfig().policyVersion,
      driverId,
      sessionHash,
      sourcePath: evidence.sourcePath,
      challengeId: evidence.challengeId || null,
      challengeSource: evidence.challengeSource || null,
      requirement: evidence.requirement || null,
      randomAuditDay: evidence.randomAuditDay || null,
      verifiedAt: asIso(evidence.verifiedAt, null),
      livenessProvider: evidence.livenessProvider || null,
      livenessStatus: evidence.livenessStatus || null,
      livenessPassed: evidence.livenessPassed === true,
      livenessConfidence: Number(evidence.livenessConfidence || 0),
      livenessThreshold: Number(evidence.livenessThreshold || 0),
      referenceImageSha256: evidence.referenceImageSha256 || null,
      faceMatch: {
        isMatch: evidence.isMatch === true,
        needsReview: evidence.needsReview === true,
        similarityScore: Number(evidence.similarityScore || 0),
        threshold: Number(evidence.threshold || 0),
        reviewThreshold: Number(evidence.reviewThreshold || 0),
        decision: evidence.decision || null,
        provider: evidence.provider || null,
        comparisonProvider: evidence.comparisonProvider || null,
        embeddingDimension: Number(evidence.embeddingDimension || 0),
        currentModel: evidence.currentModel || null
      },
      referenceFingerprint,
      modelFingerprint
    }));
  }

  restoreApprovedIdentityVerification(
    driverId,
    sessionHash,
    storedEvidence = {},
    { challengeId = null, requirement = null } = {}
  ) {
    const liveness = storedEvidence?.liveness || {};
    const faceMatch = storedEvidence?.faceMatch || {};
    const similarityScore = Number(faceMatch.score);
    const threshold = Number(faceMatch.threshold);
    const reviewThreshold = Number(faceMatch.reviewThreshold);
    const livenessConfidence = Number(liveness.confidence);
    const livenessThreshold = Number(liveness.threshold);
    const biometricPolicy = this.resolveBiometricPolicy(this.env);
    const trustedProviders = biometricPolicy.canonicalTrustedMatchProviders
      || biometricPolicy.trustedMatchProviders
      || [];
    const comparisonProvider = faceMatch.comparisonProvider || faceMatch.provider || null;
    const hashPattern = /^[a-f0-9]{64}$/i;
    const expectedRequirement = requirement || 'IDENTITY_REVERIFICATION';
    const identityReconciliation = Boolean(
      challengeId
      && expectedRequirement === 'IDENTITY_REVERIFICATION'
      && storedEvidence.challengeSource === 'identity_reverification'
    );
    const firstAccessReconciliation = Boolean(
      !challengeId
      && expectedRequirement === 'LIVENESS_REQUIRED'
      && storedEvidence.challengeSource === 'first_access'
    );

    if (
      !driverId
      || !sessionHash
      || (!identityReconciliation && !firstAccessReconciliation)
      || storedEvidence.schemaVersion !== 1
      || storedEvidence.policyVersion !== this.getConfig().policyVersion
      || storedEvidence.driverId !== driverId
      || storedEvidence.evidenceId !== sessionHash
      || storedEvidence.sourcePath !== 'server_side_aws_reference_compare'
      || storedEvidence.status !== 'approved'
      || String(storedEvidence.challengeId || '') !== String(challengeId || '')
      || storedEvidence.requirement !== expectedRequirement
      || !hashPattern.test(String(storedEvidence.evidenceHash || ''))
      || !hashPattern.test(String(storedEvidence.referenceFingerprint || ''))
      || !hashPattern.test(String(storedEvidence.modelFingerprint || ''))
      || liveness.provider !== 'aws_rekognition_face_liveness'
      || liveness.sessionIdHash !== sessionHash
      || liveness.status !== 'SUCCEEDED'
      || !Number.isFinite(livenessConfidence)
      || !Number.isFinite(livenessThreshold)
      || livenessConfidence < livenessThreshold
      || !hashPattern.test(String(liveness.referenceImageSha256 || ''))
      || faceMatch.decision !== 'approve'
      || !trustedProviders.includes(comparisonProvider)
      || !Number.isFinite(similarityScore)
      || !Number.isFinite(threshold)
      || !Number.isFinite(reviewThreshold)
      || reviewThreshold >= threshold
      || similarityScore < threshold
    ) {
      return null;
    }

    const canonicalInput = {
      driverId,
      sourcePath: storedEvidence.sourcePath,
      challengeId: storedEvidence.challengeId,
      challengeSource: storedEvidence.challengeSource || null,
      requirement: storedEvidence.requirement,
      randomAuditDay: storedEvidence.randomAuditDay || null,
      verifiedAt: storedEvidence.verifiedAt,
      livenessProvider: liveness.provider,
      livenessStatus: liveness.status,
      livenessPassed: true,
      livenessConfidence,
      livenessThreshold,
      referenceImageSha256: liveness.referenceImageSha256,
      isMatch: true,
      needsReview: false,
      similarityScore,
      threshold,
      reviewThreshold,
      decision: faceMatch.decision,
      provider: faceMatch.provider || null,
      comparisonProvider: faceMatch.comparisonProvider || null,
      embeddingDimension: Number(faceMatch.embeddingDimension || 0),
      reference: faceMatch.reference || null,
      currentModel: faceMatch.currentModel || null
    };
    const referenceFingerprint = this.buildReferenceFingerprint(canonicalInput);
    const modelFingerprint = this.buildModelFingerprint(canonicalInput);
    const evidenceHash = this.buildCanonicalEvidenceHash(
      driverId,
      canonicalInput,
      sessionHash,
      referenceFingerprint,
      modelFingerprint
    );
    if (
      referenceFingerprint !== storedEvidence.referenceFingerprint
      || modelFingerprint !== storedEvidence.modelFingerprint
      || evidenceHash !== storedEvidence.evidenceHash
    ) {
      return null;
    }

    return {
      success: true,
      userId: driverId,
      isMatch: true,
      needsReview: false,
      similarityScore,
      confidence: similarityScore,
      threshold,
      reviewThreshold,
      decision: faceMatch.decision,
      mode: firstAccessReconciliation
        ? 'canonical_first_access_reconciliation_v1'
        : 'canonical_identity_reconciliation_v1',
      provider: faceMatch.provider || null,
      comparisonProvider: faceMatch.comparisonProvider || null,
      embeddingDimension: Number(faceMatch.embeddingDimension || 0) || null,
      requirement: expectedRequirement,
      challengeId
    };
  }

  restoreRejectedIdentityVerification(
    driverId,
    sessionHash,
    storedEvidence = {},
    { challengeId = null, requirement = null } = {}
  ) {
    try {
      this.assertRecordScope(storedEvidence);
    } catch (_error) {
      return null;
    }

    const expectedChallengeId = challengeId ? String(challengeId).trim() : null;
    const expectedRequirement = requirement ? String(requirement).trim() : null;
    const storedChallengeId = storedEvidence.challengeId
      ? String(storedEvidence.challengeId).trim()
      : null;
    const storedRequirement = storedEvidence.requirement
      ? String(storedEvidence.requirement).trim()
      : null;
    const similarityScore = Number(storedEvidence.similarityScore);
    const decision = String(storedEvidence.decision || '').trim().toLowerCase();
    const hashPattern = /^[a-f0-9]{64}$/i;
    const reviewEvidenceCandidate = String(storedEvidence.reviewEvidenceId || '').trim();
    const reviewEvidenceId = /^[A-Za-z0-9_-]{16,128}$/
      .test(reviewEvidenceCandidate)
      ? reviewEvidenceCandidate
      : null;

    if (
      !driverId
      || !hashPattern.test(String(sessionHash || ''))
      || storedEvidence.schemaVersion !== 1
      || storedEvidence.policyVersion !== this.getConfig().policyVersion
      || storedEvidence.driverId !== driverId
      || storedEvidence.evidenceId !== sessionHash
      || storedEvidence.awsSessionHash !== sessionHash
      || storedEvidence.sourcePath !== 'server_side_aws_reference_compare'
      || storedEvidence.terminalOutcome !== 'face_compare_failed'
      || storedChallengeId !== expectedChallengeId
      || storedRequirement !== expectedRequirement
      || !['reject', 'review'].includes(decision)
      || !Number.isFinite(similarityScore)
      || !hashPattern.test(String(storedEvidence.referenceImageSha256 || ''))
    ) {
      return null;
    }

    return {
      success: false,
      userId: driverId,
      isMatch: false,
      needsReview: decision === 'review',
      similarityScore,
      confidence: similarityScore,
      decision,
      mode: 'canonical_identity_failure_reconciliation_v1',
      requirement: expectedRequirement,
      challengeId: expectedChallengeId,
      evidenceId: sessionHash,
      reviewEvidenceId
    };
  }

  async assertCurrentApprovedReference(driverId, evidence = {}) {
    const submissionId = String(evidence.reference?.submissionId || '').trim();
    if (!submissionId) {
      const error = new Error('Embedding facial nao vinculado a uma submissao de CNH');
      error.code = 'KYC_CANONICAL_CNH_SUBMISSION_MISSING';
      throw error;
    }

    const document = await this.canonicalDocumentApprovalService.requireApprovedCnh(driverId);
    const documentSubmissionId = String(document.submissionId || '').trim();
    if (!documentSubmissionId || documentSubmissionId !== submissionId) {
      const error = new Error('Embedding facial nao corresponde a CNH atualmente aprovada');
      error.code = 'KYC_CANONICAL_CNH_SUBMISSION_MISMATCH';
      throw error;
    }
    const reference = evidence.reference || {};
    if (Number(reference.bindingVersion) === 3) {
      const documentPath = String(document?.filePath || '').trim();
      const documentPathSha256 = sha256(documentPath);
      if (
        !documentPath
        || !/^[a-f0-9]{64}$/i.test(String(reference.documentPathSha256 || ''))
        || reference.documentPathSha256 !== documentPathSha256
        || reference.documentSha256 !== String(document.documentSha256 || '').toLowerCase()
        || reference.storageGeneration !== String(document.storageGeneration || '')
        || reference.approvalSource !== 'dashboard_manual_review'
        || reference.reviewedByHash !== sha256(document.reviewedBy)
        || asIso(reference.reviewedAt) !== asIso(document.reviewedAt)
        || !/^[a-f0-9]{64}$/i.test(String(reference.imageSha256 || ''))
        || !String(reference.cropVersion || '').trim()
        || reference.source !== 'approved_cnh_pdf_crop_v1'
      ) {
        const error = new Error('Referência canônica não corresponde ao PDF atual da CNH');
        error.code = 'KYC_CANONICAL_CNH_REFERENCE_BINDING_INVALID';
        throw error;
      }
    } else {
      const error = new Error('Referencia canonica sem vinculo imutavel da CNH');
      error.code = 'KYC_CANONICAL_CNH_REFERENCE_BINDING_INVALID';
      throw error;
    }
  }

  async claimCanonicalSession(driverId, awsSessionId, { verificationWindowToken = null } = {}) {
    if (!driverId || !awsSessionId) {
      const error = new Error('Motorista e sessao AWS sao obrigatorios');
      error.code = 'KYC_CANONICAL_SESSION_BINDING_REQUIRED';
      throw error;
    }
    await this.assertVerificationOutsideActiveTrip(driverId);

    const verificationWindowClaim = await this.claimVerificationWindow(driverId, {
      token: verificationWindowToken,
      scope: 'canonical_aws_face_compare'
    });
    if (!verificationWindowClaim.acquired) {
      return {
        acquired: false,
        consumed: false,
        busy: true,
        verificationWindowClaim
      };
    }

    const firestore = this.firestoreProvider();
    if (!firestore) {
      await this.releaseVerificationWindow(verificationWindowClaim).catch(() => null);
      const error = new Error('Firestore indisponivel para consumir sessao canonica');
      error.code = 'KYC_TRUST_STORE_UNAVAILABLE';
      throw error;
    }
    const sessionHash = sha256(`${driverId}:${awsSessionId}`);
    const evidenceRef = firestore
      .collection(this.stateCollection)
      .doc(driverId)
      .collection(this.evidenceCollection)
      .doc(sessionHash);
    let consumed = null;
    try {
      consumed = await evidenceRef.get();
      if (consumed.exists) this.assertRecordScope(consumed.data() || {});
    } catch (error) {
      await this.releaseVerificationWindow(verificationWindowClaim).catch(() => null);
      throw error;
    }
    if (!this.redis) {
      await this.releaseVerificationWindow(verificationWindowClaim).catch(() => null);
      const error = new Error('Redis indisponivel para exclusao mutua da sessao canonica');
      error.code = 'KYC_CANONICAL_SESSION_LOCK_UNAVAILABLE';
      throw error;
    }

    const key = this.buildCanonicalSessionClaimKey(driverId, awsSessionId);
    const token = crypto.randomBytes(16).toString('hex');
    let acquired = null;
    try {
      acquired = await this.redis.set(
        key,
        token,
        'EX',
        this.getConfig().canonicalSessionClaimTtlSeconds,
        'NX'
      );
    } catch (error) {
      await this.releaseVerificationWindow(verificationWindowClaim).catch(() => null);
      throw error;
    }
    return {
      acquired: acquired === 'OK',
      consumed: consumed.exists,
      busy: acquired !== 'OK',
      sessionHash,
      existingEvidence: consumed.exists ? (consumed.data() || null) : null,
      key,
      token,
      verificationWindowClaim
    };
  }

  async releaseCanonicalSessionClaim(claim = {}, { releaseVerificationWindow = true } = {}) {
    if (this.redis && claim.acquired === true && claim.key && claim.token) {
      if (typeof this.redis.eval === 'function') {
        await this.redis.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          claim.key,
          claim.token
        ).catch(() => null);
      } else {
        const current = await this.redis.get(claim.key).catch(() => null);
        if (current === claim.token) await this.redis.del(claim.key).catch(() => null);
      }
    }
    if (releaseVerificationWindow && claim.verificationWindowClaim) {
      await this.releaseVerificationWindow(claim.verificationWindowClaim).catch(() => null);
    }
  }

  async renewCanonicalSessionClaim(claim = {}) {
    if (
      !this.redis
      || typeof this.redis.eval !== 'function'
      || claim.acquired !== true
      || !claim.key
      || !claim.token
      || !claim.verificationWindowClaim?.key
      || !claim.verificationWindowClaim?.token
    ) {
      return false;
    }
    const config = this.getConfig();
    const result = await this.redis.eval(
      'if redis.call("get", KEYS[1]) ~= ARGV[1] then return 0 end; if redis.call("get", KEYS[2]) ~= ARGV[2] then return 0 end; redis.call("expire", KEYS[1], ARGV[3]); redis.call("expire", KEYS[2], ARGV[4]); return 1',
      2,
      claim.key,
      claim.verificationWindowClaim.key,
      String(claim.token),
      String(claim.verificationWindowClaim.token),
      String(config.canonicalSessionClaimTtlSeconds),
      String(config.verificationWindowTtlSeconds)
    );
    return Number(result) === 1;
  }

  assertCanonicalEvidence(driverId, evidence = {}) {
    if (!driverId || evidence.driverId !== driverId) {
      const error = new Error('Binding de motorista invalido na evidencia canonica');
      error.code = 'KYC_CANONICAL_DRIVER_BINDING_INVALID';
      throw error;
    }
    if (evidence.sourcePath !== 'server_side_aws_reference_compare') {
      const error = new Error('Origem nao canonica para promocao de confianca');
      error.code = 'KYC_CANONICAL_SOURCE_INVALID';
      throw error;
    }
    const livenessConfidence = Number(evidence.livenessConfidence);
    const livenessThreshold = Number(evidence.livenessThreshold);
    if (
      !evidence.awsSessionId
      || evidence.livenessProvider !== 'aws_rekognition_face_liveness'
      || evidence.livenessStatus !== 'SUCCEEDED'
      || evidence.livenessPassed !== true
      || !Number.isFinite(livenessConfidence)
      || !Number.isFinite(livenessThreshold)
      || livenessConfidence < livenessThreshold
    ) {
      const error = new Error('Sessao AWS aprovada e obrigatoria para evidencia canonica');
      error.code = 'KYC_CANONICAL_LIVENESS_INVALID';
      throw error;
    }
    const similarityScore = Number(evidence.similarityScore);
    const threshold = Number(evidence.threshold);
    const reviewThreshold = Number(evidence.reviewThreshold);
    const comparisonProvider = evidence.comparisonProvider || evidence.provider || null;
    const biometricPolicy = this.resolveBiometricPolicy(this.env);
    const trustedProviders = biometricPolicy.canonicalTrustedMatchProviders
      || biometricPolicy.trustedMatchProviders
      || [];
    if (
      evidence.isMatch !== true
      || evidence.decision !== 'approve'
      || evidence.needsReview === true
      || !trustedProviders.includes(comparisonProvider)
      || !Number.isFinite(similarityScore)
      || !Number.isFinite(threshold)
      || !Number.isFinite(reviewThreshold)
      || reviewThreshold >= threshold
      || similarityScore < threshold
    ) {
      const error = new Error('Face compare aprovado e obrigatorio para evidencia canonica');
      error.code = 'KYC_CANONICAL_FACE_MATCH_INVALID';
      throw error;
    }
    if (!/^[a-f0-9]{64}$/i.test(String(evidence.referenceImageSha256 || ''))) {
      const error = new Error('Imagem de referencia AWS nao vinculada a comparacao');
      error.code = 'KYC_CANONICAL_REFERENCE_IMAGE_INVALID';
      throw error;
    }
  }

  promoteTier(previousTier, state, config, verifiedAtMs) {
    let nextTier = normalizeTier(previousTier);
    if (
      state.distinctSuccessDays >= config.observedMinDistinctSuccessDays
      && tierRank(nextTier) < tierRank(TRUST_TIERS.OBSERVED)
    ) {
      nextTier = TRUST_TIERS.OBSERVED;
    }

    const firstVerifiedMs = toMillis(state.firstVerifiedAt) || verifiedAtMs;
    const ageDays = Math.floor((verifiedAtMs - firstVerifiedMs) / (24 * 60 * 60 * 1000));
    if (
      state.successCount >= config.trustedMinSuccessCount
      && state.distinctSuccessDays >= config.trustedMinDistinctSuccessDays
      && ageDays >= config.trustedMinAgeDays
    ) {
      nextTier = TRUST_TIERS.TRUSTED;
    }
    return nextTier;
  }

  async recordCanonicalSuccess(driverId, evidence = {}) {
    this.assertCanonicalEvidence(driverId, evidence);
    await this.assertVerificationOutsideActiveTrip(driverId);
    await this.assertCurrentApprovedReference(driverId, evidence);
    const config = this.getConfig();
    this.assertApprovedAdaptivePolicy(config);
    const verifiedAt = evidence.verifiedAt || this.now().toISOString();
    const verifiedAtMs = toMillis(verifiedAt);
    if (!verifiedAtMs) {
      const error = new Error('verifiedAt invalido na evidencia canonica');
      error.code = 'KYC_CANONICAL_TIMESTAMP_INVALID';
      throw error;
    }

    const firestore = this.firestoreProvider();
    if (!firestore) {
      const error = new Error('Firestore indisponivel para persistir evidencia canonica');
      error.code = 'KYC_TRUST_STORE_UNAVAILABLE';
      throw error;
    }

    const sessionHash = sha256(`${driverId}:${evidence.awsSessionId}`);
    const referenceFingerprint = this.buildReferenceFingerprint(evidence);
    const modelFingerprint = this.buildModelFingerprint(evidence);
    const evidenceHash = this.buildCanonicalEvidenceHash(
      driverId,
      evidence,
      sessionHash,
      referenceFingerprint,
      modelFingerprint
    );
    const successDay = this.localDayKey(new Date(verifiedAtMs), config.randomAuditTimeZone);
    const stateRef = firestore.collection(this.stateCollection).doc(driverId);
    const evidenceRef = stateRef.collection(this.evidenceCollection).doc(sessionHash);
    const shouldResolveChallenge = evidence.resolveStepUpChallenge === true;
    if (shouldResolveChallenge && !evidence.challengeId) {
      const error = new Error('challengeId obrigatorio para resolucao canonica');
      error.code = 'KYC_CANONICAL_CHALLENGE_REQUIRED';
      throw error;
    }
    const challengeRef = shouldResolveChallenge
      ? firestore.collection(this.stepUpChallengeCollection).doc(evidence.challengeId)
      : null;

    const result = await firestore.runTransaction(async (transaction) => {
      const snapshots = await Promise.all([
        transaction.get(stateRef),
        transaction.get(evidenceRef),
        challengeRef ? transaction.get(challengeRef) : Promise.resolve(null)
      ]);
      const [stateSnapshot, evidenceSnapshot, challengeSnapshot] = snapshots;
      const previousState = stateSnapshot.exists ? (stateSnapshot.data() || {}) : {};
      if (stateSnapshot.exists) this.assertRecordScope(previousState);

      if (evidenceSnapshot.exists) {
        const existingEvidence = evidenceSnapshot.data() || {};
        this.assertRecordScope(existingEvidence);
        if (!existingEvidence.evidenceHash || existingEvidence.evidenceHash !== evidenceHash) {
          const error = new Error('Sessao AWS ja consumida com evidencia divergente');
          error.code = 'KYC_CANONICAL_EVIDENCE_HASH_CONFLICT';
          throw error;
        }
        return {
          state: previousState,
          evidenceId: sessionHash,
          idempotentReplay: true
        };
      }

      if (challengeRef) {
        if (!challengeSnapshot?.exists) {
          const error = new Error('Challenge canonico nao encontrado no armazenamento duravel');
          error.code = 'KYC_CANONICAL_CHALLENGE_NOT_FOUND';
          throw error;
        }
        const challenge = challengeSnapshot.data() || {};
        this.assertRecordScope(challenge);
        const expiresAtMs = toMillis(challenge.expiresAt);
        const validBinding = challenge.driverId === driverId
          && challenge.status === 'pending'
          && challenge.requirement === evidence.requirement
          && (!challenge.source || challenge.source === evidence.challengeSource)
          && expiresAtMs > this.now().getTime();
        if (!validBinding) {
          const error = new Error('Challenge canonico expirado, resolvido ou com binding divergente');
          error.code = 'KYC_CANONICAL_CHALLENGE_BINDING_INVALID';
          throw error;
        }
      }

      const resetsProgress = Boolean(
        !stateSnapshot.exists
        || previousState.policyVersion !== config.policyVersion
        || (
          previousState.referenceFingerprint
          && previousState.referenceFingerprint !== referenceFingerprint
        )
        || (
          previousState.modelFingerprint
          && previousState.modelFingerprint !== modelFingerprint
        )
        || previousState.status === 'revoked'
        || previousState.revokedAt
      );
      const previousSuccessCount = resetsProgress ? 0 : Number(previousState.successCount || 0);
      const previousDistinctDays = resetsProgress ? 0 : Number(previousState.distinctSuccessDays || 0);
      const previousLastSuccessDay = resetsProgress ? null : previousState.lastSuccessDay || null;
      const successCount = previousSuccessCount + 1;
      const distinctSuccessDays = previousLastSuccessDay === successDay
        ? previousDistinctDays
        : previousDistinctDays + 1;
      const firstVerifiedAt = resetsProgress
        ? new Date(verifiedAtMs).toISOString()
        : asIso(previousState.firstVerifiedAt, new Date(verifiedAtMs).toISOString());
      const tier = this.promoteTier(
        resetsProgress ? TRUST_TIERS.NEW : previousState.trustTier,
        { successCount, distinctSuccessDays, firstVerifiedAt },
        config,
        verifiedAtMs
      );
      const nextVerificationAt = new Date(
        verifiedAtMs + (this.getTierMaxAgeHours(tier, config) * 60 * 60 * 1000)
      ).toISOString();
      const nowIso = this.now().toISOString();
      const stateRevision = Number(previousState.stateRevision || 0) + 1;

      const canonicalEvidence = {
        ...this.persistenceEnvelope(),
        evidenceId: sessionHash,
        evidenceHash,
        schemaVersion: 1,
        policyVersion: config.policyVersion,
        driverId,
        sourcePath: 'server_side_aws_reference_compare',
        status: 'approved',
        challengeId: evidence.challengeId || null,
        challengeSource: evidence.challengeSource || null,
        requirement: evidence.requirement || null,
        randomAuditDay: evidence.randomAuditDay || null,
        verifiedAt: new Date(verifiedAtMs).toISOString(),
        createdAt: nowIso,
        liveness: {
          provider: evidence.livenessProvider,
          sessionIdHash: sessionHash,
          status: evidence.livenessStatus || 'SUCCEEDED',
          confidence: Number(evidence.livenessConfidence || 0),
          threshold: Number(evidence.livenessThreshold || 0),
          referenceImageSha256: evidence.referenceImageSha256
        },
        faceMatch: {
          provider: evidence.provider || null,
          comparisonProvider: evidence.comparisonProvider || null,
          decision: evidence.decision,
          score: Number(evidence.similarityScore || 0),
          threshold: Number(evidence.threshold || 0),
          reviewThreshold: Number(evidence.reviewThreshold || 0),
          embeddingDimension: Number(evidence.embeddingDimension || 0),
          reference: evidence.reference || null,
          currentModel: evidence.currentModel || null
        },
        referenceFingerprint,
        modelFingerprint
      };
      const nextState = {
        ...this.persistenceEnvelope(stateSnapshot.exists ? previousState : null),
        schemaVersion: 1,
        stateRevision,
        policyVersion: config.policyVersion,
        driverId,
        status: 'active',
        trustTier: tier,
        successCount,
        distinctSuccessDays,
        firstVerifiedAt,
        lastVerifiedAt: new Date(verifiedAtMs).toISOString(),
        nextVerificationAt,
        lastSuccessDay: successDay,
        lastEvidenceId: sessionHash,
        lastRandomAuditSatisfiedDay: evidence.randomAuditDay || (
          previousState.lastRandomAuditSatisfiedDay || null
        ),
        referenceFingerprint,
        referenceSubmissionId: evidence.reference?.submissionId || null,
        referenceDocumentPathSha256: evidence.reference?.documentPathSha256 || null,
        referenceDocumentSha256: evidence.reference?.documentSha256 || null,
        referenceStorageGeneration: evidence.reference?.storageGeneration || null,
        referenceApprovalSource: evidence.reference?.approvalSource || null,
        referenceReviewedAt: evidence.reference?.reviewedAt || null,
        referenceCropVersion: evidence.reference?.cropVersion || null,
        modelFingerprint,
        revokedAt: null,
        revocationReason: null,
        updatedAt: nowIso
      };

      transaction.set(evidenceRef, canonicalEvidence, { merge: false });
      transaction.set(stateRef, nextState, { merge: false });
      if (challengeRef) {
        transaction.set(challengeRef, {
          ...this.persistenceEnvelope(challengeSnapshot.data() || null),
          status: 'resolved',
          resolvedAt: nowIso,
          updatedAt: nowIso,
          resolution: {
            evidenceId: sessionHash,
            requirement: evidence.requirement,
            provider: evidence.comparisonProvider || evidence.provider || null,
            livenessPassed: true,
            similarityScore: Number(evidence.similarityScore || 0),
            confidence: Number(evidence.livenessConfidence || 0)
          }
        }, { merge: true });
      }
      return {
        state: nextState,
        evidenceId: sessionHash,
        idempotentReplay: false,
        progressReset: resetsProgress
      };
    });

    if (result.state && Object.keys(result.state).length > 0) {
      await this.cacheState(driverId, result.state, config);
    }
    if (this.redis && !result.idempotentReplay && challengeRef) {
      const challengeKey = this.buildStepUpChallengeKey(evidence.challengeId);
      const activeKey = this.buildStepUpActiveKey(driverId);
      if (typeof this.redis.eval === 'function') {
        await this.redis.eval(
          'redis.call("del", KEYS[1]); if redis.call("get", KEYS[2]) == ARGV[1] then return redis.call("del", KEYS[2]) else return 0 end',
          2,
          challengeKey,
          activeKey,
          evidence.challengeId
        ).catch(() => null);
      } else {
        await this.redis.del(challengeKey).catch(() => null);
        const activeChallengeId = await this.redis.get(activeKey).catch(() => null);
        if (activeChallengeId === evidence.challengeId) {
          await this.redis.del(activeKey).catch(() => null);
        }
      }
    }
    if (this.redis && !result.idempotentReplay && result.state?.lastVerifiedAt) {
      const legacyCompatibilityPayload = {
        ...this.persistenceEnvelope(),
        success: true,
        isMatch: true,
        timestamp: toMillis(result.state.lastVerifiedAt),
        mode: 'canonical_identity_trust_v1',
        evidenceId: result.evidenceId,
        trustTier: result.state.trustTier,
        policyVersion: result.state.policyVersion,
        stateRevision: result.state.stateRevision
      };
      await this.redis.set(
        this.buildCompatibilityVerificationKey(driverId),
        JSON.stringify(legacyCompatibilityPayload),
        'EX',
        24 * 60 * 60
      ).catch(() => null);
      if (typeof this.redis.hset === 'function') {
        await this.redis.hset(this.buildDriverHashKey(driverId), {
          kyc_recheck_pending_after_trip: String(false),
          kycRecheckPendingAfterTrip: String(false),
          kyc_trust_tier: result.state.trustTier,
          kyc_trust_next_verification_at: result.state.nextVerificationAt
        }).catch(() => null);
      }
    }
    return {
      success: true,
      driverId,
      ...result
    };
  }

  async recordCanonicalFailure(driverId, failure = {}) {
    if (!driverId) {
      const error = new Error('driverId obrigatorio para revogar confianca canonica');
      error.code = 'KYC_CANONICAL_DRIVER_BINDING_INVALID';
      throw error;
    }
    await this.assertVerificationOutsideActiveTrip(driverId);
    const firestore = this.firestoreProvider();
    if (!firestore) {
      const error = new Error('Firestore indisponivel para revogar confianca canonica');
      error.code = 'KYC_TRUST_STORE_UNAVAILABLE';
      throw error;
    }

    const config = this.getConfig();
    const nowIso = this.now().toISOString();
    const stateRef = firestore.collection(this.stateCollection).doc(driverId);
    const sessionHash = failure.awsSessionId
      ? sha256(`${driverId}:${failure.awsSessionId}`)
      : null;
    const evidenceRef = sessionHash
      ? stateRef.collection(this.evidenceCollection).doc(sessionHash)
      : null;
    const result = await firestore.runTransaction(async (transaction) => {
      const [snapshot, evidenceSnapshot] = await Promise.all([
        transaction.get(stateRef),
        evidenceRef ? transaction.get(evidenceRef) : Promise.resolve(null)
      ]);
      const previous = snapshot.exists ? (snapshot.data() || {}) : {};
      if (snapshot.exists) this.assertRecordScope(previous);
      if (evidenceSnapshot?.exists) {
        this.assertRecordScope(evidenceSnapshot.data() || {});
        return {
          state: previous,
          evidenceId: sessionHash,
          idempotentReplay: true
        };
      }
      const next = {
        ...previous,
        ...this.persistenceEnvelope(snapshot.exists ? previous : null),
        schemaVersion: 1,
        stateRevision: Number(previous.stateRevision || 0) + 1,
        policyVersion: config.policyVersion,
        driverId,
        status: 'revoked',
        trustTier: TRUST_TIERS.NEW,
        nextVerificationAt: null,
        lastRandomAuditSatisfiedDay: null,
        revokedAt: nowIso,
        revocationReason: failure.reason || 'canonical_face_compare_failed',
        lastFailure: {
          challengeId: failure.challengeId || null,
          requirement: failure.requirement || null,
          decision: failure.decision || null,
          similarityScore: Number(failure.similarityScore || 0),
          recordedAt: nowIso
        },
        updatedAt: nowIso
      };
      transaction.set(stateRef, next, { merge: false });
      if (evidenceRef) {
        transaction.set(evidenceRef, {
          ...this.persistenceEnvelope(),
          schemaVersion: 1,
          evidenceId: sessionHash,
          driverId,
          policyVersion: config.policyVersion,
          awsSessionHash: sessionHash,
          terminalOutcome: 'face_compare_failed',
          sourcePath: failure.sourcePath || 'server_side_aws_reference_compare',
          challengeId: failure.challengeId || null,
          requirement: failure.requirement || null,
          decision: failure.decision || null,
          similarityScore: Number(failure.similarityScore || 0),
          referenceImageSha256: failure.referenceImageSha256 || null,
          recordedAt: nowIso
        }, { merge: false });
      }
      return {
        state: next,
        evidenceId: sessionHash,
        idempotentReplay: false
      };
    });

    if (!result.idempotentReplay) {
      await this.cacheState(driverId, result.state, config);
      if (this.redis) {
        await this.redis.del(this.buildCompatibilityVerificationKey(driverId)).catch(() => null);
        if (typeof this.redis.hset === 'function') {
          await this.redis.hset(this.buildDriverHashKey(driverId), {
            kyc_trust_tier: TRUST_TIERS.NEW,
            kyc_trust_next_verification_at: '',
            kyc_reverify_required: String(true)
          }).catch(() => null);
        }
      }
    }
    return { success: true, driverId, ...result };
  }

  async linkReviewEvidenceToCanonicalFailure(driverId, {
    failureEvidenceId,
    reviewEvidenceId
  } = {}) {
    const safeDriverId = String(driverId || '').trim();
    const safeFailureEvidenceId = String(failureEvidenceId || '').trim();
    const safeReviewEvidenceId = String(reviewEvidenceId || '').trim();
    if (!safeDriverId || !safeFailureEvidenceId || !safeReviewEvidenceId) {
      const error = new Error('Binding da evidencia de revisao incompleto');
      error.code = 'KYC_REVIEW_EVIDENCE_BINDING_REQUIRED';
      throw error;
    }

    const firestore = this.firestoreProvider();
    if (!firestore) {
      const error = new Error('Firestore indisponivel para vincular evidencia de revisao');
      error.code = 'KYC_TRUST_STORE_UNAVAILABLE';
      throw error;
    }
    const stateRef = firestore.collection(this.stateCollection).doc(safeDriverId);
    const failureRef = stateRef.collection(this.evidenceCollection).doc(safeFailureEvidenceId);
    const reviewRef = firestore.collection(this.failedEvidenceCollection).doc(safeReviewEvidenceId);
    const linkedAt = this.now().toISOString();

    const state = await firestore.runTransaction(async (transaction) => {
      const [stateSnapshot, failureSnapshot, reviewSnapshot] = await Promise.all([
        transaction.get(stateRef),
        transaction.get(failureRef),
        transaction.get(reviewRef)
      ]);
      if (!stateSnapshot.exists || !failureSnapshot.exists || !reviewSnapshot.exists) {
        const error = new Error('Evidencia canonica ou de revisao nao encontrada');
        error.code = 'KYC_REVIEW_EVIDENCE_BINDING_NOT_FOUND';
        throw error;
      }
      const current = stateSnapshot.data() || {};
      const failure = failureSnapshot.data() || {};
      const review = reviewSnapshot.data() || {};
      this.assertRecordScope(current);
      this.assertRecordScope(failure);
      this.assertRecordScope(review);
      if (
        current.driverId !== safeDriverId
        || failure.driverId !== safeDriverId
        || review.driverId !== safeDriverId
        || current.status !== 'revoked'
        || ![
          'canonical_face_compare_failed',
          'identity_reverification_failed'
        ].includes(current.revocationReason)
        || current.lastFailure?.recordedAt !== failure.recordedAt
        || failure.terminalOutcome !== 'face_compare_failed'
        || review.state !== 'available'
        || review.decision !== 'reject'
        || failure.referenceImageSha256 !== review.referenceImageSha256
      ) {
        const error = new Error('Evidencia de revisao nao corresponde a falha canonica');
        error.code = 'KYC_REVIEW_EVIDENCE_BINDING_INVALID';
        throw error;
      }
      const existingStateLink = String(current.lastFailure?.reviewEvidenceId || '').trim();
      const existingFailureLink = String(failure.reviewEvidenceId || '').trim();
      if (
        (existingStateLink && existingStateLink !== safeReviewEvidenceId)
        || (existingFailureLink && existingFailureLink !== safeReviewEvidenceId)
      ) {
        const error = new Error('Falha canonica ja vinculada a outra evidencia de revisao');
        error.code = 'KYC_REVIEW_EVIDENCE_BINDING_CONFLICT';
        throw error;
      }
      const reviewEvidenceLinkedAt = current.lastFailure?.reviewEvidenceLinkedAt
        || failure.reviewEvidenceLinkedAt
        || linkedAt;
      const next = {
        ...current,
        lastFailure: {
          ...(current.lastFailure || {}),
          reviewEvidenceId: safeReviewEvidenceId,
          reviewEvidenceLinkedAt
        },
        updatedAt: linkedAt
      };
      transaction.set(stateRef, next, { merge: false });
      transaction.set(failureRef, {
        ...failure,
        reviewEvidenceId: safeReviewEvidenceId,
        reviewEvidenceLinkedAt
      }, { merge: false });
      return next;
    });

    await this.cacheState(safeDriverId, state, this.getConfig());
    return {
      success: true,
      driverId: safeDriverId,
      failureEvidenceId: safeFailureEvidenceId,
      reviewEvidenceId: safeReviewEvidenceId
    };
  }
}

function createScopedDriverIdentityTrustService(persistenceContext, options = {}) {
  return new DriverIdentityTrustService({
    ...options,
    persistenceContext
  });
}

module.exports = new DriverIdentityTrustService();
module.exports.DriverIdentityTrustService = DriverIdentityTrustService;
module.exports.createScopedDriverIdentityTrustService = createScopedDriverIdentityTrustService;
module.exports.TRUST_TIERS = TRUST_TIERS;
module.exports.DEFAULTS = DEFAULTS;

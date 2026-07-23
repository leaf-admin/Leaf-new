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

const DEFAULTS = Object.freeze({
  cadenceEnabled: false,
  policyVersion: 'driver_identity_recurring_v1',
  newMaxAgeHours: 24,
  observedMaxAgeHours: 72,
  trustedMaxAgeHours: 168,
  observedMinDistinctSuccessDays: 7,
  trustedMinAgeDays: 30,
  trustedMinSuccessCount: 14,
  randomAuditPercent: 5,
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
    this.realtimeReader = options.realtimeReader || ((path) => firebaseConfig.getFromRealtimeDB(path));
    this.activeTripResolver = options.activeTripResolver || resolveActiveTripForDriver;
    this.activationService = options.activationService || driverActivationStateService;
    this.kycPolicyService = options.kycPolicyService || kycPolicyService;
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
    const awsSessionTtlSeconds = boundedInteger(
      env.KYC_AWS_LIVENESS_SESSION_TTL_SECONDS || env.AWS_LIVENESS_SESSION_TTL_SECONDS,
      20 * 60,
      60,
      24 * 60 * 60
    );
    return {
      cadenceEnabled: boolFromEnv(
        env.KYC_TRUST_CADENCE_ENABLED,
        DEFAULTS.cadenceEnabled
      ),
      policyVersion: String(
        env.KYC_TRUST_POLICY_VERSION || DEFAULTS.policyVersion
      ).trim() || DEFAULTS.policyVersion,
      newMaxAgeHours: boundedInteger(
        env.KYC_TRUST_T0_MAX_AGE_HOURS,
        DEFAULTS.newMaxAgeHours,
        1,
        24
      ),
      observedMaxAgeHours: boundedInteger(
        env.KYC_TRUST_T1_MAX_AGE_HOURS,
        DEFAULTS.observedMaxAgeHours,
        24,
        72
      ),
      trustedMaxAgeHours: boundedInteger(
        env.KYC_TRUST_T2_MAX_AGE_HOURS,
        DEFAULTS.trustedMaxAgeHours,
        72,
        168
      ),
      observedMinDistinctSuccessDays: boundedInteger(
        env.KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS,
        DEFAULTS.observedMinDistinctSuccessDays,
        2,
        30
      ),
      trustedMinAgeDays: boundedInteger(
        env.KYC_TRUST_T2_MIN_AGE_DAYS,
        DEFAULTS.trustedMinAgeDays,
        7,
        365
      ),
      trustedMinSuccessCount: boundedInteger(
        env.KYC_TRUST_T2_MIN_SUCCESS_COUNT,
        DEFAULTS.trustedMinSuccessCount,
        2,
        365
      ),
      randomAuditPercent: boundedNumber(
        env.KYC_TRUSTED_RANDOM_AUDIT_PERCENT,
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
    if (config.randomAuditPercent <= 0) {
      return {
        selected: false,
        dayKey,
        percentage: config.randomAuditPercent
      };
    }
    if (!this.redis) {
      const error = new Error('Redis indisponivel para decisao de auditoria aleatoria');
      error.code = 'KYC_RANDOM_AUDIT_STORE_UNAVAILABLE';
      throw error;
    }

    const key = this.buildRandomAuditKey(driverId, dayKey);
    const parseDecision = (raw) => {
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_error) {
        return null;
      }
      if (typeof parsed.selected !== 'boolean') return null;
      this.assertRecordScope(parsed);
      return parsed;
    };

    try {
      const existing = parseDecision(await this.redis.get(key));
      if (existing) return existing;

      const selected = this.randomInt(10000) < Math.round(config.randomAuditPercent * 100);
      const decision = {
        ...this.persistenceEnvelope(),
        selected,
        dayKey,
        percentage: config.randomAuditPercent,
        sampledAt: this.now().toISOString()
      };

      const stored = await this.redis.set(
        key,
        JSON.stringify(decision),
        'EX',
        config.randomAuditDecisionTtlSeconds,
        'NX'
      );
      if (stored === 'OK') return decision;
      const winner = parseDecision(await this.redis.get(key));
      if (winner) return winner;
      const error = new Error('Decisao concorrente de auditoria nao pode ser recuperada');
      error.code = 'KYC_RANDOM_AUDIT_DECISION_MISSING';
      throw error;
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
    const state = await this.readState(driverId);
    const evaluation = this.evaluateState(state, config);
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
    const claimToken = token || crypto.randomBytes(24).toString('hex');
    const claim = await claimIdentityVerificationWindow(
      this.redis,
      driverId,
      claimToken,
      this.getConfig().verificationWindowTtlSeconds
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
    } catch (_error) {
      return { hasValid: false, reason: 'Evidencia canonica invalida.' };
    }
    this.assertRecordScope(payload);

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

      gateWindowClaim = await this.claimVerificationWindow(driverId, {
        scope: 'driver_online_gate'
      });
      if (!gateWindowClaim.acquired) {
        const error = new Error('Outra validacao de identidade ja esta em andamento');
        error.code = 'KYC_VERIFICATION_IN_PROGRESS';
        throw error;
      }

      const activationState = await this.activationService.resolveDriverActivationState({ driverId });
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

      const config = this.getConfig();
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
      const biometricPolicy = this.resolveBiometricPolicy(this.env);
      const failClosed = biometricPolicy.productionBiometricsEnabled;
      this.logger('warn', `Falha no gate KYC (${failClosed ? 'fail-closed' : 'fail-open'})`, {
        service: 'driver-identity-trust-service',
        driverId,
        error: error.message
      });
      if (failClosed) {
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
      }
      releaseGateWindow = true;
      return {
        allowed: true,
        reason: 'Falha ao validar KYC (fail-open).',
        code: 'kycCheckFailedOpen'
      };
    } finally {
      if (gateWindowClaim?.acquired && releaseGateWindow) {
        await this.releaseVerificationWindow(gateWindowClaim).catch(() => null);
      }
    }
  }

  buildReferenceFingerprint(evidence = {}) {
    const reference = evidence.reference || {};
    if (Number(reference.bindingVersion) === 2) {
      return sha256(JSON.stringify({
        bindingVersion: 2,
        source: reference.source || null,
        documentType: reference.documentType || null,
        model: reference.model || null,
        submissionId: reference.submissionId || null,
        documentPathSha256: reference.documentPathSha256 || null,
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

    if (
      !driverId
      || !sessionHash
      || !challengeId
      || storedEvidence.schemaVersion !== 1
      || storedEvidence.policyVersion !== this.getConfig().policyVersion
      || storedEvidence.driverId !== driverId
      || storedEvidence.evidenceId !== sessionHash
      || storedEvidence.sourcePath !== 'server_side_aws_reference_compare'
      || storedEvidence.status !== 'approved'
      || storedEvidence.challengeId !== challengeId
      || storedEvidence.requirement !== expectedRequirement
      || expectedRequirement !== 'IDENTITY_REVERIFICATION'
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
      mode: 'canonical_identity_reconciliation_v1',
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
      evidenceId: sessionHash
    };
  }

  async assertCurrentApprovedReference(driverId, evidence = {}) {
    const submissionId = String(evidence.reference?.submissionId || '').trim();
    if (!submissionId) {
      const error = new Error('Embedding facial nao vinculado a uma submissao de CNH');
      error.code = 'KYC_CANONICAL_CNH_SUBMISSION_MISSING';
      throw error;
    }

    const document = await this.realtimeReader(`users/${driverId}/documents/cnh`);
    const documentSubmissionId = String(
      document?.lastSubmissionId || document?.submissionId || ''
    ).trim();
    const documentStatus = String(
      document?.analysisStatus || document?.status || ''
    ).trim().toLowerCase();
    if (documentStatus !== 'approved') {
      const error = new Error('CNH atual nao esta aprovada para comparacao canonica');
      error.code = 'KYC_CANONICAL_CNH_NOT_APPROVED';
      throw error;
    }
    if (!documentSubmissionId || documentSubmissionId !== submissionId) {
      const error = new Error('Embedding facial nao corresponde a CNH atualmente aprovada');
      error.code = 'KYC_CANONICAL_CNH_SUBMISSION_MISMATCH';
      throw error;
    }
    const reference = evidence.reference || {};
    if (Number(reference.bindingVersion) === 2) {
      const documentPath = String(document?.filePath || '').trim();
      const documentPathSha256 = sha256(documentPath);
      if (
        !documentPath
        || !/^[a-f0-9]{64}$/i.test(String(reference.documentPathSha256 || ''))
        || reference.documentPathSha256 !== documentPathSha256
        || !/^[a-f0-9]{64}$/i.test(String(reference.imageSha256 || ''))
        || !String(reference.cropVersion || '').trim()
        || reference.source !== 'approved_cnh_pdf_crop_v1'
      ) {
        const error = new Error('Referência canônica não corresponde ao PDF atual da CNH');
        error.code = 'KYC_CANONICAL_CNH_REFERENCE_BINDING_INVALID';
        throw error;
      }
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
    } catch (error) {
      await this.releaseVerificationWindow(verificationWindowClaim).catch(() => null);
      throw error;
    }
    if (consumed.exists) this.assertRecordScope(consumed.data() || {});
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
      && state.distinctSuccessDays >= config.observedMinDistinctSuccessDays
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
        ...this.persistenceEnvelope(stateSnapshot.exists ? previousState : null),
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
        modelFingerprint,
        revokedAt: null,
        revocationReason: null,
        updatedAt: nowIso
      };

      transaction.set(evidenceRef, canonicalEvidence, { merge: false });
      transaction.set(stateRef, nextState, { merge: false });
      if (challengeRef) {
        transaction.set(challengeRef, {
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
        ...this.persistenceEnvelope(result.state),
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
          ...this.persistenceEnvelope(snapshot.exists ? previous : null),
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
}

function createScopedDriverIdentityTrustService(persistenceContext, options = {}) {
  if (!persistenceContext || typeof persistenceContext !== 'object') {
    const error = new Error('Contexto de persistencia obrigatorio para factory de confianca KYC');
    error.code = 'KYC_TRUST_PERSISTENCE_CONTEXT_REQUIRED';
    throw error;
  }
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

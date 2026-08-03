'use strict';

const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const operationalWorkflow = require('./kyc-identity-review-workflow-service');
const {
  KycIdentityReviewWorkflowService
} = require('./kyc-identity-review-workflow-service');
const operationalTrust = require('./driver-identity-trust-service');
const {
  createScopedDriverIdentityTrustService
} = require('./driver-identity-trust-service');
const operationalEvidence = require('./kyc-failed-biometric-evidence-service');
const {
  createScopedKycFailedBiometricEvidenceService
} = require('./kyc-failed-biometric-evidence-service');
const operationalPolicy = require('./kyc-policy-service');
const operationalSupportTicketService = require('./support-ticket-service');
const {
  commitDriverOnlineProjection
} = require('./driver-online-projection-service');
const {
  resolveUserPersistenceScope,
  resolveKycPersistenceScope,
  buildScopedPersistenceEnvelope,
  assertStoredRecordMatchesScope
} = require('./sandbox-persistence-context');

class KycRuntimeScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KycRuntimeScopeError';
    this.code = code;
  }
}

function normalizeUserId(value) {
  return String(value || '').trim();
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function asIso(value) {
  const millis = toMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : null;
}

function requiredId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 160 || normalized.includes('/') || normalized.includes('..')) {
    throw new KycRuntimeScopeError(
      'KYC_SANDBOX_CHALLENGE_INPUT_INVALID',
      `${label} invalido`
    );
  }
  return normalized;
}

const LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE = 'aws_liveness_attempts_exhausted';
const IDENTITY_REVERIFY_PUBLIC_REASON = 'Por segurança, precisamos validar sua identidade.';

class SandboxKycPolicyAdapter {
  constructor({
    scope,
    policyService = operationalPolicy,
    firestoreProvider = () => firebaseConfig.getFirestore(),
    redis = redisPool.getConnection(),
    supportTicketService = operationalSupportTicketService,
    now = () => new Date(),
    challengeIdGenerator = () => `kyc_ch_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
  } = {}) {
    this.scope = resolveKycPersistenceScope(scope || {}, { allowLegacyOperational: false });
    if (this.scope.namespace !== 'sandbox' || !this.scope.financialContext) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_SANDBOX_CONTEXT_REQUIRED',
        'Policy adapter sandbox exige contexto financeiro selado'
      );
    }
    if (!policyService || typeof policyService.requireApprovedKyc !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_POLICY_UNAVAILABLE',
        'Leitura canonica da aprovacao KYC indisponivel'
      );
    }
    this.policyService = policyService;
    this.firestoreProvider = firestoreProvider;
    this.redis = redis;
    this.supportTicketService = supportTicketService;
    this.now = now;
    this.challengeIdGenerator = challengeIdGenerator;
    this.collectionName = this.scope.collections.kycStepUpChallenges;
    this.challengePrefix = this.scope.kycResources.identityTrustStepUpChallengePrefix;
    this.activeChallengePrefix = this.scope.kycResources.identityTrustStepUpActivePrefix;
    this.createLockPrefix = this.scope.kycResources.identityTrustStepUpCreateLockPrefix;
    this.driverHashPrefix = this.scope.kycResources.identityTrustDriverHashPrefix;
    this.inFlight = new Map();
  }

  envelope(record = null) {
    return buildScopedPersistenceEnvelope(this.scope, { record });
  }

  assertRecord(record) {
    assertStoredRecordMatchesScope(record, this.scope);
    return record;
  }

  firestore() {
    const firestore = this.firestoreProvider?.();
    if (!firestore || typeof firestore.collection !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_CHALLENGE_STORE_UNAVAILABLE',
        'Firestore sandbox indisponivel para challenge KYC'
      );
    }
    return firestore;
  }

  redisConnection() {
    if (!this.redis || typeof this.redis.get !== 'function' || typeof this.redis.set !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_CHALLENGE_CACHE_UNAVAILABLE',
        'Redis sandbox indisponivel para challenge KYC'
      );
    }
    return this.redis;
  }

  challengeTtlSeconds() {
    const configured = Number(this.policyService.getConfig?.().challengeTtlSeconds);
    if (!Number.isFinite(configured)) return 15 * 60;
    return Math.min(24 * 60 * 60, Math.max(60, Math.round(configured)));
  }

  normalizeSource(value) {
    return String(value || '').trim() || 'legacy';
  }

  normalizeMetadata(metadata, source) {
    return {
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      challengeSource: this.normalizeSource(source)
    };
  }

  normalizeChallenge(record = {}, fallbackId = null) {
    this.assertRecord(record);
    const source = this.normalizeSource(record.source);
    return {
      ...record,
      challengeId: record.challengeId || fallbackId,
      score: Number(record.score || 0),
      signals: Array.isArray(record.signals) ? record.signals : [],
      source,
      metadata: this.normalizeMetadata(record.metadata, source),
      createdAt: asIso(record.createdAt),
      expiresAt: asIso(record.expiresAt)
    };
  }

  async requireApprovedKyc(driverId) {
    return this.policyService.requireApprovedKyc(driverId);
  }

  isLivenessSatisfied(payload = {}) {
    if (typeof this.policyService.isLivenessSatisfied === 'function') {
      return this.policyService.isLivenessSatisfied(payload);
    }
    return payload.azure?.liveness?.passed === true
      || payload.azureLivenessPassed === true
      || payload.aws?.passed === true
      || payload.awsLivenessPassed === true;
  }

  async persistRedisChallenge(challenge, ttlSeconds) {
    const redis = this.redisConnection();
    if (typeof redis.multi !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_CHALLENGE_CACHE_UNAVAILABLE',
        'Redis transacional indisponivel para challenge KYC sandbox'
      );
    }
    const multi = redis.multi();
    multi.set(
      `${this.challengePrefix}${challenge.challengeId}`,
      JSON.stringify(challenge),
      'EX',
      ttlSeconds
    );
    multi.set(
      `${this.activeChallengePrefix}${challenge.driverId}`,
      challenge.challengeId,
      'EX',
      ttlSeconds
    );
    const result = await multi.exec();
    if (!result) {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_CHALLENGE_CACHE_PERSIST_FAILED',
        'Redis nao confirmou o challenge KYC sandbox'
      );
    }
  }

  async createStepUpChallenge({
    challengeId: requestedChallengeId = null,
    driverId,
    requirement,
    score,
    signals,
    source,
    metadata = {}
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeRequirement = requiredId(requirement, 'requirement');
    const challengeId = requiredId(
      requestedChallengeId || this.challengeIdGenerator(),
      'challengeId'
    );
    const now = this.now();
    const ttlSeconds = this.challengeTtlSeconds();
    const expiresAt = new Date(now.getTime() + (ttlSeconds * 1000));
    const normalizedSource = this.normalizeSource(source);
    const challenge = {
      ...this.envelope(),
      challengeId,
      driverId: safeDriverId,
      requirement: safeRequirement,
      score: Number(score || 0),
      signals: Array.isArray(signals) ? signals : [],
      source: normalizedSource,
      metadata: this.normalizeMetadata(metadata, normalizedSource),
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    const docRef = this.firestore().collection(this.collectionName).doc(challengeId);

    if (typeof docRef.create === 'function') {
      await docRef.create({ ...challenge, createdAt: now, expiresAt });
    } else {
      await docRef.set({ ...challenge, createdAt: now, expiresAt }, { merge: false });
    }
    try {
      await this.persistRedisChallenge(challenge, ttlSeconds);
    } catch (error) {
      await docRef.delete?.().catch(() => null);
      throw error;
    }
    return challenge;
  }

  reusableChallenge(challenge, { requirement, source }) {
    if (!challenge || challenge.status !== 'pending' || challenge.requirement !== requirement) {
      return null;
    }
    const requestedSource = this.normalizeSource(source);
    if (challenge.source !== requestedSource) {
      const error = new KycRuntimeScopeError(
        'KYC_CHALLENGE_SOURCE_CONFLICT',
        'Challenge KYC sandbox ativo pertence a outro fluxo'
      );
      error.activeChallengeId = challenge.challengeId;
      error.activeSource = challenge.source;
      error.requestedSource = requestedSource;
      throw error;
    }
    return challenge;
  }

  async getStepUpChallenge(challengeId, driverId = null) {
    const redis = this.redisConnection();
    let effectiveChallengeId = String(challengeId || '').trim();
    if (!effectiveChallengeId && driverId) {
      effectiveChallengeId = String(
        await redis.get(`${this.activeChallengePrefix}${requiredId(driverId, 'driverId')}`) || ''
      ).trim();
    }
    if (!effectiveChallengeId) return null;
    requiredId(effectiveChallengeId, 'challengeId');

    const snapshot = await this.firestore()
      .collection(this.collectionName)
      .doc(effectiveChallengeId)
      .get();
    if (!snapshot?.exists) return null;
    const challenge = this.normalizeChallenge(snapshot.data() || {}, snapshot.id || effectiveChallengeId);
    if (driverId && challenge.driverId !== driverId) return null;
    if (challenge.status !== 'pending' || toMillis(challenge.expiresAt) <= this.now().getTime()) {
      return null;
    }
    return challenge;
  }

  async releaseCreateLock(key, token) {
    const redis = this.redisConnection();
    if (typeof redis.eval === 'function') {
      await redis.eval(
        'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
        1,
        key,
        token
      ).catch(() => null);
      return;
    }
    const current = await redis.get(key).catch(() => null);
    if (current === token) await redis.del(key).catch(() => null);
  }

  async getOrCreateStepUpChallenge(input = {}) {
    const safeDriverId = requiredId(input.driverId, 'driverId');
    const safeRequirement = requiredId(input.requirement, 'requirement');
    const source = this.normalizeSource(input.source);
    const inFlightKey = `${safeDriverId}:${safeRequirement}:${source}`;
    const existingOperation = this.inFlight.get(inFlightKey);
    if (existingOperation) return existingOperation;

    const operation = this.getOrCreateStepUpChallengeDistributed({
      ...input,
      driverId: safeDriverId,
      requirement: safeRequirement,
      source
    }).finally(() => {
      if (this.inFlight.get(inFlightKey) === operation) this.inFlight.delete(inFlightKey);
    });
    this.inFlight.set(inFlightKey, operation);
    return operation;
  }

  async getOrCreateStepUpChallengeDistributed(input) {
    const reusable = this.reusableChallenge(
      await this.getStepUpChallenge(null, input.driverId),
      input
    );
    if (reusable) return reusable;

    const redis = this.redisConnection();
    const lockKey = `${this.createLockPrefix}${input.driverId}`;
    const lockToken = crypto.randomBytes(16).toString('hex');
    const acquired = await redis.set(lockKey, lockToken, 'EX', 5, 'NX');
    if (acquired !== 'OK') {
      const winner = this.reusableChallenge(
        await this.getStepUpChallenge(null, input.driverId),
        input
      );
      if (winner) return winner;
      throw new KycRuntimeScopeError(
        'KYC_CHALLENGE_CREATE_BUSY',
        'Criacao de challenge KYC sandbox ja esta em andamento'
      );
    }

    try {
      const winner = this.reusableChallenge(
        await this.getStepUpChallenge(null, input.driverId),
        input
      );
      return winner || this.createStepUpChallenge(input);
    } finally {
      await this.releaseCreateLock(lockKey, lockToken);
    }
  }

  async resolveStepUpChallenge({
    challengeId,
    driverId,
    requirement,
    verificationPayload = {}
  } = {}) {
    const challenge = await this.getStepUpChallenge(challengeId, driverId);
    if (!challenge) {
      return {
        success: false,
        error: 'Challenge KYC nao encontrado ou expirado',
        code: 'KYC_CHALLENGE_NOT_FOUND'
      };
    }
    const effectiveRequirement = challenge.requirement || requirement || 'VERIFY_REQUIRED';
    if (effectiveRequirement === 'LIVENESS_REQUIRED' && !this.isLivenessSatisfied(verificationPayload)) {
      return {
        success: false,
        error: 'Liveness obrigatorio para concluir este desafio',
        code: 'KYC_LIVENESS_REQUIRED'
      };
    }

    const resolvedAt = this.now();
    const firestore = this.firestore();
    const docRef = firestore.collection(this.collectionName).doc(challenge.challengeId);
    const patch = {
      ...this.envelope(challenge),
      status: 'resolved',
      resolvedAt,
      updatedAt: resolvedAt,
      resolution: {
        requirement: effectiveRequirement,
        provider: verificationPayload.provider || verificationPayload.mode || 'unknown',
        livenessPassed: this.isLivenessSatisfied(verificationPayload),
        similarityScore: Number(verificationPayload.similarityScore || 0),
        confidence: Number(verificationPayload.confidence || 0)
      }
    };
    if (typeof firestore.runTransaction === 'function') {
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new KycRuntimeScopeError(
            'KYC_CHALLENGE_NOT_FOUND',
            'Challenge KYC sandbox nao encontrado'
          );
        }
        const current = snapshot.data() || {};
        this.assertRecord(current);
        if (current.driverId !== challenge.driverId || current.status !== 'pending') {
          throw new KycRuntimeScopeError(
            'KYC_CHALLENGE_STATE_CONFLICT',
            'Challenge KYC sandbox nao esta mais pendente'
          );
        }
        transaction.set(docRef, patch, { merge: true });
      });
    } else {
      await docRef.set(patch, { merge: true });
    }

    const redis = this.redisConnection();
    if (typeof redis.multi === 'function') {
      const multi = redis.multi();
      multi.del(`${this.challengePrefix}${challenge.challengeId}`);
      multi.del(`${this.activeChallengePrefix}${challenge.driverId}`);
      const result = await multi.exec();
      if (!result) {
        throw new KycRuntimeScopeError(
          'KYC_SANDBOX_CHALLENGE_CACHE_RESOLVE_FAILED',
          'Redis nao confirmou a conclusao do challenge KYC sandbox'
        );
      }
    } else {
      await redis.del(`${this.challengePrefix}${challenge.challengeId}`);
      await redis.del(`${this.activeChallengePrefix}${challenge.driverId}`);
    }
    return {
      success: true,
      challengeId: challenge.challengeId,
      resolvedAt: resolvedAt.toISOString(),
      requirement: effectiveRequirement
    };
  }

  normalizeAttemptScope(value) {
    const normalized = String(value || '').trim();
    if (
      /^manual_review_retry_kyc_ir_[a-f0-9]{32}$/.test(normalized)
      || /^orphan_hold_retry_kyc_or_[a-f0-9]{32}$/.test(normalized)
    ) {
      return normalized;
    }
    return null;
  }

  async bindSupportTicketToChallenge({ driverId, challengeId, supportTicketId }) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeChallengeId = requiredId(challengeId, 'challengeId');
    const safeSupportTicketId = requiredId(supportTicketId, 'supportTicketId');
    const firestore = this.firestore();
    const docRef = firestore.collection(this.collectionName).doc(safeChallengeId);
    let boundChallenge = null;

    const bind = async (snapshot, persist) => {
      if (!snapshot?.exists) {
        throw new KycRuntimeScopeError(
          'KYC_CHALLENGE_NOT_FOUND',
          'Challenge de revalidacao sandbox nao encontrado'
        );
      }
      const current = this.normalizeChallenge(snapshot.data() || {}, snapshot.id || safeChallengeId);
      if (current.driverId !== safeDriverId || current.requirement !== 'IDENTITY_REVERIFICATION') {
        throw new KycRuntimeScopeError(
          'KYC_CHALLENGE_BINDING_CONFLICT',
          'Challenge de revalidacao sandbox possui binding divergente'
        );
      }
      const currentTicketId = String(current.metadata?.supportTicketId || '').trim();
      if (currentTicketId && currentTicketId !== safeSupportTicketId) {
        throw new KycRuntimeScopeError(
          'KYC_CHALLENGE_SUPPORT_TICKET_CONFLICT',
          'Challenge de revalidacao sandbox ja esta vinculado a outro ticket'
        );
      }
      const updatedAt = this.now();
      const patch = {
        ...this.envelope(current),
        metadata: {
          ...(current.metadata || {}),
          supportTicketId: safeSupportTicketId
        },
        updatedAt
      };
      await persist(patch);
      boundChallenge = {
        ...current,
        ...patch,
        updatedAt: updatedAt.toISOString()
      };
    };

    if (typeof firestore.runTransaction === 'function') {
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        await bind(snapshot, async (patch) => transaction.set(docRef, patch, { merge: true }));
      });
    } else {
      const snapshot = await docRef.get();
      await bind(snapshot, async (patch) => docRef.set(patch, { merge: true }));
    }
    return boundChallenge;
  }

  async applyIdentityReverificationGate({
    driverId,
    tripId = null,
    reporterId = null,
    reporterType = 'passenger',
    payload = {},
    supportTicketId = null,
    challengeId = null
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const safeChallengeId = challengeId ? requiredId(challengeId, 'challengeId') : null;
    const sourcePayload = payload && typeof payload === 'object' ? payload : {};
    const reasonCode = String(
      sourcePayload.reasonCode || 'identity_photo_mismatch_reported'
    ).trim();
    const reason = String(
      sourcePayload.publicReason || 'Precisamos confirmar sua identidade antes de ficar online.'
    ).trim();
    const attemptScope = this.normalizeAttemptScope(sourcePayload.attemptScope);
    const sourceChallengeId = sourcePayload.sourceChallengeId
      ? requiredId(sourcePayload.sourceChallengeId, 'sourceChallengeId')
      : null;
    const attemptState = sourcePayload.attemptState && typeof sourcePayload.attemptState === 'object'
      && !Array.isArray(sourcePayload.attemptState)
      ? sourcePayload.attemptState
      : {};
    const metadata = {
      canonicalEvidenceRequired: true,
      reasonCode,
      publicReason: reason,
      attemptScope,
      sourceChallengeId,
      attemptState,
      reporterId: reporterId ? String(reporterId) : null,
      reporterType: String(reporterType || 'passenger'),
      supportTicketId: supportTicketId ? String(supportTicketId) : null,
      tripId: tripId ? String(tripId) : null,
      selectedOptions: Array.isArray(sourcePayload.selectedOptions)
        ? sourcePayload.selectedOptions
        : []
    };

    let challenge = null;
    if (safeChallengeId) {
      challenge = await this.getStepUpChallenge(safeChallengeId, safeDriverId);
      if (challenge) {
        const sameBinding = challenge.requirement === 'IDENTITY_REVERIFICATION'
          && challenge.source === this.normalizeSource(reasonCode)
          && (challenge.metadata?.attemptScope || null) === attemptScope;
        if (!sameBinding) {
          throw new KycRuntimeScopeError(
            'KYC_CHALLENGE_BINDING_CONFLICT',
            'Challenge de revalidacao sandbox possui binding divergente'
          );
        }
      } else {
        const active = await this.getStepUpChallenge(null, safeDriverId);
        if (active && active.challengeId !== safeChallengeId) {
          throw new KycRuntimeScopeError(
            'KYC_CHALLENGE_ACTIVE_CONFLICT',
            'Motorista ja possui outro challenge KYC sandbox ativo'
          );
        }
        challenge = await this.createStepUpChallenge({
          challengeId: safeChallengeId,
          driverId: safeDriverId,
          requirement: 'IDENTITY_REVERIFICATION',
          score: 100,
          signals: [{
            code: reasonCode,
            weight: 100,
            message: reason
          }],
          source: reasonCode,
          metadata
        });
      }
    } else {
      challenge = await this.getOrCreateStepUpChallenge({
        driverId: safeDriverId,
        requirement: 'IDENTITY_REVERIFICATION',
        score: 100,
        signals: [{
          code: reasonCode,
          weight: 100,
          message: reason
        }],
        source: reasonCode,
        metadata
      });
    }

    const persistedMetadata = challenge.metadata || {};
    const sameIdentityBinding = challenge.requirement === 'IDENTITY_REVERIFICATION'
      && challenge.source === this.normalizeSource(reasonCode)
      && (persistedMetadata.attemptScope || null) === attemptScope
      && (
        (!persistedMetadata.sourceChallengeId && !sourceChallengeId)
        || persistedMetadata.sourceChallengeId === sourceChallengeId
      );
    if (!sameIdentityBinding) {
      throw new KycRuntimeScopeError(
        'KYC_CHALLENGE_BINDING_CONFLICT',
        'Challenge de revalidacao sandbox possui binding divergente'
      );
    }
    const persistedSupportTicketId = String(persistedMetadata.supportTicketId || '').trim();
    const requestedSupportTicketId = String(metadata.supportTicketId || '').trim();
    if (
      persistedSupportTicketId
      && requestedSupportTicketId
      && persistedSupportTicketId !== requestedSupportTicketId
    ) {
      throw new KycRuntimeScopeError(
        'KYC_CHALLENGE_SUPPORT_TICKET_CONFLICT',
        'Challenge de revalidacao sandbox ja esta vinculado a outro ticket'
      );
    }
    if (!persistedSupportTicketId && requestedSupportTicketId) {
      challenge = await this.bindSupportTicketToChallenge({
        driverId: safeDriverId,
        challengeId: challenge.challengeId,
        supportTicketId: requestedSupportTicketId
      });
    }

    if (!this.redis || typeof this.redis.eval !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_CHALLENGE_CACHE_UNAVAILABLE',
        'Redis sandbox indisponivel para selar revalidacao KYC'
      );
    }
    await commitDriverOnlineProjection(this.redis, {
      driverId: safeDriverId,
      driverKey: `${this.driverHashPrefix}${safeDriverId}`,
      eligibleGeoKey: process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
      projectionScope: 'eligibility_only',
      dispatchEligible: false,
      fields: {
        kyc_reverify_required: String(true),
        kyc_reverify_source: reasonCode,
        kyc_status: 'pending_reverify',
        dispatchEligible: String(false),
        dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED',
        identity_reverification_challenge_id: challenge.challengeId,
        identity_reverification_attempt_scope: attemptScope || '',
        identity_reverification_requested_at: this.now().toISOString()
      }
    });

    return {
      success: true,
      driverId: safeDriverId,
      reason,
      reasonCode,
      requirement: 'IDENTITY_REVERIFICATION',
      challengeId: challenge.challengeId,
      supportTicketId: challenge.metadata?.supportTicketId || metadata.supportTicketId,
      reverifyRequired: true,
      softBlocked: true,
      scoped: true
    };
  }

  async markDriverForLivenessAttemptsExhausted({
    driverId,
    challengeId = null,
    attemptState = {},
    metadata = {}
  } = {}) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const sourceChallengeId = challengeId ? requiredId(challengeId, 'challengeId') : null;
    const normalizedAttemptState = attemptState && typeof attemptState === 'object'
      && !Array.isArray(attemptState)
      ? attemptState
      : {};
    const normalizedMetadata = metadata && typeof metadata === 'object'
      && !Array.isArray(metadata)
      ? metadata
      : {};
    const gateInput = {
      driverId: safeDriverId,
      reporterType: 'system',
      payload: {
        reasonCode: LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE,
        publicReason: IDENTITY_REVERIFY_PUBLIC_REASON,
        selectedOptions: [LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE],
        attemptScope: normalizedMetadata.attemptScope || normalizedAttemptState.attemptScope || null,
        sourceChallengeId,
        attemptState: normalizedAttemptState
      }
    };
    let gate = await this.applyIdentityReverificationGate(gateInput);
    const existingSupportTicketId = String(gate.supportTicketId || '').trim();
    if (existingSupportTicketId) {
      return {
        ...gate,
        success: true,
        softBlocked: true,
        supportTicketId: existingSupportTicketId,
        challengeId: gate.challengeId
      };
    }
    if (!this.supportTicketService || typeof this.supportTicketService.createTicket !== 'function') {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_SUPPORT_UNAVAILABLE',
        'Suporte KYC sandbox indisponivel para registrar o limite de tentativas'
      );
    }
    const { ticket } = await this.supportTicketService.createTicket({
      requesterId: safeDriverId,
      userType: 'driver',
      subject: 'Validação facial não concluída',
      description: 'O motorista excedeu o limite de tentativas de liveness e precisa de apoio para concluir a validação de identidade.',
      category: 'kyc',
      priority: 'N2',
      metadata: {
        ...normalizedMetadata,
        automated: true,
        reasonCode: LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE,
        challengeId: sourceChallengeId,
        identityReverificationChallengeId: gate.challengeId,
        attemptState: normalizedAttemptState
      },
      persistenceContext: this.scope
    });
    const supportTicketId = String(ticket?.id || '').trim();
    if (!supportTicketId) {
      throw new KycRuntimeScopeError(
        'KYC_SANDBOX_SUPPORT_TICKET_INVALID',
        'Suporte KYC sandbox nao confirmou o ticket de limite de tentativas'
      );
    }

    gate = await this.applyIdentityReverificationGate({
      ...gateInput,
      challengeId: gate.challengeId,
      supportTicketId
    });

    return {
      ...gate,
      success: true,
      softBlocked: true,
      supportTicketId,
      challengeId: gate.challengeId
    };
  }

  async updateIdentityChallengeMetadata(driverId, payload = {}, eventName) {
    const safeDriverId = requiredId(driverId, 'driverId');
    const challengeId = String(payload.challengeId || payload.payload?.challengeId || '').trim();
    const requirement = payload.requirement || payload.payload?.requirement || null;
    if (requirement !== 'IDENTITY_REVERIFICATION' && !challengeId) {
      return { success: true, driverId: safeDriverId, recorded: false, scoped: true };
    }
    if (!challengeId) {
      return {
        success: true,
        driverId: safeDriverId,
        recorded: false,
        stale: true,
        scoped: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }
    const challenge = await this.getStepUpChallenge(challengeId, safeDriverId);
    if (!challenge || challenge.requirement !== 'IDENTITY_REVERIFICATION') {
      return {
        success: true,
        driverId: safeDriverId,
        recorded: false,
        stale: true,
        scoped: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }
    const occurredAt = this.now();
    const event = {
      name: eventName,
      occurredAt: occurredAt.toISOString(),
      decision: payload.decision || null,
      isMatch: payload.isMatch === true,
      needsReview: payload.needsReview === true,
      similarityScore: Number(payload.similarityScore ?? payload.confidence ?? 0)
    };
    await this.firestore()
      .collection(this.collectionName)
      .doc(challenge.challengeId)
      .set({
        ...this.envelope(challenge),
        metadata: {
          ...(challenge.metadata || {}),
          lastIdentityEvent: event
        },
        updatedAt: occurredAt
      }, { merge: true });
    return { success: true, driverId: safeDriverId, recorded: true, scoped: true };
  }

  async recordIdentityReverificationStarted(driverId, payload = {}) {
    return this.updateIdentityChallengeMetadata(driverId, payload, 'validation_started');
  }

  async recordIdentityReverificationResult(driverId, payload = {}) {
    const result = await this.updateIdentityChallengeMetadata(
      driverId,
      payload,
      'validation_result'
    );
    if (
      result?.recorded !== true
      || payload.isMatch !== true
      || payload.needsReview === true
    ) {
      return result;
    }

    const challengeId = String(payload.challengeId || payload.payload?.challengeId || '').trim();
    const resolved = await this.resolveStepUpChallenge({
      challengeId,
      driverId,
      requirement: 'IDENTITY_REVERIFICATION',
      verificationPayload: {
        ...payload,
        awsLivenessPassed: true,
        provider: payload.provider || payload.comparisonProvider || 'aws_rekognition_compare_faces'
      }
    });
    if (resolved?.success !== true) {
      return {
        ...result,
        recorded: false,
        stale: true,
        code: resolved?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }

    if (typeof this.redis.hset === 'function') {
      await this.redis.hset(`${this.driverHashPrefix}${driverId}`, {
        kyc_reverify_required: String(false),
        kyc_status: 'approved',
        kyc_blocked: String(false),
        identity_reverification_status: 'passed',
        identity_reverification_pending_after_trip: String(false)
      });
    }
    if (typeof this.redis.hdel === 'function') {
      await this.redis.hdel(
        `${this.driverHashPrefix}${driverId}`,
        'dispatchEligible',
        'dispatchEligibilityCode',
        'identity_reverification_challenge_id',
        'identity_reverification_attempt_scope',
        'identity_reverification_requested_at'
      );
    }
    return {
      ...result,
      challengeResolved: true,
      resolvedAt: resolved.resolvedAt
    };
  }

  async recordVerificationSuccess(driverId, options = {}) {
    return this.updateIdentityChallengeMetadata(driverId, {
      ...options,
      challengeId: options.challengeId || null,
      requirement: options.requirement || null,
      isMatch: true,
      decision: 'approve'
    }, 'verification_success');
  }
}

function createSandboxPolicyGuard(policyService = operationalPolicy, options = {}) {
  return new SandboxKycPolicyAdapter({
    ...options,
    policyService
  });
}

function wrapSandboxTrustFailClosed(trustService) {
  return new Proxy(trustService, {
    get(target, property, receiver) {
      if (property !== 'evaluateOnlineGate') {
        return Reflect.get(target, property, receiver);
      }
      return async (...args) => {
        const result = await target.evaluateOnlineGate(...args);
        if (result?.allowed === true && result?.code === 'kycCheckFailedOpen') {
          return {
            ...result,
            allowed: false,
            retryRequired: true,
            code: 'KYC_SANDBOX_POLICY_SCOPE_UNAVAILABLE',
            reason: 'Nao foi possivel validar a identidade no ambiente de teste agora.'
          };
        }
        return result;
      };
    }
  });
}

const REQUIRED_WORKFLOW_METHODS = Object.freeze([
  'openCaseFromTicket',
  'resumeExistingCaseRequest',
  'assertKycOperationAllowed',
  'claimCleanRetryAuthorization',
  'consumeCleanRetryAuthorization',
  'resumeCleanRetryAuthorization',
  'releaseCleanRetryAuthorization',
  'finalizeCleanRetryAuthorization',
  'clearResolvedMismatchHold'
]);
const REQUIRED_TRUST_METHODS = Object.freeze([
  'evaluateOnlineGate',
  'assertVerificationOutsideActiveTrip',
  'claimVerificationWindow',
  'renewVerificationWindow',
  'releaseVerificationWindow',
  'claimCanonicalSession',
  'renewCanonicalSessionClaim',
  'releaseCanonicalSessionClaim',
  'readCanonicalCompatibilityVerification',
  'recordCanonicalSuccess',
  'recordCanonicalFailure',
  'linkReviewEvidenceToCanonicalFailure',
  'restoreApprovedIdentityVerification',
  'restoreRejectedIdentityVerification'
]);
const REQUIRED_EVIDENCE_METHODS = Object.freeze([
  'captureRejectedComparisonEvidence'
]);
const REQUIRED_POLICY_METHODS = Object.freeze([
  'requireApprovedKyc',
  'getStepUpChallenge',
  'getOrCreateStepUpChallenge',
  'createStepUpChallenge',
  'resolveStepUpChallenge',
  'applyIdentityReverificationGate',
  'markDriverForLivenessAttemptsExhausted',
  'recordIdentityReverificationStarted',
  'recordIdentityReverificationResult',
  'recordVerificationSuccess'
]);

function hasMethods(service, methods) {
  return methods.every((method) => typeof service?.[method] === 'function');
}

function withServiceAliases(services = {}) {
  return Object.freeze({
    ...services,
    workflowService: services.workflow,
    trustService: services.trust,
    evidenceService: services.evidence,
    policyService: services.policy
  });
}

class KycRuntimeScopeService {
  constructor(options = {}) {
    this.resolveUserScope = options.resolveUserScope || resolveUserPersistenceScope;
    this.operationalServices = Object.freeze({
      workflow: options.operationalWorkflow || operationalWorkflow,
      trust: options.operationalTrust || operationalTrust,
      evidence: options.operationalEvidence || operationalEvidence,
      policy: options.operationalPolicy || operationalPolicy
    });
    this.createScopedEvidence = options.createScopedEvidence
      || createScopedKycFailedBiometricEvidenceService;
    this.createScopedTrust = options.createScopedTrust
      || createScopedDriverIdentityTrustService;
    this.createScopedWorkflow = options.createScopedWorkflow
      || ((factoryOptions) => new KycIdentityReviewWorkflowService(factoryOptions));
    this.createSandboxPolicy = options.createSandboxPolicy || ((scope) =>
      createSandboxPolicyGuard(options.operationalPolicy || operationalPolicy, {
        scope,
        ...(options.sandboxPolicyOptions || {})
      }));
    this.sandboxCache = options.sandboxCache || new Map();
  }

  assertServiceSurface(services = {}) {
    if (
      !hasMethods(services.workflow, REQUIRED_WORKFLOW_METHODS)
      || !hasMethods(services.trust, REQUIRED_TRUST_METHODS)
      || !hasMethods(services.evidence, REQUIRED_EVIDENCE_METHODS)
      || !hasMethods(services.policy, REQUIRED_POLICY_METHODS)
    ) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_SERVICE_UNAVAILABLE',
        'Superficie de servicos KYC incompleta'
      );
    }
    return services;
  }

  assertExpectedScope(scope, expectedPersistenceContext) {
    if (!expectedPersistenceContext) return;
    const expected = resolveKycPersistenceScope(expectedPersistenceContext, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });
    const namespaceMismatch = expected.namespace !== scope.namespace;
    const sandboxContextMismatch = scope.namespace === 'sandbox'
      && expected.financialContextId
      && expected.financialContextId !== scope.financialContextId;
    if (namespaceMismatch || sandboxContextMismatch) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_SCOPE_MISMATCH',
        'Contexto KYC diverge do contexto de persistencia autorizado'
      );
    }
  }

  assertScopedService(service, scope, label) {
    const serviceScope = service?.persistenceScope;
    if (
      !serviceScope
      || serviceScope.namespace !== 'sandbox'
      || serviceScope.financialContextId !== scope.financialContextId
    ) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_SERVICE_SCOPE_MISMATCH',
        `${label} nao foi vinculado ao contexto sandbox autoritativo`
      );
    }
  }

  buildSandboxServices(scope) {
    if (!scope.financialContext || !scope.financialContextId) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_SANDBOX_CONTEXT_REQUIRED',
        'Runtime KYC sandbox exige contexto financeiro selado'
      );
    }

    const cached = this.sandboxCache.get(scope.financialContextId);
    if (cached) return cached;

    const evidence = this.createScopedEvidence(scope.financialContext);
    const policy = this.createSandboxPolicy(scope);
    const trust = this.createScopedTrust(scope.financialContext, {
      kycPolicyService: policy
    });
    const workflow = this.createScopedWorkflow({
      persistenceContext: scope.financialContext,
      identityTrustService: trust,
      evidenceService: evidence
    });

    this.assertScopedService(evidence, scope, 'Evidencia biometrica');
    this.assertScopedService(trust, scope, 'Confianca de identidade');
    this.assertScopedService(workflow, scope, 'Workflow de revisao');

    const services = withServiceAliases(this.assertServiceSurface({
      workflow,
      trust: wrapSandboxTrustFailClosed(trust),
      evidence,
      policy
    }));
    const cachedBundle = Object.freeze({
      ...services,
      capabilities: Object.freeze({
        scopedPersistence: true,
        policyMutations: false,
        challengePolicyMutations: true
      })
    });
    this.sandboxCache.set(scope.financialContextId, cachedBundle);
    return cachedBundle;
  }

  async resolveForUser({
    userId,
    phone = null,
    actor = null,
    appReview = false,
    expectedPersistenceContext = null
  } = {}) {
    const normalizedUserId = normalizeUserId(userId || actor?.uid || actor?.id);
    if (!normalizedUserId) {
      throw new KycRuntimeScopeError(
        'KYC_RUNTIME_USER_REQUIRED',
        'Usuario obrigatorio para resolver o runtime KYC'
      );
    }

    const resolvedScope = await this.resolveUserScope({
      userId: normalizedUserId,
      phone,
      actor,
      appReview
    });
    const scope = resolveKycPersistenceScope(resolvedScope, {
      allowLegacyOperational: false
    });
    this.assertExpectedScope(scope, expectedPersistenceContext);

    const services = scope.namespace === 'sandbox'
      ? this.buildSandboxServices(scope)
      : Object.freeze({
          ...withServiceAliases(this.assertServiceSurface(this.operationalServices)),
          capabilities: Object.freeze({
            scopedPersistence: false,
            policyMutations: true,
            challengePolicyMutations: true
          })
        });

    return Object.freeze({
      userId: normalizedUserId,
      scope,
      persistenceContext: scope.financialContext,
      namespace: scope.namespace,
      ...services
    });
  }

  clearSandboxCache() {
    this.sandboxCache.clear();
  }
}

const singleton = new KycRuntimeScopeService();

async function resolveKycRuntimeForUser(input = {}) {
  return singleton.resolveForUser(input);
}

module.exports = singleton;
module.exports.KycRuntimeScopeService = KycRuntimeScopeService;
module.exports.KycRuntimeScopeError = KycRuntimeScopeError;
module.exports.resolveKycRuntimeForUser = resolveKycRuntimeForUser;
module.exports.createSandboxPolicyGuard = createSandboxPolicyGuard;
module.exports.SandboxKycPolicyAdapter = SandboxKycPolicyAdapter;
module.exports.wrapSandboxTrustFailClosed = wrapSandboxTrustFailClosed;
module.exports.REQUIRED_WORKFLOW_METHODS = REQUIRED_WORKFLOW_METHODS;
module.exports.REQUIRED_TRUST_METHODS = REQUIRED_TRUST_METHODS;
module.exports.REQUIRED_POLICY_METHODS = REQUIRED_POLICY_METHODS;

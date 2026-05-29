const admin = require('firebase-admin');
const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const IntegratedKYCService = require('./IntegratedKYCService');
const KYCNotificationService = require('./KYCNotificationService');
const supportTicketService = require('./support-ticket-service');
const { resolveActiveTripForDriver } = require('../utils/active-trip-index');
const { logStructured, logError } = require('../utils/logger');

const IDENTITY_REVERIFY_PUBLIC_REASON = 'Por segurança, precisamos validar sua identidade.';
const IDENTITY_REVERIFY_REASON_CODE = 'passenger_photo_mismatch_report';
const LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE = 'aws_liveness_attempts_exhausted';
const IDENTITY_REVERIFY_REQUIREMENT = 'IDENTITY_REVERIFICATION';

const DEFAULTS = {
  challengeTtlSeconds: 20 * 60,
  verificationMaxAgeHours: 24,
  lowRiskVerificationMaxAgeHours: 168,
  mediumRiskVerificationMaxAgeHours: 72,
  burstWindowMinutes: 30,
  burstCountThreshold: 2,
  dailyWithdrawalLimitCents: 300000,
  mediumWithdrawalCents: 50000,
  highWithdrawalCents: 120000,
  verifyScoreThreshold: 40,
  livenessScoreThreshold: 70,
  photoMismatchWindowDays: 30,
  enforceFirstAccessLiveness: true
};

const KYC_POLICY_FIELDS = [
  'kycStatus',
  'kyc_status',
  'kycBlocked',
  'kycReverifyRequired',
  'kycReverifyReason',
  'kycReverifySource',
  'kycPhotoMismatchReportedAt',
  'kycReverifyRequestedAt',
  'kycFirstAccessVerifiedAt',
  'kycLastVerificationAt'
];

const BLOCKING_KYC_STATUSES = new Set([
  'blocked',
  'rejected',
  'failed',
  'denied',
  'pending',
  'pending_review',
  'pending_reverify',
  'in_review',
  'review'
]);

function getIntEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getFloatEnv(name, fallback) {
  const parsed = Number.parseFloat(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getBoolEnv(name, fallback) {
  if (process.env[name] == null) return fallback;
  const normalized = String(process.env[name]).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') {
    const parsedDate = value.toDate();
    return parsedDate instanceof Date ? parsedDate.getTime() : 0;
  }
  return 0;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function pickKycPolicyFields(source = {}) {
  return KYC_POLICY_FIELDS.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      acc[field] = source[field];
    }
    return acc;
  }, {});
}

function normalizeKycStatus(value) {
  return normalizeText(value).replace(/\s+/g, '_');
}

async function readRealtimeKycPolicyFields(driverId) {
  const entries = await Promise.all(
    KYC_POLICY_FIELDS.map(async (field) => {
      const value = await firebaseConfig
        .getFromRealtimeDB(`users/${driverId}/${field}`)
        .catch(() => undefined);
      return [field, value];
    })
  );

  return entries.reduce((acc, [field, value]) => {
    if (value !== undefined && value !== null) {
      acc[field] = value;
    }
    return acc;
  }, {});
}

class KYCPolicyService {
  constructor() {
    this.redis = redisPool.getConnection();
    this.integratedKycService = new IntegratedKYCService();
    this.notificationService = new KYCNotificationService();
    this.challengePrefix = 'kyc:stepup:challenge:';
    this.activeChallengePrefix = 'kyc:stepup:active:';
  }

  getConfig() {
    const verificationMaxAgeHours = getIntEnv(
      'KYC_WITHDRAW_VERIFICATION_MAX_AGE_HOURS',
      DEFAULTS.verificationMaxAgeHours
    );

    return {
      challengeTtlSeconds: getIntEnv(
        'KYC_WITHDRAW_CHALLENGE_TTL_SECONDS',
        DEFAULTS.challengeTtlSeconds
      ),
      verificationMaxAgeHours,
      lowRiskVerificationMaxAgeHours: getIntEnv(
        'KYC_WITHDRAW_LOW_RISK_VERIFICATION_MAX_AGE_HOURS',
        DEFAULTS.lowRiskVerificationMaxAgeHours
      ),
      mediumRiskVerificationMaxAgeHours: getIntEnv(
        'KYC_WITHDRAW_MEDIUM_RISK_VERIFICATION_MAX_AGE_HOURS',
        DEFAULTS.mediumRiskVerificationMaxAgeHours
      ),
      highRiskVerificationMaxAgeHours: getIntEnv(
        'KYC_WITHDRAW_HIGH_RISK_VERIFICATION_MAX_AGE_HOURS',
        verificationMaxAgeHours
      ),
      burstWindowMinutes: getIntEnv(
        'KYC_WITHDRAW_BURST_WINDOW_MINUTES',
        DEFAULTS.burstWindowMinutes
      ),
      burstCountThreshold: getIntEnv(
        'KYC_WITHDRAW_BURST_COUNT_THRESHOLD',
        DEFAULTS.burstCountThreshold
      ),
      dailyWithdrawalLimitCents: getIntEnv(
        'KYC_WITHDRAW_DAILY_LIMIT_CENTS',
        DEFAULTS.dailyWithdrawalLimitCents
      ),
      mediumWithdrawalCents: getIntEnv(
        'KYC_WITHDRAW_MEDIUM_AMOUNT_CENTS',
        DEFAULTS.mediumWithdrawalCents
      ),
      highWithdrawalCents: getIntEnv(
        'KYC_WITHDRAW_HIGH_AMOUNT_CENTS',
        DEFAULTS.highWithdrawalCents
      ),
      verifyScoreThreshold: getFloatEnv(
        'KYC_WITHDRAW_VERIFY_SCORE_THRESHOLD',
        DEFAULTS.verifyScoreThreshold
      ),
      livenessScoreThreshold: getFloatEnv(
        'KYC_WITHDRAW_LIVENESS_SCORE_THRESHOLD',
        DEFAULTS.livenessScoreThreshold
      ),
      photoMismatchWindowDays: getIntEnv(
        'KYC_PHOTO_MISMATCH_WINDOW_DAYS',
        DEFAULTS.photoMismatchWindowDays
      ),
      enforceFirstAccessLiveness: getBoolEnv(
        'KYC_FIRST_ACCESS_ENFORCE_LIVENESS',
        DEFAULTS.enforceFirstAccessLiveness
      )
    };
  }

  createChallengeId() {
    return `kyc_ch_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  async ensureKycInitialized() {
    if (!this.integratedKycService.initialized) {
      await this.integratedKycService.initialize();
    }
  }

  async getDriverKycState(driverId) {
    const firestore = firebaseConfig.getFirestore();
    let usersDoc = {};
    let driversDoc = {};
    let realtimeUser = {};

    if (firestore) {
      const [usersSnap, driversSnap] = await Promise.all([
        firestore.collection('users').doc(driverId).get(),
        firestore.collection('drivers').doc(driverId).get()
      ]);

      usersDoc = usersSnap.exists ? usersSnap.data() : {};
      driversDoc = driversSnap.exists ? driversSnap.data() : {};
    }

    realtimeUser = await readRealtimeKycPolicyFields(driverId);

    return {
      usersDoc: pickKycPolicyFields(usersDoc),
      driversDoc: pickKycPolicyFields(driversDoc),
      realtimeUser: pickKycPolicyFields(realtimeUser)
    };
  }

  resolveKycApprovalGate(kycState = {}) {
    const statusCandidates = [
      kycState.usersDoc?.kycStatus,
      kycState.usersDoc?.kyc_status,
      kycState.driversDoc?.kycStatus,
      kycState.driversDoc?.kyc_status,
      kycState.realtimeUser?.kycStatus,
      kycState.realtimeUser?.kyc_status
    ].map(normalizeKycStatus).filter(Boolean);

    const blocked = Boolean(
      kycState.usersDoc?.kycBlocked
      || kycState.driversDoc?.kycBlocked
      || kycState.realtimeUser?.kycBlocked
    );

    const approved = statusCandidates.some((status) => status === 'approved');
    const blockingStatus = statusCandidates.find((status) => BLOCKING_KYC_STATUSES.has(status));

    if (blocked) {
      return {
        allowed: false,
        code: 'KYC_BLOCKED',
        reason: 'Motorista bloqueado para KYC ou revalidacao obrigatoria.',
        status: blockingStatus || statusCandidates[0] || 'blocked'
      };
    }

    if (!approved) {
      return {
        allowed: false,
        code: blockingStatus === 'rejected' ? 'KYC_REJECTED' : 'KYC_NOT_APPROVED',
        reason: blockingStatus === 'rejected'
          ? 'KYC do motorista reprovado.'
          : 'KYC aprovado e obrigatorio para esta acao.',
        status: blockingStatus || statusCandidates[0] || 'missing'
      };
    }

    return {
      allowed: true,
      code: 'KYC_APPROVED',
      reason: 'KYC aprovado.',
      status: 'approved'
    };
  }

  async requireApprovedKyc(driverId) {
    const kycState = await this.getDriverKycState(driverId);
    const approvalGate = this.resolveKycApprovalGate(kycState);
    const reverifyRequired = Boolean(
      kycState.usersDoc?.kycReverifyRequired
      || kycState.driversDoc?.kycReverifyRequired
      || kycState.realtimeUser?.kycReverifyRequired
    );

    if (approvalGate.allowed && reverifyRequired) {
      return {
        allowed: false,
        code: 'KYC_REVERIFY_REQUIRED',
        reason: 'Revalidacao facial obrigatoria antes desta acao.',
        status: 'pending_reverify'
      };
    }

    return approvalGate;
  }

  getAmountSignals(amountCents, config) {
    const signals = [];

    if (amountCents >= config.mediumWithdrawalCents) {
      signals.push({
        code: 'WITHDRAW_AMOUNT_MEDIUM',
        weight: 15,
        message: 'Valor de saque acima do patamar medio',
        details: {
          amountCents,
          threshold: config.mediumWithdrawalCents
        }
      });
    }

    if (amountCents >= config.highWithdrawalCents) {
      signals.push({
        code: 'WITHDRAW_AMOUNT_HIGH',
        weight: 22,
        message: 'Valor de saque em faixa alta de risco',
        details: {
          amountCents,
          threshold: config.highWithdrawalCents
        }
      });
    }

    return signals;
  }

  getWithdrawalVerificationWindow({ preKycRiskScore = 0, signals = [], reverifyRequired = false } = {}, config = this.getConfig()) {
    const codes = new Set((signals || []).map((signal) => signal.code));
    const highRisk =
      reverifyRequired
      || codes.has('PHOTO_MISMATCH_REPORTED')
      || codes.has('WITHDRAW_AMOUNT_HIGH')
      || codes.has('WITHDRAW_DAILY_LIMIT')
      || codes.has('WITHDRAW_BURST_PATTERN')
      || preKycRiskScore >= config.verifyScoreThreshold;

    if (highRisk) {
      return {
        tier: 'high',
        maxAgeHours: config.highRiskVerificationMaxAgeHours
      };
    }

    if (preKycRiskScore > 0) {
      return {
        tier: 'medium',
        maxAgeHours: config.mediumRiskVerificationMaxAgeHours
      };
    }

    return {
      tier: 'low',
      maxAgeHours: config.lowRiskVerificationMaxAgeHours
    };
  }

  async collectWithdrawalSignals(driverId, amountCents, config) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return {
        withdrawals24hCount: 0,
        withdrawals24hCents: 0,
        burstCount: 0,
        signals: []
      };
    }

    const nowMs = Date.now();
    const min24hMs = nowMs - (24 * 60 * 60 * 1000);
    const minBurstMs = nowMs - (config.burstWindowMinutes * 60 * 1000);

    const txSnapshot = await firestore
      .collection('driver_balances')
      .doc(driverId)
      .collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(80)
      .get()
      .catch(() => null);

    let withdrawals24hCount = 0;
    let withdrawals24hCents = 0;
    let burstCount = 0;

    if (txSnapshot) {
      txSnapshot.forEach((doc) => {
        const tx = doc.data() || {};
        if (tx.type !== 'withdrawal') return;

        const txTimestampMs = toMillis(tx.createdAt);
        const txCents = Math.abs(Number.parseInt(tx.amountInCents, 10) || 0);

        if (!txTimestampMs || !txCents) return;
        if (txTimestampMs >= min24hMs) {
          withdrawals24hCount += 1;
          withdrawals24hCents += txCents;
        }
        if (txTimestampMs >= minBurstMs) {
          burstCount += 1;
        }
      });
    }

    const projected24hCents = withdrawals24hCents + amountCents;
    const projectedBurstCount = burstCount + 1;
    const signals = [];

    if (projected24hCents >= config.dailyWithdrawalLimitCents) {
      signals.push({
        code: 'WITHDRAW_DAILY_LIMIT',
        weight: 28,
        message: 'Volume de saque nas ultimas 24h acima do limite de risco',
        details: {
          projected24hCents,
          limitCents: config.dailyWithdrawalLimitCents
        }
      });
    }

    if (projectedBurstCount > config.burstCountThreshold) {
      signals.push({
        code: 'WITHDRAW_BURST_PATTERN',
        weight: 22,
        message: 'Padrao de multiplos saques em janela curta',
        details: {
          projectedBurstCount,
          threshold: config.burstCountThreshold,
          windowMinutes: config.burstWindowMinutes
        }
      });
    }

    return {
      withdrawals24hCount,
      withdrawals24hCents,
      burstCount,
      signals
    };
  }

  hasRecentPhotoMismatch(kycState, config) {
    const candidates = [
      kycState.usersDoc?.kycPhotoMismatchReportedAt,
      kycState.usersDoc?.kycReverifyRequestedAt,
      kycState.driversDoc?.kycPhotoMismatchReportedAt,
      kycState.driversDoc?.kycReverifyRequestedAt,
      kycState.realtimeUser?.kycPhotoMismatchReportedAt,
      kycState.realtimeUser?.kycReverifyRequestedAt
    ];

    const newestMs = candidates.reduce((maxValue, item) => {
      const itemMs = toMillis(item);
      return itemMs > maxValue ? itemMs : maxValue;
    }, 0);

    if (!newestMs) {
      return {
        active: false,
        ageHours: null
      };
    }

    const ageMs = Date.now() - newestMs;
    const validWindowMs = config.photoMismatchWindowDays * 24 * 60 * 60 * 1000;

    return {
      active: ageMs <= validWindowMs,
      ageHours: Math.round(ageMs / 1000 / 60 / 60)
    };
  }

  async createStepUpChallenge({ driverId, requirement, score, signals, source }) {
    const config = this.getConfig();
    const challengeId = this.createChallengeId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (config.challengeTtlSeconds * 1000));

    const challengePayload = {
      challengeId,
      driverId,
      requirement,
      score,
      signals,
      source,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    try {
      const redisMulti = this.redis.multi();
      redisMulti.set(
        `${this.challengePrefix}${challengeId}`,
        JSON.stringify(challengePayload),
        'EX',
        config.challengeTtlSeconds
      );
      redisMulti.set(
        `${this.activeChallengePrefix}${driverId}`,
        challengeId,
        'EX',
        config.challengeTtlSeconds
      );
      await redisMulti.exec();
    } catch (error) {
      logError(error, 'Falha ao salvar challenge KYC no Redis', {
        service: 'kyc-policy-service',
        driverId,
        challengeId
      });
    }

    const firestore = firebaseConfig.getFirestore();
    if (firestore) {
      await firestore
        .collection('kyc_stepup_challenges')
        .doc(challengeId)
        .set(
          {
            ...challengePayload,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromDate(expiresAt)
          },
          { merge: true }
        )
        .catch((error) => {
          logError(error, 'Falha ao salvar challenge KYC no Firestore', {
            service: 'kyc-policy-service',
            driverId,
            challengeId
          });
        });
    }

    return challengePayload;
  }

  async getStepUpChallenge(challengeId, driverId = null) {
    let effectiveChallengeId = challengeId;
    if (!effectiveChallengeId && driverId) {
      effectiveChallengeId = await this.redis
        .get(`${this.activeChallengePrefix}${driverId}`)
        .catch(() => null);
    }

    if (!effectiveChallengeId) return null;

    const redisValue = await this.redis
      .get(`${this.challengePrefix}${effectiveChallengeId}`)
      .catch(() => null);

    if (redisValue) {
      try {
        const parsed = JSON.parse(redisValue);
        if (driverId && parsed.driverId !== driverId) return null;
        return parsed;
      } catch (_error) {
        return null;
      }
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) return null;

    const challengeSnap = await firestore
      .collection('kyc_stepup_challenges')
      .doc(effectiveChallengeId)
      .get()
      .catch(() => null);

    if (!challengeSnap || !challengeSnap.exists) return null;
    const data = challengeSnap.data() || {};
    if (driverId && data.driverId !== driverId) return null;

    return {
      challengeId: challengeSnap.id,
      driverId: data.driverId,
      requirement: data.requirement,
      score: Number(data.score || 0),
      signals: Array.isArray(data.signals) ? data.signals : [],
      source: data.source || null,
      status: data.status || 'pending',
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || data.expiresAt || null
    };
  }

  isLivenessSatisfied(payload = {}) {
    // Accept only provider-backed liveness evidence.
    // Client-declared flags such as `livenessPassed` or `isLive` are not trusted alone.
    if (payload.azure?.liveness?.passed === true) return true;
    if (payload.azureLivenessPassed === true) return true;
    if (payload.aws?.passed === true) return true;
    if (payload.awsLivenessPassed === true) return true;
    return false;
  }

  async resolveStepUpChallenge({ challengeId, driverId, requirement, verificationPayload = {} }) {
    if (!challengeId) {
      return {
        success: false,
        error: 'challengeId e obrigatorio',
        code: 'KYC_CHALLENGE_REQUIRED'
      };
    }

    const challenge = await this.getStepUpChallenge(challengeId, driverId);
    if (!challenge) {
      return {
        success: false,
        error: 'Challenge KYC nao encontrado ou expirado',
        code: 'KYC_CHALLENGE_NOT_FOUND'
      };
    }

    const effectiveRequirement = requirement || challenge.requirement || 'VERIFY_REQUIRED';
    if (effectiveRequirement === 'LIVENESS_REQUIRED' && !this.isLivenessSatisfied(verificationPayload)) {
      return {
        success: false,
        error: 'Liveness obrigatorio para concluir este desafio',
        code: 'KYC_LIVENESS_REQUIRED'
      };
    }

    const nowIso = new Date().toISOString();
    const redisMulti = this.redis.multi();
    redisMulti.del(`${this.challengePrefix}${challenge.challengeId}`);
    redisMulti.del(`${this.activeChallengePrefix}${challenge.driverId}`);
    await redisMulti.exec().catch(() => null);

    const firestore = firebaseConfig.getFirestore();
    if (firestore) {
      await firestore
        .collection('kyc_stepup_challenges')
        .doc(challenge.challengeId)
        .set(
          {
            status: 'resolved',
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            resolution: {
              requirement: effectiveRequirement,
              provider: verificationPayload.provider || verificationPayload.mode || 'unknown',
              livenessPassed: this.isLivenessSatisfied(verificationPayload),
              similarityScore: Number(verificationPayload.similarityScore || 0),
              confidence: Number(verificationPayload.confidence || 0)
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        )
        .catch(() => null);
    }

    await this.recordVerificationSuccess(challenge.driverId, {
      source: `challenge:${effectiveRequirement}`,
      verifiedAt: nowIso,
      clearReverify: true
    });

    return {
      success: true,
      challengeId: challenge.challengeId,
      resolvedAt: nowIso,
      requirement: effectiveRequirement
    };
  }

  async evaluateWithdrawalStepUp({ driverId, amountCents }) {
    const config = this.getConfig();
    const signals = [];

    signals.push(...this.getAmountSignals(amountCents, config));

    const withdrawalSignals = await this.collectWithdrawalSignals(driverId, amountCents, config);
    signals.push(...withdrawalSignals.signals);

    const kycState = await this.getDriverKycState(driverId);
    const approvalGate = this.resolveKycApprovalGate(kycState);
    if (!approvalGate.allowed) {
      signals.push({
        code: approvalGate.code,
        weight: 100,
        message: approvalGate.reason,
        details: {
          status: approvalGate.status
        }
      });

      return {
        driverId,
        amountCents,
        requirement: 'KYC_APPROVAL_REQUIRED',
        riskScore: 100,
        preKycRiskScore: Math.min(
          100,
          signals.reduce((sum, current) => sum + Number(current.weight || 0), 0)
        ),
        verificationWindowTier: 'blocked',
        verificationMaxAgeHours: 0,
        signals,
        challenge: null,
        context: {
          withdrawals24hCount: withdrawalSignals.withdrawals24hCount,
          withdrawals24hCents: withdrawalSignals.withdrawals24hCents,
          burstCount: withdrawalSignals.burstCount,
          hasValidVerification: false,
          verificationWindowTier: 'blocked',
          verificationMaxAgeHours: 0,
          approvalGate
        }
      };
    }

    const reverifyRequired = Boolean(
      kycState.usersDoc?.kycReverifyRequired
      || kycState.driversDoc?.kycReverifyRequired
      || kycState.realtimeUser?.kycReverifyRequired
    );

    const mismatch = this.hasRecentPhotoMismatch(kycState, config);
    if (mismatch.active) {
      signals.push({
        code: 'PHOTO_MISMATCH_REPORTED',
        weight: 40,
        message: 'Existe denuncia recente de motorista divergente da foto',
        details: {
          ageHours: mismatch.ageHours
        }
      });
    }

    const preKycRiskScore = Math.min(
      100,
      signals.reduce((sum, current) => sum + Number(current.weight || 0), 0)
    );
    const verificationWindow = this.getWithdrawalVerificationWindow({
      preKycRiskScore,
      signals,
      reverifyRequired
    }, config);

    await this.ensureKycInitialized().catch(() => null);
    const verification = await this.integratedKycService.hasValidVerification(
      driverId,
      verificationWindow.maxAgeHours
    );

    if (!verification?.hasValid) {
      signals.push({
        code: 'KYC_STALE_OR_MISSING',
        weight: 26,
        message: verification?.reason || 'KYC valido nao encontrado na janela esperada',
        details: {
          maxAgeHours: verificationWindow.maxAgeHours,
          windowTier: verificationWindow.tier
        }
      });
    }

    if (reverifyRequired) {
      signals.push({
        code: 'REVERIFY_REQUIRED',
        weight: 100,
        message: 'Motorista marcado para revalidacao obrigatoria',
        details: {
          reason:
            kycState.usersDoc?.kycReverifyReason
            || kycState.driversDoc?.kycReverifyReason
            || kycState.realtimeUser?.kycReverifyReason
            || 'pending_reverify'
        }
      });
    }

    const riskScore = Math.min(100, signals.reduce((sum, current) => sum + Number(current.weight || 0), 0));
    let requirement = 'NONE';

    if (reverifyRequired || riskScore >= config.livenessScoreThreshold) {
      requirement = 'LIVENESS_REQUIRED';
    } else if (riskScore >= config.verifyScoreThreshold) {
      requirement = 'VERIFY_REQUIRED';
    }

    let challenge = null;
    if (requirement !== 'NONE') {
      challenge = await this.createStepUpChallenge({
        driverId,
        requirement,
        score: riskScore,
        signals,
        source: 'withdrawal'
      });
    }

    return {
      driverId,
      amountCents,
      requirement,
      riskScore,
      preKycRiskScore,
      verificationWindowTier: verificationWindow.tier,
      verificationMaxAgeHours: verificationWindow.maxAgeHours,
      signals,
      challenge,
      context: {
        withdrawals24hCount: withdrawalSignals.withdrawals24hCount,
        withdrawals24hCents: withdrawalSignals.withdrawals24hCents,
        burstCount: withdrawalSignals.burstCount,
        hasValidVerification: Boolean(verification?.hasValid),
        verificationWindowTier: verificationWindow.tier,
        verificationMaxAgeHours: verificationWindow.maxAgeHours
      }
    };
  }

  async requiresFirstAccessLiveness(driverId) {
    const config = this.getConfig();
    if (!config.enforceFirstAccessLiveness) {
      return {
        required: false,
        reason: 'firstAccessLivenessDisabled'
      };
    }

    const kycState = await this.getDriverKycState(driverId);
    const firstAccessVerifiedAt =
      kycState.usersDoc?.kycFirstAccessVerifiedAt
      || kycState.driversDoc?.kycFirstAccessVerifiedAt
      || kycState.realtimeUser?.kycFirstAccessVerifiedAt
      || null;

    if (firstAccessVerifiedAt) {
      return {
        required: false,
        reason: 'alreadyVerifiedFirstAccess'
      };
    }

    return {
      required: true,
      reason: 'firstAccess'
    };
  }

  async recordVerificationSuccess(driverId, options = {}) {
    const verifiedAtIso = options.verifiedAt || new Date().toISOString();
    const firestore = firebaseConfig.getFirestore();

    const realtimePayload = {
      kycLastVerificationAt: verifiedAtIso,
      kycUpdatedAt: verifiedAtIso
    };

    const firestorePayload = {
      kycLastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
      kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (options.markFirstAccess) {
      realtimePayload.kycFirstAccessVerifiedAt = verifiedAtIso;
      firestorePayload.kycFirstAccessVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    if (options.clearReverify) {
      realtimePayload.kycReverifyRequired = false;
      realtimePayload.kycReverifyReason = null;
      realtimePayload.kycReverifySource = null;
      realtimePayload.kycPhotoMismatchReportedAt = null;
      realtimePayload.kycReverifyRequestedAt = null;
      realtimePayload.kycStatus = 'approved';
      realtimePayload.kycBlocked = false;

      firestorePayload.kycReverifyRequired = false;
      firestorePayload.kycReverifyReason = admin.firestore.FieldValue.delete();
      firestorePayload.kycReverifySource = admin.firestore.FieldValue.delete();
      firestorePayload.kycPhotoMismatchReportedAt = admin.firestore.FieldValue.delete();
      firestorePayload.kycReverifyRequestedAt = admin.firestore.FieldValue.delete();
      firestorePayload.kycStatus = 'approved';
      firestorePayload.kycBlocked = false;
    }

    await firebaseConfig.updateRealtimeDB(`users/${driverId}`, realtimePayload).catch((error) => {
      logError(error, 'Falha ao atualizar status KYC no Realtime DB', {
        service: 'kyc-policy-service',
        driverId
      });
    });

    if (firestore) {
      await Promise.all([
        firestore.collection('users').doc(driverId).set(firestorePayload, { merge: true }),
        firestore.collection('drivers').doc(driverId).set(firestorePayload, { merge: true })
      ]).catch((error) => {
        logError(error, 'Falha ao atualizar status KYC no Firestore', {
          service: 'kyc-policy-service',
          driverId
        });
      });
    }

    await this.redis.hset(`driver:${driverId}`, {
      kyc_reverify_required: String(false),
      kyc_status: 'approved',
      kyc_blocked: String(false),
      kyc_last_verification: verifiedAtIso
    }).catch(() => null);

    return {
      success: true,
      driverId,
      verifiedAt: verifiedAtIso
    };
  }

  getPhotoMismatchKeywords() {
    const envKeywords = String(process.env.KYC_PHOTO_MISMATCH_KEYWORDS || '').trim();
    if (envKeywords.length > 0) {
      return envKeywords
        .split(',')
        .map((item) => normalizeText(item))
        .filter(Boolean);
    }

    return [
      'motorista diferente',
      'nao era o motorista',
      'nao era a mesma pessoa',
      'outro motorista',
      'condutor diferente',
      'pessoa diferente',
      'nao corresponde a foto',
      'foto diferente',
      'foto nao bate',
      'diferente do cadastro',
      'cadastro diferente',
      'driver different',
      'wrong driver',
      'different driver'
    ];
  }

  isPhotoMismatchReport(payload = {}) {
    if (payload.photoMismatch === true || payload.driverPhotoMismatch === true) {
      return true;
    }

    const options = Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [];
    const allText = [
      ...options,
      payload.subject,
      payload.description,
      payload.comment,
      payload.suggestion,
      payload.reason,
      payload.feedback
    ]
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join(' ');

    return this.getPhotoMismatchKeywords().some((keyword) => allText.includes(keyword));
  }

  buildIdentityReverificationChallengeId(driverId) {
    const seed = `${driverId}:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;
    return `idrev_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 18)}`;
  }

  async persistIdentityReverificationEvent({
    driverId,
    tripId = null,
    reporterId = null,
    reporterType = 'passenger',
    supportTicketId = null,
    payload = {},
    status,
    challengeId,
    notificationSentAt = null,
    nowIso
  }) {
    const firestore = firebaseConfig.getFirestore();
    const reason = payload.publicReason || IDENTITY_REVERIFY_PUBLIC_REASON;
    const reasonCode = payload.reasonCode || IDENTITY_REVERIFY_REASON_CODE;
    const eventType = reasonCode === LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE
      ? 'AWS_LIVENESS_ATTEMPTS_EXHAUSTED'
      : (status === 'deferred_until_trip_end'
        ? 'PHOTO_MISMATCH_REVERIFY_DEFERRED'
        : 'PHOTO_MISMATCH_REVERIFY_REQUESTED');
    const publicPayload = {
      selectedOptions: Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [],
      comment: String(payload.comment || payload.description || ''),
      suggestion: String(payload.suggestion || ''),
      supportTicketId,
      subject: String(payload.subject || '')
    };

    if (firestore) {
      await firestore.collection('kyc_events').add({
        driverId,
        tripId,
        type: eventType,
        reasonCode,
        requirement: IDENTITY_REVERIFY_REQUIREMENT,
        source: reporterType,
        reporterId,
        supportTicketId,
        challengeId,
        payload: publicPayload,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch((error) => {
        logError(error, 'Falha ao salvar evento KYC de revalidacao por suporte', {
          service: 'kyc-policy-service',
          driverId,
          tripId,
          supportTicketId
        });
      });
    }

    const identityReverification = {
      challengeId,
      status,
      requirement: IDENTITY_REVERIFY_REQUIREMENT,
      reasonCode,
      publicReason: reason,
      source: reporterType === 'system' ? 'system_liveness_guard' : 'support_report',
      supportTicketId,
      tripId,
      reporterId,
      reporterType,
      requestedAt: nowIso,
      notificationSentAt,
      validationStartedAt: null,
      validationCompletedAt: null,
      metrics: {
        notificationToValidationStartedSeconds: null,
        notificationToValidationCompletedSeconds: null,
        validationDurationSeconds: null,
        validationLocationDistanceMeters: null
      }
    };

    await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      identityReverification,
      kycReverifyPendingAfterTrip: status === 'deferred_until_trip_end',
      kycReverifyReason: reason,
      kycReverifySource: reasonCode,
      kycPhotoMismatchReportedAt: nowIso,
      kycUpdatedAt: nowIso
    }).catch((error) => {
      logError(error, 'Falha ao persistir estado de revalidacao no Realtime DB', {
        service: 'kyc-policy-service',
        driverId,
        supportTicketId
      });
    });

    return identityReverification;
  }

  async applyIdentityReverificationGate({
    driverId,
    tripId = null,
    reporterId = null,
    reporterType = 'passenger',
    payload = {},
    supportTicketId = null,
    challengeId = null,
    notify = true
  }) {
    const nowIso = new Date().toISOString();
    const effectiveChallengeId = challengeId || this.buildIdentityReverificationChallengeId(driverId);
    const reason = payload.publicReason || IDENTITY_REVERIFY_PUBLIC_REASON;
    const reasonCode = payload.reasonCode || IDENTITY_REVERIFY_REASON_CODE;
    const firestore = firebaseConfig.getFirestore();

    await this.persistIdentityReverificationEvent({
      driverId,
      tripId,
      reporterId,
      reporterType,
      supportTicketId,
      payload,
      status: 'requested',
      challengeId: effectiveChallengeId,
      notificationSentAt: notify ? nowIso : null,
      nowIso
    });

    if (firestore) {
      const firestorePayload = {
        kycReverifyRequired: true,
        kycReverifyReason: reason,
        kycReverifySource: reasonCode,
        kycPhotoMismatchReportedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycReverifyRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycStatus: 'pending_reverify',
        kycBlocked: false,
        kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        identityReverification: {
          challengeId: effectiveChallengeId,
          status: 'requested',
          requirement: IDENTITY_REVERIFY_REQUIREMENT,
          reasonCode,
          supportTicketId,
          tripId
        }
      };
      await Promise.all([
        firestore.collection('users').doc(driverId).set(firestorePayload, { merge: true }),
        firestore.collection('drivers').doc(driverId).set(firestorePayload, { merge: true })
      ]).catch((error) => {
        logError(error, 'Falha ao atualizar status KYC no Firestore apos denuncia', {
          service: 'kyc-policy-service',
          driverId
        });
      });
    }

    await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      kycReverifyRequired: true,
      kycReverifyReason: reason,
      kycReverifySource: reasonCode,
      kycReverifyRequestedAt: nowIso,
      kycStatus: 'pending_reverify',
      kycBlocked: false,
      kycReverifyPendingAfterTrip: false,
      kycUpdatedAt: nowIso
    }).catch((error) => {
      logError(error, 'Falha ao aplicar gate de revalidacao no Realtime DB', {
        service: 'kyc-policy-service',
        driverId
      });
    });

    await this.integratedKycService.invalidateVerificationCache(driverId).catch(() => null);

    await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
      kyc_reverify_required: String(true),
      kyc_reverify_source: reasonCode,
      kyc_status: 'pending_reverify',
      kyc_blocked: String(false),
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED',
      identity_reverification_challenge_id: effectiveChallengeId,
      identity_reverification_requested_at: nowIso
    })).catch(() => null);

    await Promise.resolve().then(() => this.redis.zrem(
      process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
      driverId
    )).catch(() => null);

    if (notify) {
      await this.notificationService.sendCustomNotification(
        driverId,
        'Validação de segurança',
        reason,
        {
          type: 'kyc_reverification_required',
          screen: 'RobotaxiPrototype',
          userType: 'driver',
          requirement: IDENTITY_REVERIFY_REQUIREMENT,
          challengeId: effectiveChallengeId,
          reason,
          supportTicketId,
          tripId,
          notificationSentAt: nowIso
        }
      ).catch((error) => {
        logError(error, 'Falha ao notificar motorista sobre revalidacao de identidade', {
          service: 'kyc-policy-service',
          driverId,
          supportTicketId
        });
      });
    }

    logStructured('warn', 'Motorista marcado para revalidacao facial sutil por suporte', {
      service: 'kyc-policy-service',
      driverId,
      tripId,
      reporterId,
      reporterType,
      supportTicketId,
      challengeId: effectiveChallengeId
    });

    return {
      success: true,
      driverId,
      reason,
      reasonCode,
      requirement: IDENTITY_REVERIFY_REQUIREMENT,
      challengeId: effectiveChallengeId,
      supportTicketId,
      reverifyRequired: true,
      softBlocked: true
    };
  }

  async markDriverForLivenessAttemptsExhausted({
    driverId,
    challengeId = null,
    attemptState = {},
    metadata = {}
  }) {
    if (!driverId) {
      return {
        success: false,
        error: 'driverId e obrigatorio'
      };
    }

    let supportTicketId = null;
    try {
      const { ticket } = await supportTicketService.createTicket({
        requesterId: driverId,
        userType: 'driver',
        subject: 'Validação facial não concluída',
        description: 'O motorista excedeu o limite de tentativas de liveness e precisa de apoio para concluir a validação de identidade.',
        category: 'kyc',
        priority: 'N2',
        metadata: {
          automated: true,
          reasonCode: LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE,
          challengeId,
          attemptState,
          ...metadata
        }
      });
      supportTicketId = ticket?.id || null;
    } catch (error) {
      logError(error, 'Falha ao criar ticket de suporte para limite de liveness', {
        service: 'kyc-policy-service',
        driverId,
        challengeId
      });
    }

    return this.applyIdentityReverificationGate({
      driverId,
      reporterType: 'system',
      supportTicketId,
      challengeId,
      payload: {
        reasonCode: LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE,
        publicReason: IDENTITY_REVERIFY_PUBLIC_REASON,
        selectedOptions: [LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE],
        attemptState,
        ...metadata
      },
      notify: true
    });
  }

  async markDriverForPhotoMismatch({
    driverId,
    tripId = null,
    reporterId = null,
    reporterType = 'passenger',
    payload = {},
    supportTicketId = null
  }) {
    if (!driverId) {
      return {
        success: false,
        error: 'driverId e obrigatorio'
      };
    }

    const nowIso = new Date().toISOString();
    const challengeId = this.buildIdentityReverificationChallengeId(driverId);
    const activeTrip = await resolveActiveTripForDriver(this.redis, driverId).catch(() => ({
      tripId: null,
      customerId: null
    }));

    if (activeTrip?.tripId) {
      await this.persistIdentityReverificationEvent({
        driverId,
        tripId,
        reporterId,
        reporterType,
        supportTicketId,
        payload,
        status: 'deferred_until_trip_end',
        challengeId,
        nowIso
      });
      await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
        identity_reverification_pending_after_trip: String(true),
        identity_reverification_challenge_id: challengeId,
        identity_reverification_requested_at: nowIso
      })).catch(() => null);

      logStructured('warn', 'Revalidacao facial adiada ate fim da corrida ativa', {
        service: 'kyc-policy-service',
        driverId,
        activeTripId: activeTrip.tripId,
        supportTicketId
      });

      return {
        success: true,
        driverId,
        reason: IDENTITY_REVERIFY_PUBLIC_REASON,
        reasonCode: IDENTITY_REVERIFY_REASON_CODE,
        requirement: IDENTITY_REVERIFY_REQUIREMENT,
        challengeId,
        reverifyRequired: false,
        deferred: true,
        activeTripId: activeTrip.tripId
      };
    }

    return this.applyIdentityReverificationGate({
      driverId,
      tripId,
      reporterId,
      reporterType,
      payload,
      supportTicketId,
      challengeId
    });
  }

  async applyDeferredIdentityReverificationIfSafe(driverId, context = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };

    const activeTrip = await resolveActiveTripForDriver(this.redis, driverId).catch(() => ({
      tripId: null,
      customerId: null
    }));
    if (activeTrip?.tripId) {
      return {
        success: true,
        deferred: true,
        activeTripId: activeTrip.tripId
      };
    }

    const state = await firebaseConfig.getFromRealtimeDB(`users/${driverId}/identityReverification`)
      .catch(() => null);
    if (!state || state.status !== 'deferred_until_trip_end') {
      return { success: true, applied: false };
    }

    return this.applyIdentityReverificationGate({
      driverId,
      tripId: context.tripId || state.tripId || null,
      reporterId: state.reporterId || null,
      reporterType: state.reporterType || 'passenger',
      supportTicketId: state.supportTicketId || null,
      payload: {
        selectedOptions: ['identity_reverification_deferred'],
        comment: 'Revalidacao aplicada apos fim da corrida',
        source: context.source || 'post_trip'
      },
      challengeId: state.challengeId || null
    });
  }

  async recordIdentityReverificationResult(driverId, verificationResult = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };
    const requirement = verificationResult.requirement || verificationResult.payload?.requirement;
    const challengeId = verificationResult.challengeId || verificationResult.payload?.challengeId || null;
    if (requirement !== IDENTITY_REVERIFY_REQUIREMENT && !challengeId) {
      return { success: true, recorded: false };
    }

    const nowIso = new Date().toISOString();
    const state = await firebaseConfig.getFromRealtimeDB(`users/${driverId}/identityReverification`)
      .catch(() => null);
    const notificationSentAtMs = toMillis(state?.notificationSentAt);
    const validationStartedAtMs = toMillis(state?.validationStartedAt) || Date.now();
    const score = Number(verificationResult.similarityScore ?? verificationResult.confidence ?? 0);
    const isApproved = verificationResult.isMatch === true && verificationResult.needsReview !== true;
    const status = isApproved ? 'passed' : 'failed';
    const baseUpdate = {
      'identityReverification/status': status,
      'identityReverification/validationCompletedAt': nowIso,
      'identityReverification/lastSimilarityScore': Number.isFinite(score) ? score : null,
      'identityReverification/lastDecision': verificationResult.decision || null,
      'identityReverification/metrics/notificationToValidationCompletedSeconds': notificationSentAtMs
        ? Math.max(0, Math.round((Date.now() - notificationSentAtMs) / 1000))
        : null,
      'identityReverification/metrics/validationDurationSeconds': Math.max(
        0,
        Math.round((Date.now() - validationStartedAtMs) / 1000)
      ),
      kycUpdatedAt: nowIso
    };

    if (isApproved) {
      await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
        ...baseUpdate,
        kycReverifyRequired: false,
        kycReverifyPendingAfterTrip: false,
        kycReverifyReason: null,
        kycReverifySource: null,
        kycStatus: 'approved',
        kycBlocked: false,
        kycLastVerificationAt: nowIso
      }).catch(() => null);
      await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
        kyc_reverify_required: String(false),
        kyc_status: 'approved',
        kyc_blocked: String(false),
        identity_reverification_status: 'passed'
      })).catch(() => null);
      return { success: true, driverId, status };
    }

    const firestore = firebaseConfig.getFirestore();
    if (firestore) {
      const blockPayload = {
        kycStatus: 'blocked',
        kycBlocked: true,
        kycBlockedReason: 'identity_reverification_failed',
        kycLastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
        identityReverification: {
          ...(state && typeof state === 'object' ? state : {}),
          status: 'failed',
          failedAt: nowIso,
          lastSimilarityScore: Number.isFinite(score) ? score : null,
          lastDecision: verificationResult.decision || null
        }
      };
      await Promise.all([
        firestore.collection('users').doc(driverId).set(blockPayload, { merge: true }),
        firestore.collection('drivers').doc(driverId).set(blockPayload, { merge: true })
      ]).catch(() => null);
    }

    await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      ...baseUpdate,
      kycStatus: 'blocked',
      kycBlocked: true,
      kycBlockedReason: 'identity_reverification_failed',
      kycLastVerificationAt: nowIso
    }).catch(() => null);
    await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
      kyc_status: 'blocked',
      kyc_blocked: String(true),
      kyc_reverify_required: String(false),
      isOnline: String(false),
      status: 'OFFLINE',
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_FAILED',
      identity_reverification_status: 'failed'
    })).catch(() => null);
    await Promise.resolve().then(() => this.redis.zrem('drivers:available', driverId)).catch(() => null);
    await Promise.resolve().then(() => this.redis.zrem(
      process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
      driverId
    )).catch(() => null);

    await this.notificationService.sendCustomNotification(
      driverId,
      'Validação de segurança',
      'Entre em contato com o suporte para continuar usando o modo motorista.',
      {
        type: 'kyc_reverification_failed',
        screen: 'RobotaxiPrototypeSupport',
        userType: 'driver',
        requirement: IDENTITY_REVERIFY_REQUIREMENT,
        challengeId
      }
    ).catch(() => null);

    return { success: true, driverId, status };
  }

  async recordIdentityReverificationStarted(driverId, payload = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };
    const requirement = payload.requirement || payload.payload?.requirement;
    const challengeId = payload.challengeId || payload.payload?.challengeId || null;
    if (requirement !== IDENTITY_REVERIFY_REQUIREMENT && !challengeId) {
      return { success: true, recorded: false };
    }

    const nowIso = new Date().toISOString();
    const state = await firebaseConfig.getFromRealtimeDB(`users/${driverId}/identityReverification`)
      .catch(() => null);
    const notificationSentAtMs = toMillis(state?.notificationSentAt);
    await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      'identityReverification/validationStartedAt': nowIso,
      'identityReverification/metrics/notificationToValidationStartedSeconds': notificationSentAtMs
        ? Math.max(0, Math.round((Date.now() - notificationSentAtMs) / 1000))
        : null,
      kycUpdatedAt: nowIso
    }).catch(() => null);
    await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
      identity_reverification_validation_started_at: nowIso
    })).catch(() => null);

    return { success: true, driverId, recorded: true };
  }
}

module.exports = new KYCPolicyService();

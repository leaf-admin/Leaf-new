const admin = require('firebase-admin');
const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const IntegratedKYCService = require('./IntegratedKYCService');
const kycDriverStatusService = require('./kyc-driver-status-service');
const { logStructured, logError } = require('../utils/logger');

const DEFAULTS = {
  challengeTtlSeconds: 20 * 60,
  verificationMaxAgeHours: 24,
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

class KYCPolicyService {
  constructor() {
    this.redis = redisPool.getConnection();
    this.integratedKycService = new IntegratedKYCService();
    this.challengePrefix = 'kyc:stepup:challenge:';
    this.activeChallengePrefix = 'kyc:stepup:active:';
  }

  getConfig() {
    return {
      challengeTtlSeconds: getIntEnv(
        'KYC_WITHDRAW_CHALLENGE_TTL_SECONDS',
        DEFAULTS.challengeTtlSeconds
      ),
      verificationMaxAgeHours: getIntEnv(
        'KYC_WITHDRAW_VERIFICATION_MAX_AGE_HOURS',
        DEFAULTS.verificationMaxAgeHours
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

    realtimeUser = (await firebaseConfig.getFromRealtimeDB(`users/${driverId}`)) || {};

    return { usersDoc, driversDoc, realtimeUser };
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

    await this.ensureKycInitialized().catch(() => null);
    const verification = await this.integratedKycService.hasValidVerification(
      driverId,
      config.verificationMaxAgeHours
    );

    if (!verification?.hasValid) {
      signals.push({
        code: 'KYC_STALE_OR_MISSING',
        weight: 26,
        message: verification?.reason || 'KYC valido nao encontrado na janela esperada',
        details: {
          maxAgeHours: config.verificationMaxAgeHours
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
      signals,
      challenge,
      context: {
        withdrawals24hCount: withdrawalSignals.withdrawals24hCount,
        withdrawals24hCents: withdrawalSignals.withdrawals24hCents,
        burstCount: withdrawalSignals.burstCount,
        hasValidVerification: Boolean(verification?.hasValid)
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
      'nao corresponde a foto',
      'foto diferente',
      'driver different',
      'wrong driver',
      'different driver',
      'nao era a mesma pessoa'
    ];
  }

  isPhotoMismatchReport(payload = {}) {
    if (payload.photoMismatch === true || payload.driverPhotoMismatch === true) {
      return true;
    }

    const options = Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [];
    const allText = [
      ...options,
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

  async markDriverForPhotoMismatch({
    driverId,
    tripId = null,
    reporterId = null,
    reporterType = 'passenger',
    payload = {}
  }) {
    if (!driverId) {
      return {
        success: false,
        error: 'driverId e obrigatorio'
      };
    }

    const reason = 'Denuncia de divergencia facial: revalidacao obrigatoria';
    const nowIso = new Date().toISOString();
    const firestore = firebaseConfig.getFirestore();

    if (firestore) {
      await firestore.collection('kyc_events').add({
        driverId,
        tripId,
        type: 'PHOTO_MISMATCH_REPORTED',
        source: reporterType,
        reporterId,
        payload: {
          selectedOptions: Array.isArray(payload.selectedOptions) ? payload.selectedOptions : [],
          comment: String(payload.comment || ''),
          suggestion: String(payload.suggestion || '')
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }).catch((error) => {
        logError(error, 'Falha ao salvar evento KYC de denuncia', {
          service: 'kyc-policy-service',
          driverId,
          tripId
        });
      });

      const updatePayload = {
        kycReverifyRequired: true,
        kycReverifyReason: reason,
        kycReverifySource: 'passenger_photo_mismatch_report',
        kycPhotoMismatchReportedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycReverifyRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycStatus: 'pending_reverify',
        kycBlocked: true,
        kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await Promise.all([
        firestore.collection('users').doc(driverId).set(updatePayload, { merge: true }),
        firestore.collection('drivers').doc(driverId).set(updatePayload, { merge: true })
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
      kycReverifySource: 'passenger_photo_mismatch_report',
      kycPhotoMismatchReportedAt: nowIso,
      kycReverifyRequestedAt: nowIso,
      kycStatus: 'pending_reverify',
      kycBlocked: true,
      kycUpdatedAt: nowIso
    }).catch((error) => {
      logError(error, 'Falha ao atualizar status KYC no Realtime DB apos denuncia', {
        service: 'kyc-policy-service',
        driverId
      });
    });

    await this.integratedKycService.invalidateVerificationCache(driverId).catch(() => null);

    await kycDriverStatusService.blockDriver(driverId, reason, {
      similarityScore: 0,
      confidence: 0,
      verificationAttempts: 1
    }).catch((error) => {
      logError(error, 'Falha ao bloquear motorista apos denuncia de foto', {
        service: 'kyc-policy-service',
        driverId
      });
    });

    await Promise.resolve().then(() => this.redis.hset(`driver:${driverId}`, {
      kyc_reverify_required: String(true),
      kyc_reverify_source: 'passenger_photo_mismatch_report',
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED'
    })).catch(() => null);

    await Promise.resolve().then(() => this.redis.zrem(
      process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
      driverId
    )).catch(() => null);

    logStructured('warn', 'Motorista marcado para revalidacao facial por denuncia', {
      service: 'kyc-policy-service',
      driverId,
      tripId,
      reporterId,
      reporterType
    });

    return {
      success: true,
      driverId,
      reason,
      reverifyRequired: true
    };
  }
}

module.exports = new KYCPolicyService();

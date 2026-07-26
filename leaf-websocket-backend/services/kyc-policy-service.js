const admin = require('firebase-admin');
const crypto = require('crypto');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const IntegratedKYCService = require('./IntegratedKYCService');
const KYCNotificationService = require('./KYCNotificationService');
const supportTicketService = require('./support-ticket-service');
const redisCriticalAuthorityService = require('./redis-critical-authority-service');
const {
  resolveActiveTripForDriver,
  claimIdentityPolicyMutationWindow,
  releaseIdentityPolicyMutationWindow
} = require('../utils/active-trip-index');
const { logStructured, logError } = require('../utils/logger');

const IDENTITY_REVERIFY_PUBLIC_REASON = 'Por segurança, precisamos validar sua identidade.';
const IDENTITY_REVERIFY_REASON_CODE = 'passenger_photo_mismatch_report';
const LIVENESS_ATTEMPTS_EXHAUSTED_REASON_CODE = 'aws_liveness_attempts_exhausted';
const IDENTITY_REVERIFY_REQUIREMENT = 'IDENTITY_REVERIFICATION';
const MANUAL_REVIEW_RETRY_SCOPE_PREFIX = 'manual_review_retry_';
const ORPHAN_HOLD_RETRY_SCOPE_PREFIX = 'orphan_hold_retry_';

function normalizeAuthorizedRetryScope(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const acceptedPrefixes = [
    MANUAL_REVIEW_RETRY_SCOPE_PREFIX,
    ORPHAN_HOLD_RETRY_SCOPE_PREFIX
  ];
  return acceptedPrefixes.some((prefix) =>
    new RegExp(`^${prefix}[a-z0-9_]{8,45}$`).test(normalized))
    ? normalized
    : null;
}

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
  'kyc_blocked',
  'kycReverifyRequired',
  'kyc_reverify_required',
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

const TERMINAL_KYC_STATUSES = new Set([
  'blocked',
  'rejected',
  'failed',
  'denied',
  'suspended',
  'disabled'
]);

const RECONCILABLE_IDENTITY_STATUSES = new Set([
  'requested',
  'validating',
  'passed'
]);

const APPROVABLE_IDENTITY_KYC_STATUSES = new Set([
  '',
  'approved',
  'pending_reverify'
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

async function assertRedisCriticalAuthorityForPolicyMutation() {
  if (
    String(process.env.KYC_ACTIVE_TRIP_AUTHORITY_MODE || '').trim().toLowerCase()
    !== 'redis_noeviction'
  ) {
    return {};
  }
  await redisCriticalAuthorityService.assertReady({ forceRefresh: true });
  return {
    requiredDatasetGeneration: String(
      process.env.REDIS_CRITICAL_DATASET_GENERATION || ''
    ).trim(),
    datasetGenerationKey: String(
      process.env.REDIS_CRITICAL_DATASET_GENERATION_KEY
        || 'leaf:runtime:critical-dataset:generation'
    ).trim()
  };
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

function isTrueFlag(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

function canApplyApprovedIdentityResult(source = {}) {
  const kycStatus = normalizeKycStatus(source.kycStatus ?? source.kyc_status);
  const accountStatus = normalizeKycStatus(source.status);
  const identityStatus = normalizeKycStatus(source.identityReverification?.status);
  return RECONCILABLE_IDENTITY_STATUSES.has(identityStatus)
    && !isTrueFlag(source.kycBlocked ?? source.kyc_blocked)
    && !isTrueFlag(source.blocked)
    && APPROVABLE_IDENTITY_KYC_STATUSES.has(kycStatus)
    && !TERMINAL_KYC_STATUSES.has(accountStatus);
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
    this.challengeCreateLockPrefix = 'kyc:stepup:create-lock:';
    this.challengeCreationInFlight = new Map();
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

  getStrictRealtimeDatabase() {
    const database = firebaseConfig.getRealtimeDB?.();
    if (!database || typeof database.ref !== 'function') {
      const error = new Error('Realtime Database indisponivel para politica KYC critica');
      error.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      throw error;
    }
    return database;
  }

  async readRealtimeStrict(path) {
    const snapshot = await this.getStrictRealtimeDatabase().ref(path).once('value');
    return snapshot?.exists?.() ? snapshot.val() : null;
  }

  async transactCurrentIdentityReverification(driverId, challengeId, mutateUser) {
    if (!challengeId) {
      return {
        committed: false,
        stale: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }

    const userRef = this.getStrictRealtimeDatabase().ref(`users/${driverId}`);
    const stateUnavailableError = (error, message) => {
      const normalized = error instanceof Error ? error : new Error(message);
      normalized.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      return normalized;
    };
    const readCurrentUser = async () => {
      try {
        const snapshot = await userRef.once('value');
        return snapshot?.exists?.() ? snapshot.val() : null;
      } catch (error) {
        throw stateUnavailableError(
          error,
          'RTDB nao confirmou o estado autoritativo do challenge KYC'
        );
      }
    };
    const hasCurrentChallenge = (currentUser) => (
      String(currentUser?.identityReverification?.challengeId || '') === String(challengeId)
    );
    const cachePinListener = () => {};
    let cachePinAttached = false;
    let cachePinError = null;

    // Firebase Admin invokes a transaction updater immediately with its local
    // cache. On a cold gateway that value can be null even when RTDB has data;
    // returning undefined there aborts locally before any server round-trip.
    // Pinning a read listener prevents once() from pruning the authoritative
    // cache before transaction() starts.
    // applyLocally=false prevents an uncommitted mutation from being projected.
    try {
      if (typeof userRef.on !== 'function' || typeof userRef.off !== 'function') {
        throw stateUnavailableError(
          null,
          'RTDB nao oferece listener autoritativo para o challenge KYC'
        );
      }
      try {
        userRef.on('value', cachePinListener, (error) => {
          cachePinError = stateUnavailableError(
            error,
            'Listener RTDB do challenge KYC foi cancelado'
          );
        });
        cachePinAttached = true;
      } catch (error) {
        throw stateUnavailableError(
          error,
          'RTDB nao iniciou o listener autoritativo do challenge KYC'
        );
      }

      const preflightUser = await readCurrentUser();
      if (cachePinError) throw cachePinError;
      if (!hasCurrentChallenge(preflightUser)) {
        return {
          committed: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }

      let matchedCurrentChallenge = false;
      let mutationRejected = false;
      let transaction = null;
      try {
        transaction = await userRef.transaction((currentUser) => {
          matchedCurrentChallenge = false;
          mutationRejected = false;
          const currentState = currentUser?.identityReverification;
          if (!currentState || String(currentState.challengeId || '') !== String(challengeId)) {
            return undefined;
          }
          matchedCurrentChallenge = true;
          const nextUser = mutateUser(currentUser || {}, currentState);
          if (nextUser === undefined) {
            mutationRejected = true;
          }
          return nextUser;
        }, undefined, false);
      } catch (error) {
        throw stateUnavailableError(
          error,
          'RTDB nao confirmou a transacao do challenge KYC atual'
        );
      }

      if (cachePinError) throw cachePinError;
      if (transaction?.committed === true && matchedCurrentChallenge) {
        return {
          committed: true,
          stale: false,
          snapshot: transaction.snapshot?.val?.() || null
        };
      }
      if (mutationRejected) {
        return {
          committed: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }

      const latestUser = await readCurrentUser();
      if (cachePinError) throw cachePinError;
      if (!hasCurrentChallenge(latestUser)) {
        return {
          committed: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }

      throw stateUnavailableError(
        null,
        'RTDB nao confirmou a transacao do challenge KYC atual'
      );
    } finally {
      if (cachePinAttached) {
        try {
          userRef.off('value', cachePinListener);
        } catch (_error) {
          logStructured('warn', 'Falha ao remover listener RTDB autoritativo', {
            service: 'kyc-policy-service',
            driverId,
            challengeId
          });
        }
      }
    }
  }

  async persistCurrentIdentityFirestore(
    driverId,
    challengeId,
    payload,
    { requireApprovalSafe = false, dryRun = false } = {}
  ) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) return { committed: true, skipped: true };

    const refs = [
      firestore.collection('users').doc(driverId),
      firestore.collection('drivers').doc(driverId)
    ];
    return firestore.runTransaction(async (transaction) => {
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const hasConflictingChallenge = snapshots.some((snapshot) => {
        if (!snapshot?.exists) return false;
        const currentChallengeId = snapshot.data()?.identityReverification?.challengeId;
        return currentChallengeId && String(currentChallengeId) !== String(challengeId);
      });
      if (hasConflictingChallenge) {
        return {
          committed: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }
      const hasLaterBlockingState = requireApprovalSafe && snapshots.some((snapshot) => (
        snapshot?.exists && !canApplyApprovedIdentityResult(snapshot.data() || {})
      ));
      if (hasLaterBlockingState) {
        return {
          committed: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
        };
      }
      if (dryRun) return { committed: true, stale: false, dryRun: true };
      refs.forEach((ref) => transaction.set(ref, payload, { merge: true }));
      return { committed: true, stale: false };
    });
  }

  async persistCurrentIdentityRedis(
    driverId,
    challengeId,
    fields = {},
    { requireApprovalSafe = false } = {}
  ) {
    if (!this.redis || typeof this.redis.eval !== 'function') {
      const error = new Error('Redis atomico indisponivel para concluir revalidacao');
      error.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      throw error;
    }
    const flattenedFields = Object.entries(fields).flatMap(([field, value]) => [
      String(field),
      value == null ? '' : String(value)
    ]);
    const approvalGuard = requireApprovalSafe
      ? 'local kyc_status = string.lower(tostring(redis.call("hget", KEYS[1], "kyc_status") or "")); local kyc_blocked = string.lower(tostring(redis.call("hget", KEYS[1], "kyc_blocked") or "")); local identity_status = string.lower(tostring(redis.call("hget", KEYS[1], "identity_reverification_status") or "requested")); local account_status = string.lower(tostring(redis.call("hget", KEYS[1], "status") or "")); local kyc_status_owned = kyc_status == "" or kyc_status == "approved" or kyc_status == "pending_reverify"; local identity_status_owned = identity_status == "requested" or identity_status == "validating" or identity_status == "passed"; local account_status_safe = account_status ~= "blocked" and account_status ~= "rejected" and account_status ~= "denied" and account_status ~= "suspended" and account_status ~= "disabled"; if kyc_blocked == "true" or not kyc_status_owned or not identity_status_owned or not account_status_safe then return -1 end; '
      : '';
    let result = null;
    try {
      result = await this.redis.eval(
        `if tostring(redis.call("hget", KEYS[1], "identity_reverification_challenge_id") or "") ~= tostring(ARGV[1]) then return 0 end; ${approvalGuard}if #ARGV > 1 then redis.call("hset", KEYS[1], unpack(ARGV, 2)) end; return 1`,
        1,
        `driver:${driverId}`,
        String(challengeId || ''),
        ...flattenedFields
      );
    } catch (error) {
      error.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      throw error;
    }
    return Number(result) === 1;
  }

  async getDriverKycState(driverId) {
    const firestore = firebaseConfig.getFirestore();
    let usersDoc = {};
    let driversDoc = {};
    let realtimeUser = {};
    let redisDriver = {};

    if (firestore) {
      const [usersSnap, driversSnap] = await Promise.all([
        firestore.collection('users').doc(driverId).get(),
        firestore.collection('drivers').doc(driverId).get()
      ]);

      usersDoc = usersSnap.exists ? usersSnap.data() : {};
      driversDoc = driversSnap.exists ? driversSnap.data() : {};
    }

    realtimeUser = await readRealtimeKycPolicyFields(driverId);
    if (this.redis && typeof this.redis.hgetall === 'function') {
      redisDriver = await this.redis.hgetall(`driver:${driverId}`) || {};
    }

    return {
      usersDoc: pickKycPolicyFields(usersDoc),
      driversDoc: pickKycPolicyFields(driversDoc),
      realtimeUser: pickKycPolicyFields(realtimeUser),
      redisDriver: pickKycPolicyFields(redisDriver)
    };
  }

  resolveKycApprovalGate(kycState = {}) {
    const durableStatusCandidates = [
      kycState.usersDoc?.kycStatus,
      kycState.usersDoc?.kyc_status,
      kycState.driversDoc?.kycStatus,
      kycState.driversDoc?.kyc_status
    ].map(normalizeKycStatus).filter(Boolean);
    const replicaStatusCandidates = [
      kycState.realtimeUser?.kycStatus,
      kycState.realtimeUser?.kyc_status,
      kycState.redisDriver?.kycStatus,
      kycState.redisDriver?.kyc_status
    ].map(normalizeKycStatus).filter(Boolean);
    const statusCandidates = [
      ...durableStatusCandidates,
      ...replicaStatusCandidates
    ];

    const blocked = [
      kycState.usersDoc?.kycBlocked,
      kycState.usersDoc?.kyc_blocked,
      kycState.driversDoc?.kycBlocked,
      kycState.driversDoc?.kyc_blocked,
      kycState.realtimeUser?.kycBlocked,
      kycState.realtimeUser?.kyc_blocked,
      kycState.redisDriver?.kycBlocked,
      kycState.redisDriver?.kyc_blocked
    ].some(isTrueFlag);

    // A canonical biometric rollout must fail safe even if its explicit strict
    // authority flag is accidentally omitted. The readiness policy still
    // requires KYC_STRICT_PRODUCTION_MODE=true so the deployment contract stays
    // visible and auditable.
    const strictProductionMode = (
      getBoolEnv('KYC_STRICT_PRODUCTION_MODE', false)
      || getBoolEnv('KYC_PRODUCTION_BIOMETRICS_ENABLED', false)
    );
    const approved = (
      strictProductionMode ? durableStatusCandidates : statusCandidates
    ).some((status) => status === 'approved');
    const blockingStatus = statusCandidates.find((status) => BLOCKING_KYC_STATUSES.has(status));

    if (blocked) {
      return {
        allowed: false,
        code: 'KYC_BLOCKED',
        reason: 'Motorista bloqueado para KYC ou revalidacao obrigatoria.',
        status: blockingStatus || statusCandidates[0] || 'blocked'
      };
    }

    if (blockingStatus || !approved) {
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
    const reverifyRequired = [
      kycState.usersDoc?.kycReverifyRequired,
      kycState.usersDoc?.kyc_reverify_required,
      kycState.driversDoc?.kycReverifyRequired,
      kycState.driversDoc?.kyc_reverify_required,
      kycState.realtimeUser?.kycReverifyRequired,
      kycState.realtimeUser?.kyc_reverify_required,
      kycState.redisDriver?.kycReverifyRequired,
      kycState.redisDriver?.kyc_reverify_required
    ].some(isTrueFlag);

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

  normalizeChallengeSource(source) {
    const normalizedSource = String(source || '').trim();
    return normalizedSource || 'legacy';
  }

  normalizeChallengeMetadata(metadata, source) {
    const normalizedMetadata = metadata
      && typeof metadata === 'object'
      && !Array.isArray(metadata)
      ? { ...metadata }
      : {};

    return {
      ...normalizedMetadata,
      challengeSource: this.normalizeChallengeSource(source)
    };
  }

  normalizeChallengePayload(challenge) {
    if (!challenge || typeof challenge !== 'object') return challenge;

    const source = this.normalizeChallengeSource(challenge.source);
    return {
      ...challenge,
      source,
      metadata: this.normalizeChallengeMetadata(challenge.metadata, source)
    };
  }

  buildChallengeInFlightKey({ driverId, requirement, source }) {
    return JSON.stringify([
      String(driverId || '').trim(),
      String(requirement || '').trim(),
      this.normalizeChallengeSource(source)
    ]);
  }

  getReusableChallengeForFlow(activeChallenge, { requirement, source }) {
    if (
      !activeChallenge
      || activeChallenge.status !== 'pending'
      || activeChallenge.requirement !== requirement
    ) {
      return null;
    }

    const normalizedChallenge = this.normalizeChallengePayload(activeChallenge);
    const requestedSource = this.normalizeChallengeSource(source);
    if (normalizedChallenge.source !== requestedSource) {
      const error = new Error('Challenge KYC ativo pertence a outro fluxo');
      error.code = 'KYC_CHALLENGE_SOURCE_CONFLICT';
      error.activeChallengeId = normalizedChallenge.challengeId || null;
      error.activeSource = normalizedChallenge.source;
      error.requestedSource = requestedSource;
      error.requirement = requirement;
      throw error;
    }

    return normalizedChallenge;
  }

  async createStepUpChallenge({ driverId, requirement, score, signals, source, metadata = {} }) {
    const config = this.getConfig();
    const challengeId = this.createChallengeId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (config.challengeTtlSeconds * 1000));
    const normalizedSource = this.normalizeChallengeSource(source);
    const normalizedMetadata = this.normalizeChallengeMetadata(metadata, normalizedSource);
    const durablePersistenceRequired = normalizedMetadata.canonicalEvidenceRequired === true;

    const challengePayload = {
      challengeId,
      driverId,
      requirement,
      score,
      signals,
      source: normalizedSource,
      metadata: normalizedMetadata,
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
      if (durablePersistenceRequired) {
        error.code = error.code || 'KYC_CHALLENGE_REDIS_PERSIST_FAILED';
        throw error;
      }
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore && durablePersistenceRequired) {
      await this.redis.del(`${this.challengePrefix}${challengeId}`).catch(() => null);
      await this.redis.del(`${this.activeChallengePrefix}${driverId}`).catch(() => null);
      const error = new Error('Firestore indisponivel para challenge KYC canonico');
      error.code = 'KYC_CHALLENGE_DURABLE_STORE_UNAVAILABLE';
      throw error;
    }
    if (firestore) {
      try {
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
        );
      } catch (error) {
        logError(error, 'Falha ao salvar challenge KYC no Firestore', {
          service: 'kyc-policy-service',
          driverId,
          challengeId
        });
        if (durablePersistenceRequired) {
          await this.redis.del(`${this.challengePrefix}${challengeId}`).catch(() => null);
          await this.redis.del(`${this.activeChallengePrefix}${driverId}`).catch(() => null);
          error.code = error.code || 'KYC_CHALLENGE_DURABLE_PERSIST_FAILED';
          throw error;
        }
      }
    }

    return challengePayload;
  }

  async getOrCreateStepUpChallenge({
    driverId,
    requirement,
    score,
    signals,
    source,
    metadata = {}
  }) {
    const normalizedSource = this.normalizeChallengeSource(source);
    const normalizedMetadata = this.normalizeChallengeMetadata(metadata, normalizedSource);
    const inFlightKey = this.buildChallengeInFlightKey({
      driverId,
      requirement,
      source: normalizedSource
    });
    const inFlight = this.challengeCreationInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const operation = this.getOrCreateStepUpChallengeDistributed({
      driverId,
      requirement,
      score,
      signals,
      source: normalizedSource,
      metadata: normalizedMetadata
    }).finally(() => {
      if (this.challengeCreationInFlight.get(inFlightKey) === operation) {
        this.challengeCreationInFlight.delete(inFlightKey);
      }
    });
    this.challengeCreationInFlight.set(inFlightKey, operation);
    return operation;
  }

  async getOrCreateStepUpChallengeDistributed({
    driverId,
    requirement,
    score,
    signals,
    source,
    metadata = {}
  }) {
    const normalizedSource = this.normalizeChallengeSource(source);
    const normalizedMetadata = this.normalizeChallengeMetadata(metadata, normalizedSource);
    const activeChallenge = await this.getStepUpChallenge(null, driverId).catch(() => null);
    const reusableActiveChallenge = this.getReusableChallengeForFlow(activeChallenge, {
      requirement,
      source: normalizedSource
    });
    if (reusableActiveChallenge) return reusableActiveChallenge;

    const lockKey = `${this.challengeCreateLockPrefix}${driverId}`;
    const lockToken = crypto.randomBytes(16).toString('hex');
    const lockAcquired = await this.redis.set(lockKey, lockToken, 'EX', 5, 'NX');

    if (lockAcquired !== 'OK') {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
        const winnerChallenge = await this.getStepUpChallenge(null, driverId).catch(() => null);
        const reusableWinnerChallenge = this.getReusableChallengeForFlow(winnerChallenge, {
          requirement,
          source: normalizedSource
        });
        if (reusableWinnerChallenge) return reusableWinnerChallenge;
      }
      const error = new Error('Criacao de challenge KYC ja esta em andamento');
      error.code = 'KYC_CHALLENGE_CREATE_BUSY';
      throw error;
    }

    try {
      const challengeAfterLock = await this.getStepUpChallenge(null, driverId).catch(() => null);
      const reusableChallengeAfterLock = this.getReusableChallengeForFlow(challengeAfterLock, {
        requirement,
        source: normalizedSource
      });
      if (reusableChallengeAfterLock) return reusableChallengeAfterLock;

      return await this.createStepUpChallenge({
        driverId,
        requirement,
        score,
        signals,
        source: normalizedSource,
        metadata: normalizedMetadata
      });
    } finally {
      if (typeof this.redis.eval === 'function') {
        await this.redis.eval(
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
          1,
          lockKey,
          lockToken
        ).catch(() => null);
      } else {
        const currentToken = await this.redis.get(lockKey).catch(() => null);
        if (currentToken === lockToken) {
          await this.redis.del(lockKey).catch(() => null);
        }
      }
    }
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
        if (parsed.status && parsed.status !== 'pending') return null;
        if (toMillis(parsed.expiresAt) <= Date.now()) return null;
        return this.normalizeChallengePayload(parsed);
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
    if (data.status && data.status !== 'pending') return null;
    if (toMillis(data.expiresAt) <= Date.now()) return null;

    return this.normalizeChallengePayload({
      challengeId: challengeSnap.id,
      driverId: data.driverId,
      requirement: data.requirement,
      score: Number(data.score || 0),
      signals: Array.isArray(data.signals) ? data.signals : [],
      source: data.source || null,
      metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
      status: data.status || 'pending',
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || null,
      expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || data.expiresAt || null
    });
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

    const effectiveRequirement = challenge.requirement || requirement || 'VERIFY_REQUIRED';
    if (effectiveRequirement === 'LIVENESS_REQUIRED' && !this.isLivenessSatisfied(verificationPayload)) {
      return {
        success: false,
        error: 'Liveness obrigatorio para concluir este desafio',
        code: 'KYC_LIVENESS_REQUIRED'
      };
    }

    const nowIso = new Date().toISOString();
    if (!this.redis || typeof this.redis.multi !== 'function') {
      const error = new Error('Redis indisponivel para concluir challenge KYC');
      error.code = 'KYC_CHALLENGE_CACHE_RESOLVE_FAILED';
      throw error;
    }
    const redisMulti = this.redis.multi();
    redisMulti.del(`${this.challengePrefix}${challenge.challengeId}`);
    redisMulti.del(`${this.activeChallengePrefix}${challenge.driverId}`);
    const redisResult = await redisMulti.exec();
    if (!redisResult) {
      const error = new Error('Redis nao confirmou a conclusao do challenge KYC');
      error.code = 'KYC_CHALLENGE_CACHE_RESOLVE_FAILED';
      throw error;
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      const error = new Error('Firestore indisponivel para concluir challenge KYC');
      error.code = 'KYC_CHALLENGE_STORE_RESOLVE_FAILED';
      throw error;
    }
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
      );

    await this.recordVerificationSuccess(challenge.driverId, {
      source: `challenge:${effectiveRequirement}`,
      verifiedAt: nowIso,
      // Compatibility challenges may record freshness, but only canonical
      // AWS + trusted server-side compare may clear an identity reverify gate.
      clearReverify: false
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

    const firestorePayload = firestore
      ? {
        kycLastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
        kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
      : null;

    if (options.markFirstAccess) {
      realtimePayload.kycFirstAccessVerifiedAt = verifiedAtIso;
      if (firestorePayload) {
        firestorePayload.kycFirstAccessVerifiedAt = admin.firestore.FieldValue.serverTimestamp();
      }
    }

    if (options.clearReverify) {
      realtimePayload.kycReverifyRequired = false;
      realtimePayload.kycReverifyPendingAfterTrip = false;
      realtimePayload.kycRecheckPendingAfterTrip = false;
      realtimePayload.kycReverifyReason = null;
      realtimePayload.kycReverifySource = null;
      realtimePayload.kycPhotoMismatchReportedAt = null;
      realtimePayload.kycReverifyRequestedAt = null;
      realtimePayload.kycStatus = 'approved';
      realtimePayload.kycBlocked = false;

      if (firestorePayload) {
        firestorePayload.kycReverifyRequired = false;
        firestorePayload.kycReverifyPendingAfterTrip = false;
        firestorePayload.kycRecheckPendingAfterTrip = false;
        firestorePayload.kycReverifyReason = admin.firestore.FieldValue.delete();
        firestorePayload.kycReverifySource = admin.firestore.FieldValue.delete();
        firestorePayload.kycPhotoMismatchReportedAt = admin.firestore.FieldValue.delete();
        firestorePayload.kycReverifyRequestedAt = admin.firestore.FieldValue.delete();
        firestorePayload.kycStatus = 'approved';
        firestorePayload.kycBlocked = false;
      }
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

    const redisPayload = {
      kyc_last_verification: verifiedAtIso
    };
    if (options.clearReverify) {
      Object.assign(redisPayload, {
        kyc_reverify_required: String(false),
        kyc_status: 'approved',
        kyc_blocked: String(false),
        kyc_recheck_pending_after_trip: String(false),
        kycRecheckPendingAfterTrip: String(false),
        kycReverifyPendingAfterTrip: String(false),
        identity_reverification_pending_after_trip: String(false)
      });
    }
    await this.redis.hset(`driver:${driverId}`, redisPayload).catch(() => null);

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
    const attemptScope = normalizeAuthorizedRetryScope(payload.attemptScope);
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
      attemptScope,
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

    const realtimePersisted = await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      identityReverification,
      kycReverifyPendingAfterTrip: status === 'deferred_until_trip_end',
      kycRecheckPendingAfterTrip: status === 'deferred_until_trip_end',
      kycReverifyReason: reason,
      kycReverifySource: reasonCode,
      kycPhotoMismatchReportedAt: nowIso,
      kycUpdatedAt: nowIso
    });
    if (realtimePersisted !== true) {
      const error = new Error('Nao foi possivel persistir o estado critico de revalidacao');
      error.code = 'KYC_REVERIFY_STATE_PERSIST_FAILED';
      throw error;
    }

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
    const attemptScope = normalizeAuthorizedRetryScope(payload.attemptScope);
    const firestore = firebaseConfig.getFirestore();

    if (!this.redis || typeof this.redis.hset !== 'function') {
      const error = new Error('Redis indisponivel para selar revalidacao de identidade');
      error.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      throw error;
    }
    await this.redis.hset(`driver:${driverId}`, {
      kyc_reverify_required: String(true),
      kyc_reverify_source: reasonCode,
      kyc_status: 'pending_reverify',
      kyc_blocked: String(false),
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED',
      identity_reverification_challenge_id: effectiveChallengeId,
      identity_reverification_requested_at: nowIso
    });

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
          attemptScope,
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
        error.code = error.code || 'KYC_REVERIFY_STATE_PERSIST_FAILED';
        throw error;
      });
    }

    const realtimeGatePersisted = await firebaseConfig.updateRealtimeDB(`users/${driverId}`, {
      kycReverifyRequired: true,
      kycReverifyReason: reason,
      kycReverifySource: reasonCode,
      kycReverifyRequestedAt: nowIso,
      kycStatus: 'pending_reverify',
      kycBlocked: false,
      kycReverifyPendingAfterTrip: false,
      kycRecheckPendingAfterTrip: false,
      kycUpdatedAt: nowIso
    });
    if (realtimeGatePersisted !== true) {
      const error = new Error('Nao foi possivel aplicar o gate critico de revalidacao');
      error.code = 'KYC_REVERIFY_STATE_PERSIST_FAILED';
      throw error;
    }

    await this.integratedKycService.invalidateVerificationCache(driverId).catch(() => null);

    await this.redis.hset(`driver:${driverId}`, {
      kyc_reverify_required: String(true),
      kyc_reverify_source: reasonCode,
      kyc_status: 'pending_reverify',
      kyc_blocked: String(false),
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED',
      identity_reverification_challenge_id: effectiveChallengeId,
      identity_reverification_attempt_scope: attemptScope || '',
      identity_reverification_requested_at: nowIso,
      identity_reverification_pending_after_trip: String(false),
      kyc_recheck_pending_after_trip: String(false),
      kycRecheckPendingAfterTrip: String(false),
      kycReverifyPendingAfterTrip: String(false)
    });

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

    if (challengeId) {
      const currentIdentityState = await this.readRealtimeStrict(
        `users/${driverId}/identityReverification`
      ).catch(() => null);
      if (
        currentIdentityState?.challengeId
        && currentIdentityState.challengeId !== challengeId
      ) {
        return {
          success: true,
          driverId,
          softBlocked: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }
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
    let activeTrip = null;
    let activeTripLookupFailed = false;
    let deferredCode = null;
    let policyWindowClaim = null;
    try {
      activeTrip = await resolveActiveTripForDriver(this.redis, driverId);
    } catch (error) {
      activeTripLookupFailed = true;
      logStructured('warn', 'Revalidacao facial adiada: indice de corrida indisponivel', {
        service: 'kyc-policy-service',
        driverId,
        error: error?.message || String(error)
      });
    }

    if (!activeTripLookupFailed && !activeTrip?.tripId) {
      try {
        const criticalAuthorityOptions = await assertRedisCriticalAuthorityForPolicyMutation();
        policyWindowClaim = await claimIdentityPolicyMutationWindow(
          this.redis,
          driverId,
          crypto.randomBytes(24).toString('hex'),
          undefined,
          criticalAuthorityOptions
        );
        if (policyWindowClaim.activeTripId) {
          activeTrip = { tripId: policyWindowClaim.activeTripId };
        } else if (!policyWindowClaim.acquired) {
          return {
            success: false,
            retryable: true,
            deferred: false,
            driverId,
            reason: IDENTITY_REVERIFY_PUBLIC_REASON,
            reasonCode: IDENTITY_REVERIFY_REASON_CODE,
            requirement: IDENTITY_REVERIFY_REQUIREMENT,
            code: 'KYC_POLICY_MUTATION_IN_PROGRESS'
          };
        }
      } catch (error) {
        activeTripLookupFailed = true;
        deferredCode = 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE';
        logStructured('warn', 'Revalidacao facial adiada: trava corrida-KYC indisponivel', {
          service: 'kyc-policy-service',
          driverId,
          error: error?.message || String(error)
        });
      }
    }

    if (activeTripLookupFailed || activeTrip?.tripId) {
      const activeTripId = activeTrip?.tripId || tripId || null;
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
      await this.redis.hset(`driver:${driverId}`, {
        identity_reverification_pending_after_trip: String(true),
        kyc_recheck_pending_after_trip: String(true),
        kycRecheckPendingAfterTrip: String(true),
        kycReverifyPendingAfterTrip: String(true),
        identity_reverification_challenge_id: challengeId,
        identity_reverification_requested_at: nowIso
      });

      logStructured('warn', 'Revalidacao facial adiada ate fim da corrida ativa', {
        service: 'kyc-policy-service',
        driverId,
        activeTripId,
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
        activeTripId,
        ...(activeTripLookupFailed
          ? { code: deferredCode || 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE' }
          : {})
      };
    }

    try {
      return await this.applyIdentityReverificationGate({
        driverId,
        tripId,
        reporterId,
        reporterType,
        payload,
        supportTicketId,
        challengeId
      });
    } finally {
      if (policyWindowClaim?.acquired) {
        await releaseIdentityPolicyMutationWindow(this.redis, policyWindowClaim).catch(() => null);
      }
    }
  }

  async applyDeferredIdentityReverificationIfSafe(driverId, context = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };

    let activeTrip = null;
    try {
      activeTrip = await resolveActiveTripForDriver(this.redis, driverId);
    } catch (error) {
      logStructured('warn', 'Revalidacao KYC mantida adiada: indice de corrida indisponivel', {
        service: 'kyc-policy-service',
        driverId,
        error: error?.message || String(error)
      });
      return {
        success: true,
        applied: false,
        deferred: true,
        code: 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE'
      };
    }
    if (activeTrip?.tripId) {
      return {
        success: true,
        deferred: true,
        activeTripId: activeTrip.tripId
      };
    }

    let state = null;
    try {
      state = await this.readRealtimeStrict(`users/${driverId}/identityReverification`);
    } catch (error) {
      logStructured('warn', 'Revalidacao KYC mantida adiada: estado duravel indisponivel', {
        service: 'kyc-policy-service',
        driverId,
        error: error?.message || String(error)
      });
      return {
        success: true,
        applied: false,
        deferred: true,
        code: 'KYC_REVERIFY_STATE_UNAVAILABLE'
      };
    }
    if (!state || state.status !== 'deferred_until_trip_end') {
      return { success: true, applied: false };
    }

    let policyWindowClaim = null;
    try {
      const criticalAuthorityOptions = await assertRedisCriticalAuthorityForPolicyMutation();
      policyWindowClaim = await claimIdentityPolicyMutationWindow(
        this.redis,
        driverId,
        crypto.randomBytes(24).toString('hex'),
        undefined,
        criticalAuthorityOptions
      );
    } catch (error) {
      logStructured('warn', 'Revalidacao KYC mantida adiada: trava corrida-KYC indisponivel', {
        service: 'kyc-policy-service',
        driverId,
        error: error?.message || String(error)
      });
      return {
        success: true,
        applied: false,
        deferred: true,
        code: 'KYC_ACTIVE_TRIP_STATE_UNAVAILABLE'
      };
    }
    if (policyWindowClaim.activeTripId || !policyWindowClaim.acquired) {
      return {
        success: true,
        applied: false,
        deferred: true,
        activeTripId: policyWindowClaim.activeTripId || null,
        ...(!policyWindowClaim.activeTripId ? { code: 'KYC_POLICY_MUTATION_IN_PROGRESS' } : {})
      };
    }

    try {
      let lockedState = null;
      try {
        lockedState = await this.readRealtimeStrict(`users/${driverId}/identityReverification`);
      } catch (error) {
        return {
          success: true,
          applied: false,
          deferred: true,
          code: 'KYC_REVERIFY_STATE_UNAVAILABLE'
        };
      }
      if (!lockedState || lockedState.status !== 'deferred_until_trip_end') {
        return { success: true, applied: false };
      }
      return await this.applyIdentityReverificationGate({
        driverId,
        tripId: context.tripId || lockedState.tripId || null,
        reporterId: lockedState.reporterId || null,
        reporterType: lockedState.reporterType || 'passenger',
        supportTicketId: lockedState.supportTicketId || null,
        payload: {
          selectedOptions: ['identity_reverification_deferred'],
          comment: 'Revalidacao aplicada apos fim da corrida',
          source: context.source || 'post_trip'
        },
        challengeId: lockedState.challengeId || null
      });
    } finally {
      await releaseIdentityPolicyMutationWindow(this.redis, policyWindowClaim).catch(() => null);
    }
  }

  async recordIdentityReverificationResult(driverId, verificationResult = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };
    const requirement = verificationResult.requirement || verificationResult.payload?.requirement;
    const challengeId = verificationResult.challengeId || verificationResult.payload?.challengeId || null;
    if (requirement !== IDENTITY_REVERIFY_REQUIREMENT && !challengeId) {
      return { success: true, recorded: false };
    }
    if (!challengeId) {
      return {
        success: true,
        recorded: false,
        stale: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }

    const nowIso = new Date().toISOString();
    const score = Number(verificationResult.similarityScore ?? verificationResult.confidence ?? 0);
    const isApproved = verificationResult.isMatch === true && verificationResult.needsReview !== true;
    const status = isApproved ? 'passed' : 'failed';
    if (isApproved) {
      const firestore = firebaseConfig.getFirestore();
      if (firestore) {
        const firestorePreflight = await this.persistCurrentIdentityFirestore(
          driverId,
          challengeId,
          {},
          { requireApprovalSafe: true, dryRun: true }
        );
        if (!firestorePreflight.committed) {
          return {
            success: true,
            driverId,
            recorded: false,
            ...firestorePreflight
          };
        }
      }
      const redisPreflight = await this.persistCurrentIdentityRedis(
        driverId,
        challengeId,
        {},
        { requireApprovalSafe: true }
      );
      if (!redisPreflight) {
        return {
          success: true,
          driverId,
          recorded: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK'
        };
      }
    }
    let approvalSuperseded = false;
    const realtimeResult = await this.transactCurrentIdentityReverification(
      driverId,
      challengeId,
      (currentUser, currentState) => {
        if (isApproved && !canApplyApprovedIdentityResult(currentUser)) {
          approvalSuperseded = true;
          return undefined;
        }
        const notificationSentAtMs = toMillis(currentState.notificationSentAt);
        const validationStartedAtMs = toMillis(currentState.validationStartedAt) || Date.now();
        const nextIdentityState = {
          ...currentState,
          status,
          validationCompletedAt: nowIso,
          lastSimilarityScore: Number.isFinite(score) ? score : null,
          lastDecision: verificationResult.decision || null,
          metrics: {
            ...(currentState.metrics || {}),
            notificationToValidationCompletedSeconds: notificationSentAtMs
              ? Math.max(0, Math.round((Date.now() - notificationSentAtMs) / 1000))
              : null,
            validationDurationSeconds: Math.max(
              0,
              Math.round((Date.now() - validationStartedAtMs) / 1000)
            )
          }
        };
        if (isApproved) {
          return {
            ...currentUser,
            identityReverification: nextIdentityState,
            kycReverifyRequired: false,
            kycReverifyPendingAfterTrip: false,
            kycRecheckPendingAfterTrip: false,
            kycReverifyReason: null,
            kycReverifySource: null,
            kycStatus: 'approved',
            kycBlocked: false,
            kycLastVerificationAt: nowIso,
            kycUpdatedAt: nowIso
          };
        }
        return {
          ...currentUser,
          identityReverification: nextIdentityState,
          kycStatus: 'blocked',
          kycBlocked: true,
          kycBlockedReason: 'identity_reverification_failed',
          kycLastVerificationAt: nowIso,
          kycUpdatedAt: nowIso
        };
      }
    );
    if (!realtimeResult.committed) {
      return {
        success: true,
        driverId,
        recorded: false,
        ...realtimeResult,
        ...(approvalSuperseded
          ? { code: 'KYC_IDENTITY_REVERIFY_SUPERSEDED_BY_BLOCK' }
          : {})
      };
    }

    if (isApproved) {
      const firestore = firebaseConfig.getFirestore();
      const firestoreResult = firestore
        ? await this.persistCurrentIdentityFirestore(driverId, challengeId, {
        kycReverifyRequired: false,
        kycReverifyPendingAfterTrip: false,
        kycRecheckPendingAfterTrip: false,
        kycReverifyReason: admin.firestore.FieldValue.delete(),
        kycReverifySource: admin.firestore.FieldValue.delete(),
        kycStatus: 'approved',
        kycBlocked: false,
        kycLastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
        kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        identityReverification: {
          challengeId,
          status: 'passed',
          validationCompletedAt: nowIso,
          lastSimilarityScore: Number.isFinite(score) ? score : null,
          lastDecision: verificationResult.decision || null
        }
      }, { requireApprovalSafe: true })
        : { committed: true, skipped: true };
      if (!firestoreResult.committed) {
        return { success: true, driverId, recorded: false, ...firestoreResult };
      }
      const redisCommitted = await this.persistCurrentIdentityRedis(driverId, challengeId, {
        kyc_reverify_required: String(false),
        kyc_status: 'approved',
        kyc_blocked: String(false),
        identity_reverification_status: 'passed',
        identity_reverification_pending_after_trip: String(false),
        kyc_recheck_pending_after_trip: String(false),
        kycRecheckPendingAfterTrip: String(false),
        kycReverifyPendingAfterTrip: String(false)
      }, { requireApprovalSafe: true });
      if (!redisCommitted) {
        return {
          success: true,
          driverId,
          recorded: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }
      const challengeResolution = await this.resolveStepUpChallenge({
        challengeId,
        driverId,
        requirement: IDENTITY_REVERIFY_REQUIREMENT,
        verificationPayload: {
          ...verificationResult,
          awsLivenessPassed: true,
          provider: verificationResult.provider
            || verificationResult.comparisonProvider
            || 'aws_rekognition_compare_faces'
        }
      });
      if (challengeResolution?.success !== true) {
        return {
          success: true,
          driverId,
          recorded: false,
          stale: true,
          code: challengeResolution?.code || 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }
      return {
        success: true,
        driverId,
        status,
        recorded: true,
        challengeResolved: true,
        resolvedAt: challengeResolution.resolvedAt
      };
    }

    const firestore = firebaseConfig.getFirestore();
    const firestoreResult = firestore
      ? await this.persistCurrentIdentityFirestore(driverId, challengeId, {
      kycStatus: 'blocked',
      kycBlocked: true,
      kycBlockedReason: 'identity_reverification_failed',
      kycLastVerificationAt: admin.firestore.FieldValue.serverTimestamp(),
      kycUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      identityReverification: {
        challengeId,
        status: 'failed',
        failedAt: nowIso,
        lastSimilarityScore: Number.isFinite(score) ? score : null,
        lastDecision: verificationResult.decision || null
      }
    })
      : { committed: true, skipped: true };
    if (!firestoreResult.committed) {
      return { success: true, driverId, recorded: false, ...firestoreResult };
    }
    const redisCommitted = await this.persistCurrentIdentityRedis(driverId, challengeId, {
      kyc_status: 'blocked',
      kyc_blocked: String(true),
      kyc_reverify_required: String(false),
      isOnline: String(false),
      status: 'OFFLINE',
      dispatchEligible: String(false),
      dispatchEligibilityCode: 'KYC_REVERIFY_FAILED',
      identity_reverification_status: 'failed'
    });
    if (!redisCommitted) {
      return {
        success: true,
        driverId,
        recorded: false,
        stale: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }
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

    return { success: true, driverId, status, recorded: true };
  }

  async recordIdentityReverificationStarted(driverId, payload = {}) {
    if (!driverId) return { success: false, error: 'driverId e obrigatorio' };
    const requirement = payload.requirement || payload.payload?.requirement;
    const challengeId = payload.challengeId || payload.payload?.challengeId || null;
    if (requirement !== IDENTITY_REVERIFY_REQUIREMENT && !challengeId) {
      return { success: true, recorded: false };
    }
    if (!challengeId) {
      return {
        success: true,
        recorded: false,
        stale: true,
        code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
      };
    }

    const nowIso = new Date().toISOString();
    const realtimeResult = await this.transactCurrentIdentityReverification(
      driverId,
      challengeId,
      (currentUser, currentState) => {
        const notificationSentAtMs = toMillis(currentState.notificationSentAt);
        return {
          ...currentUser,
          identityReverification: {
            ...currentState,
            validationStartedAt: nowIso,
            metrics: {
              ...(currentState.metrics || {}),
              notificationToValidationStartedSeconds: notificationSentAtMs
                ? Math.max(0, Math.round((Date.now() - notificationSentAtMs) / 1000))
                : null
            }
          },
          kycUpdatedAt: nowIso
        };
      }
    );
    if (!realtimeResult.committed) {
      return { success: true, driverId, recorded: false, ...realtimeResult };
    }
    const redisCommitted = await this.persistCurrentIdentityRedis(driverId, challengeId, {
      identity_reverification_validation_started_at: nowIso
    });
    if (!redisCommitted) {
      const latestIdentityState = await this.readRealtimeStrict(
        `users/${driverId}/identityReverification`
      );
      if (
        String(latestIdentityState?.challengeId || '') !== String(challengeId)
      ) {
        return {
          success: true,
          driverId,
          recorded: false,
          stale: true,
          code: 'KYC_IDENTITY_REVERIFY_CHALLENGE_STALE'
        };
      }
      const redisRetryCommitted = await this.persistCurrentIdentityRedis(
        driverId,
        challengeId,
        { identity_reverification_validation_started_at: nowIso }
      );
      if (redisRetryCommitted) {
        return { success: true, driverId, recorded: true };
      }
      const error = new Error('Redis nao confirmou o challenge KYC atual');
      error.code = 'KYC_REVERIFY_STATE_UNAVAILABLE';
      throw error;
    }

    return { success: true, driverId, recorded: true };
  }
}

module.exports = new KYCPolicyService();

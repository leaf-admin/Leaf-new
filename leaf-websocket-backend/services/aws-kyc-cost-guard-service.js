const crypto = require('crypto');
const { logError } = require('../utils/logger');

const PERIOD_COLLECTION = 'kyc_aws_cost_guard_periods';
const OPERATION_COLLECTION = 'kyc_aws_cost_guard_operations';
const COMPARE_PROVIDER_INPUT_FAILURE_CODES = new Set([
  'AWS_COMPARE_FACES_INVALID_PARAMETER',
  'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
  'AWS_COMPARE_FACES_LIVENESS_FACE_NOT_DETECTED'
]);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function readBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function usdToMicros(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 1_000_000);
}

function createError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

class AwsKycCostGuardService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.firestoreProvider = options.firestoreProvider || (() => (
      require('../firebase-config').getFirestore()
    ));
    this.now = options.now || (() => new Date());
    this.enabled = options.enabled ?? readBoolean(this.env.KYC_AWS_COST_GUARD_ENABLED, false);
    this.timeZone = String(this.env.KYC_AWS_COST_TIME_ZONE || 'UTC').trim().toUpperCase();
    this.dailyLimitMicros = usdToMicros(this.env.KYC_AWS_COST_DAILY_LIMIT_USD);
    this.monthlyLimitMicros = usdToMicros(this.env.KYC_AWS_COST_MONTHLY_LIMIT_USD);
    this.livenessCostMicros = usdToMicros(
      this.env.KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD || '0.015'
    );
    this.compareCostMicros = usdToMicros(
      this.env.KYC_AWS_COMPARE_FACES_ESTIMATED_UNIT_COST_USD || '0.001'
    );
    const compareAttempts = Number.parseInt(
      this.env.KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS || '2',
      10
    );
    this.compareMaxAttempts = Number.isFinite(compareAttempts)
      ? Math.min(5, Math.max(1, compareAttempts))
      : 2;
    const retentionDays = Number.parseInt(
      this.env.KYC_AWS_COST_OPERATION_RETENTION_DAYS || '35',
      10
    );
    this.operationRetentionDays = Number.isFinite(retentionDays)
      ? Math.min(400, Math.max(1, retentionDays))
      : 35;
  }

  isEnabled() {
    return this.enabled === true;
  }

  getBundleCostMicros() {
    if (!this.livenessCostMicros || !this.compareCostMicros) return null;
    return this.livenessCostMicros + (this.compareCostMicros * this.compareMaxAttempts);
  }

  getConfigSummary() {
    return {
      enabled: this.isEnabled(),
      timeZone: this.timeZone,
      dailyLimitConfigured: Number.isInteger(this.dailyLimitMicros),
      monthlyLimitConfigured: Number.isInteger(this.monthlyLimitMicros),
      dailyLimitUsd: this.dailyLimitMicros == null ? null : this.dailyLimitMicros / 1_000_000,
      monthlyLimitUsd: this.monthlyLimitMicros == null ? null : this.monthlyLimitMicros / 1_000_000,
      bundleEstimatedCostUsd: this.getBundleCostMicros() == null
        ? null
        : this.getBundleCostMicros() / 1_000_000,
      compareMaxAttempts: this.compareMaxAttempts,
      operationRetentionDays: this.operationRetentionDays
    };
  }

  expiresAt(date, days) {
    return new Date(date.getTime() + (days * 24 * 60 * 60 * 1000));
  }

  assertReady({ required = false } = {}) {
    if (!this.isEnabled()) {
      if (!required) return false;
      throw createError(
        'Circuit breaker agregado de custo AWS KYC nao esta habilitado',
        'KYC_AWS_COST_GUARD_REQUIRED'
      );
    }
    if (
      this.timeZone !== 'UTC'
      || !Number.isInteger(this.dailyLimitMicros)
      || !Number.isInteger(this.monthlyLimitMicros)
      || this.dailyLimitMicros > this.monthlyLimitMicros
      || !Number.isInteger(this.getBundleCostMicros())
    ) {
      throw createError(
        'Configuracao do circuit breaker de custo AWS KYC e invalida',
        'KYC_AWS_COST_GUARD_CONFIG_INVALID'
      );
    }
    const firestore = this.firestoreProvider();
    if (!firestore || typeof firestore.runTransaction !== 'function') {
      throw createError(
        'Firestore indisponivel para o circuit breaker de custo AWS KYC',
        'KYC_AWS_COST_GUARD_UNAVAILABLE'
      );
    }
    return firestore;
  }

  getPeriodKeys(date = this.now()) {
    const iso = date.toISOString();
    return {
      day: iso.slice(0, 10),
      month: iso.slice(0, 7)
    };
  }

  nextUtcDay(date = this.now()) {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + 1
    )).toISOString();
  }

  nextUtcMonth(date = this.now()) {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1
    )).toISOString();
  }

  operationRef(firestore, operationId) {
    return firestore.collection(OPERATION_COLLECTION).doc(sha256(operationId));
  }

  periodRef(firestore, type, key) {
    return firestore.collection(PERIOD_COLLECTION).doc(`${type}_${key}`);
  }

  async reserveLivenessBundle({ userId, operationId, required = false } = {}) {
    const firestore = this.assertReady({ required });
    if (!firestore) return null;
    const safeUserId = String(userId || '').trim();
    const safeOperationId = String(operationId || '').trim();
    if (!safeUserId || !safeOperationId) {
      throw createError(
        'Usuario e operacao sao obrigatorios para reservar custo AWS KYC',
        'KYC_AWS_COST_OPERATION_INVALID'
      );
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const { day, month } = this.getPeriodKeys(now);
    const bundleCostMicros = this.getBundleCostMicros();
    const operationRef = this.operationRef(firestore, safeOperationId);
    const dayRef = this.periodRef(firestore, 'day', day);
    const monthRef = this.periodRef(firestore, 'month', month);
    const userIdHash = sha256(safeUserId);

    try {
      const operation = await firestore.runTransaction(async (transaction) => {
        const operationSnapshot = await transaction.get(operationRef);
        if (operationSnapshot.exists) {
          const existing = operationSnapshot.data() || {};
          if (
            existing.kind !== 'liveness_compare_bundle'
            || existing.userIdHash !== userIdHash
            || existing.day !== day
            || existing.month !== month
            || Number(existing.bundleCostMicros) !== bundleCostMicros
          ) {
            throw createError(
              'Operacao de custo AWS KYC diverge da reserva original',
              'KYC_AWS_COST_OPERATION_MISMATCH'
            );
          }
          return existing;
        }

        const [daySnapshot, monthSnapshot] = await Promise.all([
          transaction.get(dayRef),
          transaction.get(monthRef)
        ]);
        const dayState = daySnapshot.exists ? (daySnapshot.data() || {}) : {};
        const monthState = monthSnapshot.exists ? (monthSnapshot.data() || {}) : {};
        const nextDaySpent = Number(dayState.spentMicros || 0) + bundleCostMicros;
        const nextMonthSpent = Number(monthState.spentMicros || 0) + bundleCostMicros;
        if (nextDaySpent > this.dailyLimitMicros || nextMonthSpent > this.monthlyLimitMicros) {
          const dailyExhausted = nextDaySpent > this.dailyLimitMicros;
          throw createError(
            'Orcamento agregado AWS KYC atingido',
            'KYC_AWS_COST_BUDGET_EXHAUSTED',
            { retryAt: dailyExhausted ? this.nextUtcDay(now) : this.nextUtcMonth(now) }
          );
        }

        transaction.set(dayRef, {
          periodType: 'day',
          periodKey: day,
          spentMicros: nextDaySpent,
          operationCount: Number(dayState.operationCount || 0) + 1,
          updatedAt: nowIso,
          expiresAt: this.expiresAt(now, 400)
        }, { merge: false });
        transaction.set(monthRef, {
          periodType: 'month',
          periodKey: month,
          spentMicros: nextMonthSpent,
          operationCount: Number(monthState.operationCount || 0) + 1,
          updatedAt: nowIso,
          expiresAt: this.expiresAt(now, 400)
        }, { merge: false });

        const created = {
          kind: 'liveness_compare_bundle',
          userIdHash,
          day,
          month,
          bundleCostMicros,
          livenessCostMicros: this.livenessCostMicros,
          compareCostMicros: this.compareCostMicros * this.compareMaxAttempts,
          livenessStatus: 'reserved',
          compareStatus: 'reserved',
          createdAt: nowIso,
          updatedAt: nowIso,
          expiresAt: this.expiresAt(now, this.operationRetentionDays)
        };
        transaction.set(operationRef, created, { merge: false });
        return created;
      });

      return {
        operationId: safeOperationId,
        status: operation.livenessStatus,
        bundleEstimatedCostUsd: bundleCostMicros / 1_000_000
      };
    } catch (error) {
      logError(error, 'Falha ao reservar orcamento agregado AWS KYC', {
        service: 'aws-kyc-cost-guard-service',
        userId: safeUserId,
        code: error?.code || null
      });
      if (error?.code) throw error;
      throw createError(
        'Falha no circuit breaker de custo AWS KYC',
        'KYC_AWS_COST_GUARD_UNAVAILABLE',
        { cause: error }
      );
    }
  }

  async rollbackBeforeDispatch(operationId) {
    if (!this.isEnabled()) return false;
    const firestore = this.assertReady({ required: true });
    const safeOperationId = String(operationId || '').trim();
    if (!safeOperationId) return false;
    const operationRef = this.operationRef(firestore, safeOperationId);

    try {
      return await firestore.runTransaction(async (transaction) => {
        const operationSnapshot = await transaction.get(operationRef);
        if (!operationSnapshot.exists) return false;
        const operation = operationSnapshot.data() || {};
        if (operation.livenessStatus !== 'reserved') return false;
        const dayRef = this.periodRef(firestore, 'day', operation.day);
        const monthRef = this.periodRef(firestore, 'month', operation.month);
        const [daySnapshot, monthSnapshot] = await Promise.all([
          transaction.get(dayRef),
          transaction.get(monthRef)
        ]);
        const cost = Number(operation.bundleCostMicros || 0);
        for (const [ref, snapshot] of [[dayRef, daySnapshot], [monthRef, monthSnapshot]]) {
          if (!snapshot.exists) continue;
          const state = snapshot.data() || {};
          transaction.set(ref, {
            ...state,
            spentMicros: Math.max(0, Number(state.spentMicros || 0) - cost),
            operationCount: Math.max(0, Number(state.operationCount || 0) - 1),
            updatedAt: this.now().toISOString()
          }, { merge: false });
        }
        transaction.delete(operationRef);
        return true;
      });
    } catch (error) {
      logError(error, 'Falha ao reverter reserva nao despachada AWS KYC', {
        service: 'aws-kyc-cost-guard-service'
      });
      return false;
    }
  }

  async updateOperation(operationId, updater) {
    const firestore = this.assertReady({ required: true });
    const safeOperationId = String(operationId || '').trim();
    if (!safeOperationId) {
      throw createError('Operacao de custo AWS KYC obrigatoria', 'KYC_AWS_COST_OPERATION_NOT_FOUND');
    }
    const operationRef = this.operationRef(firestore, safeOperationId);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(operationRef);
        if (!snapshot.exists) {
          throw createError('Reserva de custo AWS KYC nao encontrada', 'KYC_AWS_COST_OPERATION_NOT_FOUND');
        }
        const current = snapshot.data() || {};
        const outcome = updater(current);
        if (outcome?.next) {
          transaction.set(operationRef, outcome.next, { merge: false });
        }
        return outcome?.result;
      });
    } catch (error) {
      if (error?.code) throw error;
      throw createError(
        'Falha ao atualizar circuit breaker de custo AWS KYC',
        'KYC_AWS_COST_GUARD_UNAVAILABLE',
        { cause: error }
      );
    }
  }

  async markLivenessDispatched(operationId) {
    if (!this.isEnabled()) return null;
    return this.updateOperation(operationId, (current) => {
      if (['dispatched', 'completed'].includes(current.livenessStatus)) {
        return { result: current };
      }
      if (current.livenessStatus !== 'reserved') {
        throw createError('Estado de custo liveness invalido', 'KYC_AWS_COST_OPERATION_STATE_INVALID');
      }
      const next = {
        ...current,
        livenessStatus: 'dispatched',
        livenessDispatchedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString()
      };
      return { next, result: next };
    });
  }

  async markLivenessCompleted(operationId, sessionId) {
    if (!this.isEnabled()) return null;
    return this.updateOperation(operationId, (current) => {
      if (current.livenessStatus === 'completed') return { result: current };
      if (current.livenessStatus !== 'dispatched') {
        throw createError('Liveness nao foi despachado no guard de custo', 'KYC_AWS_COST_OPERATION_STATE_INVALID');
      }
      const next = {
        ...current,
        livenessStatus: 'completed',
        livenessSessionIdHash: sha256(sessionId),
        livenessCompletedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString()
      };
      return { next, result: next };
    });
  }

  async claimCompareDispatch(operationId, compareFingerprint) {
    if (!this.isEnabled()) return { claimed: true, unguarded: true };
    const fingerprintHash = sha256(compareFingerprint);
    return this.updateOperation(operationId, (current) => {
      if (current.livenessStatus !== 'completed') {
        throw createError('Liveness nao concluido no guard de custo', 'KYC_AWS_COST_OPERATION_STATE_INVALID');
      }
      if (current.compareFingerprintHash && current.compareFingerprintHash !== fingerprintHash) {
        throw createError('Comparacao diverge da reserva original', 'KYC_AWS_COST_OPERATION_MISMATCH');
      }
      if (current.compareStatus === 'completed' && current.compareResult) {
        return { result: { claimed: false, replay: true, result: current.compareResult } };
      }
      if (current.compareStatus === 'dispatched') {
        throw createError(
          'Resultado anterior do AWS CompareFaces e desconhecido; repeticao automatica bloqueada',
          'KYC_AWS_COMPARE_OUTCOME_UNKNOWN'
        );
      }
      if (current.compareStatus !== 'reserved') {
        throw createError('Estado de custo CompareFaces invalido', 'KYC_AWS_COST_OPERATION_STATE_INVALID');
      }
      const next = {
        ...current,
        compareStatus: 'dispatched',
        compareFingerprintHash: fingerprintHash,
        compareDispatchedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString()
      };
      return { next, result: { claimed: true, replay: false } };
    });
  }

  async markCompareProviderInputFailed(operationId, compareFingerprint, failure = {}) {
    if (!this.isEnabled()) return null;
    const fingerprintHash = sha256(compareFingerprint);
    const failureCode = String(failure.code || '').trim();
    const providerCode = String(failure.providerCode || '').trim();

    if (
      !COMPARE_PROVIDER_INPUT_FAILURE_CODES.has(failureCode)
      || providerCode !== 'InvalidParameterException'
    ) {
      throw createError(
        'Falha CompareFaces nao qualifica como rejeicao de entrada do provider',
        'KYC_AWS_COMPARE_PROVIDER_INPUT_FAILURE_INVALID'
      );
    }

    return this.updateOperation(operationId, (current) => {
      if (
        current.compareStatus === 'failed_provider_input'
        && current.compareFingerprintHash === fingerprintHash
        && current.compareFailure?.code === failureCode
        && current.compareFailure?.providerCode === providerCode
      ) {
        return { result: current };
      }
      if (
        current.compareStatus !== 'dispatched'
        || current.compareFingerprintHash !== fingerprintHash
        || current.compareResult
      ) {
        throw createError(
          'Dispatch CompareFaces nao corresponde a falha do provider',
          'KYC_AWS_COST_OPERATION_STATE_INVALID'
        );
      }

      const failedAt = this.now().toISOString();
      const next = {
        ...current,
        compareStatus: 'failed_provider_input',
        compareFailure: {
          code: failureCode,
          providerCode,
          retryable: false,
          failedAt
        },
        compareFailedAt: failedAt,
        updatedAt: failedAt
      };
      return { next, result: next };
    });
  }

  async completeCompare(operationId, compareFingerprint, result) {
    if (!this.isEnabled()) return result;
    const fingerprintHash = sha256(compareFingerprint);
    return this.updateOperation(operationId, (current) => {
      if (
        current.compareStatus === 'completed'
        && current.compareFingerprintHash === fingerprintHash
        && current.compareResult
      ) {
        return { result: current.compareResult };
      }
      if (
        current.compareStatus !== 'dispatched'
        || current.compareFingerprintHash !== fingerprintHash
      ) {
        throw createError('Dispatch CompareFaces nao corresponde ao resultado', 'KYC_AWS_COST_OPERATION_STATE_INVALID');
      }
      const compareResult = JSON.parse(JSON.stringify(result));
      const next = {
        ...current,
        compareStatus: 'completed',
        compareResult,
        compareCompletedAt: this.now().toISOString(),
        updatedAt: this.now().toISOString()
      };
      return { next, result: compareResult };
    });
  }
}

const singleton = new AwsKycCostGuardService();

module.exports = singleton;
module.exports.AwsKycCostGuardService = AwsKycCostGuardService;
module.exports.createError = createError;

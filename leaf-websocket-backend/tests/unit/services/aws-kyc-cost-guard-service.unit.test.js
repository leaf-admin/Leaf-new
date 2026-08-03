jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

const crypto = require('crypto');
const {
  AwsKycCostGuardService
} = require('../../../services/aws-kyc-cost-guard-service');

function createFakeFirestore() {
  const values = new Map();
  const firestore = {
    collection(name) {
      return {
        doc(id) {
          return { path: `${name}/${id}` };
        }
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const value = values.get(ref.path);
          return {
            exists: value !== undefined,
            data: () => value == null ? value : JSON.parse(JSON.stringify(value))
          };
        },
        set(ref, value) {
          writes.push({ type: 'set', path: ref.path, value: JSON.parse(JSON.stringify(value)) });
        },
        delete(ref) {
          writes.push({ type: 'delete', path: ref.path });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) {
        if (write.type === 'delete') values.delete(write.path);
        else values.set(write.path, write.value);
      }
      return result;
    }
  };
  return { firestore, values };
}

function createFakeBudgetAuthority() {
  const state = {
    days: new Map(),
    months: new Map(),
    userDays: new Map(),
    operations: new Map()
  };
  const authority = {
    getConfigSummary: jest.fn(() => ({
      authority: 'redis_lua_v1',
      firestoreRole: 'durable_operation_audit'
    })),
    assertReady: jest.fn(() => true),
    reserve: jest.fn(async (input) => {
      const existing = state.operations.get(input.operationIdHash);
      if (existing) {
        const mismatch = existing.userIdHash !== input.userIdHash
          || existing.day !== input.day
          || existing.month !== input.month
          || existing.bundleCostMicros !== input.bundleCostMicros;
        if (mismatch) return { status: 'operation_mismatch' };
        return {
          status: 'reserved',
          replay: true,
          daySpentMicros: state.days.get(input.day)?.spentMicros || 0,
          monthSpentMicros: state.months.get(input.month)?.spentMicros || 0,
          userDayOperationCount:
            state.userDays.get(`${input.day}:${input.userIdHash}`)?.operationCount || 0
        };
      }
      if (input.seed) {
        if (!state.days.has(input.day)) {
          state.days.set(input.day, {
            spentMicros: input.seed.daySpentMicros,
            operationCount: input.seed.dayOperationCount
          });
        }
        if (!state.months.has(input.month)) {
          state.months.set(input.month, {
            spentMicros: input.seed.monthSpentMicros,
            operationCount: input.seed.monthOperationCount
          });
        }
        const seedUserDayKey = `${input.day}:${input.userIdHash}`;
        if (!state.userDays.has(seedUserDayKey)) {
          state.userDays.set(seedUserDayKey, {
            spentMicros: input.seed.userDaySpentMicros,
            operationCount: input.seed.userDayOperationCount
          });
        }
      }
      const day = state.days.get(input.day) || { spentMicros: 0, operationCount: 0 };
      const month = state.months.get(input.month) || { spentMicros: 0, operationCount: 0 };
      const userDayKey = `${input.day}:${input.userIdHash}`;
      const userDay = state.userDays.get(userDayKey) || {
        spentMicros: 0,
        operationCount: 0
      };
      if (userDay.operationCount + 1 > input.perUserDailySessionLimit) {
        return { status: 'user_day_exhausted' };
      }
      if (day.spentMicros + input.bundleCostMicros > input.dailyLimitMicros) {
        return { status: 'daily_budget_exhausted' };
      }
      if (month.spentMicros + input.bundleCostMicros > input.monthlyLimitMicros) {
        return { status: 'monthly_budget_exhausted' };
      }
      const nextDay = {
        spentMicros: day.spentMicros + input.bundleCostMicros,
        operationCount: day.operationCount + 1
      };
      const nextMonth = {
        spentMicros: month.spentMicros + input.bundleCostMicros,
        operationCount: month.operationCount + 1
      };
      const nextUserDay = {
        spentMicros: userDay.spentMicros + input.bundleCostMicros,
        operationCount: userDay.operationCount + 1
      };
      state.days.set(input.day, nextDay);
      state.months.set(input.month, nextMonth);
      state.userDays.set(userDayKey, nextUserDay);
      state.operations.set(input.operationIdHash, { ...input, status: 'reserved' });
      return {
        status: 'reserved',
        replay: false,
        daySpentMicros: nextDay.spentMicros,
        monthSpentMicros: nextMonth.spentMicros,
        userDayOperationCount: nextUserDay.operationCount
      };
    }),
    markDispatched: jest.fn(async (input) => {
      const operation = state.operations.get(input.operationIdHash);
      if (!operation) return { status: 'missing' };
      if (operation.status === 'dispatched') return { status: 'dispatched', replay: true };
      if (operation.status !== 'reserved') return { status: operation.status };
      operation.status = 'dispatched';
      return { status: 'dispatched', replay: false };
    }),
    rollback: jest.fn(async (input) => {
      const operation = state.operations.get(input.operationIdHash);
      if (!operation) return { status: 'missing' };
      if (operation.status !== 'reserved') return { status: operation.status };
      const day = state.days.get(input.day);
      const month = state.months.get(input.month);
      const userDay = state.userDays.get(`${input.day}:${input.userIdHash}`);
      for (const counter of [day, month, userDay]) {
        counter.spentMicros -= input.bundleCostMicros;
        counter.operationCount -= 1;
      }
      state.operations.delete(input.operationIdHash);
      return { status: 'rolled_back' };
    }),
    finalizeDispatch: jest.fn(async (input) => {
      const operation = state.operations.get(input.operationIdHash);
      if (!operation) return { status: 'missing' };
      if (operation.status !== 'dispatched') return { status: operation.status };
      state.operations.delete(input.operationIdHash);
      return { status: 'finalized' };
    })
  };
  return { authority, state };
}

function createService(overrides = {}) {
  const { firestore, values } = createFakeFirestore();
  const { authority, state: budgetState } = createFakeBudgetAuthority();
  const env = {
    KYC_AWS_COST_GUARD_ENABLED: 'true',
    KYC_AWS_COST_DAILY_LIMIT_USD: '0.034',
    KYC_AWS_COST_MONTHLY_LIMIT_USD: '0.10',
    KYC_AWS_COST_TIME_ZONE: 'UTC',
    KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD: '0.015',
    KYC_AWS_COMPARE_FACES_ESTIMATED_UNIT_COST_USD: '0.001',
    KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS: '2',
    ...overrides
  };
  const service = new AwsKycCostGuardService({
    env,
    firestoreProvider: () => firestore,
    budgetAuthority: authority,
    now: () => new Date('2026-07-13T20:00:00.000Z')
  });
  return { service, values, budgetAuthority: authority, budgetState };
}

describe('aws-kyc-cost-guard-service', () => {
  test('reserves the liveness plus worst-case compare bundle once', async () => {
    const { service, values, budgetState } = createService();

    const first = await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-1',
      required: true
    });
    const replay = await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-1',
      required: true
    });

    expect(first.bundleEstimatedCostUsd).toBe(0.017);
    expect(replay.bundleEstimatedCostUsd).toBe(0.017);
    expect(budgetState.days.get('2026-07-13')).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    expect(budgetState.months.get('2026-07')).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    const userDay = Array.from(budgetState.userDays.values())[0];
    expect(userDay).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    const operation = Array.from(values.entries())
      .find(([path]) => path.startsWith('kyc_aws_cost_guard_operations/'))?.[1];
    expect(operation).toMatchObject({
      budgetAuthority: 'redis_lua_v1',
      budgetReservation: {
        daySpentMicros: 17000,
        monthSpentMicros: 17000,
        userDayOperationCount: 1
      }
    });
    expect(operation.expiresAt).toBeTruthy();
    expect(Array.from(values.keys()).some((path) => (
      path.startsWith('kyc_aws_cost_guard_periods/')
    ))).toBe(false);
  });

  test('bootstraps Redis from the current legacy Firestore counters without resetting spend', async () => {
    const { firestore, values } = createFakeFirestore();
    const { authority, state } = createFakeBudgetAuthority();
    const originalReserve = authority.reserve.getMockImplementation();
    authority.reserve
      .mockReset()
      .mockResolvedValueOnce({ status: 'initialization_required' })
      .mockImplementation(originalReserve);
    const userId = 'driver-migration';
    const userIdHash = crypto.createHash('sha256').update(userId).digest('hex');
    values.set('kyc_aws_cost_guard_periods/day_2026-07-13', {
      spentMicros: 34_000,
      operationCount: 2
    });
    values.set('kyc_aws_cost_guard_periods/month_2026-07', {
      spentMicros: 51_000,
      operationCount: 3
    });
    values.set(`kyc_aws_cost_guard_periods/user_day_2026-07-13_${userIdHash}`, {
      spentMicros: 17_000,
      operationCount: 1
    });
    const service = new AwsKycCostGuardService({
      env: {
        KYC_AWS_COST_GUARD_ENABLED: 'true',
        KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
        KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
        KYC_AWS_COST_TIME_ZONE: 'UTC',
        KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD: '0.015',
        KYC_AWS_COMPARE_FACES_ESTIMATED_UNIT_COST_USD: '0.001',
        KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS: '2'
      },
      firestoreProvider: () => firestore,
      budgetAuthority: authority,
      now: () => new Date('2026-07-13T20:00:00.000Z')
    });

    await service.reserveLivenessBundle({
      userId,
      operationId: 'operation-after-migration',
      required: true
    });

    expect(authority.reserve).toHaveBeenCalledTimes(2);
    expect(authority.reserve.mock.calls[1][0].seed).toEqual({
      daySpentMicros: 34_000,
      dayOperationCount: 2,
      monthSpentMicros: 51_000,
      monthOperationCount: 3,
      userDaySpentMicros: 17_000,
      userDayOperationCount: 1
    });
    expect(state.days.get('2026-07-13')).toEqual({
      spentMicros: 51_000,
      operationCount: 3
    });
    expect(state.months.get('2026-07')).toEqual({
      spentMicros: 68_000,
      operationCount: 4
    });
    expect(state.userDays.get(`2026-07-13:${userIdHash}`)).toEqual({
      spentMicros: 34_000,
      operationCount: 2
    });
    expect(values.get('kyc_aws_cost_guard_periods/day_2026-07-13')).toEqual({
      spentMicros: 34_000,
      operationCount: 2
    });
    expect(Array.from(values.keys()).filter((path) => (
      path.startsWith('kyc_aws_cost_guard_operations/')
    ))).toHaveLength(1);
  });

  test('blocks a new paid bundle before AWS when the daily budget is exhausted', async () => {
    const { service } = createService({
      KYC_AWS_COST_DAILY_LIMIT_USD: '0.017'
    });
    await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-1',
      required: true
    });

    await expect(service.reserveLivenessBundle({
      userId: 'driver-2',
      operationId: 'operation-2',
      required: true
    })).rejects.toMatchObject({
      code: 'KYC_AWS_COST_BUDGET_EXHAUSTED',
      retryAt: '2026-07-14T00:00:00.000Z'
    });
  });

  test('reserves 1000 simultaneous drivers without a shared Firestore period document', async () => {
    const { service, values, budgetState } = createService({
      KYC_AWS_COST_DAILY_LIMIT_USD: '17.00',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '20.00'
    });

    const results = await Promise.allSettled(Array.from({ length: 1000 }, (_, index) => (
      service.reserveLivenessBundle({
        userId: `driver-burst-${index}`,
        operationId: `operation-burst-${index}`,
        required: true
      })
    )));

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(budgetState.days.get('2026-07-13')).toEqual({
      spentMicros: 17_000_000,
      operationCount: 1000
    });
    expect(Array.from(values.keys()).filter((path) => (
      path.startsWith('kyc_aws_cost_guard_operations/')
    ))).toHaveLength(1000);
    expect(Array.from(values.keys()).some((path) => (
      path.startsWith('kyc_aws_cost_guard_periods/')
    ))).toBe(false);
  });

  test('blocks one abusive account at a durable daily cap without consuming the global budget', async () => {
    const { service, budgetState } = createService({
      KYC_AWS_COST_DAILY_LIMIT_USD: '1.00',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '2.00',
      KYC_AWS_COST_PER_USER_DAILY_SESSION_LIMIT: '2'
    });
    await service.reserveLivenessBundle({
      userId: 'driver-abusive',
      operationId: 'operation-user-1',
      required: true
    });
    await service.reserveLivenessBundle({
      userId: 'driver-abusive',
      operationId: 'operation-user-2',
      required: true
    });

    await expect(service.reserveLivenessBundle({
      userId: 'driver-abusive',
      operationId: 'operation-user-3',
      required: true
    })).rejects.toMatchObject({
      code: 'KYC_AWS_USER_DAILY_SESSION_LIMIT_EXHAUSTED',
      retryAt: '2026-07-14T00:00:00.000Z'
    });

    await expect(service.reserveLivenessBundle({
      userId: 'driver-other',
      operationId: 'operation-other-1',
      required: true
    })).resolves.toMatchObject({ status: 'reserved' });
    expect(budgetState.days.get('2026-07-13')).toMatchObject({
      spentMicros: 51000,
      operationCount: 3
    });
  });

  test('rolls back only an operation that never reached provider dispatch', async () => {
    const { service, values, budgetState } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-rollback',
      required: true
    });

    await expect(service.rollbackBeforeDispatch('operation-rollback')).resolves.toBe(true);
    expect(budgetState.days.get('2026-07-13')).toMatchObject({
      spentMicros: 0,
      operationCount: 0
    });
    const userDay = Array.from(budgetState.userDays.values())[0];
    expect(userDay).toMatchObject({
      spentMicros: 0,
      operationCount: 0
    });
    const operation = Array.from(values.values())
      .find((value) => value.kind === 'liveness_compare_bundle');
    expect(operation).toMatchObject({
      livenessStatus: 'rolled_back',
      compareStatus: 'rolled_back'
    });
  });

  test('compensates Redis when the durable Firestore audit cannot be created', async () => {
    const { firestore } = createFakeFirestore();
    const { authority, state } = createFakeBudgetAuthority();
    const originalRunTransaction = firestore.runTransaction.bind(firestore);
    let transactionCount = 0;
    firestore.runTransaction = async (callback) => {
      transactionCount += 1;
      if (transactionCount === 2) throw new Error('firestore unavailable');
      return originalRunTransaction(callback);
    };
    const service = new AwsKycCostGuardService({
      env: {
        KYC_AWS_COST_GUARD_ENABLED: 'true',
        KYC_AWS_COST_DAILY_LIMIT_USD: '2.50',
        KYC_AWS_COST_MONTHLY_LIMIT_USD: '50.00',
        KYC_AWS_COST_TIME_ZONE: 'UTC',
        KYC_AWS_LIVENESS_ESTIMATED_UNIT_COST_USD: '0.015',
        KYC_AWS_COMPARE_FACES_ESTIMATED_UNIT_COST_USD: '0.001',
        KYC_AWS_COMPARE_FACES_SDK_MAX_ATTEMPTS: '2'
      },
      firestoreProvider: () => firestore,
      budgetAuthority: authority,
      now: () => new Date('2026-07-13T20:00:00.000Z')
    });

    await expect(service.reserveLivenessBundle({
      userId: 'driver-audit-failure',
      operationId: 'operation-audit-failure',
      required: true
    })).rejects.toMatchObject({ code: 'KYC_AWS_COST_GUARD_UNAVAILABLE' });

    expect(authority.rollback).toHaveBeenCalledTimes(1);
    expect(state.days.get('2026-07-13')).toEqual({
      spentMicros: 0,
      operationCount: 0
    });
  });

  test('prevents rollback after the Redis dispatch CAS wins a race', async () => {
    const { service, budgetAuthority, budgetState, values } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-dispatch-race',
      operationId: 'operation-dispatch-race',
      required: true
    });
    const budgetInput = budgetAuthority.reserve.mock.calls[0][0];
    await budgetAuthority.markDispatched(budgetInput);

    await expect(service.rollbackBeforeDispatch('operation-dispatch-race'))
      .resolves.toBe(false);
    expect(budgetState.days.get('2026-07-13')).toEqual({
      spentMicros: 17000,
      operationCount: 1
    });

    await service.markLivenessDispatched('operation-dispatch-race');
    const operation = Array.from(values.values())
      .find((value) => value.kind === 'liveness_compare_bundle');
    expect(operation.livenessStatus).toBe('dispatched');
  });

  test('caches one CompareFaces outcome and blocks unknown automatic retries', async () => {
    const { service } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-complete',
      required: true
    });
    await service.markLivenessDispatched('operation-complete');
    await service.markLivenessCompleted('operation-complete', 'session-1');
    await expect(service.claimCompareDispatch('operation-complete', 'fingerprint-1'))
      .resolves.toMatchObject({ claimed: true, replay: false });
    await service.completeCompare('operation-complete', 'fingerprint-1', {
      success: true,
      decision: 'approve',
      similarityScore: 0.98
    });
    await expect(service.claimCompareDispatch('operation-complete', 'fingerprint-1'))
      .resolves.toMatchObject({
        claimed: false,
        replay: true,
        result: { decision: 'approve' }
      });

    await service.reserveLivenessBundle({
      userId: 'driver-2',
      operationId: 'operation-unknown',
      required: true
    });
    await service.markLivenessDispatched('operation-unknown');
    await service.markLivenessCompleted('operation-unknown', 'session-2');
    await service.claimCompareDispatch('operation-unknown', 'fingerprint-2');
    await expect(service.claimCompareDispatch('operation-unknown', 'fingerprint-2'))
      .rejects.toMatchObject({ code: 'KYC_AWS_COMPARE_OUTCOME_UNKNOWN' });
  });

  test('authorizes metadata recovery only for the exact completed paid session binding', async () => {
    const { service, values } = createService();
    const recoveryBinding = JSON.stringify([
      'aws_rekognition_face_liveness',
      'driver-recovery',
      'sandbox',
      'ctx_sandbox_recovery'
    ]);
    await service.reserveLivenessBundle({
      userId: 'driver-recovery',
      operationId: 'operation-recovery',
      required: true
    });
    await service.markLivenessDispatched('operation-recovery');
    await service.markLivenessCompleted('operation-recovery', 'session-recovery', {
      recoveryBinding,
      recoveryExpiresAt: '2026-07-13T20:03:00.000Z'
    });
    const operationPath = Array.from(values.keys())
      .find((path) => path.startsWith('kyc_aws_cost_guard_operations/'));
    const recoveryOperation = values.get(operationPath);
    expect(recoveryOperation.livenessRecoverySession).toMatchObject({
      version: 1,
      algorithm: 'aes-256-gcm'
    });
    expect(JSON.stringify(recoveryOperation)).not.toContain('session-recovery');

    await expect(service.recoverCompletedLivenessSession('operation-recovery', {
      userId: 'driver-recovery',
      recoveryBinding
    })).resolves.toEqual({
      operationId: 'operation-recovery',
      sessionId: 'session-recovery'
    });
    await expect(service.recoverCompletedLivenessSession('operation-recovery', {
      userId: 'driver-recovery',
      recoveryBinding: `${recoveryBinding}:operational`
    })).rejects.toMatchObject({ code: 'KYC_AWS_COST_OPERATION_MISMATCH' });

    await expect(service.assertRecoverableLivenessSession('operation-recovery', {
      userId: 'driver-recovery',
      sessionId: 'session-recovery'
    })).resolves.toMatchObject({
      operationId: 'operation-recovery',
      livenessStatus: 'completed'
    });
    await expect(service.assertRecoverableLivenessSession('operation-recovery', {
      userId: 'driver-other',
      sessionId: 'session-recovery'
    })).rejects.toMatchObject({ code: 'KYC_AWS_COST_OPERATION_MISMATCH' });
    await expect(service.assertRecoverableLivenessSession('operation-recovery', {
      userId: 'driver-recovery',
      sessionId: 'session-other'
    })).rejects.toMatchObject({ code: 'KYC_AWS_COST_OPERATION_MISMATCH' });

    await service.markLivenessMetadataPersisted('operation-recovery', 'session-recovery');
    expect(values.get(operationPath)).toMatchObject({
      livenessRecoverySession: null,
      livenessRecoveryBindingHash: null,
      livenessRecoveryExpiresAt: null
    });
    await expect(service.recoverCompletedLivenessSession('operation-recovery', {
      userId: 'driver-recovery',
      recoveryBinding
    })).rejects.toMatchObject({ code: 'KYC_AWS_COST_OPERATION_MISMATCH' });
  });

  test('records a provider input failure with CAS without deleting dispatch or reserved cost', async () => {
    const { service, budgetState } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-provider-input',
      operationId: 'operation-provider-input',
      required: true
    });
    await service.markLivenessDispatched('operation-provider-input');
    await service.markLivenessCompleted('operation-provider-input', 'session-provider-input');
    await service.claimCompareDispatch('operation-provider-input', 'fingerprint-provider-input');

    const first = await service.markCompareProviderInputFailed(
      'operation-provider-input',
      'fingerprint-provider-input',
      {
        code: 'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
        providerCode: 'InvalidParameterException'
      }
    );
    const replay = await service.markCompareProviderInputFailed(
      'operation-provider-input',
      'fingerprint-provider-input',
      {
        code: 'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
        providerCode: 'InvalidParameterException'
      }
    );

    expect(first).toMatchObject({
      compareStatus: 'failed_provider_input',
      compareFailure: {
        code: 'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
        providerCode: 'InvalidParameterException',
        retryable: false
      }
    });
    expect(replay).toEqual(first);
    expect(first.compareDispatchedAt).toBeTruthy();
    expect(first.compareFingerprintHash).toBeTruthy();
    expect(first).not.toHaveProperty('compareResult');
    expect(budgetState.days.get('2026-07-13')).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    await expect(service.claimCompareDispatch(
      'operation-provider-input',
      'fingerprint-provider-input'
    )).rejects.toMatchObject({
      code: 'KYC_AWS_COST_OPERATION_STATE_INVALID'
    });
  });

  test('refuses to relabel a mismatched dispatch as provider input failure', async () => {
    const { service } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-provider-mismatch',
      operationId: 'operation-provider-mismatch',
      required: true
    });
    await service.markLivenessDispatched('operation-provider-mismatch');
    await service.markLivenessCompleted('operation-provider-mismatch', 'session-provider-mismatch');
    await service.claimCompareDispatch('operation-provider-mismatch', 'fingerprint-original');

    await expect(service.markCompareProviderInputFailed(
      'operation-provider-mismatch',
      'fingerprint-other',
      {
        code: 'AWS_COMPARE_FACES_INVALID_PARAMETER',
        providerCode: 'InvalidParameterException'
      }
    )).rejects.toMatchObject({
      code: 'KYC_AWS_COST_OPERATION_STATE_INVALID'
    });
    await expect(service.markCompareProviderInputFailed(
      'operation-provider-mismatch',
      'fingerprint-original',
      {
        code: 'AWS_COMPARE_FACES_THROTTLED',
        providerCode: 'ThrottlingException'
      }
    )).rejects.toMatchObject({
      code: 'KYC_AWS_COMPARE_PROVIDER_INPUT_FAILURE_INVALID'
    });
  });

  test('fails closed when strict budget configuration is invalid', () => {
    const { service } = createService({
      KYC_AWS_COST_DAILY_LIMIT_USD: '60',
      KYC_AWS_COST_MONTHLY_LIMIT_USD: '50'
    });

    expect(() => service.assertReady({ required: true })).toThrow(
      expect.objectContaining({ code: 'KYC_AWS_COST_GUARD_CONFIG_INVALID' })
    );
  });
});

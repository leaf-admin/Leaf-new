jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

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

function createService(overrides = {}) {
  const { firestore, values } = createFakeFirestore();
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
    now: () => new Date('2026-07-13T20:00:00.000Z')
  });
  return { service, values };
}

describe('aws-kyc-cost-guard-service', () => {
  test('reserves the liveness plus worst-case compare bundle once', async () => {
    const { service, values } = createService();

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
    expect(values.get('kyc_aws_cost_guard_periods/day_2026-07-13')).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    expect(values.get('kyc_aws_cost_guard_periods/month_2026-07')).toMatchObject({
      spentMicros: 17000,
      operationCount: 1
    });
    expect(values.get('kyc_aws_cost_guard_periods/day_2026-07-13').expiresAt).toBeTruthy();
    const operation = Array.from(values.entries())
      .find(([path]) => path.startsWith('kyc_aws_cost_guard_operations/'))?.[1];
    expect(operation.expiresAt).toBeTruthy();
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

  test('rolls back only an operation that never reached provider dispatch', async () => {
    const { service, values } = createService();
    await service.reserveLivenessBundle({
      userId: 'driver-1',
      operationId: 'operation-rollback',
      required: true
    });

    await expect(service.rollbackBeforeDispatch('operation-rollback')).resolves.toBe(true);
    expect(values.get('kyc_aws_cost_guard_periods/day_2026-07-13')).toMatchObject({
      spentMicros: 0,
      operationCount: 0
    });
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
    const { service, values } = createService();
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
    expect(values.get('kyc_aws_cost_guard_periods/day_2026-07-13')).toMatchObject({
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

const {
  AwsKycAdmissionController,
  ADMISSION_KEYS
} = require('../../../services/aws-kyc-admission-controller');

function enabledEnv(overrides = {}) {
  return {
    KYC_AWS_ADMISSION_CONTROL_ENABLED: 'true',
    KYC_AWS_ADMISSION_CREATE_TPS: '20',
    KYC_AWS_ADMISSION_CREATE_BURST: '20',
    KYC_AWS_ADMISSION_RESULT_TPS: '20',
    KYC_AWS_ADMISSION_RESULT_BURST: '20',
    KYC_AWS_ADMISSION_MAX_CONCURRENT_SESSIONS: '70',
    KYC_AWS_ADMISSION_LEASE_TTL_SECONDS: '180',
    KYC_AWS_ADMISSION_MAX_WAIT_MS: '15000',
    KYC_AWS_ADMISSION_RETRY_FLOOR_MS: '40',
    ...overrides
  };
}

describe('aws-kyc-admission-controller', () => {
  test('fails closed when strict production requires a disabled controller', async () => {
    const controller = new AwsKycAdmissionController({ env: {} });

    await expect(controller.acquireCreateLease({
      leaseId: 'operation-1',
      required: true
    })).rejects.toMatchObject({
      code: 'KYC_AWS_ADMISSION_CONTROL_REQUIRED'
    });
  });

  test('bypasses Redis outside strict mode when the controller is disabled', async () => {
    const redis = { eval: jest.fn() };
    const controller = new AwsKycAdmissionController({
      env: {},
      redisProvider: () => redis
    });

    await expect(controller.acquireCreateLease({ leaseId: 'operation-2' })).resolves.toEqual({
      status: 'bypassed',
      enabled: false
    });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  test('atomically acquires an idempotent create lease with quota headroom', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({
        status: 'acquired',
        active: 12,
        remainingTokens: 7,
        leaseExpiresAtMs: 200000,
        idempotent: false
      }))
    };
    const controller = new AwsKycAdmissionController({
      env: enabledEnv(),
      redisProvider: () => redis,
      nowMs: () => 1000
    });

    const result = await controller.acquireCreateLease({
      leaseId: 'operation-3',
      required: true
    });

    expect(result).toMatchObject({ status: 'acquired', active: 12, waitedMs: 0 });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_liveness_admission_create_v1'),
      2,
      ADMISSION_KEYS.createBucket,
      ADMISSION_KEYS.activeLeases,
      '20',
      '20',
      '70',
      '180000',
      'operation-3'
    );
  });

  test('waits only for the bounded admission window and then succeeds', async () => {
    let clockMs = 1000;
    const sleep = jest.fn(async (delayMs) => {
      clockMs += delayMs;
    });
    const redis = {
      eval: jest
        .fn()
        .mockResolvedValueOnce(JSON.stringify({
          status: 'rate_limited',
          retryAfterMs: 50
        }))
        .mockResolvedValueOnce(JSON.stringify({
          status: 'acquired',
          active: 21,
          leaseExpiresAtMs: 181050
        }))
    };
    const controller = new AwsKycAdmissionController({
      env: enabledEnv(),
      redisProvider: () => redis,
      sleep,
      nowMs: () => clockMs
    });

    await expect(controller.acquireCreateLease({
      leaseId: 'operation-4',
      required: true
    })).resolves.toMatchObject({
      status: 'acquired',
      waitedMs: 50
    });
    expect(sleep).toHaveBeenCalledWith(50);
  });

  test('returns a retryable capacity error after the bounded wait expires', async () => {
    let clockMs = 1000;
    const sleep = jest.fn(async (delayMs) => {
      clockMs += delayMs;
    });
    const redis = {
      eval: jest.fn(async () => JSON.stringify({
        status: 'concurrency_limited',
        active: 70,
        retryAfterMs: 20000
      }))
    };
    const controller = new AwsKycAdmissionController({
      env: enabledEnv({ KYC_AWS_ADMISSION_MAX_WAIT_MS: '100' }),
      redisProvider: () => redis,
      sleep,
      nowMs: () => clockMs
    });

    await expect(controller.acquireCreateLease({
      leaseId: 'operation-5',
      required: true
    })).rejects.toMatchObject({
      code: 'KYC_AWS_ADMISSION_CAPACITY_EXHAUSTED',
      operation: 'create',
      reason: 'concurrency_limited',
      retryAfterSeconds: 20
    });
    expect(sleep).toHaveBeenCalledWith(100);
  });

  test('rate limits provider result reads independently from session concurrency', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({
        status: 'acquired',
        remainingTokens: 10
      }))
    };
    const controller = new AwsKycAdmissionController({
      env: enabledEnv(),
      redisProvider: () => redis,
      nowMs: () => 1000
    });

    await controller.acquireResultPermit({ required: true });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_liveness_admission_result_v1'),
      1,
      ADMISSION_KEYS.resultBucket,
      '20',
      '20'
    );
  });

  test('releases a create lease atomically and exposes remaining concurrency', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({ released: true, active: 4 }))
    };
    const controller = new AwsKycAdmissionController({
      env: enabledEnv(),
      redisProvider: () => redis
    });

    await expect(controller.releaseCreateLease('operation-6')).resolves.toEqual({
      released: true,
      active: 4
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_liveness_admission_release_v1'),
      1,
      ADMISSION_KEYS.activeLeases,
      'operation-6'
    );
  });

  test('fails closed when Redis atomic admission is unavailable', async () => {
    const controller = new AwsKycAdmissionController({
      env: enabledEnv(),
      redisProvider: () => null
    });

    await expect(controller.acquireResultPermit({ required: true })).rejects.toMatchObject({
      code: 'KYC_AWS_ADMISSION_CONTROL_UNAVAILABLE'
    });
  });
});

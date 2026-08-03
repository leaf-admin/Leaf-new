jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => null)
}));

const {
  AwsKycCostBudgetAuthority,
  KEY_PREFIX
} = require('../../../services/aws-kyc-cost-budget-authority');

const INPUT = Object.freeze({
  operationIdHash: 'operation-hash',
  userIdHash: 'user-hash',
  day: '2026-08-03',
  month: '2026-08',
  bundleCostMicros: 16000,
  perUserDailySessionLimit: 20,
  operationRetentionSeconds: 3_024_000,
  aggregateRetentionSeconds: 34_560_000
});

describe('aws-kyc-cost-budget-authority', () => {
  test('reserves all budget dimensions in one hash-slot Lua call', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({
        status: 'reserved',
        replay: false,
        daySpentMicros: 16000,
        monthSpentMicros: 16000,
        userDayOperationCount: 1
      }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await expect(authority.reserve(INPUT)).resolves.toMatchObject({
      status: 'reserved',
      replay: false
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_kyc_cost_reserve_v1'),
      5,
      `${KEY_PREFIX}:day:2026-08-03`,
      `${KEY_PREFIX}:month:2026-08`,
      `${KEY_PREFIX}:user_day:2026-08-03:user-hash`,
      `${KEY_PREFIX}:operation:operation-hash`,
      `${KEY_PREFIX}:authority:v1`,
      'operation-hash',
      'user-hash',
      '2026-08-03',
      '2026-08',
      '16000',
      '20',
      '3024000',
      '34560000',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0'
    );
  });

  test.each([
    ['user_day_exhausted'],
    ['initialization_required'],
    ['operation_mismatch']
  ])('preserves the atomic reserve outcome %s for policy mapping', async (status) => {
    const redis = { eval: jest.fn(async () => JSON.stringify({ status })) };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await expect(authority.reserve(INPUT)).resolves.toEqual({ status });
  });

  test('passes the legacy counters only when explicitly bootstrapping the authority', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({ status: 'reserved', replay: false }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await authority.reserve({
      ...INPUT,
      seed: {
        daySpentMicros: 32_000,
        dayOperationCount: 2,
        monthSpentMicros: 48_000,
        monthOperationCount: 3,
        userDaySpentMicros: 16_000,
        userDayOperationCount: 1
      }
    });

    expect(redis.eval.mock.calls[0].slice(-7)).toEqual([
      '1',
      '32000',
      '2',
      '48000',
      '3',
      '16000',
      '1'
    ]);
  });

  test('transitions dispatch and records daily monitoring before the paid provider call', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({ status: 'dispatched', replay: false }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await authority.markDispatched({
      ...INPUT,
      reportDay: '2026-08-03',
      dispatchedAt: '2026-08-03T18:00:00.000Z'
    });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_kyc_cost_mark_dispatched_v1'),
      2,
      `${KEY_PREFIX}:operation:operation-hash`,
      `${KEY_PREFIX}:usage_day:2026-08-03`,
      'operation-hash',
      '2026-08-03',
      '2026-08-03T18:00:00.000Z',
      '34560000'
    );
  });

  test('reads the daily usage for one driver without a global budget lookup', async () => {
    const redis = {
      eval: jest.fn(),
      hgetall: jest.fn(async () => ({ operationCount: '7', spentMicros: '112000' }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await expect(authority.getUserDayUsage(INPUT)).resolves.toEqual({
      exists: true,
      operationCount: 7,
      spentMicros: 112000
    });
    expect(redis.hgetall).toHaveBeenCalledWith(
      `${KEY_PREFIX}:user_day:2026-08-03:user-hash`
    );
  });

  test('rolls back all counters and the reservation in one Lua call', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({ status: 'rolled_back' }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await authority.rollback(INPUT);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_kyc_cost_rollback_v1'),
      4,
      `${KEY_PREFIX}:day:2026-08-03`,
      `${KEY_PREFIX}:month:2026-08`,
      `${KEY_PREFIX}:user_day:2026-08-03:user-hash`,
      `${KEY_PREFIX}:operation:operation-hash`,
      'operation-hash',
      'user-hash',
      '2026-08-03',
      '2026-08',
      '16000'
    );
  });

  test('deletes only a dispatched transient CAS record after durable persistence', async () => {
    const redis = {
      eval: jest.fn(async () => JSON.stringify({ status: 'finalized' }))
    };
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => redis });

    await authority.finalizeDispatch(INPUT);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('leaf_aws_kyc_cost_finalize_dispatch_v1'),
      1,
      `${KEY_PREFIX}:operation:operation-hash`,
      'operation-hash'
    );
  });

  test('fails closed when Redis Lua is unavailable', async () => {
    const authority = new AwsKycCostBudgetAuthority({ redisProvider: () => null });

    await expect(authority.reserve(INPUT)).rejects.toMatchObject({
      code: 'KYC_AWS_COST_GUARD_UNAVAILABLE'
    });
  });
});

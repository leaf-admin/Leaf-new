const RedisLeaderLease = require('../../../utils/redis-leader-lease');

describe('RedisLeaderLease', () => {
  let redis;
  let lease;

  beforeEach(() => {
    redis = {
      set: jest.fn(),
      eval: jest.fn()
    };
    lease = new RedisLeaderLease(redis, {
      key: 'leaf:test:leader',
      ownerId: 'worker-a',
      ttlMs: 15000,
      renewIntervalMs: 5000
    });
  });

  afterEach(async () => {
    if (lease.isHeld()) {
      redis.eval.mockResolvedValueOnce(1);
      await lease.release();
    }
  });

  test('acquires the lease with an expiring NX write', async () => {
    redis.set.mockResolvedValue('OK');

    await expect(lease.acquire()).resolves.toBe(true);

    expect(redis.set).toHaveBeenCalledWith(
      'leaf:test:leader',
      lease.token,
      'PX',
      15000,
      'NX'
    );
    expect(lease.isHeld()).toBe(true);
  });

  test('stays passive when another replica already owns the lease', async () => {
    redis.set.mockResolvedValue(null);

    await expect(lease.acquire()).resolves.toBe(false);

    expect(lease.isHeld()).toBe(false);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  test('renews only the matching token and marks leadership lost on rejection', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValueOnce(0);
    await lease.acquire();

    await expect(lease.renew()).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('PEXPIRE'"),
      1,
      'leaf:test:leader',
      lease.token,
      '15000'
    );
    expect(lease.isHeld()).toBe(false);
  });

  test('fails closed when remote ownership cannot be proved', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockRejectedValueOnce(new Error('redis unavailable'));
    await lease.acquire();

    await expect(lease.assertHeld()).resolves.toBe(false);

    expect(lease.isHeld()).toBe(false);
  });

  test('releases through compare-and-delete without deleting a newer owner', async () => {
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValueOnce(0);
    await lease.acquire();

    await expect(lease.release()).resolves.toBe(false);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('DEL'"),
      1,
      'leaf:test:leader',
      lease.token
    );
    expect(lease.isHeld()).toBe(false);
  });

  test('elects only one replica and hands leadership over after token-safe release', async () => {
    let currentToken = null;
    const sharedRedis = {
      set: jest.fn(async (_key, token) => {
        if (currentToken) return null;
        currentToken = token;
        return 'OK';
      }),
      eval: jest.fn(async (script, _keyCount, _key, token) => {
        if (script.includes("redis.call('DEL'")) {
          if (currentToken !== token) return 0;
          currentToken = null;
          return 1;
        }
        return currentToken === token ? 1 : 0;
      })
    };
    const replicaA = new RedisLeaderLease(sharedRedis, {
      key: 'leaf:test:shared-leader',
      ownerId: 'replica-a'
    });
    const replicaB = new RedisLeaderLease(sharedRedis, {
      key: 'leaf:test:shared-leader',
      ownerId: 'replica-b'
    });

    await expect(replicaA.acquire()).resolves.toBe(true);
    await expect(replicaB.acquire()).resolves.toBe(false);
    await expect(replicaA.release()).resolves.toBe(true);
    await expect(replicaB.acquire()).resolves.toBe(true);

    expect(currentToken).toBe(replicaB.token);
    await replicaB.release();
  });
});

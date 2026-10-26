const BoundedTtlCache = require('../../../utils/bounded-ttl-cache');
jest.mock('../../../utils/redis-pool', () => ({ pool: {
  get: jest.fn(), set: jest.fn(), setex: jest.fn(), mget: jest.fn(), info: jest.fn(),
  keys: jest.fn(() => { throw Error('KEYS is forbidden'); })
} }));
const redis = require('../../../utils/redis-pool').pool;
const cache = require('../../../utils/advanced-cache');

describe('bounded cache resource budgets', () => {
  test('distinct viewports and expired, never-revisited entries stay bounded', () => {
    let now = 0;
    const c = new BoundedTtlCache({ maxEntries: 50, maxBytes: 4096, ttlMs: 10, now: () => now });
    for (let n = 0; n < 10000; n++) {
      c.set(`viewport:${n}`, { points: [n] });
      expect(c.size).toBeLessThanOrEqual(50);
      expect(c.bytes).toBeLessThanOrEqual(4096);
    }
    now = 11;
    expect(c.get('new-never-seen')).toBeNull();
    expect(c.size).toBe(0);
    expect(c.bytes).toBe(0);
    expect(c.set('oversized', 'x'.repeat(5000))).toBe(false);
    expect(c.size).toBe(0);
  });

  test('replacement changes expiry order without retaining old bytes', () => {
    let now = 0;
    const c = new BoundedTtlCache({ ttlMs: 10, now: () => now });
    c.set('a', 'old'); c.set('b', 'other');
    now = 5; c.set('a', 'new');
    now = 11;
    expect(c.get('b')).toBeNull();
    expect(c.get('a')).toBe('new');
  });
});

describe('cache invalidation does not depend on Redis keyspace size', () => {
  beforeEach(() => {
    redis.set.mockResolvedValue('OK');
    redis.mget.mockResolvedValue([null, null, null]);
    redis.info.mockResolvedValue('used_memory:1234\r\n');
  });

  test('type, user, all and supported pattern invalidate with one version write each', async () => {
    for (const invalidate of [() => cache.invalidate('users'), () => cache.invalidateUserContext('driver1'),
      () => cache.clearAll(), () => cache.invalidatePattern('graphql:*:users:*')]) {
      const count = redis.set.mock.calls.length;
      expect(await invalidate()).toMatchObject({ invalidated: true, deletedKeys: 0 });
      expect(redis.set.mock.calls.length - count).toBe(1);
    }
    expect(redis.keys).not.toHaveBeenCalled();
    await expect(cache.invalidatePattern('*')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a version change makes old entries unreachable, including metrics and spatial values', async () => {
    const before = await cache.versionedKey('users', 'base', { userId: 'driver1' });
    redis.mget.mockResolvedValue(['new-generation', null, null]);
    const after = await cache.versionedKey('users', 'base', { userId: 'driver1' });
    expect(after).not.toBe(before);
    await cache.setMetricsCache('users', { total: 1 });
    expect(redis.setex.mock.calls.at(-1)[0]).toContain('graphql:v2:');
    expect(await cache.getCacheStats()).toMatchObject({ totalKeys: null, countsAvailable: false, memoryUsage: 1234 });
    expect(redis.keys).not.toHaveBeenCalled();
  });

  test('does not double the expensive fetch when the upstream fails', async () => {
    redis.get.mockResolvedValue(null);
    const fetch = jest.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(cache.getOrSet('users', fetch)).rejects.toThrow('database unavailable');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('an in-flight old fetch cannot populate the namespace created by invalidation', async () => {
    redis.get.mockResolvedValue(null);
    const oldKey = await cache.versionedKey('users', cache.generateCacheKey('users'));
    const value = await cache.getOrSet('users', async () => {
      redis.mget.mockResolvedValue(['new-generation', null, null]);
      return { old: true };
    });
    expect(value).toEqual({ old: true });
    expect(redis.setex.mock.calls.at(-1)[0]).toBe(oldKey);
    expect(await cache.versionedKey('users', cache.generateCacheKey('users'))).not.toBe(oldKey);
  });
});

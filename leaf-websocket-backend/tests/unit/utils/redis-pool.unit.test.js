/**
 * Unit tests (atualizados) para redis-pool singleton.
 */

describe('redis-pool', () => {
  let redisPool;

  beforeEach(() => {
    jest.resetModules();
    redisPool = require('../../../utils/redis-pool');
  });

  test('should expose singleton API', () => {
    expect(redisPool).toBeDefined();
    expect(typeof redisPool.getConnection).toBe('function');
    expect(typeof redisPool.ensureConnection).toBe('function');
    expect(typeof redisPool.healthCheck).toBe('function');
    expect(typeof redisPool.getPoolStats).toBe('function');
  });

  test('getConnection should return an instrumented redis client', () => {
    const conn = redisPool.getConnection();
    expect(conn).toBeDefined();
    expect(conn._instrumented).toBe(true);
    expect(typeof conn.hget).toBe('function');
    expect(typeof conn.expire).toBe('function');
  });

  test('healthCheck should return status payload', async () => {
    const result = await redisPool.healthCheck();
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('timestamp');
  });

  test('getPoolStats should return connection metadata', () => {
    const stats = redisPool.getPoolStats();
    expect(stats).toHaveProperty('status');
    expect(stats).toHaveProperty('connected');
    expect(stats).toHaveProperty('options.host');
  });
});

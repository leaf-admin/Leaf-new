const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  hset: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn(),
  incr: jest.fn().mockResolvedValue(1),
  decr: jest.fn().mockResolvedValue(0),
  del: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({ getConnection: jest.fn(() => mockRedis) }));
jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

jest.useFakeTimers();
const websocketRateLimiter = require('../../../middleware/websocket-rate-limiter');

describe('websocketRateLimiter connection index', () => {
  afterAll(() => jest.useRealTimers());

  test('register adds the socket to the index and unregister removes it', async () => {
    await websocketRateLimiter.registerConnection({ id: 'sock_1' }, '10.0.0.1', 'user_1');
    expect(mockRedis.sadd).toHaveBeenCalledWith('connections:index', 'sock_1');

    mockRedis.hgetall.mockResolvedValueOnce({ ip: '10.0.0.1', userId: 'user_1' });
    await websocketRateLimiter.unregisterConnection({ id: 'sock_1' });
    expect(mockRedis.del).toHaveBeenCalledWith('connection:sock_1');
    expect(mockRedis.srem).toHaveBeenCalledWith('connections:index', 'sock_1');
  });

  test('unregister also clears an index entry whose hash is already gone', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});
    await websocketRateLimiter.unregisterConnection({ id: 'sock_gone' });
    expect(mockRedis.srem).toHaveBeenCalledWith('connections:index', 'sock_gone');
  });
});

const mockRedis = {
  scan: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  hgetall: jest.fn(),
  get: jest.fn(),
  del: jest.fn()
};
const mockUnregister = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({ getConnection: jest.fn(() => mockRedis) }));
jest.mock('../../../services/connection-monitor', () => ({}));
jest.mock('../../../middleware/websocket-rate-limiter', () => ({
  CONNECTION_INDEX_KEY: 'connections:index',
  unregisterConnection: (...args) => mockUnregister(...args)
}));
jest.mock('../../../services/driver-online-projection-service', () => ({ commitDriverOnlineProjection: jest.fn() }));
jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const ConnectionCleanupService = require('../../../services/connection-cleanup-service');

const NOW = Date.parse('2026-10-15T16:00:00.000Z');
const hashes = {
  'connection:live': { connectedAt: String(NOW - 60 * 60 * 1000) },
  'connection:orphan': { connectedAt: String(NOW - 60 * 60 * 1000) }
};

function createService() {
  const service = new ConnectionCleanupService({
    sockets: { sockets: new Map([['live', {}]]) }
  });
  // Only the cycle under test matters here.
  service.cleanupExpiredHeartbeats = jest.fn().mockResolvedValue(0);
  service.cleanupEligibleGeoStaleDrivers = jest.fn().mockResolvedValue(0);
  service.cleanupOfflineGeoOrphans = jest.fn().mockResolvedValue(0);
  return service;
}

describe('ConnectionCleanupService connection index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    mockRedis.scan.mockImplementation(async (_cursor, _match, pattern) => [
      '0',
      pattern === 'connection:*' ? ['connection:live', 'connection:orphan'] : []
    ]);
    mockRedis.smembers.mockResolvedValue(['live', 'orphan', 'gone']);
    mockRedis.hgetall.mockImplementation(async (key) => hashes[key] || {});
  });

  afterEach(() => jest.useRealTimers());

  test('scans only on reconcile cycles and reads the index otherwise', async () => {
    const service = createService();

    await service.cleanup(); // cycle 0: reconcile
    expect(mockRedis.scan).toHaveBeenCalled();
    expect(mockRedis.sadd).toHaveBeenCalledWith('connections:index', 'live', 'orphan');

    mockRedis.scan.mockClear();
    for (let cycle = 1; cycle < 30; cycle += 1) {
      await service.cleanup();
    }
    expect(mockRedis.scan).not.toHaveBeenCalled();
    expect(mockRedis.smembers).toHaveBeenCalledTimes(29);

    await service.cleanup(); // cycle 30: reconcile again
    expect(mockRedis.scan).toHaveBeenCalled();
  });

  test('index cycles still remove orphans and drop entries whose hash is gone', async () => {
    const service = createService();
    service.cycle = 1; // not a reconcile cycle

    await service.cleanup();

    expect(mockRedis.scan).not.toHaveBeenCalled();
    expect(mockRedis.del).toHaveBeenCalledWith('connection:orphan');
    expect(mockUnregister).toHaveBeenCalledWith({ id: 'orphan' });
    expect(mockUnregister).not.toHaveBeenCalledWith({ id: 'live' });
    expect(mockRedis.srem).toHaveBeenCalledWith('connections:index', 'gone');
  });
});

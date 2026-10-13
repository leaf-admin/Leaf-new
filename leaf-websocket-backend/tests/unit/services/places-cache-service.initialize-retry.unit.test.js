const mockRedisConnection = {
  get: jest.fn(),
  setex: jest.fn(),
  ping: jest.fn(),
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: () => mockRedisConnection,
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('places-cache-service initialize retry', () => {
  let service;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetModules();
    mockRedisConnection.get.mockReset().mockResolvedValue(null);
    mockRedisConnection.setex.mockReset().mockResolvedValue('OK');
    mockRedisConnection.ping.mockReset();
    service = require('../../../services/places-cache-service');
  });

  afterEach(() => {
    if (service.initializeRetryTimer) {
      clearTimeout(service.initializeRetryTimer);
      service.initializeRetryTimer = null;
    }
    jest.useRealTimers();
  });

  it('retries after a transient Redis timeout at boot and becomes initialized', async () => {
    mockRedisConnection.ping
      .mockRejectedValueOnce(new Error('Command timed out'))
      .mockResolvedValueOnce('PONG');

    await service.initialize();
    expect(service.isInitialized).toBe(false);

    await jest.advanceTimersByTimeAsync(2000);

    expect(mockRedisConnection.ping).toHaveBeenCalledTimes(2);
    expect(service.isInitialized).toBe(true);
    expect(service.initializeRetryTimer).toBeNull();
  });

  it('backs off between attempts while Redis stays unavailable', async () => {
    mockRedisConnection.ping.mockRejectedValue(new Error('Command timed out'));

    await service.initialize();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockRedisConnection.ping).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(3999);
    expect(mockRedisConnection.ping).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockRedisConnection.ping).toHaveBeenCalledTimes(3);
    expect(service.isInitialized).toBe(false);
  });

  it('does not schedule a retry when the first attempt succeeds', async () => {
    mockRedisConnection.ping.mockResolvedValue('PONG');

    await service.initialize();

    expect(service.isInitialized).toBe(true);
    expect(service.initializeRetryTimer == null).toBe(true);
  });
});

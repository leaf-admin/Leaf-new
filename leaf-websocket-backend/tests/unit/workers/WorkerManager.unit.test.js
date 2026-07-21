const mockRedisPool = {
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
};
jest.mock('../../../utils/redis-pool', () => mockRedisPool);

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordListener: jest.fn(),
    recordEventConsumed: jest.fn(),
    setActiveWorkers: jest.fn(),
    setEventBacklog: jest.fn()
  }
}));

jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn(() => 'trace-test'),
  runWithTraceId: jest.fn((_traceId, handler) => handler())
}));

const mockTrimRedisStreamSafely = jest.fn();
jest.mock('../../../utils/redis-stream-safe-retention', () => ({
  trimRedisStreamSafely: (...args) => mockTrimRedisStreamSafely(...args)
}));

const WorkerManager = require('../../../workers/WorkerManager');

describe('WorkerManager handler results', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisPool.ensureConnection.mockResolvedValue(undefined);
    mockTrimRedisStreamSafely.mockResolvedValue({
      currentLength: 100,
      trimmed: 0,
      reason: 'below_threshold'
    });
  });

  it('removes only the exact DLQ sentinel instead of deleting the stream', async () => {
    const redis = {
      duplicate: jest.fn(() => ({ status: 'ready', on: jest.fn() })),
      xgroup: jest.fn().mockResolvedValue('OK'),
      xadd: jest.fn().mockResolvedValue('1740000000000-7'),
      xdel: jest.fn().mockResolvedValue(1),
      del: jest.fn()
    };
    mockRedisPool.getConnection.mockReturnValue(redis);
    const manager = new WorkerManager({
      consumerName: 'test-worker',
      dlqStreamName: 'trip_location_events_dlq'
    });

    await expect(manager.initialize()).resolves.toBe(true);

    expect(redis.xadd).toHaveBeenCalledWith(
      'trip_location_events_dlq',
      '*',
      'init',
      'true'
    );
    expect(redis.xdel).toHaveBeenCalledWith(
      'trip_location_events_dlq',
      '1740000000000-7'
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('treats handler success=false as a failed event', async () => {
    const manager = new WorkerManager({ consumerName: 'test-worker' });
    manager.registerListener('ride.billing', jest.fn(async () => ({
      success: false,
      error: 'billing failed'
    })));

    const result = await manager.processEvent('event-1', {
      type: 'ride.billing',
      data: JSON.stringify({ bookingId: 'booking_1' }),
      timestamp: '2026-05-14T00:00:00.000Z'
    });

    expect(result).toEqual({
      success: false,
      error: 'billing failed'
    });
    expect(manager.stats.processed).toBe(0);
  });

  it('keeps successful handler payload available for diagnostics', async () => {
    const manager = new WorkerManager({ consumerName: 'test-worker' });
    manager.registerListener('ride.billing', jest.fn(async () => ({
      success: true,
      billingId: 'billing_1'
    })));

    const result = await manager.processEvent('event-2', {
      type: 'ride.billing',
      data: JSON.stringify({ bookingId: 'booking_2' }),
      timestamp: '2026-05-14T00:00:00.000Z'
    });

    expect(result).toEqual({
      success: true,
      data: {
        success: true,
        billingId: 'billing_1'
      }
    });
    expect(manager.stats.processed).toBe(1);
  });

  it('bounds the DLQ while preserving the newest diagnostic failures', async () => {
    const manager = new WorkerManager({
      consumerName: 'test-worker',
      dlqMaxLen: 2500
    });
    manager.redis = { xadd: jest.fn().mockResolvedValue('1-0') };

    await expect(manager.moveToDLQ('event-3', {
      type: 'ride.billing',
      data: '{"bookingId":"booking_3"}'
    }, 'billing failed')).resolves.toEqual({ success: false, dlq: true });

    expect(manager.redis.xadd).toHaveBeenCalledWith(
      'ride_events_dlq',
      'MAXLEN',
      '~',
      '2500',
      '*',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String)
    );
  });

  it('checks primary stream retention off the ACK path after the configured interval', async () => {
    const manager = new WorkerManager({
      consumerName: 'test-worker',
      safeTrimThreshold: 100000,
      safeTrimCheckEveryAcks: 100
    });
    manager.redis = { xack: jest.fn().mockResolvedValue(1) };

    for (let index = 0; index < 100; index += 1) {
      await manager.acknowledgeEvent(`event-${index}`);
    }
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();

    expect(manager.redis.xack).toHaveBeenCalledTimes(100);
    expect(mockTrimRedisStreamSafely).toHaveBeenCalledWith(
      manager.redis,
      'ride_events',
      100000
    );
  });
});

jest.mock('../../../utils/redis-pool', () => ({}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordListener: jest.fn(),
    recordEventConsumed: jest.fn(),
    setActiveWorkers: jest.fn()
  }
}));

jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn(() => 'trace-test'),
  runWithTraceId: jest.fn((_traceId, handler) => handler())
}));

const WorkerManager = require('../../../workers/WorkerManager');

describe('WorkerManager handler results', () => {
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
});

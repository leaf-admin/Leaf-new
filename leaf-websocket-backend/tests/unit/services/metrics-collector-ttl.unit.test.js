const mockRedis = {
  smembers: jest.fn().mockResolvedValue([]),
  sadd: jest.fn().mockResolvedValue(1),
  hset: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1)
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const metricsCollector = require('../../../services/metrics-collector');

describe('metrics-collector acceptance keys', () => {
  it('expires both the acceptance hash and its notified set', async () => {
    await metricsCollector.recordDriverNotification('booking_1', 'driver_1', 1000);

    expect(mockRedis.sadd).toHaveBeenCalledWith('metrics:acceptance:booking_1:notified', 'driver_1');
    expect(mockRedis.expire).toHaveBeenCalledWith('metrics:acceptance:booking_1', 3600);
    expect(mockRedis.expire).toHaveBeenCalledWith('metrics:acceptance:booking_1:notified', 3600);
  });
});

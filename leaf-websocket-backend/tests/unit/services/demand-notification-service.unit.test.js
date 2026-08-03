const mockRedis = {
  isOpen: true,
  georadius: jest.fn(),
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const DemandNotificationService = require('../../../services/demand-notification-service');

describe('DemandNotificationService cooldown lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T12:00:00.000Z'));
    mockRedis.georadius.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('self-cleans expired cooldowns before each notification lookup', async () => {
    const service = new DemandNotificationService({ sockets: { sockets: new Map() } });
    const now = Date.now();
    service.notificationCooldown.set('driver_expired', now - (11 * 60 * 1000));
    service.notificationCooldown.set('driver_recent', now - (2 * 60 * 1000));

    await service.notifyOfflineDriversNearDemand(
      { lat: -22.9207, lng: -43.4059 },
      'high',
      2
    );

    expect(service.notificationCooldown.has('driver_expired')).toBe(false);
    expect(service.notificationCooldown.get('driver_recent')).toBe(now - (2 * 60 * 1000));
    expect(mockRedis.georadius).toHaveBeenCalledTimes(1);
  });
});

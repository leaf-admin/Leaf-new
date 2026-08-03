const mockRedis = {
  hgetall: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
};
const mockCommitDriverOnlineProjection = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis),
}));

jest.mock('../../../services/connection-monitor', () => ({}));

jest.mock('../../../middleware/websocket-rate-limiter', () => ({
  unregisterConnection: jest.fn(),
}));

jest.mock('../../../services/driver-online-projection-service', () => ({
  commitDriverOnlineProjection: (...args) => mockCommitDriverOnlineProjection(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

const ConnectionCleanupService = require('../../../services/connection-cleanup-service');

describe('ConnectionCleanupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-25T12:03:00.000Z'));
    mockRedis.hgetall.mockResolvedValue({
      totalMs: String(30 * 60 * 1000),
      sessionStartedAtMs: String(Date.parse('2026-06-25T12:00:00.000Z')),
    });
    mockRedis.hset.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockCommitDriverOnlineProjection.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes driver online daily session at heartbeat timeout before disconnecting stale socket', async () => {
    const lastHeartbeat = Date.parse('2026-06-25T12:00:00.000Z');
    const socket = {
      id: 'socket_1',
      userId: 'driver_1',
      userType: 'driver',
      lastHeartbeat,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    const service = new ConnectionCleanupService({
      connectedUsers: new Map([['driver_1', socket]]),
      sockets: { fetchSockets: jest.fn(), sockets: new Map() },
    });
    service.config.heartbeatTimeout = 120000;

    const removed = await service.cleanupExpiredHeartbeats();

    expect(removed).toBe(1);
    expect(mockRedis.hset).toHaveBeenCalledWith(
      expect.stringMatching(/^driver_online_daily:/),
      expect.objectContaining({
        totalMs: String(32 * 60 * 1000),
        sessionStartedAtMs: '',
        closedReason: 'stale_heartbeat',
        closedAtIso: '2026-06-25T12:02:00.000Z',
      })
    );
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        driverId: 'driver_1',
        eligibleGeoKey: 'driver_locations_eligible',
        isOnline: false,
        dispatchEligible: false,
        fields: expect.objectContaining({
          status: 'OFFLINE',
          isOnline: 'false',
          dispatchEligibilityCode: 'STALE_HEARTBEAT',
          dispatchEligibilityCheckedAt: '2026-06-25T12:02:00.000Z',
        }),
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({
        driverId: 'driver_1',
        isOnline: false,
        driverOnlineDaily: expect.objectContaining({
          totalMs: 32 * 60 * 1000,
          sessionStartedAtMs: null,
        }),
      })
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('does not emit a successful offline projection when the atomic writer rejects', async () => {
    const socket = {
      id: 'socket_1',
      userId: 'driver_1',
      userType: 'driver',
      lastHeartbeat: Date.parse('2026-06-25T12:00:00.000Z'),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    const service = new ConnectionCleanupService({
      connectedUsers: new Map([['driver_1', socket]]),
      sockets: { fetchSockets: jest.fn(), sockets: new Map() },
    });
    service.config.heartbeatTimeout = 120000;
    mockCommitDriverOnlineProjection.mockRejectedValueOnce(new Error('atomic projection rejected'));

    const removed = await service.cleanupExpiredHeartbeats();

    expect(removed).toBe(1);
    expect(socket.emit).not.toHaveBeenCalledWith(
      'driverStatusUpdated',
      expect.objectContaining({ success: true })
    );
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

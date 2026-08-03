const mockRedis = {
  hgetall: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
  pipeline: jest.fn(),
  zrange: jest.fn(),
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

function mockEligibleDriverSnapshots(driverIds, snapshots) {
  const readPipeline = {
    hmget: jest.fn(),
    exec: jest.fn().mockResolvedValue(snapshots),
  };
  mockRedis.zrange.mockResolvedValue(driverIds);
  mockRedis.pipeline.mockReturnValue(readPipeline);
  return readPipeline;
}

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
    mockRedis.zrange.mockResolvedValue([]);
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

  it('conditionally removes a stale online driver through the full atomic projection', async () => {
    const lastUpdate = Date.parse('2026-06-25T11:59:00.000Z');
    const readPipeline = mockEligibleDriverSnapshots(['driver_1'], [[null, [
      'true',
      'true',
      String(lastUpdate),
      null,
      'AVAILABLE',
      'ELIGIBLE',
    ]]])
    const service = new ConnectionCleanupService({
      connectedUsers: new Map(),
      sockets: { sockets: new Map() },
    });
    service.config.eligibleGeoStaleMs = 180000;

    const removed = await service.cleanupEligibleGeoStaleDrivers();

    expect(removed).toBe(1);
    expect(readPipeline.hmget).toHaveBeenCalledWith(
      'driver:driver_1',
      'isOnline',
      'dispatchEligible',
      'lastUpdate',
      'timestamp',
      'status',
      'dispatchEligibilityCode'
    );
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        driverId: 'driver_1',
        projectionScope: 'full',
        isOnline: false,
        dispatchEligible: false,
        presenceFreshAfterMs: Date.parse('2026-06-25T12:01:00.000Z'),
        expectedFields: {
          isOnline: 'true',
          dispatchEligible: 'true',
          lastUpdate: String(lastUpdate),
          timestamp: null,
          status: 'AVAILABLE',
          dispatchEligibilityCode: 'ELIGIBLE',
        },
        fields: expect.objectContaining({
          status: 'OFFLINE',
          isOnline: 'false',
          dispatchEligible: 'false',
          dispatchEligibilityCode: 'STALE_HEARTBEAT',
        }),
      })
    );
  });

  it('removes only eligibility for a fresh online driver already marked ineligible', async () => {
    const lastUpdate = Date.parse('2026-06-25T12:02:30.000Z');
    mockEligibleDriverSnapshots(['driver_1'], [[null, [
      'true',
      'false',
      String(lastUpdate),
      null,
      'AVAILABLE',
      'ACTIVE_TRIP',
    ]]])
    const service = new ConnectionCleanupService({
      connectedUsers: new Map(),
      sockets: { sockets: new Map() },
    });

    const removed = await service.cleanupEligibleGeoStaleDrivers();

    expect(removed).toBe(1);
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({
        projectionScope: 'eligibility_only',
        dispatchEligible: false,
        presenceFreshAfterMs: 0,
        fields: {
          dispatchEligible: 'false',
          dispatchEligibilityCheckedAt: '2026-06-25T12:03:00.000Z',
        },
      })
    );
  });

  it('preserves stale discovery membership when the conditional writer sees active presence', async () => {
    mockEligibleDriverSnapshots(['driver_1'], [[null, [
      'true',
      'true',
      String(Date.parse('2026-06-25T11:59:00.000Z')),
      null,
      'AVAILABLE',
      'ELIGIBLE',
    ]]])
    mockCommitDriverOnlineProjection.mockResolvedValueOnce({
      success: false,
      skipped: true,
      code: 'ACTIVE_SOCKET_PRESENCE',
    });
    const service = new ConnectionCleanupService({
      connectedUsers: new Map(),
      sockets: { sockets: new Map() },
    });

    const removed = await service.cleanupEligibleGeoStaleDrivers();

    expect(removed).toBe(0);
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledTimes(1);
  });

  it('does not count a rejected atomic GEO reconciliation as removed', async () => {
    mockEligibleDriverSnapshots(['driver_1'], [[null, [
      'false',
      'false',
      String(Date.parse('2026-06-25T11:59:00.000Z')),
      null,
      'OFFLINE',
      'OFFLINE',
    ]]])
    mockCommitDriverOnlineProjection.mockRejectedValueOnce(new Error('redis eval failed'));
    const service = new ConnectionCleanupService({
      connectedUsers: new Map(),
      sockets: { sockets: new Map() },
    });

    const removed = await service.cleanupEligibleGeoStaleDrivers();

    expect(removed).toBe(0);
    expect(mockCommitDriverOnlineProjection).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an unreadable driver snapshot instead of cleaning discovery indices', async () => {
    mockEligibleDriverSnapshots(['driver_1'], [[new Error('hmget failed'), null]]);
    const service = new ConnectionCleanupService({
      connectedUsers: new Map(),
      sockets: { sockets: new Map() },
    });

    const removed = await service.cleanupEligibleGeoStaleDrivers();

    expect(removed).toBe(0);
    expect(mockCommitDriverOnlineProjection).not.toHaveBeenCalled();
  });
});

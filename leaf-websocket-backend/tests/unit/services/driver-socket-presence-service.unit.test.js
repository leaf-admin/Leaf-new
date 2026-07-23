const {
  getPresenceKey,
  upsertDriverSocketPresence,
  readDriverSocketPresence,
  clearDriverSocketPresence
} = require('../../../services/driver-socket-presence-service');

describe('driver-socket-presence-service', () => {
  it('records driver socket presence with dispatch rooms and ttl', async () => {
    const redis = {
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1)
    };
    const socket = {
      id: 'socket-1',
      userId: 'driver-1',
      userType: 'driver',
      connected: true,
      workerId: 'websocket-1',
      rooms: new Set(['socket-1', 'drivers_room', 'driver_driver-1'])
    };

    const result = await upsertDriverSocketPresence(redis, {
      driverId: 'driver-1',
      socket,
      source: 'authenticate',
      nowMs: 1760000000000
    });

    expect(result).toMatchObject({
      success: true,
      code: 'DRIVER_SOCKET_PRESENCE_RECORDED',
      inDriverRoom: true
    });
    expect(redis.hset).toHaveBeenCalledWith(
      getPresenceKey('driver-1'),
      expect.objectContaining({
        driverId: 'driver-1',
        socketId: 'socket-1',
        userType: 'driver',
        connected: 'true',
        inDriverRoom: 'true',
        workerId: 'websocket-1',
        source: 'authenticate',
        updatedAtMs: '1760000000000'
      })
    );
    expect(redis.expire).toHaveBeenCalledWith(getPresenceKey('driver-1'), expect.any(Number));
  });

  it('reads fresh distributed presence as reachable', async () => {
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        driverId: 'driver-1',
        socketId: 'socket-1',
        userType: 'driver',
        connected: 'true',
        inDriverRoom: 'true',
        rooms: JSON.stringify(['socket-1', 'drivers_room', 'driver_driver-1']),
        workerId: 'websocket-1',
        updatedAt: '2026-06-27T12:00:00.000Z',
        updatedAtMs: '1760000000000'
      })
    };

    const result = await readDriverSocketPresence(redis, 'driver-1', {
      nowMs: 1760000001000,
      maxAgeMs: 90_000
    });

    expect(result).toMatchObject({
      reachable: true,
      code: 'DISTRIBUTED_SOCKET_PRESENCE',
      socketId: 'socket-1',
      workerId: 'websocket-1'
    });
  });

  it('rejects stale distributed presence', async () => {
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        driverId: 'driver-1',
        socketId: 'socket-1',
        userType: 'driver',
        connected: 'true',
        inDriverRoom: 'true',
        rooms: JSON.stringify(['socket-1', 'drivers_room', 'driver_driver-1']),
        updatedAtMs: '1760000000000'
      })
    };

    const result = await readDriverSocketPresence(redis, 'driver-1', {
      nowMs: 1760000200000,
      maxAgeMs: 90_000
    });

    expect(result).toMatchObject({
      reachable: false,
      code: 'DRIVER_SOCKET_PRESENCE_STALE'
    });
  });

  it('does not clear presence for a newer socket after reconnection', async () => {
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        socketId: 'socket-new'
      }),
      del: jest.fn().mockResolvedValue(1)
    };

    const result = await clearDriverSocketPresence(redis, {
      driverId: 'driver-1',
      socketId: 'socket-old',
      source: 'disconnect'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'DRIVER_SOCKET_PRESENCE_SOCKET_MISMATCH',
      storedSocketId: 'socket-new'
    });
    expect(redis.del).not.toHaveBeenCalled();
  });
});

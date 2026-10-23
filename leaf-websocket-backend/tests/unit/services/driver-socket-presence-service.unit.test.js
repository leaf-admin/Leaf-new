const {
  getPresenceKey,
  upsertDriverSocketPresence,
  readDriverSocketPresence,
  clearDriverSocketPresence,
  recordDriverSocketReconnectGrace,
  readDriverSocketReconnectGrace
} = require('../../../services/driver-socket-presence-service');

describe('driver-socket-presence-service', () => {
  it('records reconnect grace separately with the exact configured TTL', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK') };
    const grace = await recordDriverSocketReconnectGrace(redis, { driverId: 'driver-1', socketId: 'socket-1', graceMs: 90000, nowMs: 1000 });
    expect(grace).toEqual({ socketId: 'socket-1', deadlineMs: 91000 });
    expect(redis.set).toHaveBeenCalledWith('driver_socket_reconnect_grace:driver-1', JSON.stringify(grace), 'PX', 90000);
  });
  it.each([null, 'not-json', '{}', '{"socketId":"socket-1","deadlineMs":999}', '{"socketId":"socket-1","deadlineMs":999999}'])('ignores an absent, invalid or out-of-window reconnect record (%s)', async raw => {
    const redis = { get: jest.fn().mockResolvedValue(raw) };
    expect(await readDriverSocketReconnectGrace(redis, 'driver-1', { maxGraceMs: 90000, nowMs: 1000 })).toBeNull();
  });
  it('validates grace after reading a disconnect created while Redis was being queried', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const redis = { get: jest.fn(async () => { clock.mockReturnValue(2000); return JSON.stringify({ socketId: 'socket-1', deadlineMs: 92000 }); }) };
      expect(await readDriverSocketReconnectGrace(redis, 'driver-1', { maxGraceMs: 90000 })).toEqual({ socketId: 'socket-1', deadlineMs: 92000 });
    } finally { clock.mockRestore(); }
  });
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

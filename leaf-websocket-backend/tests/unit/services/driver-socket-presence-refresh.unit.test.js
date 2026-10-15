const presence = require('../../../services/driver-socket-presence-service');

function createRedis() {
  const hashes = new Map();
  const calls = [];
  const redis = {
    calls,
    hashes,
    hset: async (key, fields) => { calls.push('hset'); hashes.set(key, { ...(hashes.get(key) || {}), ...fields }); },
    expire: async () => { calls.push('expire'); return 1; },
    hgetall: async (key) => ({ ...(hashes.get(key) || {}) }),
    del: async (key) => { calls.push('del'); hashes.delete(key); }
  };
  redis.pipeline = () => {
    const steps = [];
    const api = {
      hset: (...args) => { steps.push(() => redis.hset(...args)); return api; },
      expire: (...args) => { steps.push(() => redis.expire(...args)); return api; },
      exec: async () => { for (const step of steps) await step(); return []; }
    };
    return api;
  };
  return redis;
}

const socket = (id = 'sock_1') => ({ id, userId: 'd1', userType: 'driver', connected: true, rooms: new Set([id, 'driver_d1', 'drivers_room']) });
const T0 = Date.parse('2026-10-15T21:00:00.000Z');

describe('driver socket presence refresh', () => {
  beforeEach(() => presence.resetPresenceCacheForTests());

  test('an unchanged presence is written once per refresh window and stays readable', async () => {
    const redis = createRedis();
    await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket(), source: 'updateLocation', nowMs: T0 });
    const first = await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket(), source: 'updateLocation', nowMs: T0 + 5000 });
    expect(first.skipped).toBe(true);
    expect(redis.calls.filter((c) => c === 'hset')).toHaveLength(1);

    // Still within the readers' freshness window.
    const read = await presence.readDriverSocketPresence(redis, 'd1', { nowMs: T0 + 14000 });
    expect(read.reachable).toBe(true);

    await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket(), source: 'updateLocation', nowMs: T0 + 15000 });
    expect(redis.calls.filter((c) => c === 'hset')).toHaveLength(2);
    expect(redis.hashes.get('driver_socket_presence:d1').updatedAtMs).toBe(String(T0 + 15000));
  });

  test('a new socket or a disconnect is written at once', async () => {
    const redis = createRedis();
    await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket('sock_1'), source: 'updateLocation', nowMs: T0 });
    await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket('sock_2'), source: 'updateLocation', nowMs: T0 + 1000 });
    expect(redis.hashes.get('driver_socket_presence:d1').socketId).toBe('sock_2');

    await presence.clearDriverSocketPresence(redis, { driverId: 'd1', socketId: 'sock_2' });
    expect(redis.hashes.has('driver_socket_presence:d1')).toBe(false);

    await presence.upsertDriverSocketPresence(redis, { driverId: 'd1', socket: socket('sock_2'), source: 'updateLocation', nowMs: T0 + 2000 });
    expect(redis.hashes.has('driver_socket_presence:d1')).toBe(true);
  });
});

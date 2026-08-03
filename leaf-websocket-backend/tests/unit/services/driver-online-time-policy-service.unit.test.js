const {
  closeDriverOnlineSessionAt,
  getOperationalDayKey,
  readDriverOnlineDailySnapshot,
  resolveDriverOnlineTransition,
} = require('../../../services/driver-online-time-policy-service');

function createRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    hgetall: jest.fn(async (key) => ({ ...(store.get(key) || {}) })),
    hset: jest.fn(async (key, patch) => {
      store.set(key, { ...(store.get(key) || {}), ...patch });
      return 1;
    }),
    expire: jest.fn(async () => 1),
    _store: store,
  };
}

describe('driver-online-time-policy-service', () => {
  beforeEach(() => {
    delete process.env.DRIVER_ONLINE_DAILY_WARNING_HOURS;
    delete process.env.DRIVER_ONLINE_DAILY_LIMIT_HOURS;
    delete process.env.DRIVER_ONLINE_DAILY_TIMEZONE;
  });

  it('uses the Sao Paulo operational day by default', () => {
    expect(getOperationalDayKey(Date.parse('2026-06-25T02:59:00.000Z'))).toBe('2026-06-24');
    expect(getOperationalDayKey(Date.parse('2026-06-25T03:00:00.000Z'))).toBe('2026-06-25');
  });

  it('accumulates multiple online sessions inside the same operational day', async () => {
    const redis = createRedis();
    const driverId = 'driver_1';
    const firstStart = Date.parse('2026-06-25T12:00:00.000Z');

    await resolveDriverOnlineTransition(redis, {
      driverId,
      isOnline: true,
      nowMs: firstStart,
    });
    await resolveDriverOnlineTransition(redis, {
      driverId,
      isOnline: false,
      nowMs: firstStart + 2 * 60 * 60 * 1000,
    });
    await resolveDriverOnlineTransition(redis, {
      driverId,
      isOnline: true,
      nowMs: firstStart + 4 * 60 * 60 * 1000,
    });

    const snapshot = await readDriverOnlineDailySnapshot(
      redis,
      driverId,
      firstStart + 5 * 60 * 60 * 1000,
    );

    expect(snapshot.effectiveMs).toBe(3 * 60 * 60 * 1000);
    expect(snapshot.nearLimit).toBe(false);
  });

  it('flags near-limit at 10h and blocks new online sessions at 12h', async () => {
    const nowMs = Date.parse('2026-06-25T12:00:00.000Z');
    const dayKey = getOperationalDayKey(nowMs);
    const redis = createRedis({
      [`driver_online_daily:${dayKey}:driver_1`]: {
        totalMs: String(12 * 60 * 60 * 1000),
        sessionStartedAtMs: '',
      },
    });

    const blocked = await resolveDriverOnlineTransition(redis, {
      driverId: 'driver_1',
      isOnline: true,
      nowMs,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('DRIVER_ONLINE_DAILY_LIMIT_REACHED');
    expect(blocked.snapshot.nearLimit).toBe(true);
    expect(blocked.snapshot.limitReached).toBe(true);
  });

  it('checks the online limit without opening a session before the status commit', async () => {
    const nowMs = Date.parse('2026-06-25T12:00:00.000Z');
    const redis = createRedis();

    const result = await resolveDriverOnlineTransition(redis, {
      driverId: 'driver_1',
      isOnline: true,
      nowMs,
      persist: false,
    });

    expect(result.allowed).toBe(true);
    expect(result.snapshot.sessionStartedAtMs).toBe(nowMs);
    expect(redis.hset).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('closes an active session at a canonical stale heartbeat timestamp', async () => {
    const startedAtMs = Date.parse('2026-06-25T12:00:00.000Z');
    const closedAtMs = startedAtMs + 2 * 60 * 1000;
    const dayKey = getOperationalDayKey(closedAtMs);
    const redis = createRedis({
      [`driver_online_daily:${dayKey}:driver_1`]: {
        totalMs: String(30 * 60 * 1000),
        sessionStartedAtMs: String(startedAtMs),
      },
    });

    const result = await closeDriverOnlineSessionAt(redis, {
      driverId: 'driver_1',
      closedAtMs,
    });

    expect(result.closed).toBe(true);
    expect(result.snapshot.totalMs).toBe(32 * 60 * 1000);
    expect(result.snapshot.sessionStartedAtMs).toBe(null);
    expect(redis._store.get(`driver_online_daily:${dayKey}:driver_1`)).toEqual(
      expect.objectContaining({
        totalMs: String(32 * 60 * 1000),
        sessionStartedAtMs: '',
        closedReason: 'stale_heartbeat',
      })
    );
  });
});

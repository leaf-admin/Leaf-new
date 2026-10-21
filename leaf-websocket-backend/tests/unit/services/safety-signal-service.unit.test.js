jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const { SafetySignalService, SIGNAL_TYPES } = require('../../../services/safety-signal-service');

function createRedis() {
  const hashes = new Map();
  const zsets = new Map();
  const strings = new Map();
  const zadd = (key, score, member) => {
    const set = zsets.get(key) || new Map();
    set.set(member, Number(score));
    zsets.set(key, set);
  };
  return {
    hashes,
    zsets,
    set: jest.fn(async (key, value, _ex, _ttl, nx) => {
      if (nx === 'NX' && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    }),
    hset: jest.fn(async (key, record) => { hashes.set(key, { ...record }); }),
    hgetall: jest.fn(async (key) => hashes.get(key) || {}),
    expire: jest.fn(async () => 1),
    zadd: jest.fn(async (key, score, member) => zadd(key, score, member)),
    zremrangebyscore: jest.fn(async () => 0),
    zrevrange: jest.fn(async (key, start, stop) => {
      const entries = [...(zsets.get(key) || new Map()).entries()].sort((a, b) => b[1] - a[1]);
      return entries.slice(start, stop + 1).map(([member]) => member);
    })
  };
}

function build({ redis = createRedis(), nowMs = Date.parse('2026-10-21T12:00:00Z') } = {}) {
  const events = { emit: jest.fn().mockResolvedValue({ queued: 1 }) };
  let clock = nowMs;
  const service = new SafetySignalService({
    redis: { ensureConnection: jest.fn(), getConnection: () => redis },
    events,
    now: () => clock
  });
  return { service, redis, events, tick: (ms) => { clock += ms; } };
}

describe('safety-signal-service', () => {
  it('records the signal, indexes it by driver and warns the Segurança bot without personal data', async () => {
    const { service, redis, events } = build();

    const result = await service.record({
      type: 'location_jump',
      driverId: 'driver-1',
      bookingId: 'booking-1',
      reason: 'Salto de 12.0 km em 30 s na corrida',
      score: 1440,
      details: { distanceKm: 12 }
    });

    expect(result.recorded).toBe(true);
    const stored = redis.hashes.get(`safety:signal:${result.signalId}`);
    expect(stored).toMatchObject({ type: 'location_jump', driverId: 'driver-1', bookingId: 'booking-1', sandbox: 'false' });
    expect(redis.zsets.get('safety:driver:driver-1:signals').has(result.signalId)).toBe(true);
    expect(events.emit).toHaveBeenCalledWith('safety.signal', expect.objectContaining({
      signalId: result.signalId,
      category: 'location_jump',
      bookingId: 'booking-1',
      score: 1440,
      source: 'safety'
    }), { dedupeKey: result.signalId, severity: SIGNAL_TYPES.location_jump.severity });
    expect(JSON.stringify(events.emit.mock.calls[0][1])).not.toContain('driver-1');
  });

  it('records sandbox signals for audit but does not warn the bots', async () => {
    const { service, redis, events } = build();

    const result = await service.record({ type: 'mock_location', driverId: 'qa-driver', sandbox: true });

    expect(result.recorded).toBe(true);
    expect(redis.hashes.get(`safety:signal:${result.signalId}`).sandbox).toBe('true');
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('records the same signal only once per dedupe window', async () => {
    const { service, events } = build();

    const first = await service.record({ type: 'mock_location', driverId: 'driver-1', dedupeKey: 'driver-1' });
    const second = await service.record({ type: 'mock_location', driverId: 'driver-1', dedupeKey: 'driver-1' });

    expect(first.recorded).toBe(true);
    expect(second).toEqual({ recorded: false, skipped: 'duplicate' });
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown types and never throws when Redis fails', async () => {
    const redis = createRedis();
    redis.hset.mockRejectedValue(new Error('redis down'));
    const { service } = build({ redis });

    await expect(service.record({ type: 'unknown', driverId: 'driver-1' }))
      .resolves.toEqual({ recorded: false, skipped: 'invalid' });
    await expect(service.record({ type: 'location_jump', driverId: 'driver-1' }))
      .resolves.toEqual({ recorded: false, error: 'redis down' });
  });

  it('returns the signal with the driver history for the dossier, newest first', async () => {
    const { service, tick } = build();
    const older = await service.record({ type: 'mock_location', driverId: 'driver-1' });
    tick(60000);
    const newer = await service.record({ type: 'location_jump', driverId: 'driver-1', details: { speedKmh: 900 } });
    tick(60000);
    await service.record({ type: 'mock_location', driverId: 'driver-2' });

    const signal = await service.get(newer.signalId);
    const list = await service.list({ limit: 10 });

    expect(signal).toMatchObject({ signalId: newer.signalId, details: { speedKmh: 900 }, driverSignalsLast30Days: 2 });
    expect(signal.history).toEqual([expect.objectContaining({ signalId: older.signalId, type: 'mock_location' })]);
    expect(list.map((item) => item.driverId)).toEqual(['driver-2', 'driver-1', 'driver-1']);
    await expect(service.get('SIG-missing')).resolves.toBeNull();
  });
});

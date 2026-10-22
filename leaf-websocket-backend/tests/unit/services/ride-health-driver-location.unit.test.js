jest.mock('../../../services/alert-service', () => ({
  sendAlert: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../services/bot-event-service', () => ({
  emit: jest.fn().mockResolvedValue({ queued: 1 })
}));

jest.mock('../../../utils/active-trip-index', () => ({
  resolveActiveTripForDriver: jest.fn()
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    setRideHealthStateCount: jest.fn(),
    setRideHealthStuckCount: jest.fn(),
    setRideHealthRecentCount: jest.fn(),
    recordRideHealthAlert: jest.fn()
  }
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const botEventService = require('../../../services/bot-event-service');
const { resolveActiveTripForDriver } = require('../../../utils/active-trip-index');
const {
  alertDriverOfflineDuringActiveRide,
  evaluateRideOperationsAlerts,
  syncDriverSignalForRide
} = require('../../../services/ride-health-monitor');

// Redis mínimo: sorted sets, hashes e SET NX PX (opcional, para testar o caminho do Redis).
function createRedis({ withSet = false } = {}) {
  const zsets = new Map();
  const hashes = new Map();
  const strings = new Map();
  const ensure = (key) => {
    if (!zsets.has(key)) zsets.set(key, []);
    return zsets.get(key);
  };
  const sorted = (key) => ensure(key).slice().sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
  const bound = (value, fallback) => {
    if (value === '+inf') return Number.POSITIVE_INFINITY;
    if (value === '-inf') return Number.NEGATIVE_INFINITY;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const redis = {
    seedHash(key, value) {
      hashes.set(key, { ...value });
    },
    pipeline() {
      const ops = [];
      const chain = {
        zrem(key, member) { ops.push(() => redis.zrem(key, member)); return chain; },
        zadd(key, score, member) { ops.push(() => redis.zadd(key, score, member)); return chain; },
        del(...keys) { ops.push(() => redis.del(...keys)); return chain; },
        exec() { return Promise.all(ops.map((op) => op())); }
      };
      return chain;
    },
    async hgetall(key) {
      return hashes.get(key) || {};
    },
    async del(...keys) {
      keys.forEach((key) => zsets.delete(key));
      return keys.length;
    },
    async zadd(key, score, member) {
      const list = ensure(key).filter((entry) => entry.member !== member);
      list.push({ member, score: Number(score) });
      zsets.set(key, list);
      return 1;
    },
    async zrem(key, member) {
      zsets.set(key, ensure(key).filter((entry) => entry.member !== member));
      return 1;
    },
    async zcard(key) {
      return ensure(key).length;
    },
    async zcount(key, min, max) {
      const lo = bound(min, Number.NEGATIVE_INFINITY);
      const hi = bound(max, Number.POSITIVE_INFINITY);
      return ensure(key).filter((entry) => entry.score >= lo && entry.score <= hi).length;
    },
    async zrange(key, start, stop, withScores) {
      const list = sorted(key);
      const end = stop < 0 ? list.length : stop + 1;
      const slice = list.slice(start, end);
      return withScores === 'WITHSCORES'
        ? slice.flatMap((entry) => [entry.member, String(entry.score)])
        : slice.map((entry) => entry.member);
    },
    async zrangebyscore(key, min, max, ...args) {
      const lo = bound(min, Number.NEGATIVE_INFINITY);
      const hi = bound(max, Number.POSITIVE_INFINITY);
      const withScores = args.includes('WITHSCORES');
      const limitAt = args.indexOf('LIMIT');
      const offset = limitAt >= 0 ? Number(args[limitAt + 1]) || 0 : 0;
      const count = limitAt >= 0 ? Number(args[limitAt + 2]) || Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
      const rows = sorted(key)
        .filter((entry) => entry.score >= lo && entry.score <= hi)
        .slice(offset, offset + count);
      return withScores ? rows.flatMap((entry) => [entry.member, String(entry.score)]) : rows.map((entry) => entry.member);
    },
    strings
  };

  if (withSet) {
    redis.set = jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && strings.has(key)) return null;
      strings.set(key, value);
      return 'OK';
    });
  }

  return redis;
}

const NOW_ISO = '2026-10-22T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

function emitCalls(type) {
  return botEventService.emit.mock.calls.filter(([eventType]) => eventType === type);
}

describe('ride-health-monitor: GPS do motorista em corrida ativa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    botEventService.emit.mockResolvedValue({ queued: 1 });
  });

  it('alerta corrida em andamento sem posição acima de 60 s e avisa o bot Operação', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-gps-1', { state: 'IN_PROGRESS', driverId: 'driver-gps-1' });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-gps-1', lastLocationAt: NOW_MS - 75000 });
    const alertClient = { sendAlert: jest.fn().mockResolvedValue(true) };

    const result = await evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO, alertClient });

    expect(alertClient.sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'critical',
      metric: 'driver_location_stale_active_ride',
      details: expect.objectContaining({ bookingIds: ['ride-gps-1'] })
    }));
    expect(result.alerts).toEqual([expect.objectContaining({ metric: 'driver_location_stale_active_ride' })]);
    expect(emitCalls('ride.driver_location_stale')).toEqual([[
      'ride.driver_location_stale',
      {
        bookingId: 'ride-gps-1',
        driverId: 'driver-gps-1',
        status: 'IN_PROGRESS',
        staleSeconds: 75,
        lastLocationAt: new Date(NOW_MS - 75000).toISOString()
      },
      expect.objectContaining({ severity: 'N2', dedupeKey: expect.any(String) })
    ]]);
  });

  it('não alerta corrida fora de andamento nem posição ainda dentro do limiar', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-notified-2', { state: 'NOTIFIED', driverId: 'driver-x' });
    redis.seedHash('booking:ride-fresh-2', { state: 'ACCEPTED', driverId: 'driver-y' });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-notified-2', lastLocationAt: NOW_MS - 300000 });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-fresh-2', lastLocationAt: NOW_MS - 30000 });
    const alertClient = { sendAlert: jest.fn().mockResolvedValue(true) };

    const result = await evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO, alertClient });

    expect(result.alerts.filter((alert) => alert.metric === 'driver_location_stale_active_ride')).toEqual([]);
    expect(emitCalls('ride.driver_location_stale')).toEqual([]);
  });

  it('cooldown por corrida: a mesma corrida não repete antes de 10 min, outra corrida alerta na hora', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-cd-a', { state: 'ARRIVED', driverId: 'driver-a' });
    redis.seedHash('booking:ride-cd-b', { state: 'IN_PROGRESS', driverId: 'driver-b' });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-cd-a', lastLocationAt: NOW_MS - 120000 });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-cd-b', lastLocationAt: NOW_MS - 120000 });

    await evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO });
    expect(emitCalls('ride.driver_location_stale').map(([, data]) => data.bookingId)).toEqual(['ride-cd-a', 'ride-cd-b']);

    await evaluateRideOperationsAlerts(redis, { nowIso: new Date(NOW_MS + 5 * 60000).toISOString() });
    expect(emitCalls('ride.driver_location_stale')).toHaveLength(2);

    await evaluateRideOperationsAlerts(redis, { nowIso: new Date(NOW_MS + 11 * 60000).toISOString() });
    expect(emitCalls('ride.driver_location_stale').map(([, data]) => data.bookingId))
      .toEqual(['ride-cd-a', 'ride-cd-b', 'ride-cd-a', 'ride-cd-b']);
  });

  it('usa SET NX do Redis para o cooldown quando disponível', async () => {
    const redis = createRedis({ withSet: true });
    redis.seedHash('booking:ride-nx-1', { state: 'IN_PROGRESS', driverId: 'driver-nx' });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-nx-1', lastLocationAt: NOW_MS - 90000 });
    redis.strings.set('ride_health:driver_location_alert:ride-nx-1', 'outra-replica');

    await evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO });

    expect(redis.set).toHaveBeenCalledWith('ride_health:driver_location_alert:ride-nx-1', expect.any(String), 'PX', 600000, 'NX');
    expect(emitCalls('ride.driver_location_stale')).toEqual([]);
  });

  it('falha ao avisar o bot ou o Discord não quebra o monitor', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-fail-1', { state: 'IN_PROGRESS', driverId: 'driver-f' });
    await syncDriverSignalForRide(redis, { bookingId: 'ride-fail-1', lastLocationAt: NOW_MS - 100000 });
    botEventService.emit.mockRejectedValueOnce(new Error('bot offline'));
    const alertClient = { sendAlert: jest.fn().mockRejectedValue(new Error('discord 500')) };

    const result = await evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO, alertClient });

    expect(result.snapshot.driverSignal.stale).toBe(1);
    expect(alertClient.sendAlert).toHaveBeenCalled();
    expect(result.alerts).toEqual([]);
  });

  it('falha ao consultar o índice não impede os alertas já existentes', async () => {
    const redis = createRedis();
    redis.zrangebyscore = jest.fn(async (...args) => {
      if (args[0] === 'ride_health:driver_signal_active' && args.includes('WITHSCORES')) {
        throw new Error('redis timeout');
      }
      return [];
    });

    await expect(evaluateRideOperationsAlerts(redis, { nowIso: NOW_ISO })).resolves.toEqual(expect.objectContaining({ alerts: [] }));
  });
});

describe('ride-health-monitor: motorista derrubado com corrida ativa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    botEventService.emit.mockResolvedValue({ queued: 1 });
  });

  it('emite ride.driver_offline_during_active para corrida em andamento', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-off-1', { state: 'IN_PROGRESS', driverId: 'driver-off-1' });
    resolveActiveTripForDriver.mockResolvedValueOnce({ tripId: 'ride-off-1', customerId: null });

    const result = await alertDriverOfflineDuringActiveRide(redis, {
      driverId: 'driver-off-1',
      lastSignalAtMs: NOW_MS - 120000,
      nowMs: NOW_MS
    });

    expect(result).toEqual({ alerted: true, result: { queued: 1 } });
    expect(emitCalls('ride.driver_offline_during_active')).toEqual([[
      'ride.driver_offline_during_active',
      {
        bookingId: 'ride-off-1',
        driverId: 'driver-off-1',
        status: 'IN_PROGRESS',
        staleSeconds: 120,
        lastLocationAt: new Date(NOW_MS - 120000).toISOString()
      },
      expect.objectContaining({ severity: 'N2' })
    ]]);
  });

  it('cooldown por corrida: segunda desconexão da mesma corrida dentro de 10 min não repete', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-off-2', { state: 'ACCEPTED', driverId: 'driver-off-2' });
    resolveActiveTripForDriver.mockResolvedValue({ tripId: 'ride-off-2', customerId: null });

    const first = await alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-off-2', lastSignalAtMs: NOW_MS - 120000, nowMs: NOW_MS });
    const second = await alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-off-2', lastSignalAtMs: NOW_MS - 120000, nowMs: NOW_MS + 60000 });

    expect(first.alerted).toBe(true);
    expect(second).toEqual({ alerted: false, reason: 'cooldown' });
    expect(emitCalls('ride.driver_offline_during_active')).toHaveLength(1);
  });

  it('não alerta motorista sem corrida ativa ou com corrida já encerrada', async () => {
    const redis = createRedis();
    redis.seedHash('booking:ride-done-3', { state: 'COMPLETED', driverId: 'driver-done-3' });

    resolveActiveTripForDriver.mockResolvedValueOnce({ tripId: null, customerId: null });
    expect(await alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-idle-3', lastSignalAtMs: NOW_MS, nowMs: NOW_MS }))
      .toEqual({ alerted: false, reason: 'no_active_ride' });

    resolveActiveTripForDriver.mockResolvedValueOnce({ tripId: 'ride-done-3', customerId: null });
    expect(await alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-done-3', lastSignalAtMs: NOW_MS, nowMs: NOW_MS }))
      .toEqual({ alerted: false, reason: 'ride_not_in_progress' });

    expect(emitCalls('ride.driver_offline_during_active')).toEqual([]);
  });

  it('erro na resolução da corrida ou no bot não lança para quem chama', async () => {
    const redis = createRedis();
    resolveActiveTripForDriver.mockRejectedValueOnce(new Error('ACTIVE_TRIP_ATOMIC_GUARD_UNAVAILABLE'));
    await expect(alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-err', lastSignalAtMs: NOW_MS, nowMs: NOW_MS }))
      .resolves.toEqual({ alerted: false, reason: 'error' });

    redis.seedHash('booking:ride-err-bot', { state: 'IN_PROGRESS', driverId: 'driver-err-bot' });
    resolveActiveTripForDriver.mockResolvedValueOnce({ tripId: 'ride-err-bot', customerId: null });
    botEventService.emit.mockRejectedValueOnce(new Error('bot down'));
    await expect(alertDriverOfflineDuringActiveRide(redis, { driverId: 'driver-err-bot', lastSignalAtMs: NOW_MS, nowMs: NOW_MS }))
      .resolves.toEqual(expect.objectContaining({ alerted: true }));
  });
});

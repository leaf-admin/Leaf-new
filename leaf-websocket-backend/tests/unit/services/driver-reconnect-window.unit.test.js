jest.mock('../../../utils/redis-pool', () => ({ ensureConnection: jest.fn(), getConnection: jest.fn() }));
jest.mock('../../../services/accepted-ride-recovery-service', () => ({
  ...jest.requireActual('../../../services/accepted-ride-recovery-service'),
  resolveAcceptedBookingCandidatesForDriver: jest.fn().mockResolvedValue({ bookingIds: ['booking_1'] }),
  recoverAcceptedBooking: jest.fn().mockResolvedValue({ recovered: true }),
}));
jest.mock('../../../services/driver-online-projection-service', () => ({ commitDriverOnlineProjection: jest.fn() }));
jest.mock('../../../services/driver-online-time-policy-service', () => ({ closeDriverOnlineSessionAt: jest.fn() }));
jest.mock('../../../utils/active-trip-index', () => ({ setActiveTripForDriver: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));
const redisPool = require('../../../utils/redis-pool');
const { recoverAcceptedBooking } = require('../../../services/accepted-ride-recovery-service');
const registerDisconnect = require('../../../bootstrap/register-socket-disconnect-handler');
const Monitor = require('../../../services/accepted-ride-recovery-monitor');

describe('driver reconnect window outlives volatile location cache', () => {
  const now = Date.parse('2026-10-23T04:00:00Z');
  let previousGrace;
  beforeEach(() => {
    jest.clearAllMocks();
    previousGrace = process.env.DRIVER_DISCONNECT_GRACE_MS;
    process.env.DRIVER_DISCONNECT_GRACE_MS = '90000';
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
    if (previousGrace === undefined) delete process.env.DRIVER_DISCONNECT_GRACE_MS;
    else process.env.DRIVER_DISCONNECT_GRACE_MS = previousGrace;
  });
  function setup() {
    // Redis semantics: HSET preserves an existing TTL; SET PX has its own TTL.
    const entries = new Map([
      ['driver:driver_1', { value: { isOnline: 'true', lat: '-22.92', lng: '-43.40', lastSeen: String(now - 300000) }, expires: now + 60000 }],
      ['booking:booking_1', { value: { status: 'ACCEPTED', driverId: 'driver_1', acceptedAt: new Date(now - 600000).toISOString() } }],
      ['active_trip_by_driver:driver_1', { value: 'booking_1' }],
    ]);
    const read = key => {
      const entry = entries.get(key);
      if (entry?.expires && entry.expires <= Date.now()) { entries.delete(key); return null; }
      return entry?.value ?? null;
    };
    const redis = {
      status: 'ready', hkeys: jest.fn().mockResolvedValue(['booking_1']),
      hgetall: jest.fn(async key => read(key) || {}), get: jest.fn(async key => read(key)),
      hset: jest.fn(async (key, fields) => { const value = { ...(read(key) || {}), ...fields }; entries.set(key, { value, expires: entries.get(key)?.expires }); return 1; }),
      set: jest.fn(async (key, value, mode, ttl) => { entries.set(key, { value, expires: mode === 'PX' ? Date.now() + ttl : undefined }); return 'OK'; }),
      del: jest.fn(async key => entries.delete(key)), hdel: jest.fn(), zrem: jest.fn(), srem: jest.fn(),
    };
    redisPool.getConnection.mockReturnValue(redis);
    const io = { engine: { clientsCount: 1 }, connectedUsers: new Map(), in: jest.fn(() => ({ fetchSockets: jest.fn().mockResolvedValue([]) })) };
    const handlers = {};
    const socket = { id: 'old_socket', userId: 'driver_1', userType: 'driver', on: jest.fn((name, fn) => { handlers[name] = fn; }) };
    registerDisconnect({ socket, io, redisPool, saveDriverLocation: jest.fn(), logStructured: jest.fn(),
      websocketRateLimiter: { unregisterConnection: jest.fn() }, connectionMonitor: { unregisterConnection: jest.fn() },
      vehicleLockManager: {}, releaseAdmissionSlotIfNeeded: jest.fn() });
    return { redis, io, handlers, monitor: new Monitor(io) };
  }
  it('preserves the accepted ride through 90 s even when its location hash expires at 60 s', async () => {
    const { handlers, redis, monitor } = setup();
    await handlers.disconnect('transport error');
    jest.setSystemTime(now + 61000);
    expect(await redis.hgetall('driver:driver_1')).toEqual({});
    await monitor.reconcile();
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it('still recovers a genuinely absent driver after the full reconnect window', async () => {
    const { handlers, monitor } = setup();
    await handlers.disconnect('transport error');
    jest.setSystemTime(now + 91000);
    await monitor.reconcile();
    expect(recoverAcceptedBooking).toHaveBeenCalledTimes(1);
  });
  it('checks other gateways before recovering a driver whose Redis presence expired', async () => {
    const { io, monitor } = setup();
    jest.setSystemTime(now + 100000);
    io.in.mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([{ id: 'live_remote_socket' }]) });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it('does not infer a missing driver from an unavailable socket adapter', async () => {
    const { io, monitor } = setup();
    jest.setSystemTime(now + 100000);
    io.in.mockReturnValue({ fetchSockets: jest.fn().mockRejectedValue(new Error('adapter unavailable')) });
    await expect(monitor.reconcile()).rejects.toThrow('adapter unavailable');
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
});

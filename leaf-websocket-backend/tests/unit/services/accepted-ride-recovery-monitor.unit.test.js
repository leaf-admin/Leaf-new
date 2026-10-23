jest.mock('../../../utils/redis-pool', () => ({ ensureConnection: jest.fn(), getConnection: jest.fn() }));
jest.mock('../../../services/accepted-ride-recovery-service', () => ({
  ...jest.requireActual('../../../services/accepted-ride-recovery-service'),
  recoverAcceptedBooking: jest.fn().mockResolvedValue({ recovered: true }),
}));
jest.mock('../../../utils/active-trip-index', () => ({ setActiveTripForDriver: jest.fn() }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));

const redisPool = require('../../../utils/redis-pool');
const { recoverAcceptedBooking } = require('../../../services/accepted-ride-recovery-service');
const AcceptedRideRecoveryMonitor = require('../../../services/accepted-ride-recovery-monitor');

describe('accepted ride recovery across gateways and reconnect grace', () => {
  const now = Date.parse('2026-10-23T03:00:00Z');
  let previousGrace;
  function setup({ presence = {}, deadline = null } = {}) {
    const redis = {
      hkeys: jest.fn().mockResolvedValue(['booking_1']),
      hgetall: jest.fn(async key => {
        if (key === 'booking:booking_1') return { driverId: 'driver_1', status: 'ACCEPTED', acceptedAt: new Date(now - 600000).toISOString() };
        if (key === 'driver:driver_1') return { isOnline: 'true', lastSeen: String(now - 300000), ...(deadline ? { socketReconnectUntilMs: String(deadline) } : {}) };
        if (key === 'driver_socket_presence:driver_1') return presence;
        return {};
      }),
      get: jest.fn().mockResolvedValue('booking_1'),
      hdel: jest.fn(),
    };
    redisPool.getConnection.mockReturnValue(redis);
    const io = { connectedUsers: new Map() };
    return { redis, monitor: new AcceptedRideRecoveryMonitor(io) };
  }
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    previousGrace = process.env.DRIVER_DISCONNECT_GRACE_MS;
    process.env.DRIVER_DISCONNECT_GRACE_MS = '90000';
  });
  afterEach(() => {
    jest.useRealTimers();
    if (previousGrace === undefined) delete process.env.DRIVER_DISCONNECT_GRACE_MS;
    else process.env.DRIVER_DISCONNECT_GRACE_MS = previousGrace;
  });
  it('keeps a driver connected on another gateway even when its local map and heartbeat are stale', async () => {
    const { monitor } = setup({ presence: { driverId: 'driver_1', userType: 'driver', socketId: 'remote_socket', connected: 'true',
      inDriverRoom: 'true', updatedAtMs: String(now), rooms: '["driver_driver_1"]' } });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it('does not bypass the disconnect handlers shared reconnect deadline', async () => {
    const { monitor } = setup({ deadline: now + 60000 });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it('honours a disconnect that occurs after the reconciliation pass starts', async () => {
    const { redis, monitor } = setup({ deadline: now + 91000 });
    const read = redis.hgetall.getMockImplementation();
    redis.hgetall.mockImplementation(async key => {
      if (key === 'driver:driver_1') jest.setSystemTime(now + 1000);
      return read(key);
    });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it('does not reassign a ride when distributed presence cannot be read', async () => {
    const { redis, monitor } = setup();
    const read = redis.hgetall.getMockImplementation();
    redis.hgetall.mockImplementation(key => key === 'driver_socket_presence:driver_1'
      ? Promise.reject(new Error('redis unavailable')) : read(key));
    await expect(monitor.reconcile()).rejects.toThrow('redis unavailable');
    expect(recoverAcceptedBooking).not.toHaveBeenCalled();
  });
  it.each([now - 1, now + 600000, null])('recovers a stale driver with no current reconnect window (%s)', async deadline => {
    const { monitor } = setup({ deadline });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 'booking_1', expectedDriverId: 'driver_1' }));
  });
  it('does not treat expired distributed presence as a live connection', async () => {
    const { monitor } = setup({ presence: { driverId: 'driver_1', userType: 'driver', socketId: 'remote_socket', connected: 'true',
      inDriverRoom: 'true', updatedAtMs: String(now - 300000) } });
    await monitor.reconcile();
    expect(recoverAcceptedBooking).toHaveBeenCalledTimes(1);
  });
});

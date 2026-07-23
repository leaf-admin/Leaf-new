const mockRedis = {
  eval: jest.fn(),
  get: jest.fn(),
  ttl: jest.fn(),
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis),
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const vehicleLockManager = require('../../../services/vehicle-lock-manager');

describe('vehicle-lock-manager session leases', () => {
  let locks;

  beforeEach(() => {
    jest.clearAllMocks();
    locks = new Map();

    mockRedis.eval.mockImplementation(async (script, keyCount, key, ...args) => {
      expect(keyCount).toBe(1);

      if (script.includes('driver_prefix')) {
        const [owner, driverId, driverPrefix, ttl] = args;
        const current = locks.get(key);
        if (!current) {
          locks.set(key, { owner, ttl: Number(ttl) });
          return [1, 'acquired'];
        }
        if (current.owner === owner) {
          current.ttl = Number(ttl);
          return [1, 'renewed'];
        }
        if (current.owner === driverId || current.owner.startsWith(driverPrefix)) {
          locks.set(key, { owner, ttl: Number(ttl) });
          return [1, 'transferred'];
        }
        return [0, current.owner];
      }

      if (script.includes("redis.call('DEL'")) {
        const [owner] = args;
        const current = locks.get(key);
        if (!current) return 1;
        if (current.owner !== owner) return 0;
        locks.delete(key);
        return 1;
      }

      const [owner, ttl] = args;
      const current = locks.get(key);
      if (!current || current.owner !== owner) return 0;
      current.ttl = Number(ttl);
      return 1;
    });
    mockRedis.get.mockImplementation(async key => locks.get(key)?.owner ?? null);
    mockRedis.ttl.mockImplementation(async key => locks.get(key)?.ttl ?? -2);
  });

  it('atomically rejects a competing driver and transfers the lease on same-driver reconnect', async () => {
    const first = await vehicleLockManager.acquireLock('abc-1d23', 'driver_1', {
      leaseToken: 'socket_old',
    });
    const competing = await vehicleLockManager.acquireLock('ABC1D23', 'driver_2', {
      leaseToken: 'socket_other',
    });
    const reconnect = await vehicleLockManager.acquireLock('ABC 1D23', 'driver_1', {
      leaseToken: 'socket_new',
    });

    expect(first).toEqual(expect.objectContaining({ success: true, leaseToken: 'socket_old' }));
    expect(competing).toEqual(expect.objectContaining({
      success: false,
      currentDriver: 'driver_1',
    }));
    expect(reconnect).toEqual(expect.objectContaining({
      success: true,
      leaseToken: 'socket_new',
      transferred: true,
    }));
    expect(locks.get('vehicle_lock:ABC1D23')).toEqual({
      owner: 'driver_1::lease::socket_new',
      ttl: 180,
    });
    await expect(vehicleLockManager.getLockOwner('ABC1D23')).resolves.toEqual({
      driverId: 'driver_1',
      leaseToken: 'socket_new',
    });
    expect(mockRedis.eval).toHaveBeenCalledTimes(3);
  });

  it('does not let an old disconnected socket delete or renew the new session lease', async () => {
    await vehicleLockManager.acquireLock('ABC1D23', 'driver_1', { leaseToken: 'socket_old' });
    await vehicleLockManager.acquireLock('ABC1D23', 'driver_1', { leaseToken: 'socket_new' });

    await expect(vehicleLockManager.releaseLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_old',
    })).resolves.toBe(false);
    await expect(vehicleLockManager.renewLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_old',
    })).resolves.toBe(false);
    expect(locks.get('vehicle_lock:ABC1D23')?.owner).toBe('driver_1::lease::socket_new');

    await expect(vehicleLockManager.releaseLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_new',
    })).resolves.toBe(true);
    expect(locks.has('vehicle_lock:ABC1D23')).toBe(false);
  });

  it('applies the configured TTL only when the current session renews the lease', async () => {
    await vehicleLockManager.acquireLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_1',
      ttl: 30,
    });
    expect(await vehicleLockManager.getLockTTL('ABC1D23')).toBe(30);

    await expect(vehicleLockManager.renewLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_wrong',
      ttl: 90,
    })).resolves.toBe(false);
    expect(await vehicleLockManager.getLockTTL('ABC1D23')).toBe(30);

    await expect(vehicleLockManager.renewLock('ABC1D23', 'driver_1', {
      leaseToken: 'socket_1',
      ttl: 90,
    })).resolves.toBe(true);
    expect(await vehicleLockManager.getLockTTL('ABC1D23')).toBe(90);
  });

  it('fails closed when a session token is missing', async () => {
    await expect(vehicleLockManager.acquireLock('ABC1D23', 'driver_1')).resolves.toEqual(
      expect.objectContaining({ success: false })
    );
    await expect(vehicleLockManager.renewLock('ABC1D23', 'driver_1')).resolves.toBe(false);
    await expect(vehicleLockManager.releaseLock('ABC1D23', 'driver_1')).resolves.toBe(false);
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});

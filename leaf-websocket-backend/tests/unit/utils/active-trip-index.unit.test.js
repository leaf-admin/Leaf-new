const {
  ACTIVE_TRIP_TTL_SECONDS,
  setActiveTripForDriver,
  clearActiveTripForDriver,
  resolveActiveTripForDriver
} = require('../../../utils/active-trip-index');

function createRedisMock() {
  const tx = {
    set: jest.fn().mockReturnThis(),
    hset: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    hdel: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(true)
  };

  return {
    tx,
    redis: {
      multi: jest.fn(() => tx),
      get: jest.fn(),
      set: jest.fn(),
      hset: jest.fn(),
      hdel: jest.fn()
    }
  };
}

describe('active-trip-index', () => {
  test('setActiveTripForDriver should write trip and customer indexes', async () => {
    const { redis, tx } = createRedisMock();

    const result = await setActiveTripForDriver(redis, 'driver-1', 'booking-1', 'customer-1');

    expect(result).toBe(true);
    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(tx.set).toHaveBeenCalledWith('active_trip_by_driver:driver-1', 'booking-1', 'EX', ACTIVE_TRIP_TTL_SECONDS);
    expect(tx.set).toHaveBeenCalledWith('active_trip_customer_by_driver:driver-1', 'customer-1', 'EX', ACTIVE_TRIP_TTL_SECONDS);
    expect(tx.hset).toHaveBeenCalledWith('driver:driver-1', expect.objectContaining({
      activeTripId: 'booking-1'
    }));
    expect(tx.exec).toHaveBeenCalledTimes(1);
  });

  test('clearActiveTripForDriver should not clear when expected trip differs', async () => {
    const { redis } = createRedisMock();
    redis.get.mockResolvedValue('booking-2');

    const result = await clearActiveTripForDriver(redis, 'driver-1', 'booking-1');

    expect(result).toBe(false);
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test('resolveActiveTripForDriver should return trip/customer pair', async () => {
    const { redis } = createRedisMock();
    redis.get
      .mockResolvedValueOnce('booking-1')
      .mockResolvedValueOnce('customer-1');

    const resolved = await resolveActiveTripForDriver(redis, 'driver-1');

    expect(resolved).toEqual({
      tripId: 'booking-1',
      customerId: 'customer-1'
    });
  });
});

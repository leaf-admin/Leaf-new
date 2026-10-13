const {
  PENDING_HASH_KEY,
  recordPendingCancellationCredit,
  clearPendingCancellationCredit,
  listDuePendingCancellationCredits,
  registerPendingAttempt
} = require('../../../services/cancellation-credit-pending-service');

function createRedis() {
  const store = {};
  return {
    store,
    hset: jest.fn(async (key, field, value) => {
      store[field] = value;
    }),
    hdel: jest.fn(async (key, field) => {
      delete store[field];
    }),
    hgetall: jest.fn(async () => ({ ...store }))
  };
}

describe('cancellation-credit-pending-service', () => {
  it('records what is owed to the driver', async () => {
    const redis = createRedis();

    const recorded = await recordPendingCancellationCredit(redis, {
      bookingId: 'booking_1',
      driverId: 'driver_1',
      cancellationFee: 300,
      financialContext: { namespace: 'sandbox' }
    });

    expect(recorded).toBe(true);
    expect(redis.hset).toHaveBeenCalledWith(PENDING_HASH_KEY, 'booking_1', expect.any(String));
    expect(JSON.parse(redis.store.booking_1)).toMatchObject({
      bookingId: 'booking_1',
      driverId: 'driver_1',
      cancellationFee: 300,
      attempts: 0
    });
  });

  it('records nothing without fee or driver', async () => {
    const redis = createRedis();

    expect(await recordPendingCancellationCredit(redis, { bookingId: 'b', driverId: 'd', cancellationFee: 0 })).toBe(false);
    expect(await recordPendingCancellationCredit(redis, { bookingId: 'b', cancellationFee: 300 })).toBe(false);
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('lists only entries older than the minimum age and ignores broken ones', async () => {
    const redis = createRedis();
    const now = 1_000_000;
    redis.store.old = JSON.stringify({ bookingId: 'old', createdAt: now - 200000 });
    redis.store.fresh = JSON.stringify({ bookingId: 'fresh', createdAt: now - 1000 });
    redis.store.broken = '{not json';

    const due = await listDuePendingCancellationCredits(redis, { now, minAgeMs: 120000 });

    expect(due.map((entry) => entry.bookingId)).toEqual(['old']);
  });

  it('counts attempts and clears the entry', async () => {
    const redis = createRedis();
    await recordPendingCancellationCredit(redis, { bookingId: 'booking_1', driverId: 'driver_1', cancellationFee: 300 });

    const updated = await registerPendingAttempt(redis, JSON.parse(redis.store.booking_1), 'ledger down');
    expect(updated).toMatchObject({ attempts: 1, lastError: 'ledger down' });

    await clearPendingCancellationCredit(redis, 'booking_1');
    expect(redis.store.booking_1).toBeUndefined();
  });
});

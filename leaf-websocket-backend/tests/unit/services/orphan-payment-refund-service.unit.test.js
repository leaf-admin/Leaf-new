jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));

const {
  DUE_KEY,
  REFUND_REASON,
  scheduleOrphanCheck,
  processDueOrphanChecks
} = require('../../../services/orphan-payment-refund-service');

const RIDE = 'temp_ride_session_abc';
const CONTEXT = { namespace: 'sandbox', contextId: 'ctx-1' };

function fakeRedis({ activeBooking = null, bookingReference = null } = {}) {
  const zset = new Map();
  return {
    zset,
    zadd: jest.fn(async (key, ...args) => {
      const nx = args[0] === 'NX';
      const [score, member] = nx ? args.slice(1) : args;
      if (nx && zset.has(member)) return 0;
      zset.set(member, Number(score));
      return 1;
    }),
    zrangebyscore: jest.fn(async (_key, min, max) =>
      [...zset.entries()].filter(([, score]) => score >= min && score <= max).map(([member]) => member)),
    zrem: jest.fn(async (_key, member) => (zset.delete(member) ? 1 : 0)),
    get: jest.fn(async (key) => (key === 'customer_active_booking:p1' ? activeBooking : null)),
    hget: jest.fn(async () => bookingReference)
  };
}

function fakeFirestore(holding) {
  const get = jest.fn(async () => ({ exists: Boolean(holding), data: () => holding }));
  return { get, collection: jest.fn(() => ({ doc: jest.fn(() => ({ get })) })) };
}

const heldPayment = (overrides = {}) => ({
  status: 'in_holding',
  amount: 4598,
  chargeId: 'charge-1',
  passengerId: 'p1',
  financialContext: CONTEXT,
  ...overrides
});

describe('orphan-payment-refund-service', () => {
  it('schedules a temporary ride once, per namespace, after the delay', async () => {
    const redis = fakeRedis();
    await expect(scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 1000 })).resolves.toBe(true);
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 5000 });
    expect(redis.zset.get(`sandbox:${RIDE}`)).toBe(1000 + 10 * 60 * 1000);

    await expect(scheduleOrphanCheck(redis, 'booking_123_p1', { namespace: 'sandbox' })).resolves.toBe(false);
    await expect(scheduleOrphanCheck(redis, RIDE, { namespace: 'other' })).resolves.toBe(false);
    await expect(scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', env: { ENABLE_ORPHAN_PAYMENT_REFUND: 'false' } }))
      .resolves.toBe(false);
  });

  it('refunds the full amount of a held payment that never became a booking', async () => {
    const redis = fakeRedis();
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 0 });
    const firestore = fakeFirestore(heldPayment());
    const paymentService = { processRideRefund: jest.fn().mockResolvedValue({ success: true }) };

    await expect(processDueOrphanChecks({ redis, firestore, paymentService, now: 11 * 60 * 1000 }))
      .resolves.toEqual([{ rideId: RIDE, outcome: 'refunded' }]);
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_payment_holdings');
    expect(paymentService.processRideRefund).toHaveBeenCalledWith(expect.objectContaining({
      rideId: RIDE,
      chargeId: 'charge-1',
      amount: 4598,
      reason: REFUND_REASON,
      passengerId: 'p1',
      financialContext: CONTEXT
    }));
    expect(redis.zset.size).toBe(0);
  });

  it('does nothing before the due time', async () => {
    const redis = fakeRedis();
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 0 });
    const paymentService = { processRideRefund: jest.fn() };
    await expect(processDueOrphanChecks({ redis, firestore: fakeFirestore(heldPayment()), paymentService, now: 60 * 1000 }))
      .resolves.toEqual([]);
    expect(redis.zset.size).toBe(1);
  });

  it.each([
    ['the holding has a booking', heldPayment({ bookingId: 'booking_1' }), {}, 'has_booking'],
    ['the active booking uses this payment', heldPayment(), { activeBooking: 'booking_1', bookingReference: RIDE }, 'has_booking'],
    ['the payment was already distributed or refunded', heldPayment({ status: 'distributed' }), {}, 'not_held'],
    ['there is no holding', null, {}, 'no_holding']
  ])('never refunds when %s', async (_label, holding, redisState, outcome) => {
    const redis = fakeRedis(redisState);
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 0 });
    const paymentService = { processRideRefund: jest.fn() };
    await expect(processDueOrphanChecks({ redis, firestore: fakeFirestore(holding), paymentService, now: 11 * 60 * 1000 }))
      .resolves.toEqual([{ rideId: RIDE, outcome }]);
    expect(paymentService.processRideRefund).not.toHaveBeenCalled();
  });

  it('re-queues a failed refund for a later attempt', async () => {
    const redis = fakeRedis();
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 0 });
    const paymentService = { processRideRefund: jest.fn().mockResolvedValue({ success: false, code: 'WOOVI_DOWN' }) };
    const now = 11 * 60 * 1000;
    await expect(processDueOrphanChecks({ redis, firestore: fakeFirestore(heldPayment()), paymentService, now }))
      .resolves.toEqual([{ rideId: RIDE, outcome: 'refund_failed' }]);
    expect(redis.zset.get(`sandbox:${RIDE}`)).toBe(now + 10 * 60 * 1000);
  });

  it('skips an entry another leader already claimed', async () => {
    const redis = fakeRedis();
    await scheduleOrphanCheck(redis, RIDE, { namespace: 'sandbox', now: 0 });
    redis.zrem.mockResolvedValueOnce(0);
    const paymentService = { processRideRefund: jest.fn() };
    await expect(processDueOrphanChecks({ redis, firestore: fakeFirestore(heldPayment()), paymentService, now: 11 * 60 * 1000 }))
      .resolves.toEqual([]);
    expect(paymentService.processRideRefund).not.toHaveBeenCalled();
    expect(DUE_KEY).toBe('payment:orphan_refund_due');
  });
});

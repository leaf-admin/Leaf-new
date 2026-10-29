const store = require('../../../services/ride-route-plan-store');

function fakeRedis(initial = {}) {
  const values = new Map(Object.entries(initial));
  const hashes = new Map();
  return {
    values,
    hashes,
    get: jest.fn(async (key) => values.get(key) ?? null),
    setex: jest.fn(async (key, _ttl, value) => { values.set(key, value); return 'OK'; }),
    set: jest.fn(async (key, value, _ex, _ttl, nx) => {
      if (nx === 'NX' && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    }),
    hgetall: jest.fn(async (key) => hashes.get(key) || {}),
  };
}

const request = {
  bookingId: 'booking_1',
  pickup: { lat: -22.9213, lng: -43.3722 },
  destination: { lat: -23.0007, lng: -43.3524 },
};

describe('ride route plan store', () => {
  it('only lets the ride passenger and driver read the plan', async () => {
    const redis = fakeRedis();
    redis.hashes.set('booking:booking_1', { customerId: 'pax_1', driverId: 'drv_1' });
    await expect(store.isRideParticipant(redis, 'booking_1', 'pax_1')).resolves.toBe(true);
    await expect(store.isRideParticipant(redis, 'booking_1', 'drv_1')).resolves.toBe(true);
    await expect(store.isRideParticipant(redis, 'booking_1', 'someone')).resolves.toBe(false);
    await expect(store.isRideParticipant(redis, 'booking_1', null)).resolves.toBe(false);
  });

  it('computes once: the first request owns it, the next one gets the saved plan', async () => {
    const redis = fakeRedis();
    const first = await store.claimOrWait(redis, request);
    expect(first).toEqual({ owner: true });
    await store.savePlan(redis, { ...request, data: { polylinePoints: 'abc', legs: [{}, {}] } });

    const second = await store.claimOrWait(redis, request);
    expect(second.plan.data.polylinePoints).toBe('abc');
  });

  it('waits for the plan another device is computing', async () => {
    const redis = fakeRedis();
    await store.claimOrWait(redis, request);
    setTimeout(() => {
      store.savePlan(redis, { ...request, data: { polylinePoints: 'late' } });
    }, 200);
    const waiting = await store.claimOrWait(redis, request);
    expect(waiting.plan.data.polylinePoints).toBe('late');
  });

  it('ignores a saved plan when the pickup moved', async () => {
    const redis = fakeRedis();
    await store.savePlan(redis, { ...request, data: { polylinePoints: 'old' } });
    redis.values.delete(`${store.planKey('booking_1')}:lock`);
    const moved = await store.claimOrWait(redis, { ...request, pickup: { lat: -22.93, lng: -43.3722 } });
    expect(moved).toEqual({ owner: true });
  });

  it('parses waypoints sent as text or list', () => {
    expect(store.firstWaypoint('-22.9,-43.3|-22.8,-43.2')).toEqual({ lat: -22.9, lng: -43.3 });
    expect(store.firstWaypoint(['-22.9,-43.3'])).toEqual({ lat: -22.9, lng: -43.3 });
    expect(store.firstWaypoint(null)).toBeNull();
  });
});

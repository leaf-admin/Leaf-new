jest.mock('firebase-admin', () => ({ apps: [], credential: { applicationDefault: jest.fn() } }));
jest.mock('../../../utils/logger', () => ({ logStructured: jest.fn() }));

const service = require('../../../services/google-usage-cost-service');

function createRedis() {
  const hashes = new Map();
  const zsets = new Map();
  const redis = {
    hashes,
    async hset(key, fields) { hashes.set(key, { ...(hashes.get(key) || {}), ...fields }); },
    async hgetall(key) { return { ...(hashes.get(key) || {}) }; },
    async del(key) { hashes.delete(key); },
    async expire() {},
    async zadd(key, score, member) { const z = zsets.get(key) || new Map(); z.set(member, score); zsets.set(key, z); },
    async zremrangebyscore(key, min, max) { const z = zsets.get(key) || new Map(); for (const [m, s] of z) if (s >= min && s <= max) z.delete(m); },
    async zcount(key, min, max) { return [...(zsets.get(key) || new Map()).values()].filter((s) => s >= min && s <= max).length; },
    pipeline() {
      const ops = [];
      const chain = {
        del: (...args) => { ops.push(['del', args]); return chain; },
        hset: (...args) => { ops.push(['hset', args]); return chain; },
        expire: (...args) => { ops.push(['expire', args]); return chain; },
        hgetall: (...args) => { ops.push(['hgetall', args]); return chain; },
        exec: async () => {
          const results = [];
          for (const [op, args] of ops) results.push([null, await redis[op](...args)]);
          return results;
        }
      };
      return chain;
    }
  };
  return redis;
}

const NOW = Date.parse('2026-10-30T12:30:00Z');

function point(minuteIso, count) {
  return { interval: { startTime: `${minuteIso}:00Z`, endTime: `${minuteIso}:59Z` }, value: { int64Value: String(count) } };
}

function fakeFetch(apiSeries, firestore = {}) {
  return jest.fn(async (url) => {
    const filter = new URL(url).searchParams.get('filter');
    let timeSeries = apiSeries;
    for (const kind of ['read', 'write', 'delete']) {
      if (filter.includes(`document/${kind}_count`)) timeSeries = firestore[kind] || [];
    }
    return { ok: true, json: async () => ({ timeSeries }) };
  });
}

describe('google usage cost', () => {
  it('prices known methods, free native maps and unknown paid methods at the top rate', () => {
    expect(service.priceFor('routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes')).toBe(10);
    expect(service.priceFor('maps-ios-backend.googleapis.com|google.maps.BaseMap.IOS')).toBe(0);
    expect(service.priceFor('places-backend.googleapis.com|google.places.SomethingNew')).toBe(32);
    expect(service.costUsd({ 'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes': 2, 'geocoding-backend.googleapis.com|google.places.Geocoding.Http': 1 }))
      .toBeCloseTo(0.025, 6);
  });

  it('stores what Google counted per minute and per hour, ignoring non-maps APIs', async () => {
    const redis = createRedis();
    const fetchImpl = fakeFetch([
      { resource: { labels: { service: 'routes.googleapis.com', method: 'google.maps.routing.v2.Routes.ComputeRoutes' } }, points: [point('2026-10-30T12:20', 2)] },
      { resource: { labels: { service: 'firebaseinstallations.googleapis.com', method: 'x' } }, points: [point('2026-10-30T12:20', 50)] }
    ], { read: [{ points: [point('2026-10-30T12:20', 961)] }] });

    await service.collectGoogleUsage(redis, { projectId: 'p', nowMs: NOW, token: 't', fetchImpl });

    expect(await redis.hgetall(service.minuteKey(Date.parse('2026-10-30T12:20:00Z')))).toEqual({
      'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes': 2,
      'firestore|read': 961
    });
    expect(await redis.hgetall(service.hourKey(NOW))).toEqual(expect.objectContaining({ 'firestore|read': 961 }));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('counts each completed ride once and divides the cost by rides in the window', async () => {
    const redis = createRedis();
    await redis.hset(service.minuteKey(NOW - 10 * 60000), {
      'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes': 4,
      'geocoding-backend.googleapis.com|google.places.Geocoding.Http': 2
    });
    await service.recordRideCompletionForCost(redis, 'booking_1', NOW - 5 * 60000);
    await service.recordRideCompletionForCost(redis, 'booking_1', NOW - 4 * 60000);
    await service.recordRideCompletionForCost(redis, 'booking_2', NOW - 3 * 60000);

    const window = await service.readWindow(redis, { hours: 1, nowMs: NOW });

    expect(window.rides).toBe(2);
    expect(window.routesPerRide).toBe(2);
    expect(window.costPerRideUsd).toBeCloseTo(0.025, 6);
  });

  it('includes the current hour in day and week windows', async () => {
    const redis = createRedis();
    await redis.hset(service.hourKey(NOW), { 'firestore|read': 500 });
    await redis.hset(service.hourKey(NOW - 23 * 3600000), { 'firestore|read': 100 });
    await redis.hset(service.hourKey(NOW - 24 * 3600000), { 'firestore|read': 999 });

    const day = await service.readWindow(redis, { hours: 24, nowMs: NOW });

    expect(day.counts['firestore|read']).toBe(600);
  });

  it('alerts on paid routes without rides and on more routes per ride than the plan', () => {
    const routes = (count) => ({ 'routes.googleapis.com|google.maps.routing.v2.Routes.ComputeRoutes': count });
    const idle = service.evaluateCostAlerts({
      lastHour: { rides: 0, counts: routes(40), costUsd: 0.4 },
      last6h: { rides: 0, counts: routes(40), costUsd: 0.4 }
    });
    expect(idle.map((alert) => alert.metric)).toEqual(['google_routes_without_rides']);
    expect(idle[0]).toMatchObject({ severity: 'critical', service: 'google-cost' });

    const heavy = service.evaluateCostAlerts({
      lastHour: { rides: 2, counts: routes(10), costUsd: 0.1 },
      last6h: { rides: 4, counts: routes(20), costUsd: 0.2, costPerRideUsd: 0.05, routesPerRide: 5 }
    });
    expect(heavy.map((alert) => alert.metric)).toEqual(['google_routes_per_ride']);

    const healthy = service.evaluateCostAlerts({
      lastHour: { rides: 1, counts: routes(2), costUsd: 0.02 },
      last6h: { rides: 5, counts: routes(10), costUsd: 0.125, costPerRideUsd: 0.025, routesPerRide: 2 }
    });
    expect(healthy).toEqual([]);
  });

  it('builds the dashboard snapshot from the stored buckets', async () => {
    const redis = createRedis();
    await redis.hset(service.minuteKey(NOW - 60000), { 'firestore|read': 1000 });
    await redis.hset(service.hourKey(NOW), { 'firestore|read': 1000 });

    const snapshot = await service.getCostSnapshot(redis, { nowMs: NOW });

    expect(snapshot.windows['1h'].items[0]).toMatchObject({ field: 'firestore|read', count: 1000 });
    expect(snapshot.hourly).toHaveLength(24);
    expect(snapshot.hourly[23].costUsd).toBeCloseTo(0.0006, 6);
  });
});

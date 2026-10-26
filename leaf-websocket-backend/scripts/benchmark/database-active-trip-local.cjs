#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const withPrivateRedis = require('./private-redis.cjs');
const { resolveActiveTripForDriver, renewActiveTripForDriver } = require('../../utils/active-trip-index');
const { readLocationBooking } = require('../../utils/active-trip-location-snapshot');

withPrivateRedis(async redis => {
  const rows = [];
  const calls = [];
  const measured = new Proxy(redis, { get(target, command) {
    if (typeof target[command] !== 'function') return target[command];
    return async (...args) => {
      assert.notEqual(args[0], 'bookings:active', 'GPS cannot read the global active hash');
      const value = await target[command](...args);
      calls.push({ command, bytes: Buffer.byteLength(JSON.stringify(value) ?? '') });
      return value;
    };
  } });
  for (const count of [100, 1000, 10000]) {
    for (let start = 0; start < count; start += 200) {
      const batch = redis.pipeline();
      for (let i = start; i < Math.min(count, start + 200); i++) {
        batch.hset('bookings:active', `external-${i}`, JSON.stringify({ driverId: `other-${i}`, status: 'STARTED' }));
      }
      assert.ok((await batch.exec()).every(([error]) => !error));
    }
    await redis.del('active_trip_by_driver:driver', 'driver:driver');
    calls.length = 0;
    assert.equal((await resolveActiveTripForDriver(measured, 'driver')).tripId, null);
    const missing = [...calls];
    await redis.hset('driver:driver', { activeTripId: 'mine', activeTripLeaseUntilMs: Date.now() + 60000 });
    await redis.hset('booking:mine', { bookingId: 'mine', driverId: 'driver', status: 'STARTED', customerId: 'owner', routePlan: 'x'.repeat(100000) });
    calls.length = 0;
    assert.equal((await resolveActiveTripForDriver(measured, 'driver')).tripId, 'mine');
    const bookingData = await readLocationBooking(measured, 'mine');
    assert.equal(bookingData.routePlan, undefined);
    assert.equal(await renewActiveTripForDriver(measured, 'driver', 'mine', { bookingData }), true);
    const recovered = [...calls];
    assert.equal(await redis.get('active_trip_by_driver:driver'), 'mine');
    await redis.del('active_trip_by_driver:driver');
    await redis.hset('driver:driver', 'activeTripLeaseUntilMs', Date.now() - 1);
    assert.equal((await resolveActiveTripForDriver(measured, 'driver')).tripId, null);
    rows.push({ unrelatedActiveRides: count, missing, recovered });
  }
  assert.deepEqual(rows.map(row => row.missing.length), [1, 1, 1]);
  assert.deepEqual(rows.map(row => row.recovered.length), [3, 3, 3]);
  console.log(JSON.stringify({ environment: 'Private local Redis; synthetic records; no Firebase or production credentials', rows,
    limitations: 'Command/byte and lease recovery evidence; not app throughput or deployed-state evidence' }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const withPrivateRedis = require('./private-redis.cjs');
const loadH3 = require('./isolated-h3-service.cjs');
const region = require('../../services/map-regional-index');
// These flags affect only this short-lived, isolated benchmark process.
process.env.ENABLE_H3_REGIONAL_WRITES = 'true';
process.env.ENABLE_H3_REGIONAL_READS = 'true';

withPrivateRedis(async redis => {
  const service = loadH3();
  const baseline = loadH3({ baseline: true });
  let allowGlobalForBaseline = false;
  const bbox = { minLat: -23.57, maxLat: -23.54, minLng: -46.65, maxLng: -46.62 };
  const pickup = { lat: -23.55, lng: -46.63 };
  await assert.rejects(service.collectSnapshot(redis, bbox), /conciliação/);
  const generation = 'synthetic-local-generation';
  await redis.set('leaf:runtime:critical-dataset:generation', generation);
  await redis.set(region.READY_KEY, JSON.stringify({ schema: 1, generation }));
  for (let i = 0; i < 2; i++) {
    const id = `inside-${i}`;
    await redis.hset(`booking_search:${id}`, { state: 'SEARCHING', pickupLocation: JSON.stringify(pickup), createdAt: Date.now() });
    await region.indexSearch(redis, id);
    await redis.hset(`booking:${id}`, { status: 'IN_PROGRESS', driverId: `driver-${i}` });
    await redis.hset('bookings:active', id, JSON.stringify({ status: 'IN_PROGRESS', driverId: `driver-${i}`, currentLocation: pickup, updatedAt: Date.now() }));
    await region.indexTrip(redis, { bookingId: id, status: 'IN_PROGRESS', driverId: `driver-${i}`, currentLocation: pickup });
    await redis.geoadd('driver_locations', pickup.lng, pickup.lat, `driver-${i}`);
    await redis.geoadd('driver_locations_eligible', pickup.lng, pickup.lat, `driver-${i}`);
    await redis.hset(`driver:driver-${i}`, { status: 'available', isOnline: 'true', unusedLargeField: 'x'.repeat(100000) });
  }
  const calls = [];
  const forbid = (command, args) => {
    if (allowGlobalForBaseline && command === 'hgetall' && args[0] === 'bookings:active') return;
    assert.ok(!['keys', 'scan', 'smembers', 'hgetall', 'zrange'].includes(command), `Unbounded read ${command} forbidden`);
    assert.notEqual(args[0], 'bookings:active');
  };
  const client = new Proxy({}, { get(_target, command) {
    if (command === 'pipeline') return () => {
      const pipeline = redis.pipeline();
      const queued = [];
      const wrapper = new Proxy({}, { get(_p, op) {
        if (op === 'exec') return async () => {
          const result = await pipeline.exec();
          result.forEach(([error, value], i) => { if (error) throw error;
            calls.push({ command: queued[i], bytes: Buffer.byteLength(JSON.stringify(value) ?? '') }); });
          return result;
        };
        return (...args) => { forbid(op, args); queued.push(op); pipeline[op](...args); return wrapper; };
      } });
      return wrapper;
    };
    return async (...args) => {
      forbid(command, args);
      const value = await redis[command](...args);
      calls.push({ command, bytes: Buffer.byteLength(JSON.stringify(value) ?? '') });
      return value;
    };
  } });
  let previous = 0;
  const rows = [];
  for (const outside of [1000, 10000, 100000]) {
    for (let start = previous; start < outside; start += 200) {
      const batch = redis.pipeline();
      for (let i = start; i < Math.min(outside, start + 200); i++) {
        batch.hset('bookings:active', `outside-${i}`, JSON.stringify({ status: 'IN_PROGRESS', currentLocation: { lat: -22, lng: -43 }, updatedAt: Date.now() }));
        for (const kind of ['search', 'trip']) {
          batch.geoadd(`${region.PREFIX}:${kind}:geo`, -43, -22, `outside-${i}`);
          batch.hset(`${region.PREFIX}:${kind}:data`, `outside-${i}`, JSON.stringify({ bookingId: `outside-${i}`, location: { lat: -22, lng: -43 } }));
          batch.zadd(`${region.PREFIX}:${kind}:expires`, Date.now() + 3600000, `outside-${i}`);
        }
      }
      assert.ok((await batch.exec()).every(([error]) => !error));
    }
    previous = outside; calls.length = 0;
    const snapshot = await service.collectSnapshot(client, bbox);
    assert.equal(snapshot.drivers.length, 2);
    assert.equal(snapshot.openRequests.length, 2);
    assert.equal(snapshot.activeTrips.length, 2);
    const after = { commands: calls.length, replyBytes: calls.reduce((sum, row) => sum + row.bytes, 0), operations: calls.map(row => row.command) };
    calls.length = 0; allowGlobalForBaseline = true;
    const before = await baseline.collectActiveTrips(client, bbox);
    allowGlobalForBaseline = false;
    assert.equal(before.length, snapshot.activeTrips.length);
    rows.push({ outsideRecordsPerKind: outside, regionalRecordsPerKind: 2, ...after,
      beforeActiveTripsOnly: { commands: calls.length, replyBytes: calls.reduce((sum, row) => sum + row.bytes, 0) } });
  }
  assert.equal(new Set(rows.map(row => row.commands)).size, 1);
  assert.equal(new Set(rows.map(row => row.replyBytes)).size, 1);
  await redis.hset('booking:inside-0', 'status', 'COMPLETED');
  assert.equal((await service.collectActiveTrips(client, bbox)).length, 1);
  await region.indexTrip(redis, { bookingId: 'inside-1', status: 'IN_PROGRESS', currentLocation: { lat: -22, lng: -43 } });
  assert.equal((await service.collectActiveTrips(client, bbox)).length, 0);
  await redis.set('leaf:runtime:critical-dataset:generation', 'replaced-generation');
  await assert.rejects(service.collectActiveTrips(client, bbox), /conciliação/);
  await redis.set('leaf:runtime:critical-dataset:generation', generation);
  await redis.del(`${region.PREFIX}:search:geo`, `${region.PREFIX}:search:expires`, `${region.PREFIX}:search:data`);
  for (let i = 0; i <= region.MAX_MEMBERS; i++) await redis.geoadd(`${region.PREFIX}:search:geo`, pickup.lng, pickup.lat, `dense-${i}`);
  await assert.rejects(service.collectOpenRequests(client, bbox), /excede orçamento/);
  // Exercise the bounded legacy active-hash Lua too, with real Redis.
  process.env.ENABLE_H3_REGIONAL_READS = 'false';
  await redis.del('bookings:active');
  for (let i = 0; i <= 200; i++) await redis.hset('bookings:active', `legacy-${i}`, '{}');
  await assert.rejects(service.collectActiveTrips(redis, bbox), /BUDGET_EXCEEDED/);
  console.log(JSON.stringify({ environment: 'Private Redis, real regional writers and H3 reader; no credentials or external imports', rows,
    checks: ['Terminal filtered by canonical backend status', 'Movement removes old-region membership', 'Dataset-generation change blocks unready projection',
      'Dense viewport fails explicitly instead of truncation', 'Legacy active hash rejects more than 200 rides'],
    limitations: ['Outside fixtures populate spatial indexes only; only regional canonical records are read',
      'Operation/byte evidence, not CPU latency/Santiago throughput or deployed index parity'] }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });

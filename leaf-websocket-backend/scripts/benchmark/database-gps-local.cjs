#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const withPrivateRedis = require('./private-redis.cjs');
const loadService = require('./isolated-gps-service.cjs');
const { appendTripLocation } = require('../../utils/trip-location-stream-write');
const { ACK_CHUNK, CLAIM_TRIPS } = require('../../utils/trip-location-buffer-ops');
const { sealFinancialContext } = require('../../services/financial-runtime-context');

withPrivateRedis(async redis => {
  const cases = [];
  const docs = new Map();
  let outage = false;
  let afterCreate;
  let creates = 0;
  let writeBarrier;
  let afterSummary;
  let reads = 0;
  const firestore = { collection: collection => ({ doc: id => {
    const key = `${collection}/${id}`;
    return {
      create: async doc => {
        creates++;
        if (writeBarrier) await writeBarrier;
        if (outage) throw new Error('synthetic Firestore outage');
        if (docs.has(key)) throw Object.assign(new Error('exists'), { code: 6 });
        docs.set(key, structuredClone(doc));
        if (afterCreate) { const hook = afterCreate; afterCreate = null; await hook(); }
      },
      get: async () => { reads++; return { exists: docs.has(key), data: () => docs.get(key) }; },
      set: async doc => { if (outage) throw new Error('outage'); docs.set(key, structuredClone(doc));
        if (afterSummary) { const hook = afterSummary; afterSummary = null; await hook(); } }
    };
  } }) };
  let dropAck = false;
  const client = new Proxy(redis, { get(target, method) {
    if (method === 'eval') return async (...args) => {
      if (args[0] === ACK_CHUNK && dropAck) { dropAck = false; throw new Error('synthetic crash before ACK'); }
      return target.eval(...args);
    };
    if (['keys', 'smembers'].includes(method)) return () => { throw new Error(`Unbounded ${method} forbidden`); };
    return typeof target[method] === 'function' ? target[method].bind(target) : target[method];
  } });
  const service = loadService(client, firestore);
  const point = (tripId, seq, extra = {}) => ({ tripId, driverId: 'driver', customerId: 'owner', seq,
    lat: -22.9 - seq / 10000, lng: -43.2, capturedAt: 1710000000000 + seq * 1000,
    receivedAt: 1710000000010 + seq * 1000, ...extra });
  await redis.hset('booking:stream', { driverId: 'driver', status: 'IN_PROGRESS' });
  await redis.set('trip_location_events', 'synthetic invalid type');
  await assert.rejects(appendTripLocation(redis, point('stream', 1), { window: 15, ttl: 86400 }));
  assert.equal(await redis.exists('trip_loc_dedupe:stream:driver:1'), 0);
  await redis.del('trip_location_events');
  assert.equal((await appendTripLocation(redis, point('stream', 1), { window: 15, ttl: 86400 })).inserted, true);
  assert.equal((await appendTripLocation(redis, point('stream', 1), { window: 15, ttl: 86400 })).duplicate, true);
  assert.equal(await redis.xlen('trip_location_events'), 1);
  cases.push('XADD failure leaves no dedup marker; retry inserts once');

  await service.bufferLocationEvent(point('crash', 1));
  await service.bufferLocationEvent(point('crash', 2));
  assert.equal((await service.bufferLocationEvent(point('crash', 2))).duplicate, true);
  assert.equal(await redis.ttl(service.getBufferKey('crash')), -1);
  outage = true;
  await assert.rejects(service.flushTripChunks('crash'));
  assert.equal(await redis.llen(service.getBufferKey('crash')), 2);
  outage = false; dropAck = true;
  await assert.rejects(service.flushTripChunks('crash'), /crash before ACK/);
  await service.bufferLocationEvent(point('crash', 3));
  assert.equal((await service.flushTripChunks('crash')).flushedPoints, 2);
  assert.equal(await redis.llen(service.getBufferKey('crash')), 1);
  assert.equal(docs.size, 1);
  assert.equal(reads, 1);
  await service.flushTripChunks('crash');
  assert.equal(await redis.hget(service.getMetaKey('crash'), 'persistedPoints'), '3');
  cases.push('Outage and crash after durable write preserve points; retry uses same chunk even after append');

  await service.bufferLocationEvent(point('expired', 1));
  afterCreate = () => redis.del(service.getFlushLockKey('expired'));
  assert.equal((await service.flushTripChunks('expired')).reason, 'chunk_ack_conflict');
  assert.equal(await redis.llen(service.getBufferKey('expired')), 1);
  assert.equal((await service.flushTripChunks('expired')).flushedPoints, 1);
  cases.push('Expired ownership cannot trim; next owner confirms existing durable chunk');

  const ctx = sealFinancialContext({ providerEnvironment: 'sandbox', testUserSandbox: true, paymentProfileId: 'qa' });
  await service.bufferLocationEvent(point('sandbox', 1, { financialContext: ctx }));
  await service.flushTripChunks('sandbox');
  assert.ok([...docs.keys()].some(key => key.startsWith('sandbox_trip_location_chunks/')));
  await assert.rejects(service.bufferLocationEvent(point('sandbox', 2)), /namespace|context|sandbox/i);
  cases.push('Sandbox remains in its sealed namespace; context mismatch rejected');

  for (let i = 1; i <= 125; i++) await service.bufferLocationEvent(point('final', i));
  const final = await service.forceFinalizeTrip('final', { status: 'completed' });
  assert.equal(final.pending, true);
  assert.equal(await redis.llen(service.getBufferKey('final')), 5);
  await service.flushPendingTrips();
  assert.equal(await redis.llen(service.getBufferKey('final')), 0);
  assert.ok(docs.has('trip_location_summaries/final'));
  await service.bufferLocationEvent(point('final', 126));
  // Due queue may already hold a short retry delay from the previous cycle.
  await redis.zadd(service.bufferQueueKey, 0, 'final');
  await service.flushPendingTrips();
  assert.equal(docs.get('trip_location_summaries/final').persistedPoints, 126);
  cases.push('Bounded finalization drains through existing worker; late points refresh summary');
  afterSummary = () => service.bufferLocationEvent(point('final', 127));
  assert.equal((await service.forceFinalizeTrip('final', { status: 'completed' })).pending, true);
  await service.flushPendingTrips();
  assert.equal(docs.get('trip_location_summaries/final').persistedPoints, 127);
  cases.push('A fix arriving during summary write prevents finalization ACK and is drained later');

  for (let i = 0; i < 5; i++) await service.bufferLocationEvent(point(`capacity-${i}`, 1));
  let unblockWrites;
  writeBarrier = new Promise(resolve => { unblockWrites = resolve; });
  const capacity = [0, 1, 2, 3].map(i => service.flushTripChunks(`capacity-${i}`));
  assert.equal((await service.flushTripChunks('capacity-4')).reason, 'flush_capacity');
  unblockWrites(); await Promise.all(capacity); writeBarrier = null;
  cases.push('At most four external chunk writes per service process; excess stays pending');


  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const original = service.listBufferedTripIds.bind(service);
  service.listBufferedTripIds = () => blocked.then(() => []);
  const running = service.flushPendingTrips();
  assert.equal((await service.flushPendingTrips()).reason, 'cycle_running');
  release(); await running; service.listBufferedTripIds = original;
  cases.push('Overlapping periodic cycles are rejected');

  await Promise.all([1, 2, 3, 4].map(seq => service.bufferLocationEvent(point('cas', seq))));
  assert.equal(await redis.llen(service.getBufferKey('cas')), 4);
  assert.equal(await redis.hget(service.getMetaKey('cas'), 'bufferVersion'), '4');
  assert.equal(await redis.hget(service.getMetaKey('cas'), 'canonicalPointsCount'), '4');
  cases.push('Concurrent metadata updates retry CAS without losing the canonical point chain');

  await redis.hset('trip_loc_meta:large', { canonicalDriverId: 'other' });
  for (let i = 0; i < 2001; i++) await redis.rpush('trip_loc_buffer:large', JSON.stringify(point('large', i)));
  assert.equal((await service.resolveCanonicalTripMetrics({ tripId: 'large', driverId: 'driver', redis })).reason,
    'canonical_telemetry_recovery_budget_exceeded');
  cases.push('Oversized fallback returns incomplete telemetry instead of reading an unlimited route');

  const fairness = [];
  for (const total of [199, 200, 201, 1000]) {
    const key = `fixture:fair:${total}`;
    for (let i = 0; i < total; i++) await redis.zadd(key, 0, `trip-${String(i).padStart(4, '0')}`);
    const seen = new Set();
    let cycles = 0;
    while (seen.size < total && cycles < 10) {
      const trips = await redis.eval(CLAIM_TRIPS, 1, key, String(cycles * 1000), '200', String((cycles + 1) * 1000));
      assert.ok(trips.length <= 200);
      trips.forEach(trip => seen.add(trip));
      cycles++;
    }
    assert.equal(seen.size, total);
    fairness.push({ total, cycles, distinctServed: seen.size });
  }
  console.log(JSON.stringify({ environment: 'Private Redis real Lua; immutable in-memory Firestore adapter; external imports blocked',
    cases, fairness, firestoreAdapter: { createsAttempted: creates, duplicateRecoveryReads: reads, durableDocuments: docs.size },
    limitations: ['No real Firebase latency/billing/query plan', 'No deployed host/device evidence or capacity claim'] }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });

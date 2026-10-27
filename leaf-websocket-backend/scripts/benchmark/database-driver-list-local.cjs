#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const withFirestore = require('./private-firestore.cjs');
const loadUsers = require('./isolated-dashboard-users.cjs');
const { readPage, aggregateLegacy } = require('../../services/dashboard-driver-list-data');
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const id = i => `driver-${String(i).padStart(6, '0')}`;

async function run() {
  const cpuRows = [];
  for (const [drivers, trips] of [[100, 1000], [1000, 10000], [10000, 100000]]) {
    let touches = 0;
    const cars = Object.fromEntries(Array.from({ length: drivers }, (_, i) => [i, { get driver() { touches++; return id(i); } }]));
    const bookings = Object.fromEntries(Array.from({ length: trips }, (_, i) => [i, {
      get driver() { touches++; return id(i % drivers); }, status: 'COMPLETED', net: 28.77
    }]));
    let before = null;
    if (drivers <= 1000) {
      const start = performance.now();
      for (let i = 0; i < drivers; i++) {
        Object.values(cars).find(car => car.driver === id(i));
        Object.values(bookings).filter(booking => booking.driver === id(i));
      }
      before = { ms: performance.now() - start, driverFieldReads: touches };
    }
    touches = 0;
    const start = performance.now();
    const aggregated = aggregateLegacy(cars, bookings, row => row.net);
    assert.equal(aggregated.statsByDriver.size, drivers);
    cpuRows.push({ drivers, trips, before, after: { ms: performance.now() - start, driverFieldReads: touches } });
  }
  process.env.ENABLE_ADMIN_DRIVER_CURSOR_READS = 'true';
  return withFirestore(async firestore => {
    await firestore.collection('ops_read_models').doc('driver_directory_v1').set({ schema: 1, ready: true, createdAtStorage: 'iso' });
    const calls = [];
    const measuredFirestore = {
      collection: name => {
        assert.ok(['users', 'ops_read_models', 'ops_driver_stats_v1'].includes(name));
        const collection = firestore.collection(name);
        const wrap = query => new Proxy(query, { get(target, method) {
          if (method === 'get') return async () => {
            const result = await target.get();
            calls.push({ store: 'firestore', records: result.docs ? result.docs.length : 1 });
            return result;
          };
          if (['where', 'orderBy', 'select', 'limit', 'startAfter', 'doc'].includes(method)) return (...args) => wrap(target[method](...args));
          return typeof target[method] === 'function' ? target[method].bind(target) : target[method];
        } });
        return wrap(collection);
      },
      getAll: async (...args) => {
        // Rebuild references from this isolated SDK; wrapped refs are not SDK instances.
        const refs = args.slice(0, -1).map(ref => firestore.doc(ref.path));
        const result = await firestore.getAll(...refs, args[args.length - 1]);
        calls.push({ store: 'firestore', records: result.length }); return result;
      }
    };
    const queryRows = [];
    let previous = 0;
    for (const count of [100, 1000, 10000]) {
      for (let start = previous; start < count; start += 100) {
        const batch = firestore.batch();
        for (let i = start; i < Math.min(count, start + 100); i++) {
          const driverId = id(i);
          batch.set(firestore.collection('users').doc(driverId), {
            usertype: 'driver', firstName: 'Synthetic', lastName: String(i), approved: true,
            createdAt: new Date(1710000000000 + (i % 5) * 1000).toISOString(),
            ...(i === 0 ? { unusedLargeField: 'x'.repeat(100000) } : {})
          });
          batch.set(firestore.collection('ops_driver_stats_v1').doc(hash(driverId)), { schema: 1, complete: true,
            namespace: 'operational', source: 'ride_finalization_v1', driverId, completedTrips: 1, driverNetMinor: 2877 });
        }
        await batch.commit();
      }
      previous = count; calls.length = 0;
      const page = await readPage({ firestore: measuredFirestore, params: { pagination: 'cursor', limit: 20 },
        resolveNet: () => { throw new Error('No history reduction in cursor page'); } });
      assert.equal(Object.keys(page.users).length, 20);
      assert.ok(Object.values(page.users).every(user => !user.unusedLargeField));
      assert.equal([...page.statsByDriver.values()][0].totalEarnings, 28.77);
      queryRows.push({ totalDrivers: count, page: 20, firestoreRecords: calls.filter(row => row.store === 'firestore').reduce((sum, row) => sum + row.records, 0),
        globalRideReads: 0 });
    }
    assert.deepEqual(queryRows.map(row => row.firestoreRecords), [42, 42, 42]);
    const seen = new Set();
    let cursor;
    // Walk the same-timestamp boundary across several real indexed pages.
    for (let page = 0; page < 5; page++) {
      const result = await readPage({ firestore: measuredFirestore,
        params: { pagination: 'cursor', limit: 20, cursor }, resolveNet: () => 0 });
      Object.keys(result.users).forEach(key => { assert.ok(!seen.has(key)); seen.add(key); });
      cursor = result.pagination.nextCursor;
    }
    assert.equal(seen.size, 100);
    const users = loadUsers(firestore);
    const firstUsers = await users.listUsers({ pagination: 'cursor', limit: 20, type: 'driver' });
    const nextUsers = await users.listUsers({ cursor: firstUsers.pagination.nextCursor, limit: 20, type: 'driver', page: 2 });
    const priorUsers = await users.listUsers({ before: nextUsers.pagination.prevCursor, limit: 20, type: 'driver' });
    assert.equal(JSON.stringify(priorUsers.users.map(user => user.id)), JSON.stringify(firstUsers.users.map(user => user.id)));
    const firstIds = new Set(firstUsers.users.map(user => user.id));
    assert.ok(nextUsers.users.every(user => !firstIds.has(user.id)));
    assert.equal(firstUsers.pagination.total, null);
    await assert.rejects(users.listUsers({ cursor: firstUsers.pagination.nextCursor, type: 'customer' }));
    await assert.rejects(users.listUsers({ page: 10000, limit: 20 }), /Refine/);
    const legacyUsers = await users.listUsers({ limit: 20, type: 'driver' });
    assert.equal(legacyUsers.pagination.total, 10000);
    await firestore.collection('users').doc('one-more').set({ usertype: 'driver' });
    users.resetUsersCache();
    const boundedCount = await users.listUsers({ limit: 20, type: 'driver' });
    assert.equal(boundedCount.pagination.total, null);
    assert.equal(boundedCount.pagination.totalMode, 'bounded-unknown');

    console.log(JSON.stringify({ environment: 'Private Firestore1.19.8 emulator, 256MiB heap, loopback; no ADC or providers',
      cpuRows, queryRows, checks: ['Equal-date cursor pages do not repeat drivers', 'Only requested profile fields returned', 'No global ride read in cursor mode', 'Primary user list uses scoped cursor and rejects deep offsets', 'Legacy aggregate total is unknown above10000 instead of counting an arbitrary database'],
      limitations: ['Legacy CPU is a local synthetic microbenchmark; largest baseline skipped to respect lab budget',
        'Emulator queries validate SDK/limits, not production composite indexes, billing, latency or host capacity',
        'Synthetic aggregate fixtures do not prove the finalization projection writer'] }, null, 2));
  });
}
run().catch(error => { console.error(error); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const withRedis = require('./private-redis.cjs');
const loadH3 = require('./isolated-h3-service.cjs');
const loadGps = require('./isolated-gps-service.cjs');
const region = require('../../services/map-regional-index');
const { resolveActiveTripForDriver } = require('../../utils/active-trip-index');
const { readLocationBooking } = require('../../utils/active-trip-location-snapshot');
const { appendTripLocation } = require('../../utils/trip-location-stream-write');
const mapWithConcurrency = require('../../utils/map-with-concurrency');
const pause = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const quantile = (rows, p) => [...rows].sort((a, b) => a - b)[Math.max(0, Math.ceil(rows.length * p) - 1)] || 0;

withRedis(async redis => {
  process.env.ENABLE_H3_REGIONAL_WRITES = 'true'; process.env.ENABLE_H3_REGIONAL_READS = 'true';
  const pickup = { lat: -23.55, lng: -46.63 };
  const bbox = { minLat: -23.57, maxLat: -23.54, minLng: -46.65, maxLng: -46.62 };
  await redis.set('leaf:runtime:critical-dataset:generation', 'mixed-fixture');
  for (let i = 0; i < 2; i++) {
    const id = `inside-${i}`;
    await redis.hset(`booking_search:${id}`, { state: 'SEARCHING', pickupLocation: JSON.stringify(pickup), createdAt: Date.now() });
    await region.indexSearch(redis, id);
    await region.indexTrip(redis, { bookingId: id, driverId: id, status: 'IN_PROGRESS', currentLocation: pickup });
    await redis.hset('bookings:active', id, JSON.stringify({ driverId: id, status: 'IN_PROGRESS', currentLocation: pickup, updatedAt: Date.now() }));
    await redis.hset(`booking:${id}`, { driverId: id, status: 'IN_PROGRESS' });
    await redis.geoadd('driver_locations', pickup.lng, pickup.lat, id);
    await redis.geoadd('driver_locations_eligible', pickup.lng, pickup.lat, id);
    await redis.hset(`driver:${id}`, { status: 'available', isOnline: 'true' });
  }
  await redis.set(region.READY_KEY, JSON.stringify({ schema: 1, generation: 'mixed-fixture' }));
  for (let offset = 0; offset < 10000; offset += 200) {
    const batch = redis.pipeline();
    for (let i = offset; i < offset + 200; i++) batch.hset('bookings:active', `unrelated-${i}`,
      JSON.stringify({ status: 'IN_PROGRESS', currentLocation: { lat: -22, lng: -43 }, updatedAt: Date.now() }));
    assert.ok((await batch.exec()).every(([error]) => !error));
  }
  const rows = []; const docs = new Map(); let durablePoints = 0; let outage = false; let failedCreates = 0;
  const firestore = { collection: collection => ({ doc: id => {
    const key = `${collection}/${id}`;
    return { create: async data => {
      await pause(2); if (outage) { failedCreates++; throw new Error('Synthetic persistence outage'); }
      if (docs.has(key)) throw Object.assign(new Error('already persisted'), { code: 6 });
      docs.set(key, structuredClone(data)); durablePoints += data.points?.length || 0;
    }, get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }), set: async data => docs.set(key, structuredClone(data)) };
  } }) };
  const traces = { gpsCalls: 0, gpsBytes: 0, adminBytes: 0 };
  const ingress = new Proxy(redis, { get(target, command) {
    if (typeof target[command] !== 'function') return target[command];
    return async (...args) => {
      assert.notEqual(args[0], 'bookings:active', 'Critical path cannot read global active hash');
      const value = await target[command](...args); traces.gpsCalls++; traces.gpsBytes += Buffer.byteLength(JSON.stringify(value) ?? '');
      return value;
    };
  } });
  const administrative = new Proxy(redis, { get(target, command) {
    if (command === 'pipeline') return () => target.pipeline(); // replies not counted; global hash dominates baseline
    if (typeof target[command] !== 'function') return target[command];
    return async (...args) => { const value = await target[command](...args);
      traces.adminBytes += Buffer.byteLength(JSON.stringify(value) ?? ''); return value; };
  } });
  const scenarios = ['--capacity-only', '--sustained'].includes(process.argv[3]) ? [['candidate', 20, 1000]]
    : [['baseline', 1, 100], ['candidate', 1, 100], ['candidate', 20, 100], ['baseline', 20, 100]];
  for (const [mode, readers, driverCount] of scenarios) {
    const number = rows.length;
    const ticks = process.argv[3] === '--sustained' ? 48 : 18;
    const h3 = loadH3({ baseline: mode === 'baseline' });
    // Same two fixture searches in both variants. Excludes legacy minute-wide
    // search reconciliation from this comparison; active-trip path is unchanged.
    if (mode === 'baseline') h3.listOpenSearchKeys = async () => ['booking_search:inside-0', 'booking_search:inside-1'];
    await h3.getCells({ redis: administrative, bbox: [bbox.minLng, bbox.minLat - 0.01, bbox.maxLng, bbox.maxLat].join(','), zoom: 14 });
    const gps = loadGps(ingress, firestore);
    const trips = Array.from({ length: driverCount }, (_, i) => `mixed-${number}-${i}`);
    for (const trip of trips) {
      await redis.set(`active_trip_by_driver:${trip}`, trip, 'PX', 120000);
      await redis.hset(`booking:${trip}`, { bookingId: trip, driverId: trip, customerId: 'synthetic-owner', status: 'IN_PROGRESS' });
    }
    const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
    const latency = []; const scheduling = []; const adminLatency = [];
    let adminRejected = 0; let running = true; let maxRss = process.memoryUsage().rss; let produced = 0;
    const errors = []; const backlogSamples = []; const durableStart = durablePoints; let lastSample = -1; const cpu = process.cpuUsage(); const started = performance.now();
    Object.keys(traces).forEach(key => { traces[key] = 0; }); const failedBefore = failedCreates;
    const flusher = (async () => {
      while (running) {
        const elapsed = performance.now() - started; outage = elapsed >= 14500 && elapsed < 17000;
        await gps.flushPendingTrips();
        const second = Math.floor((performance.now() - started) / 1000);
        if (second !== lastSample) { backlogSamples.push({ second, produced, persisted: durablePoints - durableStart, buffered: produced - (durablePoints - durableStart) }); lastSample = second; }
        maxRss = Math.max(maxRss, process.memoryUsage().rss); await pause(250);
      }
    })();
    const drivers = trips.map((trip, i) => (async () => {
      for (let tick = 0; tick < ticks; tick++) {
        const deadline = started + i * 900 / driverCount + tick * 1000;
        await pause(deadline - performance.now()); scheduling.push(Math.max(0, performance.now() - deadline));
        const at = performance.now();
        try {
          assert.equal((await resolveActiveTripForDriver(ingress, trip)).tripId, trip);
          assert.equal((await readLocationBooking(ingress, trip)).driverId, trip);
          const point = { tripId: trip, driverId: trip, customerId: 'synthetic-owner', seq: tick,
            lat: -22.9 + tick / 100000, lng: -43.2, capturedAt: Date.now(), receivedAt: Date.now() };
          const result = await appendTripLocation(ingress, point, { window: 15, ttl: 86400 });
          await gps.bufferLocationEvent({ ...point, orderStatus: result.orderStatus, lastAcceptedSeq: result.lastAcceptedSeq, outOfOrderWindow: 15 });
          await redis.xdel('trip_location_events', result.streamId); produced++;
        } catch (error) { errors.push(error.message); }
        latency.push(performance.now() - at);
      }
    })());
    const admins = (async () => {
      for (let tick = 0; tick < ticks; tick++) {
        await pause(started + tick * 1000 - performance.now());
        await Promise.all(Array.from({ length: readers }, async (_, index) => {
          const at = performance.now(); const drift = (tick * readers + index) / 10000;
          try { await h3.getCells({ redis: administrative, bbox: [bbox.minLng, bbox.minLat + drift, bbox.maxLng, bbox.maxLat + drift].join(','), zoom: 14 }); }
          catch (error) { if (error.statusCode === 503) adminRejected++; else errors.push(error.message); }
          adminLatency.push(performance.now() - at);
        }));
      }
    })();
    await Promise.all([...drivers, admins]); running = false; await flusher; outage = false;
    const elapsedMs = performance.now() - started; const used = process.cpuUsage(cpu); lag.disable();
    const buffered = await Promise.all(trips.map(trip => redis.llen(gps.getBufferKey(trip))));
    const persistedBeforeDrain = [...docs.values()].filter(doc => trips.includes(doc.tripId) && Array.isArray(doc.points)).reduce((sum, doc) => sum + doc.points.length, 0);
    assert.equal(persistedBeforeDrain + buffered.reduce((a, b) => a + b, 0), produced, 'Every point is durable or still buffered');
    await mapWithConcurrency(trips, 4, trip => gps.flushTripChunks(trip, { force: true, maxChunks: 4, reason: 'lab-final-drain' }));
    const persisted = [...docs.values()].filter(doc => trips.includes(doc.tripId) && Array.isArray(doc.points))
      .reduce((sum, doc) => sum + doc.points.length, 0);
    assert.equal(errors.length, 0, JSON.stringify(errors)); assert.equal(produced, driverCount * ticks); assert.equal(persisted, produced);
    assert.equal(await redis.xlen('trip_location_events'), 0);
    rows.push({ mode, administrativeReaders: readers, durationMs: elapsedMs, gpsDrivers: driverCount, gpsHzPerDriver: 1,
      produced, backlogSamples, persistedAfterDrain: persisted, bufferedBeforeDrain: buffered.reduce((a, b) => a + b, 0),
      gpsP50Ms: quantile(latency, 0.5), gpsP95Ms: quantile(latency, 0.95), gpsP99Ms: quantile(latency, 0.99),
      schedulingP99Ms: quantile(scheduling, 0.99), adminP95Ms: quantile(adminLatency, 0.95), adminRejected,
      eventLoopP99Ms: lag.percentile(99) / 1000000, maxRssBytes: maxRss, processCpuMs: (used.user + used.system) / 1000,
      syntheticPersistenceFailures: failedCreates - failedBefore, ...traces });
    process.stderr.write(`${JSON.stringify(rows[rows.length - 1])}\n`);
  }
  const comparisons = [1, 20].flatMap(readers => {
    const before = rows.find(row => row.mode === 'baseline' && row.administrativeReaders === readers);
    const after = rows.find(row => row.mode === 'candidate' && row.administrativeReaders === readers);
    if (!before || !after) return [];
    return [{ administrativeReaders: readers, p95Ratio: after.gpsP95Ms / before.gpsP95Ms, p99Ratio: after.gpsP99Ms / before.gpsP99Ms }];
  });
  const result = { criticalLatencyGate: comparisons.length ? comparisons.every(row => row.p95Ratio <= 1.1 && row.p99Ratio <= 1.1) : null, environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, redis: (await redis.info('server')).match(/redis_version:([^\r]+)/)?.[1],
    redisMemoryLimit: '256MiB noeviction', connection: 'private Unix socket', externalHistory: 10000 }, rows, comparisons,
    limitations: ['Single laboratory run; no production/device/Socket.IO/provider evidence and no capacity extrapolation',
      'Same current GPS pipeline in both modes, compares impact of administrative H3 implementation794edfcb7 versus candidate',
      'Legacy search reconciliation replaced by identical two-key fixture; varied viewports force cache misses',
      'Immutable persistence adapter uses2ms artificial latency and2.5s outage; managed Firebase not measured',
      'Direct stream dispatch to real buffer method, not XREADGROUP consumer scheduling; XDEL only after successful buffer',
      'Pipeline reply bytes omitted from administrative trace; direct global-hash bytes counted in baseline',
      'End drain is explicit laboratory cleanup; batching interval/sample frequency unchanged while measured'] };
  return result;
}).then(result => {
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const withRedis = require('./private-redis.cjs');
const metricsBudget = require('../../utils/metrics-read-budget');
const loadOutbox = require('./isolated-finalization-outbox.cjs');

withRedis(async redis => {
  const commands = [];
  const measured = new Proxy(redis, { get(target, name) {
    if (['hgetall', 'keys', 'smembers'].includes(name)) return () => { throw new Error(`Unbounded ${name} forbidden`); };
    if (['hscan', 'hget', 'eval'].includes(name)) return async (...args) => { commands.push(name); return target[name](...args); };
    return typeof target[name] === 'function' ? target[name].bind(target) : target[name];
  } });
  await redis.hset('bookings:active', ...Array.from({ length: 201 }, (_, i) => [String(i), '{}']).flat());
  await assert.rejects(metricsBudget.activeRideHash(measured), /indisponíveis/);
  await redis.del('bookings:active');
  await redis.hset('bookings:active', 'large', 'x'.repeat(4194305));
  await assert.rejects(metricsBudget.activeRideHash(measured), /indisponíveis/);
  await redis.del('bookings:active');
  await redis.hset('bookings:active', 'valid', '{}');
  assert.equal(Object.keys(await metricsBudget.activeRideHash(measured)).length, 1);
  const service = loadOutbox(measured);
  const key = service.getFinalizationOutboxKey();
  const entry = i => JSON.stringify({ rideId: `ride-${i}`, finalData: { version: 1 }, status: 'pending', nextRetryAt: 0 });
  const rows = [];
  for (const total of [201, 1000]) {
    await redis.del(key); service.outboxScanPage = []; service.outboxScanCursor = '0';
    const seen = new Set();
    service.saveFinalRideData = async id => { seen.add(id); return { success: true }; };
    const fields = Array.from({ length: total }, (_, i) => [`ride-${i}`, entry(i)]).flat();
    await redis.hset(key, ...fields);
    let cycles = 0; let maxCycleScans = 0;
    while (await redis.hlen(key)) {
      commands.length = 0; await service.processFinalizationOutboxBatch(20);
      maxCycleScans = Math.max(maxCycleScans, commands.filter(c => c === 'hscan').length);
      assert.ok(commands.filter(c => c === 'hget').length <= 20);
      assert.ok(++cycles <= 150, 'All eligible work eventually selected');
    }
    assert.equal(seen.size, total); assert.ok(maxCycleScans <= 1);
    rows.push({ pending: total, cycles, maximumSelectedPerCycle: 20, maximumHscanPerCycle: maxCycleScans });
  }
  service.outboxScanPage = []; service.outboxScanCursor = '0';
  await redis.hset(key, 'race', JSON.stringify({ rideId: 'race', status: 'pending', finalData: { version: 1 } }));
  let calls = 0;
  service.saveFinalRideData = async () => {
    if (!calls++) await redis.hset(key, 'race', JSON.stringify({ rideId: 'race', status: 'pending', finalData: { version: 2 } }));
    return { success: true };
  };
  await service.processFinalizationOutboxBatch(20);
  assert.equal(await redis.hlen(key), 1, 'ACK cannot erase a newer payload');
  await service.processFinalizationOutboxBatch(20); assert.equal(await redis.hlen(key), 0);
  await redis.hset(key, 'invalid', '{corrupt');
  await service.processFinalizationOutboxBatch(20);
  assert.equal(await redis.hget(key, 'invalid'), '{corrupt', 'Malformed financial work is preserved');
  await redis.hset(key, 'null-json', 'null', 'array-json', '[]', 'scalar-json', '42');
  service.outboxScanPage = []; service.outboxScanCursor = '0';
  for (let i = 0; i < 5; i++) await service.processFinalizationOutboxBatch(20);
  for (const [id, value] of [['null-json', 'null'], ['array-json', '[]'], ['scalar-json', '42']]) {
    assert.equal(await redis.hget(key, id), value, 'Structurally invalid work is preserved for reconciliation');
  }
  await redis.del(key); service.outboxScanPage = [];
  await redis.hset(key, 'held', JSON.stringify({ rideId: 'held', status: 'pending', finalData: {} }));
  let release; service.saveFinalRideData = () => new Promise(resolve => { release = resolve; });
  const first = service.processFinalizationOutboxBatch(20);
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal((await service.processFinalizationOutboxBatch(20)).skipped, true);
  release({ success: true }); await first;
  return { environment: 'Private Redis Unix socket,256MiB,noeviction,no persistence/network; canonical persistence adapter in memory', rows,
    checks: ['No HGETALL/KEYS/SMEMBERS', 'Bounded spill page preserves HSCAN fairness', 'CAS ACK preserves newer work',
      'Malformed financial work retained', 'Overlapping process cycles rejected', 'Active metric count/bytes checked atomically before transfer'],
    limitations: ['HSCAN COUNT is a hint; page capped at1000 entries/2MiB and may reject larger legacy payloads',
      'Canonical writer is substituted in this outbox-only experiment; Firestore transaction evidence is separate',
      'Does not introduce source-version arbitration for pre-existing concurrent canonical finalization writes'] };
}).then(result => {
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}).catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });

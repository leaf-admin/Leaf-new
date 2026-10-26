#!/usr/bin/env node
'use strict';

// Only a newly spawned Redis over a private Unix socket is reachable by the
// benchmarked modules. No dotenv, Firebase, credentials or application bootstrap.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn, execFileSync } = require('child_process');
const { performance } = require('perf_hooks');
const Redis = require('ioredis');
const root = path.resolve(__dirname, '../../..');
const backend = path.join(root, 'leaf-websocket-backend');
const baselineRef = process.argv[2] || '794edfcb7';
if (!/^[a-f0-9]{7,40}$/.test(baselineRef)) throw new Error('Pass a local commit SHA, not an endpoint');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-db-bench-'));
const socketPath = path.join(directory, 'redis.sock');
const server = spawn('redis-server', ['--port', '0', '--unixsocket', socketPath, '--unixsocketperm', '700',
  '--save', '', '--appendonly', 'no', '--maxmemory', '256mb', '--maxmemory-policy', 'noeviction', '--dir', directory],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let serverError = '';
server.stderr.on('data', chunk => { serverError += chunk.toString().slice(0, 1000); });
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
let redis;

function source(file, baseline) {
  return baseline ? execFileSync('git', ['show', `${baselineRef}:leaf-websocket-backend/${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(backend, file), 'utf8');
}

function isolated(file, baseline, proxy) {
  const mod = { exports: {} };
  const safeRequire = name => {
    if (name === './redis-pool') return { pool: proxy };
    if (name === 'crypto' || name === 'h3-js') return require(name);
    if (name === '../utils/bounded-ttl-cache') return require(path.join(backend, 'utils/bounded-ttl-cache'));
    if (name === '../utils/logger') return { logStructured() {}, logger: quiet };
    if (name === '../utils/prometheus-metrics') return { metrics: new Proxy({}, { get: () => () => {} }) };
    if (name === './dashboard-live-data-service') return { normalizeDriverStatus: status => status };
    if (name === './booking-search-index') return {};
    if (name === './map-regional-index') return require(path.join(backend, 'services/map-regional-index'));
    if (name === './pricing/demandPressure') return { MAX_DEMAND_MARKUP_PERCENT: 40, calculateDemandPressure() {} };
    if (name === './pricing/nightSurcharge') return { resolveNightSurcharge() {} };
    throw new Error(`Benchmark module attempted an unapproved import: ${name}`);
  };
  vm.runInNewContext(source(file, baseline), { require: safeRequire, module: mod, exports: mod.exports,
    console: quiet, Buffer, process: { env: {} }, Date, Map, Set, performance }, { filename: file });
  return mod.exports;
}

async function measure(fn, calls) {
  calls.length = 0;
  const start = performance.now();
  await fn();
  return { ms: performance.now() - start, commands: calls.map(row => row.command),
    redisReplyBytes: calls.reduce((sum, row) => sum + row.replyBytes, 0) };
}

(async () => {
  for (let n = 0; n < 100 && !fs.existsSync(socketPath); n++) {
    if (server.exitCode !== null) throw new Error(`Local Redis failed: ${serverError}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  redis = new Redis(socketPath, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
  await redis.connect();
  const calls = [];
  const proxy = new Proxy({}, { get: (_target, command) => async (...args) => {
    const reply = await redis[command](...args);
    calls.push({ command, replyBytes: Buffer.byteLength(JSON.stringify(reply) ?? '') });
    return reply;
  } });
  const before = isolated('utils/advanced-cache.js', true, proxy);
  const after = isolated('utils/advanced-cache.js', false, proxy);
  const rows = [];
  let previous = 0;
  for (const keys of [1000, 10000, 100000]) {
    for (let start = previous; start < keys; start += 500) {
      const pipeline = redis.pipeline();
      for (let n = start; n < Math.min(keys, start + 500); n++) {
        pipeline.set(n % 10 === 0 ? `graphql:usr:userMetrics:u:${n}` : `fixture:unrelated:${n}`, 'synthetic', 'EX', 300);
      }
      const replies = await pipeline.exec();
      if (replies.some(([error]) => error)) throw new Error('Fixture exceeds local resource budget');
    }
    previous = keys;
    rows.push({ fixtureKeysTarget: keys, actualKeyspaceBeforeQueries: await redis.dbsize(), beforeStats: await measure(() => before.getCacheStats(), calls),
      afterStats: await measure(() => after.getCacheStats(), calls),
      beforeInvalidate: await measure(() => before.invalidate('userMetrics'), calls),
      afterInvalidate: await measure(() => after.invalidate('userMetrics'), calls) });
  }
  const cacheRows = [];
  for (const baseline of [true, false]) {
    const { H3MapService } = isolated('services/h3-map-service.js', baseline, proxy);
    const service = new H3MapService();
    for (let n = 0; n < 10000; n++) service.setCached(`viewport:${n}`, { cells: [{ id: n }] });
    cacheRows.push({ variant: baseline ? 'before' : 'after', distinctViewports: 10000,
      retainedEntries: service.cache.size, retainedSerializedBytes: service.cache.bytes ?? null });
  }
  const redisInfo = await redis.info('server');
  console.log(JSON.stringify({ environment: { node: process.version, platform: os.platform(), arch: os.arch(),
    cpu: os.cpus()[0]?.model, baselineRef, redis: /redis_version:([^\r]+)/.exec(redisInfo)?.[1],
    connection: 'new private Unix socket, no production endpoints', maxmemoryMiB: 256 },
  cacheInvalidation: rows, viewportCache: cacheRows,
  limitations: ['Local command/serialization microbenchmark, not full-app throughput or Santiago capacity',
    'Ordered single runs; timing is illustrative. Command counts/resource ceilings are deterministic gates',
    'No Firebase billing/query-plan evidence; no paid provider calls'] }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (redis) await redis.quit().catch(() => redis.disconnect());
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

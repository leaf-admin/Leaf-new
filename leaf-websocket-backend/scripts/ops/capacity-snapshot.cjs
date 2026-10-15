#!/usr/bin/env node
/**
 * Capacity snapshot (read-only, on demand).
 *
 * Samples Redis command rates over a window and reads the Prometheus metrics
 * every gateway already exposes, then prints one report. It writes nothing and
 * starts no background job. Run it inside a gateway container, which already
 * has the Redis URL, the runtime token and network access to every gateway:
 *
 *   ssh leaf-vps 'docker exec -i leaf-websocket node - --window 60' \
 *     < leaf-websocket-backend/scripts/ops/capacity-snapshot.cjs
 *
 * Options: --window <seconds> (default 60), --json (machine-readable output),
 *          --targets <csv of base URLs> (default the three Contabo gateways).
 */
'use strict';

const Redis = require(require.resolve('ioredis', { paths: [process.cwd(), '/app'] }));

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const WINDOW_SECONDS = Math.max(5, Number.parseInt(arg('--window', '60'), 10) || 60);
const AS_JSON = argv.includes('--json');
const TARGETS = String(arg('--targets', 'http://websocket:3001,http://websocket-gateway-2:3001,http://websocket-gateway-3:3001'))
  .split(',').map((value) => value.trim()).filter(Boolean);
const TOKEN = process.env.RUNTIME_ADMIN_TOKEN || process.env.RESTART_TOKEN || '';

function parseCommandStats(text) {
  const calls = {};
  for (const line of String(text).split('\n')) {
    const match = line.match(/^cmdstat_([^:]+):calls=(\d+)/);
    if (match) calls[match[1]] = Number(match[2]);
  }
  return calls;
}

function parseInfo(text) {
  const info = {};
  for (const line of String(text).split('\n')) {
    const index = line.indexOf(':');
    if (index > 0) info[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return info;
}

// Minimal Prometheus text parser: name{labels} value.
function parseMetrics(text) {
  const samples = [];
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([a-zA-Z_:][\w:]*)(\{([^}]*)\})?\s+([^\s]+)/);
    if (!match) continue;
    const labels = {};
    for (const pair of (match[3] || '').match(/(\w+)="((?:[^"\\]|\\.)*)"/g) || []) {
      const [, key, value] = pair.match(/(\w+)="(.*)"/);
      labels[key] = value;
    }
    samples.push({ name: match[1], labels, value: Number(match[4]) });
  }
  return samples;
}

// Quantile from cumulative histogram buckets (upper-bound estimate).
function histogramQuantiles(samples, name, groupLabel) {
  const groups = new Map();
  for (const sample of samples) {
    if (sample.name !== `${name}_bucket`) continue;
    const key = sample.labels[groupLabel] || 'all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ le: sample.labels.le === '+Inf' ? Infinity : Number(sample.labels.le), count: sample.value });
  }
  const result = {};
  for (const [key, buckets] of groups) {
    const merged = new Map();
    for (const bucket of buckets) merged.set(bucket.le, (merged.get(bucket.le) || 0) + bucket.count);
    const sorted = [...merged.entries()].map(([le, count]) => ({ le, count })).sort((a, b) => a.le - b.le);
    const total = sorted.length ? sorted[sorted.length - 1].count : 0;
    if (!total) continue;
    const quantile = (q) => {
      const bucket = sorted.find((item) => item.count >= q * total);
      return bucket && Number.isFinite(bucket.le) ? Math.round(bucket.le * 1000) : null;
    };
    result[key] = { count: total, p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99) };
  }
  return result;
}

const sum = (samples, name) => samples.filter((sample) => sample.name === name).reduce((total, sample) => total + sample.value, 0);
const first = (samples, name) => (samples.find((sample) => sample.name === name) || {}).value;

async function readGateway(base) {
  try {
    const response = await fetch(`${base}/metrics`, {
      headers: { 'x-runtime-token': TOKEN },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { target: base, error: `HTTP ${response.status}` };
    const samples = parseMetrics(await response.text());
    return {
      target: base,
      websocketConnections: sum(samples, 'leaf_websocket_connections_current'),
      eventLoopLagP95Ms: first(samples, 'leaf_event_loop_lag_p95_ms'),
      eventLoopLagMaxMs: first(samples, 'leaf_event_loop_lag_max_ms'),
      rides: {
        requested: sum(samples, 'leaf_rides_requested_total'),
        accepted: sum(samples, 'leaf_rides_accepted_total'),
        cancelled: sum(samples, 'leaf_rides_cancelled_total'),
        completed: sum(samples, 'leaf_rides_completed_total')
      },
      redisErrors: sum(samples, 'leaf_redis_errors_total'),
      hotpath: histogramQuantiles(samples, 'leaf_hotpath_duration_seconds', 'path'),
      commands: histogramQuantiles(samples, 'leaf_command_duration_seconds', 'command')
    };
  } catch (error) {
    return { target: base, error: error.message };
  }
}

async function main() {
  const redisUrl = process.env.REDIS_URL;
  const redis = redisUrl
    ? new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
    : new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  await redis.connect();
  const before = parseCommandStats(await redis.info('commandstats'));
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, WINDOW_SECONDS * 1000));
  const after = parseCommandStats(await redis.info('commandstats'));
  const elapsedMin = (Date.now() - startedAt) / 60000;
  const info = parseInfo(`${await redis.info('memory')}\n${await redis.info('clients')}\n${await redis.info('stats')}`);
  const dbsize = await redis.dbsize();
  await redis.quit();

  const ratesPerMin = Object.fromEntries(Object.keys(after)
    .map((command) => [command, Math.round(((after[command] - (before[command] || 0)) / elapsedMin) * 10) / 10])
    .filter(([, rate]) => rate > 0)
    .sort((a, b) => b[1] - a[1]));
  const report = {
    takenAt: new Date().toISOString(),
    windowSeconds: WINDOW_SECONDS,
    redis: {
      keys: dbsize,
      usedMemory: info.used_memory_human,
      maxMemory: info.maxmemory_human,
      connectedClients: Number(info.connected_clients),
      opsPerSecNow: Number(info.instantaneous_ops_per_sec),
      scanPerMin: ratesPerMin.scan || 0,
      keysPerMin: ratesPerMin.keys || 0,
      topCommandsPerMin: Object.fromEntries(Object.entries(ratesPerMin).slice(0, 12))
    },
    gateways: await Promise.all(TARGETS.map(readGateway))
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Capacity snapshot ${report.takenAt} (window ${WINDOW_SECONDS}s)`);
  console.log(`Redis: ${report.redis.keys} keys, ${report.redis.usedMemory} of ${report.redis.maxMemory}, ${report.redis.connectedClients} clients, ${report.redis.opsPerSecNow} ops/s`);
  console.log(`  SCAN/min ${report.redis.scanPerMin}   KEYS/min ${report.redis.keysPerMin}`);
  console.log(`  top/min ${Object.entries(report.redis.topCommandsPerMin).map(([cmd, rate]) => `${cmd}=${rate}`).join(' ')}`);
  for (const gateway of report.gateways) {
    if (gateway.error) { console.log(`${gateway.target}: ${gateway.error}`); continue; }
    console.log(`${gateway.target}: ws=${gateway.websocketConnections} loopLag p95=${gateway.eventLoopLagP95Ms}ms max=${gateway.eventLoopLagMaxMs}ms redisErrors=${gateway.redisErrors} rides req/acc/canc/done=${gateway.rides.requested}/${gateway.rides.accepted}/${gateway.rides.cancelled}/${gateway.rides.completed}`);
    for (const [path, q] of Object.entries(gateway.hotpath)) {
      console.log(`    hotpath ${path}: n=${q.count} p50<=${q.p50Ms}ms p95<=${q.p95Ms}ms p99<=${q.p99Ms}ms`);
    }
  }
}

main().catch((error) => {
  console.error(`capacity-snapshot failed: ${error.message}`);
  process.exit(1);
});

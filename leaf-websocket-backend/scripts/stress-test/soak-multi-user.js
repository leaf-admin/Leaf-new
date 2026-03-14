#!/usr/bin/env node
/**
 * Soak test runner for multi-user scenario.
 *
 * Usage:
 *   node scripts/stress-test/soak-multi-user.js --url http://127.0.0.1:3001 --rounds 6 --drivers 3000 --passengers 300 --socket-concurrency 180
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const url = arg('--url', 'http://127.0.0.1:3001');
const rounds = Number.parseInt(arg('--rounds', '5'), 10);
const drivers = Number.parseInt(arg('--drivers', '3000'), 10);
const passengers = Number.parseInt(arg('--passengers', '300'), 10);
const socketConcurrency = Number.parseInt(arg('--socket-concurrency', '180'), 10);
const tokenConcurrency = Number.parseInt(arg('--token-concurrency', '80'), 10);

const scriptPath = path.join(__dirname, 'multi-user-ratio-capacity.js');
const outDir = path.join(__dirname, '../../stress-reports-vps-20260306/soak');
fs.mkdirSync(outDir, { recursive: true });

function runRound(round) {
  return new Promise((resolve, reject) => {
    const cmdArgs = [
      scriptPath,
      '--url', url,
      '--drivers', String(drivers),
      '--passengers', String(passengers),
      '--socket-concurrency', String(socketConcurrency),
      '--token-concurrency', String(tokenConcurrency)
    ];

    const child = spawn('node', cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`round ${round} exit=${code}: ${stderr}`));
      }
      try {
        const jsonStart = stdout.indexOf('{');
        const report = JSON.parse(stdout.slice(jsonStart));
        resolve(report);
      } catch (err) {
        reject(new Error(`round ${round} parse error: ${err.message}`));
      }
    });
  });
}

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

(async () => {
  const startedAt = new Date().toISOString();
  const results = [];

  for (let i = 1; i <= rounds; i += 1) {
    // eslint-disable-next-line no-console
    console.log(`[soak] round ${i}/${rounds} started`);
    const report = await runRound(i);
    results.push({
      round: i,
      timestamp: report.timestamp,
      successRate: report.flow.successRate,
      throughput: report.flow.throughputReqPerSec,
      p95: report.flow.latencyMs.p95,
      p99: report.flow.latencyMs.p99,
      failed: report.flow.failed
    });
    // eslint-disable-next-line no-console
    console.log(`[soak] round ${i}/${rounds} done success=${report.flow.successRate}% throughput=${report.flow.throughputReqPerSec}`);
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    config: {
      url,
      rounds,
      drivers,
      passengers,
      socketConcurrency,
      tokenConcurrency
    },
    aggregate: {
      minSuccessRate: Math.min(...results.map((r) => r.successRate)),
      p50SuccessRate: pct(results.map((r) => r.successRate), 0.5),
      p95Latency: pct(results.map((r) => r.p95), 0.95),
      p99Latency: pct(results.map((r) => r.p99), 0.95),
      minThroughput: Math.min(...results.map((r) => r.throughput)),
      maxThroughput: Math.max(...results.map((r) => r.throughput))
    },
    rounds: results
  };

  const outPath = path.join(outDir, `soak-multi-user-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ outPath, summary }, null, 2));
})().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message || String(error));
  process.exit(1);
});


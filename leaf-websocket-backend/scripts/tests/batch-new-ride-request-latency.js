#!/usr/bin/env node

/**
 * Executa N rodadas do script measure-new-ride-request-latency.js
 * e consolida métricas p50/p95/p99.
 *
 * Uso:
 *   node scripts/tests/batch-new-ride-request-latency.js
 *
 * Variáveis:
 *   RUNS=10
 *   WS_URL=https://socket.62.169.31.231.sslip.io
 *   API_BASE_URL=https://api.62.169.31.231.sslip.io
 */

const path = require('path');
const { spawnSync } = require('child_process');

const RUNS = Number(process.env.RUNS || 10);
const WS_URL = process.env.WS_URL || 'https://socket.62.169.31.231.sslip.io';
const CWD = path.join(__dirname, '..', '..');
const TARGET = path.join('scripts', 'tests', 'measure-new-ride-request-latency.js');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const k = (sorted.length - 1) * (p / 100);
  const f = Math.floor(k);
  const c = Math.ceil(k);
  if (f === c) return sorted[k];
  return sorted[f] * (c - k) + sorted[c] * (k - f);
}

function parseElapsed(output) {
  const success = /"success"\s*:\s*true/.test(output);
  const elapsedMatch = output.match(/"elapsedMs"\s*:\s*(\d+)/);
  if (!success || !elapsedMatch) return null;
  return Number(elapsedMatch[1]);
}

async function run() {
  const elapsedValues = [];
  const failures = [];

  for (let i = 1; i <= RUNS; i += 1) {
    process.stdout.write(`Run ${i}/${RUNS} ... `);

    const result = spawnSync('node', [TARGET], {
      cwd: CWD,
      env: {
        ...process.env,
        WS_URL,
        API_BASE_URL: process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io'
      },
      encoding: 'utf8',
      timeout: 70000,
      maxBuffer: 8 * 1024 * 1024
    });

    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    if (result.error) {
      failures.push({
        run: i,
        reason: `spawn_error:${result.error.message}`
      });
      console.log('failed(spawn_error)');
      continue;
    }

    const elapsed = parseElapsed(output);
    if (Number.isFinite(elapsed)) {
      elapsedValues.push(elapsed);
      console.log(`${elapsed}ms`);
    } else {
      failures.push({
        run: i,
        reason: `non_success_or_no_elapsed(exit=${result.status})`,
        sampleTail: output.slice(-800)
      });
      console.log('failed(non_success)');
    }
  }

  const sorted = [...elapsedValues].sort((a, b) => a - b);
  const summary = {
    runsTotal: RUNS,
    runsSuccess: elapsedValues.length,
    runsFail: RUNS - elapsedValues.length,
    successRatePct: Number(((elapsedValues.length / RUNS) * 100).toFixed(2)),
    elapsedMs: {
      min: sorted.length ? sorted[0] : null,
      p50: sorted.length ? Number(percentile(sorted, 50).toFixed(2)) : null,
      p95: sorted.length ? Number(percentile(sorted, 95).toFixed(2)) : null,
      p99: sorted.length ? Number(percentile(sorted, 99).toFixed(2)) : null,
      max: sorted.length ? sorted[sorted.length - 1] : null,
      avg: sorted.length
        ? Number((sorted.reduce((acc, value) => acc + value, 0) / sorted.length).toFixed(2))
        : null
    }
  };

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    console.log('\n=== FAILURES (first 3) ===');
    failures.slice(0, 3).forEach((failure) => {
      console.log(JSON.stringify(failure, null, 2));
    });
  }

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(`batch_new_ride_latency_error: ${error.message}`);
  process.exitCode = 1;
});

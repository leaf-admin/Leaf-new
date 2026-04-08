#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const backendRoot = path.resolve(__dirname, '../..');
const stressRunner = path.join(backendRoot, 'scripts/stress-test/sustained-active-rides-capacity.cjs');

function arg(name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function argBool(name, fallback = false) {
  const raw = String(arg(name, fallback ? 'true' : 'false')).trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function argInt(name, fallback = 0) {
  const raw = arg(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(values = [], percentileValue = 95) {
  const numeric = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (numeric.length === 0) return null;
  const index = Math.min(
    numeric.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * numeric.length) - 1)
  );
  return numeric[index];
}

function defaultWindows(target) {
  if (target >= 350) {
    return [
      `warmup:120:${Math.max(120, Math.round(target * 0.55))}:180:300`,
      `burst:180:${target}:240:420`,
      `cooldown:120:${Math.max(90, Math.round(target * 0.35))}:180:300`
    ].join(',');
  }

  return [
    `warmup:180:${Math.max(100, Math.round(target * 0.5))}:180:300`,
    `normal:300:${target}:240:420`,
    `cooldown:180:${Math.max(80, Math.round(target * 0.35))}:180:300`
  ].join(',');
}

function extractDispatchTimeoutCount(summary = {}) {
  const topErrors = Array.isArray(summary.topErrors) ? summary.topErrors : [];
  return topErrors
    .filter((entry) => String(entry.error || '').includes('dispatch_timeout_no_available_driver'))
    .reduce((sum, entry) => sum + (Number(entry.count) || 0), 0);
}

function buildScenarioSummary(target, report) {
  const summary = report.summary || {};
  const latencyMs = summary.latencyMs || {};
  const createBooking = Array.isArray(latencyMs.createBooking) ? latencyMs.createBooking : [];
  const bookingToDispatch = Array.isArray(latencyMs.bookingToDispatch) ? latencyMs.bookingToDispatch : [];
  const dispatchTimeoutCount = extractDispatchTimeoutCount(summary);
  const startedRides = Number(summary.startedRides || 0);
  const completionRatePct = Number(summary.completionRatePct || 0);
  const dispatchTimeoutPct = startedRides > 0
    ? Number(((dispatchTimeoutCount / startedRides) * 100).toFixed(3))
    : 0;

  return {
    target,
    reportPath: report.__reportPath || null,
    completionRatePct,
    startedRides,
    completedRides: Number(summary.completedRides || 0),
    failedStarts: Number(summary.failedStarts || 0),
    failedCompletes: Number(summary.failedCompletes || 0),
    noDriverCapacityMisses: Number(summary.noDriverCapacityMisses || 0),
    dispatchTimeoutCount,
    dispatchTimeoutPct,
    createBooking: {
      p95Ms: percentile(createBooking, 95),
      p99Ms: percentile(createBooking, 99)
    },
    bookingToDispatch: {
      p95Ms: percentile(bookingToDispatch, 95),
      p99Ms: percentile(bookingToDispatch, 99)
    },
    sustainedActiveRidesEstimated: Number(report.capacityEstimate?.sustainedActiveRidesEstimated || 0),
    topErrors: summary.topErrors || []
  };
}

function evaluateScenario(target, summary) {
  const thresholds = {
    completionRatePct: 99.5,
    createBookingP95Ms: 700,
    createBookingP99Ms: 1500,
    bookingToDispatchP95Ms: 2000,
    bookingToDispatchP99Ms: 5000,
    dispatchTimeoutPct: 0.5
  };

  const passed = (
    summary.completionRatePct >= thresholds.completionRatePct &&
    (summary.createBooking.p95Ms == null || summary.createBooking.p95Ms <= thresholds.createBookingP95Ms) &&
    (summary.createBooking.p99Ms == null || summary.createBooking.p99Ms <= thresholds.createBookingP99Ms) &&
    (summary.bookingToDispatch.p95Ms == null || summary.bookingToDispatch.p95Ms <= thresholds.bookingToDispatchP95Ms) &&
    (summary.bookingToDispatch.p99Ms == null || summary.bookingToDispatch.p99Ms <= thresholds.bookingToDispatchP99Ms) &&
    summary.dispatchTimeoutPct < thresholds.dispatchTimeoutPct
  );

  return {
    target,
    passed,
    thresholds,
    summary
  };
}

function writeMarkdown(reportDir, batterySummary) {
  const lines = [
    '# Go-Live Headroom Battery',
    '',
    `Data: ${new Date().toISOString()}`,
    '',
    `Conclusão: **${batterySummary.conclusion}**`,
    '',
    '| Cenário | Completion % | CreateBooking p95/p99 | BookingToDispatch p95/p99 | Dispatch timeout % | Sustained active | Resultado |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'
  ];

  batterySummary.scenarios.forEach((scenario) => {
    lines.push(
      `| ${scenario.target} | ${scenario.summary.completionRatePct.toFixed(2)} | ${scenario.summary.createBooking.p95Ms ?? 'N/A'}/${scenario.summary.createBooking.p99Ms ?? 'N/A'} | ${scenario.summary.bookingToDispatch.p95Ms ?? 'N/A'}/${scenario.summary.bookingToDispatch.p99Ms ?? 'N/A'} | ${scenario.summary.dispatchTimeoutPct.toFixed(3)} | ${scenario.summary.sustainedActiveRidesEstimated || 'N/A'} | ${scenario.passed ? 'PASS' : 'FAIL'} |`
    );
  });

  lines.push('');
  lines.push('## Critério de aceite');
  lines.push('');
  lines.push('- `250`: precisa ficar confortável nos thresholds P0.');
  lines.push('- `300`: precisa fechar verde para autorizar rollout até 250 com folga.');
  lines.push('- `350`: pode degradar, mas não deve falhar em cascata.');
  lines.push('');

  fs.writeFileSync(path.join(reportDir, 'summary.md'), lines.join('\n'));
}

async function main() {
  const url = arg('--url', process.env.WS_URL || process.env.API_BASE_URL || 'http://127.0.0.1:3001');
  const forceRealPayment = argBool(
    '--force-real-payment',
    String(process.env.HEADROOM_FORCE_REAL_PAYMENT || 'false').toLowerCase() === 'true'
  );
  const startFailureCooldownMs = argInt(
    '--start-failure-cooldown-ms',
    Number.parseInt(process.env.HEADROOM_START_FAILURE_COOLDOWN_MS || '3000', 10)
  );
  const paymentFailureCooldownMs = argInt(
    '--payment-failure-cooldown-ms',
    Number.parseInt(process.env.HEADROOM_PAYMENT_FAILURE_COOLDOWN_MS || '5000', 10)
  );
  const rateLimitFailureCooldownMs = argInt(
    '--rate-limit-failure-cooldown-ms',
    Number.parseInt(process.env.HEADROOM_RATE_LIMIT_FAILURE_COOLDOWN_MS || '15000', 10)
  );
  const targets = String(arg('--targets', '250,300,350'))
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const quiet = argBool('--quiet', false);
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(backendRoot, 'reports', `go-live-headroom-${timestamp}`);
  fs.mkdirSync(reportDir, { recursive: true });

  const scenarioResults = [];

  for (const target of targets) {
    const reportPath = path.join(reportDir, `scenario-${target}.json`);
    const windows = defaultWindows(target);
    const args = [
      stressRunner,
      '--url', url,
      '--drivers', String(target),
      '--passengers', String(target),
      '--profile', 'production',
      '--force-real-payment', forceRealPayment ? 'true' : 'false',
      '--start-failure-cooldown-ms', String(startFailureCooldownMs),
      '--payment-failure-cooldown-ms', String(paymentFailureCooldownMs),
      '--rate-limit-failure-cooldown-ms', String(rateLimitFailureCooldownMs),
      '--windows', windows,
      '--report-path', reportPath,
      '--quiet', quiet ? 'true' : 'false'
    ];

    if (process.env.DRIVER_STATUS_DEBUG_TOKEN) {
      args.push('--driver-status-token', process.env.DRIVER_STATUS_DEBUG_TOKEN);
    }

    const result = spawnSync('node', args, {
      cwd: backendRoot,
      stdio: 'inherit',
      env: process.env
    });

    if (result.status !== 0) {
      scenarioResults.push({
        target,
        passed: false,
        error: `runner_exit_${result.status}`
      });
      continue;
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    report.__reportPath = reportPath;
    const summary = buildScenarioSummary(target, report);
    scenarioResults.push(evaluateScenario(target, summary));
  }

  const scenario250 = scenarioResults.find((scenario) => scenario.target === 250);
  const scenario300 = scenarioResults.find((scenario) => scenario.target === 300);
  const conclusion = scenario250?.passed && scenario300?.passed ? 'GO' : 'NO-GO';

  const batterySummary = {
    generatedAt: new Date().toISOString(),
    url,
    config: {
      forceRealPayment,
      startFailureCooldownMs,
      paymentFailureCooldownMs,
      rateLimitFailureCooldownMs
    },
    conclusion,
    scenarios: scenarioResults
  };

  fs.writeFileSync(path.join(reportDir, 'summary.json'), JSON.stringify(batterySummary, null, 2));
  writeMarkdown(reportDir, batterySummary);

  process.stdout.write(`${JSON.stringify({ ok: true, reportDir, conclusion }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

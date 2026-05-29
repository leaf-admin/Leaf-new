#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const BASE_URL = process.env.BASE_URL || 'https://api.leaf.app.br';
const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@leaf.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT || 'leaf-reactnative';
const SERVICE_ACCOUNT = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || path.join(ROOT, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
const auth = new GoogleAuth({ keyFile: SERVICE_ACCOUNT, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function num(v) { return Number(Number(v || 0).toFixed(6)); }
function bytesToGiB(v) { return num(Number(v || 0) / (1024 ** 3)); }
function parseLabelString(raw = '') {
  const labels = {};
  const re = /(\w+)="((?:\\.|[^"])*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) labels[m[1]] = m[2].replace(/\\"/g, '"');
  return labels;
}
function parsePrometheusText(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withLabels = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([-+eE0-9.]+)$/);
    if (withLabels) {
      rows.push({ metric: withLabels[1], labels: parseLabelString(withLabels[2]), value: Number(withLabels[3]) });
      continue;
    }
    const plain = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([-+eE0-9.]+)$/);
    if (plain) rows.push({ metric: plain[1], labels: {}, value: Number(plain[2]) });
  }
  return rows;
}
function sumMetric(rows, metricName, matchLabels = {}) {
  return rows
    .filter((row) => row.metric === metricName)
    .filter((row) => Object.entries(matchLabels).every(([k, v]) => row.labels[k] === v))
    .reduce((acc, row) => acc + (Number.isFinite(row.value) ? row.value : 0), 0);
}
function metricDelta(beforeRows, afterRows, metricName, labels = {}) {
  return Number((sumMetric(afterRows, metricName, labels) - sumMetric(beforeRows, metricName, labels)).toFixed(6));
}
function keyForRow(row) {
  const labels = Object.entries(row.labels || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('|');
  return `${row.metric}|${labels}`;
}
function diffRows(before, after, metricPrefix) {
  const beforeMap = new Map(before.filter((row) => row.metric.startsWith(metricPrefix)).map((row) => [keyForRow(row), row]));
  return after
    .filter((row) => row.metric.startsWith(metricPrefix))
    .map((row) => {
      const prev = beforeMap.get(keyForRow(row))?.value || 0;
      const delta = Number((row.value - prev).toFixed(6));
      return delta > 0 ? { metric: row.metric, labels: row.labels, delta } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.delta - a.delta);
}
async function adminLogin() {
  const response = await axios.post(`${BASE_URL}/api/admin/auth/login`, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { timeout: 20000 });
  return response.data.accessToken;
}
async function fetchPrometheusRows(token) {
  const response = await axios.get(`${BASE_URL}/api/metrics/prometheus`, { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
  return parsePrometheusText(response.data);
}
async function fetchPlacesMetrics() {
  const response = await axios.get(`${BASE_URL}/api/places/metrics`, { timeout: 20000 });
  return response.data?.metrics || {};
}
async function monitoringRequest(url) {
  const client = await auth.getClient();
  const response = await client.request({ url, method: 'GET', timeout: 60000 });
  return response.data;
}
async function fetchSeriesWindow(metricType, start, end, aggregation = {}, project = FIREBASE_PROJECT) {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString()
  });
  for (const [key, value] of Object.entries(aggregation)) params.set(key, value);
  let pageToken = '';
  const out = [];
  do {
    const qp = new URLSearchParams(params);
    if (pageToken) qp.set('pageToken', pageToken);
    const data = await monitoringRequest(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${qp.toString()}`);
    out.push(...(data.timeSeries || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}
function seriesValue(ts) {
  return (ts.points || []).reduce((acc, point) => acc + Number(point.value?.int64Value || point.value?.doubleValue || 0), 0);
}
function total(series) {
  return num(series.reduce((acc, ts) => acc + seriesValue(ts), 0));
}
function labelFor(ts, candidates) {
  for (const candidate of candidates) {
    if (ts.resource?.labels?.[candidate]) return ts.resource.labels[candidate];
    if (ts.metric?.labels?.[candidate]) return ts.metric.labels[candidate];
  }
  return 'unknown';
}
function group(series, candidates, suffixCandidates = []) {
  const map = {};
  for (const ts of series) {
    let key = labelFor(ts, candidates);
    if (suffixCandidates.length) {
      const suffix = labelFor(ts, suffixCandidates);
      if (suffix && suffix !== 'unknown') key = `${key}__${suffix}`;
    }
    map[key] = (map[key] || 0) + seriesValue(ts);
  }
  return map;
}
function top(map, limit = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, value: num(value) }));
}
function usdCostForFirestore({ reads = 0, writes = 0, deletes = 0 }) {
  return Number((((reads / 100000) * 0.03) + ((writes / 100000) * 0.09) + ((deletes / 100000) * 0.01)).toFixed(8));
}
async function collectServiceWindow(start, end) {
  const [
    firestoreReads,
    firestoreWrites,
    firestoreDeletes,
    rtdbSent,
    rtdbHits,
    cfExec,
    runReq
  ] = await Promise.all([
    fetchSeriesWindow('firestore.googleapis.com/document/read_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('firestore.googleapis.com/document/write_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('firestore.googleapis.com/document/delete_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('firebasedatabase.googleapis.com/network/sent_bytes_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('firebasedatabase.googleapis.com/network/api_hits_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('cloudfunctions.googleapis.com/function/execution_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' }),
    fetchSeriesWindow('run.googleapis.com/request_count', start, end, { 'aggregation.alignmentPeriod': '60s', 'aggregation.perSeriesAligner': 'ALIGN_SUM' })
  ]);

  const reads = total(firestoreReads);
  const writes = total(firestoreWrites);
  const deletes = total(firestoreDeletes);
  return {
    firestore: {
      reads,
      writes,
      deletes,
      estimatedCostUsd: usdCostForFirestore({ reads, writes, deletes }),
      readTypes: top(group(firestoreReads, ['type']), 10),
      writeOps: top(group(firestoreWrites, ['op']), 10),
      deleteOps: top(group(firestoreDeletes, ['op']), 10)
    },
    realtimeDatabase: {
      sentBytes: total(rtdbSent),
      sentGiB: bytesToGiB(total(rtdbSent)),
      apiHits: total(rtdbHits),
      hitOperations: top(group(rtdbHits, ['operation_type']), 10)
    },
    cloudFunctions: {
      executions: total(cfExec),
      topFunctions: top(group(cfExec, ['function_name', 'function'], ['status']), 10)
    },
    cloudRun: {
      requests: total(runReq),
      topServices: top(group(runReq, ['service_name', 'configuration_name'], ['response_code_class']), 10)
    }
  };
}
function summarizePrometheus(beforeRows, afterRows) {
  const commandNames = ['RequestRide', 'AcceptRide', 'StartTrip', 'CompleteTrip', 'RequestRideExtension', 'RespondRideExtension', 'EndRideEarlyByRider', 'InterruptRideOperational', 'RespondOperationalContinuation'];
  const commands = commandNames
    .map((name) => ({ metric: 'leaf_command_total', labels: { command_name: name, status: 'success' }, delta: metricDelta(beforeRows, afterRows, 'leaf_command_total', { command_name: name, status: 'success' }) }))
    .filter((row) => row.delta > 0);
  return {
    commands,
    eventsPublished: diffRows(beforeRows, afterRows, 'leaf_event_published_total').slice(0, 20),
    eventsConsumed: diffRows(beforeRows, afterRows, 'leaf_event_consumed_total').slice(0, 20),
    realtimeUpdates: diffRows(beforeRows, afterRows, 'leaf_realtime_updates_total').slice(0, 20),
    ridesRequestedDelta: metricDelta(beforeRows, afterRows, 'leaf_rides_requested_total', {}),
    ridesAcceptedDelta: metricDelta(beforeRows, afterRows, 'leaf_rides_accepted_total', {}),
    ridesCompletedDelta: metricDelta(beforeRows, afterRows, 'leaf_rides_completed_total', {})
  };
}
function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (_error) { return null; }
}
function runNodeScript(scriptPath, env = {}) {
  const stdout = execFileSync('node', [scriptPath], {
    cwd: ROOT,
    env: { ...process.env, BASE_URL, WS_URL, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024
  }).trim();
  const parsed = safeJsonParse(stdout);
  if (parsed) return parsed;
  const startIndex = stdout.indexOf('{');
  if (startIndex >= 0) {
    const maybe = safeJsonParse(stdout.slice(startIndex));
    if (maybe) return maybe;
  }
  throw new Error(`Não foi possível parsear stdout do script ${scriptPath}`);
}
function loadReportFromRunOutput(runOutput) {
  if (runOutput?.reportFile) {
    return JSON.parse(fs.readFileSync(runOutput.reportFile, 'utf8'));
  }
  if (runOutput?.meta?.reportPath) {
    return JSON.parse(fs.readFileSync(runOutput.meta.reportPath, 'utf8'));
  }
  return runOutput;
}
function normalizeWindow(report) {
  const startedAt = new Date(report?.meta?.startedAt || report?.meta?.started_at || Date.now());
  const finishedAt = new Date(report?.meta?.finishedAt || report?.meta?.finished_at || Date.now());
  return { startedAt, finishedAt };
}
function summarizeLifecycle(report) {
  return {
    extensionAcceptedAndPaid: Boolean(report?.flows?.extension?.passengerExtensionConfirmed?.status === 'CONFIRMED'),
    extensionRejected: Boolean(report?.flows?.extensionRejected?.rejectedPassengerEvent?.status === 'DRIVER_DECLINED'),
    extensionExpired: Boolean(report?.flows?.extensionExpired?.expiredPassengerEvent?.status === 'EXPIRED'),
    cancelBlockedAfterStart: Boolean(report?.flows?.cancelAfterStartBlocked?.cancelError?.code === 'TRIP_ALREADY_STARTED'),
    earlyEndCompletionType: report?.flows?.earlyEndByRider?.passengerTripCompleted?.completionType || null,
    earlyEndEstimatedRefund: report?.flows?.earlyEndByRider?.passengerTripCompleted?.settlement?.estimatedRefund ?? null
  };
}
function summarizeOperational(report) {
  const completion = report?.flows?.continueWithOtherDriver?.passengerCompletedTrip || report?.flows?.continueWithOtherDriver?.driver2CompletedTrip || null;
  const endAfterInterruption = report?.flows?.passengerEndsAfterInterruption?.passengerEndedTrip || report?.flows?.passengerEndsAfterInterruption?.driver1EndedTrip || null;
  const legs = completion?.rideLegs || [];
  return {
    continuationOfferReceived: Boolean(report?.flows?.driver2OfferDebug?.isOperationalContinuation || report?.flows?.driver2OfferDebug?.rideMode === 'continuation'),
    continuationRideLegs: legs.length,
    secondLegAbsorbedOperationalFee: legs[1]?.platformAbsorbedOperationalFee ?? null,
    secondLegAbsorbedPaymentFee: legs[1]?.platformAbsorbedPaymentIntermediationFee ?? null,
    interruptionEndedCompletionType: endAfterInterruption?.completionType || null,
    interruptionEstimatedRefund: endAfterInterruption?.settlement?.estimatedRefund ?? null
  };
}

async function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const token = await adminLogin();
  const scenarios = [
    { name: 'normal_ride', script: path.join(ROOT, 'scripts', 'tests', 'smoke-normal-ride-vps.cjs'), summarize: (report) => ({ bookingId: report?.flow?.bookingId || null, providerCostUsd: report?.cost?.totalObservedProviderCostUsd ?? null }) },
    { name: 'extension_and_early_end', script: path.join(ROOT, 'scripts', 'tests', 'smoke-ride-lifecycle-vps.cjs'), summarize: summarizeLifecycle },
    { name: 'operational_reassignment', script: path.join(ROOT, 'scripts', 'tests', 'smoke-operational-reassignment-vps.cjs'), summarize: summarizeOperational }
  ];

  const consolidated = {
    meta: {
      startedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      wsUrl: WS_URL,
      serviceAccount: SERVICE_ACCOUNT,
      reportPath: path.join(REPORT_DIR, `lifecycle-cost-validation-vps-${Date.now()}.json`)
    },
    scenarios: {}
  };

  for (const scenario of scenarios) {
    const promBefore = await fetchPrometheusRows(token);
    const placesBefore = await fetchPlacesMetrics();
    const runOutput = runNodeScript(scenario.script);
    const report = loadReportFromRunOutput(runOutput);
    await sleep(3000);
    const promAfter = await fetchPrometheusRows(token);
    const placesAfter = await fetchPlacesMetrics();
    const { startedAt, finishedAt } = normalizeWindow(report);
    const serviceWindow = await collectServiceWindow(startedAt, finishedAt);
    consolidated.scenarios[scenario.name] = {
      sourceScript: scenario.script,
      sourceReport: runOutput?.reportFile || report?.meta?.reportPath || null,
      window: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
      status: report?.status || report?.meta?.status || 'unknown',
      summary: scenario.summarize(report),
      prometheus: summarizePrometheus(promBefore, promAfter),
      placesCacheDelta: {
        totalRequests: num((placesAfter.totalRequests || 0) - (placesBefore.totalRequests || 0)),
        hits: num((placesAfter.hits || 0) - (placesBefore.hits || 0)),
        misses: num((placesAfter.misses || 0) - (placesBefore.misses || 0)),
        saves: num((placesAfter.saves || 0) - (placesBefore.saves || 0)),
        errors: num((placesAfter.errors || 0) - (placesBefore.errors || 0))
      },
      serviceWindow,
      notes: [
        'Prometheus deltas são medidos imediatamente antes/depois do cenário.',
        'Cloud Monitoring por janela pode incluir ruído residual do ambiente compartilhado.',
        'Google Routes continua majoritariamente cliente-side; o backend não expõe contador confiável por chamada neste runtime.'
      ]
    };
  }

  consolidated.meta.finishedAt = new Date().toISOString();
  fs.writeFileSync(consolidated.meta.reportPath, `${JSON.stringify(consolidated, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, reportPath: consolidated.meta.reportPath, scenarios: Object.fromEntries(Object.entries(consolidated.scenarios).map(([name, data]) => [name, { status: data.status, sourceReport: data.sourceReport }])) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

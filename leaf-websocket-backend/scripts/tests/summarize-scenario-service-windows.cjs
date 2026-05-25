#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_DIR = path.join(ROOT, 'reports');
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT || 'leaf-reactnative';
const SERVICE_ACCOUNT = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(ROOT, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
const auth = new GoogleAuth({ keyFile: SERVICE_ACCOUNT, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const OUTPUT = path.join(REPORT_DIR, `scenario-service-window-summary-${Date.now()}.json`);

function num(v) { return Number(Number(v || 0).toFixed(6)); }
function bytesToGiB(v) { return num(Number(v || 0) / (1024 ** 3)); }
function top(map, limit = 10) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, value]) => ({ key, value: num(value) }));
}
function latestReport(prefix) {
  const matches = fs.readdirSync(REPORT_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort()
    .reverse();
  for (const match of matches) {
    const fullPath = path.join(REPORT_DIR, match);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      if (String(parsed?.status || parsed?.meta?.status || '').toLowerCase() === 'success') {
        return fullPath;
      }
    } catch (_error) {
      // ignore malformed/partial reports
    }
  }
  throw new Error(`report_not_found:${prefix}`);
}
function labelFor(ts, candidates) {
  for (const c of candidates) {
    if (ts.resource?.labels?.[c]) return ts.resource.labels[c];
    if (ts.metric?.labels?.[c]) return ts.metric.labels[c];
  }
  return 'unknown';
}
function group(series, candidates, suffixCandidates = []) {
  const out = {};
  for (const ts of series) {
    let key = labelFor(ts, candidates);
    if (suffixCandidates.length) {
      const suffix = labelFor(ts, suffixCandidates);
      if (suffix && suffix !== 'unknown') key = `${key}__${suffix}`;
    }
    out[key] = (out[key] || 0) + seriesValue(ts);
  }
  return out;
}
function seriesValue(ts) {
  return (ts.points || []).reduce((acc, point) => acc + Number(point.value?.int64Value || point.value?.doubleValue || 0), 0);
}
function total(series) { return num(series.reduce((acc, ts) => acc + seriesValue(ts), 0)); }
async function req(url) {
  const client = await auth.getClient();
  const res = await client.request({ url, method: 'GET', timeout: 60000 });
  return res.data;
}
async function fetchSeries(metricType, start, end) {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '60s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM'
  });
  const data = await req(`https://monitoring.googleapis.com/v3/projects/${FIREBASE_PROJECT}/timeSeries?${params.toString()}`);
  return data.timeSeries || [];
}
function usdCostForFirestore({ reads = 0, writes = 0, deletes = 0 }) {
  return Number((((reads / 100000) * 0.03) + ((writes / 100000) * 0.09) + ((deletes / 100000) * 0.01)).toFixed(8));
}
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function normalizeWindow(report) {
  return {
    startedAt: new Date(report?.meta?.startedAt || report?.meta?.started_at || report?.meta?.generatedAt || Date.now()),
    finishedAt: new Date(report?.meta?.finishedAt || report?.meta?.finished_at || report?.meta?.generatedAt || Date.now())
  };
}
function scenarioSummary(name, report) {
  if (name === 'normal_ride') {
    return {
      bookingId: report?.flow?.booking?.bookingId || null,
      completionType: report?.flow?.passengerCompleted?.completionType || null,
      authoritativeSnapshot: Boolean(report?.flow?.passengerCompleted?.authoritativeSnapshot)
    };
  }
  if (name === 'extension_and_early_end') {
    return {
      extensionConfirmed: report?.flows?.extension?.passengerExtensionConfirmed?.status || null,
      extensionExpired: report?.flows?.extensionExpired?.expiredPassengerEvent?.status || null,
      extensionRejected: report?.flows?.extensionRejected?.rejectedPassengerEvent?.status || null,
      earlyEndCompletionType: report?.flows?.earlyEnd?.passengerEarlyTripCompleted?.completionType || report?.flows?.earlyEnd?.driverEarlyTripCompleted?.completionType || null,
      earlyEndEstimatedRefund: report?.flows?.earlyEnd?.passengerEarlyTripCompleted?.settlement?.estimatedRefund ?? report?.flows?.earlyEnd?.driverEarlyTripCompleted?.settlement?.estimatedRefund ?? null
    };
  }
  return {
    continuationOfferReceived: Boolean(report?.flows?.driver2OfferDebug?.isOperationalContinuation || report?.flows?.driver2OfferDebug?.rideMode === 'continuation'),
    continuationCompletionType: report?.flows?.continueWithOtherDriver?.passengerCompleted?.completionType || report?.flows?.continueWithOtherDriver?.driver2Completed?.completionType || null,
    continuationRideLegs: report?.flows?.continueWithOtherDriver?.passengerCompleted?.rideLegs?.length || report?.flows?.continueWithOtherDriver?.driver2Completed?.rideLegs?.length || 0,
    endAfterInterruptionType: report?.flows?.endAfterInterruption?.passengerEndedTrip?.completionType || report?.flows?.endAfterInterruption?.driver1EndedTrip?.completionType || null,
    endAfterInterruptionRefund: report?.flows?.endAfterInterruption?.passengerEndedTrip?.settlement?.estimatedRefund ?? report?.flows?.endAfterInterruption?.driver1EndedTrip?.settlement?.estimatedRefund ?? null
  };
}

(async () => {
  const scenarios = {
    normal_ride: latestReport('normal-ride-smoke-vps-'),
    extension_and_early_end: latestReport('ride-lifecycle-smoke-vps-'),
    operational_reassignment: latestReport('operational-reassignment-smoke-vps-')
  };
  const output = { meta: { generatedAt: new Date().toISOString(), output: OUTPUT }, scenarios: {} };

  for (const [name, reportPath] of Object.entries(scenarios)) {
    const report = loadJson(reportPath);
    const { startedAt, finishedAt } = normalizeWindow(report);
    const [fsReads, fsWrites, fsDeletes, rtdbSent, rtdbHits, cfExec, runReq] = await Promise.all([
      fetchSeries('firestore.googleapis.com/document/read_count', startedAt, finishedAt),
      fetchSeries('firestore.googleapis.com/document/write_count', startedAt, finishedAt),
      fetchSeries('firestore.googleapis.com/document/delete_count', startedAt, finishedAt),
      fetchSeries('firebasedatabase.googleapis.com/network/sent_bytes_count', startedAt, finishedAt),
      fetchSeries('firebasedatabase.googleapis.com/network/api_hits_count', startedAt, finishedAt),
      fetchSeries('cloudfunctions.googleapis.com/function/execution_count', startedAt, finishedAt),
      fetchSeries('run.googleapis.com/request_count', startedAt, finishedAt)
    ]);

    const reads = total(fsReads);
    const writes = total(fsWrites);
    const deletes = total(fsDeletes);

    output.scenarios[name] = {
      reportPath,
      window: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString() },
      summary: scenarioSummary(name, report),
      firestore: {
        reads,
        writes,
        deletes,
        estimatedCostUsd: usdCostForFirestore({ reads, writes, deletes }),
        readTypes: top(group(fsReads, ['type']), 10),
        writeOps: top(group(fsWrites, ['op']), 10)
      },
      realtimeDatabase: {
        sentBytes: total(rtdbSent),
        sentGiB: bytesToGiB(total(rtdbSent)),
        apiHits: total(rtdbHits),
        operations: top(group(rtdbHits, ['operation_type']), 10)
      },
      cloudFunctions: {
        executions: total(cfExec),
        topFunctions: top(group(cfExec, ['function_name', 'function'], ['status']), 10)
      },
      cloudRun: {
        requests: total(runReq),
        topServices: top(group(runReq, ['service_name', 'configuration_name'], ['response_code_class']), 10)
      },
      notes: [
        'Janela curta de Cloud Monitoring pode conter ruído residual do ambiente compartilhado.',
        'Google Places/Routes não foram medidos por chamada neste relatório porque o runtime atual delega grande parte disso ao cliente e os smokes usaram coordenadas controladas.'
      ]
    };
  }

  fs.writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output: OUTPUT, scenarios }, null, 2));
})();

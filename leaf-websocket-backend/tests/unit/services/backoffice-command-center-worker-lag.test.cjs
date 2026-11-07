// Run: node --test tests/unit/services/backoffice-command-center-worker-lag.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

function loadModule(relativePath, mocks) {
  const filename = resolve(__dirname, '../../..', relativePath);
  const module = { exports: {} };
  runInNewContext(readFileSync(filename, 'utf8'), {
    module,
    process: { env: {} },
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
      return mocks[name];
    }
  }, { filename });
  return module.exports;
}

const WorkerHealthMonitor = loadModule('workers/health-monitor.js', {
  '../utils/redis-pool': {},
  '../utils/logger': { logStructured() {} },
  '../utils/prometheus-metrics': {
    metrics: { setActiveWorkers() {}, setEventBacklog() {} }
  }
});

const { BackofficeCommandCenterService } = loadModule('services/backoffice-command-center-service.js', {
  '../utils/redis-pool': {},
  './modern-metrics-service': {},
  './ops-overview-service': {},
  './campaign-center-service': {},
  './health-check-service': {},
  './driver-application-service': {},
  './payment-runtime-profile-service': {},
  './backoffice-sku-cost-monitor-service': { attachFinancials: () => ({ status: 'healthy' }) },
  './ride-cost-alert-service': {},
  '../workers/health-monitor': WorkerHealthMonitor,
  '../utils/logger': { logStructured() {} },
  '../utils/pilot-launch-flags': { getPilotLaunchFlags: () => ({}) }
});

function snapshot(workerLag, { workerHealth = { status: 'healthy' }, omitLag = false, healthStatus = 'healthy' } = {}) {
  const values = {
    redis: {}, health: { status: healthStatus }, opsOverview: {}, usersStatus: {},
    ridesToday: {}, financialToday: {}, operationalRevenue: {},
    campaignStats: { active: 1 }, driverOnboarding: {},
    paymentRuntime: { defaultEnvironment: 'sandbox' }, skuCostMonitor: {},
    workerHealth, workerDLQ: { dlqSize: 0 }
  };
  if (!omitLag) values.workerLag = workerLag;
  const sources = Object.entries(values).map(([id, value]) => ({
    id, value, status: 'ok', critical: false
  }));
  return new BackofficeCommandCenterService().buildSnapshot({
    sources, hours: 1, period: 'today', generatedAt: '2026-10-26T00:00:00.000Z'
  });
}

function assertUnknown(result) {
  assert.equal(result.status, 'warning');
  for (const id of ['socket', 'workers']) {
    const domain = result.services.domainHealth.find((item) => item.id === id);
    assert.equal(domain.status, 'warning', id);
    assert.match(domain.action, /Lag indisponível/);
    assert.match(domain.action, /[Vv]erificar/);
  }
  const action = result.actionItems.find((item) => item.id === 'workers-attention');
  assert.ok(action, 'Unknown lag requires an action item');
  assert.match(action.description, /Lag indisponível/);
  assert.match(action.description, /[Vv]erificar/);
}

const unknownCases = [
  ['null', null], ['undefined', undefined], ['empty object', {}],
  ['null lag', { lag: null }], ['undefined lag', { lag: undefined }],
  ['nested null', { lag: { lag: null } }], ['missing nested lag', { lag: {} }],
  ['invalid string', { lag: 'invalid' }], ['empty string', { lag: '' }],
  ['whitespace', { lag: '  ' }], ['boolean', { lag: false }],
  ['array', { lag: [] }], ['numeric array', { lag: [0] }],
  ['negative', { lag: -1 }], ['NaN', { lag: NaN }], ['infinite', { lag: Infinity }]
];

for (const [name, value] of unknownCases) {
  test(`snapshot keeps ${name} lag unknown in general, Socket and Workers health`, () => {
    assertUnknown(snapshot(value));
  });
}

test('a missing workerLag source is unknown even if other sources resolve', () => {
  assertUnknown(snapshot(undefined, { omitLag: true }));
});

for (const value of [0, { lag: 0 }, { lag: { lag: 0 } }, { lag: '0' }]) {
  test(`a real zero remains healthy: ${JSON.stringify(value)}`, () => {
    const result = snapshot(value);
    assert.equal(result.status, 'healthy');
    for (const id of ['socket', 'workers']) {
      assert.equal(result.services.domainHealth.find((item) => item.id === id).status, 'healthy');
    }
    assert.equal(result.actionItems.some((item) => item.id === 'workers-attention'), false);
  });
}

test('high measured lag still warns with its measured value', () => {
  const result = snapshot({ lag: 1500 });
  assert.equal(result.status, 'warning');
  for (const id of ['socket', 'workers']) {
    assert.equal(result.services.domainHealth.find((item) => item.id === id).status, 'warning');
  }
  assert.match(result.actionItems.find((item) => item.id === 'workers-attention').description, /1500/);
});

test('unknown lag does not downgrade an existing unhealthy API status', () => {
  assert.equal(snapshot(null, { healthStatus: 'unhealthy' }).status, 'unhealthy');
});

async function snapshotFromStream(streamInfo, deliveredId = '0-0') {
  const monitor = new WorkerHealthMonitor();
  monitor.redis = {
    async xinfo(command) {
      if (command === 'GROUPS') return [['name', 'listener-workers', 'last-delivered-id', deliveredId]];
      if (command === 'CONSUMERS') return [['name', 'synthetic-worker', 'pending', 0, 'idle', 0]];
      if (command === 'STREAM') return streamInfo;
      assert.fail(`Unexpected XINFO command: ${command}`);
    },
    async xpending() { return []; },
    async xlen() { return 0; }
  };
  const workerHealth = await monitor.getHealth();
  const workerLag = await monitor.getStreamLag();
  return snapshot(workerLag, { workerHealth });
}

test('integrated worker-to-command-center contract preserves a failed lag read', async () => {
  const result = await snapshotFromStream(['last-entry', null]);
  assert.equal(result.services.workerHealth.lag, null);
  assert.equal(result.services.workerLag, null);
  assertUnknown(result);
});

for (const [name, streamInfo] of [
  ['last-generated-id', ['last-generated-id', '1000-0']],
  ['last-entry tuple', ['last-entry', ['1000-0', []]]]
]) {
  test(`integrated contract rejects negative timestamp lag from ${name}`, async () => {
    const result = await snapshotFromStream(streamInfo, '2500-0');
    assert.equal(result.services.workerHealth.status, 'degraded');
    assert.equal(result.services.workerHealth.reason, 'Lag indisponível');
    assert.equal(result.services.workerHealth.lag, null);
    assert.equal(result.services.workerLag, null);
    assertUnknown(result);
  });
}

test('integrated contract keeps equal nonempty stream IDs healthy with a real zero', async () => {
  const result = await snapshotFromStream(['last-generated-id', '2500-0'], '2500-0');
  assert.equal(result.services.workerHealth.status, 'healthy');
  assert.equal(result.services.workerHealth.lag, 0);
  assert.equal(result.services.workerLag.lag, 0);
  assert.equal(result.status, 'healthy');
  for (const id of ['socket', 'workers']) {
    assert.equal(result.services.domainHealth.find((item) => item.id === id).status, 'healthy');
  }
  assert.equal(result.actionItems.some((item) => item.id === 'workers-attention'), false);
});

test('integrated worker-to-command-center contract preserves a real zero', async () => {
  const result = await snapshotFromStream(['last-generated-id', '0-0', 'last-entry', null]);
  assert.equal(result.services.workerHealth.lag, 0);
  assert.equal(result.services.workerLag.lag, 0);
  assert.equal(result.status, 'healthy');
  for (const id of ['socket', 'workers']) {
    assert.equal(result.services.domainHealth.find((item) => item.id === id).status, 'healthy');
  }
});

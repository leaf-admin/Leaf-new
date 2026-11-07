// Run without external dependencies: node --test tests/unit/workers/health-monitor.test.cjs
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const workerPath = resolve(__dirname, '../../../workers/health-monitor.js');
const workerSource = readFileSync(workerPath, 'utf8');

function createMonitor({ streamInfo, deliveredId = '1000-0', missingGroup = false, readError = false }) {
    const backlogCalls = [];
    const logCalls = [];
    const mocks = {
        '../utils/redis-pool': {},
        '../utils/logger': { logStructured: (...args) => logCalls.push(args) },
        '../utils/prometheus-metrics': {
            metrics: {
                setActiveWorkers() {},
                setEventBacklog: (...args) => backlogCalls.push(args)
            }
        }
    };
    const workerModule = { exports: {} };
    runInNewContext(workerSource, {
        module: workerModule,
        require(name) {
            assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
            return mocks[name];
        }
    }, { filename: workerPath });
    const monitor = new workerModule.exports();
    monitor.redis = {
        async xinfo(command) {
            switch (command) {
                case 'GROUPS':
                    return missingGroup ? [] : [[
                        'name', 'listener-workers', 'last-delivered-id', deliveredId
                    ]];
                case 'STREAM':
                    if (readError) throw new Error('Synthetic Redis read failure');
                    return streamInfo;
                case 'CONSUMERS':
                    return [['name', 'test-worker', 'pending', 0, 'idle', 0]];
                default:
                    assert.fail(`Unexpected XINFO command: ${command}`);
            }
        },
        async xlen() { return 0; },
        async xpending() { return []; }
    };
    return { monitor, backlogCalls, logCalls };
}

test('reads the ID from the Redis last-entry tuple', async () => {
    const { monitor, logCalls } = createMonitor({
        streamInfo: ['length', 2, 'last-entry', ['2500-4', ['type', 'synthetic']]]
    });
    const result = await monitor.getStreamLag();
    assert.equal(result.lag, 1500);
    assert.equal(result.lastDeliveredId, '1000-0');
    assert.equal(result.lastEntryId, '2500-4');
    assert.equal(logCalls.length, 0);
});

test('prefers last-generated-id even when the last retained entry is older', async () => {
    const { monitor } = createMonitor({
        streamInfo: ['last-entry', ['500-0', []], 'last-generated-id', '2500-4']
    });
    const result = await monitor.getStreamLag();
    assert.equal(result.lag, 1500);
    assert.equal(result.lastEntryId, '2500-4');
});

test('uses last-generated-id when last-entry is null', async () => {
    const { monitor } = createMonitor({
        streamInfo: ['last-entry', null, 'last-generated-id', '2500-4']
    });
    assert.equal((await monitor.getStreamLag()).lag, 1500);
});

test('falls back to a valid tuple when last-generated-id is invalid', async () => {
    const { monitor } = createMonitor({
        streamInfo: ['last-generated-id', 'invalid', 'last-entry', ['2500-4', []]]
    });
    assert.equal((await monitor.getStreamLag()).lag, 1500);
});

const unknownCases = [
    ['missing stream fields', { streamInfo: [] }],
    ['null last-entry', { streamInfo: ['last-entry', null] }],
    ['empty tuple', { streamInfo: ['last-entry', []] }],
    ['non-string tuple ID', { streamInfo: ['last-entry', [2500, []]] }],
    ['malformed ID', { streamInfo: ['last-entry', ['2500-invalid', []]] }],
    ['unsafe timestamp', { streamInfo: ['last-generated-id', '9007199254740992-0'] }],
    ['negative timestamp lag from last-generated-id', {
        streamInfo: ['last-generated-id', '1000-0'], deliveredId: '2500-0'
    }],
    ['negative timestamp lag from last-entry tuple', {
        streamInfo: ['last-entry', ['1000-0', []]], deliveredId: '2500-0'
    }],
    ['invalid stream response', { streamInfo: null }],
    ['missing delivered ID', { streamInfo: ['last-generated-id', '2500-0'], deliveredId: null }],
    ['invalid delivered ID', { streamInfo: ['last-generated-id', '2500-0'], deliveredId: '1000junk-0' }],
    ['missing group', { streamInfo: ['last-generated-id', '2500-0'], missingGroup: true }],
    ['Redis read failure', { readError: true }]
];

for (const [name, options] of unknownCases) {
    test(`keeps lag unknown for ${name}`, async () => {
        const { monitor, backlogCalls } = createMonitor(options);
        assert.equal(await monitor.getStreamLag(), null);
        const health = await monitor.getHealth();
        assert.equal(health.lag, null);
        assert.equal(health.status, 'degraded');
        assert.equal(health.reason, 'Lag indisponível');
        assert.equal(backlogCalls.some(([, kind]) => kind === 'pending'), false);
    });
}

test('keeps a real zero healthy and publishes zero to the pending gauge', async () => {
    const { monitor, backlogCalls } = createMonitor({
        streamInfo: ['last-entry', null, 'last-generated-id', '0-0'], deliveredId: '0-0'
    });
    const health = await monitor.getHealth();
    assert.equal(health.status, 'healthy');
    assert.equal(health.lag, 0);
    assert.ok(backlogCalls.some(([value, kind]) => kind === 'pending' && value === 0));
});

test('retains the high-lag health check and publishes the measured value', async () => {
    const { monitor, backlogCalls } = createMonitor({
        streamInfo: ['last-entry', ['2500-4', []]]
    });
    const health = await monitor.getHealth();
    assert.equal(health.status, 'degraded');
    assert.equal(health.lag, 1500);
    assert.ok(backlogCalls.some(([value, kind]) => kind === 'pending' && value === 1500));
});

test('keeps equal nonempty stream IDs healthy with a real zero', async () => {
    const { monitor, backlogCalls } = createMonitor({
        streamInfo: ['last-generated-id', '2500-0'], deliveredId: '2500-0'
    });
    const health = await monitor.getHealth();
    assert.equal(health.status, 'healthy');
    assert.equal(health.lag, 0);
    assert.ok(backlogCalls.some(([value, kind]) => kind === 'pending' && value === 0));
});

test('keeps no active consumers unhealthy even when lag is unknown', async () => {
    const { monitor } = createMonitor({ streamInfo: [] });
    monitor.getConsumers = async () => [];
    const health = await monitor.getHealth();
    assert.equal(health.status, 'unhealthy');
    assert.equal(health.reason, 'Nenhum consumer ativo');
    assert.equal(health.lag, null);
});

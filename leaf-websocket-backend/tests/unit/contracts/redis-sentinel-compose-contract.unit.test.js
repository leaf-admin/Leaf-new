const fs = require('fs');
const path = require('path');

const SENTINEL_ENVIRONMENT = [
  '- REDIS_MODE=${REDIS_MODE:-standalone}',
  '- REDIS_SENTINELS=${REDIS_SENTINELS:-}',
  '- REDIS_SENTINEL_MASTER_NAME=${REDIS_SENTINEL_MASTER_NAME:-leaf-master}',
  '- REDIS_SENTINEL_USERNAME=${REDIS_SENTINEL_USERNAME:-}',
  '- REDIS_SENTINEL_PASSWORD=${REDIS_SENTINEL_PASSWORD:-}',
  '- REDIS_USERNAME=${REDIS_USERNAME:-}',
  '- REDIS_USE_TLS=${REDIS_USE_TLS:-false}',
  '- REDIS_TLS_REJECT_UNAUTHORIZED=${REDIS_TLS_REJECT_UNAUTHORIZED:-true}',
  '- REDIS_SENTINEL_USE_TLS=${REDIS_SENTINEL_USE_TLS:-false}',
  '- REDIS_SENTINEL_TLS_REJECT_UNAUTHORIZED=${REDIS_SENTINEL_TLS_REJECT_UNAUTHORIZED:-true}'
];

function readCompose(name) {
  return fs.readFileSync(path.resolve(__dirname, `../../../${name}`), 'utf8');
}

function serviceBlock(source, serviceName) {
  const marker = `  ${serviceName}:`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Serviço ausente no compose: ${serviceName}`);
  const remainder = source.slice(start + marker.length);
  const nextServiceOffset = remainder.search(/\n  [a-zA-Z0-9][a-zA-Z0-9_-]*:/);
  return nextServiceOffset < 0
    ? source.slice(start)
    : source.slice(start, start + marker.length + nextServiceOffset);
}

function expectSentinelEnvironment(source) {
  for (const setting of SENTINEL_ENVIRONMENT) {
    expect(source).toContain(setting);
  }
  expect(source).toContain('- REDIS_PASSWORD=');
  expect(source).toContain('- REDIS_DB=');
  expect(source).toContain('- REDIS_URL=');
  expect(source).not.toContain('- REDIS_MODE=${REDIS_MODE:-sentinel}');
}

describe('Redis Sentinel production compose contract', () => {
  const production = readCompose('docker-compose.production.yml');
  const gatewayScale = readCompose('docker-compose.gateway-scale.yml');
  const opsWorkers = readCompose('docker-compose.ops-workers.yml');
  const realtimeSecondary = readCompose('docker-compose.realtime-secondary.yml');

  test.each(['websocket', 'sideeffects-worker', 'billing-worker'])(
    'propagates Sentinel discovery to production service %s',
    serviceName => {
      expectSentinelEnvironment(serviceBlock(production, serviceName));
    }
  );

  test('propagates Sentinel discovery through the scaled gateway template', () => {
    const templateEnd = gatewayScale.indexOf('\nservices:');
    expect(templateEnd).toBeGreaterThan(0);
    expectSentinelEnvironment(gatewayScale.slice(0, templateEnd));
  });

  test.each(['websocket', 'queue-worker'])(
    'propagates Sentinel discovery to scaled runtime service %s',
    serviceName => {
      expectSentinelEnvironment(serviceBlock(gatewayScale, serviceName));
    }
  );

  test('gives the dedicated queue worker an explicit renewable leader lease contract', () => {
    const queueWorker = serviceBlock(gatewayScale, 'queue-worker');
    expect(queueWorker).toContain(
      '- QUEUE_WORKER_LEADER_KEY=${QUEUE_WORKER_LEADER_KEY:-leaf:runtime:queue-worker:leader}'
    );
    expect(queueWorker).toContain(
      '- QUEUE_WORKER_LEADER_TTL_MS=${QUEUE_WORKER_LEADER_TTL_MS:-15000}'
    );
    expect(queueWorker).toContain(
      '- QUEUE_WORKER_LEADER_RENEW_INTERVAL_MS=${QUEUE_WORKER_LEADER_RENEW_INTERVAL_MS:-5000}'
    );
    expect(queueWorker).toContain('- LEAF_WORKER_INSTANCE_ID=${LEAF_WORKER_INSTANCE_ID:-}');
  });

  test.each(['trip-location-worker', 'pricing-baseline-worker', 'ride-health-monitor-worker'])(
    'preserves Sentinel discovery in operational worker %s',
    serviceName => {
      expectSentinelEnvironment(serviceBlock(opsWorkers, serviceName));
    }
  );

  test.each([
    [
      'pricing-baseline-worker',
      'PRICING_BASELINE_WORKER_LEADER_KEY',
      'leaf:runtime:pricing-baseline-worker:leader',
      'PRICING_BASELINE_WORKER_LEADER_TTL_MS',
      '60000',
      'PRICING_BASELINE_WORKER_LEADER_RENEW_INTERVAL_MS',
      '20000'
    ],
    [
      'ride-health-monitor-worker',
      'RIDE_HEALTH_MONITOR_WORKER_LEADER_KEY',
      'leaf:runtime:ride-health-monitor-worker:leader',
      'RIDE_HEALTH_MONITOR_WORKER_LEADER_TTL_MS',
      '30000',
      'RIDE_HEALTH_MONITOR_WORKER_LEADER_RENEW_INTERVAL_MS',
      '10000'
    ]
  ])(
    'gives periodic worker %s an explicit per-cycle leader lease',
    (serviceName, keyName, keyValue, ttlName, ttlValue, renewName, renewValue) => {
      const worker = serviceBlock(opsWorkers, serviceName);
      expect(worker).toContain(`- ${keyName}=\${${keyName}:-${keyValue}}`);
      expect(worker).toContain(`- ${ttlName}=\${${ttlName}:-${ttlValue}}`);
      expect(worker).toContain(`- ${renewName}=\${${renewName}:-${renewValue}}`);
      expect(worker).toContain('- LEAF_WORKER_INSTANCE_ID=${LEAF_WORKER_INSTANCE_ID:-}');
    }
  );

  test('propagates Sentinel discovery to the separately deployed realtime gateway', () => {
    expectSentinelEnvironment(
      serviceBlock(realtimeSecondary, 'websocket-secondary')
    );
  });
});

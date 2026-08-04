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

  test.each(['trip-location-worker', 'pricing-baseline-worker', 'ride-health-monitor-worker'])(
    'preserves Sentinel discovery in operational worker %s',
    serviceName => {
      expectSentinelEnvironment(serviceBlock(opsWorkers, serviceName));
    }
  );

  test('propagates Sentinel discovery to the separately deployed realtime gateway', () => {
    expectSentinelEnvironment(
      serviceBlock(realtimeSecondary, 'websocket-secondary')
    );
  });
});

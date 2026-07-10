#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const compose = fs.readFileSync(path.join(root, 'docker-compose.observability.yml'), 'utf8');
const alertmanager = fs.readFileSync(
  path.join(root, 'observability', 'alertmanager', 'alertmanager.yml'),
  'utf8'
);
const prometheus = fs.readFileSync(
  path.join(root, 'observability', 'prometheus', 'prometheus.yml'),
  'utf8'
);
const alertRules = fs.readFileSync(
  path.join(root, 'observability', 'prometheus', 'alert-rules.yml'),
  'utf8'
);

const failures = [];
const requireMatch = (value, pattern, message) => {
  if (!pattern.test(value)) failures.push(message);
};
const rejectMatch = (value, pattern, message) => {
  if (pattern.test(value)) failures.push(message);
};

rejectMatch(compose, /image:\s*[^\n]+:latest\b/, 'observability images must be pinned');
requireMatch(compose, /GF_AUTH_ANONYMOUS_ENABLED=false/, 'Grafana anonymous access must be disabled');
rejectMatch(compose, /GF_SECURITY_ADMIN_PASSWORD=admin\b/, 'Grafana default password is forbidden');
requireMatch(compose, /GF_SECURITY_ADMIN_PASSWORD=\$\{GRAFANA_ADMIN_PASSWORD:\?/, 'Grafana password must be required');

for (const port of ['3002:3000', '9090:9090', '9093:9093', '3200:3200', '4317:4317', '4318:4318']) {
  requireMatch(compose, new RegExp(`127\\.0\\.0\\.1:${port.replace(':', '\\:')}`), `${port} must bind to loopback`);
}

requireMatch(alertmanager, /receiver:\s*external-critical-channel/, 'critical alerts need an external receiver');
requireMatch(alertmanager, /api_url_file:\s*\/run\/secrets\//, 'external alert secret must come from a mounted file');
requireMatch(alertmanager, /continue:\s*true/, 'critical alerts must continue to the secondary receiver');
requireMatch(prometheus, /environment:\s*'production'/, 'Prometheus external labels must identify production');
for (const alertName of [
  'ServiceDown',
  'NoActiveWorkers',
  'RideHealthStuckDetected',
  'PixCreationFailureSpike',
  'FcmFailureSpike',
  'GeofenceConfigurationUnavailable'
]) {
  requireMatch(alertRules, new RegExp(`alert:\\s*${alertName}\\b`), `missing mandatory alert ${alertName}`);
}

if (failures.length > 0) {
  failures.forEach((failure) => process.stderr.write(`[observability-config] ${failure}\n`));
  process.exit(1);
}

process.stdout.write('[observability-config] production invariants passed\n');

const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, `../../../${relativePath}`), 'utf8');
}

function serviceBlock(source, serviceName) {
  const marker = `  ${serviceName}:`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing service: ${serviceName}`);
  const remainder = source.slice(start + marker.length);
  const nextServiceOffset = remainder.search(/\n  [a-zA-Z0-9][a-zA-Z0-9_-]*:/);
  return nextServiceOffset < 0
    ? source.slice(start)
    : source.slice(start, start + marker.length + nextServiceOffset);
}

describe('secondary contingency compose contract', () => {
  const compose = read('docker-compose.contingency-secondary.yml');
  const tunnelDockerfile = read('Dockerfile.contingency-tunnel');
  const redisEntrypoint = read('scripts/ops/start-secondary-redis-replica.sh');
  const nginx = read('config/secondary-contingency/nginx.conf');
  const preflight = read('scripts/ops/preflight-secondary-contingency.sh');
  const sysctl = read('config/secondary-contingency/90-leaf-redis-contingency.conf');

  test('keeps every contingency endpoint off public host interfaces', () => {
    expect(compose).toContain('"127.0.0.1:18080:8080"');
    expect(compose).not.toMatch(/- "0\.0\.0\.0:\d+:\d+"/);
    expect(compose).not.toContain('network_mode: host');
  });

  test('pins host identity and uses a dedicated read-only SSH key', () => {
    expect(tunnelDockerfile).toContain('openssh-client');
    expect(compose).toContain('StrictHostKeyChecking=yes');
    expect(compose).toContain('UserKnownHostsFile=/run/leaf/known_hosts');
    expect(compose).toContain('./secrets/primary_ssh_key:/run/leaf/primary_ssh_key:ro');
    expect(compose).toContain('./secrets/primary_known_hosts:/run/leaf/known_hosts:ro');
    expect(compose).toContain('0.0.0.0:6381:127.0.0.1:6379');
    expect(compose).toContain('0.0.0.0:3001:127.0.0.1:3001');
    expect(compose).not.toContain('StrictHostKeyChecking=no');
  });

  test('keeps the Redis secret out of compose environment and process arguments', () => {
    expect(compose).toContain('./secrets/redis_password:/run/leaf/redis_password:ro');
    expect(compose).not.toContain('REDIS_PASSWORD=');
    expect(compose).not.toContain('REDIS_URL=');
    expect(redisEntrypoint).toContain('masterauth "$escaped_password"');
    expect(redisEntrypoint).toContain('requirepass "$escaped_password"');
    expect(redisEntrypoint).toContain('replica-read-only yes');
    expect(redisEntrypoint).toContain('maxmemory-policy noeviction');
    expect(redisEntrypoint).toContain(
      '/usr/bin/setpriv --reuid redis --regid redis --clear-groups redis-server',
    );
    expect(redisEntrypoint).toContain(
      'chown redis:redis "$CONFIG_FILE" /run/leaf-runtime /data',
    );
    expect(redisEntrypoint).not.toContain('su-exec');
  });

  test('does not start an application gateway or operational worker', () => {
    for (const forbidden of [
      'websocket-secondary:',
      'sideeffects-worker:',
      'billing-worker:',
      'queue-worker:',
      'env_file:',
      'firebase-credentials.json',
    ]) {
      expect(compose).not.toContain(forbidden);
    }
  });

  test('enforces the cheap-host resource and hardening budget', () => {
    const tunnel = serviceBlock(compose, 'redis-primary-tunnel');
    const replica = serviceBlock(compose, 'redis-replica');

    expect(compose.match(/mem_limit:/g)).toHaveLength(3);
    expect(compose.match(/cpus:/g)).toHaveLength(3);
    expect(compose.match(/pids_limit:/g)).toHaveLength(3);
    expect(compose.match(/no-new-privileges:true/g)).toHaveLength(3);
    expect(compose).toContain('mem_limit: 768m');
    expect(compose).toContain('cpus: "0.50"');
    for (const capability of ['CHOWN', 'SETGID', 'SETUID']) {
      expect(replica).toContain(`- ${capability}`);
      expect(tunnel).not.toContain(`- ${capability}`);
    }
  });

  test('validates both the alternate edge path and live replication', () => {
    expect(nginx).toContain('server redis-primary-tunnel:3001');
    expect(nginx).toContain('proxy_set_header Upgrade $http_upgrade');
    expect(preflight).toContain('http://127.0.0.1:18080/health/liveness');
    expect(preflight).toContain("grep -q '^role:slave'");
    expect(preflight).toContain("grep -q '^master_link_status:up'");
    expect(preflight).toContain("grep -q '^master_sync_in_progress:0'");
    expect(preflight).toContain('/proc/sys/vm/overcommit_memory');
    expect(sysctl.trim()).toBe('vm.overcommit_memory=1');
  });
});

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Redis = require('ioredis');

const MASTER_NAME = 'leaf-master';
const REDIS_PASSWORD = 'leaf-local-failover-redis';
const SENTINEL_PASSWORD = 'leaf-local-failover-sentinel';
const PROCESS_TIMEOUT_MS = 20_000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitFor(predicate, description, timeoutMs = PROCESS_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  const suffix = lastError ? `: ${lastError.message}` : '';
  throw new Error(`Timeout aguardando ${description}${suffix}`);
}

function writeConfig(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, { mode: 0o600 });
}

function spawnRedis(configPath) {
  const child = spawn('redis-server', [configPath], {
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.getStderr = () => stderr;
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(3000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    })
  ]);
}

function directRedis(port, password = REDIS_PASSWORD) {
  return new Redis({
    host: '127.0.0.1',
    port,
    password,
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
}

async function pingPort(port, password = REDIS_PASSWORD) {
  const client = directRedis(port, password);
  client.on('error', () => {});
  try {
    await client.connect();
    return await client.ping() === 'PONG';
  } finally {
    client.disconnect(false);
  }
}

async function sentinelMasterPort(sentinelPort) {
  const sentinel = directRedis(sentinelPort, SENTINEL_PASSWORD);
  sentinel.on('error', () => {});
  try {
    await sentinel.connect();
    const address = await sentinel.call('SENTINEL', 'get-master-addr-by-name', MASTER_NAME);
    return Array.isArray(address) ? Number.parseInt(address[1], 10) : null;
  } finally {
    sentinel.disconnect(false);
  }
}

async function main() {
  const redisBinary = process.env.REDIS_SERVER_BIN || 'redis-server';
  if (redisBinary !== 'redis-server') process.env.PATH = `${path.dirname(redisBinary)}:${process.env.PATH}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-redis-sentinel-'));
  const processes = [];
  const clients = [];
  const startedAt = Date.now();

  try {
    const redisPorts = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
    const sentinelPorts = await Promise.all([getFreePort(), getFreePort(), getFreePort()]);
    const [initialMasterPort] = redisPorts;

    for (const [index, port] of redisPorts.entries()) {
      const nodeDir = path.join(root, `redis-${index + 1}`);
      fs.mkdirSync(nodeDir);
      const configPath = path.join(nodeDir, 'redis.conf');
      writeConfig(configPath, [
        `port ${port}`,
        'bind 127.0.0.1',
        'protected-mode no',
        `dir ${nodeDir}`,
        `pidfile ${path.join(nodeDir, 'redis.pid')}`,
        `logfile ${path.join(nodeDir, 'redis.log')}`,
        `requirepass ${REDIS_PASSWORD}`,
        `masterauth ${REDIS_PASSWORD}`,
        'appendonly yes',
        'appendfsync always',
        'save ""',
        'min-replicas-to-write 1',
        'min-replicas-max-lag 5',
        ...(index === 0 ? [] : [`replicaof 127.0.0.1 ${initialMasterPort}`])
      ]);
      const child = spawnRedis(configPath);
      processes.push(child);
      if (child.pid == null) throw new Error(`Falha ao iniciar Redis ${index + 1}: ${child.getStderr()}`);
    }

    await Promise.all(redisPorts.map(port => waitFor(
      () => pingPort(port),
      `Redis na porta ${port}`
    )));

    const initialMaster = directRedis(initialMasterPort);
    clients.push(initialMaster);
    initialMaster.on('error', () => {});
    await initialMaster.connect();
    await waitFor(async () => {
      const info = await initialMaster.info('replication');
      if (!/connected_slaves:2\b/.test(info)) return false;
      try {
        await initialMaster.set('leaf:ha:replication-ready', '1');
        return true;
      } catch (error) {
        if (error?.message?.includes('NOREPLICAS')) return false;
        throw error;
      }
    }, 'duas réplicas sincronizadas e aptas a confirmar escrita');

    for (const [index, port] of sentinelPorts.entries()) {
      const sentinelDir = path.join(root, `sentinel-${index + 1}`);
      fs.mkdirSync(sentinelDir);
      const configPath = path.join(sentinelDir, 'sentinel.conf');
      writeConfig(configPath, [
        `port ${port}`,
        'bind 127.0.0.1',
        'protected-mode no',
        `dir ${sentinelDir}`,
        `pidfile ${path.join(sentinelDir, 'sentinel.pid')}`,
        `logfile ${path.join(sentinelDir, 'sentinel.log')}`,
        `requirepass ${SENTINEL_PASSWORD}`,
        `sentinel monitor ${MASTER_NAME} 127.0.0.1 ${initialMasterPort} 2`,
        `sentinel auth-pass ${MASTER_NAME} ${REDIS_PASSWORD}`,
        `sentinel down-after-milliseconds ${MASTER_NAME} 1000`,
        `sentinel failover-timeout ${MASTER_NAME} 10000`,
        `sentinel parallel-syncs ${MASTER_NAME} 1`
      ]);
      const child = spawn('redis-server', [configPath, '--sentinel'], {
        stdio: ['ignore', 'ignore', 'pipe']
      });
      processes.push(child);
      if (child.pid == null) throw new Error(`Falha ao iniciar Sentinel ${index + 1}`);
    }

    await Promise.all(sentinelPorts.map(port => waitFor(
      () => pingPort(port, SENTINEL_PASSWORD),
      `Sentinel na porta ${port}`
    )));
    await waitFor(
      () => sentinelMasterPort(sentinelPorts[0]).then(port => port === initialMasterPort),
      'Sentinels reconhecerem o primário inicial'
    );

    const sentinelClient = new Redis({
      sentinels: sentinelPorts.map(port => ({ host: '127.0.0.1', port })),
      name: MASTER_NAME,
      role: 'master',
      password: REDIS_PASSWORD,
      sentinelPassword: SENTINEL_PASSWORD,
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 20,
      retryStrategy: times => Math.min(times * 50, 500),
      sentinelRetryStrategy: times => Math.min(times * 50, 500)
    });
    clients.push(sentinelClient);
    sentinelClient.on('error', () => {});
    await sentinelClient.connect();
    await sentinelClient.set('leaf:ha:proof', 'before-failover');
    const replicated = await sentinelClient.wait(1, 5000);
    if (Number(replicated) < 1) throw new Error('Escrita de prova não foi confirmada por uma réplica');

    await stopChild(processes[0]);
    const promotedPort = await waitFor(async () => {
      const port = await sentinelMasterPort(sentinelPorts[0]);
      return port && port !== initialMasterPort ? port : null;
    }, 'promoção automática de uma réplica');

    await waitFor(async () => {
      try {
        await sentinelClient.set('leaf:ha:after', 'after-failover');
        return await sentinelClient.get('leaf:ha:proof') === 'before-failover';
      } catch (_error) {
        return false;
      }
    }, 'cliente ioredis reencontrar o novo primário');

    const proof = {
      status: 'passed',
      redisNodes: redisPorts.length,
      sentinelNodes: sentinelPorts.length,
      quorum: 2,
      initialMasterPort,
      promotedMasterPort: promotedPort,
      acknowledgedValuePreserved: true,
      postFailoverWriteSucceeded: await sentinelClient.get('leaf:ha:after') === 'after-failover',
      durationMs: Date.now() - startedAt
    };
    process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  } finally {
    for (const client of clients) {
      try { client.disconnect(false); } catch (_error) { /* cleanup */ }
    }
    await Promise.all(processes.map(stopChild));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

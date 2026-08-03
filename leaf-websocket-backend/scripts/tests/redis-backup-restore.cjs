#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Redis = require('ioredis');

const PASSWORD = 'leaf-local-backup-test';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} falhou: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function runExpectFailure(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status === 0) throw new Error(`${command} deveria ter falhado`);
  return String(result.stderr || result.stdout || '');
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-redis-backup-test-'));
  const port = await freePort();
  const backupPath = path.join(tempDir, 'redis-proof.rdb.gz');
  const emptyBackupPath = path.join(tempDir, 'redis-empty.rdb.gz');
  const sourceDir = path.join(tempDir, 'source');
  fs.mkdirSync(sourceDir);
  let child = null;
  let client = null;

  try {
    child = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', [
      '--bind', '127.0.0.1', '--port', String(port), '--protected-mode', 'no',
      '--dir', sourceDir, '--appendonly', 'no', '--save', '', '--requirepass', PASSWORD,
      '--logfile', path.join(sourceDir, 'redis.log')
    ], { stdio: 'ignore' });
    client = new Redis({ host: '127.0.0.1', port, password: PASSWORD, lazyConnect: true, retryStrategy: () => null });
    client.on('error', () => {});
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        if (client.status === 'wait' || client.status === 'end') await client.connect();
        if (await client.ping() === 'PONG') break;
      } catch (_error) {
        await delay(100);
      }
    }
    if (client.status !== 'ready') throw new Error('Redis fonte não iniciou');
    await client.set('leaf:backup:proof', 'restored-value');
    await client.hset('leaf:backup:hash', { status: 'ready', version: '1' });

    const env = {
      ...process.env,
      NODE_ENV: 'test',
      REDIS_MODE: 'standalone',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: String(port),
      REDIS_PASSWORD: PASSWORD,
      REDIS_DB: '0'
    };
    const backup = run(process.execPath, ['scripts/ops/backup-redis.cjs', '--out', backupPath], { cwd: path.resolve(__dirname, '../..'), env });
    const restore = run(process.execPath, [
      'scripts/ops/verify-redis-restore.cjs', '--backup', backupPath,
      '--expect-key', 'leaf:backup:proof', '--expect-value', 'restored-value',
      '--require-nonempty'
    ], { cwd: path.resolve(__dirname, '../..'), env });

    await client.flushall();
    run(process.execPath, ['scripts/ops/backup-redis.cjs', '--out', emptyBackupPath], {
      cwd: path.resolve(__dirname, '../..'),
      env
    });
    const emptyBackupError = runExpectFailure(process.execPath, [
      'scripts/ops/verify-redis-restore.cjs', '--backup', emptyBackupPath,
      '--require-nonempty'
    ], { cwd: path.resolve(__dirname, '../..'), env });
    if (!emptyBackupError.includes('Backup Redis restaurou keyspace vazio')) {
      throw new Error(`Falha inesperada ao validar keyspace vazio: ${emptyBackupError}`);
    }

    const originalBackup = fs.readFileSync(backupPath);
    const corruptedBackup = Buffer.from(originalBackup);
    corruptedBackup[corruptedBackup.length - 1] ^= 0xff;
    fs.writeFileSync(backupPath, corruptedBackup);
    const corruptionError = runExpectFailure(process.execPath, [
      'scripts/ops/verify-redis-restore.cjs', '--backup', backupPath
    ], { cwd: path.resolve(__dirname, '../..'), env });
    if (!corruptionError.includes('Checksum do backup não confere')) {
      throw new Error(`Falha inesperada ao validar corrupção: ${corruptionError}`);
    }

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      backupCreated: backup.status === 'passed',
      checksumVerified: restore.checksumVerified,
      rdbVerified: restore.rdbVerified,
      isolatedRestoreStarted: restore.isolatedRestoreStarted,
      expectedKeyVerified: restore.expectedKeyVerified,
      nonemptyRequired: restore.nonemptyRequired,
      totalKeys: restore.totalKeys,
      emptyBackupRejected: true,
      corruptedBackupRejected: true
    }, null, 2)}\n`);
  } finally {
    try { client?.disconnect(false); } catch (_error) { /* cleanup */ }
    await stop(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

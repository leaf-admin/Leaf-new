#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');
const Redis = require('ioredis');

process.umask(0o077);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} falhou: ${String(result.stderr || '').trim()}`);
  return String(result.stdout || '').trim();
}

function parseKeyspaceInfo(info) {
  const databases = String(info || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^db\d+:/.test(line))
    .map(line => {
      const match = line.match(/^(db\d+):keys=(\d+)(?:,|$)/);
      if (!match) throw new Error(`Linha INFO keyspace inválida: ${line}`);
      return {
        database: match[1],
        keys: Number.parseInt(match[2], 10),
        raw: line
      };
    });
  return {
    databases,
    totalKeys: databases.reduce((sum, entry) => sum + entry.keys, 0)
  };
}

function assertRestoredContent(keyspaceSummary, { requireNonempty = false } = {}) {
  if (requireNonempty && keyspaceSummary.totalKeys < 1) {
    throw new Error('Backup Redis restaurou keyspace vazio');
  }
  return keyspaceSummary;
}

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

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    delay(3000).then(() => child.kill('SIGKILL'))
  ]);
}

async function main() {
  const backupPath = path.resolve(argument('--backup'));
  if (!argument('--backup')) throw new Error('Parâmetro --backup obrigatório');
  if (!fs.existsSync(backupPath)) throw new Error(`Backup não encontrado: ${backupPath}`);

  const manifestPath = `${backupPath}.manifest.json`;
  const checksumPath = `${backupPath}.sha256`;
  if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) {
    throw new Error('Manifesto e checksum são obrigatórios para o restore drill');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const backupSize = fs.statSync(backupPath).size;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.file !== path.basename(backupPath) ||
    manifest.bytes !== backupSize
  ) {
    throw new Error('Manifesto não corresponde ao arquivo de backup');
  }
  const expectedChecksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const actualChecksum = await sha256(backupPath);
  if (manifest.sha256 !== actualChecksum || expectedChecksum !== actualChecksum) {
    throw new Error('Checksum do backup não confere com o manifesto');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-redis-restore-'));
  const rdbPath = path.join(tempDir, 'dump.rdb');
  const port = await freePort();
  let child = null;
  let client = null;

  try {
    if (manifest.compression === 'gzip' || backupPath.endsWith('.gz')) {
      await pipeline(fs.createReadStream(backupPath), zlib.createGunzip(), fs.createWriteStream(rdbPath, { mode: 0o600 }));
    } else {
      fs.copyFileSync(backupPath, rdbPath);
      fs.chmodSync(rdbPath, 0o600);
    }
    run(process.env.REDIS_CHECK_RDB_BIN || 'redis-check-rdb', [rdbPath]);

    child = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', [
      '--bind', '127.0.0.1',
      '--port', String(port),
      '--protected-mode', 'no',
      '--dir', tempDir,
      '--dbfilename', 'dump.rdb',
      '--appendonly', 'no',
      '--save', '',
      '--logfile', path.join(tempDir, 'redis.log')
    ], { stdio: 'ignore' });
    if (!child.pid) throw new Error('Não foi possível iniciar Redis isolado');

    client = new Redis({
      host: '127.0.0.1',
      port,
      lazyConnect: true,
      connectTimeout: 500,
      commandTimeout: 1000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    });
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
    if (client.status !== 'ready') throw new Error('Redis isolado não carregou o backup');

    const expectKey = argument('--expect-key');
    const expectValue = argument('--expect-value');
    if (expectKey) {
      const restoredValue = await client.get(expectKey);
      if (restoredValue === null) throw new Error(`Chave esperada ausente após restore: ${expectKey}`);
      if (expectValue && restoredValue !== expectValue) {
        throw new Error(`Valor restaurado diverge para ${expectKey}`);
      }
    }
    const keyspace = await client.info('keyspace');
    const requireNonempty = process.argv.includes('--require-nonempty');
    const keyspaceSummary = assertRestoredContent(parseKeyspaceInfo(keyspace), {
      requireNonempty
    });
    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      backupPath,
      checksumVerified: true,
      rdbVerified: true,
      isolatedRestoreStarted: true,
      expectedKeyVerified: Boolean(expectKey),
      nonemptyRequired: requireNonempty,
      totalKeys: keyspaceSummary.totalKeys,
      keyspace: keyspaceSummary.databases.map(entry => entry.raw)
    }, null, 2)}\n`);
  } finally {
    try { client?.disconnect(false); } catch (_error) { /* cleanup */ }
    await stop(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertRestoredContent,
  parseKeyspaceInfo
};

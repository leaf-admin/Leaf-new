#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');
const DockerDetector = require('../../utils/docker-detector');

process.umask(0o077);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${command} falhou${message ? `: ${message}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function tlsArgs(prefix, enabled) {
  if (!enabled) return [];
  const args = ['--tls'];
  const caPath = process.env[`${prefix}_TLS_CA_CERT_PATH`];
  if (caPath) args.push('--cacert', caPath);
  if (String(process.env[`${prefix}_TLS_REJECT_UNAUTHORIZED`] || 'true').toLowerCase() === 'false') {
    args.push('--insecure');
  }
  return args;
}

function connectionArgs({ host, port, username, tls, tlsPrefix = 'REDIS' }) {
  const args = ['--no-auth-warning', '--raw', '-h', host, '-p', String(port)];
  if (username) args.push('--user', username);
  args.push(...tlsArgs(tlsPrefix, Boolean(tls)));
  return args;
}

function commandEnv(password) {
  const env = { ...process.env };
  if (password) env.REDISCLI_AUTH = password;
  else delete env.REDISCLI_AUTH;
  return env;
}

function resolveRedisBackupTarget(config, execute = run) {
  if (!Array.isArray(config.sentinels)) {
    return {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      tls: config.tls,
      mode: 'standalone'
    };
  }

  let lastError = null;
  for (const sentinel of config.sentinels) {
    try {
      const output = execute(
        process.env.REDIS_CLI_BIN || 'redis-cli',
        [
          ...connectionArgs({
            ...sentinel,
            username: config.sentinelUsername,
            tls: config.sentinelTLS,
            tlsPrefix: 'REDIS_SENTINEL'
          }),
          'SENTINEL', 'get-master-addr-by-name', config.name
        ],
        { env: commandEnv(config.sentinelPassword) }
      );
      const [host, portRaw] = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      const port = Number.parseInt(portRaw, 10);
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Sentinel não retornou um mestre válido');
      }
      return {
        host,
        port,
        username: config.username,
        password: config.password,
        tls: config.tls,
        mode: 'sentinel',
        masterName: config.name,
        sentinelCount: config.sentinels.length
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Nenhum Sentinel resolveu o mestre ${config.name}: ${lastError?.message || 'sem resposta'}`);
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function main() {
  const outputPath = path.resolve(argument('--out'));
  if (!argument('--out')) throw new Error('Parâmetro --out obrigatório');
  if (!/\.rdb(?:\.gz)?$/i.test(outputPath)) throw new Error('Destino deve terminar em .rdb ou .rdb.gz');
  if (fs.existsSync(outputPath)) throw new Error(`Destino já existe: ${outputPath}`);

  const config = DockerDetector.getRedisConfig();
  if (!config.password && process.env.REDIS_BACKUP_ALLOW_UNAUTHENTICATED !== 'true') {
    throw new Error('Backup Redis sem autenticação exige REDIS_BACKUP_ALLOW_UNAUTHENTICATED=true');
  }
  const target = resolveRedisBackupTarget(config);
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);
  const tempDir = fs.mkdtempSync(path.join(outputDir, '.redis-backup-'));
  const tempRdb = path.join(tempDir, 'snapshot.rdb');

  try {
    run(
      process.env.REDIS_CLI_BIN || 'redis-cli',
      [
        ...connectionArgs(target),
        '--rdb', tempRdb
      ],
      { env: commandEnv(target.password) }
    );
    const validation = run(process.env.REDIS_CHECK_RDB_BIN || 'redis-check-rdb', [tempRdb]);

    if (outputPath.endsWith('.gz')) {
      await pipeline(
        fs.createReadStream(tempRdb),
        zlib.createGzip({ level: 9 }),
        fs.createWriteStream(outputPath, { mode: 0o600, flags: 'wx' })
      );
    } else {
      fs.renameSync(tempRdb, outputPath);
    }
    fs.chmodSync(outputPath, 0o600);

    syncFile(outputPath);
    const digest = await sha256(outputPath);
    const checksumPath = `${outputPath}.sha256`;
    const manifestPath = `${outputPath}.manifest.json`;
    fs.writeFileSync(checksumPath, `${digest}  ${path.basename(outputPath)}\n`, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      file: path.basename(outputPath),
      bytes: fs.statSync(outputPath).size,
      sha256: digest,
      compression: outputPath.endsWith('.gz') ? 'gzip' : 'none',
      redis: {
        mode: target.mode,
        masterName: target.masterName || null,
        sentinelCount: target.sentinelCount || 0,
        dbScope: 'all'
      },
      validation: validation.split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'redis-check-rdb passed'
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    syncFile(checksumPath);
    syncFile(manifestPath);
    syncFile(outputDir);

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      outputPath,
      checksumPath,
      manifestPath,
      bytes: fs.statSync(outputPath).size,
      sha256: digest,
      redisMode: target.mode
    }, null, 2)}\n`);
  } finally {
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
  commandEnv,
  connectionArgs,
  resolveRedisBackupTarget
};

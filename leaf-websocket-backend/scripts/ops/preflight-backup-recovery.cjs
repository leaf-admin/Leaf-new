#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const DEFAULT_BACKUP_ROOT = '/var/backups/leaf';
const DEFAULT_MAX_AGE_HOURS = 26;

const BACKUP_KINDS = Object.freeze({
  redis: Object.freeze({
    directory: 'redis',
    pattern: /^redis-\d{8}_\d{6}\.rdb\.gz$/,
    validateManifest: (manifest) => (
      manifest.schemaVersion === 1
      && manifest.redis?.dbScope === 'all'
      && typeof manifest.validation === 'string'
      && manifest.validation.trim().length > 0
    ),
    validateReceipt: (receipt) => (
      receipt.status === 'passed'
      && receipt.checksumVerified === true
      && receipt.rdbVerified === true
      && receipt.isolatedRestoreStarted === true
      && receipt.nonemptyRequired === true
      && Number.isInteger(receipt.totalKeys)
      && receipt.totalKeys > 0
    )
  }),
  firestore: Object.freeze({
    directory: 'firestore',
    pattern: /^firestore-critical-\d{8}_\d{6}\.json\.gz$/,
    validateManifest: (manifest) => (
      manifest.schemaVersion === 1
      && manifest.kind === 'leaf-firestore-logical-backup'
      && manifest.complete === true
      && Number.isInteger(manifest.totalDocuments)
      && manifest.totalDocuments > 0
    ),
    validateReceipt: (receipt) => (
      receipt.status === 'passed'
      && receipt.checksumVerified === true
      && receipt.manifestVerified === true
      && receipt.logicalRestoreDecoded === true
      && Number.isInteger(receipt.collectionsVerified)
      && receipt.collectionsVerified > 0
      && Number.isInteger(receipt.documentsVerified)
      && receipt.documentsVerified > 0
    )
  })
});

function readBooleanLike(value, fallback = false) {
  if (value == null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function shouldEnforce(environment = process.env) {
  return readBooleanLike(environment.BACKUP_RECOVERY_PREFLIGHT_REQUIRED, false)
    || (String(environment.NODE_ENV || '').trim().toLowerCase() === 'production'
      && readBooleanLike(environment.LEAF_BROAD_LAUNCH_APPROVED, false));
}

function resolveMaxAgeHours(environment = process.env) {
  const raw = String(
    environment.BACKUP_RECOVERY_PREFLIGHT_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS
  ).trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > 168) {
    throw new Error('BACKUP_RECOVERY_PREFLIGHT_MAX_AGE_HOURS deve estar entre 1 e 168');
  }
  return value;
}

function assertRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Artefato de backup inválido: ${path.basename(filePath)}`);
  }
  return stat;
}

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    throw new Error(`${description} inválido para ${path.basename(filePath)}`);
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

function findLatestArtifact(root, kind, kindConfig) {
  const directory = path.join(root, kindConfig.directory);
  if (!fs.existsSync(directory)) {
    throw new Error(`Diretório de backup ${kind} ausente`);
  }
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Diretório de backup ${kind} inválido`);
  }
  const candidates = fs.readdirSync(directory)
    .filter((name) => kindConfig.pattern.test(name))
    .map((name) => {
      const artifactPath = path.join(directory, name);
      return { artifactPath, mtimeMs: assertRegularFile(artifactPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  if (candidates.length === 0) throw new Error(`Backup ${kind} ausente`);
  return candidates[0].artifactPath;
}

async function verifyArtifact({ root, kind, kindConfig, nowMs, maxAgeHours }) {
  const artifactPath = findLatestArtifact(root, kind, kindConfig);
  const manifestPath = `${artifactPath}.manifest.json`;
  const checksumPath = `${artifactPath}.sha256`;
  const receiptPath = `${artifactPath}.verified.json`;
  for (const sidecar of [manifestPath, checksumPath, receiptPath]) {
    if (!fs.existsSync(sidecar)) {
      throw new Error(`Backup ${kind} sem ${path.basename(sidecar)}`);
    }
    assertRegularFile(sidecar);
  }

  const artifactStat = assertRegularFile(artifactPath);
  const manifest = readJson(manifestPath, 'Manifesto');
  const receipt = readJson(receiptPath, 'Recibo de verificação');
  const expectedChecksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const actualChecksum = await sha256(artifactPath);

  if (
    manifest.file !== path.basename(artifactPath)
    || manifest.bytes !== artifactStat.size
    || manifest.sha256 !== actualChecksum
    || expectedChecksum !== actualChecksum
    || !kindConfig.validateManifest(manifest)
  ) {
    throw new Error(`Backup ${kind} diverge do manifesto ou checksum`);
  }
  if (
    path.basename(String(receipt.backupPath || '')) !== path.basename(artifactPath)
    || !kindConfig.validateReceipt(receipt)
  ) {
    throw new Error(`Backup ${kind} sem verificação de restore válida`);
  }

  const createdAtMs = Date.parse(manifest.createdAt);
  const verifiedAtMs = Date.parse(receipt.verifiedAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(verifiedAtMs)) {
    throw new Error(`Backup ${kind} sem timestamps válidos`);
  }
  if (verifiedAtMs < createdAtMs || verifiedAtMs > nowMs + 5 * 60 * 1000) {
    throw new Error(`Backup ${kind} com ordem temporal inválida`);
  }
  const ageHours = (nowMs - verifiedAtMs) / (60 * 60 * 1000);
  if (ageHours < 0 || ageHours > maxAgeHours) {
    throw new Error(`Backup ${kind} excede ${maxAgeHours} horas`);
  }

  return {
    file: path.basename(artifactPath),
    createdAt: new Date(createdAtMs).toISOString(),
    verifiedAt: new Date(verifiedAtMs).toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
    bytes: artifactStat.size,
    sha256Verified: true,
    restoreReceiptVerified: true
  };
}

async function runPreflight({ environment = process.env, now = new Date() } = {}) {
  if (!shouldEnforce(environment)) {
    return { ok: true, skipped: true, reason: 'not_required_outside_broad_launch' };
  }

  const configuredRoot = String(environment.BACKUP_ROOT || DEFAULT_BACKUP_ROOT).trim();
  if (!path.isAbsolute(configuredRoot) || !fs.existsSync(configuredRoot)) {
    throw new Error('BACKUP_ROOT absoluto e existente é obrigatório');
  }
  const root = fs.realpathSync(configuredRoot);
  const maxAgeHours = resolveMaxAgeHours(environment);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Relógio inválido no preflight de backup');

  const entries = await Promise.all(Object.entries(BACKUP_KINDS).map(async ([kind, kindConfig]) => ([
    kind,
    await verifyArtifact({ root, kind, kindConfig, nowMs, maxAgeHours })
  ])));

  return {
    ok: true,
    skipped: false,
    checkedAt: new Date(nowMs).toISOString(),
    maxAgeHours,
    backups: Object.fromEntries(entries)
  };
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await runPreflight(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  BACKUP_KINDS,
  DEFAULT_BACKUP_ROOT,
  DEFAULT_MAX_AGE_HOURS,
  findLatestArtifact,
  readBooleanLike,
  resolveMaxAgeHours,
  runPreflight,
  shouldEnforce,
  verifyArtifact
};

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const admin = require('firebase-admin');

const EMULATOR_CONFIRMATION = 'RESTORE_TO_LOCAL_RTDB_EMULATOR';
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

process.umask(0o077);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function assertEmulatorTarget({ emulatorHost, projectId, databaseId, confirmation }) {
  const host = String(emulatorHost || '').trim();
  const project = String(projectId || '').trim();
  const database = String(databaseId || '').trim();
  if (confirmation !== EMULATOR_CONFIRMATION) {
    throw new Error(`Confirmação obrigatória: ${EMULATOR_CONFIRMATION}`);
  }
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(host)) {
    throw new Error('FIREBASE_DATABASE_EMULATOR_HOST deve apontar para loopback com porta explícita');
  }
  const port = Number.parseInt(host.slice(host.lastIndexOf(':') + 1), 10);
  if (port > 65535) throw new Error('Porta inválida em FIREBASE_DATABASE_EMULATOR_HOST');
  if (!/^demo-[a-z0-9][a-z0-9-]*$/.test(project)) {
    throw new Error('Restore permitido somente em project id local iniciado por demo-');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(database) || !database.startsWith(`${project}-`)) {
    throw new Error('Namespace RTDB deve pertencer ao mesmo projeto demo local');
  }
  return { emulatorHost: host, projectId: project, databaseId: database };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadVerifiedRtdbBackup(backupPath, options = {}) {
  const absoluteBackupPath = path.resolve(backupPath);
  if (!/\.json(?:\.gz)?$/i.test(absoluteBackupPath)) {
    throw new Error('Backup RTDB deve terminar em .json ou .json.gz');
  }
  if (!fs.existsSync(absoluteBackupPath)) throw new Error(`Backup não encontrado: ${absoluteBackupPath}`);
  const checksumPath = path.resolve(options.checksumPath || `${absoluteBackupPath}.sha256`);
  if (!fs.existsSync(checksumPath)) throw new Error('Checksum SHA-256 é obrigatório para o restore RTDB');

  const maxBytes = boundedPositiveInteger(
    options.maxUncompressedBytes,
    DEFAULT_MAX_UNCOMPRESSED_BYTES,
    2 * 1024 * 1024 * 1024
  );
  if (fs.statSync(absoluteBackupPath).size > maxBytes) {
    throw new Error('Backup RTDB acima do limite antes da descompactação');
  }
  const backup = fs.readFileSync(absoluteBackupPath);
  const expectedChecksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expectedChecksum) || sha256(backup) !== expectedChecksum.toLowerCase()) {
    throw new Error('Checksum não corresponde ao backup RTDB');
  }

  let decoded;
  try {
    decoded = /\.gz$/i.test(absoluteBackupPath)
      ? zlib.gunzipSync(backup, { maxOutputLength: maxBytes })
      : backup;
  } catch (error) {
    throw new Error(`Backup RTDB compactado inválido ou acima do limite: ${error.message}`);
  }
  if (decoded.length > maxBytes) throw new Error('Backup RTDB acima do limite descompactado');

  let payload;
  try {
    payload = JSON.parse(decoded.toString('utf8'));
  } catch (_error) {
    throw new Error('Backup RTDB não contém JSON válido');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length === 0) {
    throw new Error('Raiz do backup RTDB deve ser um objeto JSON não vazio');
  }

  return {
    backupPath: absoluteBackupPath,
    checksumPath,
    checksum: expectedChecksum.toLowerCase(),
    compressed: /\.gz$/i.test(absoluteBackupPath),
    bytes: backup.length,
    uncompressedBytes: decoded.length,
    payload
  };
}

async function restoreRtdbEmulator({
  backupPath,
  checksumPath,
  emulatorHost,
  projectId,
  databaseId,
  confirmation,
  maxUncompressedBytes
}) {
  const target = assertEmulatorTarget({ emulatorHost, projectId, databaseId, confirmation });
  const verified = loadVerifiedRtdbBackup(backupPath, { checksumPath, maxUncompressedBytes });
  const previousEmulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = target.emulatorHost;
  let app;

  try {
    app = admin.initializeApp({
      projectId: target.projectId,
      databaseURL: `https://${target.databaseId}.firebaseio.com`
    }, `leaf-rtdb-restore-${process.pid}-${Date.now()}`);
    const root = app.database().ref('/');
    const existing = await root.once('value');
    if (existing.exists()) throw new Error('Restore recusado: raiz RTDB de destino não está vazia');

    await root.set(verified.payload);
    const restored = await root.once('value');
    if (!restored.exists()) throw new Error('Raiz RTDB não foi restaurada');
    assert.deepStrictEqual(restored.val(), verified.payload, 'Conteúdo RTDB restaurado diverge do backup');

    return {
      status: 'passed',
      target: 'local-rtdb-emulator',
      emulatorHost: target.emulatorHost,
      projectId: target.projectId,
      databaseId: target.databaseId,
      checksumVerified: true,
      compressed: verified.compressed,
      uncompressedBytes: verified.uncompressedBytes,
      emptyTargetGuardVerified: true,
      rootRestored: true,
      readBackVerified: true
    };
  } finally {
    try {
      if (app) await app.delete();
    } finally {
      if (previousEmulatorHost === undefined) delete process.env.FIREBASE_DATABASE_EMULATOR_HOST;
      else process.env.FIREBASE_DATABASE_EMULATOR_HOST = previousEmulatorHost;
    }
  }
}

async function main() {
  const backupPath = argument('--backup');
  if (!backupPath) throw new Error('Parâmetro --backup obrigatório');
  const projectId = argument('--project-id', process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  const result = await restoreRtdbEmulator({
    backupPath,
    checksumPath: argument('--checksum', `${backupPath}.sha256`),
    emulatorHost: process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    projectId,
    databaseId: argument('--database-id', `${projectId}-default-rtdb`),
    confirmation: argument('--confirm-emulator'),
    maxUncompressedBytes: process.env.RTDB_RESTORE_MAX_UNCOMPRESSED_BYTES
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_UNCOMPRESSED_BYTES,
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  boundedPositiveInteger,
  loadVerifiedRtdbBackup,
  restoreRtdbEmulator,
  sha256
};

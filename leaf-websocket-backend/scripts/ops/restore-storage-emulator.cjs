#!/usr/bin/env node
'use strict';

const assert = require('assert');
const admin = require('firebase-admin');

const EMULATOR_CONFIRMATION = 'RESTORE_BETWEEN_LOCAL_STORAGE_EMULATOR_BUCKETS';
const DEFAULT_MAX_OBJECTS = 10000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function bucketBelongsToProject(bucket, projectId) {
  return bucket === `${projectId}.appspot.com`
    || bucket === `${projectId}.firebasestorage.app`
    || bucket.startsWith(`${projectId}-`);
}

function assertEmulatorTarget({
  emulatorHost,
  projectId,
  sourceBucket,
  targetBucket,
  confirmation
}) {
  const host = String(emulatorHost || '').trim();
  const project = String(projectId || '').trim();
  const source = String(sourceBucket || '').trim();
  const target = String(targetBucket || '').trim();
  if (confirmation !== EMULATOR_CONFIRMATION) {
    throw new Error(`Confirmação obrigatória: ${EMULATOR_CONFIRMATION}`);
  }
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(host)) {
    throw new Error('FIREBASE_STORAGE_EMULATOR_HOST deve apontar para loopback com porta explícita');
  }
  const port = Number.parseInt(host.slice(host.lastIndexOf(':') + 1), 10);
  if (port > 65535) throw new Error('Porta inválida em FIREBASE_STORAGE_EMULATOR_HOST');
  if (!/^demo-[a-z0-9][a-z0-9-]*$/.test(project)) {
    throw new Error('Restore permitido somente em project id local iniciado por demo-');
  }
  const bucketPattern = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
  if (!bucketPattern.test(source) || !bucketPattern.test(target)) {
    throw new Error('Buckets do restore devem ter nomes válidos');
  }
  if (!bucketBelongsToProject(source, project) || !bucketBelongsToProject(target, project)) {
    throw new Error('Buckets devem pertencer ao mesmo projeto demo local');
  }
  if (source === target) throw new Error('Bucket de backup e bucket de destino devem ser diferentes');
  return {
    emulatorHost: host,
    projectId: project,
    sourceBucket: source,
    targetBucket: target
  };
}

function normalizePrefix(value) {
  const prefix = String(value || '').trim();
  if (!prefix || prefix.startsWith('/') || prefix.includes('..') || /[\u0000-\u001f]/.test(prefix)) {
    throw new Error('Prefixo Storage obrigatório e inválido');
  }
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function restorableMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries({
    cacheControl: metadata.cacheControl,
    contentDisposition: metadata.contentDisposition,
    contentEncoding: metadata.contentEncoding,
    contentLanguage: metadata.contentLanguage,
    contentType: metadata.contentType,
    metadata: metadata.metadata && typeof metadata.metadata === 'object'
      ? { ...metadata.metadata }
      : undefined
  }).filter(([, value]) => value !== undefined && value !== null));
}

async function restoreStorageEmulator({
  emulatorHost,
  projectId,
  sourceBucket,
  targetBucket,
  prefix,
  confirmation,
  maxObjects,
  maxBytes
}) {
  const target = assertEmulatorTarget({
    emulatorHost,
    projectId,
    sourceBucket,
    targetBucket,
    confirmation
  });
  const normalizedPrefix = normalizePrefix(prefix);
  const objectLimit = boundedPositiveInteger(maxObjects, DEFAULT_MAX_OBJECTS, 100000);
  const byteLimit = boundedPositiveInteger(maxBytes, DEFAULT_MAX_BYTES, 10 * 1024 * 1024 * 1024);
  const previousStorageHost = process.env.STORAGE_EMULATOR_HOST;
  process.env.STORAGE_EMULATOR_HOST = `http://${target.emulatorHost}`;
  let app;

  try {
    app = admin.initializeApp({
      projectId: target.projectId,
      storageBucket: target.sourceBucket
    }, `leaf-storage-restore-${process.pid}-${Date.now()}`);
    const storage = app.storage();
    const source = storage.bucket(target.sourceBucket);
    const destination = storage.bucket(target.targetBucket);
    const [listedFiles] = await source.getFiles({ prefix: normalizedPrefix, autoPaginate: true });
    const files = listedFiles.sort((left, right) => left.name.localeCompare(right.name));
    if (files.length === 0) throw new Error('Nenhum objeto encontrado no prefixo do bucket de backup');
    if (files.length > objectLimit) throw new Error('Quantidade de objetos excede o limite do restore');

    for (const sourceFile of files) {
      const [exists] = await destination.file(sourceFile.name).exists();
      if (exists) throw new Error(`Restore recusado: objeto de destino já existe (${sourceFile.name})`);
    }

    let restoredBytes = 0;
    for (const sourceFile of files) {
      const [[contents], [sourceMetadata]] = await Promise.all([
        sourceFile.download(),
        sourceFile.getMetadata()
      ]);
      restoredBytes += contents.length;
      if (restoredBytes > byteLimit) throw new Error('Volume de objetos excede o limite do restore');

      const targetFile = destination.file(sourceFile.name);
      const expectedMetadata = restorableMetadata(sourceMetadata);
      await targetFile.save(contents, {
        resumable: false,
        validation: 'crc32c',
        metadata: expectedMetadata,
        preconditionOpts: { ifGenerationMatch: 0 }
      });
      const [[restoredContents], [restoredMetadata]] = await Promise.all([
        targetFile.download(),
        targetFile.getMetadata()
      ]);
      assert.deepStrictEqual(restoredContents, contents, `Bytes restaurados divergem em ${sourceFile.name}`);
      assert.deepStrictEqual(
        restorableMetadata(restoredMetadata),
        expectedMetadata,
        `Metadados restaurados divergem em ${sourceFile.name}`
      );
    }

    return {
      status: 'passed',
      target: 'local-storage-emulator',
      emulatorHost: target.emulatorHost,
      projectId: target.projectId,
      sourceBucket: target.sourceBucket,
      targetBucket: target.targetBucket,
      prefix: normalizedPrefix,
      collisionGuardVerified: true,
      objectsRestored: files.length,
      bytesRestored: restoredBytes,
      readBackVerified: true,
      metadataVerified: true
    };
  } finally {
    try {
      if (app) await app.delete();
    } finally {
      if (previousStorageHost === undefined) delete process.env.STORAGE_EMULATOR_HOST;
      else process.env.STORAGE_EMULATOR_HOST = previousStorageHost;
    }
  }
}

async function main() {
  const projectId = argument('--project-id', process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  const result = await restoreStorageEmulator({
    emulatorHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST,
    projectId,
    sourceBucket: argument('--source-bucket'),
    targetBucket: argument('--target-bucket'),
    prefix: argument('--prefix'),
    confirmation: argument('--confirm-emulator'),
    maxObjects: process.env.STORAGE_RESTORE_MAX_OBJECTS,
    maxBytes: process.env.STORAGE_RESTORE_MAX_BYTES
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
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_OBJECTS,
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  boundedPositiveInteger,
  bucketBelongsToProject,
  normalizePrefix,
  restorableMetadata,
  restoreStorageEmulator
};

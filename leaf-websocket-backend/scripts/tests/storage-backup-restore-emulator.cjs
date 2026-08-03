#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const {
  EMULATOR_CONFIRMATION
} = require('../ops/restore-storage-emulator.cjs');

function runRestore({ projectId, sourceBucket, targetBucket, prefix }) {
  return spawnSync(process.execPath, [
    path.join(__dirname, '../ops/restore-storage-emulator.cjs'),
    '--project-id', projectId,
    '--source-bucket', sourceBucket,
    '--target-bucket', targetBucket,
    '--prefix', prefix,
    '--confirm-emulator', EMULATOR_CONFIRMATION
  ], {
    cwd: path.join(__dirname, '../../..'),
    env: process.env,
    encoding: 'utf8'
  });
}

async function deletePrefix(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(files.map(file => file.delete({ ignoreNotFound: true })));
}

async function main() {
  const emulatorHost = String(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '');
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '');
  assert.match(emulatorHost, /^(?:localhost|127\.0\.0\.1|\[::1\]):/);
  assert.match(projectId, /^demo-/);
  process.env.STORAGE_EMULATOR_HOST = `http://${emulatorHost}`;

  const sourceBucketName = `${projectId}-backup.appspot.com`;
  const targetBucketName = `${projectId}-restore.appspot.com`;
  const prefix = `restore-proof/${process.pid}-${Date.now()}/`;
  const app = admin.initializeApp({
    projectId,
    storageBucket: sourceBucketName
  }, `leaf-storage-proof-${process.pid}-${Date.now()}`);
  const sourceBucket = app.storage().bucket(sourceBucketName);
  const targetBucket = app.storage().bucket(targetBucketName);
  const fixtures = [
    {
      name: `${prefix}drivers/driver-proof/cnh.pdf`,
      contents: Buffer.from('%PDF-leaf-cnh-proof'),
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'private, max-age=0',
        metadata: { documentType: 'CNH', ownerId: 'driver-proof' }
      }
    },
    {
      name: `${prefix}restricted/kyc-proof.jpg`,
      contents: Buffer.from('leaf-kyc-image-proof'),
      metadata: {
        contentType: 'image/jpeg',
        contentDisposition: 'inline',
        metadata: { evidenceType: 'failed-face-compare', retentionClass: '30d' }
      }
    }
  ];

  try {
    await Promise.all([
      deletePrefix(sourceBucket, prefix),
      deletePrefix(targetBucket, prefix)
    ]);
    for (const fixture of fixtures) {
      await sourceBucket.file(fixture.name).save(fixture.contents, {
        resumable: false,
        metadata: fixture.metadata
      });
    }

    const first = runRestore({ projectId, sourceBucket: sourceBucketName, targetBucket: targetBucketName, prefix });
    assert.strictEqual(first.status, 0, first.stderr || first.stdout);
    const result = JSON.parse(first.stdout);
    assert.deepStrictEqual({
      status: result.status,
      target: result.target,
      objectsRestored: result.objectsRestored,
      readBackVerified: result.readBackVerified,
      metadataVerified: result.metadataVerified
    }, {
      status: 'passed',
      target: 'local-storage-emulator',
      objectsRestored: fixtures.length,
      readBackVerified: true,
      metadataVerified: true
    });

    for (const fixture of fixtures) {
      const targetFile = targetBucket.file(fixture.name);
      const [[contents], [metadata]] = await Promise.all([
        targetFile.download(),
        targetFile.getMetadata()
      ]);
      assert.deepStrictEqual(contents, fixture.contents);
      assert.strictEqual(metadata.contentType, fixture.metadata.contentType);
      assert.deepStrictEqual(metadata.metadata, fixture.metadata.metadata);
    }

    const second = runRestore({ projectId, sourceBucket: sourceBucketName, targetBucket: targetBucketName, prefix });
    assert.notStrictEqual(second.status, 0, 'Restore repetido deveria recusar objetos existentes');
    assert.match(second.stderr, /objeto de destino já existe/);

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      target: 'local-storage-emulator',
      objectsRestored: fixtures.length,
      readBackVerified: true,
      metadataVerified: true,
      collisionRejected: true
    })}\n`);
  } finally {
    await Promise.all([
      deletePrefix(sourceBucket, prefix),
      deletePrefix(targetBucket, prefix)
    ]);
    await app.delete();
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});

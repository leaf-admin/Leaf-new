#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const {
  TYPE_KEY,
  writeBackupArtifacts
} = require('../ops/backup-firestore-critical.js');
const {
  EMULATOR_CONFIRMATION
} = require('../ops/restore-firestore-emulator.cjs');

function runRestore(backupPath, projectId) {
  return spawnSync(process.execPath, [
    path.join(__dirname, '../ops/restore-firestore-emulator.cjs'),
    '--backup', backupPath,
    '--project-id', projectId,
    '--confirm-emulator', EMULATOR_CONFIRMATION
  ], {
    cwd: path.join(__dirname, '../../..'),
    env: process.env,
    encoding: 'utf8'
  });
}

async function main() {
  const emulatorHost = String(process.env.FIRESTORE_EMULATOR_HOST || '');
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '');
  assert.match(emulatorHost, /^(?:localhost|127\.0\.0\.1|\[::1\]):/);
  assert.match(projectId, /^demo-/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-firestore-emulator-restore-'));
  const backupPath = path.join(tempDir, 'firestore-emulator-proof.json.gz');
  const suffix = `${process.pid}-${Date.now()}`;
  const collectionName = `backup_restore_proof_${suffix.replace(/-/g, '_')}`;
  const referencedPath = `${collectionName}/reference-target`;
  const restoredPath = `${collectionName}/driver-proof`;
  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    complete: true,
    scope: {
      kind: 'configured_top_level_collections',
      includesSubcollections: false,
      includesFirebaseStorage: false,
      pageSize: 500,
      maxDocsPerCollection: null
    },
    collections: {
      [collectionName]: {
        count: 1,
        docs: [{
          id: 'driver-proof',
          path: restoredPath,
          data: {
            active: true,
            attempts: 3,
            labels: ['restore', 'emulator'],
            timestamp: { [TYPE_KEY]: 'timestamp', seconds: 1785672000, nanoseconds: 123000000 },
            location: { [TYPE_KEY]: 'geopoint', latitude: -23.5505, longitude: -46.6333 },
            owner: { [TYPE_KEY]: 'reference', path: referencedPath },
            bytes: { [TYPE_KEY]: 'bytes', base64: Buffer.from('leaf-proof').toString('base64') },
            unavailable: { [TYPE_KEY]: 'number', value: 'NaN' }
          }
        }]
      }
    }
  };

  let app;
  try {
    writeBackupArtifacts(backupPath, payload);
    const first = runRestore(backupPath, projectId);
    assert.strictEqual(first.status, 0, first.stderr || first.stdout);
    const result = JSON.parse(first.stdout);
    assert.deepStrictEqual({
      status: result.status,
      target: result.target,
      documentsRestored: result.documentsRestored,
      readBackVerified: result.readBackVerified
    }, {
      status: 'passed',
      target: 'local-firestore-emulator',
      documentsRestored: 1,
      readBackVerified: true
    });

    app = admin.initializeApp({ projectId }, `leaf-firestore-proof-${suffix}`);
    const snapshot = await app.firestore().doc(restoredPath).get();
    assert.strictEqual(snapshot.exists, true);
    assert.strictEqual(snapshot.get('active'), true);
    assert.strictEqual(snapshot.get('owner').path, referencedPath);
    assert.strictEqual(snapshot.get('bytes').toString(), 'leaf-proof');
    assert.strictEqual(Number.isNaN(snapshot.get('unavailable')), true);

    const second = runRestore(backupPath, projectId);
    assert.notStrictEqual(second.status, 0, 'Restore repetido deveria recusar sobrescrita');
    assert.match(second.stderr, /documento de destino já existe/);

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      target: 'local-firestore-emulator',
      documentsRestored: 1,
      readBackVerified: true,
      overwriteRejected: true
    })}\n`);
  } finally {
    if (app) await app.delete();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});

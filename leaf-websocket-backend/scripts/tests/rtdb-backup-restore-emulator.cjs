#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const {
  EMULATOR_CONFIRMATION
} = require('../ops/restore-rtdb-emulator.cjs');

function runRestore({ backupPath, checksumPath, projectId, databaseId }) {
  return spawnSync(process.execPath, [
    path.join(__dirname, '../ops/restore-rtdb-emulator.cjs'),
    '--backup', backupPath,
    '--checksum', checksumPath,
    '--project-id', projectId,
    '--database-id', databaseId,
    '--confirm-emulator', EMULATOR_CONFIRMATION
  ], {
    cwd: path.join(__dirname, '../../..'),
    env: process.env,
    encoding: 'utf8'
  });
}

async function main() {
  const emulatorHost = String(process.env.FIREBASE_DATABASE_EMULATOR_HOST || '');
  const projectId = String(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '');
  const databaseId = `${projectId}-default-rtdb`;
  assert.match(emulatorHost, /^(?:localhost|127\.0\.0\.1|\[::1\]):/);
  assert.match(projectId, /^demo-/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-rtdb-emulator-restore-'));
  const backupPath = path.join(tempDir, 'native-rtdb-backup.json.gz');
  const checksumPath = `${backupPath}.sha256`;
  const fixture = {
    drivers: {
      'driver-proof': {
        active: false,
        status: 'approved',
        currentVehicleId: 'vehicle-proof'
      }
    },
    kycChallenges: {
      'driver-proof': {
        active: true,
        challengeId: 'challenge-proof',
        attempts: 1
      }
    },
    trip_data: {
      'ride-proof': {
        status: 'completed',
        distanceMeters: 3210
      }
    }
  };
  const compressed = zlib.gzipSync(`${JSON.stringify(fixture)}\n`, { level: 9 });
  const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
  fs.writeFileSync(backupPath, compressed, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(backupPath)}\n`, {
    mode: 0o600,
    flag: 'wx'
  });

  const app = admin.initializeApp({
    projectId,
    databaseURL: `https://${databaseId}.firebaseio.com`
  }, `leaf-rtdb-proof-${process.pid}-${Date.now()}`);
  const root = app.database().ref('/');

  try {
    await root.set(null);
    const first = runRestore({ backupPath, checksumPath, projectId, databaseId });
    assert.strictEqual(first.status, 0, first.stderr || first.stdout);
    const result = JSON.parse(first.stdout);
    assert.deepStrictEqual({
      status: result.status,
      target: result.target,
      checksumVerified: result.checksumVerified,
      rootRestored: result.rootRestored,
      readBackVerified: result.readBackVerified
    }, {
      status: 'passed',
      target: 'local-rtdb-emulator',
      checksumVerified: true,
      rootRestored: true,
      readBackVerified: true
    });
    assert.deepStrictEqual((await root.once('value')).val(), fixture);

    const second = runRestore({ backupPath, checksumPath, projectId, databaseId });
    assert.notStrictEqual(second.status, 0, 'Restore repetido deveria recusar raiz ocupada');
    assert.match(second.stderr, /raiz RTDB de destino não está vazia/);

    process.stdout.write(`${JSON.stringify({
      status: 'passed',
      target: 'local-rtdb-emulator',
      checksumVerified: true,
      rootRestored: true,
      readBackVerified: true,
      occupiedRootRejected: true
    })}\n`);
  } finally {
    await root.set(null);
    await app.delete();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message || String(error)}\n`);
  process.exitCode = 1;
});

const fs = require('fs');
const path = require('path');

const {
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  boundedPositiveInteger,
  normalizePrefix,
  restorableMetadata
} = require('../../../scripts/ops/restore-storage-emulator.cjs');

describe('Storage cross-bucket emulator restore', () => {
  test('accepts only two distinct buckets in an explicitly confirmed loopback demo project', () => {
    expect(assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9199',
      projectId: 'demo-leaf-rules',
      sourceBucket: 'demo-leaf-rules-backup.appspot.com',
      targetBucket: 'demo-leaf-rules-restore.appspot.com',
      confirmation: EMULATOR_CONFIRMATION
    })).toEqual({
      emulatorHost: '127.0.0.1:9199',
      projectId: 'demo-leaf-rules',
      sourceBucket: 'demo-leaf-rules-backup.appspot.com',
      targetBucket: 'demo-leaf-rules-restore.appspot.com'
    });

    expect(() => assertEmulatorTarget({
      emulatorHost: 'storage.googleapis.com:443',
      projectId: 'demo-leaf-rules',
      sourceBucket: 'demo-leaf-rules-backup.appspot.com',
      targetBucket: 'demo-leaf-rules-restore.appspot.com',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('loopback');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9199',
      projectId: 'leaf-reactnative',
      sourceBucket: 'leaf-reactnative-backup.appspot.com',
      targetBucket: 'leaf-reactnative-restore.appspot.com',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('demo-');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9199',
      projectId: 'demo-leaf-rules',
      sourceBucket: 'leaf-reactnative.firebasestorage.app',
      targetBucket: 'demo-leaf-rules-restore.appspot.com',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('mesmo projeto demo');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9199',
      projectId: 'demo-leaf-rules',
      sourceBucket: 'demo-leaf-rules-backup.appspot.com',
      targetBucket: 'demo-leaf-rules-backup.appspot.com',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('devem ser diferentes');
  });

  test('requires a bounded explicit prefix and safe restore limits', () => {
    expect(normalizePrefix('backup/2026-08-03')).toBe('backup/2026-08-03/');
    expect(normalizePrefix('backup/2026-08-03/')).toBe('backup/2026-08-03/');
    expect(() => normalizePrefix('')).toThrow('obrigatório');
    expect(() => normalizePrefix('../production')).toThrow('inválido');
    expect(boundedPositiveInteger('250', 100, 1000)).toBe(250);
    expect(boundedPositiveInteger('0', 100, 1000)).toBe(100);
  });

  test('preserves only portable object metadata', () => {
    expect(restorableMetadata({
      name: 'ignored.pdf',
      bucket: 'ignored-bucket',
      generation: '123',
      md5Hash: 'server-derived',
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=0',
      metadata: { ownerId: 'driver-proof' }
    })).toEqual({
      cacheControl: 'private, max-age=0',
      contentType: 'application/pdf',
      metadata: { ownerId: 'driver-proof' }
    });
  });

  test('keeps the real Storage emulator restore proof in the Firebase contract job', () => {
    const rootPackage = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../../package.json'),
      'utf8'
    ));
    expect(rootPackage.scripts['test:firebase:rules']).toContain(
      'leaf-websocket-backend/scripts/tests/storage-backup-restore-emulator.cjs'
    );
  });
});

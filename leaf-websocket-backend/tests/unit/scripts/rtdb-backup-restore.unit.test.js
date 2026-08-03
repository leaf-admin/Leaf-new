const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  boundedPositiveInteger,
  loadVerifiedRtdbBackup
} = require('../../../scripts/ops/restore-rtdb-emulator.cjs');

describe('RTDB native backup emulator restore', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-rtdb-restore-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writeBackup(payload, fileName = 'native-rtdb.json.gz') {
    const backupPath = path.join(tempDir, fileName);
    const raw = Buffer.from(`${JSON.stringify(payload)}\n`);
    const bytes = fileName.endsWith('.gz') ? zlib.gzipSync(raw) : raw;
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(backupPath, bytes);
    fs.writeFileSync(`${backupPath}.sha256`, `${checksum}  ${fileName}\n`);
    return backupPath;
  }

  test('accepts only an explicitly confirmed loopback demo namespace', () => {
    expect(assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9000',
      projectId: 'demo-leaf-rules',
      databaseId: 'demo-leaf-rules-default-rtdb',
      confirmation: EMULATOR_CONFIRMATION
    })).toEqual({
      emulatorHost: '127.0.0.1:9000',
      projectId: 'demo-leaf-rules',
      databaseId: 'demo-leaf-rules-default-rtdb'
    });

    expect(() => assertEmulatorTarget({
      emulatorHost: 'leaf-reactnative-default-rtdb.firebaseio.com:443',
      projectId: 'demo-leaf-rules',
      databaseId: 'demo-leaf-rules-default-rtdb',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('loopback');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9000',
      projectId: 'leaf-reactnative',
      databaseId: 'leaf-reactnative-default-rtdb',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('demo-');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9000',
      projectId: 'demo-leaf-rules',
      databaseId: 'leaf-reactnative-default-rtdb',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('mesmo projeto demo');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:9000',
      projectId: 'demo-leaf-rules',
      databaseId: 'demo-leaf-rules-default-rtdb',
      confirmation: 'yes'
    })).toThrow('Confirmação obrigatória');
  });

  test('verifies checksum, gzip and the complete JSON root before restore', () => {
    const backupPath = writeBackup({ users: { driver: { active: true } } });
    expect(loadVerifiedRtdbBackup(backupPath)).toMatchObject({
      backupPath,
      compressed: true,
      payload: { users: { driver: { active: true } } }
    });

    fs.appendFileSync(backupPath, 'tampered');
    expect(() => loadVerifiedRtdbBackup(backupPath)).toThrow('Checksum não corresponde');
  });

  test('supports native uncompressed JSON and rejects invalid or oversized roots', () => {
    const plainPath = writeBackup({ drivers: { one: true } }, 'native-rtdb.json');
    expect(loadVerifiedRtdbBackup(plainPath)).toMatchObject({ compressed: false });

    const arrayPath = writeBackup(['not', 'a', 'root'], 'array.json.gz');
    expect(() => loadVerifiedRtdbBackup(arrayPath)).toThrow('Raiz do backup RTDB');
    const emptyPath = writeBackup({}, 'empty.json.gz');
    expect(() => loadVerifiedRtdbBackup(emptyPath)).toThrow('Raiz do backup RTDB');
    expect(() => loadVerifiedRtdbBackup(plainPath, { maxUncompressedBytes: 5 })).toThrow('acima do limite');
  });

  test('bounds the decompression limit instead of accepting unsafe configuration', () => {
    expect(boundedPositiveInteger('1024', 500, 2048)).toBe(1024);
    expect(boundedPositiveInteger('0', 500, 2048)).toBe(500);
    expect(boundedPositiveInteger('4096', 500, 2048)).toBe(500);
  });

  test('keeps the real RTDB emulator restore proof in the Firebase contract job', () => {
    const rootPackage = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../../package.json'),
      'utf8'
    ));
    expect(rootPackage.scripts['test:firebase:rules']).toContain(
      'leaf-websocket-backend/scripts/tests/rtdb-backup-restore-emulator.cjs'
    );
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createBackup,
  DEFAULT_CRITICAL_COLLECTIONS,
  dumpCollection,
  encodeFirestoreValue,
  parseCollections,
  writeBackupArtifacts
} = require('../../../scripts/ops/backup-firestore-critical.js');
const {
  verifyFirestoreRestore
} = require('../../../scripts/ops/verify-firestore-restore.cjs');
const {
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  canonicalizeEncodedValue,
  decodeFirestoreValue
} = require('../../../scripts/ops/restore-firestore-emulator.cjs');
const {
  buildExportScript,
  shellQuote
} = require('../../../scripts/ops/emit-backup-env.cjs');

function firestoreWithDocuments(collectionName, rows) {
  const documents = rows.map(({ id, data }, index) => ({
    id,
    ref: { path: `${collectionName}/${id}` },
    data: () => data,
    index
  }));
  const calls = [];
  return {
    calls,
    collection: jest.fn((requestedCollection) => {
      expect(requestedCollection).toBe(collectionName);
      let pageSize = 500;
      let startIndex = 0;
      return {
        orderBy(fieldPath) {
          calls.push({ operation: 'orderBy', fieldPath });
          return this;
        },
        limit(value) {
          pageSize = value;
          return this;
        },
        startAfter(document) {
          startIndex = document.index + 1;
          calls.push({ operation: 'startAfter', id: document.id });
          return this;
        },
        async get() {
          const docs = documents.slice(startIndex, startIndex + pageSize);
          calls.push({ operation: 'get', startIndex, count: docs.length });
          return { docs };
        }
      };
    })
  };
}

describe('Firestore logical backup and restore drill', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-firestore-backup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('paginates until every configured document is exported', async () => {
    const firestore = firestoreWithDocuments('users', [
      { id: 'a', data: { name: 'A' } },
      { id: 'b', data: { name: 'B' } },
      { id: 'c', data: { name: 'C' } },
      { id: 'd', data: { name: 'D' } },
      { id: 'e', data: { name: 'E' } }
    ]);

    const docs = await dumpCollection(firestore, 'users', {
      pageSize: 2,
      maxDocs: 0,
      documentIdFieldPath: '__name__'
    });

    expect(docs.map(document => document.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(firestore.calls.filter(call => call.operation === 'get')).toEqual([
      { operation: 'get', startIndex: 0, count: 2 },
      { operation: 'get', startIndex: 2, count: 2 },
      { operation: 'get', startIndex: 4, count: 1 }
    ]);
  });

  test('fails instead of silently truncating when the explicit safety cap is exceeded', async () => {
    const firestore = firestoreWithDocuments('bookings', [
      { id: 'a', data: {} },
      { id: 'b', data: {} },
      { id: 'c', data: {} },
      { id: 'd', data: {} }
    ]);

    await expect(dumpCollection(firestore, 'bookings', {
      pageSize: 2,
      maxDocs: 3,
      documentIdFieldPath: '__name__'
    })).rejects.toThrow('backup abortado sem truncar');
  });

  test('fails closed without creating an artifact when any collection read fails', async () => {
    const backupPath = path.join(tempDir, 'failed-firestore-critical.json.gz');
    const firestore = {
      collection: jest.fn(() => ({
        orderBy() { return this; },
        limit() { return this; },
        async get() { throw new Error('permission denied'); }
      }))
    };

    await expect(createBackup({
      firestore,
      collections: ['users'],
      pageSize: 100,
      maxDocs: 0,
      outputPath: backupPath
    })).rejects.toThrow('permission denied');
    expect(fs.existsSync(backupPath)).toBe(false);
    expect(fs.existsSync(`${backupPath}.manifest.json`)).toBe(false);
    expect(fs.existsSync(`${backupPath}.sha256`)).toBe(false);
  });

  test('encodes Firestore-specific values without losing their logical type', () => {
    class Timestamp {
      constructor(seconds, nanoseconds) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
      }
      toDate() {
        return new Date(this.seconds * 1000);
      }
    }
    class GeoPoint {
      constructor(latitude, longitude) {
        this.latitude = latitude;
        this.longitude = longitude;
      }
    }
    class DocumentReference {
      constructor(referencePath) {
        this.path = referencePath;
      }
    }

    expect(encodeFirestoreValue({
      at: new Timestamp(123, 456),
      location: new GeoPoint(-23.5, -46.6),
      owner: new DocumentReference('users/driver-1'),
      bytes: Buffer.from('leaf'),
      date: new Date('2026-08-02T12:00:00.000Z'),
      unavailable: Number.NaN
    })).toEqual({
      at: { __leafFirestoreType: 'timestamp', seconds: 123, nanoseconds: 456 },
      location: { __leafFirestoreType: 'geopoint', latitude: -23.5, longitude: -46.6 },
      owner: { __leafFirestoreType: 'reference', path: 'users/driver-1' },
      bytes: { __leafFirestoreType: 'bytes', base64: 'bGVhZg==' },
      date: { __leafFirestoreType: 'date', iso: '2026-08-02T12:00:00.000Z' },
      unavailable: { __leafFirestoreType: 'number', value: 'NaN' }
    });
  });

  test('writes a non-overwriting artifact set and verifies a logical restore offline', () => {
    const backupPath = path.join(tempDir, 'firestore-critical.json.gz');
    const payload = {
      schemaVersion: 2,
      generatedAt: '2026-08-02T12:00:00.000Z',
      complete: true,
      scope: {
        kind: 'configured_top_level_collections',
        includesSubcollections: false,
        includesFirebaseStorage: false,
        pageSize: 500,
        maxDocsPerCollection: null
      },
      collections: {
        users: {
          count: 1,
          docs: [{ id: 'driver-1', path: 'users/driver-1', data: { active: true } }]
        },
        financial_ledger_events: { count: 0, docs: [] }
      }
    };

    const written = writeBackupArtifacts(backupPath, payload);
    expect(written.totalDocuments).toBe(1);
    expect(verifyFirestoreRestore(backupPath)).toMatchObject({
      status: 'passed',
      checksumVerified: true,
      manifestVerified: true,
      logicalRestoreDecoded: true,
      collectionsVerified: 2,
      documentsVerified: 1
    });
    expect(() => writeBackupArtifacts(backupPath, payload)).toThrow('Destino já existe');

    fs.writeFileSync(`${backupPath}.sha256`, `0${'a'.repeat(63)}  firestore-critical.json.gz\n`);
    expect(() => verifyFirestoreRestore(backupPath)).toThrow('Manifesto ou checksum');
  });

  test('permits restore only to an explicitly confirmed loopback demo project', () => {
    expect(assertEmulatorTarget({
      emulatorHost: '127.0.0.1:8080',
      projectId: 'demo-leaf-rules',
      confirmation: EMULATOR_CONFIRMATION
    })).toEqual({ emulatorHost: '127.0.0.1:8080', projectId: 'demo-leaf-rules' });
    expect(assertEmulatorTarget({
      emulatorHost: '[::1]:8080',
      projectId: 'demo-leaf-rules',
      confirmation: EMULATOR_CONFIRMATION
    })).toEqual({ emulatorHost: '[::1]:8080', projectId: 'demo-leaf-rules' });

    expect(() => assertEmulatorTarget({
      emulatorHost: 'firestore.googleapis.com:443',
      projectId: 'demo-leaf-rules',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('loopback');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:8080',
      projectId: 'leaf-production',
      confirmation: EMULATOR_CONFIRMATION
    })).toThrow('demo-');
    expect(() => assertEmulatorTarget({
      emulatorHost: '127.0.0.1:8080',
      projectId: 'demo-leaf-rules',
      confirmation: 'yes'
    })).toThrow('Confirmação obrigatória');
  });

  test('decodes every Firestore logical type for an emulator write and canonical comparison', () => {
    const firestore = { doc: jest.fn(referencePath => ({ path: referencePath })) };
    const decoded = decodeFirestoreValue({
      unavailable: { __leafFirestoreType: 'number', value: 'NaN' },
      positive: { __leafFirestoreType: 'number', value: 'Infinity' },
      negative: { __leafFirestoreType: 'number', value: '-Infinity' },
      date: { __leafFirestoreType: 'date', iso: '2026-08-02T12:00:00.123Z' },
      timestamp: { __leafFirestoreType: 'timestamp', seconds: 123, nanoseconds: 456 },
      location: { __leafFirestoreType: 'geopoint', latitude: -23.5, longitude: -46.6 },
      owner: { __leafFirestoreType: 'reference', path: 'users/driver-1' },
      bytes: { __leafFirestoreType: 'bytes', base64: 'bGVhZg==' }
    }, firestore);

    expect(Number.isNaN(decoded.unavailable)).toBe(true);
    expect(decoded.positive).toBe(Infinity);
    expect(decoded.negative).toBe(-Infinity);
    expect(decoded.date.toISOString()).toBe('2026-08-02T12:00:00.123Z');
    expect(decoded.timestamp).toMatchObject({ seconds: 123, nanoseconds: 456 });
    expect(decoded.location).toMatchObject({ latitude: -23.5, longitude: -46.6 });
    expect(decoded.owner).toEqual({ path: 'users/driver-1' });
    expect(decoded.bytes.toString()).toBe('leaf');
    expect(canonicalizeEncodedValue({
      __leafFirestoreType: 'date',
      iso: '2026-08-02T12:00:00.123Z'
    })).toEqual({
      __leafFirestoreType: 'timestamp',
      seconds: 1785672000,
      nanoseconds: 123000000
    });
  });

  test('rejects duplicate or nested collection configuration', () => {
    expect(() => parseCollections('users,users')).toThrow('Coleções duplicadas');
    expect(() => parseCollections('users/driver-1/documents')).toThrow('top-level');
  });

  test('rejects a crafted nested collection before it can become a restore target', () => {
    const backupPath = path.join(tempDir, 'crafted-nested-firestore.json.gz');
    writeBackupArtifacts(backupPath, {
      schemaVersion: 2,
      generatedAt: '2026-08-02T12:00:00.000Z',
      complete: true,
      scope: {
        kind: 'configured_top_level_collections',
        includesSubcollections: false,
        includesFirebaseStorage: false,
        pageSize: 500,
        maxDocsPerCollection: null
      },
      collections: {
        'users/nested': {
          count: 1,
          docs: [{ id: 'driver-1', path: 'users/nested/driver-1', data: { active: true } }]
        }
      }
    });
    expect(() => verifyFirestoreRestore(backupPath)).toThrow('top-level inválido');
  });

  test('does not expand paid Firestore reads through the default collection inventory', () => {
    expect(DEFAULT_CRITICAL_COLLECTIONS).toEqual([
      'bookings',
      'payment_holdings',
      'payment_history',
      'users',
      'drivers'
    ]);
    expect(parseCollections()).toEqual(DEFAULT_CRITICAL_COLLECTIONS);
  });

  test('keeps both isolated restore drills mandatory in the daily routine', () => {
    const dailyBackupSource = fs.readFileSync(
      path.join(__dirname, '../../../scripts/ops/backup-daily.sh'),
      'utf8'
    );
    expect(dailyBackupSource).toContain('verify-redis-restore.cjs"');
    expect(dailyBackupSource).toContain('--backup "$REDIS_TARGET"');
    expect(dailyBackupSource).toContain('--require-nonempty > "$REDIS_VERIFICATION_TMP"');
    expect(dailyBackupSource).toContain('verify-firestore-restore.cjs"');
    expect(dailyBackupSource).toContain('--backup "$FIRESTORE_TARGET" > "$FIRESTORE_VERIFICATION_TMP"');
    expect(dailyBackupSource).toContain(
      'mv -- "$REDIS_VERIFICATION_TMP" "$REDIS_VERIFICATION"'
    );
    expect(dailyBackupSource).toContain(
      'mv -- "$FIRESTORE_VERIFICATION_TMP" "$FIRESTORE_VERIFICATION"'
    );
    expect(dailyBackupSource.indexOf('verify-redis-restore.cjs')).toBeLessThan(
      dailyBackupSource.indexOf('echo "[backup] redis ok')
    );
    expect(dailyBackupSource.indexOf('verify-firestore-restore.cjs')).toBeLessThan(
      dailyBackupSource.indexOf('echo "[backup] firestore ok')
    );
  });

  test('keeps the real Firestore emulator restore proof in the Firebase contract job', () => {
    const rootPackage = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../../../package.json'),
      'utf8'
    ));
    expect(rootPackage.scripts['test:firebase:rules']).toContain(
      'leaf-websocket-backend/scripts/tests/firestore-backup-restore-emulator.cjs'
    );
  });

  test('limits retention cleanup to validated backup subdirectories', () => {
    const dailyBackupSource = fs.readFileSync(
      path.join(__dirname, '../../../scripts/ops/backup-daily.sh'),
      'utf8'
    );
    expect(dailyBackupSource.indexOf('emit-backup-env.cjs')).toBeLessThan(
      dailyBackupSource.indexOf('BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/leaf}"')
    );
    expect(dailyBackupSource).not.toContain('source "$ROOT_DIR/.env"');
    expect(dailyBackupSource).toContain('BACKUP_ROOT deve ser absoluto');
    expect(dailyBackupSource).toContain('BACKUP_ROOT amplo demais');
    expect(dailyBackupSource).toContain('BACKUP_RETENTION_DAYS deve estar entre 1 e 3650');
    expect(dailyBackupSource).toContain(
      'find "$REDIS_BACKUP_DIR" "$FIRESTORE_BACKUP_DIR" -type f -mtime "+$RETENTION_DAYS" -delete'
    );
    expect(dailyBackupSource).not.toContain('find "$BACKUP_ROOT" -type f');
  });

  test('loads only backup dependencies from dotenv without shell execution', () => {
    const exports = buildExportScript([
      'REDIS_PASSWORD=secret with spaces',
      'FIRESTORE_BACKUP_PAGE_SIZE=250',
      'GOOGLE_APPLICATION_CREDENTIALS=/secure/leaf account.json',
      'DISCORD_ALERT_USERNAME=Leaf Observability',
      'BACKUP_ROOT=/explicit/backup/root',
      'NODE_OPTIONS=--require=untrusted.js'
    ].join('\n'), {
      BACKUP_ROOT: '/operator/override'
    });

    expect(exports).toContain("export REDIS_PASSWORD='secret with spaces'");
    expect(exports).toContain("export FIRESTORE_BACKUP_PAGE_SIZE='250'");
    expect(exports).toContain(
      "export GOOGLE_APPLICATION_CREDENTIALS='/secure/leaf account.json'"
    );
    expect(exports).not.toContain('DISCORD_ALERT_USERNAME');
    expect(exports).not.toContain('NODE_OPTIONS');
    expect(exports).not.toContain('BACKUP_ROOT');
    expect(shellQuote("Leaf's $(literal) value")).toBe("'Leaf'\"'\"'s $(literal) value'");
  });
});

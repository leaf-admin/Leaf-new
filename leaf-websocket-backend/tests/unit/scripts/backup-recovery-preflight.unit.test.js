const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runPreflight,
  shouldEnforce
} = require('../../../scripts/ops/preflight-backup-recovery.cjs');

function writeArtifactSet({ root, kind, createdAt, verifiedAt = createdAt }) {
  const isRedis = kind === 'redis';
  const directory = path.join(root, kind);
  const fileName = isRedis
    ? 'redis-20260803_120000.rdb.gz'
    : 'firestore-critical-20260803_120000.json.gz';
  const artifactPath = path.join(directory, fileName);
  const content = Buffer.from(`${kind}-verified-backup`);
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(artifactPath, content);
  fs.writeFileSync(`${artifactPath}.sha256`, `${digest}  ${fileName}\n`);
  fs.writeFileSync(`${artifactPath}.manifest.json`, `${JSON.stringify({
    schemaVersion: 1,
    ...(isRedis
      ? { redis: { dbScope: 'all' }, validation: 'redis-check-rdb passed' }
      : {
          kind: 'leaf-firestore-logical-backup',
          complete: true,
          totalDocuments: 1
        }),
    createdAt,
    file: fileName,
    bytes: content.length,
    sha256: digest
  })}\n`);
  fs.writeFileSync(`${artifactPath}.verified.json`, `${JSON.stringify({
    status: 'passed',
    verifiedAt,
    backupPath: artifactPath,
    checksumVerified: true,
    ...(isRedis
      ? {
          rdbVerified: true,
          isolatedRestoreStarted: true,
          nonemptyRequired: true,
          totalKeys: 1
        }
      : {
          manifestVerified: true,
          logicalRestoreDecoded: true,
          collectionsVerified: 1,
          documentsVerified: 1
        })
  })}\n`);
  return artifactPath;
}

describe('backup recovery admission preflight', () => {
  let backupRoot;
  const now = new Date('2026-08-03T13:00:00.000Z');
  const broadLaunchEnvironment = {
    NODE_ENV: 'production',
    LEAF_BROAD_LAUNCH_APPROVED: 'true'
  };

  beforeEach(() => {
    backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-backup-preflight-'));
  });

  afterEach(() => {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  });

  test('is required only for broad production launch or explicit enforcement', () => {
    expect(shouldEnforce({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldEnforce({ NODE_ENV: 'production', LEAF_BROAD_LAUNCH_APPROVED: 'true' })).toBe(true);
    expect(shouldEnforce({ BACKUP_RECOVERY_PREFLIGHT_REQUIRED: 'true' })).toBe(true);
  });

  test('skips without reading a backup root outside broad launch', async () => {
    await expect(runPreflight({
      environment: { NODE_ENV: 'production', BACKUP_ROOT: '/path/that/does/not/exist' },
      now
    })).resolves.toEqual({
      ok: true,
      skipped: true,
      reason: 'not_required_outside_broad_launch'
    });
  });

  test('accepts fresh, nonempty Redis and Firestore restore receipts', async () => {
    const verifiedAt = '2026-08-03T12:00:00.000Z';
    writeArtifactSet({ root: backupRoot, kind: 'redis', createdAt: verifiedAt });
    writeArtifactSet({ root: backupRoot, kind: 'firestore', createdAt: verifiedAt });

    await expect(runPreflight({
      environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
      now
    })).resolves.toMatchObject({
      ok: true,
      skipped: false,
      maxAgeHours: 26,
      backups: {
        redis: { ageHours: 1, sha256Verified: true, restoreReceiptVerified: true },
        firestore: { ageHours: 1, sha256Verified: true, restoreReceiptVerified: true }
      }
    });
  });

  test('rejects a backup without a persisted restore receipt', async () => {
    const verifiedAt = '2026-08-03T12:00:00.000Z';
    const redisPath = writeArtifactSet({ root: backupRoot, kind: 'redis', createdAt: verifiedAt });
    writeArtifactSet({ root: backupRoot, kind: 'firestore', createdAt: verifiedAt });
    fs.unlinkSync(`${redisPath}.verified.json`);

    await expect(runPreflight({
      environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
      now
    })).rejects.toThrow('Backup redis sem');
  });

  test('rejects a symlinked backup directory outside the admitted root', async () => {
    const verifiedAt = '2026-08-03T12:00:00.000Z';
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-backup-external-'));
    try {
      writeArtifactSet({ root: externalRoot, kind: 'redis', createdAt: verifiedAt });
      writeArtifactSet({ root: backupRoot, kind: 'firestore', createdAt: verifiedAt });
      fs.symlinkSync(path.join(externalRoot, 'redis'), path.join(backupRoot, 'redis'));

      await expect(runPreflight({
        environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
        now
      })).rejects.toThrow('Diretório de backup redis inválido');
    } finally {
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  test('rejects a receipt older than the admission window', async () => {
    const verifiedAt = '2026-08-02T10:00:00.000Z';
    writeArtifactSet({ root: backupRoot, kind: 'redis', createdAt: verifiedAt });
    writeArtifactSet({ root: backupRoot, kind: 'firestore', createdAt: verifiedAt });

    await expect(runPreflight({
      environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
      now
    })).rejects.toThrow('excede 26 horas');
  });

  test('rejects checksum corruption and an empty restore result', async () => {
    const verifiedAt = '2026-08-03T12:00:00.000Z';
    const redisPath = writeArtifactSet({ root: backupRoot, kind: 'redis', createdAt: verifiedAt });
    writeArtifactSet({
      root: backupRoot,
      kind: 'firestore',
      createdAt: verifiedAt
    });
    fs.appendFileSync(redisPath, 'corruption');

    await expect(runPreflight({
      environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
      now
    })).rejects.toThrow('diverge do manifesto ou checksum');

    fs.rmSync(backupRoot, { recursive: true, force: true });
    fs.mkdirSync(backupRoot, { recursive: true });
    writeArtifactSet({ root: backupRoot, kind: 'redis', createdAt: verifiedAt });
    const emptyFirestorePath = writeArtifactSet({
      root: backupRoot,
      kind: 'firestore',
      createdAt: verifiedAt
    });
    const receiptPath = `${emptyFirestorePath}.verified.json`;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, documentsVerified: 0 })}\n`);

    await expect(runPreflight({
      environment: { ...broadLaunchEnvironment, BACKUP_ROOT: backupRoot },
      now
    })).rejects.toThrow('sem verificação de restore válida');
  });
});

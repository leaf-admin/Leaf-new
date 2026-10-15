#!/usr/bin/env node
'use strict';

/**
 * Copies the newest verified Redis and Firestore backup sets produced by
 * backup-daily.sh to Firebase Storage, so a lost VPS disk does not take the
 * backups with it. Only sets with a `.verified.json` receipt are uploaded.
 *
 * Objects go to `<prefix>/<YYYY-MM-DD>/<file>` in BACKUP_OFFSITE_BUCKET
 * (default FIREBASE_STORAGE_BUCKET). Storage rules deny all client access, so
 * only service accounts can read them. Objects older than
 * BACKUP_OFFSITE_RETENTION_DAYS are pruned under the prefix.
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DEFAULT_PREFIX = 'ops-backups/leaf';
const DEFAULT_RETENTION_DAYS = 30;
const SET_PATTERNS = [
  { kind: 'redis', regex: /^redis-(\d{8}_\d{6})\.rdb\.gz$/ },
  { kind: 'firestore', regex: /^firestore-critical-(\d{8}_\d{6})\.json\.gz$/ }
];
const SIDECAR_SUFFIXES = ['', '.manifest.json', '.sha256', '.verified.json'];

function integerSetting(value, fallback, { min, max }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed < min || parsed > max) throw new Error(`Valor fora do intervalo ${min}-${max}: ${value}`);
  return parsed;
}

/** Newest artifact per kind that has a verification receipt next to it. */
function selectLatestVerifiedSets(backupRoot, listDir = (dir) => fs.readdirSync(dir)) {
  return SET_PATTERNS.map(({ kind, regex }) => {
    const dir = path.join(backupRoot, kind);
    let entries;
    try {
      entries = listDir(dir);
    } catch (error) {
      throw new Error(`Diretório de backup ilegível (${kind}): ${error.message}`);
    }
    const names = new Set(entries);
    const candidates = entries
      .map((name) => ({ name, match: regex.exec(name) }))
      .filter(({ name, match }) => match && names.has(`${name}.verified.json`))
      .sort((a, b) => b.match[1].localeCompare(a.match[1]));
    if (candidates.length === 0) {
      throw new Error(`Nenhum backup verificado encontrado para ${kind} em ${dir}`);
    }
    const { name, match } = candidates[0];
    const stamp = match[1];
    return {
      kind,
      stamp,
      files: SIDECAR_SUFFIXES
        .map((suffix) => `${name}${suffix}`)
        .filter((fileName) => names.has(fileName))
        .map((fileName) => path.join(dir, fileName))
    };
  });
}

function objectNameFor(prefix, stamp, filePath) {
  const day = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  return `${prefix.replace(/\/+$/, '')}/${day}/${path.basename(filePath)}`;
}

/** Objects under the prefix whose day folder is older than the retention window. */
function planPrune(objectNames, prefix, retentionDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const base = `${prefix.replace(/\/+$/, '')}/`;
  return objectNames.filter((name) => {
    if (!name.startsWith(base)) return false;
    const day = name.slice(base.length).split('/')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoffDay;
  });
}

function resolveCredential() {
  const serviceAccountPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  ).trim();
  if (!serviceAccountPath) return admin.credential.applicationDefault();
  return admin.credential.cert(JSON.parse(fs.readFileSync(path.resolve(serviceAccountPath), 'utf8')));
}

async function main() {
  const backupRoot = path.resolve(process.env.BACKUP_ROOT || '/var/backups/leaf');
  const bucketName = String(process.env.BACKUP_OFFSITE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET || '').trim();
  const prefix = String(process.env.BACKUP_OFFSITE_PREFIX || DEFAULT_PREFIX).trim();
  const retentionDays = integerSetting(
    process.env.BACKUP_OFFSITE_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    { min: 1, max: 3650 }
  );
  if (!bucketName) throw new Error('Configure BACKUP_OFFSITE_BUCKET ou FIREBASE_STORAGE_BUCKET');
  if (!prefix || prefix.startsWith('/')) throw new Error('BACKUP_OFFSITE_PREFIX inválido');

  const sets = selectLatestVerifiedSets(backupRoot);
  if (!admin.apps.length) admin.initializeApp({ credential: resolveCredential() });
  const bucket = admin.storage().bucket(bucketName);

  let uploaded = 0;
  let skipped = 0;
  for (const set of sets) {
    for (const filePath of set.files) {
      const file = bucket.file(objectNameFor(prefix, set.stamp, filePath));
      const [exists] = await file.exists();
      if (exists) {
        skipped += 1;
        continue;
      }
      await bucket.upload(filePath, {
        destination: file.name,
        resumable: false,
        validation: 'crc32c',
        metadata: { cacheControl: 'no-store', metadata: { source: 'leaf-backup-daily', kind: set.kind } }
      });
      uploaded += 1;
    }
  }

  const [existing] = await bucket.getFiles({ prefix: `${prefix.replace(/\/+$/, '')}/` });
  const toDelete = planPrune(existing.map((file) => file.name), prefix, retentionDays);
  for (const name of toDelete) {
    await bucket.file(name).delete({ ignoreNotFound: true });
  }

  process.stdout.write(`${JSON.stringify({
    bucket: bucketName,
    prefix,
    sets: sets.map(({ kind, stamp }) => ({ kind, stamp })),
    uploaded,
    skipped,
    pruned: toDelete.length
  })}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[backup-offsite] ${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  objectNameFor,
  planPrune,
  selectLatestVerifiedSets
};

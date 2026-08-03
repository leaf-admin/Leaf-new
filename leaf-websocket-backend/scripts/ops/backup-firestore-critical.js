#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const admin = require('firebase-admin');
const { FieldPath } = require('firebase-admin/firestore');

process.umask(0o077);

const BACKUP_SCHEMA_VERSION = 2;
const MANIFEST_SCHEMA_VERSION = 1;
const TYPE_KEY = '__leafFirestoreType';
const DEFAULT_CRITICAL_COLLECTIONS = Object.freeze([
  'bookings',
  'payment_holdings',
  'payment_history',
  'users',
  'drivers'
]);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function integerSetting(value, fallback, { allowZero = false } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return parsed;
}

function parseCollections(value) {
  const collections = String(value || DEFAULT_CRITICAL_COLLECTIONS.join(','))
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (collections.length === 0) throw new Error('Nenhuma coleção configurada para backup');
  if (new Set(collections).size !== collections.length) {
    throw new Error('Coleções duplicadas na configuração de backup');
  }
  for (const collectionName of collections) {
    if (!/^[A-Za-z0-9_-]+$/.test(collectionName)) {
      throw new Error(`Nome de coleção inválido para backup top-level: ${collectionName}`);
    }
  }
  return collections;
}

function resolveCredential() {
  const serviceAccountPath = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || ''
  ).trim();
  if (!serviceAccountPath) return admin.credential.applicationDefault();
  const absolutePath = path.resolve(serviceAccountPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Service account não encontrada: ${absolutePath}`);
  }
  return admin.credential.cert(JSON.parse(fs.readFileSync(absolutePath, 'utf8')));
}

async function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: resolveCredential() });
  }
  return admin.firestore();
}

function encodeFirestoreValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { [TYPE_KEY]: 'number', value: 'NaN' };
    if (value === Infinity) return { [TYPE_KEY]: 'number', value: 'Infinity' };
    if (value === -Infinity) return { [TYPE_KEY]: 'number', value: '-Infinity' };
    return value;
  }
  if (value instanceof Date) {
    return { [TYPE_KEY]: 'date', iso: value.toISOString() };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { [TYPE_KEY]: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeFirestoreValue);

  const constructorName = String(value?.constructor?.name || '');
  const seconds = value?.seconds ?? value?._seconds;
  const nanoseconds = value?.nanoseconds ?? value?._nanoseconds;
  if (
    constructorName === 'Timestamp' ||
    (Number.isInteger(seconds) && Number.isInteger(nanoseconds) && typeof value?.toDate === 'function')
  ) {
    return { [TYPE_KEY]: 'timestamp', seconds, nanoseconds };
  }
  if (
    constructorName === 'GeoPoint' ||
    (Number.isFinite(value?.latitude) && Number.isFinite(value?.longitude) && constructorName.includes('GeoPoint'))
  ) {
    return { [TYPE_KEY]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (constructorName === 'DocumentReference' && typeof value?.path === 'string') {
    return { [TYPE_KEY]: 'reference', path: value.path };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, encodeFirestoreValue(nestedValue)])
    );
  }
  throw new Error(`Tipo Firestore não serializável: ${typeof value}`);
}

async function dumpCollection(firestore, collectionName, options = {}) {
  const pageSize = integerSetting(options.pageSize, 500);
  const maxDocs = integerSetting(options.maxDocs, 0, { allowZero: true });
  const documentIdFieldPath = options.documentIdFieldPath || FieldPath.documentId();
  const docs = [];
  let lastDocument = null;

  while (true) {
    const remainingBeforeCap = maxDocs > 0 ? maxDocs - docs.length : pageSize;
    const requestedPageSize = Math.min(pageSize, remainingBeforeCap);
    if (requestedPageSize <= 0) {
      throw new Error(
        `Coleção ${collectionName} atingiu FIRESTORE_BACKUP_MAX_DOCS=${maxDocs}; ` +
        'completude não comprovada e backup abortado sem leituras adicionais'
      );
    }
    let query = firestore.collection(collectionName).orderBy(documentIdFieldPath).limit(requestedPageSize);
    if (lastDocument) query = query.startAfter(lastDocument);
    const snapshot = await query.get();
    const page = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
    if (page.length === 0) break;
    for (const document of page) {
      const id = String(document.id || '').trim();
      if (!id) throw new Error(`Documento sem id encontrado em ${collectionName}`);
      docs.push({
        id,
        path: String(document.ref?.path || `${collectionName}/${id}`),
        data: encodeFirestoreValue(document.data())
      });
    }
    if (maxDocs > 0 && docs.length >= maxDocs) {
      throw new Error(
        `Coleção ${collectionName} atingiu FIRESTORE_BACKUP_MAX_DOCS=${maxDocs}; ` +
        'completude não comprovada e backup abortado sem truncar'
      );
    }
    if (page.length < requestedPageSize) break;
    const nextLastDocument = page[page.length - 1];
    if (nextLastDocument === lastDocument) {
      throw new Error(`Paginação não avançou para a coleção ${collectionName}`);
    }
    lastDocument = nextLastDocument;
  }

  return docs;
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeBackupArtifacts(outputPath, payload) {
  const absoluteOutputPath = path.resolve(outputPath);
  if (!/\.json\.gz$/i.test(absoluteOutputPath)) {
    throw new Error('Destino Firestore deve terminar em .json.gz');
  }
  const checksumPath = `${absoluteOutputPath}.sha256`;
  const manifestPath = `${absoluteOutputPath}.manifest.json`;
  for (const candidate of [absoluteOutputPath, checksumPath, manifestPath]) {
    if (fs.existsSync(candidate)) throw new Error(`Destino já existe: ${candidate}`);
  }

  const outputDir = path.dirname(absoluteOutputPath);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);
  const tempDir = fs.mkdtempSync(path.join(outputDir, '.firestore-backup-'));
  const fileName = path.basename(absoluteOutputPath);
  const tempBackupPath = path.join(tempDir, fileName);
  const tempChecksumPath = path.join(tempDir, `${fileName}.sha256`);
  const tempManifestPath = path.join(tempDir, `${fileName}.manifest.json`);

  try {
    const compressed = zlib.gzipSync(`${JSON.stringify(payload)}\n`, { level: 9 });
    const digest = crypto.createHash('sha256').update(compressed).digest('hex');
    const collectionSummary = Object.entries(payload.collections).map(([name, entry]) => ({
      name,
      count: entry.count
    }));
    const manifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      kind: 'leaf-firestore-logical-backup',
      createdAt: payload.generatedAt,
      file: fileName,
      bytes: compressed.length,
      sha256: digest,
      compression: 'gzip',
      backupSchemaVersion: payload.schemaVersion,
      scope: payload.scope,
      collections: collectionSummary,
      totalDocuments: collectionSummary.reduce((sum, entry) => sum + entry.count, 0),
      complete: payload.complete === true
    };

    fs.writeFileSync(tempBackupPath, compressed, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(tempChecksumPath, `${digest}  ${fileName}\n`, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    syncFile(tempBackupPath);
    syncFile(tempChecksumPath);
    syncFile(tempManifestPath);

    fs.renameSync(tempChecksumPath, checksumPath);
    fs.renameSync(tempManifestPath, manifestPath);
    fs.renameSync(tempBackupPath, absoluteOutputPath);
    syncFile(outputDir);

    return {
      outputPath: absoluteOutputPath,
      checksumPath,
      manifestPath,
      bytes: compressed.length,
      sha256: digest,
      totalDocuments: manifest.totalDocuments,
      collections: collectionSummary
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function createBackup({ firestore, collections, pageSize, maxDocs, outputPath }) {
  const payload = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    complete: false,
    scope: {
      kind: 'configured_top_level_collections',
      includesSubcollections: false,
      includesFirebaseStorage: false,
      pageSize,
      maxDocsPerCollection: maxDocs || null
    },
    collections: {}
  };

  for (const collectionName of collections) {
    const docs = await dumpCollection(firestore, collectionName, { pageSize, maxDocs });
    payload.collections[collectionName] = { count: docs.length, docs };
  }
  payload.complete = true;
  return writeBackupArtifacts(outputPath, payload);
}

async function main() {
  const outputPath = argument('--out');
  if (!outputPath) throw new Error('Parâmetro --out obrigatório');
  const pageSize = integerSetting(process.env.FIRESTORE_BACKUP_PAGE_SIZE, 500);
  const maxDocs = integerSetting(process.env.FIRESTORE_BACKUP_MAX_DOCS, 20000, { allowZero: true });
  const collections = parseCollections(process.env.FIRESTORE_BACKUP_COLLECTIONS);
  const firestore = await initFirestore();
  const result = await createBackup({ firestore, collections, pageSize, maxDocs, outputPath });
  process.stdout.write(`${JSON.stringify({ status: 'passed', ...result }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BACKUP_SCHEMA_VERSION,
  DEFAULT_CRITICAL_COLLECTIONS,
  TYPE_KEY,
  createBackup,
  dumpCollection,
  encodeFirestoreValue,
  integerSetting,
  parseCollections,
  writeBackupArtifacts
};

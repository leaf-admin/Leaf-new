#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { BACKUP_SCHEMA_VERSION, TYPE_KEY } = require('./backup-firestore-critical.js');

process.umask(0o077);

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validateEncodedValue(value, location = 'data') {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateEncodedValue(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Valor lógico inválido em ${location}`);
  }

  const encodedType = value[TYPE_KEY];
  if (encodedType) {
    if (encodedType === 'number' && !['NaN', 'Infinity', '-Infinity'].includes(value.value)) {
      throw new Error(`Número especial inválido em ${location}`);
    }
    if (encodedType === 'date' && Number.isNaN(Date.parse(value.iso))) {
      throw new Error(`Data inválida em ${location}`);
    }
    if (
      encodedType === 'timestamp' &&
      (!Number.isInteger(value.seconds) || !Number.isInteger(value.nanoseconds) ||
        value.nanoseconds < 0 || value.nanoseconds > 999999999)
    ) {
      throw new Error(`Timestamp inválido em ${location}`);
    }
    if (
      encodedType === 'geopoint' &&
      (!Number.isFinite(value.latitude) || !Number.isFinite(value.longitude) ||
        value.latitude < -90 || value.latitude > 90 || value.longitude < -180 || value.longitude > 180)
    ) {
      throw new Error(`GeoPoint inválido em ${location}`);
    }
    if (encodedType === 'reference' && !/^\S+\/\S+/.test(String(value.path || ''))) {
      throw new Error(`DocumentReference inválida em ${location}`);
    }
    if (encodedType === 'bytes') {
      const base64 = String(value.base64 || '');
      if (Buffer.from(base64, 'base64').toString('base64') !== base64) {
        throw new Error(`Bytes base64 inválidos em ${location}`);
      }
    }
    if (!['number', 'date', 'timestamp', 'geopoint', 'reference', 'bytes'].includes(encodedType)) {
      throw new Error(`Tipo lógico desconhecido em ${location}: ${encodedType}`);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    validateEncodedValue(nestedValue, `${location}.${key}`);
  }
}

function loadVerifiedFirestoreBackup(backupPath) {
  const absoluteBackupPath = path.resolve(backupPath);
  if (!fs.existsSync(absoluteBackupPath)) throw new Error(`Backup não encontrado: ${absoluteBackupPath}`);
  const manifestPath = `${absoluteBackupPath}.manifest.json`;
  const checksumPath = `${absoluteBackupPath}.sha256`;
  if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) {
    throw new Error('Manifesto e checksum são obrigatórios para o restore drill Firestore');
  }

  const compressed = fs.readFileSync(absoluteBackupPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const checksum = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const digest = sha256(compressed);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'leaf-firestore-logical-backup' ||
    manifest.file !== path.basename(absoluteBackupPath) ||
    manifest.bytes !== compressed.length ||
    manifest.sha256 !== digest ||
    checksum !== digest
  ) {
    throw new Error('Manifesto ou checksum não corresponde ao backup Firestore');
  }
  if (manifest.complete !== true) throw new Error('Manifesto Firestore não declara backup completo');

  const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (payload.schemaVersion !== BACKUP_SCHEMA_VERSION || payload.complete !== true) {
    throw new Error('Payload Firestore incompleto ou com versão incompatível');
  }
  if (
    payload.scope?.kind !== 'configured_top_level_collections' ||
    payload.scope?.includesSubcollections !== false ||
    payload.scope?.includesFirebaseStorage !== false
  ) {
    throw new Error('Escopo lógico Firestore ausente ou inconsistente');
  }

  const manifestCollections = Array.isArray(manifest.collections) ? manifest.collections : [];
  const payloadCollectionNames = Object.keys(payload.collections || {});
  if (manifestCollections.length !== payloadCollectionNames.length) {
    throw new Error('Quantidade de coleções diverge entre manifesto e payload');
  }

  let totalDocuments = 0;
  const manifestCollectionNames = new Set();
  for (const summary of manifestCollections) {
    const collectionName = String(summary.name || '');
    if (!/^[A-Za-z0-9_-]+$/.test(collectionName)) {
      throw new Error(`Nome de coleção top-level inválido no backup: ${collectionName}`);
    }
    if (manifestCollectionNames.has(collectionName)) {
      throw new Error(`Coleção duplicada no manifesto: ${collectionName}`);
    }
    manifestCollectionNames.add(collectionName);
    const entry = payload.collections[collectionName];
    if (!entry || !Array.isArray(entry.docs) || entry.count !== entry.docs.length || entry.count !== summary.count) {
      throw new Error(`Contagem inválida para coleção ${collectionName}`);
    }
    const ids = new Set();
    for (const document of entry.docs) {
      if (!document?.id || String(document.id).includes('/') || ids.has(document.id)) {
        throw new Error(`ID ausente ou duplicado em ${collectionName}`);
      }
      ids.add(document.id);
      if (document.path !== `${collectionName}/${document.id}`) {
        throw new Error(`Caminho inesperado no backup top-level: ${document.path}`);
      }
      validateEncodedValue(document.data, `${document.path}.data`);
    }
    totalDocuments += entry.docs.length;
  }
  if (payloadCollectionNames.some(name => !manifestCollectionNames.has(name))) {
    throw new Error('Coleções divergem entre manifesto e payload');
  }
  if (manifest.totalDocuments !== totalDocuments) {
    throw new Error('Total de documentos diverge do manifesto');
  }

  return {
    manifest,
    payload,
    totalDocuments,
    collectionsVerified: manifestCollections.length,
    backupPath: absoluteBackupPath
  };
}

function verifyFirestoreRestore(backupPath) {
  const verified = loadVerifiedFirestoreBackup(backupPath);
  return {
    status: 'passed',
    verifiedAt: new Date().toISOString(),
    backupPath: verified.backupPath,
    checksumVerified: true,
    manifestVerified: true,
    logicalRestoreDecoded: true,
    collectionsVerified: verified.collectionsVerified,
    documentsVerified: verified.totalDocuments,
    scope: verified.payload.scope
  };
}

function main() {
  const backupPath = argument('--backup');
  if (!backupPath) throw new Error('Parâmetro --backup obrigatório');
  process.stdout.write(`${JSON.stringify(verifyFirestoreRestore(backupPath), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  loadVerifiedFirestoreBackup,
  validateEncodedValue,
  verifyFirestoreRestore
};

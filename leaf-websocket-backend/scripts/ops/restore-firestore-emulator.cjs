#!/usr/bin/env node
'use strict';

const assert = require('assert');
const admin = require('firebase-admin');
const { GeoPoint, Timestamp } = require('firebase-admin/firestore');
const {
  TYPE_KEY,
  encodeFirestoreValue
} = require('./backup-firestore-critical.js');
const {
  loadVerifiedFirestoreBackup
} = require('./verify-firestore-restore.cjs');

const EMULATOR_CONFIRMATION = 'RESTORE_TO_LOCAL_FIRESTORE_EMULATOR';
const WRITE_BATCH_SIZE = 400;
const READ_BATCH_SIZE = 200;

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function assertEmulatorTarget({ emulatorHost, projectId, confirmation }) {
  const host = String(emulatorHost || '').trim();
  const project = String(projectId || '').trim();
  if (confirmation !== EMULATOR_CONFIRMATION) {
    throw new Error(`Confirmação obrigatória: ${EMULATOR_CONFIRMATION}`);
  }
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(host)) {
    throw new Error('FIRESTORE_EMULATOR_HOST deve apontar para loopback com porta explícita');
  }
  const port = Number.parseInt(host.slice(host.lastIndexOf(':') + 1), 10);
  if (port > 65535) throw new Error('Porta inválida em FIRESTORE_EMULATOR_HOST');
  if (!/^demo-[a-z0-9][a-z0-9-]*$/.test(project)) {
    throw new Error('Restore permitido somente em project id local iniciado por demo-');
  }
  return { emulatorHost: host, projectId: project };
}

function decodeFirestoreValue(value, firestore) {
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(item => decodeFirestoreValue(item, firestore));
  if (!value || typeof value !== 'object') throw new Error('Valor lógico Firestore inválido');

  switch (value[TYPE_KEY]) {
    case undefined:
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, decodeFirestoreValue(nested, firestore)])
      );
    case 'number':
      return { NaN: Number.NaN, Infinity, '-Infinity': -Infinity }[value.value];
    case 'date':
      return new Date(value.iso);
    case 'timestamp':
      return new Timestamp(value.seconds, value.nanoseconds);
    case 'geopoint':
      return new GeoPoint(value.latitude, value.longitude);
    case 'reference':
      return firestore.doc(value.path);
    case 'bytes':
      return Buffer.from(value.base64, 'base64');
    default:
      throw new Error(`Tipo lógico Firestore desconhecido: ${value[TYPE_KEY]}`);
  }
}

function canonicalizeEncodedValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeEncodedValue);
  if (!value || typeof value !== 'object') return value;
  if (value[TYPE_KEY] === 'date') {
    const milliseconds = Date.parse(value.iso);
    const seconds = Math.floor(milliseconds / 1000);
    return {
      [TYPE_KEY]: 'timestamp',
      seconds,
      nanoseconds: (milliseconds - (seconds * 1000)) * 1000000
    };
  }
  if (value[TYPE_KEY]) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, canonicalizeEncodedValue(nested)])
  );
}

function documentsFromPayload(payload) {
  return Object.values(payload.collections).flatMap(entry => entry.docs);
}

async function readSnapshots(firestore, references) {
  const snapshots = [];
  for (let index = 0; index < references.length; index += READ_BATCH_SIZE) {
    snapshots.push(...await firestore.getAll(...references.slice(index, index + READ_BATCH_SIZE)));
  }
  return snapshots;
}

async function restoreFirestoreEmulator({ backupPath, emulatorHost, projectId, confirmation }) {
  const target = assertEmulatorTarget({ emulatorHost, projectId, confirmation });
  const verified = loadVerifiedFirestoreBackup(backupPath);
  const appName = `leaf-firestore-restore-${process.pid}-${Date.now()}`;
  const previousEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = target.emulatorHost;
  let app;

  try {
    app = admin.initializeApp({ projectId: target.projectId }, appName);
    const firestore = app.firestore();
    const documents = documentsFromPayload(verified.payload);
    const references = documents.map(document => firestore.doc(document.path));
    const existing = await readSnapshots(firestore, references);
    const collision = existing.find(snapshot => snapshot.exists);
    if (collision) {
      throw new Error(`Restore recusado: documento de destino já existe (${collision.ref.path})`);
    }

    for (let index = 0; index < documents.length; index += WRITE_BATCH_SIZE) {
      const batch = firestore.batch();
      for (const document of documents.slice(index, index + WRITE_BATCH_SIZE)) {
        batch.create(
          firestore.doc(document.path),
          decodeFirestoreValue(document.data, firestore)
        );
      }
      await batch.commit();
    }

    const restored = await readSnapshots(firestore, references);
    for (let index = 0; index < documents.length; index += 1) {
      const snapshot = restored[index];
      if (!snapshot?.exists) throw new Error(`Documento não restaurado: ${documents[index].path}`);
      assert.deepStrictEqual(
        canonicalizeEncodedValue(encodeFirestoreValue(snapshot.data())),
        canonicalizeEncodedValue(documents[index].data),
        `Conteúdo restaurado diverge em ${documents[index].path}`
      );
    }

    return {
      status: 'passed',
      target: 'local-firestore-emulator',
      emulatorHost: target.emulatorHost,
      projectId: target.projectId,
      checksumVerified: true,
      manifestVerified: true,
      overwriteGuardVerified: true,
      collectionsRestored: verified.collectionsVerified,
      documentsRestored: verified.totalDocuments,
      readBackVerified: true
    };
  } finally {
    try {
      if (app) await app.delete();
    } finally {
      if (previousEmulatorHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = previousEmulatorHost;
    }
  }
}

async function main() {
  const backupPath = argument('--backup');
  if (!backupPath) throw new Error('Parâmetro --backup obrigatório');
  const result = await restoreFirestoreEmulator({
    backupPath,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    projectId: argument('--project-id', process.env.GCLOUD_PROJECT),
    confirmation: argument('--confirm-emulator')
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EMULATOR_CONFIRMATION,
  assertEmulatorTarget,
  canonicalizeEncodedValue,
  decodeFirestoreValue,
  restoreFirestoreEmulator
};

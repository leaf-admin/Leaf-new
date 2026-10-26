#!/usr/bin/env node
'use strict';

// RTDB exit: move RTDB roots into native Firestore collections (the layout of
// services/rtdb-root-router.js with RTDB_FIRESTORE_NATIVE_COLLECTIONS).
//
// - Canonical collections (`root:collection:merge`, e.g. users, subscriptions):
//   consolidate RTDB into the existing Firestore document. Deep union of
//   fields; on a value conflict the record with the newer `updatedAt` wins
//   (tie: Firestore). Firestore-only fields and Timestamps are kept.
// - Other roots: exact copy of each RTDB record; documents not in RTDB are
//   deleted.
// Dry-run by default (reports every conflict and the winner); --apply needs --ref.
//
//   RTDB_FIRESTORE_NATIVE_COLLECTIONS=... node scripts/maintenance/migrate-rtdb-roots-native.cjs --roots users [--apply --ref <maintenance-ref>]
const { isDeepStrictEqual } = require('node:util');
const { createRouter, normalize } = require('../../services/rtdb-root-router');

function parseArgs(argv) {
  const args = { roots: [], apply: false, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--roots') args.roots = String(argv[++i] || '').split(',').map(r => r.trim()).filter(Boolean);
    else if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!args.roots.length) throw new Error('--roots é obrigatório');
  if (args.apply && !String(args.ref || '').trim()) throw new Error('--apply exige --ref com a referência da manutenção');
  return args;
}

const time = value => { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : -Infinity; };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Deep union; leaf conflicts go to `preferRtdb ? rtdb : firestore`.
function mergeRecords(firestoreView, rtdbValue, preferRtdb, path, conflicts) {
  if (isObject(firestoreView) && isObject(rtdbValue)) {
    const result = { ...firestoreView };
    for (const [key, value] of Object.entries(rtdbValue)) {
      result[key] = key in firestoreView
        ? mergeRecords(firestoreView[key], value, preferRtdb, `${path}/${key}`, conflicts)
        : value;
    }
    return result;
  }
  if (firestoreView === undefined || firestoreView === null) return rtdbValue;
  if (isDeepStrictEqual(firestoreView, rtdbValue)) return firestoreView;
  conflicts.push({ path, winner: preferRtdb ? 'rtdb' : 'firestore' });
  return preferRtdb ? rtdbValue : firestoreView;
}

async function run({ roots, apply, ref }, { rawDb, firestore, env, log = console.log }) {
  const router = createRouter(rawDb, { getFirestore: () => firestore, env: { ...env, RTDB_FIRESTORE_WRITE_ROOTS: roots.join(',') } });
  const internals = router.__rtdbRootRouter;
  const summary = { apply, ref: ref || null, roots: {}, parityMismatch: 0 };
  for (const root of roots) {
    const native = internals?.nativeOf(root);
    if (!native) throw new Error(`Raiz sem mapeamento nativo em RTDB_FIRESTORE_NATIVE_COLLECTIONS: ${root}`);
    const collection = firestore.collection(native.collection);
    const stats = { collection: native.collection, merge: native.merge, records: 0, equal: 0, written: 0, toWrite: 0,
      created: 0, extraDeleted: 0, extra: 0, skipped: [], conflicts: [], parity: 0, problems: [] };
    const source = normalize((await rawDb.ref(root).once('value')).val()) || {};
    const existingIds = new Set((await collection.select().get()).docs.map(doc => doc.id));
    for (const [key, rtdbValue] of Object.entries(source)) {
      stats.records += 1;
      if (native.merge && (!isObject(rtdbValue) || Object.keys(rtdbValue).length < 2)) { stats.skipped.push(key); continue; }
      try {
        const snapshot = await collection.doc(key).get();
        const raw = snapshot.exists ? snapshot.data() : null;
        const currentView = internals.decode(root, raw);
        let target = rtdbValue;
        if (native.merge && currentView) {
          const preferRtdb = time(rtdbValue?.updatedAt) > time(currentView?.updatedAt);
          const conflicts = [];
          target = mergeRecords(currentView, rtdbValue, preferRtdb, `${root}/${key}`, conflicts);
          stats.conflicts.push(...conflicts);
        }
        if (isDeepStrictEqual(currentView, target)) { stats.equal += 1; continue; }
        if (!apply) { stats.toWrite += 1; continue; }
        await firestore.runTransaction(async tx => {
          const fresh = await tx.get(collection.doc(key));
          internals.writeRecord(tx, root, key, fresh.exists ? fresh.data() : null, target, { keepAbsent: native.merge });
        });
        if (!raw) stats.created += 1;
        stats.written += 1;
        const after = internals.decode(root, (await collection.doc(key).get()).data());
        if (!isDeepStrictEqual(after, target)) { stats.parity += 1; stats.problems.push({ key, problem: 'parity_mismatch' }); }
      } catch (error) {
        stats.problems.push({ key, problem: `${error.code || ''} ${error.message}`.trim().slice(0, 140) });
      }
    }
    if (!native.merge) {
      for (const id of existingIds) {
        if (id in source) continue;
        if (!apply) { stats.extra += 1; continue; }
        await collection.doc(id).delete();
        stats.extraDeleted += 1;
      }
    }
    if (!apply) summary.parityMismatch += stats.toWrite + stats.extra;
    summary.parityMismatch += stats.parity + stats.problems.length;
    stats.conflicts = stats.conflicts.slice(0, 60);
    stats.problems = stats.problems.slice(0, 20);
    summary.roots[root] = stats;
  }
  log(JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const admin = require('firebase-admin');
    const firebaseConfig = require('../../firebase-config');
    await firebaseConfig.initializeFirebase?.();
    // RTDB is read raw: it is the copy source, never routed here.
    const summary = await run(args, { rawDb: admin.database(), firestore: firebaseConfig.getFirestore(), env: process.env });
    process.exit(summary.parityMismatch ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run, mergeRecords };

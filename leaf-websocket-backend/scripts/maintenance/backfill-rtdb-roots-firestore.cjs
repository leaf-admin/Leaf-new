#!/usr/bin/env node
'use strict';

// RTDB exit: copy whole RTDB roots into the Firestore layout used by
// services/rtdb-root-router.js (`rtdb_<root>/<key>` = { schema, json }) and
// verify parity record by record. Dry-run by default; --apply requires --ref.
//
//   node scripts/maintenance/backfill-rtdb-roots-firestore.cjs --roots vehicles,user_vehicles [--apply --ref <maintenance-ref>]
//
// Extra Firestore records (not in RTDB) are deleted on --apply so the copy is
// exact; a second dry-run must report everything equal.
const { isDeepStrictEqual } = require('node:util');
const { collectionFor, normalize } = require('../../services/rtdb-root-router');

function parseArgs(argv) {
  const args = { roots: [], apply: false, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--roots') args.roots = String(argv[++i] || '').split(',').map(r => r.trim()).filter(Boolean);
    else if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!args.roots.length) throw new Error('--roots é obrigatório');
  if (args.roots.some(root => !/^[A-Za-z0-9_-]+$/.test(root))) throw new Error('--roots só aceita nomes de raiz simples');
  if (args.apply && !String(args.ref || '').trim()) throw new Error('--apply exige --ref com a referência da manutenção');
  return args;
}

async function run({ roots, apply, ref }, { rawDb, firestore, log = console.log }) {
  const summary = { apply, ref: ref || null, roots: {}, parityMismatch: 0 };
  for (const root of roots) {
    const stats = { rtdbRecords: 0, equal: 0, written: 0, toWrite: 0, extraDeleted: 0, extra: 0, bytes: 0, problems: [] };
    const source = normalize((await rawDb.ref(root).once('value')).val()) || {};
    const docs = await firestore.collection(collectionFor(root)).get();
    const current = new Map(docs.docs.map(doc => [doc.id, JSON.parse(doc.data().json)]));
    for (const [key, value] of Object.entries(source)) {
      stats.rtdbRecords += 1;
      const json = JSON.stringify(value);
      stats.bytes += Buffer.byteLength(json);
      if (isDeepStrictEqual(current.get(key), value)) { stats.equal += 1; continue; }
      if (!apply) { stats.toWrite += 1; continue; }
      try {
        await firestore.collection(collectionFor(root)).doc(key).set({ schema: 1, json, updatedAt: new Date().toISOString() });
        stats.written += 1;
      } catch (error) {
        stats.problems.push({ key, problem: error.message.slice(0, 120) });
      }
    }
    for (const key of current.keys()) {
      if (key in source) continue;
      if (!apply) { stats.extra += 1; continue; }
      await firestore.collection(collectionFor(root)).doc(key).delete();
      stats.extraDeleted += 1;
    }
    if (!apply) summary.parityMismatch += stats.toWrite + stats.extra;
    summary.parityMismatch += stats.problems.length;
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
    // Always the raw RTDB client: the copy source must not be routed.
    const summary = await run(args, { rawDb: admin.database(), firestore: firebaseConfig.getFirestore() });
    process.exit(summary.parityMismatch ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run };

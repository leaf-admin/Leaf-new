#!/usr/bin/env node
'use strict';

// RTDB exit, step 1: copy persisted RTDB receipts into the Firestore receipt
// store and verify parity. Dry-run by default; --apply requires --ref.
//
//   node scripts/maintenance/backfill-receipts-firestore.cjs --collection receipts [--apply --ref <maintenance-ref>]
//
// Capacity/E2E fixtures (ids containing "capacity" or "e2e_") are skipped and
// counted. A receipt whose sealed context does not belong to the collection is
// reported, never written.
const { isDeepStrictEqual } = require('node:util');
const firebaseConfig = require('../../firebase-config');
const ReceiptService = require('../../services/receipt-service');
const store = require('../../services/receipt-firestore-store');
const { resolveRidePersistenceScope } = require('../../services/sandbox-persistence-context');

const PAGE_SIZE = 100;
const TEST_FIXTURE = /capacity|e2e_/i;

function parseArgs(argv) {
  const args = { collection: null, apply: false, ref: null, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--collection') args.collection = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number.parseInt(argv[++i], 10);
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (!['receipts', 'sandbox_receipts'].includes(args.collection)) throw new Error('--collection deve ser receipts ou sandbox_receipts');
  if (args.apply && !String(args.ref || '').trim()) throw new Error('--apply exige --ref com a referência da manutenção');
  return args;
}

async function run({ collection, apply, ref, limit }, { db, firestore, service = new ReceiptService(), log = console.log } = {}) {
  const options = { ownerOf: service.resolveStoredReceiptOwnerId.bind(service), timestampOf: service.resolveStoredReceiptTimestamp.bind(service) };
  const stats = { collection, apply, ref: ref || null, scanned: 0, skippedFixtures: 0, written: 0, alreadyEqual: 0,
    wouldWrite: 0, scopeMismatch: 0, parityMismatch: 0, errors: 0, bytes: 0, problems: [] };
  let lastKey = null;
  while (stats.scanned < limit) {
    let query = db.ref(collection).orderByKey();
    if (lastKey) query = query.startAfter(lastKey);
    const page = (await query.limitToFirst(PAGE_SIZE).once('value')).val() || {};
    const keys = Object.keys(page).sort();
    if (!keys.length) break;
    for (const key of keys) {
      if (stats.scanned >= limit) break;
      lastKey = key;
      stats.scanned += 1;
      if (TEST_FIXTURE.test(key)) { stats.skippedFixtures += 1; continue; }
      const receipt = { ...page[key], rideId: page[key]?.rideId || key };
      try {
        const scope = resolveRidePersistenceScope(receipt);
        if (scope.collections.receipts !== collection) {
          stats.scopeMismatch += 1;
          stats.problems.push({ key, problem: 'scope_mismatch' });
          continue;
        }
        const { document } = store.buildDocument(receipt, scope, options);
        stats.bytes += Buffer.byteLength(JSON.stringify(document));
        const existing = await store.getByRideId(firestore, scope, receipt.rideId);
        const expected = JSON.parse(JSON.stringify(receipt));
        if (existing && isDeepStrictEqual(existing, expected)) { stats.alreadyEqual += 1; continue; }
        if (!apply) { stats.wouldWrite += 1; continue; }
        await store.write(firestore, receipt, scope, options);
        const after = await store.getByRideId(firestore, scope, receipt.rideId);
        if (!isDeepStrictEqual(after, expected)) {
          stats.parityMismatch += 1;
          stats.problems.push({ key, problem: 'parity_mismatch' });
          continue;
        }
        stats.written += 1;
      } catch (error) {
        stats.errors += 1;
        stats.problems.push({ key, problem: error.code || error.message });
      }
    }
    if (keys.length < PAGE_SIZE) break;
  }
  stats.problems = stats.problems.slice(0, 50);
  log(JSON.stringify(stats));
  return stats;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    await firebaseConfig.initializeFirebase?.();
    const db = firebaseConfig.getRealtimeDB();
    const firestore = firebaseConfig.getFirestore();
    if (!db || !firestore) throw new Error('RTDB e Firestore são obrigatórios');
    const stats = await run(args, { db, firestore });
    process.exit(stats.errors || stats.parityMismatch || stats.scopeMismatch ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run, TEST_FIXTURE };

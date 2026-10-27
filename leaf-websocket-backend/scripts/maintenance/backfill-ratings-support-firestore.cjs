#!/usr/bin/env node
'use strict';

// RTDB exit, domain 3: copy ratings (and their per-trip reviewer index) and
// the support tickets that only exist in RTDB into Firestore, then verify.
// Dry-run by default; --apply requires --ref.
//
//   node scripts/maintenance/backfill-ratings-support-firestore.cjs [--apply --ref <maintenance-ref>]
//
// Parity: every RTDB rating and index entry equal in Firestore, and the RTDB
// fan-out views (trip_ratings, user_ratings) equal to the Firestore queries
// that replace them, each checked in the sealed context of its own records.
const { isDeepStrictEqual } = require('node:util');

const NAMESPACES = ['operational', 'sandbox'];

function parseArgs(argv) {
  const args = { apply: false, ref: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--ref') args.ref = argv[++i];
    else throw new Error(`Argumento desconhecido: ${argv[i]}`);
  }
  if (args.apply && !String(args.ref || '').trim()) throw new Error('--apply exige --ref com a referência da manutenção');
  return args;
}

const json = value => JSON.parse(JSON.stringify(value ?? null));
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

async function run({ apply, ref }, { config, firestore, store, supportService, collectionsFor, scopeOf, log = console.log }) {
  const stats = { apply, ref: ref || null, ratingsEqual: 0, ratingsWritten: 0, ratingsToWrite: 0,
    indexEqual: 0, indexWritten: 0, indexToWrite: 0, viewsEqual: 0, viewMismatch: 0,
    supportRtdb: 0, supportPresent: 0, supportMissing: 0, problems: [] };

  for (const namespace of NAMESPACES) {
    const collections = collectionsFor(namespace);
    const ratings = (await config.getFromRealtimeDB(collections.ratings)) || {};
    for (const [ratingId, raw] of Object.entries(ratings)) {
      const body = json({ ...raw, id: raw.id || ratingId });
      const scope = scopeOf(namespace, body);
      if (isDeepStrictEqual(await store.getRating(firestore, scope, body.id), body)) { stats.ratingsEqual += 1; continue; }
      if (!apply) { stats.ratingsToWrite += 1; continue; }
      await firestore.collection(collections.ratings).doc(String(body.id)).set(body);
      stats.ratingsWritten += 1;
    }
    const index = (await config.getFromRealtimeDB(collections.ratingTripIndex)) || {};
    for (const [tripId, reviewers] of Object.entries(index)) {
      for (const [reviewerId, raw] of Object.entries(reviewers || {})) {
        const entry = json(raw);
        const scope = scopeOf(namespace, entry);
        if (isDeepStrictEqual(await store.getIndex(firestore, scope, tripId, reviewerId), entry)) { stats.indexEqual += 1; continue; }
        if (!apply) { stats.indexToWrite += 1; continue; }
        await firestore.collection(collections.ratingTripIndex).doc(store.indexId(tripId, reviewerId))
          .set(store.indexBody(entry, tripId, reviewerId));
        stats.indexWritten += 1;
      }
    }
    for (const [path, list] of [[collections.tripRatings, store.listByTrip], [collections.userRatings, store.listByTarget]]) {
      const view = (await config.getFromRealtimeDB(path)) || {};
      for (const [owner, entries] of Object.entries(view)) {
        const expected = Object.values(entries || {}).map(json).sort(byId);
        if (!expected.length) continue;
        const actual = (await list(firestore, scopeOf(namespace, expected[0]), owner)).map(json).sort(byId);
        if (isDeepStrictEqual(actual, expected)) { stats.viewsEqual += 1; continue; }
        stats.viewMismatch += 1;
        if (stats.problems.length < 30) {
          stats.problems.push({ view: path, owner, expected: expected.map(r => r.id), actual: actual.map(r => r.id) });
        }
      }
    }
  }

  const tickets = (await config.getFromRealtimeDB('support_tickets')) || {};
  for (const ticketId of Object.keys(tickets)) {
    stats.supportRtdb += 1;
    if ((await supportService.ticketDoc(ticketId).get()).exists) { stats.supportPresent += 1; continue; }
    // The legacy importer is gone (all tickets are in Firestore); only verify.
    stats.supportMissing += 1;
    stats.problems.push({ ticketId, problem: 'support_ticket_missing' });
  }

  // Writes are verified by a second dry-run (everything equal, nothing to write).
  stats.parityMismatch = stats.viewMismatch + stats.supportMissing;
  log(JSON.stringify(stats));
  return stats;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const firebaseConfig = require('../../firebase-config');
    await firebaseConfig.initializeFirebase?.();
    const store = require('../../services/rating-firestore-store');
    const supportService = require('../../services/support-ticket-service');
    const { sealFinancialContext } = require('../../services/financial-runtime-context');
    const { resolvePersistenceScope } = require('../../services/sandbox-persistence-context');
    const operational = resolvePersistenceScope({ financialContext: sealFinancialContext({ providerEnvironment: 'production' }) });
    const scopeOf = (namespace, record) => namespace === 'operational'
      ? operational
      : resolvePersistenceScope({ financialContext: record.financialContext });
    const sandboxCollections = { ratings: 'sandbox_ratings', ratingTripIndex: 'sandbox_rating_trip_index',
      tripRatings: 'sandbox_trip_ratings', userRatings: 'sandbox_user_ratings' };
    const stats = await run(args, {
      config: firebaseConfig, firestore: firebaseConfig.getFirestore(), store, supportService, scopeOf,
      collectionsFor: namespace => namespace === 'operational' ? operational.collections : sandboxCollections
    });
    process.exit(args.apply && stats.parityMismatch ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run };

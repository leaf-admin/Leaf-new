#!/usr/bin/env node
'use strict';

// RTDB exit, domain 2: copy admin operational configs (city activation,
// geofence) from RTDB into Firestore `operational_configs` and verify parity.
// Dry-run by default; --apply requires --ref.
//
//   node scripts/maintenance/backfill-ops-configs-firestore.cjs [--apply --ref <maintenance-ref>]
const { isDeepStrictEqual } = require('node:util');
const firebaseConfig = require('../../firebase-config');
const store = require('../../services/ops-config-store');

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

async function run({ apply, ref }, { config = firebaseConfig, log = console.log } = {}) {
  const results = [];
  for (const [key, { rtdbPath }] of Object.entries(store.CONFIGS)) {
    const source = store.clean(await config.getFromRealtimeDB(rtdbPath));
    const current = await store.readFirestore(config, key);
    const result = { key, rtdbPresent: Boolean(source), equal: isDeepStrictEqual(current, source), written: false };
    if (source && !result.equal && apply) {
      await store.writeFirestore(config, key, source);
      result.written = true;
      result.equal = isDeepStrictEqual(await store.readFirestore(config, key), source);
    }
    results.push(result);
  }
  const summary = { apply, ref: ref || null, results, parityMismatch: results.filter(r => r.rtdbPresent && !r.equal).length };
  log(JSON.stringify(summary));
  return summary;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    await firebaseConfig.initializeFirebase?.();
    const summary = await run(args);
    process.exit(args.apply && summary.parityMismatch ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run };

#!/usr/bin/env node
'use strict';

// RTDB exit safety check: for every driver (vehicle links, activation or a
// driver profile in users), resolve the
// canonical activation state (the gate used to go online) reading plain RTDB
// and reading through the root router with the given roots served by
// Firestore. Any difference blocks the read switch. Read-only.
//
//   node scripts/maintenance/verify-driver-gate-parity.cjs --roots vehicles,user_vehicles,vehicle_plate_index
const { isDeepStrictEqual } = require('node:util');

function parseArgs(argv) {
  const index = argv.indexOf('--roots');
  const roots = index >= 0 ? String(argv[index + 1] || '').split(',').map(r => r.trim()).filter(Boolean) : [];
  if (!roots.length) throw new Error('--roots é obrigatório');
  return { roots };
}

// The evaluation timestamp (updatedAt = now) is not part of the decision.
function decision(state) {
  const clone = JSON.parse(JSON.stringify(state || null));
  if (clone && typeof clone === 'object') delete clone.updatedAt;
  return clone;
}

async function run({ roots }, { rawDb, routedDb, resolve, driverIds, log = console.log }) {
  const result = { roots, drivers: driverIds.length, equal: 0, different: 0, errors: 0, problems: [] };
  for (const driverId of driverIds) {
    try {
      const [plain, served] = await Promise.all([
        resolve({ driverId, db: rawDb }),
        resolve({ driverId, db: routedDb })
      ]);
      if (isDeepStrictEqual(decision(plain), decision(served))) result.equal += 1;
      else {
        result.different += 1;
        result.problems.push({ driverId, rtdb: plain?.state ?? null, firestore: served?.state ?? null });
      }
    } catch (error) {
      result.errors += 1;
      result.problems.push({ driverId, error: error.message.slice(0, 160) });
    }
  }
  log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    const admin = require('firebase-admin');
    const firebaseConfig = require('../../firebase-config');
    await firebaseConfig.initializeFirebase?.();
    const { createRouter } = require('../../services/rtdb-root-router');
    const { resolveDriverActivationState } = require('../../services/driver-activation-state-service');
    const rawDb = admin.database();
    const roots = args.roots.join(',');
    const routedDb = createRouter(rawDb, { getFirestore: () => firebaseConfig.getFirestore(),
      env: { RTDB_FIRESTORE_WRITE_ROOTS: roots, RTDB_FIRESTORE_READ_ROOTS: roots } });
    const linked = Object.keys((await rawDb.ref('user_vehicles').once('value')).val() || {});
    const activated = Object.keys((await rawDb.ref('driver_activation').once('value')).val() || {});
    const users = (await rawDb.ref('users').once('value')).val() || {};
    const driverUsers = Object.entries(users)
      .filter(([, user]) => String(user?.usertype || user?.userType || '').toLowerCase() === 'driver')
      .map(([id]) => id);
    const driverIds = [...new Set([...linked, ...activated, ...driverUsers])];
    const result = await run(args, { rawDb, routedDb, resolve: resolveDriverActivationState, driverIds });
    process.exit(result.different || result.errors ? 2 : 0);
  })().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { parseArgs, run, decision };

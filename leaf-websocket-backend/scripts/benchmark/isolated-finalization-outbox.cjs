'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

module.exports = function loadOutbox(redis) {
  const module = { exports: {} };
  const rejectScope = () => { throw new Error('No financial context/provider access allowed in outbox experiment'); };
  const safeRequire = name => {
    if (name === './metrics-projection-store') return { enabled: () => false, drain: async () => ({ processed: 0, failed: 0, skipped: true }) };
    if (name === '../utils/logger') return { logger: { info() {}, warn() {}, error() {}, debug() {} } };
    if (name === '../utils/redis-pool') return { getConnection: () => redis };
    if (name === '../firebase-config') return { getFirestore: () => null };
    if (name === 'firebase-admin') return {};
    if (name === './sandbox-persistence-context') return { resolveRidePersistenceScope: rejectScope, assertStoredRecordMatchesScope: rejectScope };
    if (name === './driver-intro-fee-service') return { flushPendingCheckpoints: async () => ({ processed: 0, failed: 0 }) };
    throw new Error(`Unapproved outbox experiment import: ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../services/ride-persistence-service.js'), 'utf8'), {
    module, exports: module.exports, require: safeRequire, process: { env: {} }, Buffer, Date, Map, Set, console
  }, { filename: 'isolated-finalization-outbox.js' });
  return module.exports;
};

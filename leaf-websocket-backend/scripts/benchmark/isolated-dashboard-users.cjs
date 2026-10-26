'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

module.exports = function loadUsers(firestore) {
  const module = { exports: {} };
  const safeRequire = name => {
    if (name === 'firebase-admin') return { firestore: () => firestore };
    if (name === 'node:crypto') return require(name);
    if (name === '../utils/bounded-ttl-cache') return require('../../utils/bounded-ttl-cache');
    if (name === '../utils/logger') return { logError() {} };
    if (name === './audit-service') return { logEvent() { throw new Error('Mutations forbidden in list benchmark'); } };
    throw new Error(`Unapproved users benchmark import: ${name}`);
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../services/dashboard-user-service.js'), 'utf8'), {
    module, exports: module.exports, require: safeRequire, Date, Buffer, Set, Map,
    process: { env: { ENABLE_ADMIN_USER_CURSOR_READS: 'true' } }, console
  }, { filename: 'isolated-dashboard-user-service.js' });
  return module.exports;
};

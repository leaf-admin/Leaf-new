'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const backend = path.resolve(__dirname, '../..');

module.exports = function loadGpsService(redis, firestore, { sourceRef = null } = {}) {
  if (sourceRef && !/^[a-f0-9]{7,40}$/.test(sourceRef)) throw new Error('Local SHA required');
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const safeRequire = name => {
      if (name === '../utils/redis-pool') return { ensureConnection: async () => {}, getConnection: () => redis };
      if (name === '../firebase-config') return { getFirestore: () => firestore };
      if (name === 'firebase-admin') return { firestore: { FieldValue: { serverTimestamp: () => 'synthetic-server-timestamp' } } };
      if (name === '../utils/logger') return { logStructured() {}, logError() {} };
      if (name === './safety-signal-service') return { record() {} };
      if (name === './payment-runtime-profile-service') return { resolveProfile() { throw new Error('External profile access forbidden in local GPS test'); } };
      if (['crypto', 'node:crypto'].includes(name)) return require(name);
      if (['./financial-runtime-context', './sandbox-persistence-context', './route-toll-service', '../utils/trip-location-buffer-ops'].includes(name)) {
        return load(path.resolve(path.dirname(file), `${name}.js`));
      }
      throw new Error(`Unapproved GPS benchmark import: ${name}`);
    };
    const source = sourceRef && file === path.join(backend, 'services/trip-location-persistence-service.js')
      ? execFileSync('git', ['show', `${sourceRef}:leaf-websocket-backend/services/trip-location-persistence-service.js`],
        { cwd: path.dirname(backend), encoding: 'utf8' }) : fs.readFileSync(file, 'utf8');
    vm.runInNewContext(source, { module, exports: module.exports,
      require: safeRequire, process: { env: {}, pid: process.pid }, Date, Buffer, Set, Map, console }, { filename: file });
    return module.exports;
  }
  return load(path.join(backend, 'services/trip-location-persistence-service.js'));
};

'use strict';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const backend = path.resolve(__dirname, '../..');

module.exports = function loadH3Service({ baseline = false } = {}) {
  const module = { exports: {} };
  const safeRequire = name => {
    if (name === 'h3-js') return require(name);
    if (name === '../utils/bounded-ttl-cache') return require('../../utils/bounded-ttl-cache');
    if (name === './map-regional-index') return require('../../services/map-regional-index');
    if (name === '../utils/logger') return { logStructured() {} };
    if (name === '../utils/prometheus-metrics') return { metrics: new Proxy({}, { get: () => () => {} }) };
    if (name === './dashboard-live-data-service') return { normalizeDriverStatus: (status, online) => online ? status : 'offline' };
    if (name === './booking-search-index') return { INDEX_KEY: 'index:booking_search', listSearchKeys() { throw new Error('Global search list forbidden'); } };
    if (name === './pricing/demandPressure') return require('../../services/pricing/demandPressure');
    if (name === './pricing/nightSurcharge') return require('../../services/pricing/nightSurcharge');
    throw new Error(`Unapproved H3 benchmark import: ${name}`);
  };
  const source = baseline ? execFileSync('git', ['show', '794edfcb7:leaf-websocket-backend/services/h3-map-service.js'],
    { cwd: path.dirname(backend), encoding: 'utf8' }) : fs.readFileSync(path.join(backend, 'services/h3-map-service.js'), 'utf8');
  vm.runInNewContext(source, {
    module, exports: module.exports, require: safeRequire, process: { env: {} }, Date, Buffer, Map, Set,
    console }, { filename: 'isolated-h3-map-service.js' });
  return new module.exports.H3MapService();
};

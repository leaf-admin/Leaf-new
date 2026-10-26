'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const backend = path.resolve(__dirname, '../..');

module.exports = function loadReceiptService() {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const safeRequire = name => {
      if (name === 'crypto') return require(name);
      if (name === 'pdfkit' || name === './payment-service') return class InactiveAdapter {};
      if (name === '../utils/logger') return { logger: { info() {}, warn() {}, error() {} } };
      if (name === './receipt-history-index') return require('../../services/receipt-history-index');
      if (name === './driver-intro-fee-service') return { acceptedContext() { throw new Error('Fee calculation is outside local history test'); } };
      if (name === './payment-runtime-profile-service') return { resolveProfile() { throw new Error('External profile access forbidden'); } };
      if (['./financial-runtime-context', './sandbox-persistence-context'].includes(name)) return load(path.resolve(path.dirname(file), `${name}.js`));
      throw new Error(`Unapproved receipt benchmark import: ${name}`);
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: safeRequire,
      process: { env: {} }, Date, Buffer, Set, Map, console }, { filename: file });
    return module.exports;
  }
  const ReceiptService = load(path.join(backend, 'services/receipt-service.js'));
  return new ReceiptService();
};

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

// Execute the actual client with networking/adapters replaced, without a login.
const file = path.resolve(__dirname, '../../src/services/api.js');
const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\n/gm, '')
  .replace('export const leafAPI = new LeafApiService();\nexport default leafAPI;', 'module.exports = new LeafApiService();');
const moduleObject = { exports: {} };
vm.runInNewContext(source, { module: moduleObject, config: { api: { baseUrl: 'http://127.0.0.1', timeoutMs: 1000 } },
  authService: {}, FinanceApiClient: class {}, GeofenceApiClient: class {}, URLSearchParams, Map, Set,
  AbortController, setTimeout, clearTimeout, Date, console }, { filename: file });
const api = moduleObject.exports;
const calls = [];
let modern = true;
api.request = async endpoint => {
  const query = new URL(endpoint, 'http://127.0.0.1').searchParams;
  calls.push(query);
  const page = Number(query.get('page'));
  const type = query.get('type') || 'all';
  return { users: [{ id: `${type}-${page}` }], pagination: modern
    ? { mode: 'keyset', hasMore: true, nextCursor: `${type}-next-${page + 1}`, prevCursor: `${type}-before-${page - 1}` }
    : { page, total: 100, pages: 5 } };
};

(async () => {
  for (let page = 1; page <= 100; page++) {
    await api.getUsers({ page, limit: 20, type: 'driver' });
    assert.equal(calls.at(-1).get('pagination'), 'cursor');
    if (page > 1) assert.equal(calls.at(-1).get('cursor'), `driver-next-${page}`);
  }
  assert.ok([...api.userPageCursors.values()][0].anchors.size <= 64);
  for (let page = 99; page >= 1; page--) {
    await api.getUsers({ page, limit: 20, type: 'driver' });
    assert.equal(calls.at(-1).get('pagination'), 'cursor');
    if (page > 1) assert.ok(calls.at(-1).get('cursor') || calls.at(-1).get('before'));
  }
  assert.ok(calls.some(query => query.get('before')), 'Evicted older anchors must use reverse cursor instead of deep offset');
  await api.getUsers({ page: 1, limit: 20, type: 'customer' });
  await api.getUsers({ page: 2, limit: 20, type: 'customer' });
  assert.equal(calls.at(-1).get('cursor'), 'customer-next-2');
  for (let i = 0; i < 12; i++) await api.getUsers({ page: 1, status: `synthetic-${i}` });
  assert.ok(api.userPageCursors.size <= 8);
  modern = false;
  await api.getUsers({ page: 1, type: 'legacy' });
  await api.getUsers({ page: 2, type: 'legacy' });
  assert.equal(calls.at(-1).get('page'), '2');
  assert.equal(calls.at(-1).get('cursor'), null);
  assert.equal(calls.at(-1).get('pagination'), null);
  console.log('Users pagination: forward/reverse cursor, filter isolation, bounded anchors and legacy compatibility passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

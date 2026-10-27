'use strict';

// Minimal Firestore for unit tests whose fixtures are an RTDB-shaped tree
// ({ users: { u1: {...} }, driver_activation: {...} }). Each native collection
// reads and writes the root the RTDB router used to serve, so existing
// fixtures and path assertions keep working after a service moves from
// `db.ref(...)` to a native repository. Transactions run one at a time.
// Supports what the native repositories use: doc().get(), runTransaction()
// with get/set (plain, merge, mergeFields)/update(FieldPath, delete)/delete.
const { FieldValue } = require('@google-cloud/firestore');

const DEFAULT_COLLECTIONS = Object.freeze({
  users: 'users',
  driver_activation: 'driver_activation',
  driver_document_locks: 'driver_document_mutation_locks',
  driver_document_stats: 'driver_documents_index_stats',
  vehicle_catalog: 'vehicles',
  driver_vehicle_links: 'user_vehicles',
  vehicle_plate_index: 'vehicle_plate_index'
});

const clone = value => (value === undefined || value === null ? null : JSON.parse(JSON.stringify(value)));
const split = path => String(path || '').split('/').filter(Boolean);
const isDelete = value => typeof value?.isEqual === 'function' && value.isEqual(FieldValue.delete());

function treeAccess(state) {
  return {
    read(path) {
      let cursor = state;
      for (const segment of split(path)) {
        if (!cursor || typeof cursor !== 'object') return null;
        cursor = cursor[segment];
      }
      return cursor === undefined ? null : clone(cursor);
    },
    write(path, value) {
      const parts = split(path);
      let cursor = state;
      parts.slice(0, -1).forEach((segment) => {
        if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
        cursor = cursor[segment];
      });
      const leaf = parts[parts.length - 1];
      if (value === null || value === undefined) delete cursor[leaf];
      else cursor[leaf] = clone(value);
    }
  };
}

// `source`: a plain state object, or { read(path), write(path, value) }.
function createTreeFirestore(source, { collections = DEFAULT_COLLECTIONS } = {}) {
  const access = typeof source?.read === 'function' && typeof source?.write === 'function'
    ? source
    : treeAccess(source);
  const commits = [];
  let chain = Promise.resolve();
  const rootOf = (name) => {
    if (!collections[name]) throw new Error(`unexpected collection ${name}`);
    return collections[name];
  };
  const docPath = ref => `${rootOf(ref.collection)}/${ref.id}`;
  const readDoc = (ref) => {
    const value = access.read(docPath(ref));
    if (value === null) return { exists: false, id: ref.id, data: () => undefined };
    return { exists: true, id: ref.id, data: () => (typeof value === 'object' ? value : { rtdbValue: value }) };
  };
  const pick = (data, fieldSegments) => fieldSegments.reduce((cursor, segment) => cursor?.[segment], data);
  const doc = (collection, id) => ({ collection, id, get: async () => readDoc({ collection, id }) });

  function apply(writes) {
    const committed = {};
    for (const [op, ref, data, options = {}] of writes) {
      const base = docPath(ref);
      if (op === 'delete') {
        access.write(base, null);
        committed[base] = null;
      } else if (op === 'update') {
        const path = `${base}/${data.segments.join('/')}`;
        access.write(path, null);
        committed[path] = null;
      } else if (options.mergeFields) {
        for (const field of options.mergeFields) {
          const value = pick(data, field.segments);
          const path = `${base}/${field.segments.join('/')}`;
          committed[path] = isDelete(value) ? null : clone(value);
          access.write(path, committed[path]);
        }
      } else if (options.merge) {
        for (const [field, value] of Object.entries(data)) {
          committed[`${base}/${field}`] = clone(value);
          access.write(`${base}/${field}`, value);
        }
      } else {
        const value = Object.keys(data).length === 1 && 'rtdbValue' in data ? data.rtdbValue : data;
        access.write(base, value);
        committed[base] = clone(value);
      }
    }
    if (Object.keys(committed).length) commits.push(committed);
  }

  return {
    commits,
    collection: (name) => {
      rootOf(name);
      return { doc: id => doc(name, id) };
    },
    runTransaction(work) {
      const run = chain.then(async () => {
        const writes = [];
        const tx = {
          get: async ref => readDoc(ref),
          set: (ref, data, options) => writes.push(['set', ref, data, options]),
          update: (ref, field, value) => writes.push(['update', ref, field, value]),
          delete: ref => writes.push(['delete', ref])
        };
        const result = await work(tx);
        apply(writes);
        return result;
      });
      chain = run.catch(() => undefined);
      return run;
    }
  };
}

module.exports = { createTreeFirestore, DEFAULT_COLLECTIONS };

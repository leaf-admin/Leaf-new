'use strict';

// Per-root router for the RTDB exit. Wraps the Admin RTDB instance returned by
// firebase-config so existing `db.ref(...)` call sites move root by root:
//
// - root not listed: plain RTDB, unchanged.
// - RTDB_FIRESTORE_WRITE_ROOTS: RTDB stays the source; after every write the
//   touched top-level records are re-read from RTDB and copied to Firestore.
// - RTDB_FIRESTORE_READ_ROOTS (subset of the write roots): Firestore is the
//   source. Writes are applied with RTDB semantics inside one Firestore
//   transaction, then replayed on RTDB as a mirror.
//
// Storage per root:
// - native (RTDB_FIRESTORE_NATIVE_COLLECTIONS=root:collection[:merge],...): each
//   record is a real Firestore document with the record's fields. Reads through
//   this API see Timestamps as ISO strings; writes only touch the top-level
//   fields that changed and keep a Timestamp a Timestamp. `merge` marks shared
//   canonical collections (fields that only Firestore has must survive):
//   mirror copies only RTDB's fields and a whole-record set is refused.
// - json (transitional, not native): `rtdb_<root>/<key>` = { schema, json }.
//
// RTDB retirement: RTDB_MIRROR_WRITES=false stops the RTDB mirror of the
// Firestore-served roots. Any access to a root that is not routed is logged
// (`rtdb_unrouted_access`, at most once per root every 10 minutes) so the
// remaining RTDB traffic is visible before RTDB is switched off.
const { FieldPath, FieldValue, Timestamp } = require('@google-cloud/firestore');
const { isDeepStrictEqual } = require('node:util');
const { logStructured } = require('../utils/logger');

const SCHEMA = 1;
const MAX_DOC_BYTES = 900 * 1024;

function rootList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function readConfig(env = process.env) {
  const writes = new Set(rootList(env.RTDB_FIRESTORE_WRITE_ROOTS));
  const reads = new Set(rootList(env.RTDB_FIRESTORE_READ_ROOTS).filter(root => writes.has(root)));
  const native = new Map();
  for (const entry of rootList(env.RTDB_FIRESTORE_NATIVE_COLLECTIONS)) {
    const [root, collection, flag] = entry.split(':').map(part => part.trim());
    if (!root || !/^[A-Za-z0-9_-]+$/.test(collection || '')) throw fail('RTDB_ROUTER_CONFIG', `Mapeamento nativo inválido: ${entry}`);
    native.set(root, { collection, merge: flag === 'merge' });
  }
  return { writes, reads, native };
}

const NESTED_ARRAY_FIELD = 'rtdbNestedArray';

// Firestore value -> the JSON shape RTDB consumers expect.
function toView(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp || (typeof value?.toDate === 'function' && typeof value?.toMillis === 'function')) {
    return value.toDate().toISOString();
  }
  if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number' && typeof value?.isEqual === 'function') {
    return { latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value?.path === 'string' && value?.firestore) return value.path;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toView);
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NESTED_ARRAY_FIELD && Array.isArray(value[NESTED_ARRAY_FIELD])) {
      return value[NESTED_ARRAY_FIELD].map(toView);
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = toView(child);
    return result;
  }
  return value;
}

// RTDB-shaped value -> Firestore value, keeping existing Timestamps as Timestamps.
function fromView(value, current) {
  if (value === null || value === undefined) return null;
  const isTimestamp = current instanceof Timestamp || (typeof current?.toDate === 'function' && typeof current?.toMillis === 'function');
  if (isTimestamp && (typeof value === 'string' || typeof value === 'number')) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }
  if (Array.isArray(value)) {
    // Firestore rejects arrays inside arrays: an inner array becomes a map
    // { rtdbNestedArray: [...] } and is decoded back by toView.
    return value.map((item, index) => {
      const previous = Array.isArray(current) ? current[index] : undefined;
      return Array.isArray(item)
        ? { [NESTED_ARRAY_FIELD]: fromView(item, previous?.[NESTED_ARRAY_FIELD]) }
        : fromView(item, previous);
    });
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (/^__.*__$/.test(key)) throw fail('RTDB_ROUTER_INVALID_KEY', `Campo reservado no Firestore: ${key}`);
      result[key] = fromView(child, current && typeof current === 'object' ? current[key] : undefined);
    }
    return result;
  }
  return value;
}

const PRIMITIVE_FIELD = 'rtdbValue';
const docView = data => {
  if (!data) return null;
  const keys = Object.keys(data);
  if (keys.length === 1 && keys[0] === PRIMITIVE_FIELD) return toView(data[PRIMITIVE_FIELD]);
  return normalize(toView(data));
};

const segmentsOf = path => String(path || '').split('/').filter(Boolean);
const collectionFor = root => `rtdb_${root}`;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertDocKey(key) {
  if (!key || key === '.' || key === '..' || /^__.*__$/.test(key) || Buffer.byteLength(key) > 1500) {
    throw fail('RTDB_ROUTER_INVALID_KEY', `Chave não suportada no Firestore: ${key}`);
  }
}

// RTDB normalization: null/undefined and empty objects do not exist.
function normalize(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    return items.every(item => item === null) ? null : items;
  }
  if (typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalize(child);
      if (normalized !== null) result[key] = normalized;
    }
    return Object.keys(result).length ? result : null;
  }
  return value;
}

function clone(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function getIn(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = current[segment];
  }
  return current === undefined ? null : current;
}

function setIn(value, segments, next) {
  if (!segments.length) return normalize(clone(next));
  const [head, ...rest] = segments;
  const base = value && typeof value === 'object' && !Array.isArray(value) ? { ...value }
    : Array.isArray(value) ? Object.assign({}, value) : {};
  base[head] = setIn(base[head] ?? null, rest, next);
  return normalize(base);
}

// RTDB orderByChild/orderByValue ordering: null < false < true < numbers <
// strings < objects; ties by key.
function rank(value) {
  if (value === null || value === undefined) return [0];
  if (value === false) return [1];
  if (value === true) return [2];
  if (typeof value === 'number') return [3, value];
  if (typeof value === 'string') return [4, value];
  return [5];
}

function compareRank(left, right) {
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left.length < 2) return 0;
  return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
}

function compareKeys(left, right) {
  const li = /^-?\d+$/.test(left) && Number.isSafeInteger(Number(left));
  const ri = /^-?\d+$/.test(right) && Number.isSafeInteger(Number(right));
  if (li && ri) return Number(left) - Number(right);
  if (li) return -1;
  if (ri) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function applyQuery(value, query) {
  const active = query && Object.values(query).some(item => item !== undefined);
  if (!active || value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const sortValue = ([key, child]) => query.orderBy === 'key' ? key
    : query.orderBy === 'value' ? child
      : getIn(child, segmentsOf(query.child));
  const compare = (left, right) => {
    if (query.orderBy === 'key') return compareKeys(left[0], right[0]);
    return compareRank(rank(sortValue(left)), rank(sortValue(right))) || compareKeys(left[0], right[0]);
  };
  const within = entry => {
    const probe = sortValue(entry);
    const cmp = bound => query.orderBy === 'key'
      ? compareKeys(String(probe), String(bound))
      : compareRank(rank(probe), rank(bound));
    if (query.equalTo !== undefined && cmp(query.equalTo) !== 0) return false;
    if (query.startAt !== undefined && cmp(query.startAt) < 0) return false;
    if (query.startAfter !== undefined && cmp(query.startAfter) <= 0) return false;
    if (query.endAt !== undefined && cmp(query.endAt) > 0) return false;
    if (query.endBefore !== undefined && cmp(query.endBefore) >= 0) return false;
    return true;
  };
  let selected = entries.sort(compare).filter(within);
  if (Number.isInteger(query.limitToFirst)) selected = selected.slice(0, query.limitToFirst);
  if (Number.isInteger(query.limitToLast)) selected = selected.slice(-query.limitToLast);
  return selected.length ? Object.fromEntries(selected) : null;
}

function snapshot(key, value, ordered = null) {
  const data = value === undefined ? null : value;
  return {
    key,
    val: () => clone(data),
    exists: () => data !== null,
    child: path => snapshot(segmentsOf(path).pop() || key, getIn(data, segmentsOf(path))),
    hasChild: path => getIn(data, segmentsOf(path)) !== null,
    numChildren: () => (data && typeof data === 'object' ? Object.keys(data).length : 0),
    forEach: callback => {
      const keys = ordered || (data && typeof data === 'object' ? Object.keys(data) : []);
      for (const childKey of keys) {
        if (callback(snapshot(childKey, data[childKey])) === true) return true;
      }
      return false;
    },
    toJSON: () => clone(data)
  };
}

const rtdbRetired = (env = process.env) => env.RTDB_RETIRED === 'true';
const mirrorWritesEnabled = (env = process.env) => !rtdbRetired(env) && env.RTDB_MIRROR_WRITES !== 'false';
const UNROUTED_LOG_INTERVAL_MS = 10 * 60 * 1000;

// Firebase-style push id: 8 chars of time + 12 random, sorting by creation.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
function pushId(now = Date.now()) {
  let time = '';
  for (let i = 0; i < 8; i += 1) { time = PUSH_CHARS.charAt(now % 64) + time; now = Math.floor(now / 64); }
  let random = '';
  for (let i = 0; i < 12; i += 1) random += PUSH_CHARS.charAt(Math.floor(Math.random() * 64));
  return time + random;
}

// Stand-in for the Admin RTDB client once RTDB_RETIRED=true: nothing reaches
// RTDB anymore. Reads see an empty database; writes are dropped and logged as
// errors (`rtdb_retired_write`) so a missed writer shows up in Sentry without
// breaking the flow that called it. Every served root goes through the router
// to Firestore before it gets here.
function createRetiredRtdb({ log = logStructured } = {}) {
  const seen = new Map();
  const note = (level, message, path) => {
    const key = `${message}:${segmentsOf(path)[0] || '<root>'}`;
    const now = Date.now();
    if (now - (seen.get(key) || 0) < UNROUTED_LOG_INTERVAL_MS) return;
    seen.set(key, now);
    log(level, message, { service: 'rtdb-root-router', root: segmentsOf(path)[0] || null });
  };
  const empty = path => snapshot(segmentsOf(path).pop() || null, null);
  const ref = (path = '') => {
    const read = async () => { if (!String(path).startsWith('.info')) note('warn', 'rtdb_retired_read', path); return empty(path); };
    const write = async values => {
      const paths = !segmentsOf(path).length && values && typeof values === 'object' ? Object.keys(values) : [path];
      paths.forEach(target => note('error', 'rtdb_retired_write', target));
    };
    const query = {
      orderByChild: () => query, orderByKey: () => query, orderByValue: () => query,
      equalTo: () => query, startAt: () => query, startAfter: () => query, endAt: () => query, endBefore: () => query,
      limitToFirst: () => query, limitToLast: () => query,
      once: async (_event, callback) => { const result = await read(); if (typeof callback === 'function') callback(result); return result; },
      get: read,
      on: (_event, callback) => { Promise.resolve().then(() => callback?.(empty(path))); return callback; },
      off: () => {}
    };
    return {
      ...query,
      key: segmentsOf(path).pop() || null,
      toString: () => `rtdb-retired://${path}`,
      child: childPath => ref(`${segmentsOf(path).join('/')}/${childPath}`),
      push: value => {
        const childPath = `${segmentsOf(path).join('/')}/${pushId()}`;
        const child = ref(childPath);
        if (value === undefined) return child;
        const promise = child.set(value).then(() => ref(childPath));
        return Object.assign(child, { then: promise.then.bind(promise), catch: promise.catch.bind(promise) });
      },
      set: write, update: write, remove: write,
      transaction: async () => { await write(); return { committed: false, snapshot: empty(path) }; }
    };
  };
  return { ref, __rtdbRetired: true };
}

// The RTDB client behind the router: the real one, or the retired stand-in.
function realtimeClient(admin, env = process.env) {
  return rtdbRetired(env) ? createRetiredRtdb() : admin.database();
}

function createRouter(rawDb, { getFirestore, env = process.env, log = logStructured } = {}) {
  const config = readConfig(env);
  if (!config.writes.size) return rawDb;
  const mirrorWrites = mirrorWritesEnabled(env);
  const unroutedSeen = new Map();
  const noteUnrouted = (root, op) => {
    if (!root || root === '.info') return;
    const key = `${root}:${op}`;
    const now = Date.now();
    if (now - (unroutedSeen.get(key) || 0) < UNROUTED_LOG_INTERVAL_MS) return;
    unroutedSeen.set(key, now);
    log('warn', 'rtdb_unrouted_access', { service: 'rtdb-root-router', root, op });
  };

  const firestore = () => {
    const instance = getFirestore?.();
    if (!instance) throw fail('RTDB_ROUTER_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o roteador do RTDB');
    return instance;
  };
  const modeOf = root => config.reads.has(root) ? 'firestore' : config.writes.has(root) ? 'mirror' : 'rtdb';
  const nativeOf = root => config.native.get(root) || null;
  const collectionName = root => nativeOf(root)?.collection || collectionFor(root);
  const docRef = (root, key) => { assertDocKey(key); return firestore().collection(collectionName(root)).doc(key); };
  const assertSize = (root, key, data) => {
    if (Buffer.byteLength(JSON.stringify(toView(data))) > MAX_DOC_BYTES) {
      throw fail('RTDB_ROUTER_DOC_TOO_LARGE', `${root}/${key} excede o documento do Firestore`);
    }
  };
  const encode = (root, key, value) => {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw fail('RTDB_ROUTER_DOC_TOO_LARGE', `${root}/${key} excede o documento do Firestore`);
    return { schema: SCHEMA, json, updatedAt: new Date().toISOString() };
  };
  const decode = (root, data) => {
    if (!data) return null;
    return nativeOf(root) ? docView(data) : JSON.parse(data.json);
  };

  // Write the new RTDB-shaped value of one record into its document.
  // keepAbsent (mirror copy into a canonical collection): fields missing from
  // the RTDB record are left alone instead of deleted.
  function writeRecord(tx, root, key, raw, next, { keepAbsent = false } = {}) {
    const ref = docRef(root, key);
    if (!nativeOf(root)) {
      if (next === null) tx.delete(ref);
      else tx.set(ref, encode(root, key, next));
      return;
    }
    if (next === null) {
      if (nativeOf(root).merge) throw fail('RTDB_ROUTER_CANONICAL_DELETE', `Remoção de registro canônico não suportada: ${root}/${key}`);
      tx.delete(ref);
      return;
    }
    if (typeof next !== 'object' || Array.isArray(next)) {
      tx.set(ref, { [PRIMITIVE_FIELD]: fromView(next, raw?.[PRIMITIVE_FIELD]) });
      return;
    }
    if (!raw || Object.keys(raw).length === 1 && PRIMITIVE_FIELD in raw) {
      const data = fromView(next, undefined);
      assertSize(root, key, data);
      tx.set(ref, data);
      return;
    }
    const before = docView(raw) || {};
    const updates = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(next)]);
    for (const field of keys) {
      if (isDeepStrictEqual(before[field] ?? null, next[field] ?? null)) continue;
      if (next[field] === undefined || next[field] === null) {
        if (keepAbsent) continue;
        updates.push(new FieldPath(field), FieldValue.delete());
      } else {
        updates.push(new FieldPath(field), fromView(next[field], raw[field]));
      }
    }
    if (updates.length) tx.update(ref, ...updates);
  }

  // orderByChild(c).equalTo(primitive) on a native collection becomes a
  // single-field Firestore query (automatic index) instead of a full scan;
  // applyQuery still orders and limits the result. Not for `merge`
  // collections, where a field may hold a Timestamp that RTDB sees as ISO.
  function rootQuery(root, query) {
    const collection = firestore().collection(collectionName(root));
    const native = nativeOf(root);
    const child = query?.orderBy === 'child' ? segmentsOf(query.child) : [];
    const primitive = ['string', 'number', 'boolean'].includes(typeof query?.equalTo);
    if (!native || native.merge || !primitive || !child.length || child.some(part => /^\d+$/.test(part))) return collection;
    return collection.where(new FieldPath(...child), '==', query.equalTo);
  }

  async function readFirestore(segments, query) {
    const [root, key, ...rest] = segments;
    if (!key) {
      const docs = await rootQuery(root, query).get();
      const value = {};
      docs.docs.forEach(doc => { value[doc.id] = decode(root, doc.data()); });
      return applyQuery(normalize(value), query);
    }
    const doc = await docRef(root, key).get();
    return applyQuery(getIn(doc.exists ? decode(root, doc.data()) : null, rest), query);
  }

  // Copy touched records from RTDB (the source in mirror mode) to Firestore.
  async function mirrorFromRtdb(root, keys) {
    try {
      const merge = nativeOf(root)?.merge === true;
      if (keys === null) {
        if (merge) throw fail('RTDB_ROUTER_CANONICAL_ROOT', `Cópia da raiz inteira não suportada para ${root}`);
        keys = Object.keys((await rawDb.ref(root).once('value')).val() || {});
        const existing = await firestore().collection(collectionName(root)).get();
        for (const doc of existing.docs) if (!keys.includes(doc.id)) await doc.ref.delete();
      }
      for (const key of keys) {
        const value = (await rawDb.ref(`${root}/${key}`).once('value')).val();
        if (value === null && merge) continue;
        await firestore().runTransaction(async tx => {
          const current = await tx.get(docRef(root, key));
          writeRecord(tx, root, key, current.exists ? current.data() : null, normalize(value), { keepAbsent: merge });
        });
      }
    } catch (error) {
      log('warn', 'Cópia Firestore do RTDB falhou; será reparada pela cópia com paridade', {
        service: 'rtdb-root-router', root, error: error.message
      });
    }
  }

  // Apply RTDB-style writes ({ 'root/key/a/b': value }) in one transaction.
  async function writeFirestore(pathValues) {
    const byDoc = new Map();
    for (const [path, value] of pathValues) {
      const [root, key, ...rest] = segmentsOf(path);
      if (!key) throw fail('RTDB_ROUTER_ROOT_WRITE', `Escrita na raiz inteira não suportada: ${root}`);
      const id = `${root}/${key}`;
      if (!byDoc.has(id)) byDoc.set(id, { root, key, ops: [] });
      byDoc.get(id).ops.push([rest, value]);
    }
    await firestore().runTransaction(async tx => {
      const docs = [...byDoc.values()];
      const current = await Promise.all(docs.map(doc => tx.get(docRef(doc.root, doc.key))));
      docs.forEach((doc, index) => {
        const raw = current[index].exists ? current[index].data() : null;
        let value = decode(doc.root, raw);
        const merge = nativeOf(doc.root)?.merge === true;
        for (const [rest, next] of doc.ops) {
          if (merge && !rest.length) throw fail('RTDB_ROUTER_CANONICAL_SET', `Gravação do registro inteiro não suportada em ${doc.root}; atualize campos`);
          value = setIn(value, rest, next);
        }
        writeRecord(tx, doc.root, doc.key, raw, value);
      });
    });
  }

  async function replayOnRtdb(apply, context) {
    if (!mirrorWrites) return;
    try { await apply(); } catch (error) {
      log('warn', 'Espelho RTDB falhou para raiz servida pelo Firestore', { service: 'rtdb-root-router', ...context, error: error.message });
    }
  }

  function routedQuery(path, query) {
    const segments = segmentsOf(path);
    const raw = () => {
      let ref = rawDb.ref(path);
      if (query.orderBy === 'key') ref = ref.orderByKey();
      else if (query.orderBy === 'value') ref = ref.orderByValue();
      else if (query.orderBy === 'child') ref = ref.orderByChild(query.child);
      for (const name of ['equalTo', 'startAt', 'startAfter', 'endAt', 'endBefore', 'limitToFirst', 'limitToLast']) {
        if (query[name] !== undefined) ref = ref[name](query[name]);
      }
      return ref;
    };
    const next = patch => routedQuery(path, { ...query, ...patch });
    return {
      orderByChild: child => next({ orderBy: 'child', child }),
      orderByKey: () => next({ orderBy: 'key' }),
      orderByValue: () => next({ orderBy: 'value' }),
      equalTo: value => next({ equalTo: value }),
      startAt: value => next({ startAt: value }),
      startAfter: value => next({ startAfter: value }),
      endAt: value => next({ endAt: value }),
      endBefore: value => next({ endBefore: value }),
      limitToFirst: value => next({ limitToFirst: value }),
      limitToLast: value => next({ limitToLast: value }),
      once: async (eventType = 'value', callback) => {
        if (eventType !== 'value') throw fail('RTDB_ROUTER_UNSUPPORTED', `Evento ${eventType} não suportado`);
        let result;
        if (modeOf(segments[0]) === 'firestore') {
          const value = await readFirestore(segments, query);
          const ordered = value && typeof value === 'object' ? Object.keys(value) : null;
          result = snapshot(segments[segments.length - 1] || null, value, ordered);
        } else {
          result = await raw().once('value');
        }
        if (typeof callback === 'function') callback(result);
        return result;
      },
      get: async () => (await next({}).once('value')),
      // In mirror mode RTDB is still the source, so listeners stay on RTDB.
      on: (...args) => {
        if (modeOf(segments[0]) === 'firestore') throw fail('RTDB_ROUTER_UNSUPPORTED', 'Listeners não suportados em raiz servida pelo Firestore');
        return raw().on(...args);
      },
      off: (...args) => {
        if (modeOf(segments[0]) === 'firestore') throw fail('RTDB_ROUTER_UNSUPPORTED', 'Listeners não suportados em raiz servida pelo Firestore');
        return raw().off(...args);
      }
    };
  }

  function routedRef(path) {
    const segments = segmentsOf(path);
    const root = segments[0];
    const mode = modeOf(root);
    const key = segments[1] || null;
    const touched = key ? [key] : null;
    const base = routedQuery(path, {});
    return {
      ...base,
      key: segments[segments.length - 1] || null,
      toString: () => rawDb.ref(path).toString(),
      child: childPath => routedRef(`${segments.join('/')}/${childPath}`),
      push: value => {
        const generated = rawDb.ref(path).push().key;
        const childPath = `${segments.join('/')}/${generated}`;
        const child = routedRef(childPath);
        if (value === undefined) return child;
        // Resolve with a fresh, non-thenable ref (as the SDK does); resolving
        // with `child` itself would adopt its own `then` forever.
        const promise = child.set(value).then(() => routedRef(childPath));
        return Object.assign(child, { then: promise.then.bind(promise), catch: promise.catch.bind(promise) });
      },
      set: async value => {
        if (mode === 'firestore') {
          if (!key) throw fail('RTDB_ROUTER_ROOT_WRITE', `Escrita na raiz inteira não suportada: ${root}`);
          await writeFirestore([[path, value]]);
          await replayOnRtdb(() => rawDb.ref(path).set(value), { op: 'set', root });
          return;
        }
        await rawDb.ref(path).set(value);
        await mirrorFromRtdb(root, touched);
      },
      update: async values => {
        const entries = Object.entries(values || {});
        if (mode === 'firestore') {
          await writeFirestore(entries.map(([child, value]) => [`${segments.join('/')}/${child}`, value]));
          await replayOnRtdb(() => rawDb.ref(path).update(values), { op: 'update', root });
          return;
        }
        await rawDb.ref(path).update(values);
        const keys = key ? [key] : [...new Set(entries.map(([child]) => segmentsOf(child)[0]))];
        await mirrorFromRtdb(root, keys);
      },
      remove: async () => {
        if (mode === 'firestore') {
          if (!key) throw fail('RTDB_ROUTER_ROOT_WRITE', `Remoção da raiz inteira não suportada: ${root}`);
          await writeFirestore([[path, null]]);
          await replayOnRtdb(() => rawDb.ref(path).remove(), { op: 'remove', root });
          return;
        }
        await rawDb.ref(path).remove();
        await mirrorFromRtdb(root, touched);
      },
      transaction: async update => {
        if (mode !== 'firestore') {
          const result = await rawDb.ref(path).transaction(update);
          if (result?.committed) await mirrorFromRtdb(root, touched);
          return result;
        }
        if (!key) throw fail('RTDB_ROUTER_ROOT_WRITE', `Transação na raiz inteira não suportada: ${root}`);
        const rest = segments.slice(2);
        let committedValue = null;
        const committed = await firestore().runTransaction(async tx => {
          const doc = await tx.get(docRef(root, key));
          const raw = doc.exists ? doc.data() : null;
          const whole = decode(root, raw);
          const next = update(clone(getIn(whole, rest)));
          if (next === undefined) { committedValue = getIn(whole, rest); return false; }
          writeRecord(tx, root, key, raw, setIn(whole, rest, next));
          committedValue = normalize(clone(next));
          return true;
        });
        if (committed) await replayOnRtdb(() => rawDb.ref(path).set(committedValue), { op: 'transaction', root });
        return { committed, snapshot: snapshot(segments[segments.length - 1], committedValue) };
      }
    };
  }

  function rootRef() {
    const raw = rawDb.ref();
    return new Proxy(raw, {
      get(target, property) {
        if (property !== 'update') {
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return async values => {
          const entries = Object.entries(values || {});
          const served = entries.filter(([path]) => modeOf(segmentsOf(path)[0]) === 'firestore');
          if (served.length) await writeFirestore(served);
          // One RTDB update keeps the payload atomic on RTDB: it is the source
          // for unrouted roots (errors propagate) and a mirror for served ones.
          const unserved = entries.filter(([path]) => modeOf(segmentsOf(path)[0]) !== 'firestore');
          unserved.forEach(([path]) => { const root = segmentsOf(path)[0]; if (modeOf(root) === 'rtdb') noteUnrouted(root, 'root_update'); });
          if (!mirrorWrites) {
            if (unserved.length) await target.update(Object.fromEntries(unserved));
          } else if (unserved.length || !served.length) await target.update(values);
          else await replayOnRtdb(() => target.update(values), { op: 'root_update' });
          const mirrorTargets = new Map();
          for (const [path] of entries) {
            const [root, key] = segmentsOf(path);
            if (modeOf(root) !== 'mirror') continue;
            if (!mirrorTargets.has(root)) mirrorTargets.set(root, new Set());
            if (key) mirrorTargets.get(root).add(key);
            else mirrorTargets.set(root, null);
          }
          for (const [root, keys] of mirrorTargets) await mirrorFromRtdb(root, keys ? [...keys] : null);
        };
      }
    });
  }

  return new Proxy(rawDb, {
    get(target, property) {
      if (property === 'ref') {
        return path => {
          const segments = segmentsOf(path);
          if (!segments.length) return rootRef();
          if (modeOf(segments[0]) !== 'rtdb') return routedRef(path);
          noteUnrouted(segments[0], 'ref');
          return target.ref(path);
        };
      }
      if (property === '__rtdbRootRouter') {
        return { config, readFirestore, mirrorFromRtdb, collectionFor, collectionName, decode, writeRecord, raw: rawDb,
          servedByFirestore: root => modeOf(root) === 'firestore', nativeOf };
      }
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

module.exports = { createRouter, readConfig, mirrorWritesEnabled, rtdbRetired, createRetiredRtdb, realtimeClient, pushId, normalize, setIn, getIn, applyQuery, collectionFor, toView, fromView, docView };

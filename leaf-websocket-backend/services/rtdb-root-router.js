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
// Storage: `rtdb_<root>/<key>` holds `{ schema, json }` with the exact RTDB
// subtree, so shapes (nested arrays, odd keys) are preserved as they are.
const { logStructured } = require('../utils/logger');

const SCHEMA = 1;
const MAX_DOC_BYTES = 900 * 1024;

function rootList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function readConfig(env = process.env) {
  const writes = new Set(rootList(env.RTDB_FIRESTORE_WRITE_ROOTS));
  const reads = new Set(rootList(env.RTDB_FIRESTORE_READ_ROOTS).filter(root => writes.has(root)));
  return { writes, reads };
}

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

function createRouter(rawDb, { getFirestore, env = process.env, log = logStructured } = {}) {
  const config = readConfig(env);
  if (!config.writes.size) return rawDb;

  const firestore = () => {
    const instance = getFirestore?.();
    if (!instance) throw fail('RTDB_ROUTER_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o roteador do RTDB');
    return instance;
  };
  const modeOf = root => config.reads.has(root) ? 'firestore' : config.writes.has(root) ? 'mirror' : 'rtdb';
  const docRef = (root, key) => { assertDocKey(key); return firestore().collection(collectionFor(root)).doc(key); };
  const encode = (root, key, value) => {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw fail('RTDB_ROUTER_DOC_TOO_LARGE', `${root}/${key} excede o documento do Firestore`);
    return { schema: SCHEMA, json, updatedAt: new Date().toISOString() };
  };
  const decode = data => (data ? JSON.parse(data.json) : null);

  async function readFirestore(segments, query) {
    const [root, key, ...rest] = segments;
    if (!key) {
      const docs = await firestore().collection(collectionFor(root)).get();
      const value = {};
      docs.docs.forEach(doc => { value[doc.id] = decode(doc.data()); });
      return applyQuery(normalize(value), query);
    }
    const doc = await docRef(root, key).get();
    return applyQuery(getIn(doc.exists ? decode(doc.data()) : null, rest), query);
  }

  // Copy touched records from RTDB (the source in mirror mode) to Firestore.
  async function mirrorFromRtdb(root, keys) {
    try {
      if (keys === null) {
        const value = (await rawDb.ref(root).once('value')).val() || {};
        const existing = await firestore().collection(collectionFor(root)).get();
        const batch = firestore().batch();
        existing.docs.forEach(doc => { if (!(doc.id in value)) batch.delete(doc.ref); });
        Object.entries(value).forEach(([key, child]) => batch.set(docRef(root, key), encode(root, key, child)));
        await batch.commit();
        return;
      }
      for (const key of keys) {
        const value = (await rawDb.ref(`${root}/${key}`).once('value')).val();
        if (value === null) await docRef(root, key).delete();
        else await docRef(root, key).set(encode(root, key, value));
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
        let value = current[index].exists ? decode(current[index].data()) : null;
        for (const [rest, next] of doc.ops) value = setIn(value, rest, next);
        if (value === null) tx.delete(docRef(doc.root, doc.key));
        else tx.set(docRef(doc.root, doc.key), encode(doc.root, doc.key, value));
      });
    });
  }

  async function replayOnRtdb(apply, context) {
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
      on: () => { throw fail('RTDB_ROUTER_UNSUPPORTED', 'Listeners não suportados em raiz roteada'); },
      off: () => { throw fail('RTDB_ROUTER_UNSUPPORTED', 'Listeners não suportados em raiz roteada'); }
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
        const child = routedRef(`${segments.join('/')}/${generated}`);
        if (value === undefined) return child;
        const promise = child.set(value).then(() => child);
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
          const whole = doc.exists ? decode(doc.data()) : null;
          const next = update(clone(getIn(whole, rest)));
          if (next === undefined) { committedValue = getIn(whole, rest); return false; }
          const value = setIn(whole, rest, next);
          if (value === null) tx.delete(docRef(root, key));
          else tx.set(docRef(root, key), encode(root, key, value));
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
          const hasRtdbSource = entries.some(([path]) => modeOf(segmentsOf(path)[0]) !== 'firestore');
          if (hasRtdbSource || !served.length) await target.update(values);
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
          return modeOf(segments[0]) === 'rtdb' ? target.ref(path) : routedRef(path);
        };
      }
      if (property === '__rtdbRootRouter') return { config, readFirestore, mirrorFromRtdb, collectionFor };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

module.exports = { createRouter, readConfig, normalize, setIn, getIn, applyQuery, collectionFor };

'use strict';

// Native Firestore repository for the canonical user record users/{uid}
// (RTDB exit). It replaces `db.ref('users/<uid>...')` calls that went through
// rtdb-root-router. users is a shared canonical collection: writes only touch
// the named fields, never replace the whole document, and fields that only
// Firestore has (profile, Timestamps) survive.
//
// Reads return the shape RTDB consumers expect (Timestamps as ISO strings,
// nulls dropped), the same view the router served.
const { isDeepStrictEqual } = require('node:util');
const { FieldPath, FieldValue } = require('@google-cloud/firestore');
const { commit, userField } = require('./driver-document-store');
const { docView, fromView, getIn, normalize } = require('./native-record-view');

const COLLECTION = 'users';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireFirestore(firestore, { write = true } = {}) {
  if (!firestore?.collection || (write && !firestore?.runTransaction)) {
    throw fail('USER_STORE_UNAVAILABLE', 'Firestore indisponível para o cadastro do usuário');
  }
  return firestore;
}

// `firestore` from the caller's options, else the process Firestore.
function resolveFirestore(options = {}) {
  if (options.firestore) return options.firestore;
  // Loaded lazily: firebase-config pulls in the Admin SDK.
  return require('../firebase-config').getFirestore?.() || null;
}

function userId(value) {
  const id = String(value || '').trim();
  if (!id || id.includes('/') || /^__.*__$/.test(id)) {
    throw fail('USER_STORE_INVALID_ID', `Usuário inválido: ${id}`);
  }
  return id;
}

function segments(path) {
  return (Array.isArray(path) ? path : String(path || '').split('/'))
    .map(segment => String(segment ?? '').trim())
    .filter(Boolean);
}

function clone(value) {
  return value === undefined || value === null ? null : JSON.parse(JSON.stringify(value));
}

const userRef = (firestore, uid, options) => requireFirestore(firestore, options).collection(COLLECTION).doc(userId(uid));

async function readUser(firestore, uid) {
  const snapshot = await userRef(firestore, uid, { write: false }).get();
  return snapshot.exists ? docView(snapshot.data()) : null;
}

async function readUserField(firestore, uid, path) {
  const value = getIn(await readUser(firestore, uid), segments(path));
  return value === undefined ? null : value;
}

// RTDB `ref('users/<uid>/<basePath>').update(patch)`: each key (which may be a
// nested 'a/b' path) is replaced; null deletes it. One atomic commit.
async function updateUser(firestore, uid, patch, basePath = []) {
  const base = segments(basePath);
  const writes = Object.entries(patch || {}).map(([key, value]) => {
    const field = [...base, ...segments(key)];
    if (!field.length) throw fail('USER_STORE_INVALID_FIELD', 'Campo vazio na atualização do usuário');
    return userField(uid, field, value);
  });
  if (writes.length) await commit(requireFirestore(firestore), writes);
}

// RTDB `ref('users/<uid>/<path>').set(value)` for a field (never the record).
async function setUserField(firestore, uid, path, value) {
  const field = segments(path);
  if (!field.length) throw fail('USER_STORE_CANONICAL_SET', 'Gravação do registro inteiro do usuário não suportada');
  await commit(requireFirestore(firestore), [userField(uid, field, value)]);
}

// RTDB-style transaction on the whole record: updater(current) returns the
// next record or undefined to abort. Top-level fields missing from the result
// are deleted (as RTDB would); returning null is refused (canonical record).
async function transactUser(firestore, uid, updater) {
  const ref = userRef(firestore, uid);
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const raw = snapshot.exists ? snapshot.data() : null;
    const current = raw ? docView(raw) : null;
    const proposed = updater(clone(current));
    if (proposed === undefined) return { committed: false, value: current };
    const next = normalize(clone(proposed));
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw fail('USER_STORE_CANONICAL_SET', 'Transação precisa devolver o registro do usuário');
    }
    const before = current || {};
    const data = {};
    const mergeFields = [];
    for (const field of new Set([...Object.keys(before), ...Object.keys(next)])) {
      if (isDeepStrictEqual(before[field] ?? null, next[field] ?? null)) continue;
      data[field] = next[field] === undefined ? FieldValue.delete() : fromView(next[field], getIn(raw, [field]) ?? undefined);
      mergeFields.push(new FieldPath(field));
    }
    if (mergeFields.length) tx.set(ref, data, { mergeFields });
    return { committed: true, value: next };
  });
}

// { uid: record } for every user (bounded by `limit` when given), in the view
// readUser returns. For whole-collection reads the RTDB API used to serve.
async function listUsers(firestore, { limit } = {}) {
  let query = requireFirestore(firestore, { write: false }).collection(COLLECTION);
  if (Number.isInteger(limit)) query = query.limit(limit);
  return viewsOf(await query.get());
}

// { uid: record } whose top-level `field` equals `value` (single-field index).
async function queryUsers(firestore, field, value, { limit } = {}) {
  let query = requireFirestore(firestore, { write: false }).collection(COLLECTION).where(field, '==', value);
  if (Number.isInteger(limit)) query = query.limit(limit);
  return viewsOf(await query.get());
}

function viewsOf(snapshot) {
  const result = {};
  for (const doc of snapshot?.docs || []) {
    const view = docView(doc.data());
    if (view !== null) result[doc.id] = view;
  }
  return result;
}

// Create users/{uid} with `profile` only when the record does not exist yet
// (account creation). An existing record is never replaced. Returns
// { created, value } with the stored record.
async function createUserIfMissing(firestore, uid, profile) {
  const ref = userRef(firestore, uid);
  const next = normalize(clone(profile));
  if (next === null || typeof next !== 'object' || Array.isArray(next)) {
    throw fail('USER_STORE_INVALID_PROFILE', 'Perfil inicial do usuário inválido');
  }
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (snapshot.exists) return { created: false, value: docView(snapshot.data()) };
    tx.set(ref, fromView(next, undefined));
    return { created: true, value: next };
  });
}

module.exports = {
  COLLECTION,
  createUserIfMissing,
  listUsers,
  queryUsers,
  resolveFirestore,
  readUser,
  readUserField,
  updateUser,
  setUserField,
  transactUser
};

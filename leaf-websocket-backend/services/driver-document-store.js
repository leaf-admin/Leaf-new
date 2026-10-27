'use strict';

// Native Firestore repository for the driver document pipeline (RTDB exit,
// after RTDB_RETIRED). It replaces the `db.ref(...)` calls of
// driver-document-analysis-queue that went through rtdb-root-router.
//
// Documents keep the layout the router already serves, so readers still on the
// router see the same data:
// - driver_activation/{driverId}: documents, documents_history, status,
//   consent, biometrics, updatedAt.
// - driver_document_locks/{driverId}: one field per document type (lease).
// - driver_document_stats/{documentType}: pending/approved/rejected counters.
// - users/{driverId} (canonical, shared): documents, driverActivation,
//   driverActivationConsent, biometrics. Only the named fields are written.
// - vehicle_catalog, driver_vehicle_links, vehicle_plate_index: only for the
//   approved CRLV vehicle link, committed with the document state.
//
// Writes replace exactly the given field paths (RTDB `set` semantics at that
// path) inside one transaction; null or an empty object deletes the field.
const { FieldPath, FieldValue } = require('@google-cloud/firestore');
const { docView, fromView, getIn, normalize, setIn } = require('./native-record-view');

const COLLECTIONS = Object.freeze({
  activation: 'driver_activation',
  locks: 'driver_document_locks',
  stats: 'driver_document_stats',
  users: 'users',
  vehicles: 'vehicle_catalog',
  vehicleLinks: 'driver_vehicle_links',
  plateIndex: 'vehicle_plate_index'
});

// RTDB-style roots the vehicle updates still name ({ 'root/key/a': value }).
const VEHICLE_LINK_ROOTS = Object.freeze({
  vehicles: COLLECTIONS.vehicles,
  user_vehicles: COLLECTIONS.vehicleLinks,
  vehicle_plate_index: COLLECTIONS.plateIndex,
  users: COLLECTIONS.users
});

// Field writes on the activation record and on the canonical user record.
const activationField = (driverId, field, value) => ({ collection: COLLECTIONS.activation, id: driverId, field, value });
const userField = (driverId, field, value) => ({ collection: COLLECTIONS.users, id: driverId, field, value });

// Records that hold a single primitive (the plate index) store it here.
const PRIMITIVE_FIELD = 'rtdbValue';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function requireFirestore(firestore) {
  if (!firestore?.collection || !firestore?.runTransaction) {
    throw fail('DRIVER_DOCUMENT_STORE_UNAVAILABLE', 'Firestore indisponível para os documentos do motorista');
  }
  return firestore;
}

function docId(value) {
  const id = String(value || '').trim();
  if (!id || id.includes('/') || /^__.*__$/.test(id)) {
    throw fail('DRIVER_DOCUMENT_STORE_INVALID_ID', `Identificador inválido: ${id}`);
  }
  return id;
}

function fieldSegments(field) {
  const segments = (Array.isArray(field) ? field : [field]).map(segment => String(segment ?? '').trim());
  if (segments.some(segment => !segment || segment.includes('/') || /^__.*__$/.test(segment))) {
    throw fail('DRIVER_DOCUMENT_STORE_INVALID_FIELD', `Campo inválido: ${segments.join('.')}`);
  }
  return segments;
}

function clone(value) {
  return value === undefined || value === null ? null : JSON.parse(JSON.stringify(value));
}

async function readView(firestore, collection, id) {
  const snapshot = await requireFirestore(firestore).collection(collection).doc(docId(id)).get();
  return snapshot.exists ? docView(snapshot.data()) : null;
}

const readActivation = (firestore, driverId) => readView(firestore, COLLECTIONS.activation, driverId);
const readUser = (firestore, driverId) => readView(firestore, COLLECTIONS.users, driverId);

// { documentType: { pending, approved, rejected } } for the review queue.
async function listStats(firestore) {
  const snapshot = await requireFirestore(firestore).collection(COLLECTIONS.stats).get();
  return Object.fromEntries((snapshot?.docs || []).map(doc => [doc.id, docView(doc.data()) || {}]));
}

// Current document, user projection and history entry for one submission.
async function readDocumentBinding(firestore, { driverId, documentType, submissionId }) {
  const [activation, user] = await Promise.all([
    readActivation(firestore, driverId),
    readUser(firestore, driverId)
  ]);
  return {
    activationDocument: getIn(activation, ['documents', documentType]) || {},
    userDocument: getIn(user, ['documents', documentType]) || {},
    historyDocument: submissionId ? getIn(activation, ['documents_history', submissionId]) || {} : {}
  };
}

// Apply field writes ({ collection, id, field, value }) atomically. `field` is a
// path inside the document; an empty field replaces the whole record (a
// primitive such as the plate index is stored in PRIMITIVE_FIELD). The
// canonical users record only takes field writes.
async function commit(firestore, writes) {
  const store = requireFirestore(firestore);
  const byDoc = new Map();
  for (const write of writes) {
    const id = docId(write.id);
    const key = `${write.collection}/${id}`;
    if (!byDoc.has(key)) byDoc.set(key, { collection: write.collection, ref: store.collection(write.collection).doc(id), fields: [] });
    const field = write.field === undefined || write.field === null || (Array.isArray(write.field) && !write.field.length)
      ? []
      : fieldSegments(write.field);
    byDoc.get(key).fields.push([field, write.value === undefined ? null : write.value]);
  }
  if (!byDoc.size) return;

  await store.runTransaction(async (tx) => {
    const docs = [...byDoc.values()];
    const current = await Promise.all(docs.map(doc => tx.get(doc.ref)));
    docs.forEach((doc, index) => {
      const raw = current[index].exists ? current[index].data() : null;
      const whole = doc.fields.find(([field]) => !field.length);
      if (whole) {
        if (doc.fields.length > 1) throw fail('DRIVER_DOCUMENT_STORE_FIELD_CONFLICT', 'Registro primitivo com campos');
        const value = normalize(clone(whole[1]));
        if (doc.collection === COLLECTIONS.users) {
          throw fail('DRIVER_DOCUMENT_STORE_CANONICAL_SET', 'Gravação do registro inteiro do usuário não suportada');
        }
        if (value === null) tx.delete(doc.ref);
        else if (typeof value === 'object' && !Array.isArray(value)) tx.set(doc.ref, fromView(value, raw ?? undefined));
        else tx.set(doc.ref, { [PRIMITIVE_FIELD]: value });
        return;
      }
      const paths = doc.fields.map(([field]) => field.join('\u0000'));
      if (paths.some((path, i) => paths.some((other, j) => i !== j && (other === path || other.startsWith(`${path}\u0000`))))) {
        throw fail('DRIVER_DOCUMENT_STORE_FIELD_CONFLICT', 'Campos sobrepostos na mesma gravação');
      }
      // A record left with no fields is deleted, as RTDB (and the router) did;
      // the canonical users record is never deleted here.
      if (doc.collection !== COLLECTIONS.users) {
        const next = doc.fields.reduce((view, [field, value]) => setIn(view, field, value), docView(raw));
        if (next === null || typeof next !== 'object') {
          if (raw) tx.delete(doc.ref);
          return;
        }
      }
      const data = {};
      const mergeFields = [];
      for (const [field, value] of doc.fields) {
        const next = normalize(clone(value));
        let cursor = data;
        field.slice(0, -1).forEach((segment) => { cursor = cursor[segment] || (cursor[segment] = {}); });
        cursor[field[field.length - 1]] = next === null
          ? FieldValue.delete()
          : fromView(next, getIn(raw, field) ?? undefined);
        mergeFields.push(new FieldPath(...field));
      }
      tx.set(doc.ref, data, { mergeFields });
    });
  });
}

// Updates from buildApprovedCrlvVehicleLinkUpdates ({ 'root/key/a': value }) as
// field writes on the native vehicle collections.
function vehicleLinkWrites(updates = {}) {
  return Object.entries(updates).map(([path, value]) => {
    const [root, id, ...field] = String(path).split('/').filter(Boolean);
    const collection = VEHICLE_LINK_ROOTS[root];
    if (!collection || !id) {
      throw fail('DRIVER_DOCUMENT_STORE_INVALID_FIELD', `Caminho de vínculo de veículo não suportado: ${path}`);
    }
    return { collection, id, field, value };
  });
}

// RTDB-style transaction on one lock field: updater(current) returns the next
// value, null to release, or undefined to abort.
async function transactLock(firestore, { driverId, documentType }, updater) {
  const ref = requireFirestore(firestore).collection(COLLECTIONS.locks).doc(docId(driverId));
  const field = fieldSegments(documentType)[0];
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const raw = snapshot.exists ? snapshot.data() : null;
    const current = normalize(clone(getIn(docView(raw), [field])));
    const next = updater(clone(current));
    if (next === undefined) return { committed: false, value: current };
    const value = normalize(clone(next));
    if (value === null) {
      if (!snapshot.exists) return { committed: true, value: null };
      if (!Object.keys(raw).some(key => key !== field)) tx.delete(ref);
      else tx.update(ref, new FieldPath(field), FieldValue.delete());
      return { committed: true, value: null };
    }
    tx.set(ref, { [field]: fromView(value, undefined) }, { mergeFields: [new FieldPath(field)] });
    return { committed: true, value };
  });
}

// Review queue counters per document type; never below zero.
async function adjustStats(firestore, documentType, deltas) {
  const entries = Object.entries(deltas || {}).filter(([, delta]) => Number(delta));
  if (!entries.length) return null;
  const ref = requireFirestore(firestore).collection(COLLECTIONS.stats).doc(docId(documentType));
  return firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists ? docView(snapshot.data()) || {} : {};
    const next = {};
    for (const [status, delta] of entries) {
      const parsed = Number.parseInt(current[status], 10);
      next[fieldSegments(status)[0]] = Math.max(0, (Number.isFinite(parsed) ? parsed : 0) + Number(delta));
    }
    tx.set(ref, next, { merge: true });
    return next;
  });
}

module.exports = {
  COLLECTIONS,
  activationField,
  userField,
  readActivation,
  readUser,
  listStats,
  readDocumentBinding,
  commit,
  vehicleLinkWrites,
  transactLock,
  adjustStats
};

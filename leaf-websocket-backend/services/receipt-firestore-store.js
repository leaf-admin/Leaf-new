'use strict';

// Firestore store for persisted receipts, the only receipt store (RTDB
// retired). The receipt body keeps its original shape; query fields live under
// `historyIndex` and are stripped on read.
const admin = require('firebase-admin');

const MAX_DOCUMENT_BYTES = 900 * 1024; // Firestore limit is 1 MiB per document.
const MAX_LEGACY_OFFSET = 200;

function fail(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

// Composite indexes: (historyIndex.customerId|driverId, historyIndex.listedAt
// desc), with historyIndex.contextId first for sandbox receipts.
function buildDocument(receiptData, scope, { ownerOf, timestampOf }) {
  const rideId = String(receiptData?.rideId || '').trim();
  if (!rideId || rideId.includes('/')) throw fail('RECEIPT_FIRESTORE_INVALID_ID', 'Recibo sem rideId válido');
  // JSON round-trip drops undefined values, which Firestore rejects.
  const body = JSON.parse(JSON.stringify(receiptData));
  const listedMs = Math.floor(Number(timestampOf(receiptData)));
  const document = {
    ...body,
    historyIndex: {
      schema: 1,
      customerId: ownerOf(receiptData, 'customer') || null,
      driverId: ownerOf(receiptData, 'driver') || null,
      namespace: scope.namespace,
      contextId: scope.financialContextId || receiptData.financialContextId || null,
      listedAt: admin.firestore.Timestamp.fromMillis(Number.isFinite(listedMs) && listedMs > 0 ? listedMs : Date.now())
    }
  };
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) {
    throw fail('RECEIPT_FIRESTORE_BYTE_BUDGET', 'Recibo excede o tamanho de documento do Firestore', 503);
  }
  return { rideId, document };
}

function readBody(data) {
  if (!data) return null;
  const { historyIndex: _index, ...receipt } = data;
  return receipt;
}

async function write(firestore, receiptData, scope, options) {
  if (!firestore) throw fail('RECEIPT_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o recibo', 503);
  const { rideId, document } = buildDocument(receiptData, scope, options);
  const ref = firestore.collection(scope.collections.receipts).doc(rideId);
  await firestore.runTransaction(async tx => {
    const current = await tx.get(ref);
    // Same rule as the RTDB index: a receipt never changes owner or context.
    if (current.exists) {
      const previous = current.data().historyIndex || {};
      for (const field of ['customerId', 'driverId', 'contextId']) {
        if ((previous[field] || null) !== (document.historyIndex[field] || null)) {
          throw fail('RECEIPT_FIRESTORE_OWNER_CONFLICT', 'Alteração de proprietário do recibo requer conciliação');
        }
      }
    }
    tx.set(ref, document);
  });
  return { mirrored: true, rideId };
}

async function getByRideId(firestore, scope, rideId) {
  if (!firestore) throw fail('RECEIPT_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o recibo', 503);
  const snapshot = await firestore.collection(scope.collections.receipts).doc(String(rideId)).get();
  return snapshot.exists ? readBody(snapshot.data()) : null;
}

function encodeCursor(doc) {
  const listedAt = doc.get('historyIndex.listedAt');
  return Buffer.from(JSON.stringify({ v: 1, t: listedAt.toMillis(), id: doc.id })).toString('base64url');
}

function decodeCursor(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 1024) throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (value.v !== 1 || !Number.isSafeInteger(value.t) || typeof value.id !== 'string' || !value.id || value.id.includes('/')) throw new Error();
    return value;
  } catch (_) {
    throw fail('RECEIPT_HISTORY_CURSOR_INVALID', 'Cursor de histórico inválido', 400);
  }
}

async function listPage(firestore, { scope, role, userId, limit, offset = 0, cursor = null, assertRecord, ownerOf }) {
  if (!firestore) throw fail('RECEIPT_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o recibo', 503);
  if (offset && cursor) throw fail('RECEIPT_HISTORY_CURSOR_INVALID', 'Use cursor ou offset, não ambos', 400);
  if (offset > MAX_LEGACY_OFFSET) throw fail('RECEIPT_HISTORY_REFRESH_REQUIRED', 'Atualize o histórico para continuar', 409);
  let query = firestore.collection(scope.collections.receipts)
    .where(`historyIndex.${role}Id`, '==', userId);
  if (scope.namespace === 'sandbox') query = query.where('historyIndex.contextId', '==', scope.financialContextId);
  const ordered = query.orderBy('historyIndex.listedAt', 'desc').orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  let page = ordered;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    page = page.startAfter(admin.firestore.Timestamp.fromMillis(decoded.t), decoded.id);
  } else if (offset) {
    page = page.offset(offset);
  }
  const [snapshot, count] = await Promise.all([page.limit(limit + 1).get(), query.count().get()]);
  const docs = snapshot.docs.slice(0, limit);
  const receipts = docs.map(doc => {
    const receipt = readBody(doc.data());
    assertRecord(receipt, scope);
    if (ownerOf(receipt, role) !== userId) throw fail('RECEIPT_HISTORY_OWNER_MISMATCH', 'Histórico requer conciliação', 503);
    return { ...receipt, rideId: receipt.rideId || doc.id };
  });
  const hasMore = snapshot.docs.length > limit;
  return {
    receipts, total: count.data().count, limit, offset,
    nextOffset: offset + receipts.length, hasMore,
    nextCursor: hasMore ? encodeCursor(docs[docs.length - 1]) : null,
    pagination: 'keyset', financialNamespace: scope.namespace
  };
}

module.exports = {
  buildDocument, readBody, write, getByRideId, listPage,
  encodeCursor, decodeCursor, MAX_DOCUMENT_BYTES, MAX_LEGACY_OFFSET
};

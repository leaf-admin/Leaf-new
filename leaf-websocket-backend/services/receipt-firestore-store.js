'use strict';

// Firestore mirror of the persisted receipt (RTDB exit, step 1). RTDB stays the
// source of truth until reads move here; this writer only adds the copy.
const admin = require('firebase-admin');

const MAX_DOCUMENT_BYTES = 900 * 1024; // Firestore limit is 1 MiB per document.
const enabledWrites = () => process.env.ENABLE_RECEIPT_FIRESTORE_WRITES === 'true';

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

// Top-level owner/time fields make the history queryable with composite
// indexes: (customerId|driverId, savedAt desc), plus financialContextId in sandbox.
function buildDocument(receiptData, scope, { ownerOf, timestampOf }) {
  const rideId = String(receiptData?.rideId || '').trim();
  if (!rideId || rideId.includes('/')) throw fail('RECEIPT_FIRESTORE_INVALID_ID', 'Recibo sem rideId válido');
  // JSON round-trip drops undefined values, which Firestore rejects.
  const body = JSON.parse(JSON.stringify(receiptData));
  const savedMs = Math.floor(Number(timestampOf(receiptData)));
  const document = {
    ...body,
    schema: 1,
    customerId: ownerOf(receiptData, 'customer') || null,
    driverId: ownerOf(receiptData, 'driver') || null,
    financialNamespace: scope.namespace,
    financialContextId: scope.financialContextId || receiptData.financialContextId || null,
    savedAt: admin.firestore.Timestamp.fromMillis(Number.isFinite(savedMs) && savedMs > 0 ? savedMs : Date.now()),
    mirroredFrom: 'rtdb'
  };
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT_BYTES) {
    throw fail('RECEIPT_FIRESTORE_BYTE_BUDGET', 'Recibo excede o tamanho de documento do Firestore');
  }
  return { rideId, document };
}

async function mirror(firestore, receiptData, scope, options) {
  if (!enabledWrites()) return { mirrored: false, reason: 'disabled' };
  if (!firestore) throw fail('RECEIPT_FIRESTORE_UNAVAILABLE', 'Firestore indisponível para o recibo');
  const { rideId, document } = buildDocument(receiptData, scope, options);
  const ref = firestore.collection(scope.collections.receipts).doc(rideId);
  await firestore.runTransaction(async tx => {
    const current = await tx.get(ref);
    // Same rule as the RTDB index: a receipt never changes owner or context.
    if (current.exists) {
      const previous = current.data();
      for (const field of ['customerId', 'driverId', 'financialContextId']) {
        if ((previous[field] || null) !== (document[field] || null)) {
          throw fail('RECEIPT_FIRESTORE_OWNER_CONFLICT', 'Alteração de proprietário do recibo requer conciliação');
        }
      }
    }
    tx.set(ref, document);
  });
  return { mirrored: true, rideId };
}

module.exports = { enabledWrites, buildDocument, mirror, MAX_DOCUMENT_BYTES };

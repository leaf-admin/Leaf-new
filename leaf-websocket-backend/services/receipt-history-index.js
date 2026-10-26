'use strict';
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const ROOT = 'receipt_history_v1';
const enabledWrites = () => process.env.ENABLE_RECEIPT_HISTORY_WRITES === 'true';
const enabledReads = () => process.env.ENABLE_RECEIPT_HISTORY_READS === 'true';
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

function ownerBase(scope, role, userId) {
  // Preserve the existing operational namespace and exact sandbox context.
  const context = scope.namespace === 'sandbox' ? hash(scope.financialContextId) : 'operational';
  return `${ROOT}/${scope.namespace}/${context}/${role}/${hash(userId)}`;
}

function compactReceipt(receipt) {
  const value = {
    receiptId: receipt.receiptId || null, rideId: String(receipt.rideId),
    completedAt: receipt.completedAt || null, savedAt: receipt.savedAt || null,
    issueDate: receipt.issueDate || null, savedTimestamp: receipt.savedTimestamp || null,
    financial: receipt.financial || {}, financialContext: receipt.financialContext,
    financialNamespace: receipt.financialNamespace, financialContextId: receipt.financialContextId,
    customer: { id: receipt.customer?.id || null, name: receipt.customer?.name || null },
    driver: { id: receipt.driver?.id || null, name: receipt.driver?.name || null,
      vehicle: { brandModel: receipt.driver?.vehicle?.brandModel || null, plate: receipt.driver?.vehicle?.plate || null } },
    trip: { dateTime: receipt.trip?.dateTime || null, distance: receipt.trip?.distance || {},
      duration: receipt.trip?.duration ?? null, pickup: { address: receipt.trip?.pickup?.address || null },
      dropoff: { address: receipt.trip?.dropoff?.address || null } },
    metadata: { authoritativeSnapshot: receipt.metadata?.authoritativeSnapshot === true,
      financialSnapshotSource: receipt.metadata?.financialSnapshotSource || null }
  };
  // No map, base64 or route geometry in the list projection.
  const clean = JSON.parse(JSON.stringify(value));
  if (Buffer.byteLength(JSON.stringify(clean)) > 8192) throw fail('RECEIPT_HISTORY_BYTE_BUDGET', 'Resumo do recibo excede orçamento', 503);
  return clean;
}

function buildUpdates(receipt, scope, { ownerOf, timestampOf }) {
  const compact = compactReceipt(receipt);
  const timestamp = Math.max(0, Math.min(9999999999999, Math.floor(timestampOf(receipt))));
  const itemKey = hash(receipt.rideId);
  const sortKey = `${String(timestamp).padStart(13, '0')}_${itemKey}`;
  const revision = randomUUID(); // Cursor generation, not a credential.
  const updates = {};
  for (const role of ['customer', 'driver']) {
    const owner = ownerOf(receipt, role);
    if (owner) compact[role].id = owner;
  }
  for (const role of ['customer', 'driver']) {
    const owner = ownerOf(receipt, role);
    if (!owner) continue;
    const base = ownerBase(scope, role, owner);
    updates[`${base}/items/${itemKey}`] = { sortKey, receipt: compact };
    updates[`${base}/meta/revision`] = revision;
    updates[`${base}/meta/schema`] = 1;
  }
  return updates;
}

async function claimIdentity(db, receipt, scope, { ownerOf }) {
  const identity = { customer: ownerOf(receipt, 'customer'), driver: ownerOf(receipt, 'driver'),
    context: scope.namespace === 'sandbox' ? scope.financialContextId : 'operational' };
  const path = `${ROOT}_identities/${scope.namespace}/${hash(receipt.rideId)}`;
  const result = await db.ref(path).transaction(current => {
    if (!current) return identity;
    return ['customer', 'driver', 'context'].every(key => current[key] === identity[key]) ? current : undefined;
  }, undefined, false);
  if (!result.committed) throw fail('RECEIPT_HISTORY_IDENTITY_CONFLICT', 'Identidade do recibo requer conciliação');
}

function decodeCursor(raw, base) {
  try {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error();
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (value.v !== 1 || value.scope !== hash(base) || !/^[0-9]{13}_[a-f0-9]{64}$/.test(value.key)
      || typeof value.revision !== 'string' || value.revision.length > 128) throw new Error();
    return value;
  } catch (_) { throw fail('RECEIPT_HISTORY_CURSOR_INVALID', 'Cursor de histórico inválido', 400); }
}

async function readPage({ db, scope, role, userId, limit, cursor, ownerOf, assertRecord }) {
  if (!enabledReads() || !enabledWrites()) {
    if (cursor) throw fail('RECEIPT_HISTORY_REFRESH_REQUIRED', 'Atualize o histórico para continuar');
    return null;
  }
  const base = ownerBase(scope, role, userId);
  const meta = (await db.ref(`${base}/meta`).once('value')).val();
  // New writes cannot attest that old receipts have already been migrated.
  if (meta?.ready !== true || meta.schema !== 1 || !meta.revision) {
    if (cursor) throw fail('RECEIPT_HISTORY_REFRESH_REQUIRED', 'Atualize o histórico para continuar');
    return null;
  }
  const decoded = cursor ? decodeCursor(cursor, base) : null;
  if (decoded && decoded.revision !== meta.revision) throw fail('RECEIPT_HISTORY_REFRESH_REQUIRED', 'Histórico atualizado; carregue novamente');
  let query = db.ref(`${base}/items`).orderByChild('sortKey');
  if (decoded) query = query.endBefore(decoded.key);
  const rows = Object.values((await query.limitToLast(limit + 1).once('value')).val() || {})
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const after = (await db.ref(`${base}/meta`).once('value')).val();
  if (after?.ready !== true || after.revision !== meta.revision) throw fail('RECEIPT_HISTORY_REFRESH_REQUIRED', 'Histórico atualizado; carregue novamente');
  for (const row of rows) {
    assertRecord(row.receipt, scope);
    if (ownerOf(row.receipt, role) !== userId) throw fail('RECEIPT_HISTORY_OWNER_MISMATCH', 'Histórico requer conciliação', 503);
  }
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, scope: hash(base), key: page[page.length - 1].sortKey,
    revision: meta.revision })).toString('base64url') : null;
  return { receipts: page.map(row => row.receipt), total: null, limit, offset: 0, nextOffset: null,
    hasMore, nextCursor, pagination: 'keyset', financialNamespace: scope.namespace };
}

module.exports = { ROOT, hash, ownerBase, compactReceipt, buildUpdates, claimIdentity, readPage,
  enabledReads, enabledWrites, decodeCursor };

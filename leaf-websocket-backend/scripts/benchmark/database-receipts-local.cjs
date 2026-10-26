#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const withPrivateRealtime = require('./private-rtdb.cjs');
const loadReceiptService = require('./isolated-receipt-service.cjs');
const history = require('../../services/receipt-history-index');
const { sealFinancialContext } = require('../../services/financial-runtime-context');
process.env.ENABLE_RECEIPT_HISTORY_WRITES = 'true';
process.env.ENABLE_RECEIPT_HISTORY_READS = 'true';

withPrivateRealtime(async db => {
  const service = loadReceiptService();
  const context = sealFinancialContext({ providerEnvironment: 'production' });
  const scope = { namespace: 'operational', financialContextId: context.contextId };
  const options = { ownerOf: service.resolveStoredReceiptOwnerId.bind(service), timestampOf: service.resolveStoredReceiptTimestamp.bind(service) };
  const base = history.ownerBase(scope, 'customer', 'passenger');
  const receipt = i => ({ hash: history.hash(i).slice(0, 32), rideId: `ride-${String(i).padStart(6, '0')}`, receiptId: `LEAF-${i}`,
    customer: { id: 'passenger', name: 'Synthetic passenger' }, driver: { id: 'driver', name: 'Synthetic driver' },
    trip: { dateTime: new Date(1710000000000 + i % 5 * 1000).toISOString(), distance: { actual: 2 }, duration: 5,
      pickup: { address: 'Synthetic A' }, dropoff: { address: 'Synthetic B' } },
    financial: { totalPaid: { amount: 30 }, breakdown: { driverAmount: { amount: 28.77 },
      operationalCost: { amount: 0.99 }, wooviFee: { amount: 0.24 } } }, financialContext: context,
    financialNamespace: 'operational', financialContextId: context.contextId,
    savedAt: '2026-10-26T00:00:00.000Z', mapImageBase64: 'x'.repeat(100000) });
  const calls = [];
  const measured = { ref: value => {
    const wrap = query => new Proxy(query, { get(target, method) {
      if (method === 'once') return async (...args) => {
        const snapshot = await target.once(...args);
        calls.push({ path: value, records: snapshot.numChildren(), bytes: Buffer.byteLength(JSON.stringify(snapshot.val())) });
        return snapshot;
      };
      if (['orderByChild', 'endBefore', 'limitToLast', 'equalTo', 'limitToFirst'].includes(method)) return (...args) => wrap(target[method](...args));
      return typeof target[method] === 'function' ? target[method].bind(target) : target[method];
    } });
    return wrap(db.ref(value));
  } };
  const rows = [];
  let previous = 0;
  for (const count of [10, 1000, 10000]) {
    if (count === 10) {
      for (let i = 0; i < 10; i++) await service.saveReceiptToFirestore(receipt(i), db);
    } else {
      for (let start = previous; start < count; start += 100) {
        const updates = {};
        for (let i = start; i < Math.min(count, start + 100); i++) {
          for (const [key, value] of Object.entries(history.buildUpdates(receipt(i), scope, options))) {
            if (key.startsWith(base)) updates[key] = value;
          }
        }
        await db.ref().update(updates);
      }
    }
    previous = count;
    // Synthetic fixture attestation only, never an automatic production marker.
    await db.ref(`${base}/meta/ready`).set(true);
    calls.length = 0;
    const page = await service.listStoredReceiptsByUser({ firebaseDb: measured, userId: 'passenger', role: 'customer',
      financialContext: context, limit: 10, pagination: 'cursor' });
    assert.equal(page.receipts.length, 10);
    assert.equal(page.total, null);
    assert.ok(!JSON.stringify(page).includes('mapImageBase64'));
    const items = calls.find(call => call.path.endsWith('/items'));
    assert.equal(items.records, Math.min(count, 11));
    rows.push({ totalHistory: count, returned: page.receipts.length, summariesRead: items.records,
      readRequests: calls.length, replyBytes: calls.reduce((sum, call) => sum + call.bytes, 0) });
  }
  let cursor = null;
  const seen = new Set();
  do {
    const page = await service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'passenger', role: 'customer',
      financialContext: context, limit: 50, pagination: 'cursor', cursor });
    for (const row of page.receipts) { assert.ok(!seen.has(row.rideId)); seen.add(row.rideId); }
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 10000);
  const first = await service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'passenger', financialContext: context, limit: 10, pagination: 'cursor' });
  await assert.rejects(service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'driver', role: 'driver',
    financialContext: context, cursor: first.nextCursor, pagination: 'cursor' }));
  const corrected = receipt(0); corrected.trip.dateTime = '2026-10-25T12:00:00Z';
  await service.saveReceiptToFirestore(corrected, db);
  await assert.rejects(service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'passenger', financialContext: context,
    cursor: first.nextCursor, pagination: 'cursor' }), /carregue novamente/);
  assert.equal((await db.ref(`${base}/items`).once('value')).numChildren(), 10000);
  const refreshed = await service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'passenger', financialContext: context, pagination: 'cursor' });
  assert.equal(refreshed.receipts[0].rideId, corrected.rideId);
  const wrongOwner = { ...corrected, customer: { id: 'other' } };
  await assert.rejects(service.saveReceiptToFirestore(wrongOwner, db), error => /proprietário/.test(error.cause?.message));
  const concurrent = receipt(10001);
  const race = await Promise.allSettled([service.saveReceiptToFirestore(concurrent, db),
    service.saveReceiptToFirestore({ ...concurrent, customer: { id: 'other' } }, db)]);
  assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
  const sandbox = sealFinancialContext({ providerEnvironment: 'sandbox', testUserSandbox: true, paymentProfileId: 'synthetic-qa' });
  const sandboxReceipt = { ...receipt(10002), financialContext: sandbox, financialNamespace: 'sandbox', financialContextId: sandbox.contextId };
  await service.saveReceiptToFirestore(sandboxReceipt, db);
  const sandboxBase = history.ownerBase({ namespace: 'sandbox', financialContextId: sandbox.contextId }, 'customer', 'passenger');
  await db.ref(`${sandboxBase}/meta/ready`).set(true);
  const sandboxPage = await service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'passenger', financialContext: sandbox, pagination: 'cursor' });
  assert.equal(sandboxPage.receipts.length, 1);
  assert.equal(sandboxPage.receipts[0].rideId, sandboxReceipt.rideId);
  // Legacy path is bounded even when the new reader is disabled.
  process.env.ENABLE_RECEIPT_HISTORY_READS = 'false';
  const legacy = {};
  for (let i = 0; i < 201; i++) legacy[`receipts/legacy-${i}`] = { customer: { id: 'legacy' } };
  await db.ref().update(legacy);
  await assert.rejects(service.listStoredReceiptsByUser({ firebaseDb: db, userId: 'legacy', financialContext: context }), /migração/);
  console.log(JSON.stringify({ environment: 'Private RTDB emulator4.11.2, cached JAR,256MiB heap, loopback, deny rules plus declared index; no ADC/provider access',
    rows, checks: ['All10000 IDs paged once including equal dates', 'Date correction updates same item and invalidates old cursor',
      'Owner change refused; concurrent first insert admits one identity', 'Sandbox remains in exact context', 'Legacy reads reject201 records'],
    limitations: ['Emulator query/response evidence; no billing/latency or production index parity evidence',
      'Large fixture seeds summary projection;10 receipts exercise canonical+projection atomic writer'] }, null, 2));
}).catch(error => { console.error(error); process.exitCode = 1; });

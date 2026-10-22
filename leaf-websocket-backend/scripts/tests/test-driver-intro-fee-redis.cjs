#!/usr/bin/env node
// Synthetic integration only: starts a private Redis with no TCP listener and
// uses an in-memory Firestore transaction adapter. No credentials are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Redis = require('ioredis');
const { DriverIntroFeeService, keyForDriver, CHECKPOINTS_KEY } = require('../../services/driver-intro-fee-service');
const { buildSeedState } = require('../../services/driver-intro-fee-state');
const { ACCEPT_CONTEXT, PERSIST_ACCEPTED_CONTEXT } = require('../../services/driver-intro-fee-redis');

const directory = fs.mkdtempSync('/tmp/leaf-intro-');
const socket = path.join(directory, 'redis.sock');
const generationKey = 'leaf:runtime:critical-dataset:generation';
const generation = 'synthetic-test-generation';
const cutoff = '2026-10-22T00:00:00Z';
const runtime = {
  DRIVER_INTRO_FEE_ENABLED: 'true', DRIVER_INTRO_FEE_HISTORY_CUTOFF: cutoff,
  REDIS_CRITICAL_DATASET_GENERATION: generation, KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction',
  REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true', REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true'
};
const documents = new Map();
const io = { reads: 0, writes: 0, fail: false, afterRead: null };
let transactionQueue = Promise.resolve();
// Documents are keyed by collection, so sandbox and operational never collide.
const snapshot = docKey => ({ exists: documents.has(docKey), data: () => structuredClone(documents.get(docKey)) });
const storedDoc = (driverId, collection = 'driver_intro_fee_states') => documents.get(`${collection}|${driverId}`);
const firestore = {
  collection: collection => ({ doc: id => {
    const driverId = decodeURIComponent(id.split('__')[1]);
    const docKey = `${collection}|${driverId}`;
    return { driverId: docKey, get: async () => { io.reads++; return snapshot(docKey); } };
  } }),
  runTransaction(callback) {
    const task = transactionQueue.then(async () => {
      if (io.fail) throw new Error('synthetic Firestore outage');
      return callback({
        get: async ref => {
          io.reads++;
          const result = snapshot(ref.driverId);
          const hook = io.afterRead;
          io.afterRead = null;
          if (hook) await hook();
          return result;
        },
        set: (ref, value) => { io.writes++; documents.set(ref.driverId, structuredClone(value)); }
      });
    });
    transactionQueue = task.catch(() => {});
    return task;
  }
};
const service = new DriverIntroFeeService({ getFirestore: () => firestore, env: () => runtime });
const child = spawn(process.env.LEAF_TEST_REDIS_SERVER || 'redis-server', [
  '--port', '0', '--unixsocket', socket, '--unixsocketperm', '700',
  '--save', '', '--appendonly', 'no', '--dir', directory
], { stdio: ['ignore', 'pipe', 'pipe'] });
let startupError;
let startupLog = '';
child.on('error', error => { startupError = error; });
child.stdout.on('data', chunk => { startupLog = (startupLog + chunk).slice(-3000); });
child.stderr.on('data', chunk => { startupLog = (startupLog + chunk).slice(-3000); });
const redis = new Redis({ path: socket, lazyConnect: true, retryStrategy: times => times < 100 ? 20 : null, maxRetriesPerRequest: 1 });
redis.on('error', () => {});
const results = [];

// Execute the exact new fragments embedded in AcceptRideCommand's existing CAS.
// Ownership/KYC gates in that CAS remain covered by its command unit suite.
const acceptScript = `
local bookingKey = KEYS[1]
local datasetGenerationKey = KEYS[8]
local offerReservationKey = KEYS[9]
local driverId = ARGV[1]
local bookingId = ARGV[5]
${ACCEPT_CONTEXT}
redis.call('HSET', bookingKey, 'driverId', driverId, 'status', 'ACCEPTED', 'state', 'ACCEPTED')
${PERSIST_ACCEPTED_CONTEXT}
return 'OK'
`;

async function seed(count = 24, driverId = 'driver-1') {
  const state = { ...buildSeedState({ driverId, qualifiedCompletedRides: count, historySnapshotId: 'synthetic-history', historyThrough: cutoff }), approvedGeneration: generation };
  documents.set(`driver_intro_fee_states|${driverId}`, state);
  await redis.set(generationKey, generation);
  const context = await service.resolveOfferContext(redis, driverId, {});
  return context;
}

async function accept(bookingId, { driverId = 'driver-1', context } = {}) {
  const fee = context || await service.resolveOfferContext(redis, driverId, {});
  const reservation = `offer_reservation:${bookingId}:${driverId}`;
  await redis.set(reservation, JSON.stringify({ driverIntroFee: fee, estimatedFareSnapshot: {
    estimatedOperationalFee: fee.eligible ? 0.99 : 1.49, estimatedPaymentIntermediationFee: 0.24,
    estimatedTotalFees: fee.eligible ? 1.23 : 1.73, estimatedDriverNetAmount: fee.eligible ? 28.77 : 28.27
  } }));
  const keys = Array.from({ length: 13 }, (_, i) => `unused:${i}`);
  keys[0] = `booking:${bookingId}`;
  keys[7] = generationKey;
  keys[8] = reservation;
  keys[11] = keyForDriver(driverId);
  keys[12] = keyForDriver(driverId, 'sandbox');
  return redis.eval(acceptScript, 13, ...keys, driverId, 'ACCEPTED', '', '', bookingId, '', '', '', '', '', runtime.DRIVER_INTRO_FEE_ENABLED === 'true' ? '1' : '0');
}

async function terminal(bookingId, outcome = { qualified: true }, status = 'COMPLETED') {
  await redis.hset(`booking:${bookingId}`, 'status', status, 'state', status, 'driverIntroFeeCompletion', JSON.stringify(outcome));
  return service.recordCompletion(redis, 'driver-1', bookingId);
}

async function check(name, callback) {
  await redis.flushdb(); // This connection has only the private socket above.
  documents.clear();
  Object.assign(io, { reads: 0, writes: 0, fail: false, afterRead: null });
  runtime.DRIVER_INTRO_FEE_ENABLED = 'true';
  service.checkpointCursors = { operational: '0', sandbox: '0' };
  service.getAuth = () => ({ getUser: async () => { throw new Error('auth not stubbed'); } });
  await callback();
  results.push(name);
}

async function main() {
  for (let attempt = 0; !fs.existsSync(socket); attempt++) {
    if (startupError) throw startupError;
    if (attempt >= 100 || child.exitCode !== null) throw new Error(`Private Redis did not start: ${startupLog}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await redis.connect();
  if (startupError) throw startupError;
  assert.equal(fs.realpathSync((await redis.config('GET', 'dir'))[1]), fs.realpathSync(directory));
  await check('24 -> 25, 100 concurrent replays consume one slot; next offer uses current table', async () => {
    const offer = await seed();
    assert.equal(await accept('last-slot', { context: offer }), 'OK');
    await redis.hset('booking:last-slot', 'status', 'COMPLETED', 'state', 'COMPLETED', 'driverIntroFeeCompletion', JSON.stringify({ qualified: true }));
    const values = await Promise.all(Array.from({ length: 100 }, () => service.recordCompletion(redis, 'driver-1', 'last-slot')));
    assert(values.every(value => value.qualifiedCompletedRides === 25));
    assert.equal(values[0].completedBookingIds.length, 1);
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).eligible, false);
    assert.equal(io.reads, 1);
    assert.equal(io.writes, 0);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 1);
    assert.deepEqual(await service.flushPendingCheckpoints(redis), { processed: 1, failed: 0 });
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 25);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
    assert.equal(io.writes, 1);
    assert.equal(await accept('later'), 'OK');
    await terminal('later');
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
    assert.equal(io.writes, 1);
  });
  await check('stale last-slot offer cannot be accepted after another ride consumes it', async () => {
    const stale = await seed();
    assert.equal(await accept('winner'), 'OK');
    await terminal('winner');
    assert.equal(await accept('stale', { context: stale }), 'ERR_INTRO_FEE_STALE_OFFER');
    assert.equal(await redis.exists('booking:stale'), 0);
  });
  await check('two simultaneous accepts cannot claim the same driver counter', async () => {
    const context = await seed();
    const outcomes = await Promise.all(['race-a', 'race-b'].map(bookingId => accept(bookingId, { context })));
    assert.equal(outcomes.filter(value => value === 'OK').length, 1);
    assert.equal(outcomes.filter(value => value === 'ERR_INTRO_FEE_STALE_OFFER').length, 1);
  });
  await check('cancelled and early-ended rides release the slot without consuming quota', async () => {
    await seed(0);
    await accept('cancelled');
    assert.equal((await terminal('cancelled', { qualified: false }, 'CANCELED')).qualifiedCompletedRides, 0);
    await accept('early');
    assert.equal((await terminal('early', { qualified: false, reason: 'EARLY_END' })).qualifiedCompletedRides, 0);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).eligible, true);
  });
  await check('other terminal aliases release or count the slot like RideStateManager', async () => {
    await seed(0);
    for (const status of ['TRIP_CANCELED', 'SUPERSEDED', 'EXPIRED']) {
      await accept(`alias-${status}`);
      assert.equal((await terminal(`alias-${status}`, { qualified: false }, status)).qualifiedCompletedRides, 0);
    }
    await accept('alias-trip-completed');
    assert.equal((await terminal('alias-trip-completed', { qualified: true }, 'TRIP_COMPLETED')).qualifiedCompletedRides, 1);
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).eligible, true);
  });
  await check('a new owner without context clears the previous driver context', async () => {
    await seed();
    await accept('handover');
    await redis.hset('booking:handover', 'state', 'SEARCHING');
    const keys = Array.from({ length: 13 }, (_, i) => `unused:${i}`);
    keys[0] = 'booking:handover';
    keys[7] = generationKey;
    keys[8] = 'offer_reservation:handover:driver-2';
    keys[11] = keyForDriver('driver-2');
    keys[12] = keyForDriver('driver-2', 'sandbox');
    await redis.set(keys[8], JSON.stringify({ status: 'AWAITING_RESPONSE' }));
    await redis.hset('booking:handover', 'financialNamespace', 'sandbox');
    assert.equal(await redis.eval(acceptScript, 13, ...keys, 'driver-2', 'ACCEPTED', '', '', 'handover', '', '', '', '', '', '1'), 'OK');
    assert.equal(await redis.hget('booking:handover', 'driverIntroFee'), null);
    assert.equal(await redis.hget('booking:handover', 'driverId'), 'driver-2');
  });
  await check('sandbox (QA) rides use their own counter and collection; operational stays untouched', async () => {
    const operational = await seed(24);
    const { sealFinancialContext } = require('../../services/financial-runtime-context');
    const sandboxBooking = { financialContext: JSON.stringify(sealFinancialContext({ providerEnvironment: 'sandbox' })) };
    service.getAuth = () => ({ getUser: async () => ({ metadata: { creationTime: cutoff } }) });
    const context = await service.resolveOfferContext(redis, 'driver-1', sandboxBooking);
    assert.equal(context.namespace, 'sandbox');
    assert.equal(context.qualifiedCompletedRides, 0);
    await redis.hset('booking:qa-ride', 'financialNamespace', 'sandbox', 'financialContext', sandboxBooking.financialContext);
    assert.equal(await accept('qa-ride', { context }), 'OK');
    await redis.hset('booking:qa-ride', 'status', 'COMPLETED', 'state', 'COMPLETED', 'driverIntroFeeCompletion', JSON.stringify({ qualified: true }));
    const after = await service.recordCompletion(redis, 'driver-1', 'qa-ride', 'sandbox');
    assert.equal(after.qualifiedCompletedRides, 1);
    assert.equal(JSON.parse(await redis.get(keyForDriver('driver-1'))).qualifiedCompletedRides, 24);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
    await service.flushPendingCheckpoints(redis);
    assert.equal(storedDoc('driver-1', 'sandbox_driver_intro_fee_states').qualifiedCompletedRides, 1);
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 24);
    // An operational offer cannot be accepted on a sandbox booking, and vice versa.
    await redis.hset('booking:mixed', 'financialNamespace', 'sandbox');
    assert.equal(await accept('mixed', { context: operational }), 'ERR_INTRO_FEE_STALE_OFFER');
  });
  await check('a ride that lost its driver (back to dispatch or expired) releases the slot without counting', async () => {
    await seed(24);
    await accept('lost-owner');
    // Disconnect before start: the booking goes back to SEARCHING without a driver.
    await redis.hdel('booking:lost-owner', 'driverId');
    await redis.hset('booking:lost-owner', 'state', 'SEARCHING', 'status', 'SEARCHING');
    const context = await service.resolveOfferContext(redis, 'driver-1', {});
    assert.equal(context.eligible, true);
    assert.equal(context.qualifiedCompletedRides, 24);
    assert.equal(JSON.parse(await redis.get(keyForDriver('driver-1'))).inflightBookingId, undefined);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
    // Expired booking hash: same release.
    assert.equal(await accept('expired'), 'OK');
    await redis.del('booking:expired');
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).qualifiedCompletedRides, 24);
  });
  await check('terminal-state crash is repaired before the next offer; active ride stays reserved', async () => {
    await seed();
    await accept('crashed');
    await assert.rejects(service.resolveOfferContext(redis, 'driver-1', {}), { code: 'DRIVER_INTRO_FEE_ERR_RIDE_ACTIVE' });
    await redis.hset('booking:crashed', 'status', 'COMPLETED', 'driverIntroFeeCompletion', JSON.stringify({ qualified: true }));
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).eligible, false);
    assert.equal(await redis.hget('booking:crashed', 'driverIntroFeeCompletionRecorded'), 'true');
  });
  await check('unavailable destination proof holds financial eligibility for review', async () => {
    await seed();
    await accept('unverified');
    const state = await terminal('unverified', { qualified: false, reviewRequired: true });
    assert.equal(state.qualifiedCompletedRides, 24);
    await assert.rejects(service.resolveOfferContext(redis, 'driver-1', {}), { code: 'DRIVER_INTRO_FEE_HISTORY_REVIEW_REQUIRED' });
    await service.flushPendingCheckpoints(redis);
    assert.equal(storedDoc('driver-1').reviewRequiredBookingId, 'unverified');
  });
  await check('Firestore outage keeps a retryable checkpoint; a retry cannot decrement the count', async () => {
    await seed();
    await accept('offline-store');
    await terminal('offline-store');
    io.fail = true;
    assert.deepEqual(await service.flushPendingCheckpoints(redis), { processed: 0, failed: 1 });
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 1);
    io.fail = false;
    await service.flushPendingCheckpoints(redis);
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 25);
  });
  await check('checkpoint acknowledgement cannot erase a newer concurrent completion', async () => {
    await seed(23);
    await accept('first');
    await terminal('first');
    io.afterRead = async () => { await accept('second'); await terminal('second'); };
    await service.flushPendingCheckpoints(redis);
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 24);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 1);
    await service.flushPendingCheckpoints(redis);
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 25);
    assert.equal(await redis.hlen(CHECKPOINTS_KEY), 0);
  });
  await check('counter loss restores a pending snapshot but never an older durable count', async () => {
    await seed();
    await accept('pending');
    await terminal('pending');
    await redis.del(keyForDriver('driver-1'));
    assert.equal((await service.resolveOfferContext(redis, 'driver-1', {})).qualifiedCompletedRides, 25);
    await service.flushPendingCheckpoints(redis);
    await redis.del(keyForDriver('driver-1'));
    await assert.rejects(service.resolveOfferContext(redis, 'driver-1', {}), { code: 'DRIVER_INTRO_FEE_RECOVERY_REQUIRED' });
  });
  await check('generation loss or expiring marker prevents new accepts and counting', async () => {
    const context = await seed();
    await redis.expire(generationKey, 60);
    assert.equal(await accept('bad-generation', { context }), 'ERR_INTRO_FEE_STATE');
    await redis.del(generationKey);
    await assert.rejects(service.recordCompletion(redis, 'driver-1', 'bad-generation'), { code: 'DRIVER_INTRO_FEE_ERR_GENERATION' });
  });
  await check('feature rollback preserves accepted fees and flushes existing counters', async () => {
    await seed();
    await accept('accepted-before-rollback');
    runtime.DRIVER_INTRO_FEE_ENABLED = 'false';
    assert.equal(await service.resolveOfferContext(redis, 'driver-1', {}), null);
    await terminal('accepted-before-rollback');
    await service.flushPendingCheckpoints(redis);
    const stored = JSON.parse(await redis.hget('booking:accepted-before-rollback', 'driverIntroFee'));
    assert.equal(stored.operationalFeeCents, 99);
    assert.equal(storedDoc('driver-1').qualifiedCompletedRides, 25);
  });
  console.log(JSON.stringify({ ok: true, cases: results.length, storage: 'private local Redis', firestore: 'in-memory transaction adapter', results }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  redis.disconnect();
  child.kill('SIGTERM');
  await new Promise(resolve => !child.pid || child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve));
  fs.rmSync(directory, { recursive: true, force: true });
});

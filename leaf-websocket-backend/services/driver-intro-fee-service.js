const { DRIVER_INTRO_FEE_POLICY, buildDriverIntroFeeContext, normalizeDriverIntroFeeContext } = require('./driver-intro-fee-policy');
const { buildSeedState, mergeCheckpoint, normalizeState, parseObject, fail } = require('./driver-intro-fee-state');
const { INSTALL_STATE, RECORD_COMPLETION, ACK_CHECKPOINT } = require('./driver-intro-fee-redis');
const { resolveFinancialContext } = require('./financial-runtime-context');
const { configErrors, validHistoryCutoff } = require('./driver-intro-fee-config');

const CHECKPOINTS_KEY = 'driver_intro_fee:pending_checkpoints';
const COLLECTION = 'driver_intro_fee_states';
const keyForDriver = driverId => `driver_intro_fee:operational:${encodeURIComponent(driverId)}`;

function operationalNamespace(booking = {}) {
  const result = resolveFinancialContext(booking, { allowLegacyOperational: true });
  if (!result.ok) fail(result.code);
  return result.context.namespace === 'operational';
}

function acceptedContext(booking = {}, driverId = booking.driverId || booking.driver) {
  let stored = booking.driverIntroFee;
  if (!stored && booking.financialSnapshot) {
    try { stored = parseObject(booking.financialSnapshot)?.driverIntroFee; } catch (_) { return null; }
  }
  if (!stored) return null;
  const context = normalizeDriverIntroFeeContext(parseObject(stored));
  if (context.driverId !== driverId || !operationalNamespace(booking)) fail('DRIVER_INTRO_FEE_DRIVER_MISMATCH');
  return context;
}

class DriverIntroFeeService {
  constructor({ getFirestore, getAuth, env = () => process.env } = {}) {
    this.getFirestore = getFirestore || (() => require('../firebase-config').getFirestore());
    this.getAuth = getAuth || (() => require('firebase-admin').auth());
    this.env = env;
    this.checkpointCursor = '0';
  }

  enabled() { return this.env().DRIVER_INTRO_FEE_ENABLED === 'true'; }

  config() {
    const env = this.env();
    const generation = String(env.REDIS_CRITICAL_DATASET_GENERATION || '').trim();
    const cutoff = String(env.DRIVER_INTRO_FEE_HISTORY_CUTOFF || '').trim();
    if (!generation || !validHistoryCutoff(cutoff)) fail('DRIVER_INTRO_FEE_CONFIG_REQUIRED');
    return { generation, cutoff, generationKey: env.REDIS_CRITICAL_DATASET_GENERATION_KEY || 'leaf:runtime:critical-dataset:generation' };
  }

  document(driverId) {
    const firestore = this.getFirestore();
    if (!firestore) fail('DRIVER_INTRO_FEE_STORE_UNAVAILABLE');
    return firestore.collection(COLLECTION).doc(`${DRIVER_INTRO_FEE_POLICY.policyId}__${encodeURIComponent(driverId)}`);
  }

  async loadState(redis, driverId) {
    const config = this.config();
    const key = keyForDriver(driverId);
    const raw = await redis.get(key);
    if (raw) {
      const state = normalizeState(raw);
      if (state.generation !== config.generation || state.driverId !== driverId
        || Date.parse(state.historyThrough) < Date.parse(config.cutoff)) fail('DRIVER_INTRO_FEE_RECOVERY_REQUIRED');
      return state;
    }
    // A cache entry that was already used must not be replaced with an older
    // Firestore checkpoint. Pending snapshots are replayed from the same Redis.
    const pending = await redis.hget(CHECKPOINTS_KEY, key);
    let state;
    if (pending) state = normalizeState(pending);
    else {
      if (await redis.exists(`${key}:loaded`)) fail('DRIVER_INTRO_FEE_RECOVERY_REQUIRED');
      const ref = this.document(driverId);
      const snapshot = await ref.get();
      if (snapshot.exists) state = normalizeState(snapshot.data());
      else {
        const user = await this.getAuth().getUser(driverId);
        const createdAt = user?.metadata?.creationTime;
        if (!createdAt || Date.parse(createdAt) < Date.parse(config.cutoff)) fail('DRIVER_INTRO_FEE_HISTORY_UNINITIALIZED');
        if (!Number.isFinite(Date.parse(createdAt))) fail('DRIVER_INTRO_FEE_HISTORY_UNINITIALIZED');
        const seed = { ...buildSeedState({ driverId, qualifiedCompletedRides: 0, historySnapshotId: `auth-registration:${driverId}:${new Date(createdAt).toISOString()}`, historyThrough: new Date(createdAt).toISOString() }), approvedGeneration: config.generation };
        state = await this.getFirestore().runTransaction(async transaction => {
          const existing = await transaction.get(ref);
          if (existing.exists) return normalizeState(existing.data());
          transaction.set(ref, seed);
          return seed;
        });
      }
    }
    if (state.driverId !== driverId) fail('DRIVER_INTRO_FEE_DRIVER_MISMATCH');
    if (state.approvedGeneration !== config.generation
      || Date.parse(state.historyThrough) < Date.parse(config.cutoff)) fail('DRIVER_INTRO_FEE_RECOVERY_REQUIRED');
    const installed = await redis.eval(INSTALL_STATE, 4, key, `${key}:loaded`, CHECKPOINTS_KEY, config.generationKey,
      config.generation, JSON.stringify({ ...state, generation: config.generation }));
    if (String(installed).startsWith('ERR_')) fail(`DRIVER_INTRO_FEE_${installed}`);
    return normalizeState(installed);
  }

  async resolveOfferContext(redis, driverId, booking) {
    if (!this.enabled() || !operationalNamespace(booking)) return null;
    if (configErrors(this.env()).length) fail('DRIVER_INTRO_FEE_CONFIG_REQUIRED');
    const config = this.config();
    if (await redis.get(config.generationKey) !== config.generation) fail('DRIVER_INTRO_FEE_RECOVERY_REQUIRED');
    let state = await this.loadState(redis, driverId);
    if (state.inflightBookingId) {
      // Repairs a crash between terminal state persistence and counting/unlock.
      // Active rides cannot release their slot through this path.
      state = await this.recordCompletion(redis, driverId, state.inflightBookingId);
    }
    if (state.reviewRequiredBookingId) fail('DRIVER_INTRO_FEE_HISTORY_REVIEW_REQUIRED');
    return buildDriverIntroFeeContext(state);
  }

  async recordCompletion(redis, driverId, bookingId) {
    const config = this.config();
    const result = await redis.eval(RECORD_COMPLETION, 4, keyForDriver(driverId), CHECKPOINTS_KEY, `booking:${bookingId}`, config.generationKey,
      config.generation, driverId, bookingId);
    if (String(result).startsWith('ERR_')) fail(`DRIVER_INTRO_FEE_${result}`);
    return normalizeState(result);
  }

  async recordTerminalBooking(redis, bookingId, booking) {
    try {
      const context = acceptedContext(booking);
      if (!context) return null;
      return await this.recordCompletion(redis, context.driverId, bookingId);
    } catch (error) {
      // Physical closeout must finish. The inflight marker remains reserved and
      // dispatch will repair the terminal booking before offering another ride.
      require('../utils/logger').logStructured('error', 'Reserva promocional aguardando retry de encerramento', {
        service: 'driver-intro-fee', code: error.code || 'TERMINAL_COUNT_PENDING'
      });
      return null;
    }
  }

  async flushPendingCheckpoints(redis, limit = 30) {
    // Called by the existing finalization outbox processor, including after the
    // feature is disabled. Accepted rides and queued checkpoints still settle.
    const stats = { processed: 0, failed: 0 };
    if (typeof redis?.hscan !== 'function') return stats;
    const [cursor, entries] = await redis.hscan(CHECKPOINTS_KEY, this.checkpointCursor, 'COUNT', Math.max(1, limit));
    this.checkpointCursor = cursor;
    for (let index = 0; index < entries.length && index < limit * 2; index += 2) {
      const [key, raw] = entries.slice(index, index + 2);
      try {
        const incoming = normalizeState(raw);
        if (key !== keyForDriver(incoming.driverId)) fail('DRIVER_INTRO_FEE_CHECKPOINT_CONFLICT');
        const ref = this.document(incoming.driverId);
        await this.getFirestore().runTransaction(async transaction => {
          const stored = await transaction.get(ref);
          if (!stored.exists) fail('DRIVER_INTRO_FEE_HISTORY_UNINITIALIZED');
          const merged = mergeCheckpoint(stored.data(), incoming);
          const existing = normalizeState(stored.data());
          if (JSON.stringify(merged) !== JSON.stringify(existing)) transaction.set(ref, merged);
        });
        await redis.eval(ACK_CHECKPOINT, 1, CHECKPOINTS_KEY, key, raw);
        stats.processed += 1;
      } catch (error) {
        stats.failed += 1;
        require('../utils/logger').logStructured('error', 'Falha ao persistir contador promocional; checkpoint mantido para retry', {
          service: 'driver-intro-fee', code: error.code || 'CHECKPOINT_FAILED'
        });
      }
    }
    return stats;
  }
}

module.exports = new DriverIntroFeeService();
module.exports.DriverIntroFeeService = DriverIntroFeeService;
module.exports.acceptedContext = acceptedContext;
module.exports.keyForDriver = keyForDriver;
module.exports.CHECKPOINTS_KEY = CHECKPOINTS_KEY;

const { DriverIntroFeeService, acceptedContext } = require('../../../services/driver-intro-fee-service');
const { buildSeedState } = require('../../../services/driver-intro-fee-state');

const generation = 'test-generation';
const env = { DRIVER_INTRO_FEE_ENABLED: 'true', DRIVER_INTRO_FEE_HISTORY_CUTOFF: '2026-10-22T00:00:00Z', REDIS_CRITICAL_DATASET_GENERATION: generation,
  KYC_ACTIVE_TRIP_AUTHORITY_MODE: 'redis_noeviction', REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED: 'true', REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED: 'true' };
const initial = () => ({ ...buildSeedState({ driverId: 'driver-1', qualifiedCompletedRides: 24, historySnapshotId: 'history-1', historyThrough: env.DRIVER_INTRO_FEE_HISTORY_CUTOFF }), approvedGeneration: generation });
function setup(overrides = {}) {
  const ref = { get: jest.fn().mockResolvedValue({ exists: true, data: initial }) };
  const tx = { get: jest.fn().mockResolvedValue({ exists: true, data: initial }), set: jest.fn() };
  const firestore = { collection: jest.fn(() => ({ doc: jest.fn(() => ref) })), runTransaction: jest.fn(callback => callback(tx)) };
  const auth = { getUser: jest.fn() };
  const service = new DriverIntroFeeService({ getFirestore: () => firestore, getAuth: () => auth, env: () => ({ ...env, ...overrides }) });
  const redis = { get: jest.fn(key => Promise.resolve(key.includes('generation') ? generation : null)), hget: jest.fn().mockResolvedValue(null), exists: jest.fn().mockResolvedValue(0), eval: jest.fn(async (_script, _count, ...args) => args[args.length - 1]) };
  return { service, redis, ref, firestore, auth, tx };
}

describe('introductory fee service boundaries', () => {
  it('makes no reads or writes while disabled', async () => {
    const { service, redis, firestore } = setup({ DRIVER_INTRO_FEE_ENABLED: 'false' });
    expect(await service.resolveOfferContext(redis, 'driver-1', {})).toBe(null);
    expect(redis.get).not.toHaveBeenCalled();
    expect(firestore.collection).not.toHaveBeenCalled();
  });
  it('uses verified cached state without Firestore on the offer path', async () => {
    const { service, redis, firestore } = setup();
    redis.get.mockImplementation(key => Promise.resolve(key.includes('generation') ? generation : JSON.stringify({ ...initial(), generation })));
    expect(await service.resolveOfferContext(redis, 'driver-1', {})).toMatchObject({ eligible: true, qualifiedCompletedRides: 24, operationalFeeCents: 99 });
    expect(firestore.collection).not.toHaveBeenCalled();
  });
  it('hydrates a never-used counter from a verified durable checkpoint', async () => {
    const { service, redis, ref } = setup();
    expect(await service.resolveOfferContext(redis, 'driver-1', {})).toMatchObject({ eligible: true });
    expect(ref.get).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a lost used counter with a stale checkpoint', async () => {
    const { service, redis, ref } = setup();
    redis.exists.mockResolvedValue(1);
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_RECOVERY_REQUIRED' });
    expect(ref.get).not.toHaveBeenCalled();
  });
  it('refuses a checkpoint approved for an old Redis generation', async () => {
    const { service, redis, ref } = setup();
    ref.get.mockResolvedValue({ exists: true, data: () => ({ ...initial(), approvedGeneration: 'old-generation' }) });
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_RECOVERY_REQUIRED' });
    expect(redis.eval).not.toHaveBeenCalled();
  });
  it('refuses old accounts without initialized history rather than assuming zero', async () => {
    const { service, redis, ref, auth, tx } = setup();
    ref.get.mockResolvedValue({ exists: false });
    auth.getUser.mockResolvedValue({ metadata: { creationTime: '2026-01-01T00:00:00Z' } });
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_HISTORY_UNINITIALIZED' });
    expect(tx.set).not.toHaveBeenCalled();
  });
  it('initializes a genuinely new account once in a transaction', async () => {
    const { service, redis, ref, auth, tx } = setup();
    ref.get.mockResolvedValue({ exists: false });
    tx.get.mockResolvedValue({ exists: false });
    auth.getUser.mockResolvedValue({ metadata: { creationTime: '2026-10-22T01:00:00Z' } });
    expect(await service.resolveOfferContext(redis, 'driver-1', {})).toMatchObject({ qualifiedCompletedRides: 0, eligible: true });
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set.mock.calls[0][1]).toMatchObject({ approvedGeneration: generation, baselineCount: 0 });
  });
  it('counts sandbox (QA) rides on a separate counter and collection, never the operational one', async () => {
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const { service, redis, ref, firestore, auth, tx } = setup();
    ref.get.mockResolvedValue({ exists: false });
    tx.get.mockResolvedValue({ exists: false });
    auth.getUser.mockResolvedValue({ metadata: { creationTime: '2026-10-22T01:00:00Z' } });
    const booking = { financialContext: sealFinancialContext({ providerEnvironment: 'sandbox' }) };
    expect(await service.resolveOfferContext(redis, 'driver-1', booking))
      .toMatchObject({ namespace: 'sandbox', eligible: true, qualifiedCompletedRides: 0, operationalFeeCents: 99 });
    const stateKeys = redis.get.mock.calls.map(([key]) => key).filter(key => key.startsWith('driver_intro_fee:'));
    expect(stateKeys).toEqual(['driver_intro_fee:sandbox:driver-1']);
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_driver_intro_fee_states');
    expect(firestore.collection).not.toHaveBeenCalledWith('driver_intro_fee_states');
    expect(redis.hget).toHaveBeenCalledWith('driver_intro_fee:sandbox:pending_checkpoints', 'driver_intro_fee:sandbox:driver-1');
    expect(tx.set.mock.calls[0][1]).toMatchObject({ namespace: 'sandbox', baselineCount: 0 });
  });
  it('rejects an accepted context whose namespace differs from the booking', () => {
    const { sealFinancialContext } = require('../../../services/financial-runtime-context');
    const operational = initial();
    expect(() => acceptedContext({ driverId: 'driver-1', driverIntroFee: operational,
      financialContext: sealFinancialContext({ providerEnvironment: 'sandbox' }) })).toThrow();
  });
  it('queues review without changing the account status', async () => {
    const { service, redis } = setup();
    redis.get.mockImplementation(key => Promise.resolve(key.includes('generation') ? generation : JSON.stringify({ ...initial(), generation, reviewRequiredBookingId: 'missing-proof' })));
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_HISTORY_REVIEW_REQUIRED' });
    expect(redis.eval).not.toHaveBeenCalled();
  });
  it('keeps the accepted context when the promotion flag is later disabled', () => {
    expect(acceptedContext({ driverId: 'driver-1', driverIntroFee: JSON.stringify(initial()) }))
      .toMatchObject({ operationalFeeCents: 99, eligible: true });
    expect(() => acceptedContext({ driverId: 'driver-other', driverIntroFee: initial() })).toThrow();
  });
  it('reads the frozen context from a persisted financial snapshot and legacy driver field', () => {
    expect(acceptedContext({ driver: 'driver-1', financialSnapshot: JSON.stringify({ driverIntroFee: initial() }) }))
      .toMatchObject({ driverId: 'driver-1', operationalFeeCents: 99 });
    expect(acceptedContext({ driver: 'driver-1', financialSnapshot: 'legacy-invalid-json' })).toBe(null);
  });
  it('requires a newly reconciled history cutoff after a rollback window', async () => {
    const { service, redis } = setup({ DRIVER_INTRO_FEE_HISTORY_CUTOFF: '2026-10-23T00:00:00Z' });
    redis.get.mockImplementation(key => Promise.resolve(key.includes('generation') ? generation : JSON.stringify({ ...initial(), generation })));
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_RECOVERY_REQUIRED' });
  });
  it('does not grant an offer if the generation marker is absent', async () => {
    const { service, redis, ref } = setup();
    redis.get.mockResolvedValue(null);
    await expect(service.resolveOfferContext(redis, 'driver-1', {})).rejects.toMatchObject({ code: 'DRIVER_INTRO_FEE_RECOVERY_REQUIRED' });
    expect(ref.get).not.toHaveBeenCalled();
  });
});

const migration = require('../../../scripts/maintenance/database-read-models.cjs');
const newUsers = require('../../../services/new-user-read-models');

describe('maintenance boundaries', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterAll(() => { process.env = originalEnv; });

  test('checkpoint cannot be reused on a different source', () => {
    expect(() => migration.cursorFor({ schema: 1, source: 'rides', lastKey: 'a' }, 'sandbox_rides')).toThrow('scope');
  });

  test('write mode requires an explicit maintenance reference before any database call', async () => {
    await expect(migration.metricBatch({ firestore: {}, collection: 'rides', apply: true })).rejects.toThrow('authorization');
    await expect(migration.receiptBatch({ db: {}, apply: true })).rejects.toThrow('authorization');
  });

  test('streaming parity is insensitive to ordering and sensitive to duplicates', () => {
    const a = migration.parityAccumulator(); const b = migration.parityAccumulator();
    a.add({ id: 'one', amount: 10 }); a.add({ amount: 20, id: 'two' });
    b.add({ id: 'two', amount: 20 }); b.add({ amount: 10, id: 'one' });
    expect(a.result()).toEqual(b.result()); b.add({ id: 'one', amount: 10 });
    expect(a.result()).not.toEqual(b.result());
  });

  test('RTDB parity uses stored null/empty-object semantics', () => {
    expect(migration.normalizeRealtimeValue({ a: null, b: {}, c: { amount: 0, optional: null }, d: false }))
      .toEqual({ c: { amount: 0 }, d: false });
  });

  test('initializer defaults off without consulting credentials or adapters', async () => {
    delete process.env.ENABLE_NEW_USER_READ_MODEL_INIT;
    await expect(newUsers.initialize({}, { config: new Proxy({}, { get() { throw new Error('must not access'); } }) }))
      .resolves.toEqual({ skipped: true });
  });

  test('mutable profile date cannot attest old Auth account as empty', async () => {
    process.env.ENABLE_NEW_USER_READ_MODEL_INIT = 'true';
    await expect(newUsers.initialize({ uid: 'old', createdAt: new Date().toISOString(), metadata: { creationTime: '2020-01-01' } },
      { config: new Proxy({}, { get() { throw new Error('must not access'); } }) }))
      .resolves.toMatchObject({ skipped: true, reason: 'trusted_new_auth_record_required' });
  });

  test('missing adapters fail conservatively and are settled without rejecting auth flow', async () => {
    process.env.ENABLE_NEW_USER_READ_MODEL_INIT = 'true'; process.env.ENABLE_RECEIPT_HISTORY_WRITES = 'true';
    process.env.ENABLE_OPS_METRIC_WRITES = 'true';
    const result = await newUsers.initialize({ uid: 'fresh', metadata: { creationTime: new Date().toISOString() } },
      { config: { getFirestore: () => null, getRealtimeDB: () => null } });
    expect(result).toEqual({ initialized: 0, failed: 3 });
  });
});

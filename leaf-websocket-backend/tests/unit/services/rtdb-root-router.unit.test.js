const router = require('../../../services/rtdb-root-router');
const backfill = require('../../../scripts/maintenance/backfill-rtdb-roots-firestore.cjs');

// The full behavioral check against the real RTDB emulator lives in
// scripts/benchmark/rtdb-root-router-diff.cjs; these cover the pure parts.
describe('rtdb root router (RTDB exit)', () => {
  it('returns the raw client untouched when no root is configured', () => {
    const raw = { ref: jest.fn() };
    expect(router.createRouter(raw, { env: {} })).toBe(raw);
  });

  it('only serves reads for roots that are also written', () => {
    const config = router.readConfig({ RTDB_FIRESTORE_WRITE_ROOTS: 'vehicles, user_vehicles', RTDB_FIRESTORE_READ_ROOTS: 'vehicles,users' });
    expect([...config.writes]).toEqual(['vehicles', 'user_vehicles']);
    expect([...config.reads]).toEqual(['vehicles']);
  });

  it('applies RTDB write semantics: null deletes, empty parents disappear, arrays stay arrays', () => {
    let value = router.setIn(null, [], { a: { b: 1, c: null }, list: [[1, 2]] });
    expect(value).toEqual({ a: { b: 1 }, list: [[1, 2]] });
    value = router.setIn(value, ['a', 'b'], null);
    expect(value).toEqual({ list: [[1, 2]] });
    expect(router.setIn(value, ['list'], null)).toBeNull();
    expect(router.getIn({ a: { b: 2 } }, ['a', 'b'])).toBe(2);
    expect(router.getIn({ a: 1 }, ['a', 'b'])).toBeNull();
  });

  it('orders and filters like RTDB queries', () => {
    const data = { k3: { s: 'b', n: 1 }, k1: { s: 'a', n: 3 }, k2: { s: 'a', n: 2 }, k4: { n: 0 } };
    expect(Object.keys(router.applyQuery(data, { orderBy: 'child', child: 's', equalTo: 'a' }))).toEqual(['k1', 'k2']);
    expect(Object.keys(router.applyQuery(data, { orderBy: 'child', child: 's' }))).toEqual(['k4', 'k1', 'k2', 'k3']);
    expect(Object.keys(router.applyQuery(data, { orderBy: 'child', child: 'n', limitToFirst: 2 }))).toEqual(['k4', 'k3']);
    expect(Object.keys(router.applyQuery(data, { orderBy: 'key', startAfter: 'k2' }))).toEqual(['k3', 'k4']);
    expect(router.applyQuery([[1, 2]], {})).toEqual([[1, 2]]);
  });

  it('pushes orderByChild().equalTo() down to a Firestore query on native collections', async () => {
    const calls = [];
    const docs = [{ id: 'b4', data: () => ({ driver: 'd1', status: 'COMPLETED' }) }];
    const collection = name => ({
      where: (field, op, value) => { calls.push([name, String(field), op, value]); return { get: async () => ({ docs }) }; },
      get: async () => { calls.push([name, 'scan']); return { docs }; }
    });
    const env = {
      RTDB_FIRESTORE_WRITE_ROOTS: 'bookings,users', RTDB_FIRESTORE_READ_ROOTS: 'bookings,users',
      RTDB_FIRESTORE_NATIVE_COLLECTIONS: 'bookings:ride_annotations,users:users:merge'
    };
    const db = router.createRouter({ ref: jest.fn() }, { getFirestore: () => ({ collection }), env, log: () => {} });
    const found = await db.ref('bookings').orderByChild('driver').equalTo('d1').once('value');
    expect(found.val()).toEqual({ b4: { driver: 'd1', status: 'COMPLETED' } });
    await db.ref('bookings').orderByChild('driver').once('value');
    await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
    expect(calls).toEqual([['ride_annotations', 'driver', '==', 'd1'], ['ride_annotations', 'scan'], ['users', 'scan']]);
  });

  it('backfill copies roots record by record, deletes extras and verifies', async () => {
    expect(() => backfill.parseArgs(['--roots', 'vehicles', '--apply'])).toThrow('--ref');
    expect(() => backfill.parseArgs(['--roots', '../x'])).toThrow('nomes de raiz');
    const rtdb = { vehicles: { v1: { plate: 'A' }, v2: { plate: 'B', poly: [[1, 2]] } } };
    const store = new Map([['rtdb_vehicles/old', { json: '{"plate":"Z"}' }]]);
    const rawDb = { ref: root => ({ once: async () => ({ val: () => rtdb[root] || null }) }) };
    const firestore = {
      collection: name => ({
        get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split('/')[1], data: () => v })) }),
        doc: id => ({ set: async v => { store.set(`${name}/${id}`, v); }, delete: async () => { store.delete(`${name}/${id}`); } })
      })
    };
    const deps = { rawDb, firestore, log: () => {} };
    const dry = await backfill.run({ roots: ['vehicles'], apply: false }, deps);
    expect(dry.roots.vehicles).toMatchObject({ rtdbRecords: 2, toWrite: 2, extra: 1 });
    expect(dry.parityMismatch).toBe(3);
    const applied = await backfill.run({ roots: ['vehicles'], apply: true, ref: 'test' }, deps);
    expect(applied.roots.vehicles).toMatchObject({ written: 2, extraDeleted: 1 });
    const again = await backfill.run({ roots: ['vehicles'], apply: false }, deps);
    expect(again).toMatchObject({ parityMismatch: 0 });
    expect(again.roots.vehicles.equal).toBe(2);
  });
});

describe('native migration merge rule (RTDB exit)', () => {
  const { mergeRecords } = require('../../../scripts/maintenance/migrate-rtdb-roots-native.cjs');
  it('unions fields and lets the newer record win conflicts', () => {
    const conflicts = [];
    const firestore = { name: 'Leaf', approved: false, onlyFs: 1, nested: { a: 1, b: 2 } };
    const rtdb = { name: 'Motorista', approved: true, onlyRtdb: 2, nested: { b: 3, c: 4 } };
    expect(mergeRecords(firestore, rtdb, true, 'users/u1', conflicts))
      .toEqual({ name: 'Motorista', approved: true, onlyFs: 1, onlyRtdb: 2, nested: { a: 1, b: 3, c: 4 } });
    expect(conflicts.map(c => c.path)).toEqual(['users/u1/name', 'users/u1/approved', 'users/u1/nested/b']);
    const tie = [];
    expect(mergeRecords(firestore, rtdb, false, 'users/u1', tie).approved).toBe(false);
    expect(tie.every(c => c.winner === 'firestore')).toBe(true);
  });

  it('keeps nested arrays native through the encoding round trip', () => {
    const value = { landmarks: [[1, 2], [3, [4, 5]]], tags: ['a'] };
    const stored = router.fromView(value, undefined);
    expect(stored.landmarks[0]).toEqual({ rtdbNestedArray: [1, 2] });
    expect(router.toView(stored)).toEqual(value);
  });
});

describe('retired RTDB stand-in (RTDB exit, domain 8)', () => {
  it('reads an empty database, drops writes with an error log and never opens RTDB', async () => {
    const logged = [];
    const db = router.createRetiredRtdb({ log: (level, message, meta) => logged.push(`${level}:${message}:${meta.root}`) });
    expect((await db.ref('receipts/r1').once('value')).val()).toBeNull();
    expect((await db.ref('receipts').orderByChild('owner').equalTo('u1').limitToLast(5).once('value')).exists()).toBe(false);
    await db.ref('receipts/r1').set({ ok: true });
    await db.ref().update({ 'ratings/a': 1, 'trip_ratings/t/a': 1 });
    await expect(db.ref('ratings/a').transaction(() => 1)).resolves.toMatchObject({ committed: false });
    expect((await db.ref('.info/connected').once('value')).val()).toBeNull();
    expect([...new Set(logged)]).toEqual([
      'warn:rtdb_retired_read:receipts', 'error:rtdb_retired_write:receipts',
      'error:rtdb_retired_write:ratings', 'error:rtdb_retired_write:trip_ratings'
    ]);
    const child = db.ref('ratings').push();
    expect(child.key).toMatch(/^[-0-9A-Za-z_]{20}$/);
    expect(router.pushId(1000) < router.pushId(2000)).toBe(true);
  });

  it('retired implies no RTDB mirror and swaps the client behind the router', () => {
    expect(router.mirrorWritesEnabled({ RTDB_RETIRED: 'true' })).toBe(false);
    expect(router.mirrorWritesEnabled({})).toBe(true);
    const admin = { database: jest.fn(() => ({ real: true })) };
    expect(router.realtimeClient(admin, { RTDB_RETIRED: 'true' }).__rtdbRetired).toBe(true);
    expect(admin.database).not.toHaveBeenCalled();
    expect(router.realtimeClient(admin, {})).toEqual({ real: true });
  });
});

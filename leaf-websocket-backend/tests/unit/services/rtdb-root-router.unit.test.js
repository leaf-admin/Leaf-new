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

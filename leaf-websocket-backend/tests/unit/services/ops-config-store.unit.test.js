const store = require('../../../services/ops-config-store');
const backfill = require('../../../scripts/maintenance/backfill-ops-configs-firestore.cjs');

function fakeConfig({ rtdb = {}, firestore = {}, failFirestore = false, failRtdb = false } = {}) {
  const docs = new Map(Object.entries(firestore));
  const calls = [];
  return {
    rtdb, docs, calls,
    getFromRealtimeDB: jest.fn(async path => rtdb[path] ?? null),
    setRealtimeDB: jest.fn(async (path, value) => {
      calls.push(`rtdb:${path}`);
      if (failRtdb) throw new Error('rtdb down');
      rtdb[path] = value;
    }),
    getFirestore: () => ({
      collection: name => ({
        doc: id => ({
          get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) }),
          set: async value => {
            calls.push(`firestore:${name}/${id}`);
            if (failFirestore) throw new Error('firestore down');
            docs.set(`${name}/${id}`, value);
          }
        })
      })
    })
  };
}

const CITY_PATH = 'operations/geography/cityActivation';
const CITY_DOC = 'operational_configs/city_activation';
const config = { version: 2, states: { RJ: { enabled: true, cities: { rio: { enabled: true } } } }, ignored: undefined };

describe('ops config store (RTDB exit, domain 2)', () => {
  const saved = { w: process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES, r: process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS };
  afterEach(() => {
    for (const [name, value] of [['ENABLE_OPS_CONFIG_FIRESTORE_WRITES', saved.w], ['ENABLE_OPS_CONFIG_FIRESTORE_READS', saved.r]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  it('keeps RTDB as the only store while the flags are off', async () => {
    delete process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES;
    const fake = fakeConfig({ rtdb: { [CITY_PATH]: { version: 1 } } });
    await expect(store.load(fake, 'cityActivation')).resolves.toEqual({ raw: { version: 1 }, source: 'rtdb' });
    await store.persist(fake, 'cityActivation', config);
    expect(fake.calls).toEqual([`rtdb:${CITY_PATH}`]);
  });

  it('dual-writes with RTDB first; a Firestore failure does not fail the admin change', async () => {
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES = 'true';
    delete process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS;
    const fake = fakeConfig();
    await store.persist(fake, 'cityActivation', config);
    expect(fake.calls).toEqual([`rtdb:${CITY_PATH}`, `firestore:${CITY_DOC}`]);
    expect(fake.docs.get(CITY_DOC)).toEqual({ version: 2, states: config.states });

    const failing = fakeConfig({ failFirestore: true });
    await expect(store.persist(failing, 'cityActivation', config)).resolves.toBeUndefined();
    const rtdbDown = fakeConfig({ failRtdb: true });
    await expect(store.persist(rtdbDown, 'cityActivation', config)).rejects.toThrow('rtdb down');
  });

  it('after the switch reads Firestore (without import metadata) and requires the Firestore write', async () => {
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES = 'true';
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS = 'true';
    const fake = fakeConfig({ firestore: { [CITY_DOC]: { version: 3, source: 'legacy_rtdb_import', importedAt: 'x' } }, rtdb: { [CITY_PATH]: { version: 1 } } });
    await expect(store.load(fake, 'cityActivation')).resolves.toEqual({ raw: { version: 3 }, source: 'firestore' });
    await store.persist(fake, 'cityActivation', config);
    expect(fake.calls).toEqual([`firestore:${CITY_DOC}`, `rtdb:${CITY_PATH}`]);

    const missing = fakeConfig({ rtdb: { [CITY_PATH]: { version: 1 } } });
    await expect(store.load(missing, 'cityActivation')).resolves.toEqual({ raw: { version: 1 }, source: 'rtdb' });
    const firestoreDown = fakeConfig({ failFirestore: true });
    await expect(store.persist(firestoreDown, 'cityActivation', config)).rejects.toThrow('firestore down');
    const rtdbDown = fakeConfig({ failRtdb: true });
    await expect(store.persist(rtdbDown, 'cityActivation', config)).resolves.toBeUndefined();
  });

  it('with the RTDB mirror off neither reads nor writes RTDB', async () => {
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES = 'true';
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS = 'true';
    process.env.RTDB_MIRROR_WRITES = 'false';
    try {
      const missing = fakeConfig({ rtdb: { [CITY_PATH]: { version: 1 } } });
      await expect(store.load(missing, 'cityActivation')).resolves.toEqual({ raw: null, source: 'firestore' });
      expect(missing.getFromRealtimeDB).not.toHaveBeenCalled();
      await store.persist(missing, 'cityActivation', config);
      expect(missing.calls).toEqual([`firestore:${CITY_DOC}`]);
    } finally {
      delete process.env.RTDB_MIRROR_WRITES;
    }
  });

  it('backfill copies only on --apply and reports parity per config', async () => {
    expect(() => backfill.parseArgs(['--apply'])).toThrow('--ref');
    const fake = fakeConfig({
      rtdb: { [CITY_PATH]: { version: 2 }, 'operations/geography/geofenceConfig': { enabled: true } },
      firestore: { [CITY_DOC]: { version: 2, source: 'legacy_rtdb_import', importedAt: 'x' } }
    });
    const quiet = () => {};
    const dry = await backfill.run({ apply: false }, { config: fake, log: quiet });
    expect(dry.results).toEqual([
      { key: 'cityActivation', rtdbPresent: true, equal: true, written: false },
      { key: 'geofenceAdmin', rtdbPresent: true, equal: false, written: false }
    ]);
    const applied = await backfill.run({ apply: true, ref: 'test' }, { config: fake, log: quiet });
    expect(applied).toMatchObject({ parityMismatch: 0 });
    expect(applied.results[1]).toEqual({ key: 'geofenceAdmin', rtdbPresent: true, equal: true, written: true });
    expect(fake.docs.get(CITY_DOC)).toMatchObject({ source: 'legacy_rtdb_import' }); // equal config is left untouched
  });

  it('stores geofence polygons (nested arrays) as JSON and reads them back intact', async () => {
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_WRITES = 'true';
    process.env.ENABLE_OPS_CONFIG_FIRESTORE_READS = 'true';
    const fake = fakeConfig();
    const geofence = { enabled: true, region: { type: 'Polygon', coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8]]] } };
    await store.persist(fake, 'geofenceAdmin', geofence);
    const stored = fake.docs.get('operational_configs/geofence_admin');
    const hasNestedArray = value => Array.isArray(value)
      ? value.some(item => Array.isArray(item) || hasNestedArray(item))
      : Boolean(value && typeof value === 'object' && Object.values(value).some(hasNestedArray));
    expect(hasNestedArray(stored)).toBe(false);
    expect(stored).toMatchObject({ schema: 1, encoding: 'json' });
    await expect(store.load(fake, 'geofenceAdmin')).resolves.toEqual({ raw: geofence, source: 'firestore' });
  });
});

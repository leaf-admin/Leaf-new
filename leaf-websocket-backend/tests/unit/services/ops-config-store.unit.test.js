const store = require('../../../services/ops-config-store');

function fakeConfig({ firestore = {}, failFirestore = false } = {}) {
  const docs = new Map(Object.entries(firestore));
  const calls = [];
  return {
    docs, calls,
    getFromRealtimeDB: jest.fn(),
    setRealtimeDB: jest.fn(),
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

const CITY_DOC = 'operational_configs/city_activation';
const config = { version: 2, states: { RJ: { enabled: true, cities: { rio: { enabled: true } } } }, ignored: undefined };

describe('ops config store (Firestore only; RTDB retired)', () => {
  it('reads Firestore without the legacy import metadata and never touches RTDB', async () => {
    const fake = fakeConfig({ firestore: { [CITY_DOC]: { version: 3, source: 'legacy_rtdb_import', importedAt: 'x' } } });
    await expect(store.load(fake, 'cityActivation')).resolves.toEqual({ raw: { version: 3 }, source: 'firestore' });
    await expect(store.load(fakeConfig(), 'cityActivation')).resolves.toEqual({ raw: null, source: 'firestore' });
    expect(fake.getFromRealtimeDB).not.toHaveBeenCalled();
  });

  it('writes only Firestore and fails the admin change when Firestore fails', async () => {
    const fake = fakeConfig();
    await store.persist(fake, 'cityActivation', config);
    expect(fake.calls).toEqual([`firestore:${CITY_DOC}`]);
    expect(fake.docs.get(CITY_DOC)).toEqual({ version: 2, states: config.states });
    expect(fake.setRealtimeDB).not.toHaveBeenCalled();
    await expect(store.persist(fakeConfig({ failFirestore: true }), 'cityActivation', config)).rejects.toThrow('firestore down');
  });

  it('fails clearly without Firestore and for an unknown config', async () => {
    await expect(store.load({ getFirestore: () => null }, 'cityActivation')).rejects.toThrow('Firestore indisponível');
    await expect(store.load(fakeConfig(), 'unknown')).rejects.toThrow('Configuração operacional desconhecida');
  });

  it('stores geofence polygons (nested arrays) as JSON and reads them back intact', async () => {
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

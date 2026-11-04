jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const {
  GeofenceLivePolicyService,
  validateLiveRegion,
  CHANNEL
} = require('../../../services/geofence-live-policy-service');

const square = [[-43.2, -22.98], [-43.18, -22.98], [-43.18, -22.96], [-43.2, -22.96]];
const triangle = [[-43.3, -23.0], [-43.28, -23.0], [-43.29, -22.99]];
const NOW = new Date('2026-11-03T22:00:00.000Z');

function memoryFirestore() {
  const docs = new Map();
  const collection = (name) => ({
    doc: (id) => ({
      set: jest.fn(async (value) => { docs.set(`${name}/${id}`, value); }),
      get: jest.fn(async () => {
        const value = docs.get(`${name}/${id}`);
        return { id, exists: Boolean(value), data: () => value };
      })
    }),
    orderBy: () => ({
      limit: (limit) => ({
        get: async () => ({
          docs: [...docs.entries()]
            .filter(([key]) => key.startsWith(`${name}/`))
            .map(([key, value]) => ({ id: key.split('/')[1], data: () => value }))
            .sort((a, b) => b.data().createdAt.localeCompare(a.data().createdAt))
            .slice(0, limit)
        })
      })
    })
  });
  return { docs, collection };
}

function createService({ env = { GEOFENCE_ADMIN_EDIT_ENABLED: 'true' }, publisher } = {}) {
  const firestore = memoryFirestore();
  const store = { raw: null };
  const opsConfigStore = {
    load: jest.fn(async () => ({ raw: store.raw })),
    persist: jest.fn(async (_fb, _key, value) => { store.raw = JSON.parse(JSON.stringify(value)); })
  };
  const geofenceService = { updateRegion: jest.fn(() => true) };
  const pub = publisher || { publish: jest.fn(async () => 1) };
  const service = new GeofenceLivePolicyService({
    geofenceService,
    opsConfigStore,
    getFirebaseConfig: () => ({ getFirestore: () => firestore }),
    getPublisher: async () => pub,
    createSubscriber: null,
    env,
    now: () => NOW
  });
  return { service, firestore, store, opsConfigStore, geofenceService, publisher: pub };
}

describe('geofence-live-policy-service validation', () => {
  it('accepts one ring or a list of rings and closes them', () => {
    const one = validateLiveRegion(square);
    expect(one).toMatchObject({ ok: true, polygonCount: 1, pointCount: 4 });
    expect(one.rings[0][0]).toEqual(one.rings[0][4]);
    expect(validateLiveRegion([square, triangle])).toMatchObject({ ok: true, polygonCount: 2, pointCount: 7 });
  });

  it('rejects empty, short, swapped and self-crossing areas', () => {
    expect(validateLiveRegion([]).ok).toBe(false);
    expect(validateLiveRegion([[-43.2, -22.98], [-43.18, -22.98]]).ok).toBe(false);
    // lat/lng trocados caem fora do Brasil.
    expect(validateLiveRegion(square.map(([lng, lat]) => [lat, lng])).error).toMatch(/fora do Brasil/);
    const bowtie = [[-43.2, -22.98], [-43.18, -22.96], [-43.18, -22.98], [-43.2, -22.96]];
    expect(validateLiveRegion(bowtie).error).toMatch(/se cruzam/);
  });
});

describe('geofence-live-policy-service versions', () => {
  it('stays off without the flag', async () => {
    const { service } = createService({ env: {} });
    expect(service.isEnabled()).toBe(false);
    expect(service.applyLiveConfig({ liveVersion: { id: 'x' }, region: [square] })).toBe(false);
    await expect(service.saveVersion({ region: [square], policyId: 'rio-v4' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('saves a version, makes it live, applies it and tells the other gateways', async () => {
    const { service, firestore, store, geofenceService, publisher } = createService();

    const { version, config } = await service.saveVersion({
      region: [square, triangle], policyId: 'rio-zona-sul-v4', name: 'Piloto', actor: 'admin@leaf', baseConfig: { version: 3 }
    });

    expect(version).toMatchObject({ policyId: 'rio-zona-sul-v4', polygonCount: 2, pointCount: 7, createdBy: 'admin@leaf' });
    expect(firestore.docs.get(`geofence_versions/${version.id}`).json).toContain('-43.2');
    expect(store.raw.liveVersion).toMatchObject({ id: version.id, policyId: 'rio-zona-sul-v4' });
    expect(config.version).toBe(4);
    expect(geofenceService.updateRegion).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      source: 'admin-live', version: 'rio-zona-sul-v4', name: 'Piloto'
    }));
    expect(publisher.publish).toHaveBeenCalledWith(CHANNEL, JSON.stringify({ versionId: version.id }));
  });

  it('refuses a bad version label or polygon before writing anything', async () => {
    const { service, firestore, opsConfigStore } = createService();
    await expect(service.saveVersion({ region: [square], policyId: 'Rio Zona Sul' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.saveVersion({ region: [[0, 0], [1, 1], [2, 0]], policyId: 'rio-v4' })).rejects.toMatchObject({ statusCode: 400 });
    expect(firestore.docs.size).toBe(0);
    expect(opsConfigStore.persist).not.toHaveBeenCalled();
  });

  it('keeps the save when the Redis notice fails', async () => {
    const { service, store } = createService({ publisher: { publish: jest.fn(async () => { throw new Error('down'); }) } });
    await service.saveVersion({ region: [square], policyId: 'rio-v4' });
    expect(store.raw.liveVersion.policyId).toBe('rio-v4');
  });

  it('reloads only when the live version changed', async () => {
    const { service, store, geofenceService } = createService();
    store.raw = { region: [square], liveVersion: { id: 'v1', policyId: 'rio-v4' } };

    expect(await service.loadAndApply()).toBe(true);
    expect(await service.loadAndApply()).toBe(false);
    expect(geofenceService.updateRegion).toHaveBeenCalledTimes(1);
  });

  it('ignores an old admin record without liveVersion', async () => {
    const { service, store, geofenceService } = createService();
    store.raw = { region: [square], enabled: false };
    expect(await service.loadAndApply()).toBe(false);
    expect(geofenceService.updateRegion).not.toHaveBeenCalled();
  });

  it('restores a previous version as a new one and lists newest first', async () => {
    const { service, store } = createService();
    const first = await service.saveVersion({ region: [square], policyId: 'rio-v4' });
    await service.saveVersion({ region: [triangle], policyId: 'rio-v5' });

    const restored = await service.restoreVersion(first.version.id, { actor: 'admin@leaf' });

    expect(restored.version).toMatchObject({ policyId: 'rio-v4', restoredFrom: first.version.id });
    expect(store.raw.liveVersion.id).toBe(restored.version.id);
    const versions = await service.listVersions();
    expect(versions).toHaveLength(3);
    await expect(service.restoreVersion('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

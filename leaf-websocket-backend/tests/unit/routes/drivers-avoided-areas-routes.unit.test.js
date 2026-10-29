jest.unmock('express');

const express = require('express');
const request = require('supertest');
const h3 = require('h3-js');

// Redis em memória: strings e hashes, suficientes para as rotas de áreas evitadas.
const mockRedisState = { strings: new Map(), hashes: new Map() };
const mockRedis = {
  get: async (key) => (mockRedisState.strings.has(key) ? mockRedisState.strings.get(key) : null),
  set: async (key, value) => {
    mockRedisState.strings.set(key, String(value));
    return 'OK';
  },
  hset: async (key, fields) => {
    const hash = mockRedisState.hashes.get(key) || {};
    Object.assign(hash, fields);
    mockRedisState.hashes.set(key, hash);
    return 1;
  },
  exists: async (key) => (mockRedisState.hashes.has(key) ? 1 : 0),
  hgetall: async (key) => ({ ...(mockRedisState.hashes.get(key) || {}) })
};

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/driver-lock-manager', () => ({}));
jest.mock('../../../services/geofence-service', () => ({
  describeAreaServiceability: jest.fn(() => ({ pickupPossible: true, destinationPossible: true })),
}));
jest.mock('../../../services/payment-service', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../../services/driver-destination-mode-service', () => ({
  getPolicyForDriver: jest.fn()
}));
// Token de teste: "Bearer firebase:<uid>". A checagem de dono (requireFirebaseSelf) é a real.
jest.mock('../../../middleware/firebase-user-auth', () => ({
  ...jest.requireActual('../../../middleware/firebase-user-auth'),
  requireFirebaseUser: jest.fn((req, res, next) => {
    const match = /^Bearer firebase:(.+)$/.exec(String(req.headers.authorization || ''));
    if (!match) {
      return res.status(401).json({ success: false, error: 'Token de autenticação ausente.' });
    }
    req.authenticatedUser = { uid: match[1], authSource: 'firebase' };
    return next();
  })
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));
jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(),
  getFirestore: jest.fn(),
  getStorage: jest.fn()
}));
jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
}));
jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: jest.fn((req, res, next) => next()),
  requireRole: jest.fn(() => (req, res, next) => next())
}));

const driversRoutes = require('../../../routes/drivers');

const DRIVER_UID = 'driver_avoid_1';
const AUTH = `Bearer firebase:${DRIVER_UID}`;
const COPACABANA = { lat: -22.9711, lng: -43.1822 };
const COPACABANA_CELL = h3.latLngToCell(COPACABANA.lat, COPACABANA.lng, 8);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(driversRoutes);
  return app;
}

function putAreas(app, body, auth = AUTH) {
  const pending = request(app).put('/api/drivers/me/avoided-areas').send(body);
  return auth ? pending.set('Authorization', auth) : pending;
}

function getAreas(app, auth = AUTH) {
  const pending = request(app).get('/api/drivers/me/avoided-areas');
  return auth ? pending.set('Authorization', auth) : pending;
}

describe('driver avoided areas routes', () => {
  beforeEach(() => {
    mockRedisState.strings.clear();
    mockRedisState.hashes.clear();
  });

  it('PUT stores the cells on the driver hash and returns them', async () => {
    mockRedisState.hashes.set(`driver:${DRIVER_UID}`, { id: DRIVER_UID, isOnline: 'true' });
    const app = createApp();
    const response = await putAreas(app, {
      areas: [{ id: 'a1', label: '  Copacabana  ', center: COPACABANA, ringSize: 0 }]
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      cells: [COPACABANA_CELL],
      maxCells: 80,
      resolution: 8
    });
    expect(response.body.areas[0]).toMatchObject({
      id: 'a1',
      label: 'Copacabana',
      cells: [COPACABANA_CELL]
    });

    const hash = mockRedisState.hashes.get(`driver:${DRIVER_UID}`);
    expect(JSON.parse(hash.avoidedH3Cells)).toEqual([COPACABANA_CELL]);
    expect(typeof hash.avoidedAreasUpdatedAt).toBe('string');

    const stored = JSON.parse(mockRedisState.strings.get(`driver_avoided_areas:${DRIVER_UID}`));
    expect(stored.cells).toEqual([COPACABANA_CELL]);
    expect(stored.areas[0].label).toBe('Copacabana');
  });

  it('GET returns the stored areas and empty lists when nothing is stored', async () => {
    const app = createApp();

    const empty = await getAreas(app);
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({
      success: true,
      cells: [],
      areas: [],
      maxCells: 80,
      resolution: 8,
      updatedAt: null
    });

    await putAreas(app, {
      areas: [{ id: 'a1', label: 'Centro', center: COPACABANA, ringSize: 1 }]
    });
    const saved = await getAreas(app);
    expect(saved.body.cells).toHaveLength(7);
    expect(saved.body.areas[0].label).toBe('Centro');
    expect(saved.body.updatedAt).toEqual(expect.any(String));
  });

  it('PUT with more than four regions returns 400 with AVOIDED_AREAS_LIMIT_EXCEEDED', async () => {
    const app = createApp();
    const centers = [
      { lat: -22.9711, lng: -43.1822 },
      { lat: -23.0045, lng: -43.3659 },
      { lat: -22.8, lng: -43.2 },
      { lat: -22.7, lng: -43.4 },
      { lat: -22.9, lng: -43.5 }
    ];
    const response = await putAreas(app, {
      areas: centers.map((center, index) => ({ id: `a${index}`, label: `Área ${index}`, center, ringSize: 0 }))
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: 'AVOIDED_AREAS_LIMIT_EXCEEDED'
    });
    expect(mockRedisState.hashes.get(`driver:${DRIVER_UID}`)).toBeUndefined();
  });

  it('PUT accepts a whole neighbourhood by its official code, with its outline', async () => {
    mockRedisState.hashes.set(`driver:${DRIVER_UID}`, { id: DRIVER_UID, isOnline: 'true' });
    const app = createApp();
    const lookup = await request(app)
      .get('/api/drivers/me/avoided-areas/bairro?lat=-22.9711&lng=-43.1822')
      .set('Authorization', `Bearer firebase:${DRIVER_UID}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.bairro.name).toBe('Copacabana');

    const response = await putAreas(app, {
      areas: [
        { bairroId: lookup.body.bairro.id },
        { bairroId: lookup.body.bairro.id },
        { id: 'a1', label: 'Centro', center: { lat: -22.8, lng: -43.2 }, ringSize: 0 }
      ]
    });

    expect(response.status).toBe(200);
    expect(response.body.areas).toHaveLength(2);
    expect(response.body.areas[0]).toMatchObject({ type: 'bairro', label: 'Copacabana', bairroId: lookup.body.bairro.id });
    expect(response.body.areas[0].outline[0].length).toBeGreaterThan(3);
    expect(response.body.areas[1].type).toBe('free');

    const stored = JSON.parse(mockRedisState.strings.get(`driver_avoided_areas:${DRIVER_UID}`));
    expect(stored.bairros).toEqual([lookup.body.bairro.id]);
    const hash = mockRedisState.hashes.get(`driver:${DRIVER_UID}`);
    expect(JSON.parse(hash.avoidedBairros)).toEqual([lookup.body.bairro.id]);
  });

  it('lookup tells whether rides can start or end in the neighbourhood', async () => {
    const geofenceService = require('../../../services/geofence-service');
    geofenceService.describeAreaServiceability.mockReturnValueOnce({ pickupPossible: false, destinationPossible: true });
    const app = createApp();
    const lookup = await request(app)
      .get('/api/drivers/me/avoided-areas/bairro?lat=-22.9711&lng=-43.1822')
      .set('Authorization', `Bearer firebase:${DRIVER_UID}`);

    expect(lookup.body.bairro.serviceArea).toEqual({ pickupPossible: false, destinationPossible: true });
    const [points] = geofenceService.describeAreaServiceability.mock.calls.at(-1);
    expect(points[0]).toEqual(lookup.body.bairro.center);
    expect(points.length).toBeGreaterThan(1);
  });

  it('PUT refuses an unknown neighbourhood and the lookup answers null outside Rio', async () => {
    const app = createApp();
    const response = await putAreas(app, { areas: [{ bairroId: '99999' }] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('AVOIDED_AREA_INVALID');

    const outside = await request(app)
      .get('/api/drivers/me/avoided-areas/bairro?lat=-23.55&lng=-46.63')
      .set('Authorization', `Bearer firebase:${DRIVER_UID}`);
    expect(outside.body).toEqual({ success: true, bairro: null });
  });

  it('PUT does not create the driver hash when the driver has none (offline)', async () => {
    const app = createApp();
    const response = await putAreas(app, {
      areas: [{ id: 'a1', label: 'Centro', center: COPACABANA, ringSize: 0 }]
    });

    expect(response.status).toBe(200);
    expect(mockRedisState.hashes.get(`driver:${DRIVER_UID}`)).toBeUndefined();
    const stored = JSON.parse(mockRedisState.strings.get(`driver_avoided_areas:${DRIVER_UID}`));
    expect(stored.cells).toEqual([COPACABANA_CELL]);
  });

  it('PUT with empty areas clears the stored cells', async () => {
    const app = createApp();
    mockRedisState.hashes.set(`driver:${DRIVER_UID}`, { id: DRIVER_UID, isOnline: 'true' });
    await putAreas(app, {
      areas: [{ id: 'a1', label: 'Centro', center: COPACABANA, ringSize: 0 }]
    });

    const cleared = await putAreas(app, { areas: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ success: true, cells: [], areas: [] });

    const hash = mockRedisState.hashes.get(`driver:${DRIVER_UID}`);
    expect(hash.avoidedH3Cells).toBe('[]');

    const after = await getAreas(app);
    expect(after.body.cells).toEqual([]);
    expect(after.body.areas).toEqual([]);
  });

  it('PUT rejects an invalid area center with AVOIDED_AREA_INVALID', async () => {
    const app = createApp();
    const response = await putAreas(app, {
      areas: [{ id: 'a1', label: 'Ruim', center: { lat: 'abc', lng: -43 }, ringSize: 0 }]
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('AVOIDED_AREA_INVALID');
  });

  it('GET and PUT without auth return 401', async () => {
    const app = createApp();

    const getResponse = await getAreas(app, null);
    expect(getResponse.status).toBe(401);

    const putResponse = await putAreas(app, { areas: [] }, null);
    expect(putResponse.status).toBe(401);
  });
});

jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockQueries = [];
const mockGetAll = jest.fn();
const mockDocGet = jest.fn();
const mockDocDelete = jest.fn(async () => undefined);
const mockCacheRead = jest.fn(async (_scope, _params, loader) => ({ value: await loader(), cache: 'MISS' }));
const mockCacheInvalidate = jest.fn(async () => undefined);

const waitlistDocs = [
  { id: 'w1', data: () => ({ driverId: 'd1', status: 'pending', position: 1, cityKey: 'rio', cityLabel: 'Rio' }) },
  { id: 'w2', data: () => ({ driverId: 'd2', status: 'pending', position: 2, cityKey: 'rio', cityLabel: 'Rio' }) }
];

function mockQuery(collection, filters = []) {
  return {
    where: (field, op, value) => mockQuery(collection, [...filters, `${field}${op}${value}`]),
    orderBy: () => mockQuery(collection, filters),
    get: jest.fn(async () => {
      mockQueries.push(`${collection}?${filters.join('&')}`);
      const docs = collection === 'waitList' && filters.includes('status==pending') ? waitlistDocs : [];
      return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
    })
  };
}

const mockFirestore = {
  collection: (name) => ({
    ...mockQuery(name),
    doc: (id) => ({ id, get: mockDocGet, delete: mockDocDelete, path: `${name}/${id}` })
  }),
  getAll: mockGetAll
};

jest.mock('firebase-admin', () => ({
  apps: [],
  firestore: Object.assign(jest.fn(() => mockFirestore), { FieldValue: { serverTimestamp: jest.fn() } })
}));
jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => { req.user = { id: 'admin_1', role: 'admin' }; next(); },
  requireSupportRoles: () => (_req, _res, next) => next()
}));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logRedis: jest.fn(),
  logStructured: jest.fn()
}));
jest.mock('../../../utils/pilot-launch-flags', () => ({
  isLaunchFeatureEnabled: jest.fn(() => true),
  buildLaunchFeatureDisabledPayload: jest.fn()
}));
jest.mock('../../../services/city-activation-state-service', () => ({ getConfig: jest.fn(async () => ({ states: {} })) }));
jest.mock('../../../services/waitlist-admin-read-cache', () => ({
  read: mockCacheRead,
  invalidate: mockCacheInvalidate
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(require('../../../routes/waitlist'));
  return app;
}

describe('waitlist admin reads', () => {
  beforeEach(() => {
    mockQueries.length = 0;
    jest.clearAllMocks();
    mockDocGet.mockResolvedValue({ exists: false, data: () => ({}) });
    mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => ({
      id: ref.id,
      exists: true,
      data: () => ({ firstName: `Nome ${ref.id}`, email: `${ref.id}@leaf.test` })
    })));
  });

  it('reads each queue status once for the stats', async () => {
    const response = await request(createApp()).get('/api/waitlist/stats');

    expect(response.status).toBe(200);
    expect(response.headers['x-leaf-waitlist-cache']).toBe('MISS');
    expect(response.body.stats).toMatchObject({ pending: 2, approved: 0, rejected: 0, total: 2 });
    expect(response.body.byCity).toEqual([expect.objectContaining({ cityKey: 'rio', pending: 2 })]);
    expect(mockQueries.filter((q) => q.startsWith('waitList?')).sort()).toEqual([
      'waitList?status==approved',
      'waitList?status==pending',
      'waitList?status==rejected'
    ]);
    expect(mockQueries.filter((q) => q.startsWith('waitlist_landing'))).toHaveLength(1);
    expect(mockCacheRead).toHaveBeenCalledWith('stats', {}, expect.any(Function));
  });

  it('lists the queue with one read and fetches the profiles together', async () => {
    const response = await request(createApp()).get('/api/waitlist/drivers?status=pending&limit=20');

    expect(response.status).toBe(200);
    expect(response.body.drivers.map((d) => d.driverId)).toEqual(['d1', 'd2']);
    expect(response.body.drivers[0].driver).toMatchObject({ firstName: 'Nome d1' });
    expect(response.body.pagination).toMatchObject({ total: 2, pages: 1 });
    expect(mockQueries).toEqual(['waitList?status==pending']);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockDocGet).not.toHaveBeenCalled();
  });

  it('pages the landing leads from one cached read', async () => {
    const response = await request(createApp()).get('/api/waitlist/landing/list?status=all&limit=10');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, waitlist: [], pagination: { total: 0 } });
    expect(mockCacheRead).toHaveBeenCalledWith('landing', { status: 'all' }, expect.any(Function));
  });

  it('clears the cached reads after a change to the queue', async () => {
    const response = await request(createApp()).delete('/api/waitlist/landing/lead_1');

    expect(response.status).toBe(200);
    expect(mockDocDelete).toHaveBeenCalled();
    expect(mockCacheInvalidate).toHaveBeenCalledTimes(1);
  });

  it('does not clear the cache on reads or failed changes', async () => {
    mockDocDelete.mockRejectedValueOnce(new Error('boom'));
    await request(createApp()).get('/api/waitlist/stats');
    await request(createApp()).delete('/api/waitlist/landing/lead_2');

    expect(mockCacheInvalidate).not.toHaveBeenCalled();
  });
});

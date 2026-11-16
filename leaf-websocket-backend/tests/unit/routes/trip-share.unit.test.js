jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockCreate = jest.fn();
const mockView = jest.fn();

jest.mock('../../../middleware/firebase-user-auth', () => ({
  requireFirebaseUser: (req, _res, next) => {
    req.authenticatedUser = { uid: 'c1' };
    next();
  }
}));
jest.mock('../../../services/trip-share-service', () => ({
  SHARE_TTL_SECONDS: 21600,
  createShareLink: (...args) => mockCreate(...args),
  getPublicView: (...args) => mockView(...args)
}));
jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({}))
}));
jest.mock('../../../utils/logger', () => ({ logError: jest.fn(), logStructured: jest.fn() }));

const routes = require('../../../routes/trip-share');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', routes);
  return app;
}

describe('trip share routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the link for the authenticated passenger', async () => {
    mockCreate.mockResolvedValue({ ok: true, token: 't', url: 'https://leaf.app.br/viagem/t' });
    const response = await request(createApp()).post('/api/rides/b1/share-link');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, url: 'https://leaf.app.br/viagem/t', expiresInSeconds: 21600 });
    expect(mockCreate).toHaveBeenCalledWith({}, { bookingId: 'b1', customerId: 'c1' });
  });

  it('maps an ended ride to 409 and someone else ride to 404', async () => {
    mockCreate.mockResolvedValueOnce({ ok: false, code: 'BOOKING_ENDED' });
    expect((await request(createApp()).post('/api/rides/b1/share-link')).status).toBe(409);
    mockCreate.mockResolvedValueOnce({ ok: false, code: 'BOOKING_NOT_FOUND' });
    expect((await request(createApp()).post('/api/rides/b2/share-link')).status).toBe(404);
  });

  it('serves the public view without login and without caching', async () => {
    mockView.mockResolvedValue({ status: 'in_progress' });
    const response = await request(createApp()).get('/api/public/trip-share/tok');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.trip).toEqual({ status: 'in_progress' });

    mockView.mockResolvedValue(null);
    expect((await request(createApp()).get('/api/public/trip-share/zzz')).status).toBe(404);
  });
});

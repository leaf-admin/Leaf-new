jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockCounters = new Map();
let mockRedis = null;
const mockVerifyIdToken = jest.fn();

jest.mock('firebase-admin', () => ({
  auth: () => ({ verifyIdToken: (...args) => mockVerifyIdToken(...args) }),
}));
jest.mock('../../../firebase-config', () => ({ initializeFirebase: jest.fn() }));
jest.mock('../../../utils/redis-pool', () => ({ getConnection: () => mockRedis }));
jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { placesAccess, LIMITS } = require('../../../middleware/places-access');

function createApp() {
  const app = express();
  app.post('/api/places/details', placesAccess('details'), (req, res) => {
    res.json({ ok: true, uid: req.authenticatedUser?.uid || null });
  });
  return app;
}

function memoryRedis() {
  return {
    status: 'ready',
    incr: jest.fn(async (key) => {
      const next = (mockCounters.get(key) || 0) + 1;
      mockCounters.set(key, next);
      return next;
    }),
    expire: jest.fn(async () => 1),
  };
}

describe('places access middleware', () => {
  beforeEach(() => {
    delete process.env.PLACES_REQUIRE_AUTH;
    mockCounters.clear();
    mockRedis = memoryRedis();
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockImplementation(async (token) => ({ uid: token.replace('token-', '') }));
  });

  it('limits each user separately and answers 429 with Retry-After', async () => {
    const app = createApp();
    for (let i = 0; i < LIMITS.details; i += 1) {
      await request(app).post('/api/places/details').set('Authorization', 'Bearer token-a').expect(200);
    }
    const blocked = await request(app)
      .post('/api/places/details')
      .set('Authorization', 'Bearer token-a')
      .expect(429);
    expect(blocked.body.status).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // Another user is not affected by user A hitting the limit.
    const other = await request(app)
      .post('/api/places/details')
      .set('Authorization', 'Bearer token-b')
      .expect(200);
    expect(other.body.uid).toBe('b');
  });

  it('keeps old app versions working without a token until auth is required', async () => {
    await request(createApp()).post('/api/places/details').expect(200);
  });

  it('requires a valid token when PLACES_REQUIRE_AUTH is on', async () => {
    process.env.PLACES_REQUIRE_AUTH = 'true';
    mockVerifyIdToken.mockRejectedValueOnce(new Error('expired'));
    await request(createApp()).post('/api/places/details').expect(401);
    await request(createApp()).post('/api/places/details').set('Authorization', 'Bearer bad').expect(401);
    await request(createApp()).post('/api/places/details').set('Authorization', 'Bearer token-c').expect(200);
  });

  it('lets the request through when Redis is down', async () => {
    mockRedis = { status: 'reconnecting', incr: jest.fn() };
    await request(createApp()).post('/api/places/details').set('Authorization', 'Bearer token-a').expect(200);
    expect(mockRedis.incr).not.toHaveBeenCalled();

    mockRedis = { status: 'ready', incr: jest.fn(() => new Promise(() => {})), expire: jest.fn() };
    await request(createApp()).post('/api/places/details').set('Authorization', 'Bearer token-a').expect(200);
  });
});

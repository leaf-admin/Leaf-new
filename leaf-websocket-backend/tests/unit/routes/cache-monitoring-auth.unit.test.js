jest.unmock('express');
const express = require('express');
const request = require('supertest');
const mockStats = jest.fn(async () => ({ totalKeys: null }));
jest.mock('../../../utils/advanced-cache', () => ({ getCacheStats: (...args) => mockStats(...args) }));
jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport(req, res, next) {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.user = { role: req.headers.authorization };
    return next();
  },
  requireSupportRoles: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.sendStatus(403)
}));

test('cache monitoring rejects anonymous and non-operator calls before Redis work', async () => {
  const app = express();
  app.use('/cache', require('../../../routes/cache-monitoring'));
  await request(app).get('/cache/stats').expect(401);
  await request(app).get('/cache/stats').set('authorization', 'driver').expect(403);
  expect(mockStats).not.toHaveBeenCalled();
  await request(app).get('/cache/stats').set('authorization', 'admin').expect(200);
  expect(mockStats).toHaveBeenCalledTimes(1);
});

'use strict';

// Leitura financeira dos bots (adminUsers.financialRead): o usuário somente leitura com a flag
// lê as rotas financeiras em GET; sem a flag segue barrado; nenhuma escrita é liberada; e um
// usuário que não é somente leitura não ganha nada com a flag. Usa os middlewares reais de
// autenticação (jwt-auth e support-auth) sobre os routers reais de dashboard e métricas.

jest.unmock('express');

const express = require('express');
const request = require('supertest');

// Token = id do adminUser; o doc vem da fixture abaixo.
const mockAdminUsers = {};

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn((token) => {
    if (!token || token === 'invalid') throw new Error('invalid token');
    return { userId: token, role: 'support', email: `${token}@leaf.test` };
  }),
  sign: jest.fn(() => 'signed-token')
}));

jest.mock('../../../utils/admin-user-cache', () => ({
  getAdminUser: jest.fn(async (userId) => {
    const data = mockAdminUsers[userId];
    return data ? { exists: true, data } : { exists: false, data: null };
  })
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'bots-financial-read-test-secret'),
  resolveJwtSecretList: jest.fn(() => ['bots-financial-read-test-secret'])
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(async () => undefined),
  getConnection: jest.fn(() => null),
  shutdown: jest.fn(async () => undefined)
}));

const mockEmptyQuery = {
  where: jest.fn(() => mockEmptyQuery),
  orderBy: jest.fn(() => mockEmptyQuery),
  limit: jest.fn(() => mockEmptyQuery),
  get: jest.fn(async () => ({ docs: [], empty: true, size: 0, forEach: () => {} }))
};
const mockFirestore = {
  collection: jest.fn(() => ({
    ...mockEmptyQuery,
    doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false, data: () => null })) }))
  }))
};

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => ({
    ref: jest.fn(() => ({ once: jest.fn(async () => ({ val: () => null })) }))
  })),
  getFirestore: jest.fn(() => mockFirestore),
  initializeFirebase: jest.fn()
}));

jest.mock('../../../services/kyc-policy-service', () => ({}));

jest.mock('../../../services/modern-metrics-service', () => ({
  getFinancialRidesStats: jest.fn(async () => ({ totalValue: 0, averageValue: 0, metadata: {} })),
  getOperationalFeeStats: jest.fn(async () => ({ totalValue: 0, metadata: {} }))
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const dashboardRoutes = require('../../../routes/dashboard');
const metricsRoutes = require('../../../routes/metrics');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', dashboardRoutes);
  app.use(metricsRoutes);
  return app;
}

const FINANCIAL_READS = [
  '/api/metrics/financial/rides',
  '/api/metrics/financial/operational-fee',
  '/api/revenue/stats',
  '/api/costs/insights'
];

const FINANCIAL_WRITES = [
  ['patch', '/api/drivers/driver-1/plan', { planType: 'plus' }],
  ['patch', '/api/subscriptions/driver-1', { status: 'active' }],
  ['post', '/api/financial/reconciliation/run', {}]
];

function isGuardRejection(response) {
  return response.status === 401 || response.status === 403;
}

describe('leitura financeira dos bots (adminUsers.financialRead)', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    for (const key of Object.keys(mockAdminUsers)) delete mockAdminUsers[key];
    Object.assign(mockAdminUsers, {
      bots_with_flag: { role: 'support', readOnly: true, financialRead: true, active: true },
      bots_without_flag: { role: 'support', readOnly: true, active: true },
      support_with_flag: { role: 'support', financialRead: true, active: true }
    });
  });

  it.each(FINANCIAL_READS)('bots com a flag lê %s', async (route) => {
    const response = await request(app).get(route).set('Authorization', 'Bearer bots_with_flag');
    expect(isGuardRejection(response)).toBe(false);
  });

  it.each(FINANCIAL_READS)('bots sem a flag segue com 403 em %s', async (route) => {
    const response = await request(app).get(route).set('Authorization', 'Bearer bots_without_flag');
    expect(response.status).toBe(403);
  });

  it.each(FINANCIAL_WRITES)('bots com a flag recebe 403 em %s %s', async (method, route, body) => {
    const response = await request(app)[method](route)
      .set('Authorization', 'Bearer bots_with_flag')
      .send(body);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'READ_ONLY_USER' });
  });

  it.each(FINANCIAL_READS)('usuário que não é somente leitura não ganha nada com a flag em %s', async (route) => {
    const response = await request(app).get(route).set('Authorization', 'Bearer support_with_flag');
    expect(response.status).toBe(403);
  });

  it('usuário que não é somente leitura com a flag segue barrado na escrita financeira', async () => {
    const response = await request(app)
      .patch('/api/drivers/driver-1/plan')
      .set('Authorization', 'Bearer support_with_flag')
      .send({ planType: 'plus' });
    expect(response.status).toBe(403);
    expect(response.body.code).not.toBe('READ_ONLY_USER');
  });

  it('a flag não abre métricas fora de /api/metrics/financial', async () => {
    const response = await request(app)
      .get('/api/metrics/rides/daily')
      .set('Authorization', 'Bearer bots_with_flag');
    expect(response.status).toBe(403);
  });
});

describe('allowsReadOnlyFinancial', () => {
  const { allowsReadOnlyFinancial } = require('../../../middleware/read-only-user');

  it('só vale para somente leitura com a flag, em GET/HEAD', () => {
    const bots = { readOnly: true, financialRead: true };
    expect(allowsReadOnlyFinancial({ method: 'GET', user: bots })).toBe(true);
    expect(allowsReadOnlyFinancial({ method: 'HEAD', user: bots })).toBe(true);
    for (const method of ['OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(allowsReadOnlyFinancial({ method, user: bots })).toBe(false);
    }
    expect(allowsReadOnlyFinancial({ method: 'GET', user: { readOnly: true } })).toBe(false);
    expect(allowsReadOnlyFinancial({ method: 'GET', user: { financialRead: true } })).toBe(false);
    expect(allowsReadOnlyFinancial({ method: 'GET' })).toBe(false);
  });
});

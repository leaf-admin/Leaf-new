jest.unmock('express');

const mockLogError = jest.fn();
const mockUpdateWebhook = jest.fn();
const mockDeleteWebhook = jest.fn();

jest.mock('axios', () => ({
  get: jest.fn(),
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn()
  }))
}));

jest.mock('../../../config/woovi-config', () => ({
  getWooviConfig: jest.fn(() => ({
    environment: 'test',
    baseUrl: 'https://api.woovi.test',
    apiToken: 'test-token',
    appId: null,
    masterApiToken: null
  })),
  getWooviAuthHeaders: jest.fn(() => ({
    Authorization: 'Bearer test-token'
  }))
}));

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next()
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: (...args) => mockLogError(...args)
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(true),
  getConnection: jest.fn(() => null)
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__')
    }
  }
}));

jest.mock('../../../services/woovi-driver-service', () => jest.fn().mockImplementation(() => ({
  updateWebhook: (...args) => mockUpdateWebhook(...args),
  deleteWebhook: (...args) => mockDeleteWebhook(...args)
})));

const express = require('express');
const request = require('supertest');
const axios = require('axios');
const wooviRoutes = require('../../../routes/woovi');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', wooviRoutes);
  return app;
}

// Before the fix these handlers threw a ReferenceError inside their own catch
// block, so Express 4 never answered and the request hung until the timeout.
describe('Woovi admin routes answer provider failures', () => {
  beforeEach(() => {
    mockLogError.mockClear();
    mockUpdateWebhook.mockReset();
    mockDeleteWebhook.mockReset();
    axios.get.mockReset();
  });

  test('check-status returns 500 and logs the correlation id', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('provider down'), { response: { data: { error: 'x' } } }));

    const response = await request(buildApp()).get('/woovi/check-status/corr-123').timeout(3000);

    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.any(Error),
      'Erro ao verificar status',
      expect.objectContaining({ correlationID: 'corr-123' })
    );
  });

  test('update-webhook returns 500 and logs the webhook id', async () => {
    mockUpdateWebhook.mockRejectedValue(new Error('provider down'));

    const response = await request(buildApp())
      .put('/woovi/update-webhook/wh-1')
      .send({ url: 'https://api.leaf.test/webhooks/woovi' })
      .timeout(3000);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'provider down' });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.any(Error),
      'Erro ao atualizar webhook',
      expect.objectContaining({ webhookId: 'wh-1' })
    );
  });

  test('delete-webhook returns 500 and logs the webhook id', async () => {
    mockDeleteWebhook.mockRejectedValue(new Error('provider down'));

    const response = await request(buildApp()).delete('/woovi/delete-webhook/wh-2').timeout(3000);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, error: 'provider down' });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.any(Error),
      'Erro ao deletar webhook',
      expect.objectContaining({ webhookId: 'wh-2' })
    );
  });
});

jest.unmock('express');
const express = require('express');
const request = require('supertest');
const { createHmac } = require('crypto');
const mockReceive = jest.fn();
const mockSend = jest.fn();
const mockHistory = jest.fn();
jest.mock('../../../services/whatsapp-support-service', () => ({
  receive: (...args) => mockReceive(...args), send: (...args) => mockSend(...args),
  history: (...args) => mockHistory(...args)
}));
jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.user = { id: 'agent-test', role: req.headers.authorization, readOnly: req.headers['x-test-read-only'] === 'true' };
    return next();
  },
  isSupportAgent: (user) => user.role === 'support'
}));
const { captureSignedWebhookRawBody } = require('../../../bootstrap/http-middleware');
const { webhook, conversations } = require('../../../routes/whatsapp-support');
const config = {
  WHATSAPP_SUPPORT_ENABLED: 'true', WHATSAPP_SUPPORT_APP_SECRET: 'fixture-app-secret',
  WHATSAPP_SUPPORT_VERIFY_TOKEN: 'fixture-verify-token', WHATSAPP_SUPPORT_ACCESS_TOKEN: 'fixture-access',
  WHATSAPP_SUPPORT_PHONE_NUMBER_ID: '12345', WHATSAPP_SUPPORT_WABA_ID: '67890'
};
const saved = {};
function app() {
  const value = express();
  value.use(express.json({ verify: captureSignedWebhookRawBody }));
  value.use('/api/integrations/whatsapp/webhook', webhook);
  value.use('/api/support', conversations);
  value.get('/api/support/chat/:userId/history', (_req, res) => res.json({ native: true }));
  return value;
}
const url = '/api/integrations/whatsapp/webhook';
const chat = '/api/support/chat/whatsapp:12345:5521999990000';
describe('WhatsApp webhook and agent-only routes', () => {
  beforeAll(() => {
    Object.keys(config).forEach((key) => { saved[key] = process.env[key]; process.env[key] = config[key]; });
  });
  afterAll(() => Object.keys(config).forEach((key) => {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }));
  beforeEach(() => { jest.clearAllMocks(); mockHistory.mockResolvedValue([]); mockReceive.mockResolvedValue(); mockSend.mockResolvedValue({ id: 'wamid.outbound' }); });

  it('verifies Meta challenge only with configured token and explicit subscribe mode', async () => {
    const result = await request(app()).get(url).query({ 'hub.mode': 'subscribe', 'hub.verify_token': config.WHATSAPP_SUPPORT_VERIFY_TOKEN, 'hub.challenge': '123' });
    expect(result.status).toBe(200);
    expect(result.text).toBe('123');
    expect((await request(app()).get(url).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '123' })).status).toBe(403);
  });

  it('validates exact raw bytes, rejects forged or absent signature and does not acknowledge failed storage', async () => {
    const raw = '{ "object": "whatsapp_business_account", "entry": [] }';
    const signature = `sha256=${createHmac('sha256', config.WHATSAPP_SUPPORT_APP_SECRET).update(raw).digest('hex')}`;
    const send = (body, sig = signature) => request(app()).post(url).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig).send(body);
    expect((await send(raw)).status).toBe(200);
    expect(mockReceive).toHaveBeenCalledTimes(1);
    expect((await send(JSON.stringify(JSON.parse(raw)))).status).toBe(403);
    expect((await send(raw, 'sha256=bad')).status).toBe(403);
    mockReceive.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await send(raw)).status).toBe(503);
  });

  it('blocks regular users, read-only writes, anonymous callers and sandbox scope', async () => {
    expect((await request(app()).get(`${chat}/history`)).status).toBe(401);
    expect((await request(app()).get(`${chat}/history`).set('Authorization', 'user')).status).toBe(403);
    expect((await request(app()).get(`${chat}/history?scope=sandbox`).set('Authorization', 'support')).status).toBe(403);
    expect((await request(app()).get(`${chat}/history?scope=operational`).set('Authorization', 'support').set('X-Leaf-Support-Scope', 'sandbox')).status).toBe(403);
    expect((await request(app()).post(`${chat}/message`).set('Authorization', 'support').set('X-Test-Read-Only', 'true').send({ message: 'test' })).status).toBe(403);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('uses authenticated actor and idempotency header, never a client-supplied recipient or actor', async () => {
    const response = await request(app()).post(`${chat}/message`).set('Authorization', 'support')
      .set('Idempotency-Key', 'fixture-request-0001').send({ message: 'Olá', to: 'other-person', actorId: 'spoof' });
    expect(response.status).toBe(200);
    expect(mockSend).toHaveBeenCalledWith('whatsapp:12345:5521999990000', 'Olá', 'fixture-request-0001', 'agent-test');
    expect((await request(app()).post(`${chat}/convert-ticket`).set('Authorization', 'support').send({})).status).toBe(409);
  });

  it('leaves native chat routes alone and disables the webhook when the feature flag is off', async () => {
    expect((await request(app()).get('/api/support/chat/leaf-user/history')).body).toEqual({ native: true });
    process.env.WHATSAPP_SUPPORT_ENABLED = 'false';
    try { expect((await request(app()).get(url)).status).toBe(503); }
    finally { process.env.WHATSAPP_SUPPORT_ENABLED = 'true'; }
  });
});

jest.unmock('express');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockEmit = jest.fn();

jest.mock('../../../services/bot-event-service', () => ({
  emit: (...args) => mockEmit(...args),
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logStructured: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const { captureSignedWebhookRawBody } = require('../../../bootstrap/http-middleware');
const alertRoutes = require('../../../routes/ops-alert-relay');

const SENTRY_SECRET = 'segredo-da-integracao-sentry';
const UPTIME_TOKEN = 'token-do-uptimerobot-0123456789';
const ENV_KEYS = ['SENTRY_WEBHOOK_SECRET', 'UPTIMEROBOT_WEBHOOK_TOKEN'];

function createApp() {
  const app = express();
  app.use(express.json({ verify: captureSignedWebhookRawBody }));
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/ops/alerts', alertRoutes);
  return app;
}

function sign(body, secret = SENTRY_SECRET) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

const issuePayload = {
  action: 'created',
  data: {
    issue: {
      id: '4512',
      shortId: 'LEAF-BACKEND-2K',
      title: 'TypeError: falha ao ler corrida de joao@exemplo.com',
      project: { slug: 'leaf-backend' },
      level: 'error',
      lastRelease: { version: 'leaf-backend@139ee5264' },
      permalink: 'https://leaf.sentry.io/issues/4512/',
      metadata: { value: 'segredo do usuário' },
    },
  },
};

describe('ops alert relay routes', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.SENTRY_WEBHOOK_SECRET = SENTRY_SECRET;
    process.env.UPTIMEROBOT_WEBHOOK_TOKEN = UPTIME_TOKEN;
    mockEmit.mockReset().mockResolvedValue({ queued: 1, id: 'evt_x' });
    alertRoutes._resetRateLimit();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  describe('POST /sentry', () => {
    it('relays a new issue with a valid signature, without personal data', async () => {
      const body = JSON.stringify(issuePayload);
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('content-type', 'application/json')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sign(body))
        .send(body);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ success: true, relayed: true });
      expect(mockEmit).toHaveBeenCalledTimes(1);
      const [type, data, options] = mockEmit.mock.calls[0];
      expect(type).toBe('sentry.issue_alert');
      expect(data).toMatchObject({
        issueId: '4512',
        shortId: 'LEAF-BACKEND-2K',
        project: 'leaf-backend',
        level: 'error',
        release: 'leaf-backend@139ee5264',
        link: 'https://leaf.sentry.io/issues/4512/',
        alertKind: 'novo',
        source: 'sentry',
      });
      expect(data.title).toBe('TypeError: falha ao ler corrida de [email]');
      expect(JSON.stringify(data)).not.toContain('segredo do usuário');
      expect(options).toMatchObject({ dedupeKey: 'issue:created:4512', severity: 'N2', money: false });
    });

    it('rejects an invalid signature', async () => {
      const body = JSON.stringify(issuePayload);
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('content-type', 'application/json')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sign(body, 'outro-segredo'))
        .send(body);

      expect(response.status).toBe(401);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('rejects a missing signature', async () => {
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('sentry-hook-resource', 'issue')
        .send(issuePayload);

      expect(response.status).toBe(401);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('refuses with 503 when the secret is not configured', async () => {
      delete process.env.SENTRY_WEBHOOK_SECRET;
      const body = JSON.stringify(issuePayload);
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('content-type', 'application/json')
        .set('sentry-hook-signature', sign(body))
        .send(body);

      expect(response.status).toBe(503);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('accepts but ignores resources the bots do not need', async () => {
      const body = JSON.stringify({ action: 'resolved', data: { issue: { id: '1' } } });
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('content-type', 'application/json')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sign(body))
        .send(body);

      expect(response.status).toBe(202);
      expect(response.body.relayed).toBe(false);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('refuses an oversized body', async () => {
      const body = JSON.stringify({ ...issuePayload, padding: 'x'.repeat(300 * 1024) });
      const response = await request(createApp())
        .post('/api/ops/alerts/sentry')
        .set('content-type', 'application/json')
        .set('sentry-hook-resource', 'issue')
        .set('sentry-hook-signature', sign(body))
        .send(body);

      expect(response.status).toBe(413);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('POST /uptimerobot', () => {
    const down = {
      monitorID: '7788',
      monitorFriendlyName: 'api.leaf.app.br',
      alertType: '1',
      alertDetails: 'Connection Timeout',
      alertDuration: '0',
    };

    it('relays a monitor down with the token in the header', async () => {
      const response = await request(createApp())
        .post('/api/ops/alerts/uptimerobot')
        .set('x-leaf-alert-token', UPTIME_TOKEN)
        .send(down);

      expect(response.status).toBe(202);
      const [type, data, options] = mockEmit.mock.calls[0];
      expect(type).toBe('uptime.monitor_down');
      expect(data).toEqual({
        monitorId: '7788',
        monitor: 'api.leaf.app.br',
        status: 'down',
        durationSeconds: 0,
        reason: 'Connection Timeout',
        source: 'uptimerobot',
      });
      expect(options).toMatchObject({ severity: 'N1', money: false });
    });

    it('relays a monitor up with the token in the query, sent as a form', async () => {
      const response = await request(createApp())
        .post(`/api/ops/alerts/uptimerobot?token=${UPTIME_TOKEN}`)
        .type('form')
        .send({ ...down, alertType: '2', alertDuration: '540' });

      expect(response.status).toBe(202);
      const [type, data] = mockEmit.mock.calls[0];
      expect(type).toBe('uptime.monitor_up');
      expect(data).toMatchObject({ status: 'up', durationSeconds: 540 });
      expect(data).not.toHaveProperty('token');
    });

    it('rejects a wrong or missing token', async () => {
      const wrong = await request(createApp())
        .post('/api/ops/alerts/uptimerobot')
        .set('x-leaf-alert-token', 'token-errado')
        .send(down);
      const missing = await request(createApp()).post('/api/ops/alerts/uptimerobot').send(down);

      expect(wrong.status).toBe(401);
      expect(missing.status).toBe(401);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('refuses with 503 when the token is not configured', async () => {
      delete process.env.UPTIMEROBOT_WEBHOOK_TOKEN;
      const response = await request(createApp())
        .post('/api/ops/alerts/uptimerobot')
        .set('x-leaf-alert-token', UPTIME_TOKEN)
        .send(down);

      expect(response.status).toBe(503);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('rate limits a flood from one address', async () => {
      const app = createApp();
      let last;
      for (let i = 0; i < 61; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        last = await request(app).post('/api/ops/alerts/uptimerobot').send(down);
      }
      expect(last.status).toBe(429);
    });
  });
});

jest.unmock('express');

const configureHttpMiddleware = require('../../../bootstrap/http-middleware');
const { isInternalAddress, SECURITY_HEADERS } = configureHttpMiddleware;
const { isAlertWebhookAuthorized } = require('../../../routes/alerts');

jest.mock('../../../firebase-config', () => ({ initializeFirebase: jest.fn() }));

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null, ended: false };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

function configure({ corsError = null } = {}) {
  const uses = [];
  const posts = {};
  const gets = {};
  const app = {
    disable: jest.fn(),
    use: jest.fn((...args) => uses.push(args)),
    post: jest.fn((path, ...handlers) => { posts[path] = handlers; }),
    get: jest.fn((path, ...handlers) => { gets[path] = handlers; })
  };
  const express = { json: jest.fn(() => 'json'), urlencoded: jest.fn(() => 'urlencoded'), raw: jest.fn(() => 'raw') };
  const cors = jest.fn(() => (_req, _res, next) => next(corsError));
  configureHttpMiddleware({
    app,
    server: {},
    express,
    cors,
    corsOptions: {},
    traceIdExpressMiddleware: 'trace',
    recordIngest: jest.fn(),
    getOtelIngestStatus: jest.fn(),
    logStructured: jest.fn()
  });
  return { app, uses, posts, gets };
}

describe('HTTP middleware security', () => {
  it('hides the framework and sends security headers on every response', () => {
    const { app, uses } = configure();
    expect(app.disable).toHaveBeenCalledWith('x-powered-by');
    const headerMiddleware = uses.map(([fn]) => fn).find((fn) => fn.name === 'applySecurityHeaders');
    const res = fakeRes();
    const next = jest.fn();
    headerMiddleware({}, res, next);
    expect(res.headers).toEqual(SECURITY_HEADERS);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(next).toHaveBeenCalled();
  });

  it('answers a refused CORS origin with 403 instead of a 500', () => {
    const { uses } = configure({ corsError: new Error('Não permitido pelo CORS') });
    const corsWrapper = uses[2][0];
    const res = fakeRes();
    const next = jest.fn();
    corsWrapper({}, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const allowed = configure().uses[2][0];
    const okNext = jest.fn();
    allowed({}, fakeRes(), okNext);
    expect(okNext).toHaveBeenCalledWith();
  });

  it('serves the OTLP sink only to internal callers', () => {
    const { posts, gets } = configure();
    const [guard] = posts['/otel/v1/traces'];
    expect(gets['/otel/health'][0]).toBe(guard);

    const external = fakeRes();
    const next = jest.fn();
    guard({ ip: '203.0.113.9', socket: { remoteAddress: '172.18.0.4' } }, external, next);
    expect(external.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();

    guard({ ip: '127.0.0.1', socket: { remoteAddress: '::ffff:127.0.0.1' } }, fakeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recognises loopback and private addresses only', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:10.77.0.2', '192.168.1.4', '172.16.0.1', '172.31.255.1']) {
      expect(isInternalAddress(ip)).toBe(true);
    }
    for (const ip of ['64.176.9.163', '172.32.0.1', '8.8.8.8', '', undefined]) {
      expect(isInternalAddress(ip)).toBe(false);
    }
  });
});

describe('alert webhook authorization', () => {
  const req = ({ header = '', authorization = '', body = {}, query = {} } = {}) => ({
    get: (name) => (name === 'x-leaf-alert-secret' ? header : name === 'authorization' ? authorization : undefined),
    body,
    query
  });

  it('fails closed in production when no secret is configured', () => {
    expect(isAlertWebhookAuthorized(req(), { NODE_ENV: 'production' })).toBe(false);
    expect(isAlertWebhookAuthorized(req(), { NODE_ENV: 'development' })).toBe(true);
  });

  it('accepts the secret in the header or body but never in the URL', () => {
    const env = { NODE_ENV: 'production', ALERT_WEBHOOK_SECRET: 's3cret-value' };
    expect(isAlertWebhookAuthorized(req({ header: 's3cret-value' }), env)).toBe(true);
    expect(isAlertWebhookAuthorized(req({ body: { secret: 's3cret-value' } }), env)).toBe(true);
    expect(isAlertWebhookAuthorized(req({ authorization: 'Bearer s3cret-value' }), env)).toBe(true);
    expect(isAlertWebhookAuthorized(req({ authorization: 'Bearer wrong-value' }), env)).toBe(false);
    expect(isAlertWebhookAuthorized(req({ query: { secret: 's3cret-value' } }), env)).toBe(false);
    expect(isAlertWebhookAuthorized(req({ header: 's3cret-valuX' }), env)).toBe(false);
    expect(isAlertWebhookAuthorized(req({ header: 'short' }), env)).toBe(false);
  });
});

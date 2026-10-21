const mockEmit = jest.fn();

jest.mock('../../../services/bot-event-service', () => ({
  emit: (...args) => mockEmit(...args),
}));

const crypto = require('crypto');
const relay = require('../../../services/external-alert-relay-service');
const { ROUTES, sanitizeData } = jest.requireActual('../../../services/bot-event-service');
const { shouldCaptureSignedWebhookRawBody } = require('../../../bootstrap/http-middleware');

describe('external alert relay service', () => {
  beforeEach(() => {
    mockEmit.mockReset().mockResolvedValue({ queued: 1 });
  });

  it('routes the new event types to the stability, operations and CTO bots', () => {
    expect(ROUTES['sentry.issue_alert']).toEqual(['operacao']);
    expect(ROUTES['uptime.monitor_down']).toEqual(['operacao', 'cto']);
    expect(ROUTES['uptime.monitor_up']).toEqual(['operacao']);
  });

  it('keeps the new alert fields through sanitizeData', () => {
    expect(sanitizeData({ issueId: '1', monitor: 'api', durationSeconds: 30, email: 'a@b.c' }))
      .toEqual({ issueId: '1', monitor: 'api', durationSeconds: 30 });
  });

  it('captures the raw body only for the Sentry relay among alert routes', () => {
    expect(shouldCaptureSignedWebhookRawBody({ originalUrl: '/api/ops/alerts/sentry' })).toBe(true);
    expect(shouldCaptureSignedWebhookRawBody({ originalUrl: '/api/ops/alerts/uptimerobot' })).toBe(false);
  });

  it('verifies the Sentry signature over the raw body', () => {
    const rawBody = Buffer.from('{"action":"created"}');
    const signature = crypto.createHmac('sha256', 's3cr3t').update(rawBody).digest('hex');
    expect(relay.verifySentrySignature({ rawBody, signature, secret: 's3cr3t' })).toBe(true);
    expect(relay.verifySentrySignature({ rawBody, signature: signature.toUpperCase(), secret: 's3cr3t' })).toBe(true);
    expect(relay.verifySentrySignature({ rawBody, signature, secret: 'outro' })).toBe(false);
    expect(relay.verifySentrySignature({ rawBody, signature: '', secret: 's3cr3t' })).toBe(false);
    expect(relay.verifySentrySignature({ rawBody: undefined, signature, secret: 's3cr3t' })).toBe(false);
    expect(relay.verifySentrySignature({ rawBody, signature, secret: '' })).toBe(false);
  });

  it('masks email, CPF and phone in alert text', () => {
    expect(relay.maskText('erro de maria@leaf.app.br cpf 123.456.789-09 tel (21) 99876-5432'))
      .toBe('erro de [email] cpf [cpf] tel [telefone]');
  });

  it('marks a Sentry regression and flags money-related titles', async () => {
    await relay.relaySentry({
      resource: 'issue',
      payload: { action: 'unresolved', data: { issue: { id: '9', title: 'Woovi charge timeout', level: 'warning' } } },
    });
    const [type, data, options] = mockEmit.mock.calls[0];
    expect(type).toBe('sentry.issue_alert');
    expect(data.alertKind).toBe('regressao');
    expect(options).toMatchObject({ severity: 'N2', money: true });
  });

  it('relays a fatal alert-rule trigger as N1', async () => {
    await relay.relaySentry({
      resource: 'event_alert',
      payload: { action: 'triggered', data: { event: { issue_id: '77', title: 'Crash', level: 'fatal', web_url: 'https://s/77' } } },
    });
    const [, data, options] = mockEmit.mock.calls[0];
    expect(data).toMatchObject({ issueId: '77', alertKind: 'regra', link: 'https://s/77' });
    expect(options.severity).toBe('N1');
  });

  it('ignores Sentry payloads without an issue id', async () => {
    const result = await relay.relaySentry({ resource: 'issue', payload: { action: 'created', data: {} } });
    expect(result).toEqual({ relayed: false, reason: 'ignored' });
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('ignores UptimeRobot payloads that are not down or up', async () => {
    expect(relay.parseUptimeAlert({ monitorID: '1', alertType: '3' })).toBeNull();
    expect(relay.parseUptimeAlert({ alertType: '1' })).toBeNull();
    const result = await relay.relayUptime({ monitorID: '1', alertType: '98' });
    expect(result.relayed).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('has no effect when bot events are off (emit reports disabled)', async () => {
    mockEmit.mockResolvedValue({ queued: 0, skipped: 'disabled' });
    const result = await relay.relayUptime({ monitorID: '5', alertType: '1' });
    expect(result).toMatchObject({ relayed: true, queued: 0, skipped: 'disabled' });
  });
});

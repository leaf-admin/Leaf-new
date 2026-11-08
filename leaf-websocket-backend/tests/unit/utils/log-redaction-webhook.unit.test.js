// Discord webhook URLs keep their credential in the path; Sentry HTTP
// breadcrumbs recorded them in full until this redaction existed.
const { redactSensitiveText, redactSensitiveValue } = require('../../../utils/log-redaction');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghijklmnopqrstuv';

describe('webhook URL redaction', () => {
  test.each([
    `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`,
    `https://discordapp.com/api/webhooks/123456789012345678/${TOKEN}?wait=true`,
    `https://ptb.discord.com/api/v10/webhooks/123456789012345678/${TOKEN}`
  ])('masks the token in %s', (url) => {
    const redacted = redactSensitiveText(url);
    expect(redacted).not.toContain(TOKEN);
    expect(redacted).toContain('/webhooks/123456789012345678/[REDACTED]');
  });

  test('masks the URL inside a Sentry HTTP breadcrumb', () => {
    const crumb = {
      category: 'http',
      data: { url: `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`, method: 'POST', status_code: 204 }
    };
    const redacted = redactSensitiveValue(crumb);
    expect(JSON.stringify(redacted)).not.toContain(TOKEN);
    expect(redacted.data.method).toBe('POST');
    expect(redacted.data.status_code).toBe(204);
  });

  test('leaves other webhook routes untouched', () => {
    expect(redactSensitiveText('POST /api/webhooks/woovi 200')).toBe('POST /api/webhooks/woovi 200');
    expect(redactSensitiveText('plain message')).toBe('plain message');
  });
});

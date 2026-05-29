const { shouldBypassRateLimit } = require('../../../middleware/rateLimiter');

describe('rateLimiter middleware bypasses infrastructure probes', () => {
  it.each([
    '/health',
    '/health/quick',
    '/health/readiness',
    '/health/liveness',
    '/api/health',
    '/api/health/runtime-flags',
    '/otel/health',
    '/otel/v1/traces'
  ])('bypasses %s', (path) => {
    expect(shouldBypassRateLimit({ path })).toBe(true);
  });

  it.each([
    '/api/woovi/webhook',
    '/api/payment/status',
    '/socket.io/',
    '/api/drivers/location',
    '/api/users/me'
  ])('keeps user/runtime path rate-limited: %s', (path) => {
    expect(shouldBypassRateLimit({ path })).toBe(false);
  });
});

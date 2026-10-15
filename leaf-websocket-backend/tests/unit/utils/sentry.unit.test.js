const mockScope = { setTag: jest.fn(), setExtras: jest.fn() };
const mockSentry = {
  init: jest.fn(),
  setTag: jest.fn(),
  withScope: jest.fn((callback) => callback(mockScope)),
  captureException: jest.fn(),
  captureMessage: jest.fn()
};
jest.mock('@sentry/node', () => mockSentry, { virtual: true });

describe('utils/sentry', () => {
  const load = () => {
    jest.resetModules();
    return require('../../../utils/sentry');
  };

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.GIT_SHA;
    jest.clearAllMocks();
  });

  it('stays off without SENTRY_DSN', () => {
    const sentry = load();

    expect(sentry.initSentry()).toBeNull();
    expect(sentry.captureLogEntry({ level: 'error', message: 'boom' })).toBe(false);
    expect(mockSentry.init).not.toHaveBeenCalled();
  });

  it('initialises errors-only, without its own OpenTelemetry or default PII', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    process.env.GIT_SHA = 'abc123';

    load().initSentry();

    expect(mockSentry.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      release: 'abc123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true
    }));
  });

  it('captures error entries once per message per minute', () => {
    process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
    const sentry = load();
    const error = new Error('redis down');

    expect(sentry.captureLogEntry({ level: 'error', message: 'redis down', error, service: 'queue' })).toBe(true);
    expect(sentry.captureLogEntry({ level: 'error', message: 'redis down', error })).toBe(false);
    expect(sentry.captureLogEntry({ level: 'error', message: 'payment failed' })).toBe(true);

    expect(mockSentry.captureException).toHaveBeenCalledWith(error);
    expect(mockSentry.captureMessage).toHaveBeenCalledWith('payment failed', 'error');
    expect(mockScope.setTag).toHaveBeenCalledWith('component', 'queue');
  });

  it('removes secrets and personal data before sending', () => {
    const { scrubEvent } = load();

    const event = scrubEvent({
      message: 'Falha para cpf 123.456.789-00 tel +5521999998888 mail ana@leaf.app.br em 1792071417',
      extra: { token: 'secret-token', phone: '(21) 99999-8888' }
    });

    expect(event.message).toBe('Falha para cpf [CPF] tel [PHONE] mail [EMAIL] em 1792071417');
    expect(event.extra.token).toBe('[REDACTED]');
    expect(event.extra.phone).toBe('[PHONE]');
  });
});

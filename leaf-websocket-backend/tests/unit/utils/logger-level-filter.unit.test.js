jest.mock('../../../utils/log-redaction', () => {
  const actual = jest.requireActual('../../../utils/log-redaction');
  return {
    ...actual,
    redactSensitiveText: jest.fn(actual.redactSensitiveText),
    redactSensitiveValue: jest.fn(actual.redactSensitiveValue),
    redactLogInfoInPlace: jest.fn(actual.redactLogInfoInPlace)
  };
});

describe('logger level filter', () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    process.env.LOG_LEVEL = originalLevel;
    jest.resetModules();
  });

  function load(level) {
    process.env.LOG_LEVEL = level;
    jest.resetModules();
    const redaction = require('../../../utils/log-redaction');
    const loggerModule = require('../../../utils/logger');
    Object.values(redaction).forEach((fn) => fn.mockClear && fn.mockClear());
    return { redaction, ...loggerModule };
  }

  it('skips redaction for levels below LOG_LEVEL', () => {
    const { redaction, logger, logStructured } = load('info');

    logger.debug('hot path', { driverId: 'd1' });
    logStructured('debug', 'hot path', { driverId: 'd1' });

    expect(redaction.redactLogInfoInPlace).not.toHaveBeenCalled();
    expect(redaction.redactSensitiveValue).not.toHaveBeenCalled();
  });

  it('still redacts enabled levels', () => {
    const { redaction, logger, logStructured } = load('info');

    logger.info('visible', { driverId: 'd1' });
    logStructured('info', 'visible', { driverId: 'd1' });

    expect(redaction.redactLogInfoInPlace).toHaveBeenCalled();
    expect(redaction.redactSensitiveValue).toHaveBeenCalled();
  });

  it('keeps debug logs when LOG_LEVEL=debug', () => {
    const { redaction, logger } = load('debug');

    logger.debug('visible debug');

    expect(redaction.redactLogInfoInPlace).toHaveBeenCalled();
  });
});

/**
 * Unit Tests for Logger Utility
 */

jest.mock('winston', () => {
  const formatFactory = () => jest.fn(() => ({}));
  const formatFn = jest.fn((formatter) => {
    return jest.fn(() => ({
      transform: formatter || ((info) => info)
    }));
  });
  formatFn.combine = formatFactory();
  formatFn.timestamp = formatFactory();
  formatFn.errors = formatFactory();
  formatFn.json = formatFactory();
  formatFn.printf = formatFactory();
  formatFn.colorize = formatFactory();

  const mockLoggerInstance = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    log: jest.fn()
  };

  return {
    format: formatFn,
    addColors: jest.fn(),
    createLogger: jest.fn(() => mockLoggerInstance),
    transports: {
      Console: jest.fn(),
      File: jest.fn()
    }
  };
});

jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn(() => null)
}));

describe('Logger Utility', () => {
  let loggerModule;
  let traceContext;

  beforeEach(() => {
    jest.resetModules();
    loggerModule = require('../../../utils/logger');
    traceContext = require('../../../utils/trace-context');
  });

  test('should expose expected public API', () => {
    expect(loggerModule).toBeDefined();
    expect(loggerModule).toHaveProperty('logger');
    expect(loggerModule).toHaveProperty('logError');
    expect(loggerModule).toHaveProperty('logEvent');
    expect(loggerModule).toHaveProperty('logPerformance');
    expect(loggerModule).toHaveProperty('logStructured');
    expect(loggerModule).toHaveProperty('logRedis');
  });

  test('logPerformance should write info with latency metadata', () => {
    loggerModule.logPerformance('test_operation', 120, { feature: 'rides' });

    expect(loggerModule.logger.info).toHaveBeenCalledWith('Performance: test_operation', expect.objectContaining({
      operation: 'test_operation',
      latency_ms: 120,
      duration: '120ms',
      feature: 'rides'
    }));
  });

  test('logError should write error with stack and context', () => {
    const err = new Error('boom');
    loggerModule.logError(err, { route: '/health' });

    expect(loggerModule.logger.error).toHaveBeenCalledWith('boom', expect.objectContaining({
      stack: err.stack,
      context: { route: '/health' }
    }));
  });

  test('logStructured should call base logger.log with level', () => {
    traceContext.getCurrentTraceId.mockReturnValue('trace-test-123');
    loggerModule.logStructured('info', 'structured message', { driverId: 'd1' });

    expect(loggerModule.logger.log).toHaveBeenCalledWith('info', 'structured message', expect.objectContaining({
      service: 'leaf-websocket-backend',
      traceId: 'trace-test-123',
      driverId: 'd1'
    }));
  });

  test('logEvent should keep event metadata', () => {
    loggerModule.logEvent('ride_requested', 'emit', { bookingId: 'b1' });

    expect(loggerModule.logger.info).toHaveBeenCalledWith('Event: ride_requested - emit', expect.objectContaining({
      eventType: 'ride_requested',
      action: 'emit',
      bookingId: 'b1'
    }));
  });

  test('logRedis should write via redisLogger.log', () => {
    loggerModule.logRedis('info', 'Redis op', { key: 'driver:1' });

    expect(loggerModule.redisLogger.log).toHaveBeenCalledWith('info', 'Redis op', expect.objectContaining({
      service: 'redis',
      key: 'driver:1'
    }));
  });
});

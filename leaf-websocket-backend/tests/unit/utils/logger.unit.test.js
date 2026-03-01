/**
 * Unit Tests for Logger Utility
 */

const logger = require('../../../utils/logger');
const traceContext = require('../../../utils/trace-context');

// Mock do uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-123')
}));

// Mock do winston
jest.mock('winston', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    log: jest.fn()
  };

  return {
    format: {
      combine: jest.fn(() => ({})),
      timestamp: jest.fn(() => ({})),
      errors: jest.fn(() => ({})),
      json: jest.fn(() => ({})),
      printf: jest.fn(() => ({}))
    },
    addColors: jest.fn(),
    createLogger: jest.fn(() => mockLogger),
    transports: {
      Console: jest.fn(),
      File: jest.fn()
    }
  };
});

// Mock do trace-context
jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn()
}));

describe('Logger Utility', () => {
  let mockWinstonLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset do singleton do logger para testes
    delete require.cache[require.resolve('../../../utils/logger')];

    // Mock do winston logger
    mockWinstonLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
      log: jest.fn()
    };

    // Mock winston completo
    jest.doMock('winston', () => ({
      format: {
        combine: jest.fn(() => ({})),
        timestamp: jest.fn(() => ({})),
        errors: jest.fn(() => ({})),
        json: jest.fn(() => ({})),
        printf: jest.fn(() => ({}))
      },
      addColors: jest.fn(),
      createLogger: jest.fn(() => mockWinstonLogger),
      transports: {
        Console: jest.fn(),
        File: jest.fn()
      }
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Logger Instance', () => {
    test('should create logger with correct configuration', () => {
      const logger = require('../../../utils/logger');

      expect(logger).toBeDefined();
      expect(logger).toHaveProperty('logger');
      expect(logger).toHaveProperty('logError');
      expect(logger).toHaveProperty('logEvent');
      expect(logger).toHaveProperty('logPerformance');
    });
  });

  describe('log function', () => {
    test('should log info messages correctly', () => {
      const logger = require('../../../utils/logger');
      const message = 'Test info message';
      const meta = { userId: '123', action: 'test' };

      logger.log('info', message, meta);

      // Verificar se o winston foi chamado corretamente
      expect(mockWinstonLogger.log).toHaveBeenCalledWith('info', message, meta);
    });

    test('should log error messages with stack trace', () => {
      const logger = require('../../../utils/logger');
      const error = new Error('Test error');
      error.stack = 'Error stack trace';

      logger.error('Test error message', { error });

      expect(mockWinstonLogger.error).toHaveBeenCalledWith('Test error message', { error });
    });
  });

  describe('Helper methods', () => {
    test('should have logError method', () => {
      const logger = require('../../../utils/logger');

      logger.logError(new Error('Test error'), 'Test context');

      expect(mockWinstonLogger.error).toHaveBeenCalled();
    });

    test('should have logEvent method', () => {
      const logger = require('../../../utils/logger');

      logger.logEvent('test_event', { userId: '123' });

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should have logPerformance method', () => {
      const logger = require('../../../utils/logger');

      logger.logPerformance('test_operation', 100);

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });

    test('should have logRedis method', () => {
      const logger = require('../../../utils/logger');

      logger.logRedis('info', 'Redis operation', { key: 'test' });

      expect(mockWinstonLogger.info).toHaveBeenCalled();
    });
  });

  describe('Structured logging', () => {
    test('should include traceId when available', () => {
      const logger = require('../../../utils/logger');
      const mockTraceId = 'trace-123';

      traceContext.getCurrentTraceId.mockReturnValue(mockTraceId);

      logger.info('Test message', { userId: '123' });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test message', {
        userId: '123',
        traceId: mockTraceId
      });
    });

    test('should include service name automatically', () => {
      const logger = require('../../../utils/logger');

      logger.info('Test message');

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test message', {
        service: 'leaf-websocket-backend'
      });
    });

    test('should include relevant metadata', () => {
      const logger = require('../../../utils/logger');

      logger.info('Test message', {
        rideId: 'ride-123',
        bookingId: 'booking-456',
        driverId: 'driver-789',
        customerId: 'customer-101',
        eventType: 'ride_requested',
        irrelevantField: 'should_be_filtered'
      });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test message', {
        service: 'leaf-websocket-backend',
        rideId: 'ride-123',
        bookingId: 'booking-456',
        driverId: 'driver-789',
        customerId: 'customer-101',
        eventType: 'ride_requested'
      });
    });
  });

  describe('Performance logging', () => {
    test('should log with latency information', () => {
      const logger = require('../../../utils/logger');

      logger.info('API call completed', {
        latency_ms: 150,
        endpoint: '/api/rides',
        method: 'GET'
      });

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('API call completed', {
        service: 'leaf-websocket-backend',
        latency_ms: 150,
        endpoint: '/api/rides',
        method: 'GET'
      });
    });
  });

  describe('Error handling', () => {
    test('should handle circular references in metadata', () => {
      const logger = require('../../../utils/logger');

      const circularObj = { name: 'test' };
      circularObj.self = circularObj;

      expect(() => {
        logger.info('Test with circular reference', { data: circularObj });
      }).not.toThrow();
    });

    test('should handle null and undefined values', () => {
      const logger = require('../../../utils/logger');

      expect(() => {
        logger.info('Test with null', { data: null, other: undefined });
      }).not.toThrow();

      expect(mockWinstonLogger.info).toHaveBeenCalledWith('Test with null', {
        service: 'leaf-websocket-backend',
        data: null,
        other: undefined
      });
    });
  });
});

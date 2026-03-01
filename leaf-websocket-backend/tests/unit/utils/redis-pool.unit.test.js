/**
 * Unit Tests for Redis Pool
 */

const RedisPool = require('../../../utils/redis-pool');

// Mock do ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    set: jest.fn(),
    hget: jest.fn(),
    hgetall: jest.fn(),
    hset: jest.fn(),
    del: jest.fn(),
    geoadd: jest.fn(),
    georadius: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    expire: jest.fn(),
    xadd: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    status: 'ready',
    options: {
      host: 'localhost',
      port: 6379,
      db: 0
    }
  }));
});

// Mock das dependências
jest.mock('../../../utils/tracer', () => ({
  getTracer: jest.fn(() => ({
    startSpan: jest.fn(() => ({
      setStatus: jest.fn(),
      setAttribute: jest.fn(),
      recordException: jest.fn(),
      setAttributes: jest.fn(),
      end: jest.fn()
    }))
  }))
}));

jest.mock('@opentelemetry/api', () => ({
  SpanStatusCode: {
    OK: 'OK',
    ERROR: 'ERROR'
  },
  trace: {
    getActiveSpan: jest.fn(() => null)
  }
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  logRedis: jest.fn()
}));

jest.mock('../../../utils/docker-detector', () => ({
  getRedisConfig: jest.fn(() => ({
    host: 'localhost',
    port: 6379,
    password: 'test_password',
    db: 0
  })),
  logEnvironment: jest.fn()
}));

jest.mock('../../../utils/trace-context', () => ({
  getCurrentTraceId: jest.fn(() => 'test-trace-id')
}));

jest.mock('../../../utils/prometheus-metrics', () => ({
  metrics: {
    recordRedis: jest.fn()
  }
}));

describe('RedisPool', () => {
  let mockRedis;
  let redisPool;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock do Redis constructor
    mockRedis = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      get: jest.fn(),
      set: jest.fn(),
      hget: jest.fn(),
      hgetall: jest.fn(),
      hset: jest.fn(),
      del: jest.fn(),
      geoadd: jest.fn(),
      georadius: jest.fn(),
      zadd: jest.fn(),
      zrem: jest.fn(),
      expire: jest.fn(),
      xadd: jest.fn(),
      publish: jest.fn(),
      subscribe: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      status: 'ready',
      options: {
        host: 'localhost',
        port: 6379,
        db: 0
      }
    };

    // Reset singleton
    delete require.cache[require.resolve('../../../utils/redis-pool')];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should create RedisPool instance', () => {
      redisPool = require("../../../utils/redis-pool");
      expect(redisPool).toBeDefined();
      expect(redisPool.pool).toBeDefined();
    });

    test('should initialize with correct configuration', () => {
      const Redis = require('ioredis');
      redisPool = require("../../../utils/redis-pool");

      expect(Redis).toHaveBeenCalledWith(expect.objectContaining({
        host: 'localhost',
        port: 6379,
        password: 'test_password',
        db: 0,
        maxRetriesPerRequest: 3,
        lazyConnect: false,
        keepAlive: 30000
      }));
    });

    test('should handle initialization errors', () => {
      const DockerDetector = require('../../../utils/docker-detector');
      const logger = require('../../../utils/logger');

      DockerDetector.getRedisConfig.mockImplementation(() => {
        throw new Error('Configuration error');
      });

      expect(() => {
        require("../../../utils/redis-pool");
      }).toThrow('Configuration error');

      expect(logger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Erro ao inicializar Redis Pool')
      );
    });
  });

  describe('Connection Management', () => {
    beforeEach(() => {
      redisPool = require("../../../utils/redis-pool");
    });

    test('should get connection from pool', () => {
      const connection = redisPool.getConnection();

      expect(connection).toBeDefined();
      expect(connection.status).toBe('ready');
    });

    test('should reconnect if connection is lost', async () => {
      const connection = redisPool.getConnection();

      // Simulate connection loss
      connection.status = 'end';

      const newConnection = redisPool.getConnection();

      expect(connection.connect).toHaveBeenCalled();
    });

    test('should handle ensureConnection successfully', async () => {
      const result = await redisPool.ensureConnection();

      expect(result).toBe(true);
    });

    test('should handle ensureConnection when connecting', async () => {
      redisPool.pool.status = 'connecting';

      // Mock the ready event
      setTimeout(() => {
        redisPool.pool.emit('ready');
      }, 100);

      const result = await redisPool.ensureConnection();

      expect(result).toBe(true);
    });

    test('should handle ensureConnection failure', async () => {
      redisPool.pool.status = 'connecting';

      setTimeout(() => {
        redisPool.pool.emit('error', new Error('Connection failed'));
      }, 100);

      await expect(redisPool.ensureConnection()).rejects.toThrow('Connection failed');
    });
  });

  describe('Event Handlers', () => {
    beforeEach(() => {
      redisPool = require("../../../utils/redis-pool");
    });

    test('should handle connect event', () => {
      const logger = require('../../../utils/logger');

      redisPool.pool.emit('connect');

      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Redis Pool conectado')
      );
    });

    test('should handle ready event', () => {
      const logger = require('../../../utils/logger');

      redisPool.pool.emit('ready');

      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Redis Pool pronto')
      );
    });

    test('should handle error event', () => {
      const logger = require('../../../utils/logger');
      const error = new Error('Connection error');

      redisPool.pool.emit('error', error);

      expect(logger.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Erro no Redis Pool'),
        expect.objectContaining({
          operation: 'error',
          errorCode: undefined
        })
      );
    });

    test('should handle ECONNREFUSED error specially', () => {
      const logger = require('../../../utils/logger');
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';

      redisPool.pool.emit('error', error);

      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Redis não está acessível')
      );
    });

    test('should handle close event', () => {
      const logger = require('../../../utils/logger');

      redisPool.pool.emit('close');

      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Redis Pool desconectado')
      );
    });

    test('should handle reconnecting event', () => {
      const logger = require('../../../utils/logger');

      redisPool.pool.emit('reconnecting', 1000);

      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Reconectando Redis Pool')
      );
    });

    test('should handle end event', () => {
      const logger = require('../../../utils/logger');

      redisPool.pool.emit('end');

      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Redis Pool desconectado')
      );
    });
  });

  describe('Redis Operations (Instrumented)', () => {
    beforeEach(() => {
      redisPool = require("../../../utils/redis-pool");
    });

    test('should instrument hget operation', async () => {
      const mockTracer = require('../../../utils/tracer');
      const mockSpan = {
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn()
      };

      mockTracer.getTracer.mockReturnValue({
        startSpan: jest.fn(() => mockSpan)
      });

      const connection = redisPool.getConnection();

      connection.hget.mockResolvedValue('test-value');
      const result = await connection.hget('test-key', 'field');

      expect(result).toBe('test-value');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'OK' });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    test('should handle operation errors', async () => {
      const mockTracer = require('../../../utils/tracer');
      const mockSpan = {
        setStatus: jest.fn(),
        setAttribute: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn()
      };

      mockTracer.getTracer.mockReturnValue({
        startSpan: jest.fn(() => mockSpan)
      });

      const connection = redisPool.getConnection();
      const error = new Error('Redis operation failed');

      connection.hget.mockRejectedValue(error);

      await expect(connection.hget('test-key', 'field')).rejects.toThrow('Redis operation failed');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 'ERROR', message: 'Redis operation failed' });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    test('should instrument multiple operations', async () => {
      const connection = redisPool.getConnection();

      await connection.hset('test-key', 'field', 'value');
      await connection.get('test-key');
      await connection.del('test-key');

      expect(connection.hset).toHaveBeenCalledWith('test-key', 'field', 'value');
      expect(connection.get).toHaveBeenCalledWith('test-key');
      expect(connection.del).toHaveBeenCalledWith('test-key');
    });
  });

  describe('Health Check', () => {
    beforeEach(() => {
      redisPool = require("../../../utils/redis-pool");
    });

    test('should perform successful health check', async () => {
      const health = await redisPool.healthCheck();

      expect(health).toEqual({
        status: 'healthy',
        latency: expect.any(Number),
        timestamp: expect.any(String)
      });
    });

    test('should handle health check failure', async () => {
      redisPool.pool.ping.mockRejectedValue(new Error('Connection failed'));

      const health = await redisPool.healthCheck();

      expect(health).toEqual({
        status: 'unhealthy',
        error: 'Connection failed',
        timestamp: expect.any(String)
      });
    });
  });

  describe('Pool Statistics', () => {
    beforeEach(() => {
      redisPool = require("../../../utils/redis-pool");
    });

    test('should return pool statistics', () => {
      const stats = redisPool.getPoolStats();

      expect(stats).toEqual({
        status: 'ready',
        connected: true,
        options: {
          host: 'localhost',
          port: 6379,
          db: 0
        }
      });
    });

    test('should return correct stats when disconnected', () => {
      redisPool.pool.status = 'end';

      const stats = redisPool.getPoolStats();

      expect(stats.status).toBe('end');
      expect(stats.connected).toBe(false);
    });
  });

  describe('Instrumentation Setup', () => {
    test('should not instrument already instrumented pool', () => {
      redisPool = require("../../../utils/redis-pool");
      redisPool.pool._instrumented = true;

      const connection = redisPool.getConnection();

      // Should not add instrumentation again
      expect(connection._instrumented).toBe(true);
    });

    test('should handle missing tracer gracefully', () => {
      const mockTracer = require('../../../utils/tracer');
      mockTracer.getTracer.mockReturnValue(null);

      redisPool = require("../../../utils/redis-pool");
      const connection = redisPool.getConnection();

      // Should still work without tracing
      expect(connection).toBeDefined();
    });
  });

  describe('Configuration Validation', () => {
    test('should handle missing dotenv gracefully', () => {
      jest.mock('dotenv', () => ({
        config: jest.fn(() => { throw new Error('dotenv not found'); })
      }));

      expect(() => {
        require("../../../utils/redis-pool");
      }).not.toThrow();
    });

    test('should use DockerDetector configuration', () => {
      const DockerDetector = require('../../../utils/docker-detector');

      DockerDetector.getRedisConfig.mockReturnValue({
        host: 'redis-server',
        port: 6380,
        password: 'docker_password',
        db: 1
      });

      redisPool = require("../../../utils/redis-pool");

      expect(DockerDetector.getRedisConfig).toHaveBeenCalled();
      expect(DockerDetector.logEnvironment).toHaveBeenCalled();
    });
  });
});


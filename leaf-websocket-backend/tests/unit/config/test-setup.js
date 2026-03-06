/**
 * Test Setup for Unit Tests
 *
 * Configuração global para testes unitários
 */

const dotenv = require('dotenv');

// Carregar variáveis de ambiente de teste
dotenv.config({ path: '.env' });

// Configurar NODE_ENV para test
process.env.NODE_ENV = 'test';

// Mock do console para reduzir verbosidade durante testes
const originalConsole = { ...console };

// Silenciar logs durante testes (exceto erros)
beforeAll(() => {
  console.log = jest.fn();
  console.info = jest.fn();
  console.warn = jest.fn();
  console.debug = jest.fn();
  // Manter console.error para ver erros reais
});

// Restaurar console após todos os testes
afterAll(() => {
  Object.assign(console, originalConsole);
});

// Limpar todos os mocks após cada teste
afterEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

// Configurar timeout global
jest.setTimeout(5000);

// Mock global para process.env
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://:test@localhost:6379';
process.env.PORT = '3001';
process.env.NODE_ENV = 'test';

// Mock do Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      })),
      where: jest.fn(() => ({
        get: jest.fn()
      }))
    }))
  })),
  database: jest.fn(() => ({
    ref: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      on: jest.fn(),
      off: jest.fn()
    }))
  })),
  messaging: jest.fn(() => ({
    send: jest.fn(),
    sendMulticast: jest.fn()
  })),
  storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn(),
        delete: jest.fn(),
        exists: jest.fn(),
        download: jest.fn()
      }))
    }))
  }))
}));

// Mock do ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    xadd: jest.fn(),
    hget: jest.fn(),
    hgetall: jest.fn(),
    hset: jest.fn(),
    hdel: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    scard: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    zadd: jest.fn(),
    zrem: jest.fn(),
    geoadd: jest.fn(),
    georadius: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
    emit: jest.fn(),
    status: 'ready',
    options: {
      host: 'localhost',
      port: 6379,
      db: 0
    }
  }));
});

// Mock do socket.io
jest.mock('socket.io', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    to: jest.fn(() => ({
      emit: jest.fn()
    })),
    sockets: {
      sockets: new Map(),
      adapter: {
        rooms: new Map()
      }
    }
  }));
});

// Mock do express
jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(() => mockApp),
    get: jest.fn(() => mockApp),
    post: jest.fn(() => mockApp),
    put: jest.fn(() => mockApp),
    delete: jest.fn(() => mockApp),
    listen: jest.fn((port, callback) => {
      if (callback) callback();
      return { close: jest.fn() };
    }),
    set: jest.fn(() => mockApp),
    engine: jest.fn(() => mockApp)
  };
  return jest.fn(() => mockApp);
});

// Helper para criar mock de request/response
global.createMockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  user: null,
  ...overrides
});

global.createMockRes = (overrides = {}) => {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    sendStatus: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    ...overrides
  };
  return res;
};

// Helper para criar mock do next function
global.createMockNext = () => jest.fn();

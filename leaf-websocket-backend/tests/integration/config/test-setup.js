/**
 * Test Setup for Integration Tests
 *
 * Configuração global para testes de integração
 */

const dotenv = require('dotenv');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Redis = require('ioredis');

// Carregar variáveis de ambiente de teste
dotenv.config({ path: '.env' });

// Configurar NODE_ENV para test
process.env.NODE_ENV = 'test';

// Global test server
let testServer;
let mongoServer;
let redisClient;

// Setup antes de todos os testes
beforeAll(async () => {
  // Iniciar MongoDB em memória para testes
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Configurar Redis para testes
  redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  await redisClient.flushall(); // Limpar Redis

  // Armazenar referências globais
  global.__MONGOSERVER__ = mongoServer;
  global.__REDISCLIENT__ = redisClient;
  global.__MONGOURI__ = mongoUri;

  console.log('🧪 Integration test setup complete');
}, 30000);

// Cleanup após todos os testes
afterAll(async () => {
  // Fechar conexões
  if (redisClient) {
    await redisClient.disconnect();
  }

  if (mongoServer) {
    await mongoServer.stop();
  }

  if (testServer) {
    await testServer.close();
  }

  console.log('🧪 Integration test cleanup complete');
}, 30000);

// Limpar dados entre testes
afterEach(async () => {
  // Limpar Redis
  if (redisClient) {
    await redisClient.flushall();
  }

  // Limpar dados do MongoDB se existir
  if (global.db) {
    const collections = await global.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
  }
});

// Configurar timeout global para testes de integração
jest.setTimeout(15000);

// Helper para iniciar servidor de teste
global.startTestServer = async (port = 3001) => {
  const server = require('../../server');

  return new Promise((resolve, reject) => {
    testServer = server.listen(port, (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`🚀 Test server started on port ${port}`);
        resolve(testServer);
      }
    });

    // Timeout para evitar travamentos
    setTimeout(() => {
      reject(new Error('Server startup timeout'));
    }, 10000);
  });
};

// Helper para fazer requests HTTP
global.testRequest = async (method, url, options = {}) => {
  const axios = require('axios');

  const config = {
    method: method.toUpperCase(),
    url: url.startsWith('http') ? url : `http://localhost:3001${url}`,
    ...options
  };

  try {
    const response = await axios(config);
    return {
      status: response.status,
      data: response.data,
      headers: response.headers
    };
  } catch (error) {
    if (error.response) {
      return {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        error: true
      };
    }
    throw error;
  }
};

// Helper para conectar via WebSocket
global.createWebSocketClient = (port = 3001) => {
  const io = require('socket.io-client');

  return io(`http://localhost:${port}`, {
    transports: ['websocket'],
    timeout: 5000,
    forceNew: true
  });
};

// Helper para aguardar eventos
global.waitForEvent = (socket, eventName, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });

    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
};

// Mock do Firebase para testes de integração
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: jest.fn(() => ({ id: 'test', name: 'Test User' }))
        }),
        set: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({})
      })),
      where: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          docs: [{
            id: 'test',
            data: () => ({ id: 'test', name: 'Test User' })
          }]
        })
      })),
      add: jest.fn().mockResolvedValue({ id: 'new-id' })
    }))
  })),
  database: jest.fn(() => ({
    ref: jest.fn(() => ({
      set: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn().mockResolvedValue({
        val: () => ({ id: 'test', name: 'Test User' })
      })
    }))
  })),
  messaging: jest.fn(() => ({
    send: jest.fn().mockResolvedValue('message-id'),
    sendMulticast: jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 0
    })
  }))
}));

// Silenciar logs durante testes de integração (exceto erros importantes)
const originalConsole = { ...console };
console.log = jest.fn();
console.info = jest.fn();
console.debug = jest.fn();
// Manter console.error, console.warn para ver problemas reais


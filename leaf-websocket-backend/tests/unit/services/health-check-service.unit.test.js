jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => ({
    ping: jest.fn().mockResolvedValue('PONG')
  }))
}));

jest.mock('../../../utils/docker-detector', () => ({
  getRedisConfig: jest.fn(() => ({
    host: '127.0.0.1',
    port: 6379,
    db: 0
  }))
}));

jest.mock('ioredis', () => jest.fn());

describe('health-check-service firebase checks', () => {
  let getFirestoreMock;
  let getFromRealtimeDBMock;
  let healthCheckService;

  beforeEach(() => {
    jest.resetModules();

    getFirestoreMock = jest.fn(() => ({
      collection: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({ empty: true })
        }))
      }))
    }));

    getFromRealtimeDBMock = jest.fn().mockResolvedValue(true);

    jest.doMock('../../../firebase-config', () => ({
      getFirestore: (...args) => getFirestoreMock(...args),
      getFromRealtimeDB: (...args) => getFromRealtimeDBMock(...args)
    }));

    healthCheckService = require('../../../services/health-check-service');
  });

  test('checkFirebase usa helper centralizado do RTDB', async () => {
    const result = await healthCheckService.checkFirebase();

    expect(getFromRealtimeDBMock).toHaveBeenCalledWith('.info/connected');
    expect(result.status).toBe('healthy');
    expect(result.components.realtimeDB.status).toBe('healthy');
  });
});

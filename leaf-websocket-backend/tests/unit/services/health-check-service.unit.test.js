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
  let os;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };

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
    os = require('os');
  });

  afterEach(() => {
    process.env = originalEnv;
    delete global.socketIoRedisAdapterStatus;
    delete global.io;
    jest.restoreAllMocks();
  });

  test('checkFirebase usa helper centralizado do RTDB', async () => {
    const result = await healthCheckService.checkFirebase();

    expect(getFromRealtimeDBMock).toHaveBeenCalledWith('.info/connected');
    expect(result.status).toBe('healthy');
    expect(result.components.realtimeDB.status).toBe('healthy');
    expect(result.cache.status).toBe('MISS');
  });

  test('checkFirebase reutiliza cache e nao repete leituras pagas', async () => {
    const first = await healthCheckService.checkFirebase();
    const second = await healthCheckService.checkFirebase();

    expect(first.cache.status).toBe('MISS');
    expect(second.cache.status).toBe('HIT');
    expect(getFirestoreMock).toHaveBeenCalledTimes(1);
    expect(getFromRealtimeDBMock).toHaveBeenCalledTimes(1);
  });

  test('checkFirebase deduplica verificacoes simultaneas', async () => {
    const [first, second] = await Promise.all([
      healthCheckService.checkFirebase(),
      healthCheckService.checkFirebase()
    ]);

    expect(first.cache.status).toBe('MISS');
    expect(second.cache.status).toBe('MISS');
    expect(getFirestoreMock).toHaveBeenCalledTimes(1);
    expect(getFromRealtimeDBMock).toHaveBeenCalledTimes(1);
  });

  test('checkSystem trata pico curto de CPU como warning em producao pequena', () => {
    process.env.NODE_ENV = 'production';

    jest.spyOn(os, 'freemem').mockReturnValue(6 * 1024 * 1024 * 1024);
    jest.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 * 1024 * 1024);
    jest.spyOn(os, 'loadavg').mockReturnValue([3.1, 1.9, 1.6]);
    jest.spyOn(os, 'cpus').mockReturnValue([{ model: 'cpu-1' }, { model: 'cpu-2' }]);
    jest.spyOn(os, 'uptime').mockReturnValue(7200);

    const result = healthCheckService.checkSystem();

    expect(result.status).toBe('warning');
    expect(result.cpu.usagePercent).toBe('155.0%');
    expect(result.cpu.usagePercent5m).toBe('95.0%');
    expect(result.message).toContain('pressão moderada');
  });

  test('checkSystem exige pressao sustentada para marcar critical por CPU', () => {
    process.env.NODE_ENV = 'production';

    jest.spyOn(os, 'freemem').mockReturnValue(6 * 1024 * 1024 * 1024);
    jest.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 * 1024 * 1024);
    jest.spyOn(os, 'loadavg').mockReturnValue([4.4, 3.0, 2.4]);
    jest.spyOn(os, 'cpus').mockReturnValue([{ model: 'cpu-1' }, { model: 'cpu-2' }]);
    jest.spyOn(os, 'uptime').mockReturnValue(7200);

    const result = healthCheckService.checkSystem();

    expect(result.status).toBe('critical');
    expect(result.cpu.usagePercent).toBe('220.0%');
    expect(result.cpu.usagePercent5m).toBe('150.0%');
    expect(result.message).toContain('pressão sustentada');
  });

  test('checkWebSocket marca unhealthy quando Redis adapter obrigatorio nao esta pronto', async () => {
    global.socketIoRedisAdapterStatus = {
      state: 'failed',
      enabled: true,
      required: true,
      runtimeRole: 'gateway',
      updatedAt: '2026-05-24T00:00:00.000Z',
      error: 'redis unavailable'
    };

    const result = await healthCheckService.checkWebSocket({
      engine: { clientsCount: 12 }
    });

    expect(result.status).toBe('unhealthy');
    expect(result.redisAdapter).toMatchObject({
      state: 'failed',
      enabled: true,
      required: true,
      runtimeRole: 'gateway',
      error: 'redis unavailable'
    });
    expect(result.message).toBe('Socket.IO Redis Adapter obrigatório não está pronto');
  });

  test('checkWebSocket expõe Redis adapter pronto sem degradar conexoes saudaveis', async () => {
    global.socketIoRedisAdapterStatus = {
      state: 'ready',
      enabled: true,
      required: true,
      runtimeRole: 'gateway',
      updatedAt: '2026-05-24T00:00:00.000Z'
    };

    const result = await healthCheckService.checkWebSocket({
      engine: { clientsCount: 12 }
    });

    expect(result.status).toBe('healthy');
    expect(result.redisAdapter).toMatchObject({
      state: 'ready',
      enabled: true,
      required: true
    });
  });

  test('quickCheck falha readiness quando adapter obrigatorio nao esta pronto', async () => {
    global.socketIoRedisAdapterStatus = {
      state: 'failed',
      enabled: true,
      required: true,
      runtimeRole: 'gateway',
      updatedAt: '2026-05-24T00:00:00.000Z',
      error: 'redis unavailable'
    };

    const result = await healthCheckService.quickCheck();

    expect(result.status).toBe('unhealthy');
    expect(result.checks.socketRedisAdapter).toMatchObject({
      status: 'unhealthy',
      state: 'failed',
      required: true
    });
  });

  test('separa o cache do health check por topologia Sentinel', () => {
    const config = {
      sentinels: [
        { host: 'sentinel-a', port: 26379 },
        { host: 'sentinel-b', port: 26379 },
        { host: 'sentinel-c', port: 26379 }
      ],
      name: 'leaf-master',
      db: 0,
      password: 'redis-secret'
    };

    expect(healthCheckService.getRedisHealthConfigKey(config)).toBe(
      'sentinel:leaf-master:sentinel-a:26379,sentinel-b:26379,sentinel-c:26379:0:with-pass'
    );
  });
});

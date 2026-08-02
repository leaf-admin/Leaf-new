const mockCreateAdapter = jest.fn(() => 'socket-adapter');
const mockInstances = [];

jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: mockCreateAdapter }));
jest.mock('ioredis', () => jest.fn().mockImplementation(config => {
  const instance = {
    config,
    status: 'wait',
    on: jest.fn(),
    connect: jest.fn(async () => { instance.status = 'ready'; }),
    duplicate: jest.fn(),
    ping: jest.fn(async () => 'PONG'),
    quit: jest.fn(async () => { instance.status = 'end'; })
  };
  const duplicate = {
    ...instance,
    on: jest.fn(),
    connect: jest.fn(async () => { duplicate.status = 'ready'; }),
    duplicate: jest.fn(),
    ping: jest.fn(async () => 'PONG'),
    quit: jest.fn(async () => { duplicate.status = 'end'; })
  };
  instance.duplicate.mockReturnValue(duplicate);
  mockInstances.push({ instance, duplicate });
  return instance;
}));

jest.mock('../../../utils/docker-detector', () => ({
  getRedisMode: jest.fn(() => 'sentinel'),
  getRedisUrl: jest.fn(() => 'redis://standalone-must-not-be-used:6379/0'),
  getRedisConfig: jest.fn(() => ({
    sentinels: [
      { host: 'sentinel-a', port: 26379 },
      { host: 'sentinel-b', port: 26379 },
      { host: 'sentinel-c', port: 26379 }
    ],
    name: 'leaf-master',
    role: 'master',
    password: 'redis-secret',
    sentinelPassword: 'sentinel-secret',
    db: 0
  })),
  describeRedisConfig: jest.fn(() => 'sentinel:leaf-master via three nodes'),
  logEnvironment: jest.fn()
}));

const Redis = require('ioredis');
const SocketIORedisAdapter = require('../../../services/socket-io-adapter');

describe('SocketIORedisAdapter with Sentinel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInstances.length = 0;
  });

  test('uses ioredis Sentinel discovery for both pub and sub clients', async () => {
    const io = { adapter: jest.fn() };
    const adapter = new SocketIORedisAdapter('redis://legacy-url:6379/0');

    expect(adapter.redisUrl).toBeNull();
    await adapter.initialize(io);

    expect(Redis).toHaveBeenCalledTimes(1);
    expect(Redis).toHaveBeenCalledWith(expect.objectContaining({
      name: 'leaf-master',
      role: 'master',
      lazyConnect: true,
      sentinels: expect.arrayContaining([{ host: 'sentinel-a', port: 26379 }])
    }));
    const { instance, duplicate } = mockInstances[0];
    expect(instance.duplicate).toHaveBeenCalledTimes(1);
    expect(instance.connect).toHaveBeenCalledTimes(1);
    expect(duplicate.connect).toHaveBeenCalledTimes(1);
    expect(mockCreateAdapter).toHaveBeenCalledWith(instance, duplicate);
    expect(io.adapter).toHaveBeenCalledWith('socket-adapter');
    expect(adapter.isInitialized).toBe(true);
  });
});

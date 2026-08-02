const DockerDetector = require('../../../utils/docker-detector');

const REDIS_ENV_KEYS = [
  'NODE_ENV',
  'REDIS_MODE',
  'REDIS_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_DB',
  'REDIS_USERNAME',
  'REDIS_PASSWORD',
  'REDIS_SENTINELS',
  'REDIS_SENTINEL_MASTER_NAME',
  'REDIS_SENTINEL_USERNAME',
  'REDIS_SENTINEL_PASSWORD',
  'REDIS_USE_TLS',
  'REDIS_SENTINEL_USE_TLS'
];

describe('DockerDetector Redis Sentinel config', () => {
  const originalEnv = {};

  beforeAll(() => {
    for (const key of REDIS_ENV_KEYS) originalEnv[key] = process.env[key];
  });

  beforeEach(() => {
    for (const key of REDIS_ENV_KEYS) delete process.env[key];
  });

  afterAll(() => {
    for (const key of REDIS_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  test('keeps standalone URL compatibility when Sentinel is disabled', () => {
    process.env.REDIS_URL = 'redis://leaf-user:secret@cache.internal:6380/4';

    expect(DockerDetector.getRedisMode()).toBe('standalone');
    expect(DockerDetector.getRedisConfig()).toEqual({
      host: 'cache.internal',
      port: 6380,
      username: 'leaf-user',
      password: 'secret',
      db: 4
    });
  });

  test('builds an ioredis master-discovery config from three Sentinels', () => {
    process.env.REDIS_MODE = 'sentinel';
    process.env.REDIS_URL = 'redis://wrong-standalone:6379/0';
    process.env.REDIS_SENTINELS = 'sentinel-a:26379,sentinel-b:26380,sentinel-c:26381';
    process.env.REDIS_SENTINEL_MASTER_NAME = 'leaf-master';
    process.env.REDIS_PASSWORD = 'redis-secret';
    process.env.REDIS_SENTINEL_PASSWORD = 'sentinel-secret';
    process.env.REDIS_DB = '2';

    const config = DockerDetector.getRedisConfig();

    expect(config).toEqual({
      sentinels: [
        { host: 'sentinel-a', port: 26379 },
        { host: 'sentinel-b', port: 26380 },
        { host: 'sentinel-c', port: 26381 }
      ],
      name: 'leaf-master',
      role: 'master',
      username: undefined,
      password: 'redis-secret',
      sentinelUsername: undefined,
      sentinelPassword: 'sentinel-secret',
      db: 2
    });
    expect(config).not.toHaveProperty('host');
    expect(DockerDetector.describeRedisConfig(config)).toBe(
      'sentinel:leaf-master via sentinel-a:26379,sentinel-b:26380,sentinel-c:26381'
    );
  });

  test.each([
    'sentinel-a:26379,sentinel-b:26380',
    'sentinel-a:26379,sentinel-a:26379,sentinel-c:26381',
    'sentinel-a:26379,sentinel-b:not-a-port,sentinel-c:26381',
    'sentinel-a:26379,sentinel-b:26380,sentinel-c:26381,sentinel-d:26382'
  ])('rejects a topology that cannot provide an odd three-node quorum: %s', value => {
    process.env.REDIS_MODE = 'sentinel';
    process.env.REDIS_SENTINELS = value;

    expect(() => DockerDetector.getRedisConfig()).toThrow();
  });

  test('requires both Redis and Sentinel authentication in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_MODE = 'sentinel';
    process.env.REDIS_SENTINELS = 'sentinel-a:26379,sentinel-b:26380,sentinel-c:26381';
    process.env.REDIS_PASSWORD = 'redis-secret';

    expect(() => DockerDetector.getRedisConfig()).toThrow(
      'Redis Sentinel em produção exige REDIS_PASSWORD e REDIS_SENTINEL_PASSWORD'
    );
  });
});

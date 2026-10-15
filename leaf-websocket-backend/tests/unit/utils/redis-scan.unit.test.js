const fs = require('fs');
const path = require('path');

jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const RedisScan = require('../../../utils/redis-scan');

describe('RedisScan.scanKeys', () => {
  it('iterates the cursor and drops keys SCAN returned more than once', async () => {
    const redis = {
      scan: jest.fn()
        .mockResolvedValueOnce(['7', ['driver_lock:a', 'driver_lock:b']])
        .mockResolvedValueOnce(['0', ['driver_lock:b', 'driver_lock:c']])
    };

    await expect(RedisScan.scanKeys(redis, 'driver_lock:*', 500)).resolves.toEqual([
      'driver_lock:a',
      'driver_lock:b',
      'driver_lock:c'
    ]);
    expect(redis.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'driver_lock:*', 'COUNT', 500);
    expect(redis.scan).toHaveBeenNthCalledWith(2, '7', 'MATCH', 'driver_lock:*', 'COUNT', 500);
  });

  it('stops early at maxKeys', async () => {
    const redis = { scan: jest.fn().mockResolvedValueOnce(['5', ['k:1', 'k:2', 'k:3']]) };

    await expect(RedisScan.scanKeys(redis, 'k:*', 100, 2)).resolves.toEqual(['k:1', 'k:2']);
    expect(redis.scan).toHaveBeenCalledTimes(1);
  });
});

describe('blocking KEYS usage', () => {
  it('is not used by active ioredis services and routes', () => {
    const root = path.resolve(__dirname, '../../..');
    // KYCFaceProcessor is unused legacy on the node-redis client (different SCAN API).
    const allowed = new Set(['services/KYCFaceProcessor.js']);
    const offenders = ['services', 'routes', 'bootstrap', 'workers']
      .flatMap((dir) => fs.readdirSync(path.join(root, dir))
        .filter((name) => name.endsWith('.js'))
        .map((name) => `${dir}/${name}`))
      .filter((file) => !allowed.has(file))
      .filter((file) => /\.keys\(\s*['`]/.test(fs.readFileSync(path.join(root, file), 'utf8')));

    expect(offenders).toEqual([]);
  });
});

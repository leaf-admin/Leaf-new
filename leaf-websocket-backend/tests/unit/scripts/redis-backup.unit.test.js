const {
  commandEnv,
  connectionArgs,
  resolveRedisBackupTarget
} = require('../../../scripts/ops/backup-redis.cjs');

describe('Redis backup connection safety', () => {
  test('keeps credentials out of redis-cli arguments', () => {
    const args = connectionArgs({
      host: 'redis.internal',
      port: 6379,
      username: 'leaf-runtime',
      password: 'must-not-appear'
    });
    const env = commandEnv('must-not-appear');

    expect(args).toEqual([
      '--no-auth-warning', '--raw', '-h', 'redis.internal', '-p', '6379',
      '--user', 'leaf-runtime'
    ]);
    expect(args.join(' ')).not.toContain('must-not-appear');
    expect(env.REDISCLI_AUTH).toBe('must-not-appear');
  });

  test('discovers the master through an authenticated Sentinel without exposing passwords', () => {
    const calls = [];
    const execute = jest.fn((command, args, options) => {
      calls.push({ command, args, options });
      if (calls.length === 1) throw new Error('sentinel-a unavailable');
      return 'redis-master.internal\n6380';
    });
    const target = resolveRedisBackupTarget({
      sentinels: [
        { host: 'sentinel-a', port: 26379 },
        { host: 'sentinel-b', port: 26379 },
        { host: 'sentinel-c', port: 26379 }
      ],
      name: 'leaf-master',
      sentinelUsername: 'sentinel-user',
      sentinelPassword: 'sentinel-secret',
      username: 'redis-user',
      password: 'redis-secret'
    }, execute);

    expect(target).toMatchObject({
      host: 'redis-master.internal',
      port: 6380,
      mode: 'sentinel',
      masterName: 'leaf-master',
      sentinelCount: 3
    });
    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain('sentinel-secret');
      expect(call.args.join(' ')).not.toContain('redis-secret');
      expect(call.options.env.REDISCLI_AUTH).toBe('sentinel-secret');
    }
  });
});

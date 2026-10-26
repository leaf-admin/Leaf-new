'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Redis = require('ioredis');

// Test-only server: no network listener, credentials, persistence or shared DB.
module.exports = async function withPrivateRedis(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-scale-'));
  const socket = path.join(directory, 'redis.sock');
  const server = spawn('redis-server', ['--port', '0', '--unixsocket', socket,
    '--unixsocketperm', '700', '--save', '', '--appendonly', 'no',
    '--maxmemory', '256mb', '--maxmemory-policy', 'noeviction', '--dir', directory], { stdio: 'ignore' });
  let startupError;
  server.on('error', error => { startupError = error; });
  let redis;
  try {
    for (let i = 0; i < 100 && !fs.existsSync(socket); i++) {
      if (startupError) throw startupError;
      if (server.exitCode !== null) throw new Error('Private Redis exited during startup');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    redis = new Redis(socket, { lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0 });
    redis.on('error', () => {});
    await redis.connect();
    return await run(redis);
  } finally {
    if (redis) await redis.quit().catch(() => redis.disconnect());
    if (server.pid && server.exitCode === null) {
      const exit = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      await exit;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

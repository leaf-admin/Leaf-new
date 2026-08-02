#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Redis = require('ioredis');
const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');
const SocketIORedisAdapter = require('../../services/socket-io-adapter');

const ROOT = path.resolve(__dirname, '../..');
const ARTIFACT_ROOT = path.join(ROOT, '..', 'test-results', 'runtime-redis-adapter');
const REDIS_PASSWORD = `leaf_runtime_smoke_${Date.now()}`;
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.RUNTIME_SMOKE_TIMEOUT_MS || '45000', 10);
const QA_DRIVER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';

const children = [];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function tailFile(filePath, maxChars = 4000) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.slice(Math.max(0, content.length - maxChars));
  } catch (_error) {
    return '';
  }
}

function appendLog(stream, prefix) {
  return (chunk) => {
    const text = chunk.toString();
    stream.write(text.split(/\r?\n/).filter(Boolean).map((line) => `[${prefix}] ${line}`).join('\n'));
    if (!text.endsWith('\n')) {
      stream.write('\n');
    }
  };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function spawnLogged(name, command, args, options = {}) {
  ensureDir(ARTIFACT_ROOT);
  const logPath = path.join(ARTIFACT_ROOT, `${name}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n[smoke] ${nowIso()} spawning: ${command} ${args.join(' ')}\n`);

  const child = spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', appendLog(logStream, 'stdout'));
  child.stderr.on('data', appendLog(logStream, 'stderr'));
  child.on('exit', (code, signal) => {
    logStream.write(`[smoke] ${nowIso()} exited code=${code} signal=${signal || ''}\n`);
    logStream.end();
  });

  const item = { name, child, logPath };
  children.push(item);
  return item;
}

async function waitFor(description, fn, { timeoutMs = DEFAULT_TIMEOUT_MS, intervalMs = 500 } = {}) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const suffix = lastError ? ` Último erro: ${lastError.message}` : '';
  throw new Error(`Timeout aguardando ${description}.${suffix}`);
}

async function startRedis(port) {
  const dataDir = path.join(os.tmpdir(), `leaf-runtime-smoke-redis-${Date.now()}`);
  ensureDir(dataDir);
  const redis = spawnLogged('redis', 'redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--requirepass', REDIS_PASSWORD,
    '--save', '',
    '--appendonly', 'no',
    '--dir', dataDir
  ]);

  const client = new Redis({
    host: '127.0.0.1',
    port,
    password: REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
  client.on('error', () => {
    // Redis pode levar alguns milissegundos para aceitar conexoes; o waitFor decide o resultado.
  });

  await waitFor('Redis real responder PING', async () => {
    await client.connect().catch((error) => {
      if (!String(error.message || '').includes('already connecting') && !String(error.message || '').includes('already connected')) {
        throw error;
      }
    });
    return (await client.ping()) === 'PONG';
  });

  await client.quit();
  return redis;
}

async function validateAdapterBroadcast(redisUrl) {
  const portA = await findFreePort();
  const portB = await findFreePort();
  const serverA = http.createServer();
  const serverB = http.createServer();
  const ioA = new Server(serverA, { transports: ['websocket'], serveClient: false });
  const ioB = new Server(serverB, { transports: ['websocket'], serveClient: false });
  const adapterA = new SocketIORedisAdapter(redisUrl);
  const adapterB = new SocketIORedisAdapter(redisUrl);
  const room = `runtime-adapter-smoke:${Date.now()}`;

  await Promise.all([
    new Promise((resolve) => serverA.listen(portA, '127.0.0.1', resolve)),
    new Promise((resolve) => serverB.listen(portB, '127.0.0.1', resolve))
  ]);
  await Promise.all([adapterA.initialize(ioA), adapterB.initialize(ioB)]);

  ioA.on('connection', (socket) => {
    socket.join(room);
  });
  ioB.on('connection', (socket) => {
    socket.join(room);
  });

  const clientA = createClient(`http://127.0.0.1:${portA}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });
  const clientB = createClient(`http://127.0.0.1:${portB}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  await Promise.all([
    new Promise((resolve, reject) => {
      clientA.once('connect', resolve);
      clientA.once('connect_error', reject);
    }),
    new Promise((resolve, reject) => {
      clientB.once('connect', resolve);
      clientB.once('connect_error', reject);
    })
  ]);

  const received = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('cross-instance broadcast não chegou ao client A')), 5000);
    clientA.once('runtime-adapter-smoke', (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  ioB.to(room).emit('runtime-adapter-smoke', { ok: true, emittedBy: 'instance-b', at: nowIso() });
  const payload = await received;

  clientA.close();
  clientB.close();
  await Promise.allSettled([adapterA.disconnect(), adapterB.disconnect()]);
  await Promise.all([
    new Promise((resolve) => ioA.close(() => serverA.close(resolve))),
    new Promise((resolve) => ioB.close(() => serverB.close(resolve)))
  ]);

  return {
    status: 'passed',
    ports: [portA, portB],
    payload
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = { raw: text };
  }
  return { statusCode: response.status, body };
}

function runtimeEnv({ runtime, port, redisPort, redisUrl }) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'runtime-smoke',
    LEAF_ENV: 'runtime-smoke',
    LEAF_SERVER_RUNTIME: runtime,
    LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'true',
    PORT: String(port),
    HOST: '127.0.0.1',
    RUNTIME_ROLE: 'gateway',
    AUTO_TEST_MODE: 'true',
    QA_SOCKET_BYPASS_UIDS: QA_DRIVER_UID,
    ALLOW_MULTIPLE_SESSIONS: 'false',
    ENABLE_SOCKETIO_REDIS_ADAPTER: 'true',
    REQUIRE_SOCKETIO_REDIS_ADAPTER: 'true',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_PASSWORD,
    REDIS_DB: '0',
    REDIS_URL: redisUrl,
    SOCKET_ALLOW_POLLING: 'false',
    CORS_ORIGIN: '*',
    JWT_SECRET: process.env.JWT_SECRET || 'runtime-smoke-secret',
    WOOVI_ENVIRONMENT: 'sandbox',
    WOOVI_BASE_URL: 'https://api-sandbox.woovi.com',
    REQUIRE_PAYMENT_BEFORE_BOOKING: 'true',
    VERIFY_PAYMENT_BEFORE_BOOKING: 'true',
    REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: 'true',
    MOCK_PAYMENT_FOR_TESTS: 'false',
    PAYMENT_FORCE_BYPASS: 'false',
    PAYMENT_BYPASS_ON_WOOVI_FAILURE: 'false',
    ENABLE_LEGACY_RUNTIME_ENDPOINTS: 'false',
    ENABLE_LEGACY_SOCKET_NOTIFICATIONS: 'false',
    ENABLE_LEGACY_SOCKET_BRIDGE: 'false',
    ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE: 'false',
    ENABLE_RUNTIME_DASHBOARD_WEBSOCKET: 'false',
    ENABLE_RUNTIME_CLEANUP_JOB: 'false',
    ENABLE_EMBEDDED_LISTENER_WORKERS: 'false',
    RUNTIME_ENABLE_QUEUE_WORKER: 'false',
    SUBSCRIPTION_DAILY_BILLING_ENABLED: 'false',
    ENABLE_DRIVER_ELIGIBILITY_FIREBASE: 'false',
    VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED: 'false',
    ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: 'false',
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn'
  };
}

async function startRuntime({ runtime, instance = 'primary', port, redisPort, redisUrl }) {
  const proc = spawnLogged(`runtime-${runtime}-${instance}`, 'bash', ['scripts/runtime/start-server.sh'], {
    cwd: ROOT,
    env: runtimeEnv({ runtime, port, redisPort, redisUrl })
  });

  await waitFor(`${runtime} liveness`, async () => {
    if (proc.child.exitCode !== null) {
      throw new Error(`${runtime} encerrou cedo. Logs:\n${tailFile(proc.logPath)}`);
    }
    const result = await fetchJson(`http://127.0.0.1:${port}/health/liveness`);
    return result.statusCode === 200 && result.body?.status === 'alive';
  }, { timeoutMs: DEFAULT_TIMEOUT_MS });

  const readiness = await waitFor(`${runtime} readiness com Socket.IO Redis Adapter`, async () => {
    if (proc.child.exitCode !== null) {
      throw new Error(`${runtime} encerrou cedo. Logs:\n${tailFile(proc.logPath)}`);
    }
    const result = await fetchJson(`http://127.0.0.1:${port}/health/quick`);
    const adapter = result.body?.checks?.socketRedisAdapter;
    if (result.statusCode === 200 && result.body?.status === 'healthy' && adapter?.state === 'ready') {
      return result;
    }
    return null;
  }, { timeoutMs: DEFAULT_TIMEOUT_MS });

  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const socketId = socket.id;
  socket.close();

  return {
    runtime,
    instance,
    port,
    pid: proc.child.pid,
    logPath: proc.logPath,
    readiness: readiness.body,
    socketConnect: {
      status: 'connected',
      socketId
    }
  };
}

async function connectQaDriver(port) {
  const socket = createClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    auth: {
      uid: QA_DRIVER_UID,
      qaAuthBypass: true,
      qaAutomation: true
    }
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout conectando motorista QA na porta ${port}`)), 5000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  const authenticated = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout autenticando motorista QA na porta ${port}`)), 5000);
    socket.once('authenticated', (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
    socket.once('authentication_error', (payload) => {
      clearTimeout(timeout);
      reject(new Error(payload?.message || 'Falha de autenticação QA'));
    });
  });

  socket.emit('authenticate', {
    uid: QA_DRIVER_UID,
    userType: 'driver',
    qaAuthBypass: true,
    qaAutomation: true
  });

  return {
    socket,
    authPayload: await authenticated
  };
}

async function validateDistributedDriverSessionReplacement(portA, portB) {
  const first = await connectQaDriver(portA);
  let second = null;

  try {
    const termination = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('A sessão anterior não recebeu SESSION_REPLACED')), 5000);
      first.socket.once('sessionTerminated', (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
    const disconnected = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('A sessão anterior não foi desconectada')), 5000);
      first.socket.once('disconnect', (reason) => {
        clearTimeout(timeout);
        resolve(reason);
      });
    });

    second = await connectQaDriver(portB);
    const [terminationPayload, disconnectReason] = await Promise.all([termination, disconnected]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (!second.socket.connected) {
      throw new Error('A sessão nova foi desconectada durante a substituição distribuída');
    }
    if (terminationPayload?.newSocketId !== second.socket.id) {
      throw new Error('SESSION_REPLACED não aponta para o socket novo');
    }
    if (terminationPayload?.previousSocketId !== first.authPayload?.socketId) {
      throw new Error('SESSION_REPLACED não aponta para o socket anterior');
    }

    return {
      status: 'passed',
      driverId: QA_DRIVER_UID,
      previousSocketId: first.authPayload.socketId,
      newSocketId: second.socket.id,
      disconnectReason,
      code: terminationPayload.code
    };
  } finally {
    first.socket.close();
    second?.socket?.close();
  }
}

async function shutdown() {
  for (const item of children.reverse()) {
    if (item.child.exitCode === null && !item.child.killed) {
      item.child.kill('SIGTERM');
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  for (const item of children) {
    if (item.child.exitCode === null && !item.child.killed) {
      item.child.kill('SIGKILL');
    }
  }
}

async function main() {
  ensureDir(ARTIFACT_ROOT);
  const redisPort = await findFreePort();
  const vpsPort = await findFreePort();
  const modularPort = await findFreePort();
  const modularSecondaryPort = await findFreePort();
  const redisUrl = `redis://:${encodeURIComponent(REDIS_PASSWORD)}@127.0.0.1:${redisPort}/0`;
  const startedAt = nowIso();

  const report = {
    startedAt,
    completedAt: null,
    redis: { port: redisPort },
    adapterBroadcast: null,
    distributedDriverSessionReplacement: null,
    runtimes: [],
    artifactsDir: ARTIFACT_ROOT
  };

  try {
    await startRedis(redisPort);
    report.adapterBroadcast = await validateAdapterBroadcast(redisUrl);
    const [vps, modular, modularSecondary] = await Promise.all([
      startRuntime({ runtime: 'vps', instance: 'legacy', port: vpsPort, redisPort, redisUrl }),
      startRuntime({ runtime: 'modular', instance: 'primary', port: modularPort, redisPort, redisUrl }),
      startRuntime({ runtime: 'modular', instance: 'secondary', port: modularSecondaryPort, redisPort, redisUrl })
    ]);
    report.runtimes.push(vps, modular, modularSecondary);
    report.distributedDriverSessionReplacement = await validateDistributedDriverSessionReplacement(
      modular.port,
      modularSecondary.port
    );
    report.completedAt = nowIso();

    const reportPath = path.join(ARTIFACT_ROOT, `runtime-redis-adapter-smoke-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, reportPath, summary: report }, null, 2));
  } catch (error) {
    report.completedAt = nowIso();
    report.error = error.message;
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-redis-adapter-smoke-failed-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.error(JSON.stringify({ ok: false, reportPath, error: error.message, summary: report }, null, 2));
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(130);
});
process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(143);
});

main();

#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Redis = require('ioredis');
const { io: createClient } = require('socket.io-client');

const ROOT = path.resolve(__dirname, '../..');
const ARTIFACT_ROOT = path.join(ROOT, '..', 'test-results', 'runtime-critical-events');
const REDIS_PASSWORD = `leaf_runtime_events_${Date.now()}`;
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.RUNTIME_EVENT_SMOKE_TIMEOUT_MS || '45000', 10);

const children = [];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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

function tailFile(filePath, maxChars = 5000) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.slice(Math.max(0, content.length - maxChars));
  } catch (_error) {
    return '';
  }
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

async function startRedis(port) {
  const dataDir = path.join(os.tmpdir(), `leaf-runtime-events-redis-${Date.now()}`);
  ensureDir(dataDir);
  spawnLogged('redis', 'redis-server', [
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
  client.on('error', () => {});

  await waitFor('Redis real responder PING', async () => {
    await client.connect().catch((error) => {
      if (!String(error.message || '').includes('already connecting') && !String(error.message || '').includes('already connected')) {
        throw error;
      }
    });
    return (await client.ping()) === 'PONG';
  });

  await client.quit();
}

function runtimeEnv({ runtime, port, redisPort, redisUrl }) {
  return {
    ...process.env,
    NODE_ENV: 'development',
    APP_ENV: 'runtime-smoke',
    LEAF_ENV: 'runtime-smoke',
    LEAF_SKIP_RUNTIME_CONFIG_VALIDATION: 'true',
    PORT: String(port),
    HOST: '127.0.0.1',
    RUNTIME_ROLE: 'gateway',
    AUTO_TEST_MODE: 'true',
    ALLOW_MULTIPLE_SESSIONS: 'true',
    QA_SOCKET_BYPASS_UIDS: 'runtime-smoke-passenger',
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
    ENABLE_RIDER_EARLY_END: 'true',
    TRIP_INTEGRITY_ENABLED: 'true',
    ENABLE_LEGACY_RUNTIME_ENDPOINTS: 'false',
    ENABLE_LEGACY_SOCKET_NOTIFICATIONS: 'false',
    ENABLE_LEGACY_SOCKET_BRIDGE: 'false',
    ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE: 'false',
    ENABLE_RUNTIME_DASHBOARD_WEBSOCKET: 'false',
    ENABLE_EMBEDDED_LISTENER_WORKERS: 'false',
    RUNTIME_ENABLE_QUEUE_WORKER: 'false',
    SUBSCRIPTION_DAILY_BILLING_ENABLED: 'false',
    ENABLE_DRIVER_ELIGIBILITY_FIREBASE: 'false',
    VEHICLE_LOCK_RECOVERY_FIREBASE_LOOKUP_ENABLED: 'false',
    ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE: 'false',
    LOG_LEVEL: process.env.LOG_LEVEL || 'warn'
  };
}

async function startRuntime({ runtime, port, redisPort, redisUrl }) {
  const proc = spawnLogged(`runtime-${runtime}`, 'bash', ['scripts/runtime/start-server.sh'], {
    cwd: ROOT,
    env: runtimeEnv({ runtime, port, redisPort, redisUrl })
  });

  await waitFor(`${runtime} liveness`, async () => {
    if (proc.child.exitCode !== null) {
      throw new Error(`${runtime} encerrou cedo. Logs:\n${tailFile(proc.logPath)}`);
    }
    const result = await fetchJson(`http://127.0.0.1:${port}/health/liveness`);
    return result.statusCode === 200 && result.body?.status === 'alive';
  });

  const readiness = await waitFor(`${runtime} readiness`, async () => {
    if (proc.child.exitCode !== null) {
      throw new Error(`${runtime} encerrou cedo. Logs:\n${tailFile(proc.logPath)}`);
    }
    const result = await fetchJson(`http://127.0.0.1:${port}/health/quick`);
    const adapter = result.body?.checks?.socketRedisAdapter;
    if (result.statusCode === 200 && result.body?.status === 'healthy' && adapter?.state === 'ready') {
      return result.body;
    }
    return null;
  });

  return {
    runtime,
    port,
    pid: proc.child.pid,
    logPath: proc.logPath,
    readiness
  };
}

function waitForEvent(socket, { successEvent, errorEvent, timeoutMs = 5000, predicate = null }) {
  const matches = typeof predicate === 'function' ? predicate : () => true;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener(successEvent, successHandler);
      if (errorEvent) {
        socket.removeListener(errorEvent, errorHandler);
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout_waiting_${successEvent}${errorEvent ? `_or_${errorEvent}` : ''}`));
    }, timeoutMs);
    const successHandler = (payload = {}) => {
      if (!matches(payload, successEvent)) return;
      cleanup();
      resolve({ event: successEvent, payload });
    };
    const errorHandler = (payload = {}) => {
      if (!matches(payload, errorEvent)) return;
      cleanup();
      resolve({ event: errorEvent, payload });
    };

    socket.on(successEvent, successHandler);
    if (errorEvent) {
      socket.on(errorEvent, errorHandler);
    }
  });
}

async function authenticate(socket) {
  const authPromise = waitForEvent(socket, {
    successEvent: 'authenticated',
    errorEvent: 'authentication_error',
    timeoutMs: 8000
  });
  socket.emit('authenticate', {
    uid: 'runtime-smoke-passenger',
    userType: 'customer'
  });
  const auth = await authPromise;
  if (auth.event !== 'authenticated' || auth.payload?.success !== true) {
    throw new Error(`authentication_failed:${JSON.stringify(auth.payload || {})}`);
  }
  return auth.payload;
}

async function emitAndExpect(socket, { emitEvent, emitPayload, successEvent, errorEvent, expectedEvent, timeoutMs = 6000 }) {
  const eventPromise = waitForEvent(socket, {
    successEvent,
    errorEvent,
    timeoutMs,
    predicate: (_payload, eventName) => !expectedEvent || eventName === expectedEvent
  });
  socket.emit(emitEvent, emitPayload);
  const result = await eventPromise;
  if (expectedEvent && result.event !== expectedEvent) {
    throw new Error(`${emitEvent}_unexpected_event:${result.event}`);
  }
  return {
    emitEvent,
    receivedEvent: result.event,
    payload: result.payload
  };
}

async function exerciseRuntime(runtimeInfo) {
  const socket = createClient(`http://127.0.0.1:${runtimeInfo.port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  try {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });

    const authenticated = await authenticate(socket);
    const checks = [];

    checks.push(await emitAndExpect(socket, {
      emitEvent: 'checkRideAvailability',
      emitPayload: {
        requestId: `${runtimeInfo.runtime}-availability-invalid`,
        pickupLocation: { lat: 'invalid', lng: -43.18 },
        carType: 'plus'
      },
      successEvent: 'rideAvailabilityResult',
      errorEvent: 'rideAvailabilityError',
      expectedEvent: 'rideAvailabilityError'
    }));

    checks.push(await emitAndExpect(socket, {
      emitEvent: 'passengerLocationUpdate',
      emitPayload: {
        bookingId: 'runtime-smoke-booking',
        lat: 'invalid',
        lng: -43.18
      },
      successEvent: 'passengerLocationUpdated',
      errorEvent: 'passengerLocationError',
      expectedEvent: 'passengerLocationError'
    }));

    checks.push(await emitAndExpect(socket, {
      emitEvent: 'confirmBoardingStatus',
      emitPayload: {},
      successEvent: 'boardingStatusConfirmed',
      errorEvent: 'boardingStatusError',
      expectedEvent: 'boardingStatusError'
    }));

    checks.push(await emitAndExpect(socket, {
      emitEvent: 'endTripEarlyByRider',
      emitPayload: {
        bookingId: 'runtime-smoke-booking'
      },
      successEvent: 'tripCompleted',
      errorEvent: 'tripCompleteError',
      expectedEvent: 'tripCompleteError'
    }));

    return {
      runtime: runtimeInfo.runtime,
      port: runtimeInfo.port,
      socketId: socket.id,
      authenticated,
      checks
    };
  } finally {
    socket.close();
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
  const modularPort = await findFreePort();
  const redisUrl = `redis://:${encodeURIComponent(REDIS_PASSWORD)}@127.0.0.1:${redisPort}/0`;
  const report = {
    startedAt: nowIso(),
    completedAt: null,
    redis: { port: redisPort },
    runtimes: [],
    artifactsDir: ARTIFACT_ROOT
  };

  try {
    await startRedis(redisPort);
    const runtimes = await Promise.all([
      startRuntime({ runtime: 'modular', port: modularPort, redisPort, redisUrl })
    ]);

    for (const runtimeInfo of runtimes) {
      const contract = await exerciseRuntime(runtimeInfo);
      report.runtimes.push({
        ...runtimeInfo,
        contract
      });
    }

    report.completedAt = nowIso();
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-critical-events-smoke-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, reportPath, summary: report }, null, 2));
  } catch (error) {
    report.completedAt = nowIso();
    report.error = error.message;
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-critical-events-smoke-failed-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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

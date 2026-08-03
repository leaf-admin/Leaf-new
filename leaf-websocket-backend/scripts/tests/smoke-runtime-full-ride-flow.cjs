#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const Redis = require('ioredis');
const WebSocket = require('ws');

let createSocketIoClient = null;
const FORCE_RAW_SOCKET = process.env.RUNTIME_FULL_FLOW_FORCE_RAW_WS === 'true';
try {
  if (!FORCE_RAW_SOCKET) {
    ({ io: createSocketIoClient } = require('socket.io-client'));
  }
} catch (_error) {
  createSocketIoClient = null;
}

const ROOT = path.resolve(__dirname, '../..');
const ARTIFACT_ROOT = process.env.RUNTIME_FULL_FLOW_ARTIFACT_ROOT ||
  path.join(ROOT, '..', 'test-results', 'runtime-full-ride-flow');
const REDIS_PASSWORD = `leaf_runtime_full_flow_${Date.now()}`;
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.RUNTIME_FULL_FLOW_TIMEOUT_MS || '60000', 10);
const EXISTING_RUNTIME_URL = (process.env.RUNTIME_FULL_FLOW_TARGET_URL || '').replace(/\/+$/, '');
const USE_EXISTING_RUNTIME = Boolean(EXISTING_RUNTIME_URL);
const CLEANUP_REDIS_KEYS = process.env.RUNTIME_FULL_FLOW_CLEANUP_REDIS === 'true' || USE_EXISTING_RUNTIME;
const VERBOSE = process.env.RUNTIME_FULL_FLOW_VERBOSE === 'true' || USE_EXISTING_RUNTIME;
const INCLUDE_RIDE_CATEGORY = process.env.RUNTIME_FULL_FLOW_INCLUDE_RIDE_CATEGORY !== 'false';

const PICKUP = {
  lat: Number(process.env.RUNTIME_FULL_FLOW_PICKUP_LAT || -22.971964),
  lng: Number(process.env.RUNTIME_FULL_FLOW_PICKUP_LNG || -43.182543),
  address: process.env.RUNTIME_FULL_FLOW_PICKUP_ADDRESS || 'Copacabana Palace, Rio de Janeiro, RJ'
};

const DESTINATION = {
  lat: Number(process.env.RUNTIME_FULL_FLOW_DEST_LAT || -22.984843),
  lng: Number(process.env.RUNTIME_FULL_FLOW_DEST_LNG || -43.221972),
  address: process.env.RUNTIME_FULL_FLOW_DEST_ADDRESS || 'Leblon, Rio de Janeiro, RJ'
};

const children = [];

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logProgress(message) {
  if (VERBOSE) {
    console.log(`[runtime-full-flow] ${message}`);
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
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
    await sleep(intervalMs);
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

function toSocketIoWebSocketUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/socket.io/';
  url.search = 'EIO=4&transport=websocket';
  return url.toString();
}

class RawSocketIoClient extends EventEmitter {
  constructor(baseUrl, { eventLogLabel } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.eventLogLabel = eventLogLabel;
    this.anyHandlers = new Set();
    this.connected = false;
    this.ws = new WebSocket(toSocketIoWebSocketUrl(baseUrl));

    this.ws.on('message', (data) => this.handlePacket(data.toString()));
    this.ws.on('error', (error) => {
      this.emit('connect_error', error);
      if (this.listenerCount('error') > 0) {
        super.emit('error', error);
      }
    });
    this.ws.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
    });
  }

  onAny(handler) {
    this.anyHandlers.add(handler);
  }

  offAny(handler) {
    this.anyHandlers.delete(handler);
  }

  emit(eventName, payload) {
    if (eventName === 'connect' || eventName === 'connect_error' || eventName === 'disconnect' || eventName === 'error') {
      return super.emit(eventName, payload);
    }
    this.send(`42${JSON.stringify([eventName, payload])}`);
    return true;
  }

  close() {
    this.ws.close();
  }

  send(packet) {
    if (this.ws.readyState !== WebSocket.OPEN) {
      setTimeout(() => this.send(packet), 25);
      return;
    }
    this.ws.send(packet);
  }

  handlePacket(packet) {
    if (packet === '2') {
      this.send('3');
      return;
    }

    if (packet.startsWith('0')) {
      this.send('40');
      return;
    }

    if (packet.startsWith('40')) {
      this.connected = true;
      super.emit('connect');
      return;
    }

    if (packet.startsWith('44')) {
      const payload = this.parsePayload(packet.slice(2));
      const error = new Error(payload?.message || payload?.error || 'socket.io_connect_error');
      error.payload = payload;
      super.emit('connect_error', error);
      return;
    }

    if (!packet.startsWith('42')) {
      return;
    }

    const parsed = this.parsePayload(packet.slice(2));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
      return;
    }

    const [eventName, payload = {}] = parsed;
    for (const handler of this.anyHandlers) {
      handler(eventName, payload);
    }
    super.emit(eventName, payload);
  }

  parsePayload(raw) {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }
}

async function startRedis(port) {
  const dataDir = path.join(os.tmpdir(), `leaf-runtime-full-flow-redis-${Date.now()}`);
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
    ALLOW_MULTIPLE_SESSIONS: 'true',
    ENABLE_SOCKETIO_REDIS_ADAPTER: 'true',
    REQUIRE_SOCKETIO_REDIS_ADAPTER: 'true',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisPort),
    REDIS_PASSWORD,
    REDIS_DB: '0',
    REDIS_URL: redisUrl,
    SOCKET_ALLOW_POLLING: 'false',
    CORS_ORIGIN: '*',
    JWT_SECRET: process.env.JWT_SECRET || 'runtime-full-flow-secret',
    AUTO_TEST_MODE: 'false',
    E2E_GENERATE_FIREBASE_TOKEN: 'false',
    REQUIRE_PAYMENT_BEFORE_BOOKING: 'false',
    VERIFY_PAYMENT_BEFORE_BOOKING: 'false',
    REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING: 'false',
    MOCK_PAYMENT_FOR_TESTS: 'true',
    CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK: 'true',
    ENABLE_QUEUE_BACKPRESSURE: 'false',
    ENFORCE_PAYMENT_FARE_LOCK: 'false',
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

function createRideClient({ port, socketUrl, label, eventLog }) {
  const baseUrl = socketUrl || `http://127.0.0.1:${port}`;
  const socket = createSocketIoClient
    ? createSocketIoClient(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000
    })
    : new RawSocketIoClient(baseUrl, { eventLogLabel: label });

  socket.onAny((eventName, payload = {}) => {
    eventLog.push({
      at: Date.now(),
      side: label,
      eventName,
      bookingId: payload?.bookingId || payload?.rideId || null,
      code: payload?.code || null,
      success: payload?.success ?? null
    });
  });

  return socket;
}

function waitForSocketEvent(socket, {
  eventName,
  errorEvent = null,
  timeoutMs = 10000,
  predicate = null
}) {
  const matches = typeof predicate === 'function' ? predicate : () => true;

  return new Promise((resolve, reject) => {
    let timeout = null;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeListener(eventName, successHandler);
      if (errorEvent) {
        socket.removeListener(errorEvent, errorHandler);
      }
    };
    const successHandler = (payload = {}) => {
      if (!matches(payload, eventName)) return;
      cleanup();
      resolve({ eventName, payload });
    };
    const errorHandler = (payload = {}) => {
      cleanup();
      const error = new Error(payload?.error || payload?.message || `Erro em ${eventName}`);
      error.payload = payload;
      error.eventName = errorEvent;
      reject(error);
    };

    timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout_waiting_${eventName}${errorEvent ? `_or_${errorEvent}` : ''}`));
    }, timeoutMs);

    socket.on(eventName, successHandler);
    if (errorEvent) {
      socket.on(errorEvent, errorHandler);
    }
  });
}

async function connectAndAuthenticate(socket, { uid, userType }) {
  if (!socket.connected) {
    await withTimeout(new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    }), 10000, `socket_connect_timeout:${uid}`);
  }

  const authPromise = waitForSocketEvent(socket, {
    eventName: 'authenticated',
    errorEvent: 'authentication_error',
    timeoutMs: 10000
  });
  const token = userType === 'driver'
    ? process.env.RUNTIME_FULL_FLOW_DRIVER_TOKEN
    : process.env.RUNTIME_FULL_FLOW_PASSENGER_TOKEN;
  socket.emit('authenticate', {
    uid,
    userType,
    ...(token ? { token } : {}),
    qaAuthBypass: process.env.RUNTIME_FULL_FLOW_QA_AUTH_BYPASS === 'true',
    qaAutomation: process.env.RUNTIME_FULL_FLOW_QA_AUTH_BYPASS === 'true'
  });
  const auth = await authPromise;
  if (auth.payload?.success !== true) {
    throw new Error(`authentication_failed:${uid}`);
  }
  return auth.payload;
}

async function emitAndWait(socket, {
  emitEvent,
  emitPayload,
  successEvent,
  errorEvent,
  timeoutMs = 15000,
  predicate = null
}) {
  const eventPromise = waitForSocketEvent(socket, {
    eventName: successEvent,
    errorEvent,
    timeoutMs,
    predicate
  });
  socket.emit(emitEvent, emitPayload);
  const result = await eventPromise;
  return result.payload;
}

async function maybeWaitForEvent(socket, options) {
  try {
    return await waitForSocketEvent(socket, options);
  } catch (_error) {
    return null;
  }
}

async function seedDriverOnline(redis, { driverId, lat, lng }) {
  const timestamp = Date.now();
  const driverStatus = {
    id: driverId,
    driverId,
    name: 'Carlos Motorista Teste',
    phone: '+5521999999999',
    photoUrl: '',
    isOnline: 'true',
    status: 'AVAILABLE',
    lat: String(lat),
    lng: String(lng),
    heading: '88',
    speed: '0',
    lastUpdate: String(timestamp),
    timestamp: String(timestamp),
    lastSeen: new Date(timestamp).toISOString(),
    rating: '5.0',
    acceptanceRate: '98.0',
    avgResponseTime: '3.0',
    totalTrips: '42',
    driverApproved: 'true',
    vehicleApproved: 'true',
    carType: 'leafplus',
    vehicleCategory: 'plus',
    acceptsPlusWithElite: 'true',
    dispatchEligible: 'true',
    dispatchEligibilityCode: 'ELIGIBLE',
    dispatchEligibilityCheckedAt: new Date(timestamp).toISOString(),
    vehicleModel: 'Toyota Prius',
    vehiclePlate: 'TES8888',
    carColor: 'black'
  };

  await redis.del(
    `driver_lock:${driverId}`,
    `driver_active_notification:${driverId}`,
    `active_trip_by_driver:${driverId}`,
    `active_trip_customer_by_driver:${driverId}`
  );
  await redis.hset(`driver:${driverId}`, driverStatus);
  await redis.geoadd('driver_locations', lng, lat, driverId);
  await redis.geoadd('driver_locations_eligible', lng, lat, driverId);
  await redis.sadd('online_drivers', driverId);
  await redis.zrem('driver_offline_locations', driverId);
  await redis.expire(`driver:${driverId}`, 300);
}

function timedStep(timings, name, startedAt) {
  timings[name] = Date.now() - startedAt;
}

function buildRedisOptionsFromEnv() {
  if (process.env.REDIS_URL) {
    return {
      url: process.env.REDIS_URL,
      maxRetriesPerRequest: 1
    };
  }
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number.parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 1
  };
}

function createRedisClient(options) {
  if (options?.url) {
    return new Redis(options.url, {
      maxRetriesPerRequest: options.maxRetriesPerRequest || 1
    });
  }
  return new Redis(options);
}

async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  return keys;
}

async function cleanupFlowKeys(redis, { bookingId, passengerId, driverId }) {
  const patterns = [
    bookingId ? `*${bookingId}*` : null,
    passengerId ? `*${passengerId}*` : null,
    driverId ? `*${driverId}*` : null
  ].filter(Boolean);

  const keys = new Set();
  for (const pattern of patterns) {
    for (const key of await scanKeys(redis, pattern)) {
      keys.add(key);
    }
  }

  if (driverId) {
    await redis.zrem('driver_locations', driverId).catch(() => null);
    await redis.zrem('driver_locations_eligible', driverId).catch(() => null);
    await redis.zrem('driver_offline_locations', driverId).catch(() => null);
    await redis.srem('online_drivers', driverId).catch(() => null);
  }
  if (bookingId) {
    await redis.hdel('bookings:active', bookingId).catch(() => null);
  }

  if (keys.size > 0) {
    await redis.del(...Array.from(keys));
  }

  return {
    deletedKeys: keys.size,
    patterns
  };
}

async function runFlowForRuntime({ runtimeInfo, redisOptions, flushBeforeRun = true, cleanupAfterRun = false }) {
  const redis = createRedisClient(redisOptions);
  redis.on('error', () => {});
  if (flushBeforeRun) {
    await redis.flushdb();
  }

  const eventLog = [];
  const idSuffix = process.env.RUNTIME_FULL_FLOW_ID_SUFFIX || `${runtimeInfo.runtime}-${Date.now()}`;
  const passengerId = `runtime-full-passenger-${idSuffix}`;
  const driverId = `runtime-full-driver-${idSuffix}`;
  const passenger = createRideClient({ port: runtimeInfo.port, socketUrl: runtimeInfo.socketUrl, label: 'passenger', eventLog });
  const driver = createRideClient({ port: runtimeInfo.port, socketUrl: runtimeInfo.socketUrl, label: 'driver', eventLog });
  const timings = {};
  const flowStartedAt = Date.now();
  let heartbeat = null;
  let bookingId = null;
  let cleanup = null;

  try {
    if (!flushBeforeRun) {
      logProgress(`${runtimeInfo.runtime}: limpando chaves antigas do proprio smoke`);
      cleanup = await cleanupFlowKeys(redis, { passengerId, driverId });
    }

    logProgress(`${runtimeInfo.runtime}: autenticando passageiro e motorista`);
    await Promise.all([
      connectAndAuthenticate(passenger, { uid: passengerId, userType: 'customer' }),
      connectAndAuthenticate(driver, { uid: driverId, userType: 'driver' })
    ]);
    timedStep(timings, 'authenticatedMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: colocando motorista online`);
    await seedDriverOnline(redis, {
      driverId,
      lat: PICKUP.lat + 0.0002,
      lng: PICKUP.lng + 0.0002
    });

    const sendDriverLocation = (seq = Date.now()) => {
      driver.emit('updateLocation', {
        driverId,
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
        heading: 88,
        speed: 0,
        tripStatus: 'idle',
        isInTrip: false,
        seq
      });
    };
    sendDriverLocation(1);
    heartbeat = setInterval(() => sendDriverLocation(Date.now() % 100000), 1200);
    await sleep(500);
    timedStep(timings, 'driverOnlineMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: criando booking`);
    const paymentId = `runtime_full_payment_${runtimeInfo.runtime}_${Date.now()}`;
    if (process.env.RUNTIME_FULL_FLOW_PRESEED_PAYMENT_CACHE === 'true') {
      await redis.set(
        `payment_status_cache:${paymentId}`,
        JSON.stringify({
          status: 'in_holding',
          amount: 2750,
          chargeId: paymentId,
          paymentId,
          paidAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          source: 'runtime_full_flow_smoke'
        }),
        'EX',
        900
      );
    }
    const preseededPaymentFlow = process.env.RUNTIME_FULL_FLOW_PRESEED_PAYMENT_CACHE === 'true';
    const rideRequestPromise = preseededPaymentFlow
      ? waitForSocketEvent(driver, {
        eventName: 'newRideRequest',
        timeoutMs: 30000,
        predicate: (payload = {}) => !bookingId || String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
      })
      : null;

    const bookingPayload = {
      customerId: passengerId,
      pickupLocation: PICKUP,
      destinationLocation: DESTINATION,
      estimatedFare: 27.5,
      routeDistanceKm: 5.5,
      routeDurationSecs: 900,
      tollFee: 0,
      paymentMethod: 'pix',
      paymentStatus: preseededPaymentFlow ? 'confirmed' : 'pending_payment',
      paymentId,
      paymentAmountInCents: 2750,
      paymentData: {
        chargeId: paymentId,
        paymentId,
        amountInCents: 2750,
        paymentStatus: preseededPaymentFlow ? 'confirmed' : 'pending_payment'
      },
      ...(INCLUDE_RIDE_CATEGORY ? {
        carType: 'leafplus',
        selectedVehicle: 'leafplus'
      } : {}),
      preferences: {
        temperature: 'cool',
        music: 'quiet',
        conversation: 'low'
      },
      idempotencyKey: `runtime_full_${runtimeInfo.runtime}_${Date.now()}`
    };
    const booking = await emitAndWait(passenger, {
      emitEvent: 'createBooking',
      emitPayload: bookingPayload,
      successEvent: 'bookingCreated',
      errorEvent: 'bookingError',
      timeoutMs: 30000,
      predicate: (payload = {}) => payload?.success === true || Boolean(payload?.bookingId)
    });
    bookingId = booking.bookingId || booking.rideId;
    if (!bookingId) {
      throw new Error(`booking_id_missing:${JSON.stringify(booking)}`);
    }
    timedStep(timings, 'bookingCreatedMs', flowStartedAt);

    let payment = null;
    if (preseededPaymentFlow) {
      logProgress(`${runtimeInfo.runtime}: pagamento ja validado antes do booking`);
      payment = {
        bookingId,
        paymentId,
        paymentStatus: 'confirmed',
        source: 'preseed_payment_status_cache'
      };
    } else {
      logProgress(`${runtimeInfo.runtime}: confirmando pagamento mock`);
      payment = await emitAndWait(passenger, {
        emitEvent: 'confirmPayment',
        emitPayload: {
          bookingId,
          paymentMethod: 'pix',
          paymentId,
          amount: 27.5,
          mockPayment: true,
          __mockPayment: true,
          idempotencyKey: `${bookingId}:confirmPayment`
        },
        successEvent: 'paymentConfirmed',
        errorEvent: 'paymentError',
        timeoutMs: 20000,
        predicate: (payload = {}) => String(payload?.bookingId || '') === String(bookingId)
      });
    }
    timedStep(timings, 'paymentConfirmedMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: aguardando oferta no motorista`);
    const rideRequest = rideRequestPromise
      ? await rideRequestPromise
      : await waitForSocketEvent(driver, {
        eventName: 'newRideRequest',
        timeoutMs: 30000,
        predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
      });
    if (String(rideRequest?.payload?.bookingId || rideRequest?.payload?.rideId || '') !== String(bookingId)) {
      throw new Error(`newRideRequest_booking_mismatch:${rideRequest?.payload?.bookingId || rideRequest?.payload?.rideId || 'missing'}`);
    }
    timedStep(timings, 'driverNotifiedMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: aceitando corrida`);
    const passengerAcceptedPromise = waitForSocketEvent(passenger, {
      eventName: 'rideAccepted',
      timeoutMs: 15000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    }).catch((error) => ({ error }));
    const driverAccepted = await emitAndWait(driver, {
      emitEvent: 'acceptRide',
      emitPayload: { bookingId },
      successEvent: 'rideAccepted',
      errorEvent: 'acceptRideError',
      timeoutMs: 15000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    });
    const passengerAccepted = await passengerAcceptedPromise;
    if (passengerAccepted?.error) {
      throw new Error(`passenger_rideAccepted_missing:${passengerAccepted.error.message}`);
    }
    await waitFor(`snapshot ativo da corrida ${bookingId}`, async () => {
      const activeSnapshot = await redis.hget('bookings:active', bookingId);
      return activeSnapshot || null;
    }, { timeoutMs: 8000, intervalMs: 200 });
    timedStep(timings, 'rideAcceptedMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: marcando chegada no embarque`);
    const passengerArrivedPromise = maybeWaitForEvent(passenger, {
      eventName: 'driverArrived',
      timeoutMs: 15000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    });
    const arrived = await emitAndWait(driver, {
      emitEvent: 'notificationAction',
      emitPayload: {
        action: 'arrived_at_pickup',
        bookingId,
        location: {
          lat: PICKUP.lat + 0.00005,
          lng: PICKUP.lng + 0.00005
        }
      },
      successEvent: 'notificationActionSuccess',
      errorEvent: 'notificationActionError',
      timeoutMs: 15000,
      predicate: (payload = {}) =>
        String(payload?.bookingId || payload?.rideId || '') === String(bookingId) &&
        String(payload?.action || 'arrived_at_pickup') === 'arrived_at_pickup' &&
        payload?.success !== false
    });
    const passengerArrived = await passengerArrivedPromise;
    timedStep(timings, 'arrivedAtPickupMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: iniciando viagem`);
    const passengerTripStartedPromise = waitForSocketEvent(passenger, {
      eventName: 'tripStarted',
      timeoutMs: 20000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    }).catch((error) => ({ error }));
    const driverTripStarted = await emitAndWait(driver, {
      emitEvent: 'startTrip',
      emitPayload: {
        bookingId,
        startLocation: PICKUP,
        mockPayment: true,
        __mockPayment: true
      },
      successEvent: 'tripStarted',
      errorEvent: 'tripStartError',
      timeoutMs: 20000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    });
    const passengerTripStarted = await passengerTripStartedPromise;
    if (passengerTripStarted?.error) {
      throw new Error(`passenger_tripStarted_missing:${passengerTripStarted.error.message}`);
    }
    timedStep(timings, 'tripStartedMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: enviando localizacao em viagem`);
    clearInterval(heartbeat);
    heartbeat = null;
    for (let index = 0; index < 3; index += 1) {
      const progress = (index + 1) / 4;
      driver.emit('updateLocation', {
        driverId,
        bookingId,
        lat: PICKUP.lat + ((DESTINATION.lat - PICKUP.lat) * progress),
        lng: PICKUP.lng + ((DESTINATION.lng - PICKUP.lng) * progress),
        heading: 240,
        speed: 24,
        tripStatus: 'in_progress',
        isInTrip: true,
        seq: index + 2
      });
      await sleep(250);
    }
    await sleep(500);
    const passengerLocationEventSeen = eventLog.some((event) =>
      event.side === 'passenger' &&
      ['driverLocation', 'tripLocationUpdated'].includes(event.eventName) &&
      String(event.bookingId || '') === String(bookingId)
    );
    timedStep(timings, 'locationUpdatesSentMs', flowStartedAt);

    logProgress(`${runtimeInfo.runtime}: concluindo viagem`);
    const passengerTripCompletedPromise = waitForSocketEvent(passenger, {
      eventName: 'tripCompleted',
      timeoutMs: 30000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    }).catch((error) => ({ error }));
    const paymentDistributedPromise = maybeWaitForEvent(driver, {
      eventName: 'paymentDistributed',
      timeoutMs: 10000,
      predicate: (payload = {}) => String(payload?.bookingId || '') === String(bookingId)
    });
    const driverTripCompleted = await emitAndWait(driver, {
      emitEvent: 'completeTrip',
      emitPayload: {
        bookingId,
        endLocation: DESTINATION,
        distance: 5.5,
        fare: 27.5,
        mockPayment: true,
        __mockPayment: true
      },
      successEvent: 'tripCompleted',
      errorEvent: 'tripCompleteError',
      timeoutMs: 30000,
      predicate: (payload = {}) => String(payload?.bookingId || payload?.rideId || '') === String(bookingId)
    });
    const passengerTripCompleted = await passengerTripCompletedPromise;
    if (passengerTripCompleted?.error) {
      throw new Error(`passenger_tripCompleted_missing:${passengerTripCompleted.error.message}`);
    }
    const paymentDistributed = await paymentDistributedPromise;
    timedStep(timings, 'tripCompletedMs', flowStartedAt);

    await sleep(500);
    const bookingHash = await redis.hgetall(`booking:${bookingId}`);
    const activeBooking = await redis.get(`customer_active_booking:${passengerId}`);
    const activeDriverTrip = await redis.get(`active_trip_by_driver:${driverId}`);
    const requiredRedisFields = [
      'customerId',
      'driverId',
      'status',
      'paymentStatus',
      'finalFare',
      'driverNetAmount',
      'completedAt'
    ];
    const missingFields = requiredRedisFields.filter((field) => !String(bookingHash?.[field] || '').trim());
    if (String(bookingHash?.status || '').toUpperCase() !== 'COMPLETED') {
      throw new Error(`booking_not_completed:${bookingHash?.status || 'missing'}`);
    }
    if (String(bookingHash?.driverId || '') !== String(driverId)) {
      throw new Error(`booking_driver_mismatch:${bookingHash?.driverId || 'missing'}`);
    }
    if (activeBooking || activeDriverTrip) {
      throw new Error(`active_trip_cleanup_failed:customer=${activeBooking || ''}:driver=${activeDriverTrip || ''}`);
    }
    if (missingFields.length > 0) {
      throw new Error(`booking_missing_fields:${missingFields.join(',')}`);
    }
    logProgress(`${runtimeInfo.runtime}: fluxo validado`);

    const result = {
      runtime: runtimeInfo.runtime,
      ok: true,
      bookingId,
      passengerId,
      driverId,
      timings,
      events: {
        bookingCreated: Boolean(booking),
        paymentConfirmed: Boolean(payment),
        driverReceivedNewRideRequest: Boolean(rideRequest?.payload),
        driverRideAccepted: Boolean(driverAccepted),
        passengerRideAccepted: true,
        driverArrivedAtPickup: Boolean(arrived),
        passengerArrivedAtPickup: Boolean(passengerArrived?.payload),
        driverTripStarted: Boolean(driverTripStarted),
        passengerTripStarted: true,
        passengerLocationEvent: passengerLocationEventSeen,
        driverTripCompleted: Boolean(driverTripCompleted),
        passengerTripCompleted: true,
        paymentDistributed: Boolean(paymentDistributed?.payload)
      },
      redisAssertions: {
        status: bookingHash.status,
        paymentStatus: bookingHash.paymentStatus,
        finalFare: bookingHash.finalFare,
        tollFee: bookingHash.tollFee || '0',
        driverNetAmount: bookingHash.driverNetAmount,
        activeBookingCleared: !activeBooking,
        activeDriverTripCleared: !activeDriverTrip
      },
      samples: {
        newRideRequest: {
          bookingId: rideRequest.payload?.bookingId || rideRequest.payload?.rideId || null,
          estimatedFare: rideRequest.payload?.estimatedFare || rideRequest.payload?.fare || null,
          pickupAddress: rideRequest.payload?.pickupLocation?.address || null,
          destinationAddress: rideRequest.payload?.destinationLocation?.address || null
        },
        tripCompleted: {
          passengerFare: passengerTripCompleted.payload?.fareBreakdown?.passengerPaidAmount || passengerTripCompleted.payload?.finalFare || bookingHash.finalFare || null,
          driverNetAmount: passengerTripCompleted.payload?.fareBreakdown?.driverNetAmount || bookingHash.driverNetAmount || null,
          tollFee: passengerTripCompleted.payload?.fareBreakdown?.tollFee || passengerTripCompleted.payload?.tollFee || bookingHash.tollFee || null
        }
      },
      eventLog: eventLog.slice(-80)
    };
    return result;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    passenger.close();
    driver.close();
    if (cleanupAfterRun) {
      cleanup = await cleanupFlowKeys(redis, { bookingId, passengerId, driverId }).catch((error) => ({
        error: error.message
      }));
      if (cleanup?.error) {
        console.warn(`[runtime-full-flow] cleanup warning: ${cleanup.error}`);
      }
    }
    await redis.quit().catch(() => null);
  }
}

async function stopChild(item) {
  if (!item || item.child.exitCode !== null || item.child.killed) return;
  item.child.kill('SIGTERM');
  await sleep(600);
  if (item.child.exitCode === null && !item.child.killed) {
    item.child.kill('SIGKILL');
  }
}

async function shutdown() {
  for (const item of children.reverse()) {
    await stopChild(item);
  }
}

async function mainExistingRuntime() {
  const runtimeName = process.env.RUNTIME_FULL_FLOW_TARGET_RUNTIME || 'existing';
  const safeRuntimeName = runtimeName.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  const report = {
    startedAt: nowIso(),
    completedAt: null,
    mode: 'existing-runtime',
    targetUrl: EXISTING_RUNTIME_URL,
    redis: {
      host: process.env.REDIS_HOST || null,
      port: process.env.REDIS_PORT || null,
      db: process.env.REDIS_DB || null,
      urlConfigured: Boolean(process.env.REDIS_URL)
    },
    runtimes: [],
    artifactsDir: ARTIFACT_ROOT,
    socketClient: createSocketIoClient ? 'socket.io-client' : 'raw-ws'
  };

  try {
    await waitFor(`${runtimeName} target liveness`, async () => {
      const result = await fetchJson(`${EXISTING_RUNTIME_URL}/health/liveness`);
      return result.statusCode === 200 && result.body?.status === 'alive';
    });

    const readiness = await waitFor(`${runtimeName} target readiness`, async () => {
      const result = await fetchJson(`${EXISTING_RUNTIME_URL}/health/quick`);
      const adapter = result.body?.checks?.socketRedisAdapter;
      if (result.statusCode === 200 && result.body?.status === 'healthy' && adapter?.state === 'ready') {
        return result.body;
      }
      return null;
    });

    const runtimeInfo = {
      runtime: runtimeName,
      socketUrl: EXISTING_RUNTIME_URL,
      readiness
    };
    const flow = await runFlowForRuntime({
      runtimeInfo,
      redisOptions: buildRedisOptionsFromEnv(),
      flushBeforeRun: false,
      cleanupAfterRun: CLEANUP_REDIS_KEYS
    });

    report.runtimes.push({
      ...runtimeInfo,
      flow
    });
    report.completedAt = nowIso();
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-full-ride-flow-existing-${safeRuntimeName}-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, reportPath, summary: report }, null, 2));
  } catch (error) {
    report.completedAt = nowIso();
    report.error = error.message;
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-full-ride-flow-existing-${safeRuntimeName}-failed-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify({ ok: false, reportPath, error: error.message, summary: report }, null, 2));
    process.exitCode = 1;
  }
}

async function main() {
  ensureDir(ARTIFACT_ROOT);
  if (USE_EXISTING_RUNTIME) {
    await mainExistingRuntime();
    return;
  }

  const redisPort = await findFreePort();
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

    for (const runtime of ['modular']) {
      const port = await findFreePort();
      const runtimeInfo = await startRuntime({ runtime, port, redisPort, redisUrl });
      try {
        const flow = await runFlowForRuntime({
          runtimeInfo,
          redisOptions: {
            host: '127.0.0.1',
            port: redisPort,
            password: REDIS_PASSWORD,
            maxRetriesPerRequest: 1
          },
          flushBeforeRun: true,
          cleanupAfterRun: CLEANUP_REDIS_KEYS
        });
        report.runtimes.push({
          ...runtimeInfo,
          flow
        });
      } finally {
        const runtimeProc = children.find((item) => item.name === `runtime-${runtime}`);
        await stopChild(runtimeProc);
      }
    }

    report.completedAt = nowIso();
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-full-ride-flow-smoke-${Date.now()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, reportPath, summary: report }, null, 2));
  } catch (error) {
    report.completedAt = nowIso();
    report.error = error.message;
    const reportPath = path.join(ARTIFACT_ROOT, `runtime-full-ride-flow-smoke-failed-${Date.now()}.json`);
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

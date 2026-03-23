#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const io = require('socket.io-client');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

function readFirebaseApiKeyFromGoogleServices(filePath) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return String(json?.client?.[0]?.api_key?.[0]?.current_key || '').trim();
  } catch (_) {
    return '';
  }
}

function resolveFirebaseApiKey() {
  const envKey = String(
    process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || ''
  ).trim();
  if (envKey) return envKey;

  const candidates = [
    path.resolve(__dirname, '..', 'google-services.json'),
    path.resolve(__dirname, '..', 'google-services.example.json')
  ];

  for (const candidate of candidates) {
    const key = readFirebaseApiKeyFromGoogleServices(candidate);
    if (key) return key;
  }

  return '';
}

const SERVER_URL = arg('--url', process.env.BACKEND_URL || 'https://api.147.182.204.181.sslip.io');
const OUT_FILE = arg('--out', '');
const FIREBASE_API_KEY = resolveFirebaseApiKey();
const QA_BASE_LAT = Number.parseFloat(arg('--base-lat', process.env.QA_BASE_LAT || '-23.55052'));
const QA_BASE_LNG = Number.parseFloat(arg('--base-lng', process.env.QA_BASE_LNG || '-46.633308'));
const QA_DEST_LAT = Number.parseFloat(arg('--dest-lat', process.env.QA_DEST_LAT || '-23.561414'));
const QA_DEST_LNG = Number.parseFloat(arg('--dest-lng', process.env.QA_DEST_LNG || '-46.655881'));
const QA_COORD_RADIUS = Number.parseFloat(arg('--radius', process.env.QA_COORD_RADIUS || '0.006'));
const QA_SKIP_REMOTE_DRIVER_CLEANUP = String(process.env.QA_SKIP_REMOTE_DRIVER_CLEANUP || 'false').toLowerCase() === 'true';
const QA_REMOTE_SSH_HOST = process.env.E2E_REMOTE_SSH_HOST || process.env.QA_REMOTE_SSH_HOST || '147.182.204.181';
const QA_REMOTE_SSH_USER = process.env.E2E_REMOTE_SSH_USER || process.env.QA_REMOTE_SSH_USER || 'root';
const QA_REMOTE_SSH_KEY_PATH = process.env.E2E_REMOTE_SSH_KEY_PATH || process.env.QA_REMOTE_SSH_KEY_PATH || path.resolve(__dirname, '..', '..', 'digitaloceankey');
const QA_REMOTE_REDIS_CONTAINER = process.env.E2E_REMOTE_REDIS_CONTAINER || process.env.QA_REMOTE_REDIS_CONTAINER || 'leaf-redis';
const QA_REMOTE_REDIS_PASSWORD = process.env.E2E_REMOTE_REDIS_PASSWORD || process.env.QA_REMOTE_REDIS_PASSWORD || 'leaf_redis_2024';

const PASSENGER_EMAIL = process.env.QA_PASSENGER_EMAIL || 'joao.teste@leaf.com';
const PASSENGER_PASSWORD = process.env.QA_PASSENGER_PASSWORD || 'teste123';
const DRIVER_EMAILS = String(
  process.env.QA_DRIVER_EMAILS
  || process.env.QA_DRIVER_EMAIL
  || 'maria.teste@leaf.com,ana.teste@leaf.com,carla.teste@leaf.com'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const DRIVER_PASSWORD = process.env.QA_DRIVER_PASSWORD || 'teste123';

const stages = [];
const t0 = Date.now();

const stage = (name, ok, extra = {}) => {
  stages.push({ name, ok, at: new Date().toISOString(), ...extra });
};

async function signInWithPassword(email, password) {
  if (!FIREBASE_API_KEY) {
    throw new Error('firebase_api_key_missing');
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const res = await axios.post(url, {
    email,
    password,
    returnSecureToken: true
  }, { timeout: 15000 });

  if (!res.data?.idToken || !res.data?.localId) {
    throw new Error(`firebase_signin_failed:${email}`);
  }

  return {
    uid: res.data.localId,
    idToken: res.data.idToken,
    email
  };
}

function connectAndAuth(user, userType) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      timeout: 15000,
      reconnection: false,
      forceNew: true,
      auth: { token: user.idToken }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`connect_timeout:${userType}`));
    }, 20000);

    const onConnect = () => {
      socket.emit('authenticate', {
        uid: user.uid,
        userType,
        token: user.idToken
      });
    };

    const onAuthed = () => {
      cleanup();
      resolve(socket);
    };

    const onAuthError = (e) => {
      cleanup();
      reject(new Error(`auth_error:${userType}:${e?.message || e?.error || 'unknown'}`));
    };

    const onConnectError = (e) => {
      cleanup();
      reject(new Error(`connect_error:${userType}:${e?.message || 'unknown'}`));
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('authenticated', onAuthed);
      socket.off('auth_error', onAuthError);
      socket.off('authentication_error', onAuthError);
      socket.off('connect_error', onConnectError);
    }

    socket.on('connect', onConnect);
    socket.on('authenticated', onAuthed);
    socket.on('auth_error', onAuthError);
    socket.on('authentication_error', onAuthError);
    socket.on('connect_error', onConnectError);
  });
}

function waitEvent(socket, okEvents, errEvents, timeoutMs, stageName) {
  return new Promise((resolve, reject) => {
    const oks = Array.isArray(okEvents) ? okEvents : [okEvents];
    const errs = Array.isArray(errEvents) ? errEvents : [errEvents];

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${stageName}_timeout`));
    }, timeoutMs);

    const onOk = (eventName) => (payload) => {
      cleanup();
      resolve({ event: eventName, payload });
    };

    const onErr = (eventName) => (payload) => {
      cleanup();
      reject(new Error(`${stageName}_${eventName}:${payload?.message || payload?.error || 'unknown'}`));
    };

    const okHandlers = oks.map((event) => [event, onOk(event)]);
    const errHandlers = errs.map((event) => [event, onErr(event)]);

    function cleanup() {
      clearTimeout(timer);
      for (const [event, handler] of okHandlers) socket.off(event, handler);
      for (const [event, handler] of errHandlers) socket.off(event, handler);
    }

    for (const [event, handler] of okHandlers) socket.once(event, handler);
    for (const [event, handler] of errHandlers) socket.once(event, handler);
  });
}

function extractBookingIdFromPayload(payload) {
  return (
    payload?.bookingId
    || payload?.data?.bookingId
    || payload?.rideId
    || payload?.booking?.bookingId
    || null
  );
}

function createRideRequestCollector(driverContexts) {
  const entries = [];
  const listeners = [];

  for (const ctx of driverContexts) {
    const onRideRequest = (payload) => {
      entries.push({
        at: Date.now(),
        driverUid: ctx.user.uid,
        driverEmail: ctx.user.email,
        bookingId: extractBookingIdFromPayload(payload),
        payload
      });
    };
    ctx.socket.on('newRideRequest', onRideRequest);
    listeners.push({ socket: ctx.socket, handler: onRideRequest });
  }

  const stop = () => {
    for (const { socket, handler } of listeners) {
      socket.off('newRideRequest', handler);
    }
  };

  const findByBookingId = (bookingId) => {
    const id = String(bookingId || '');
    return entries
      .filter((entry) => String(entry.bookingId || '') === id)
      .sort((a, b) => a.at - b.at);
  };

  return {
    stop,
    findByBookingId,
    getEntries: () => entries.slice()
  };
}

async function waitRideRequestForBooking(driverContexts, bookingId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const handlers = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('ride_request_for_booking_timeout'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      for (const { socket, handler } of handlers) {
        socket.off('newRideRequest', handler);
      }
    };

    for (const ctx of driverContexts) {
      const handler = (payload) => {
        const payloadBookingId = extractBookingIdFromPayload(payload);
        if (String(payloadBookingId || '') !== String(bookingId || '')) {
          return;
        }
        cleanup();
        resolve({
          driverUid: ctx.user.uid,
          driverEmail: ctx.user.email,
          bookingId: payloadBookingId,
          payload
        });
      };

      handlers.push({ socket: ctx.socket, handler });
      ctx.socket.on('newRideRequest', handler);
    }
  });
}

function randomPoint(baseLat, baseLng, radius = 0.003) {
  return {
    lat: baseLat + (Math.random() - 0.5) * radius,
    lng: baseLng + (Math.random() - 0.5) * radius
  };
}

function sanitizeDriverUid(uid) {
  const normalized = String(uid || '').trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new Error(`invalid_driver_uid:${uid}`);
  }
  return normalized;
}

async function cleanupRemoteDriverState(driverUid) {
  if (QA_SKIP_REMOTE_DRIVER_CLEANUP) {
    return { skipped: true, reason: 'skip_flag' };
  }

  if (!fs.existsSync(QA_REMOTE_SSH_KEY_PATH)) {
    return { skipped: true, reason: 'ssh_key_not_found' };
  }

  const safeUid = sanitizeDriverUid(driverUid);
  const safeRedisContainer = String(QA_REMOTE_REDIS_CONTAINER).trim();
  const safeRedisPassword = String(QA_REMOTE_REDIS_PASSWORD).trim();
  const escapedRedisPassword = safeRedisPassword.replace(/'/g, `'\"'\"'`);
  const target = `${QA_REMOTE_SSH_USER}@${QA_REMOTE_SSH_HOST}`;

  const script = [
    `REDISCLI_AUTH='${escapedRedisPassword}'`,
    `REDIS="docker exec ${safeRedisContainer} redis-cli"`,
    `$REDIS DEL driver_lock:${safeUid} driver_active_notification:${safeUid} active_trip_by_driver:${safeUid} active_trip_customer_by_driver:${safeUid} >/dev/null || true`,
    `$REDIS HDEL driver:${safeUid} activeTripId activeTripUpdatedAt >/dev/null || true`,
    'echo cleanup_ok'
  ].join('; ');

  const remoteCommand = `bash -lc '${script.replace(/'/g, `'\"'\"'`)}'`;
  const args = [
    '-i', QA_REMOTE_SSH_KEY_PATH,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    target,
    remoteCommand
  ];

  const { stdout, stderr } = await execFileAsync('ssh', args, { maxBuffer: 1024 * 1024 });
  const output = `${stdout || ''}${stderr || ''}`;
  return { ok: output.includes('cleanup_ok') };
}

async function retry(fn, attempts = 5, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i + 1);
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function emitWithRetry(socket, emitEvent, payload, okEvents, errEvents, stageName, attempts = 3, timeoutMs = 20000) {
  return retry(async () => {
    const wait = waitEvent(socket, okEvents, errEvents, timeoutMs, stageName);
    socket.emit(emitEvent, payload);
    return wait;
  }, attempts, 1000);
}

async function run() {
  let customerSocket;
  let driverContexts = [];
  let bookingId;
  let rideRequestCollector;

  try {
    stage('signin_start', true, { serverUrl: SERVER_URL });

    const passenger = await signInWithPassword(PASSENGER_EMAIL, PASSENGER_PASSWORD);
    const driverAuthResults = await Promise.all(
      DRIVER_EMAILS.map(async (email) => {
        try {
          const user = await signInWithPassword(email, DRIVER_PASSWORD);
          return { ok: true, email, user };
        } catch (error) {
          return { ok: false, email, error: error?.message || 'driver_signin_failed' };
        }
      })
    );
    const drivers = driverAuthResults.filter((item) => item.ok).map((item) => item.user);
    const failedDriverSignins = driverAuthResults
      .filter((item) => !item.ok)
      .map((item) => ({ email: item.email, error: item.error }));

    if (drivers.length <= 0) {
      throw new Error(`driver_signin_pool_empty:${JSON.stringify(failedDriverSignins)}`);
    }

    stage('signin_ok', true, {
      passengerUid: passenger.uid,
      driverPoolSize: drivers.length,
      failedDriverSignins
    });

    const cleanupResults = [];
    for (const driver of drivers) {
      try {
        const cleanup = await cleanupRemoteDriverState(driver.uid);
        cleanupResults.push({ driverEmail: driver.email, ok: true, ...cleanup });
      } catch (error) {
        cleanupResults.push({ driverEmail: driver.email, ok: false, error: error?.message || 'cleanup_failed' });
      }
    }
    stage('driver_state_cleanup', cleanupResults.some((entry) => entry.ok), {
      results: cleanupResults
    });

    customerSocket = await connectAndAuth(passenger, 'customer');
    const driverSocketResults = await Promise.all(
      drivers.map(async (driver) => {
        try {
          const socket = await connectAndAuth(driver, 'driver');
          return { ok: true, user: driver, socket };
        } catch (error) {
          return { ok: false, user: driver, error: error?.message || 'driver_websocket_auth_failed' };
        }
      })
    );
    driverContexts = driverSocketResults.filter((item) => item.ok).map((item) => ({
      user: item.user,
      socket: item.socket
    }));
    const failedDriverSockets = driverSocketResults
      .filter((item) => !item.ok)
      .map((item) => ({ email: item.user?.email, error: item.error }));
    if (driverContexts.length <= 0) {
      throw new Error(`driver_websocket_pool_empty:${JSON.stringify(failedDriverSockets)}`);
    }
    stage('websocket_auth_ok', true);
    stage('driver_pool_ready', true, {
      onlineDrivers: driverContexts.map((ctx) => ({ uid: ctx.user.uid, email: ctx.user.email })),
      failedDriverSockets
    });

    const pickup = randomPoint(
      Number.isFinite(QA_BASE_LAT) ? QA_BASE_LAT : -23.55052,
      Number.isFinite(QA_BASE_LNG) ? QA_BASE_LNG : -46.633308,
      Number.isFinite(QA_COORD_RADIUS) ? QA_COORD_RADIUS : 0.006
    );
    const destination = randomPoint(
      Number.isFinite(QA_DEST_LAT) ? QA_DEST_LAT : -23.561414,
      Number.isFinite(QA_DEST_LNG) ? QA_DEST_LNG : -46.655881,
      Number.isFinite(QA_COORD_RADIUS) ? QA_COORD_RADIUS : 0.006
    );
    stage('geofence_coordinates_selected', true, {
      pickup,
      destination,
      radius: Number.isFinite(QA_COORD_RADIUS) ? QA_COORD_RADIUS : 0.006
    });

    const locationPayload = {
      lat: pickup.lat,
      lng: pickup.lng,
      heading: 0,
      speed: 0,
      isInTrip: false,
      tripStatus: null
    };
    const onlineResults = [];
    for (let index = 0; index < driverContexts.length; index += 1) {
      const ctx = driverContexts[index];
      const jitter = (index + 1) * 0.00025;
      const perDriverLocation = {
        ...locationPayload,
        lat: locationPayload.lat + jitter,
        lng: locationPayload.lng - jitter
      };

      try {
        await emitWithRetry(
          ctx.socket,
          'updateLocation',
          perDriverLocation,
          ['locationUpdated'],
          ['locationError'],
          `updateLocation_${ctx.user.uid}`,
          4,
          20000
        );

        let statusResult = null;
        let statusFallback = null;
        try {
          const statusWait = waitEvent(
            ctx.socket,
            ['driverStatusUpdated'],
            ['driverStatusError'],
            20000,
            `setDriverStatus_${ctx.user.uid}`
          );
          ctx.socket.emit('setDriverStatus', { status: 'available', isOnline: true });
          statusResult = await statusWait;
        } catch (error) {
          statusFallback = error?.message || 'setDriverStatus_failed';
          await emitWithRetry(
            ctx.socket,
            'updateLocation',
            perDriverLocation,
            ['locationUpdated'],
            ['locationError'],
            `updateLocation_fallback_${ctx.user.uid}`,
            4,
            20000
          );
        }

        onlineResults.push({
          email: ctx.user.email,
          uid: ctx.user.uid,
          ok: true,
          statusEvent: statusResult?.event || null,
          statusFallback
        });
      } catch (error) {
        onlineResults.push({
          email: ctx.user.email,
          uid: ctx.user.uid,
          ok: false,
          error: error?.message || 'driver_online_signal_failed'
        });
      }
    }
    stage('driver_online_signal_sent', onlineResults.some((entry) => entry.ok), {
      onlineResults
    });

    // Pré-check 1: API de motoristas próximos
    const nearbyRes = await retry(async () => {
      const res = await axios.get(`${SERVER_URL}/api/drivers/nearby`, {
        params: {
          lat: pickup.lat,
          lng: pickup.lng,
          radius: 10,
          limit: 10
        },
        timeout: 15000
      });
      const count = Number(res?.data?.count || 0);
      if (count <= 0) {
        throw new Error(`nearby_zero_attempt`);
      }
      return res;
    }, 6, 1000).catch((error) => {
      return {
        data: {
          count: 0,
          retryError: error?.message || 'nearby_retry_failed'
        }
      };
    });

    const nearbyCount = Number(nearbyRes?.data?.count || 0);
    stage('nearby_api_checked', nearbyCount > 0, { nearbyCount });

    // Pré-check 2: Evento searchDrivers no websocket
    const driversFoundWait = waitEvent(customerSocket, ['driversFound'], ['searchDriversError', 'driverSearchError'], 20000, 'searchDrivers');
    customerSocket.emit('searchDrivers', {
      pickupLocation: pickup,
      destinationLocation: destination,
      preferences: { radiusKm: 5, limit: 10 }
    });
    const driversFound = await driversFoundWait;
    const wsFoundCount = Number(driversFound?.payload?.drivers?.length || 0);
    stage('search_drivers_ws_checked', wsFoundCount > 0, { wsFoundCount });

    // O backend pode disparar newRideRequest ainda no createBooking (antes do pagamento),
    // então armamos um coletor em todos os drivers para não perder o evento.
    rideRequestCollector = createRideRequestCollector(driverContexts);

    const bookingWait = waitEvent(customerSocket, ['bookingCreated'], ['bookingError'], 30000, 'createBooking');
    customerSocket.emit('createBooking', {
      customerId: passenger.uid,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 27.5,
      paymentMethod: 'pix'
    });

    const bookingRes = await bookingWait;
    bookingId = bookingRes?.payload?.bookingId || bookingRes?.payload?.data?.bookingId;
    if (!bookingId) throw new Error('booking_id_missing');
    stage('booking_created', true, { bookingId });

    // Evita conflito com locks transitórios criados no dispatch pré-pagamento.
    await new Promise((resolve) => setTimeout(resolve, 22000));

    const paymentWait = waitEvent(customerSocket, ['paymentConfirmed'], ['paymentError'], 30000, 'confirmPayment');
    customerSocket.emit('confirmPayment', {
      bookingId,
      paymentMethod: 'pix',
      paymentId: `qa_pay_${Date.now()}`,
      amount: 27.5,
      pickupLocation: pickup,
      __mockPayment: true
    });
    await paymentWait;
    stage('payment_confirmed', true);

    let candidateRideRequests = rideRequestCollector.findByBookingId(bookingId);
    if (candidateRideRequests.length <= 0) {
      try {
        const fallbackRequest = await waitRideRequestForBooking(driverContexts, bookingId, 30000);
        if (fallbackRequest) {
          candidateRideRequests = [
            {
              at: Date.now(),
              driverUid: fallbackRequest.driverUid,
              driverEmail: fallbackRequest.driverEmail,
              bookingId: fallbackRequest.bookingId,
              payload: fallbackRequest.payload
            }
          ];
        }
      } catch (_) {
        // sem ação: tratamos abaixo com stage de falha
      }
    }

    stage('driver_received_ride', candidateRideRequests.length > 0, {
      requestCount: candidateRideRequests.length,
      candidates: candidateRideRequests.map((entry) => ({
        driverEmail: entry.driverEmail,
        driverUid: entry.driverUid
      }))
    });
    if (candidateRideRequests.length <= 0) {
      throw new Error('driver_request_not_received_for_booking');
    }

    const byUid = new Map(driverContexts.map((ctx) => [ctx.user.uid, ctx]));
    const candidateContexts = candidateRideRequests
      .map((entry) => byUid.get(entry.driverUid))
      .filter(Boolean);
    const fallbackContexts = driverContexts.filter(
      (ctx) => !candidateContexts.some((candidate) => candidate.user.uid === ctx.user.uid)
    );
    const acceptSequence = [...candidateContexts, ...fallbackContexts];

    let acceptedContext = null;
    const acceptAttempts = [];
    for (const ctx of acceptSequence) {
      try {
        const acceptWait = waitEvent(
          ctx.socket,
          ['rideAccepted'],
          ['acceptRideError'],
          30000,
          `acceptRide_${ctx.user.uid}`
        );
        ctx.socket.emit('acceptRide', { bookingId });
        await acceptWait;
        acceptedContext = ctx;
        break;
      } catch (error) {
        acceptAttempts.push({
          driverEmail: ctx.user.email,
          driverUid: ctx.user.uid,
          error: error?.message || 'accept_ride_failed'
        });
      }
    }

    if (!acceptedContext) {
      throw new Error(`accept_ride_all_failed:${JSON.stringify(acceptAttempts)}`);
    }

    stage('ride_accepted', true, {
      driverEmail: acceptedContext.user.email,
      driverUid: acceptedContext.user.uid,
      acceptAttempts
    });

    acceptedContext.socket.emit('notificationAction', {
      action: 'arrived_at_pickup',
      bookingId
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    stage('arrived_at_pickup_signal_sent', true, {
      driverEmail: acceptedContext.user.email
    });

    const tripStartedWait = waitEvent(
      acceptedContext.socket,
      ['tripStarted'],
      ['tripStartError'],
      30000,
      `startTrip_${acceptedContext.user.uid}`
    );
    acceptedContext.socket.emit('startTrip', { bookingId, startLocation: pickup });
    await tripStartedWait;
    stage('trip_started', true, {
      driverEmail: acceptedContext.user.email
    });

    const tripCompleteWait = waitEvent(
      acceptedContext.socket,
      ['tripCompleted'],
      ['tripCompleteError'],
      35000,
      `completeTrip_${acceptedContext.user.uid}`
    );
    acceptedContext.socket.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: 3.1,
      fare: 27.5
    });
    await tripCompleteWait;
    stage('trip_completed', true, {
      driverEmail: acceptedContext.user.email
    });

    const output = {
      ok: true,
      bookingId,
      durationMs: Date.now() - t0,
      stages
    };

    if (OUT_FILE) fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    const output = {
      ok: false,
      bookingId: bookingId || null,
      durationMs: Date.now() - t0,
      error: error.message || String(error),
      stages
    };

    if (OUT_FILE) fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
    console.error(JSON.stringify(output, null, 2));
    return 2;
  } finally {
    try { rideRequestCollector?.stop(); } catch (_) {}
    try { customerSocket?.disconnect(); } catch (_) {}
    for (const ctx of driverContexts) {
      try { ctx?.socket?.disconnect(); } catch (_) {}
    }
  }
}

run().then((code) => process.exit(code));

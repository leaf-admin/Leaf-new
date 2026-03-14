#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const io = require('socket.io-client');

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const SERVER_URL = arg('--url', process.env.BACKEND_URL || 'http://147.182.204.181:3001');
const OUT_FILE = arg('--out', '');
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc';

const PASSENGER_EMAIL = process.env.QA_PASSENGER_EMAIL || 'joao.teste@leaf.com';
const PASSENGER_PASSWORD = process.env.QA_PASSENGER_PASSWORD || 'teste123';
const DRIVER_EMAIL = process.env.QA_DRIVER_EMAIL || 'maria.teste@leaf.com';
const DRIVER_PASSWORD = process.env.QA_DRIVER_PASSWORD || 'teste123';

const stages = [];
const t0 = Date.now();

const stage = (name, ok, extra = {}) => {
  stages.push({ name, ok, at: new Date().toISOString(), ...extra });
};

async function signInWithPassword(email, password) {
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

function randomPoint(baseLat, baseLng, radius = 0.003) {
  return {
    lat: baseLat + (Math.random() - 0.5) * radius,
    lng: baseLng + (Math.random() - 0.5) * radius
  };
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
  let driverSocket;
  let bookingId;

  try {
    stage('signin_start', true, { serverUrl: SERVER_URL });

    const [passenger, driver] = await Promise.all([
      signInWithPassword(PASSENGER_EMAIL, PASSENGER_PASSWORD),
      signInWithPassword(DRIVER_EMAIL, DRIVER_PASSWORD)
    ]);
    stage('signin_ok', true, { passengerUid: passenger.uid, driverUid: driver.uid });

    [customerSocket, driverSocket] = await Promise.all([
      connectAndAuth(passenger, 'customer'),
      connectAndAuth(driver, 'driver')
    ]);
    stage('websocket_auth_ok', true);

    const pickup = randomPoint(-22.9068, -43.1729);
    const destination = randomPoint(-22.9168, -43.1629);

    const locationPayload = {
      lat: pickup.lat,
      lng: pickup.lng,
      heading: 0,
      speed: 0,
      isInTrip: false,
      tripStatus: null
    };
    await emitWithRetry(
      driverSocket,
      'updateDriverLocation',
      locationPayload,
      ['locationUpdated'],
      ['locationError'],
      'updateDriverLocation',
      4,
      20000
    );

    let statusResult = null;
    let statusFallback = null;
    try {
      const statusWait = waitEvent(driverSocket, ['driverStatusUpdated'], ['driverStatusError'], 20000, 'setDriverStatus');
      driverSocket.emit('setDriverStatus', { status: 'available', isOnline: true });
      statusResult = await statusWait;
    } catch (error) {
      statusFallback = error?.message || 'setDriverStatus_failed';
      // Fallback para ambiente com KYC diário obrigatório:
      // updateDriverLocation já publica driver ONLINE/AVAILABLE no Redis GEO.
      await emitWithRetry(
        driverSocket,
        'updateDriverLocation',
        locationPayload,
        ['locationUpdated'],
        ['locationError'],
        'updateDriverLocation_fallback',
        4,
        20000
      );
    }
    stage('driver_online_signal_sent', true, {
      statusEvent: statusResult?.event || null,
      statusFallback
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

    // O backend pode disparar newRideRequest ainda no createBooking (antes do pagamento).
    // Por isso armamos o listener cedo para não perder evento por timing.
    const rideReqWait = waitEvent(driverSocket, ['newRideRequest'], ['bookingError'], 90000, 'newRideRequest');

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
      pickupLocation: pickup
    });
    await paymentWait;
    stage('payment_confirmed', true);

    try {
      const req = await Promise.race([
        rideReqWait,
        new Promise((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      if (req) {
        stage('driver_received_ride', true, { event: req.event });
      } else {
        stage('driver_received_ride', false, { reason: 'not_received_before_accept' });
      }
    } catch (error) {
      stage('driver_received_ride', false, { reason: error?.message || 'ride_request_wait_failed' });
    }

    const acceptWait = waitEvent(driverSocket, ['rideAccepted'], ['acceptRideError'], 30000, 'acceptRide');
    driverSocket.emit('acceptRide', { bookingId });
    await acceptWait;
    stage('ride_accepted', true);

    const tripStartedWait = waitEvent(driverSocket, ['tripStarted'], ['tripStartError'], 30000, 'startTrip');
    driverSocket.emit('startTrip', { bookingId, startLocation: pickup });
    await tripStartedWait;
    stage('trip_started', true);

    const tripCompleteWait = waitEvent(driverSocket, ['tripCompleted'], ['tripCompleteError'], 35000, 'completeTrip');
    driverSocket.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: 3.1,
      fare: 27.5
    });
    await tripCompleteWait;
    stage('trip_completed', true);

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
    try { customerSocket?.disconnect(); } catch (_) {}
    try { driverSocket?.disconnect(); } catch (_) {}
  }
}

run().then((code) => process.exit(code));

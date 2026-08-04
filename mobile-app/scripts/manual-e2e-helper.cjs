#!/usr/bin/env node

/**
 * Manual E2E helper for single-device validation.
 *
 * Modes:
 *  - driver-device: device is driver; script simulates passenger + Woovi payment flow.
 *  - passenger-device: device is passenger; script simulates driver bot.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const io = require('socket.io-client');

const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : fallback;
};

const MODE = arg('--mode', process.env.MANUAL_E2E_MODE || 'driver-device');
const SERVER_URL = arg('--url', process.env.BACKEND_URL || 'http://127.0.0.1:3001');
const PAYMENT_TIMEOUT_MS = Number.parseInt(
  arg('--payment-timeout-ms', process.env.PAYMENT_TIMEOUT_MS || '900000'),
  10
);
const WAIT_TIMEOUT_MS = Number.parseInt(
  arg('--wait-timeout-ms', process.env.WAIT_TIMEOUT_MS || '900000'),
  10
);
const DRIVER_DEVICE_AUTO_ASSIST =
  String(arg('--driver-auto-assist', process.env.DRIVER_DEVICE_AUTO_ASSIST || 'true')).toLowerCase() !==
  'false';
const PASSENGER_MAX_STALE_MINUTES = Number.parseInt(
  arg('--passenger-max-stale-minutes', process.env.PASSENGER_MAX_STALE_MINUTES || '20'),
  10
);
const PASSENGER_WAIT_PAYMENT_MS = Number.parseInt(
  arg('--passenger-wait-payment-ms', process.env.PASSENGER_WAIT_PAYMENT_MS || '120000'),
  10
);
const PASSENGER_ACCEPT_UNCONFIRMED =
  String(arg('--passenger-accept-unconfirmed', process.env.PASSENGER_ACCEPT_UNCONFIRMED || 'true')).toLowerCase() !==
  'false';

const BASE_LAT = Number.parseFloat(arg('--base-lat', process.env.QA_BASE_LAT || '-23.55052'));
const BASE_LNG = Number.parseFloat(arg('--base-lng', process.env.QA_BASE_LNG || '-46.633308'));
const DEST_LAT = Number.parseFloat(arg('--dest-lat', process.env.QA_DEST_LAT || '-23.561414'));
const DEST_LNG = Number.parseFloat(arg('--dest-lng', process.env.QA_DEST_LNG || '-46.655881'));
const RADIUS = Number.parseFloat(arg('--radius', process.env.QA_COORD_RADIUS || '0.002'));
const ESTIMATED_FARE = Number.parseFloat(arg('--fare', process.env.QA_ESTIMATED_FARE || '27.5'));

const PASSENGER_EMAIL = process.env.QA_PASSENGER_EMAIL || 'joao.teste@leaf.com';
const PASSENGER_PASSWORD = process.env.QA_PASSENGER_PASSWORD || 'teste123';
const DRIVER_EMAIL = process.env.QA_DRIVER_EMAIL || 'maria.teste@leaf.com';
const DRIVER_PASSWORD = process.env.QA_DRIVER_PASSWORD || 'teste123';

const stages = [];
const startedAt = Date.now();

const stage = (name, ok, extra = {}) => {
  const payload = { name, ok, at: new Date().toISOString(), ...extra };
  stages.push(payload);
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} [${name}]`, JSON.stringify(extra));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomPoint(lat, lng, radius = 0.0015) {
  return {
    lat: lat + (Math.random() - 0.5) * radius,
    lng: lng + (Math.random() - 0.5) * radius
  };
}

function interpolatePoints(start, end, steps = 10) {
  const out = [];
  for (let i = 1; i <= steps; i += 1) {
    const factor = i / steps;
    out.push({
      lat: start.lat + (end.lat - start.lat) * factor,
      lng: start.lng + (end.lng - start.lng) * factor
    });
  }
  return out;
}

function extractLastPathToken(value) {
  if (!value || typeof value !== 'string') return null;
  const sanitized = value.split('?')[0].split('#')[0];
  const pieces = sanitized.split('/').filter(Boolean);
  if (!pieces.length) return null;
  const token = pieces[pieces.length - 1];
  return token.replace(/\.png$/i, '') || null;
}

function resolveChargeId(payload) {
  const candidates = [
    payload?.chargeId,
    payload?.paymentId,
    payload?.charge?.id,
    payload?.charge?.identifier,
    payload?.charge?.transactionID,
    payload?.charge?.correlationID,
    payload?.data?.chargeId,
    payload?.data?.paymentId,
    payload?.data?.charge?.id,
    payload?.data?.charge?.identifier,
    payload?.data?.charge?.transactionID,
    payload?.data?.charge?.correlationID
  ];

  const direct = candidates.find((item) => typeof item === 'string' && item.trim().length > 0);
  if (direct) return direct.trim();

  const linkCandidate =
    payload?.paymentLink ||
    payload?.paymentLinkUrl ||
    payload?.charge?.paymentLinkUrl ||
    payload?.data?.paymentLink ||
    payload?.data?.paymentLinkUrl ||
    payload?.data?.charge?.paymentLinkUrl ||
    null;
  const idFromLink = extractLastPathToken(linkCandidate);
  if (idFromLink) return idFromLink;

  const qrCandidate =
    payload?.qrCode ||
    payload?.qrCodeImage ||
    payload?.charge?.qrCodeImage ||
    payload?.data?.qrCode ||
    payload?.data?.qrCodeImage ||
    payload?.data?.charge?.qrCodeImage ||
    null;
  const idFromQr = extractLastPathToken(qrCandidate);
  if (idFromQr) return idFromQr;

  return null;
}

function getFirebaseApiKey() {
  if (process.env.FIREBASE_API_KEY) return process.env.FIREBASE_API_KEY;
  if (process.env.EXPO_PUBLIC_FIREBASE_API_KEY) return process.env.EXPO_PUBLIC_FIREBASE_API_KEY;

  const candidateFiles = [
    path.join(__dirname, '..', 'google-services.json'),
    path.join(__dirname, '..', 'google-services.example.json')
  ];

  for (const file of candidateFiles) {
    if (!fs.existsSync(file)) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const json = JSON.parse(raw);
      const key =
        json?.client?.[0]?.api_key?.[0]?.current_key ||
        json?.client?.find?.((c) => c?.api_key?.[0]?.current_key)?.api_key?.[0]?.current_key;
      if (key) return key;
    } catch (_) {
      // ignore and continue
    }
  }

  throw new Error('firebase_api_key_missing');
}

async function signInWithPassword(email, password) {
  const apiKey = getFirebaseApiKey();
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await axios.post(
    url,
    {
      email,
      password,
      returnSecureToken: true
    },
    { timeout: 20000 }
  );

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
      timeout: 20000,
      reconnection: false,
      forceNew: true,
      auth: { token: user.idToken }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`connect_timeout:${userType}`));
    }, 25000);

    const onConnect = () => {
      socket.emit('authenticate', {
        uid: user.uid,
        userType,
        token: user.idToken
      });
    };

    const onAuthed = (payload) => {
      cleanup();
      resolve({ socket, authPayload: payload || {} });
    };

    const onError = (error) => {
      cleanup();
      reject(new Error(error?.message || error?.error || `auth_failed:${userType}`));
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('authenticated', onAuthed);
      socket.off('auth_error', onError);
      socket.off('authentication_error', onError);
      socket.off('connect_error', onError);
    }

    socket.on('connect', onConnect);
    socket.on('authenticated', onAuthed);
    socket.on('auth_error', onError);
    socket.on('authentication_error', onError);
    socket.on('connect_error', onError);
  });
}

function waitEvent(socket, okEvents, errEvents = [], timeoutMs = 60000, label = 'event') {
  const okList = Array.isArray(okEvents) ? okEvents : [okEvents];
  const errList = Array.isArray(errEvents) ? errEvents : [errEvents];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`${label}_timeout`));
    }, timeoutMs);

    const okHandlers = okList.map((evt) => [
      evt,
      (payload) => {
        cleanup();
        resolve({ event: evt, payload });
      }
    ]);

    const errHandlers = errList
      .filter(Boolean)
      .map((evt) => [
        evt,
        (payload) => {
          cleanup();
          reject(new Error(`${label}_${evt}:${payload?.message || payload?.error || 'unknown'}`));
        }
      ]);

    function cleanup() {
      clearTimeout(timeout);
      for (const [evt, handler] of okHandlers) socket.off(evt, handler);
      for (const [evt, handler] of errHandlers) socket.off(evt, handler);
    }

    for (const [evt, handler] of okHandlers) socket.once(evt, handler);
    for (const [evt, handler] of errHandlers) socket.once(evt, handler);
  });
}

async function pollPaymentStatus(chargeId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await axios.get(`${SERVER_URL}/api/payment/status/${encodeURIComponent(chargeId)}`, {
      timeout: 15000
    });
    const body = response.data || {};
    const status = String(body.status || '').toUpperCase();
    if (body.success && (status === 'COMPLETED' || status === 'IN_HOLDING')) {
      return body;
    }
    await sleep(3000);
  }

  throw new Error('payment_status_timeout');
}

function extractBookingTimestampMs(bookingId) {
  const match = String(bookingId || '').match(/^booking_(\d{10,13})_/);
  if (!match) return null;
  const raw = Number.parseInt(match[1], 10);
  if (!Number.isFinite(raw)) return null;
  // Alguns IDs podem ter timestamp em segundos.
  return raw < 1e12 ? raw * 1000 : raw;
}

function isPaymentReadyStatus(status) {
  const normalized = String(status || '').toUpperCase();
  return (
    normalized === 'IN_HOLDING' ||
    normalized === 'PAID' ||
    normalized === 'COMPLETED' ||
    normalized === 'DISTRIBUTED' ||
    normalized === 'CREDITED'
  );
}

async function waitPaymentReadyForRide(bookingId, timeoutMs) {
  const started = Date.now();
  let lastStatus = null;

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await axios.get(
        `${SERVER_URL}/api/payment/status/${encodeURIComponent(bookingId)}`,
        { timeout: 15000 }
      );
      const body = response.data || {};
      const status = String(body.status || '').toUpperCase();
      lastStatus = status || null;
      if (body.success && isPaymentReadyStatus(status)) {
        return { ready: true, status };
      }
    } catch (_) {
      // Ignora erro temporário e segue polling.
    }
    await sleep(2500);
  }

  return { ready: false, status: lastStatus };
}

async function waitForEligibleRideRequest(driverSocket) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1000, deadline - Date.now());
    const rideReq = await waitEvent(
      driverSocket,
      ['newRideRequest'],
      ['bookingError'],
      remainingMs,
      'newRideRequest'
    );

    const bookingId = rideReq?.payload?.bookingId;
    if (!bookingId) {
      stage('ride_request_ignored_missing_id', true);
      continue;
    }

    const createdAtMs = extractBookingTimestampMs(bookingId);
    if (createdAtMs) {
      const ageMs = Date.now() - createdAtMs;
      const maxAgeMs = PASSENGER_MAX_STALE_MINUTES * 60 * 1000;
      if (ageMs > maxAgeMs) {
        stage('ride_request_ignored_stale', true, {
          bookingId,
          ageMinutes: Number((ageMs / 60000).toFixed(1))
        });
        continue;
      }
    }

    const paymentReady = await waitPaymentReadyForRide(bookingId, PASSENGER_WAIT_PAYMENT_MS);
    if (!paymentReady.ready) {
      if (PASSENGER_ACCEPT_UNCONFIRMED) {
        stage('ride_request_payment_status_pending', true, {
          bookingId,
          lastStatus: paymentReady.status || null,
          strategy: 'accept_unconfirmed'
        });
        return rideReq;
      }

      stage('ride_request_ignored_unpaid', true, {
        bookingId,
        lastStatus: paymentReady.status || null
      });
      continue;
    }

    stage('ride_request_payment_ready', true, {
      bookingId,
      status: paymentReady.status
    });
    return rideReq;
  }

  throw new Error('eligible_ride_request_timeout');
}

async function emitConfirmPaymentAndWait(
  passengerSocket,
  { bookingId, chargeId, amount, mockPayment = false }
) {
  const paymentWait = waitEvent(
    passengerSocket,
    ['paymentConfirmed'],
    ['paymentError'],
    30000,
    'confirmPayment'
  );

  passengerSocket.emit('confirmPayment', {
    bookingId,
    paymentMethod: 'pix',
    paymentId: chargeId,
    amount,
    ...(mockPayment ? { mockPayment: true, __mockPayment: true } : {})
  });

  return paymentWait;
}

async function setupDriverAssist(pickup) {
  const driver = await signInWithPassword(DRIVER_EMAIL, DRIVER_PASSWORD);
  const driverConn = await connectAndAuth(driver, 'driver');
  const driverSocket = driverConn.socket;

  const driverStart = randomPoint(pickup.lat, pickup.lng, Math.min(RADIUS, 0.0015));
  const locationWait = waitEvent(
    driverSocket,
    ['locationUpdated'],
    ['locationError'],
    20000,
    'assistUpdateLocation'
  );

  driverSocket.emit('updateLocation', {
    lat: driverStart.lat,
    lng: driverStart.lng,
    heading: 0,
    speed: 0,
    isInTrip: false,
    tripStatus: null
  });
  await locationWait;

  try {
    const statusWait = waitEvent(
      driverSocket,
      ['driverStatusUpdated'],
      ['driverStatusError'],
      10000,
      'assistSetDriverStatus'
    );
    driverSocket.emit('setDriverStatus', { status: 'available', isOnline: true });
    await statusWait;
  } catch (_) {
    // Alguns ambientes não retornam ack de status; localização publicada já atende o teste.
  }

  return { driver, driverSocket, driverStart };
}

async function runDriverAssistTrip(driverSocket, bookingId, pickup, destination) {
  const acceptWait = waitEvent(
    driverSocket,
    ['rideAccepted'],
    ['acceptRideError'],
    30000,
    'assistAcceptRide'
  );
  driverSocket.emit('acceptRide', { bookingId });
  await acceptWait;
  stage('driver_assist_ride_accepted', true, { bookingId });

  await sleep(1500);

  const startWait = waitEvent(
    driverSocket,
    ['tripStarted'],
    ['tripStartError'],
    30000,
    'assistStartTrip'
  );
  driverSocket.emit('startTrip', { bookingId, startLocation: pickup });
  await startWait;
  stage('driver_assist_trip_started', true, { bookingId });

  const steps = interpolatePoints(pickup, destination, 10);
  for (const [index, point] of steps.entries()) {
    driverSocket.emit('updateLocation', {
      bookingId,
      tripId: bookingId,
      lat: point.lat,
      lng: point.lng,
      heading: 45,
      speed: 14,
      tripStatus: 'started',
      isInTrip: true,
      capturedAt: Date.now()
    });
    stage('driver_assist_location_update', true, {
      bookingId,
      step: index + 1,
      total: steps.length
    });
    await sleep(1400);
  }

  const completeWait = waitEvent(
    driverSocket,
    ['tripCompleted'],
    ['tripCompleteError'],
    30000,
    'assistCompleteTrip'
  );
  driverSocket.emit('completeTrip', {
    bookingId,
    endLocation: destination,
    distance: 3.8,
    fare: ESTIMATED_FARE
  });
  await completeWait;
  stage('driver_assist_trip_completed', true, { bookingId });
}

async function runDriverDeviceFlow() {
  let passengerSocket = null;
  let driverAssistSocket = null;
  try {
    stage('mode_selected', true, { mode: MODE, server: SERVER_URL });
    console.log('📱 Modo driver-device: deixe o APP no celular logado como MOTORISTA.');

    const passenger = await signInWithPassword(PASSENGER_EMAIL, PASSENGER_PASSWORD);
    stage('signin_passenger_ok', true, { uid: passenger.uid });

    const passengerConn = await connectAndAuth(passenger, 'customer');
    passengerSocket = passengerConn.socket;
    stage('ws_passenger_auth_ok', true);

    const pickup = randomPoint(BASE_LAT, BASE_LNG, RADIUS);
    const destination = randomPoint(DEST_LAT, DEST_LNG, RADIUS);

    const bookingWait = waitEvent(
      passengerSocket,
      ['bookingCreated'],
      ['bookingError'],
      60000,
      'createBooking'
    );

    passengerSocket.emit('createBooking', {
      customerId: passenger.uid,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: ESTIMATED_FARE,
      paymentMethod: 'pix'
    });

    const bookingResult = await bookingWait;
    const bookingId = bookingResult?.payload?.bookingId || bookingResult?.payload?.data?.bookingId;
    if (!bookingId) throw new Error('booking_id_missing');
    stage('booking_created', true, { bookingId, pickup, destination });

    const amountInCents = Math.round(ESTIMATED_FARE * 100);
    const paymentResult = await axios.post(
      `${SERVER_URL}/api/payment/advance`,
      {
        passengerId: passenger.uid,
        amount: amountInCents,
        rideId: bookingId,
        rideDetails: {
          origin: `Lat ${pickup.lat.toFixed(6)}, Lng ${pickup.lng.toFixed(6)}`,
          destination: `Lat ${destination.lat.toFixed(6)}, Lng ${destination.lng.toFixed(6)}`
        },
        passengerName: 'Passageiro Teste',
        passengerEmail: PASSENGER_EMAIL
      },
      { timeout: 30000 }
    );

    const paymentPayload = paymentResult?.data || {};
    const chargeId = resolveChargeId(paymentPayload);
    const paymentLink =
      paymentPayload.paymentLink ||
      paymentPayload.paymentLinkUrl ||
      paymentPayload?.charge?.paymentLinkUrl ||
      paymentPayload?.data?.paymentLink ||
      paymentPayload?.data?.paymentLinkUrl ||
      paymentPayload?.data?.charge?.paymentLinkUrl ||
      null;
    if (!chargeId) throw new Error('woovi_charge_missing');
    stage('woovi_charge_created', true, { bookingId, chargeId, paymentLink });

    console.log('\n🔔 Ação necessária:');
    console.log(`1) Aprovar o pagamento da charge ${chargeId} no dashboard da Woovi (sandbox).`);
    if (paymentLink) {
      console.log(`2) Link de pagamento (opcional): ${paymentLink}`);
    }
    console.log('3) Após confirmar na Woovi, este script continua automaticamente.\n');

    await pollPaymentStatus(chargeId, PAYMENT_TIMEOUT_MS);
    stage('woovi_payment_completed', true, { chargeId });

    try {
      await emitConfirmPaymentAndWait(passengerSocket, {
        bookingId,
        chargeId,
        amount: ESTIMATED_FARE
      });
    } catch (error) {
      const shouldAssist =
        DRIVER_DEVICE_AUTO_ASSIST &&
        /NO_DRIVERS_AVAILABLE|Pagamento bloqueado para evitar cobrança sem parceiro disponível/i.test(
          error.message || ''
        );

      if (!shouldAssist) throw error;

      stage('driver_assist_activating', true, { bookingId, reason: error.message });
      const assist = await setupDriverAssist(pickup);
      driverAssistSocket = assist.driverSocket;
      stage('driver_assist_ready', true, {
        bookingId,
        driverUid: assist.driver.uid,
        driverStart: assist.driverStart
      });

      // Retry em modo assistido para evitar novo bloqueio por disponibilidade.
      await emitConfirmPaymentAndWait(passengerSocket, {
        bookingId,
        chargeId,
        amount: ESTIMATED_FARE,
        mockPayment: true
      });
      stage('payment_confirmed_retry', true, { bookingId, strategy: 'driver_assist' });
    }

    stage('payment_confirmed_ws', true, { bookingId, chargeId });

    console.log('\n🚗 Ação necessária no APP (motorista): aceite, inicie e finalize a corrida.');
    console.log('Este script vai aguardar o evento de corrida finalizada do lado passageiro.\n');

    const tripCompletedPromise = waitEvent(
      passengerSocket,
      ['tripCompleted'],
      ['tripCompleteError'],
      WAIT_TIMEOUT_MS,
      'tripCompleted'
    );

    if (driverAssistSocket) {
      console.log('🤖 Driver assist ativo: simulando corrida automaticamente para concluir o E2E.');
      await runDriverAssistTrip(driverAssistSocket, bookingId, pickup, destination);
    }

    const tripCompleted = await tripCompletedPromise;
    stage('trip_completed', true, { bookingId, payload: tripCompleted.payload || null });

    const ratingWait = waitEvent(
      passengerSocket,
      ['ratingSubmitted'],
      ['ratingError', 'ratingSubmissionFailed'],
      30000,
      'submitRating'
    );

    passengerSocket.emit('submitRating', {
      tripId: bookingId,
      userId: passenger.uid,
      userType: 'passenger',
      rating: 5,
      selectedOptions: ['motorista_educado', 'direcao_segura'],
      comment: 'Teste manual driver-device'
    });

    await ratingWait;
    stage('rating_submitted', true, { bookingId });

    return {
      ok: true,
      mode: MODE,
      bookingId
    };
  } finally {
    try {
      driverAssistSocket?.disconnect();
    } catch (_) {}
    try {
      passengerSocket?.disconnect();
    } catch (_) {}
  }
}

async function runPassengerDeviceFlow() {
  let driverSocket = null;
  try {
    stage('mode_selected', true, { mode: MODE, server: SERVER_URL });
    console.log('📱 Modo passenger-device: deixe o APP no celular logado como PASSAGEIRO.');
    console.log('Solicite a corrida e conclua o pagamento Woovi no app; este bot fará o lado do motorista.\n');

    const driver = await signInWithPassword(DRIVER_EMAIL, DRIVER_PASSWORD);
    stage('signin_driver_ok', true, { uid: driver.uid });

    const driverConn = await connectAndAuth(driver, 'driver');
    driverSocket = driverConn.socket;
    stage('ws_driver_auth_ok', true);

    // Publica motorista online próximo à área base.
    const driverStart = randomPoint(BASE_LAT, BASE_LNG, RADIUS);
    const locationWait = waitEvent(
      driverSocket,
      ['locationUpdated'],
      ['locationError'],
      20000,
      'updateLocation'
    );
    driverSocket.emit('updateLocation', {
      lat: driverStart.lat,
      lng: driverStart.lng,
      heading: 0,
      speed: 0,
      isInTrip: false,
      tripStatus: null
    });
    await locationWait;
    stage('driver_location_published', true, { driverStart });

    try {
      const statusWait = waitEvent(
        driverSocket,
        ['driverStatusUpdated'],
        ['driverStatusError'],
        10000,
        'setDriverStatus'
      );
      driverSocket.emit('setDriverStatus', { status: 'available', isOnline: true });
      await statusWait;
      stage('driver_online', true);
    } catch (error) {
      stage('driver_online_fallback', true, { reason: error.message });
    }

    const rideReq = await waitForEligibleRideRequest(driverSocket);

    const bookingId = rideReq?.payload?.bookingId;
    if (!bookingId) throw new Error('ride_request_without_booking_id');
    const pickup = rideReq?.payload?.pickupLocation || driverStart;
    const destination = rideReq?.payload?.destinationLocation || randomPoint(DEST_LAT, DEST_LNG, RADIUS);

    stage('new_ride_request_received', true, { bookingId });

    const acceptWait = waitEvent(driverSocket, ['rideAccepted'], ['acceptRideError'], 30000, 'acceptRide');
    driverSocket.emit('acceptRide', { bookingId });
    await acceptWait;
    stage('ride_accepted', true, { bookingId });

    await sleep(2000);

    const startWait = waitEvent(driverSocket, ['tripStarted'], ['tripStartError'], 30000, 'startTrip');
    driverSocket.emit('startTrip', { bookingId, startLocation: pickup });
    await startWait;
    stage('trip_started', true, { bookingId });

    const steps = interpolatePoints(pickup, destination, 12);
    for (const [index, point] of steps.entries()) {
      driverSocket.emit('updateLocation', {
        bookingId,
        tripId: bookingId,
        lat: point.lat,
        lng: point.lng,
        heading: 45,
        speed: 12,
        tripStatus: 'started',
        isInTrip: true,
        capturedAt: Date.now()
      });
      stage('trip_location_update', true, { bookingId, step: index + 1, total: steps.length });
      await sleep(1800);
    }

    const completeWait = waitEvent(
      driverSocket,
      ['tripCompleted'],
      ['tripCompleteError'],
      30000,
      'completeTrip'
    );
    driverSocket.emit('completeTrip', {
      bookingId,
      endLocation: destination,
      distance: 3.8,
      fare: ESTIMATED_FARE
    });
    await completeWait;
    stage('trip_completed', true, { bookingId });

    console.log('\n✅ Corrida finalizada pelo bot motorista.');
    console.log('No app passageiro, valide o carregamento do modal de avaliação/rating.\n');

    return {
      ok: true,
      mode: MODE,
      bookingId
    };
  } finally {
    try {
      driverSocket?.disconnect();
    } catch (_) {}
  }
}

async function main() {
  try {
    let result;
    if (MODE === 'driver-device') {
      result = await runDriverDeviceFlow();
    } else if (MODE === 'passenger-device') {
      result = await runPassengerDeviceFlow();
    } else {
      throw new Error(`invalid_mode:${MODE}`);
    }

    const report = {
      ...result,
      durationMs: Date.now() - startedAt,
      stages
    };
    console.log('\n=== MANUAL E2E RESULT ===');
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (error) {
    const report = {
      ok: false,
      mode: MODE,
      durationMs: Date.now() - startedAt,
      error: error.message || String(error),
      stages
    };
    console.error('\n=== MANUAL E2E FAILED ===');
    console.error(JSON.stringify(report, null, 2));
    process.exit(2);
  }
}

main();

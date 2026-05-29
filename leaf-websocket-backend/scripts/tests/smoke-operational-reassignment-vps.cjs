#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const REMOTE_SSH_HOST = process.env.REMOTE_SSH_HOST || 'root.leaf.app.br';
const DEFAULT_REMOTE_SSH_KEY_CANDIDATES = [
  process.env.REMOTE_SSH_KEY,
  process.env.CONTABO_SSH_KEY_PATH,
  path.join(process.env.HOME || '', '.ssh/leaf_contabo_20260412_ed25519'),
  path.join(process.env.HOME || '', '.ssh/serafy_contabo_ed25519'),
  path.join(__dirname, '..', '..', '..', 'contabokey')
].filter(Boolean);
const REMOTE_SSH_KEY =
  process.env.REMOTE_SSH_KEY
  || DEFAULT_REMOTE_SSH_KEY_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_error) {
      return false;
    }
  })
  || path.join(process.env.HOME || '', '.ssh/leaf_contabo_20260412_ed25519');
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER1_UID = process.env.TEST_DRIVER_UID || '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const DRIVER2_UID = process.env.TEST_DRIVER2_UID || '';
const DRIVER2_PHONE = process.env.TEST_DRIVER2_PHONE || '11888888889';
const ORIGINAL_ESTIMATED_FARE = Number(process.env.TEST_ESTIMATED_FARE || 27.5);

const PICKUP = {
  lat: Number(process.env.TEST_PICKUP_LAT || -22.9075),
  lng: Number(process.env.TEST_PICKUP_LNG || -43.1736),
  address: process.env.TEST_PICKUP_ADDRESS || 'Centro - Rio de Janeiro'
};

const DESTINATION = {
  lat: Number(process.env.TEST_DEST_LAT || -22.9121),
  lng: Number(process.env.TEST_DEST_LNG || -43.1825),
  address: process.env.TEST_DEST_ADDRESS || 'Lapa - Rio de Janeiro'
};

const INTERRUPTION_POINT = {
  lat: Number(process.env.TEST_INTERRUPTION_LAT || -22.9092),
  lng: Number(process.env.TEST_INTERRUPTION_LNG || -43.1771),
  address: process.env.TEST_INTERRUPTION_ADDRESS || 'Ponto de interrupção - Glória'
};

const CONTRACT_ROUTE_DISTANCE_KM = Number(process.env.TEST_CONTRACT_ROUTE_DISTANCE_KM || 12.5);
const CONTRACT_ROUTE_DURATION_SECS = Number(process.env.TEST_CONTRACT_ROUTE_DURATION_SECS || 1800);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildReportPath() {
  const reportName = `operational-reassignment-smoke-vps-${Date.now()}.json`;
  return path.join(__dirname, '..', '..', 'reports', reportName);
}

function writeReport(report, reportPath) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function resetRemoteTestRideState(passengerId, driverIds = []) {
  const normalizedPassengerId = String(passengerId || '').trim();
  const sanitizedDriverIds = [...new Set(driverIds.filter(Boolean).map((driverId) => String(driverId).trim()))];
  if (!normalizedPassengerId && sanitizedDriverIds.length === 0) {
    return;
  }

  const remoteScript = [
    "const Redis = require('ioredis');",
    'const redis = new Redis(process.env.REDIS_URL);',
    `const passengerId = ${JSON.stringify(normalizedPassengerId)};`,
    `const driverIds = ${JSON.stringify(sanitizedDriverIds)};`,
    "const finalStates = new Set(['COMPLETED', 'CANCELED', 'CANCELLED', 'ENDED']);",
    '(async () => {',
    '  const cleanupDriverIds = new Set(driverIds);',
    '  if (passengerId) {',
    "    const activeBookingKey = 'customer_active_booking:' + passengerId;",
    '    const activeBookingId = await redis.get(activeBookingKey);',
    '    if (activeBookingId) {',
    "      const bookingKey = 'booking:' + activeBookingId;",
    "      const booking = await redis.hgetall(bookingKey);",
    "      const bookingState = String(booking.state || booking.status || '').toUpperCase();",
    "      if (!finalStates.has(bookingState)) {",
    "        await redis.hset(bookingKey, { state: 'CANCELED', status: 'CANCELED', canceledBy: 'smoke_reset', reason: 'SMOKE_TEST_RESET', cancelledAt: new Date().toISOString(), endedAt: new Date().toISOString() });",
    '      }',
    "      await redis.del('ride_notifications:' + activeBookingId, 'offer_reservations:' + activeBookingId);",
    "      if (booking.driverId) cleanupDriverIds.add(String(booking.driverId));",
    "      if (booking.ownerDriverId) cleanupDriverIds.add(String(booking.ownerDriverId));",
    '    }',
    '    await redis.del(activeBookingKey);',
    '  }',
    '  for (const driverId of cleanupDriverIds) {',
    '    if (!driverId) continue;',
    "    await redis.del('driver_soft_ban:' + driverId, 'driver_lock:' + driverId, 'driver_active_notification:' + driverId, 'active_trip_by_driver:' + driverId, 'active_trip_customer_by_driver:' + driverId);",
    "    await redis.hdel('driver:' + driverId, 'activeTripId', 'activeTripUpdatedAt');",
    '  }',
    '  await redis.quit();',
    '})().catch((error) => { console.error(error); process.exit(1); });'
  ].join(' ');

  execFileSync(
    'ssh',
    [
      '-i',
      REMOTE_SSH_KEY,
      REMOTE_SSH_HOST,
      `docker exec leaf-websocket node -e ${JSON.stringify(remoteScript)}`
    ],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
}

async function postJson(url, body, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

function onceStatusAck(driverClient, payload, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      driverClient.socket.removeListener('driverStatusUpdated', successHandler);
      driverClient.socket.removeListener('driverStatusError', errorHandler);
    };

    const done = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const successHandler = (data) => done({ ok: true, data });
    const errorHandler = (error) => done({ ok: false, error });

    const timeout = setTimeout(() => {
      clearTimeout(timeout);
      done({
        ok: false,
        error: { code: 'STATUS_TIMEOUT', error: 'Timeout aguardando driverStatus ack' }
      });
    }, timeoutMs);

    driverClient.socket.once('driverStatusUpdated', (data) => {
      clearTimeout(timeout);
      successHandler(data);
    });
    driverClient.socket.once('driverStatusError', (error) => {
      clearTimeout(timeout);
      errorHandler(error);
    });

    driverClient.socket.emit('setDriverStatus', payload);
  });
}

async function ensureDriverOnline(driverClient, location, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const heading = (Date.now() / 100) % 360;
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: location.lat + (attempt * 0.00001),
      lng: location.lng + (attempt * 0.00001),
      heading,
      speed: 0
    });

    if (ack.ok) {
      return { success: true, attempts: attempt, ack: ack.data };
    }

    const code = String(ack.error?.code || '').toUpperCase();
    const retryAfter = Number(ack.error?.retryAfterSec || 1);

    if (code === 'LOCATION_REQUIRED' || code === 'ONLINE_NOT_READY') {
      driverClient.socket.emit('updateLocation', {
        lat: location.lat,
        lng: location.lng,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
      await sleep(Math.max(700, retryAfter * 1000));
      continue;
    }

    return {
      success: false,
      attempts: attempt,
      error: ack.error || { code: 'UNKNOWN', error: 'Falha ao colocar driver online' }
    };
  }

  return {
    success: false,
    attempts,
    error: {
      code: 'ONLINE_RETRY_EXHAUSTED',
      error: 'Tentativas para ficar online esgotadas'
    }
  };
}

async function ensureDriverOffline(driverClient, location = PICKUP) {
  const ack = await onceStatusAck(driverClient, {
    status: 'offline',
    isOnline: false,
    lat: location.lat,
    lng: location.lng,
    heading: 0,
    speed: 0
  });
  return ack.ok;
}

function createBookingWithTimeout(passengerClient, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('create_booking_timeout'));
    }, timeoutMs);

    const successHandler = (response) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingError', errorHandler);
      resolve(response);
    };

    const errorHandler = (error) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingCreated', successHandler);
      reject(new Error(error?.error || error?.message || 'create_booking_error'));
    };

    passengerClient.socket.once('bookingCreated', successHandler);
    passengerClient.socket.once('bookingError', errorHandler);
    passengerClient.socket.emit('createBooking', payload);
  });
}

function emitAndWait(client, {
  emitEvent,
  emitPayload,
  successEvent,
  errorEvent,
  timeoutMs = 20000,
  predicate = null
}) {
  const matches = typeof predicate === 'function' ? predicate : (() => true);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      client.socket.removeListener(successEvent, successHandler);
      if (errorEvent) {
        client.socket.removeListener(errorEvent, errorHandler);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout_${emitEvent}`));
    }, timeoutMs);

    const successHandler = (payload = {}) => {
      try {
        if (!matches(payload)) return;
      } catch (_error) {
        return;
      }

      clearTimeout(timeout);
      cleanup();
      resolve(payload);
    };

    const errorHandler = (error = {}) => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error(error.error || error.message || `error_${emitEvent}`));
    };

    client.socket.on(successEvent, successHandler);
    if (errorEvent) {
      client.socket.on(errorEvent, errorHandler);
    }

    client.socket.emit(emitEvent, emitPayload);
  });
}

async function createPaymentAdvance({ label, amountInCents = 2750 }) {
  const rideId = `ride_reassign_${Date.now()}_${label}`;
  const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
    passengerId: PASSENGER_UID,
    amount: amountInCents,
    rideId,
    rideDetails: {
      origin: PICKUP.address,
      destination: DESTINATION.address
    },
    passengerName: 'Leaf Passageiro Teste',
    passengerEmail: 'qa@leaf.local'
  }, 20000);

  const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
  assert(paymentAdvance.ok, `payment_advance_failed_${label}:${paymentAdvance?.data?.message || paymentAdvance.status}`);
  assert(chargeId, `payment_advance_missing_charge_${label}`);

  return {
    rideId,
    chargeId,
    amountInCents
  };
}

async function confirmAdvancePaymentByWebhook({
  rideId,
  chargeId,
  amountInCents,
  passengerId = PASSENGER_UID
}) {
  const webhookPayload = {
    event: 'OPENPIX:CHARGE_COMPLETED',
    charge: {
      identifier: chargeId,
      correlationID: `ride_${rideId}_${Date.now()}_smoke`,
      value: amountInCents,
      status: 'COMPLETED',
      paidAt: nowIso(),
      additionalInfo: [
        { key: 'ride_id', value: rideId },
        { key: 'passenger_id', value: passengerId },
        { key: 'payment_type', value: 'advance_payment' }
      ]
    },
    pix: {
      status: 'COMPLETED'
    }
  };

  const webhookResponse = await postJson(`${API_BASE_URL}/api/woovi/webhook`, webhookPayload, 20000);
  assert(webhookResponse.ok, `advance_payment_webhook_failed:${webhookResponse.status}`);
  await sleep(400);
  return webhookResponse;
}

async function createAndStartRide({ passengerClient, driverClient, label, estimatedFare = ORIGINAL_ESTIMATED_FARE }) {
  const payment = await createPaymentAdvance({ label, amountInCents: Math.round(estimatedFare * 100) });
  await confirmAdvancePaymentByWebhook(payment);

  const booking = await createBookingWithTimeout(passengerClient, {
    customerId: PASSENGER_UID,
    pickupLocation: PICKUP,
    destinationLocation: DESTINATION,
    estimatedFare,
    routeDistanceKm: CONTRACT_ROUTE_DISTANCE_KM,
    routeDurationSecs: CONTRACT_ROUTE_DURATION_SECS,
    paymentMethod: 'pix',
    paymentStatus: 'confirmed',
    paymentData: {
      chargeId: payment.chargeId,
      rideId: payment.rideId,
      amountInCents: payment.amountInCents
    },
    idempotencyKey: `ride_reassign_${label}_${Date.now()}`
  });

  const bookingId = booking?.bookingId;
  assert(bookingId, `booking_id_missing_${label}`);

  await passengerClient.confirmPayment({
    bookingId,
    paymentMethod: 'pix',
    paymentId: payment.chargeId,
    chargeId: payment.chargeId,
    rideId: payment.rideId,
    amount: estimatedFare
  });

  await driverClient.waitForEvent(
    'newRideRequest',
    45000,
    (payload) => (payload?.bookingId || payload?.rideId) === bookingId
  );

  const acceptRide = await driverClient.acceptRide(bookingId);
  await sleep(500);
  driverClient.socket.emit('updateLocation', {
    lat: PICKUP.lat,
    lng: PICKUP.lng,
    tripStatus: 'accepted',
    isInTrip: false,
    seq: Date.now() % 100000
  });
  await sleep(200);

  await emitAndWait(driverClient, {
    emitEvent: 'notificationAction',
    emitPayload: {
      action: 'arrived_at_pickup',
      bookingId,
      location: { lat: PICKUP.lat, lng: PICKUP.lng }
    },
    successEvent: 'notificationActionSuccess',
    errorEvent: 'notificationActionError',
    timeoutMs: 15000,
    predicate: (payload) => payload?.bookingId === bookingId && payload?.action === 'arrived_at_pickup'
  });

  const startTrip = await driverClient.startTrip({
    bookingId,
    startLocation: PICKUP
  });

  await passengerClient.waitForEvent(
    'tripStarted',
    15000,
    (payload) => payload?.bookingId === bookingId
  );

  return {
    bookingId,
    payment,
    acceptRide,
    startTrip
  };
}

function prepareDriver2() {
  if (DRIVER2_UID) {
    return {
      uid: DRIVER2_UID,
      phone: DRIVER2_PHONE
    };
  }

  const ensureScript = path.join(__dirname, 'ensure-leaf-test-users.cjs');
  const raw = execFileSync('node', [ensureScript], {
    cwd: path.join(__dirname, '..', '..'),
    env: {
      ...process.env,
      TEST_DRIVER_PHONE: DRIVER2_PHONE
    },
    encoding: 'utf8'
  });
  const parsed = JSON.parse(raw);
  assert(parsed?.ok === true, 'failed_to_prepare_driver2');
  return parsed.driver;
}

function buildHeartbeat(client, location, intervalMs = 1200) {
  const send = () => {
    client.socket.emit('updateLocation', {
      lat: location.lat,
      lng: location.lng,
      tripStatus: 'idle',
      isInTrip: false,
      seq: Date.now() % 100000
    });
  };
  send();
  return setInterval(send, intervalMs);
}

function sumGross(legs = []) {
  return Number(
    (Array.isArray(legs) ? legs : []).reduce((acc, leg) => acc + Number(leg?.grossAmount || 0), 0).toFixed(2)
  );
}

async function run() {
  const reportPath = buildReportPath();
  const report = {
    meta: {
      startedAt: nowIso(),
      wsUrl: WS_URL,
      baseUrl: API_BASE_URL,
      passengerUid: PASSENGER_UID,
      driver1Uid: DRIVER1_UID,
      reportPath
    },
    flows: {},
    status: 'running'
  };
  let currentStage = 'boot';
  const setStage = (stage) => {
    currentStage = stage;
    report.meta.currentStage = stage;
    writeReport(report, reportPath);
  };
  const globalTimeoutMs = Number.parseInt(process.env.SMOKE_GLOBAL_TIMEOUT_MS || '240000', 10);
  const globalTimeout = setTimeout(() => {
    report.status = 'failed';
    report.error = `global_timeout:${currentStage}`;
    report.meta.finishedAt = nowIso();
    report.meta.currentStage = currentStage;
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }, globalTimeoutMs);

  const driver1 = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });
  const passenger = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });

  let driver2 = null;
  let driver1Heartbeat = null;
  let driver2Heartbeat = null;

  try {
    setStage('prepare_driver2');
    const driver2Profile = prepareDriver2();
    report.meta.driver2Uid = driver2Profile.uid;
    report.meta.driver2Phone = driver2Profile.phone;
    resetRemoteTestRideState(PASSENGER_UID, [DRIVER1_UID, driver2Profile.uid]);

    setStage('connect_primary_clients');
    await driver1.connect();
    await passenger.connect();

    setStage('authenticate_primary_clients');
    await driver1.authenticate(DRIVER1_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

    setStage('driver1_online');
    const onlineDriver1 = await ensureDriverOnline(driver1, PICKUP);
    assert(onlineDriver1.success, 'driver1_online_failed');
    driver1Heartbeat = buildHeartbeat(driver1, PICKUP);
    await sleep(1200);

    passenger.clearEvents();
    driver1.clearEvents();

    setStage('continuation_create_and_start');
    const continuationRide = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver1,
      label: 'operational_continue'
    });

    setStage('connect_driver2');
    driver2 = new WebSocketTestClient(WS_URL, {
      transports: ['websocket'],
      timeout: 30000,
      reconnection: false
    });
    await driver2.connect();
    setStage('authenticate_driver2');
    await driver2.authenticate(driver2Profile.uid, 'driver');
    setStage('driver2_online');
    const onlineDriver2 = await ensureDriverOnline(driver2, INTERRUPTION_POINT);
    assert(onlineDriver2.success, 'driver2_online_failed');
    driver2Heartbeat = buildHeartbeat(driver2, INTERRUPTION_POINT);
    await sleep(1500);

    setStage('driver1_interrupt_continuation_ride');
    const passengerInterruptionPromise = passenger.waitForEvent(
      'rideOperationalInterruption',
      20000,
      (payload) => payload?.bookingId === continuationRide.bookingId
    );

    const driverInterrupted = await driver1.interruptRideOperational({
      bookingId: continuationRide.bookingId,
      interruptionLocation: INTERRUPTION_POINT,
      distanceKm: 2.8,
      durationSecs: 420,
      reason: 'VEHICLE_BREAKDOWN',
      note: 'Falha mecânica em teste controlado'
    });

    const passengerInterruption = await passengerInterruptionPromise;
    assert(passengerInterruption.interruption?.status === 'PASSENGER_DECISION_PENDING', 'interruption_should_require_passenger_decision');

    setStage('passenger_requests_continuation');
    const driverReleasedPromise = driver1.waitForEvent(
      'rideOperationalReleased',
      20000,
      (payload) => payload?.bookingId === continuationRide.bookingId
    );
    const passengerSearching = await passenger.respondOperationalContinuation({
      bookingId: continuationRide.bookingId,
      continueTrip: true
    });
    const driverReleased = await driverReleasedPromise;

    assert(passengerSearching.status === 'REASSIGNMENT_PENDING', 'continuation_should_enter_reassignment_pending');
    assert(driverReleased.success === true, 'interrupted_driver_should_be_released');

    setStage('await_driver2_offer');
    const driver2Offer = await driver2.waitForEvent(
      'newRideRequest',
      45000,
      (payload) => payload?.bookingId === continuationRide.bookingId
    );

    report.flows.driver2OfferDebug = driver2Offer;
    writeReport(report, reportPath);

    const continuationMarked =
      driver2Offer.isOperationalContinuation === true ||
      String(driver2Offer.isOperationalContinuation || '').toLowerCase() === 'true' ||
      String(driver2Offer.rideMode || '').toLowerCase() === 'continuation';

    assert(continuationMarked, 'driver2_offer_should_be_marked_as_continuation');
    assert(String(driver2Offer.continuationMessage || '').length > 0, 'driver2_offer_should_explain_continuation');

    setStage('driver2_accepts_continuation');
    const driver2Accepted = await driver2.acceptRide(continuationRide.bookingId);
    await sleep(500);
    driver2.socket.emit('updateLocation', {
      lat: INTERRUPTION_POINT.lat,
      lng: INTERRUPTION_POINT.lng,
      tripStatus: 'accepted',
      isInTrip: false,
      seq: Date.now() % 100000
    });
    await sleep(200);

    setStage('driver2_arrived');
    const driver2Arrived = await emitAndWait(driver2, {
      emitEvent: 'notificationAction',
      emitPayload: {
        action: 'arrived_at_pickup',
        bookingId: continuationRide.bookingId,
        location: { lat: INTERRUPTION_POINT.lat, lng: INTERRUPTION_POINT.lng }
      },
      successEvent: 'notificationActionSuccess',
      errorEvent: 'notificationActionError',
      timeoutMs: 15000,
      predicate: (payload) => payload?.bookingId === continuationRide.bookingId && payload?.action === 'arrived_at_pickup'
    });

    setStage('driver2_start_trip');
    const driver2Start = await driver2.startTrip({
      bookingId: continuationRide.bookingId,
      startLocation: INTERRUPTION_POINT
    });

    await passenger.waitForEvent(
      'tripStarted',
      20000,
      (payload) => payload?.bookingId === continuationRide.bookingId
    );

    setStage('driver2_complete_trip');
    const passengerContinuationCompletedPromise = passenger.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === continuationRide.bookingId
    );
    const driver2Completed = await driver2.finishTrip({
      bookingId: continuationRide.bookingId,
      endLocation: DESTINATION,
      distance: 5100,
      duration: 660,
      fare: ORIGINAL_ESTIMATED_FARE
    });
    const passengerContinuationCompleted = await passengerContinuationCompletedPromise;

    assert(Array.isArray(driver2Completed.rideLegs), 'continuation_completion_should_include_ride_legs');
    assert(driver2Completed.rideLegs.length === 2, 'continuation_completion_should_have_two_legs');
    assert(sumGross(driver2Completed.rideLegs) === ORIGINAL_ESTIMATED_FARE, 'multi_leg_total_should_match_original_contract');
    assert(
      Number(driver2Completed.rideLegs[1]?.platformAbsorbedOperationalFee || 0) > 0,
      'second_leg_operational_fee_should_be_absorbed_by_platform'
    );

    report.flows.continueWithOtherDriver = {
      bookingId: continuationRide.bookingId,
      driverInterrupted,
      passengerInterruption,
      passengerSearching,
      driverReleased,
      driver2Offer,
      driver2Accepted,
      driver2Arrived,
      driver2Start,
      driver2Completed,
      passengerContinuationCompleted
    };

    clearInterval(driver2Heartbeat);
    driver2Heartbeat = null;
    await ensureDriverOffline(driver2, INTERRUPTION_POINT).catch(() => false);
    driver2.disconnect();
    driver2 = null;

    setStage('prepare_second_scenario');
    await sleep(1200);
    resetRemoteTestRideState(PASSENGER_UID, [DRIVER1_UID, driver2Profile.uid]);
    const driver1BackOnline = await ensureDriverOnline(driver1, PICKUP);
    assert(driver1BackOnline.success, 'driver1_should_return_online_for_second_flow');
    passenger.clearEvents();
    driver1.clearEvents();

    setStage('end_here_create_and_start');
    const endedRide = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver1,
      label: 'operational_end_here'
    });

    setStage('driver1_interrupt_end_here_ride');
    const passengerInterruptionEndPromise = passenger.waitForEvent(
      'rideOperationalInterruption',
      20000,
      (payload) => payload?.bookingId === endedRide.bookingId
    );

    const driverInterruptedEnd = await driver1.interruptRideOperational({
      bookingId: endedRide.bookingId,
      interruptionLocation: INTERRUPTION_POINT,
      distanceKm: 3.1,
      durationSecs: 480,
      reason: 'POLICE_STOP_OR_SEIZURE',
      note: 'Parada operacional em teste'
    });

    const passengerInterruptionEnd = await passengerInterruptionEndPromise;
    assert(passengerInterruptionEnd.interruption?.status === 'PASSENGER_DECISION_PENDING', 'end_flow_should_require_passenger_decision');

    setStage('passenger_ends_after_interruption');
    const driver1EndedTripPromise = driver1.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === endedRide.bookingId
    );
    const passengerEndedTrip = await passenger.respondOperationalContinuation({
      bookingId: endedRide.bookingId,
      continueTrip: false
    });
    const driver1EndedTrip = await driver1EndedTripPromise;

    assert(passengerEndedTrip.completionType === 'INTERRUPTED_OPERATIONAL_ENDED', 'interruption_end_should_complete_with_specific_type');
    assert(Array.isArray(passengerEndedTrip.rideLegs) && passengerEndedTrip.rideLegs.length === 1, 'interruption_end_should_keep_single_leg');
    assert(
      Number(passengerEndedTrip.settlement?.estimatedRefund || 0) > 0,
      'interruption_end_should_estimate_refund'
    );

    report.flows.endAfterInterruption = {
      bookingId: endedRide.bookingId,
      driverInterrupted: driverInterruptedEnd,
      passengerInterruption: passengerInterruptionEnd,
      passengerEndedTrip,
      driver1EndedTrip
    };

    report.status = 'success';
    report.meta.finishedAt = nowIso();
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    report.meta.finishedAt = nowIso();
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } finally {
    clearTimeout(globalTimeout);
    if (driver1Heartbeat) clearInterval(driver1Heartbeat);
    if (driver2Heartbeat) clearInterval(driver2Heartbeat);
    if (driver1) driver1.disconnect();
    if (driver2) driver2.disconnect();
    if (passenger) passenger.disconnect();
  }
}

run();

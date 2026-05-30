#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '8vg2kxxqi3TYKlpD6eBlWgYseIq2';

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

const FAR_DESTINATION = {
  lat: Number(process.env.TEST_FAR_DEST_LAT || -22.9424),
  lng: Number(process.env.TEST_FAR_DEST_LNG || -43.2019),
  address: process.env.TEST_FAR_DEST_ADDRESS || 'Barra estendida - Rio de Janeiro'
};

const EARLY_END_LOCATION = {
  lat: Number(process.env.TEST_EARLY_END_LAT || -22.9098),
  lng: Number(process.env.TEST_EARLY_END_LNG || -43.1774),
  address: process.env.TEST_EARLY_END_ADDRESS || 'Saida antecipada - Glória'
};

const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);

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
  const reportName = `ride-lifecycle-smoke-vps-${Date.now()}.json`;
  return path.join(__dirname, '..', '..', 'reports', reportName);
}

function writeReport(report, reportPath) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
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

async function ensureDriverOnline(driverClient) {
  for (let attempt = 1; attempt <= ONLINE_MAX_ATTEMPTS; attempt += 1) {
    const heading = (Date.now() / 100) % 360;
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: PICKUP.lat + (attempt * 0.00001),
      lng: PICKUP.lng + (attempt * 0.00001),
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
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
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
    attempts: ONLINE_MAX_ATTEMPTS,
    error: {
      code: 'ONLINE_RETRY_EXHAUSTED',
      error: 'Tentativas para ficar online esgotadas'
    }
  };
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
  const rideId = `ride_lifecycle_${Date.now()}_${label}`;
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

async function createAndStartRide({ passengerClient, driverClient, label, destination = DESTINATION, estimatedFare = 27.5 }) {
  const payment = await createPaymentAdvance({ label, amountInCents: Math.round(estimatedFare * 100) });
  await confirmAdvancePaymentByWebhook(payment);

  const booking = await createBookingWithTimeout(passengerClient, {
    customerId: PASSENGER_UID,
    pickupLocation: PICKUP,
    destinationLocation: destination,
    estimatedFare,
    paymentMethod: 'pix',
    paymentStatus: 'confirmed',
    paymentData: {
      chargeId: payment.chargeId,
      rideId: payment.rideId,
      amountInCents: payment.amountInCents
    },
    idempotencyKey: `ride_lifecycle_${label}_${Date.now()}`
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

  const newRideRequest = await driverClient.waitForEvent(
    'newRideRequest',
    45000,
    (payload) => (payload?.bookingId || payload?.rideId) === bookingId
  );

  const acceptRide = await driverClient.acceptRide(bookingId);
  await sleep(600);
  driverClient.socket.emit('updateLocation', {
    lat: PICKUP.lat,
    lng: PICKUP.lng,
    tripStatus: 'accepted',
    isInTrip: false,
    seq: Date.now() % 100000
  });
  await sleep(250);
  const arrivedAtPickup = await emitAndWait(driverClient, {
    emitEvent: 'notificationAction',
    emitPayload: {
      action: 'arrived_at_pickup',
      bookingId,
      location: {
        lat: PICKUP.lat,
        lng: PICKUP.lng
      }
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

  const passengerTripStarted = await passengerClient.waitForEvent(
    'tripStarted',
    15000,
    (payload) => payload?.bookingId === bookingId
  );

  return {
    bookingId,
    payment,
    newRideRequest,
    acceptRide,
    arrivedAtPickup,
    startTrip,
    passengerTripStarted
  };
}

async function run() {
  const reportPath = buildReportPath();
  const report = {
    meta: {
      startedAt: nowIso(),
      wsUrl: WS_URL,
      baseUrl: API_BASE_URL,
      passengerUid: PASSENGER_UID,
      driverUid: DRIVER_UID,
      reportPath
    },
    flows: {},
    status: 'running'
  };

  const driver = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });
  const passenger = new WebSocketTestClient(WS_URL, {
    transports: ['websocket'],
    timeout: 30000,
    reconnection: false
  });

  let heartbeatTimer = null;

  try {
    await driver.connect();
    await passenger.connect();

    await driver.authenticate(DRIVER_UID, 'driver');
    await passenger.authenticate(PASSENGER_UID, 'customer');

    const online = await ensureDriverOnline(driver);
    assert(online.success, `driver_online_failed:${online.error?.code || 'unknown'}:${online.error?.error || 'unknown'}`);
    report.meta.driverOnline = online;

    const sendLocation = () => {
      driver.socket.emit('updateLocation', {
        lat: PICKUP.lat + 0.0002,
        lng: PICKUP.lng + 0.0002,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now() % 100000
      });
    };

    sendLocation();
    heartbeatTimer = setInterval(sendLocation, 1200);
    await sleep(1200);

    passenger.clearEvents();
    driver.clearEvents();

    const extensionFlow = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver,
      label: 'extension'
    });

    const expensiveDestinationCheck = await passenger.changeDestination({
      bookingId: extensionFlow.bookingId,
      newDestination: FAR_DESTINATION
    });

    assert(expensiveDestinationCheck.requiresPayment === true, 'expensive_destination_should_require_payment');
    assert(expensiveDestinationCheck.requiresDriverApproval === true, 'expensive_destination_should_require_driver_approval');
    assert(expensiveDestinationCheck.destinationUpdated === false, 'expensive_destination_should_not_mutate_immediately');

    passenger.clearEvents();
    driver.clearEvents();

    const extensionFare = 34.75;
    const driverApprovalPromise = driver.waitForEvent(
      'rideExtensionApprovalRequested',
      15000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );

    const passengerExtensionAck = await emitAndWait(passenger, {
      emitEvent: 'requestRideExtension',
      emitPayload: {
        bookingId: extensionFlow.bookingId,
        newEndLocation: FAR_DESTINATION,
        newFare: extensionFare,
        routeDistanceKm: 8.4,
        routeDurationSecs: 1080
      },
      successEvent: 'rideExtensionRequestAccepted',
      errorEvent: 'rideExtensionError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === extensionFlow.bookingId
    });

    const driverApproval = await driverApprovalPromise;
    assert(Number(driverApproval.diffFare) > 0, 'extension_diff_fare_should_be_positive');

    const driverPendingPromise = driver.waitForEvent(
      'rideExtensionPendingPayment',
      15000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );
    const passengerPaymentRequiredPromise = passenger.waitForEvent(
      'rideExtensionPaymentRequired',
      15000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );

    const driverResponded = await emitAndWait(driver, {
      emitEvent: 'respondRideExtension',
      emitPayload: {
        bookingId: extensionFlow.bookingId,
        accepted: true,
        mockPayment: true
      },
      successEvent: 'rideExtensionPendingPayment',
      errorEvent: 'rideExtensionResponseError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === extensionFlow.bookingId
    });

    const driverPendingPayment = await driverPendingPromise;
    const passengerPaymentRequired = await passengerPaymentRequiredPromise;

    assert(driverResponded.chargeId, 'extension_charge_id_missing_for_driver');
    assert(passengerPaymentRequired.chargeId, 'extension_charge_id_missing_for_passenger');
    assert(String(driverResponded.chargeId) === String(passengerPaymentRequired.chargeId), 'extension_charge_id_should_match');

    const passengerExtensionConfirmedPromise = passenger.waitForEvent(
      'rideExtensionConfirmed',
      15000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );
    const driverExtensionConfirmedPromise = driver.waitForEvent(
      'rideExtensionConfirmed',
      15000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );

    const extensionPaymentConfirmed = await passenger.confirmPayment({
      bookingId: extensionFlow.bookingId,
      paymentMethod: 'pix',
      paymentId: passengerPaymentRequired.chargeId,
      chargeId: passengerPaymentRequired.chargeId,
      amount: Number(passengerPaymentRequired.diffFare || passengerExtensionAck.diffFare || 0)
    });

    const passengerExtensionConfirmed = await passengerExtensionConfirmedPromise;
    const driverExtensionConfirmed = await driverExtensionConfirmedPromise;

    assert(passengerExtensionConfirmed.status === 'CONFIRMED', 'extension_should_be_confirmed_for_passenger');
    assert(driverExtensionConfirmed.status === 'CONFIRMED', 'extension_should_be_confirmed_for_driver');
    assert(Number(passengerExtensionConfirmed.newFare) === extensionFare, 'confirmed_extension_should_use_new_fare');

    const passengerTripCompletedPromise = passenger.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === extensionFlow.bookingId
    );
    const driverTripCompleted = await driver.finishTrip({
      bookingId: extensionFlow.bookingId,
      endLocation: FAR_DESTINATION,
      distance: 8400,
      duration: 1080,
      fare: extensionFare
    });
    const passengerTripCompleted = await passengerTripCompletedPromise;

    report.flows.extension = {
      bookingId: extensionFlow.bookingId,
      expensiveDestinationCheck,
      passengerExtensionAck,
      driverApproval,
      driverPendingPayment,
      passengerPaymentRequired,
      extensionPaymentConfirmed,
      passengerExtensionConfirmed,
      driverExtensionConfirmed,
      driverTripCompleted,
      passengerTripCompleted
    };

    assert(driverTripCompleted.authoritativeSnapshot === true, 'extension_trip_should_finish_with_authoritative_snapshot');
    assert(String(driverTripCompleted.drop || '').includes('Barra') || driverTripCompleted.destinationCoordinate, 'extension_trip_should_keep_updated_destination');

    passenger.clearEvents();
    driver.clearEvents();

    const rejectedFlow = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver,
      label: 'extension_rejected'
    });

    const rejectedDriverApprovalPromise = driver.waitForEvent(
      'rideExtensionApprovalRequested',
      15000,
      (payload) => payload?.bookingId === rejectedFlow.bookingId
    );

    const rejectedPassengerAck = await emitAndWait(passenger, {
      emitEvent: 'requestRideExtension',
      emitPayload: {
        bookingId: rejectedFlow.bookingId,
        newEndLocation: FAR_DESTINATION,
        newFare: 35.25,
        routeDistanceKm: 8.1,
        routeDurationSecs: 990
      },
      successEvent: 'rideExtensionRequestAccepted',
      errorEvent: 'rideExtensionError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === rejectedFlow.bookingId
    });

    const rejectedDriverApproval = await rejectedDriverApprovalPromise;
    const rejectedPassengerEventPromise = passenger.waitForEvent(
      'rideExtensionRejected',
      15000,
      (payload) => payload?.bookingId === rejectedFlow.bookingId
    );

    const rejectedDriverEvent = await emitAndWait(driver, {
      emitEvent: 'respondRideExtension',
      emitPayload: {
        bookingId: rejectedFlow.bookingId,
        accepted: false
      },
      successEvent: 'rideExtensionRejected',
      errorEvent: 'rideExtensionResponseError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === rejectedFlow.bookingId
    });
    const rejectedPassengerEvent = await rejectedPassengerEventPromise;

    assert(rejectedDriverEvent.status === 'DRIVER_DECLINED', 'extension_rejected_should_be_declined');
    assert(rejectedPassengerEvent.status === 'DRIVER_DECLINED', 'passenger_should_receive_extension_rejected');

    const rejectedPassengerTripCompletedPromise = passenger.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === rejectedFlow.bookingId
    );
    const rejectedDriverTripCompleted = await driver.finishTrip({
      bookingId: rejectedFlow.bookingId,
      endLocation: DESTINATION,
      distance: 5200,
      duration: 780,
      fare: 27.5
    });
    const rejectedPassengerTripCompleted = await rejectedPassengerTripCompletedPromise;

    report.flows.extensionRejected = {
      bookingId: rejectedFlow.bookingId,
      rejectedPassengerAck,
      rejectedDriverApproval,
      rejectedDriverEvent,
      rejectedPassengerEvent,
      rejectedDriverTripCompleted,
      rejectedPassengerTripCompleted
    };

    passenger.clearEvents();
    driver.clearEvents();

    const expiredFlow = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver,
      label: 'extension_expired'
    });

    const expiredDriverApprovalPromise = driver.waitForEvent(
      'rideExtensionApprovalRequested',
      15000,
      (payload) => payload?.bookingId === expiredFlow.bookingId
    );

    const expiredPassengerAck = await emitAndWait(passenger, {
      emitEvent: 'requestRideExtension',
      emitPayload: {
        bookingId: expiredFlow.bookingId,
        newEndLocation: FAR_DESTINATION,
        newFare: 36.5,
        routeDistanceKm: 8.7,
        routeDurationSecs: 1020
      },
      successEvent: 'rideExtensionRequestAccepted',
      errorEvent: 'rideExtensionError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === expiredFlow.bookingId
    });

    const expiredDriverApproval = await expiredDriverApprovalPromise;
    const expiredDriverPendingPayment = await emitAndWait(driver, {
      emitEvent: 'respondRideExtension',
      emitPayload: {
        bookingId: expiredFlow.bookingId,
        accepted: true,
        mockPayment: true
      },
      successEvent: 'rideExtensionPendingPayment',
      errorEvent: 'rideExtensionResponseError',
      timeoutMs: 20000,
      predicate: (payload) => payload?.bookingId === expiredFlow.bookingId
    });

    const expiredPassengerRequiredPromise = passenger.waitForEvent(
      'rideExtensionPaymentRequired',
      15000,
      (payload) => payload?.bookingId === expiredFlow.bookingId
    );
    const expiredPassengerRequired = await expiredPassengerRequiredPromise;
    const expiredPassengerEventPromise = passenger.waitForEvent(
      'rideExtensionExpired',
      15000,
      (payload) => payload?.bookingId === expiredFlow.bookingId
    );
    const expiredDriverEventPromise = driver.waitForEvent(
      'rideExtensionExpired',
      15000,
      (payload) => payload?.bookingId === expiredFlow.bookingId
    );

    const expiredWebhook = await postJson(`${API_BASE_URL}/api/woovi/webhook`, {
      event: 'charge.expired',
      rideId: expiredFlow.bookingId,
      charge: {
        identifier: expiredPassengerRequired.chargeId,
        status: 'EXPIRED'
      }
    }, 20000);

    assert(expiredWebhook.ok, `extension_expired_webhook_failed:${expiredWebhook.status}`);

    const expiredPassengerEvent = await expiredPassengerEventPromise;
    const expiredDriverEvent = await expiredDriverEventPromise;

    assert(expiredPassengerEvent.status === 'EXPIRED', 'extension_should_emit_expired_for_passenger');
    assert(expiredDriverEvent.status === 'EXPIRED', 'extension_should_emit_expired_for_driver');
    assert(
      String(expiredPassengerEvent.message || '').toLowerCase().includes('expir'),
      'extension_expired_should_keep_business_message'
    );

    const expiredPassengerTripCompletedPromise = passenger.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === expiredFlow.bookingId
    );
    const expiredDriverTripCompleted = await driver.finishTrip({
      bookingId: expiredFlow.bookingId,
      endLocation: DESTINATION,
      distance: 5300,
      duration: 800,
      fare: 27.5
    });
    const expiredPassengerTripCompleted = await expiredPassengerTripCompletedPromise;

    report.flows.extensionExpired = {
      bookingId: expiredFlow.bookingId,
      expiredPassengerAck,
      expiredDriverApproval,
      expiredDriverPendingPayment,
      expiredPassengerRequired,
      expiredWebhook,
      expiredPassengerEvent,
      expiredDriverEvent,
      expiredDriverTripCompleted,
      expiredPassengerTripCompleted
    };

    passenger.clearEvents();
    driver.clearEvents();

    const earlyEndFlow = await createAndStartRide({
      passengerClient: passenger,
      driverClient: driver,
      label: 'early_end'
    });

    let cancelBlockedMessage = '';
    try {
      await passenger.cancelRide(earlyEndFlow.bookingId, 'Tentativa após início');
      throw new Error('cancel_after_start_should_not_succeed');
    } catch (error) {
      cancelBlockedMessage = String(error.message || '');
    }

    assert(cancelBlockedMessage.toLowerCase().includes('encerramento') || cancelBlockedMessage.toLowerCase().includes('após o início'), 'cancel_after_start_should_be_blocked_with_business_message');

    const passengerEarlyTripCompletedPromise = passenger.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === earlyEndFlow.bookingId
    );
    const driverEarlyTripCompletedPromise = driver.waitForEvent(
      'tripCompleted',
      30000,
      (payload) => payload?.bookingId === earlyEndFlow.bookingId
    );

    const passengerEarlyEnd = await emitAndWait(passenger, {
      emitEvent: 'endTripEarlyByRider',
      emitPayload: {
        bookingId: earlyEndFlow.bookingId,
        endLocation: EARLY_END_LOCATION,
        distanceKm: 2.4,
        durationSecs: 420,
        reason: 'EARLY_DROPOFF_BY_RIDER'
      },
      successEvent: 'tripCompleted',
      errorEvent: 'tripCompleteError',
      timeoutMs: 30000,
      predicate: (payload) => payload?.bookingId === earlyEndFlow.bookingId
    });

    const driverEarlyTripCompleted = await driverEarlyTripCompletedPromise;
    const passengerEarlyTripCompleted = await passengerEarlyTripCompletedPromise;

    assert(passengerEarlyEnd.completionType === 'EARLY_ENDED_BY_RIDER', 'early_end_should_return_completion_type');
    assert(passengerEarlyEnd.authoritativeSnapshot === true, 'early_end_should_be_authoritative');
    assert(passengerEarlyEnd.settlement?.estimatedRefund !== undefined, 'early_end_should_include_settlement');

    report.flows.earlyEnd = {
      bookingId: earlyEndFlow.bookingId,
      cancelBlockedMessage,
      passengerEarlyEnd,
      passengerEarlyTripCompleted,
      driverEarlyTripCompleted
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
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    driver.disconnect();
    passenger.disconnect();
  }
}

run();

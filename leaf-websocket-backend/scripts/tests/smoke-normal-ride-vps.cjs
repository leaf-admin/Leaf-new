#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
const { getIdTokenForUid } = require('../../tests/e2e/backend/__helpers__/firebase-id-token');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const PASSENGER_UID = String(
  process.env.TEST_PASSENGER_UID || process.env.PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2'
).trim();
const DRIVER_UID = String(
  process.env.TEST_DRIVER_UID || process.env.DRIVER_UID || '8vg2kxxqi3TYKlpD6eBlWgYseIq2'
).trim();
const LEGACY_PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const LEGACY_DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const ONLINE_MAX_ATTEMPTS = Number(process.env.ONLINE_MAX_ATTEMPTS || 5);
const TEST_CAR_TYPE = String(process.env.TEST_CAR_TYPE || 'leafplus').trim() || 'leafplus';

if (PASSENGER_UID === DRIVER_UID) {
  throw new Error('uid_conflict: TEST_PASSENGER_UID e TEST_DRIVER_UID não podem ser iguais');
}

if (PASSENGER_UID === LEGACY_DRIVER_UID && DRIVER_UID === LEGACY_PASSENGER_UID) {
  throw new Error('uids_swapped: passageiro e motorista parecem invertidos no ambiente');
}

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
const DRIVER_START = {
  // About 2 km south of pickup. This keeps the visual smoke meaningful without
  // widening the production dispatch radius or changing matching policy.
  lat: Number(process.env.TEST_DRIVER_START_LAT || PICKUP.lat - 0.018),
  lng: Number(process.env.TEST_DRIVER_START_LNG || PICKUP.lng + 0.001),
};
const DRIVER_PAYMENT_PRESENCE = {
  lat: PICKUP.lat + 0.0002,
  lng: PICKUP.lng + 0.0002,
};
const VISUAL_SEARCH_HOLD_MS = parseVisualHoldMs(process.env.QA_VISUAL_SEARCH_HOLD_MS);
const VISUAL_PICKUP_HOLD_MS = parseVisualHoldMs(process.env.QA_VISUAL_PICKUP_HOLD_MS);
const VISUAL_TRIP_START_HOLD_MS = parseVisualHoldMs(process.env.QA_VISUAL_TRIP_START_HOLD_MS);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function parseVisualHoldMs(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.min(Math.max(0, Math.round(parsed)), 90000) : 0;
}
function interpolateCoordinate(start, end, ratio) {
  const safeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
  return {
    lat: start.lat + (end.lat - start.lat) * safeRatio,
    lng: start.lng + (end.lng - start.lng) * safeRatio,
  };
}
function calculateHeadingDegrees(start, end) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const toDegrees = (value) => (Number(value) * 180) / Math.PI;
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}
function calculateDistanceMeters(start, end) {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const haversine = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
function nowIso() { return new Date().toISOString(); }
function buildReportPath() { return path.join(__dirname, '..', '..', 'reports', `normal-ride-smoke-vps-${Date.now()}.json`); }
function writeReport(report, reportPath) { fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
async function postJson(url, body, timeoutMs = 20000, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
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
      done({ ok: false, error: { code: 'STATUS_TIMEOUT', error: 'Timeout aguardando driverStatus ack' } });
    }, timeoutMs);
    driverClient.socket.once('driverStatusUpdated', (data) => { clearTimeout(timeout); successHandler(data); });
    driverClient.socket.once('driverStatusError', (error) => { clearTimeout(timeout); errorHandler(error); });
    driverClient.socket.emit('setDriverStatus', payload);
  });
}
async function ensureDriverOnline(driverClient, coordinate = DRIVER_PAYMENT_PRESENCE) {
  const onlineCoordinate = coordinate && Number.isFinite(Number(coordinate.lat)) && Number.isFinite(Number(coordinate.lng))
    ? coordinate
    : DRIVER_PAYMENT_PRESENCE;
  for (let attempt = 1; attempt <= ONLINE_MAX_ATTEMPTS; attempt += 1) {
    const ack = await onceStatusAck(driverClient, {
      status: 'online',
      isOnline: true,
      lat: onlineCoordinate.lat + (attempt * 0.00001),
      lng: onlineCoordinate.lng + (attempt * 0.00001),
      heading: (Date.now() / 100) % 360,
      speed: 0
    });
    if (ack.ok) return { success: true, attempts: attempt, ack: ack.data };
    const code = String(ack.error?.code || '').toUpperCase();
    const retryAfter = Number(ack.error?.retryAfterSec || 1);
    if (code === 'LOCATION_REQUIRED' || code === 'ONLINE_NOT_READY') {
      driverClient.socket.emit('updateLocation', {
        lat: onlineCoordinate.lat,
        lng: onlineCoordinate.lng,
        tripStatus: 'idle',
        isInTrip: false,
        seq: Date.now()
      });
      await sleep(Math.max(700, retryAfter * 1000));
      continue;
    }
    return { success: false, attempts: attempt, error: ack.error || { code: 'UNKNOWN', error: 'Falha ao colocar driver online' } };
  }
  return { success: false, attempts: ONLINE_MAX_ATTEMPTS, error: { code: 'ONLINE_RETRY_EXHAUSTED', error: 'Tentativas para ficar online esgotadas' } };
}
function createBookingWithTimeout(passengerClient, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timeout = null;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingCreated', successHandler);
      passengerClient.socket.removeListener('bookingError', errorHandler);
    };
    const successHandler = (response) => {
      const eventBookingId = String(response?.bookingId || response?.data?.bookingId || '').trim();
      if (!eventBookingId) return;
      cleanup();
      resolve(response);
    };
    const errorHandler = (error) => {
      cleanup();
      const detail = error && typeof error === 'object'
        ? JSON.stringify({
          error: error.error || null,
          message: error.message || null,
          code: error.code || null,
          details: error.details || null
        })
        : '';
      reject(new Error(detail || 'create_booking_error'));
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error('create_booking_timeout'));
    }, timeoutMs);
    passengerClient.socket.on('bookingCreated', successHandler);
    passengerClient.socket.on('bookingError', errorHandler);
    passengerClient.socket.emit('createBooking', {
      ...payload,
      canaryStartedAt: startedAt
    });
  });
}
function emitAndWait(client, {
  emitEvent,
  emitPayload,
  successEvent,
  errorEvent,
  timeoutMs = 20000,
  predicate = null,
  errorPredicate = null
}) {
  const successMatches = typeof predicate === 'function' ? predicate : (() => true);
  const errorMatches = typeof errorPredicate === 'function'
    ? errorPredicate
    : (typeof predicate === 'function'
      ? (payload = {}) => {
          const hasBookingIdentity =
            payload &&
            typeof payload === 'object' &&
            (Object.prototype.hasOwnProperty.call(payload, 'bookingId') || Object.prototype.hasOwnProperty.call(payload, 'rideId'));
          if (!hasBookingIdentity) return true;
          try {
            return successMatches(payload);
          } catch (_error) {
            return false;
          }
        }
      : (() => true));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      client.socket.removeListener(successEvent, successHandler);
      if (errorEvent) client.socket.removeListener(errorEvent, errorHandler);
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`timeout_${emitEvent}`)); }, timeoutMs);
    const successHandler = (payload = {}) => {
      try { if (!successMatches(payload)) return; } catch (_error) { return; }
      clearTimeout(timeout);
      cleanup();
      resolve(payload);
    };
    const errorHandler = (error = {}) => {
      try { if (!errorMatches(error)) return; } catch (_error) { return; }
      clearTimeout(timeout);
      cleanup();
      reject(new Error(error.error || error.message || `error_${emitEvent}`));
    };
    client.socket.on(successEvent, successHandler);
    if (errorEvent) client.socket.on(errorEvent, errorHandler);
    client.socket.emit(emitEvent, emitPayload);
  });
}

async function syncActiveRideSnapshot(client, userType) {
  return emitAndWait(client, {
    emitEvent: 'syncActiveRide',
    emitPayload: { userType },
    successEvent: 'activeRideSync',
    timeoutMs: 12000,
    predicate: (payload) => Boolean(payload?.success)
  });
}

async function cleanupPreExistingActiveRide(passengerClient, driverClient) {
  const summary = {
    passengerBefore: null,
    driverBefore: null,
    cleanup: null,
    passengerAfter: null,
    driverAfter: null
  };

  const fallbackSnapshot = (error) => ({
    success: false,
    hasActiveRide: false,
    bookingId: null,
    error: error?.message || 'active_ride_sync_failed'
  });

  summary.passengerBefore = await syncActiveRideSnapshot(passengerClient, 'customer').catch(fallbackSnapshot);
  summary.driverBefore = await syncActiveRideSnapshot(driverClient, 'driver').catch(fallbackSnapshot);

  const passengerBookingId = String(summary.passengerBefore?.bookingId || '').trim();
  const driverBookingId = String(summary.driverBefore?.bookingId || '').trim();
  const candidateBookingId = passengerBookingId || driverBookingId;
  const hasAnyActiveRide = Boolean(summary.passengerBefore?.hasActiveRide || summary.driverBefore?.hasActiveRide);

  if (candidateBookingId && hasAnyActiveRide) {
    const activeSnapshot = summary.driverBefore?.bookingId ? summary.driverBefore : summary.passengerBefore;
    const activeStatus = String(activeSnapshot?.status || '').toUpperCase();
    const isInProgress = ['IN_PROGRESS', 'STARTED', 'ON_TRIP'].includes(activeStatus);
    try {
      const result = await passengerClient.cancelRide(candidateBookingId, 'pre_smoke_cleanup');
      summary.cleanup = { by: 'passenger', bookingId: candidateBookingId, result };
      await sleep(600);
    } catch (passengerCancelError) {
      try {
        const result = await driverClient.cancelRide(candidateBookingId, 'pre_smoke_cleanup');
        summary.cleanup = { by: 'driver', bookingId: candidateBookingId, result };
        await sleep(600);
      } catch (driverCancelError) {
        if (isInProgress) {
          try {
            const destination = activeSnapshot?.destinationLocation || DESTINATION;
            const result = await emitAndWait(driverClient, {
              emitEvent: 'completeTrip',
              emitPayload: {
                bookingId: candidateBookingId,
                endLocation: {
                  lat: Number(destination.lat || DESTINATION.lat),
                  lng: Number(destination.lng || DESTINATION.lng)
                },
                fare: Number(activeSnapshot?.estimatedFare || 0),
                distance: Number(activeSnapshot?.routeDistanceKm || 1.31),
                duration: Number(activeSnapshot?.routeDurationSecs || 168)
              },
              successEvent: 'tripCompleted',
              errorEvent: 'tripCompleteError',
              timeoutMs: 30000,
              predicate: (payload) => String(payload?.bookingId || payload?.rideId || '') === String(candidateBookingId),
              errorPredicate: (payload = {}) => {
                const eventBookingId = String(payload?.bookingId || payload?.rideId || '');
                if (!eventBookingId) return true;
                return eventBookingId === String(candidateBookingId);
              }
            });
            summary.cleanup = {
              by: 'driver_complete_trip',
              bookingId: candidateBookingId,
              result,
              passengerCancelError: passengerCancelError?.message || 'passenger_cancel_failed',
              driverCancelError: driverCancelError?.message || 'driver_cancel_failed'
            };
            await sleep(600);
          } catch (completeError) {
            summary.cleanup = {
              by: 'none',
              bookingId: candidateBookingId,
              passengerError: passengerCancelError?.message || 'passenger_cancel_failed',
              driverError: driverCancelError?.message || 'driver_cancel_failed',
              completeError: completeError?.message || 'driver_complete_failed'
            };
          }
        } else {
          summary.cleanup = {
            by: 'none',
            bookingId: candidateBookingId,
            passengerError: passengerCancelError?.message || 'passenger_cancel_failed',
            driverError: driverCancelError?.message || 'driver_cancel_failed'
          };
        }
      }
    }
  }

  summary.passengerAfter = await syncActiveRideSnapshot(passengerClient, 'customer').catch(fallbackSnapshot);
  summary.driverAfter = await syncActiveRideSnapshot(driverClient, 'driver').catch(fallbackSnapshot);

  return summary;
}

function reaisToCents(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

async function createBackendQuote() {
  const quoteSessionId = `smoke_quote_${Date.now()}`;
  const quote = await postJson(`${API_BASE_URL}/api/pricing/quote`, {
    passengerId: PASSENGER_UID,
    quoteSessionId,
    pickupLocation: PICKUP,
    destinationLocation: DESTINATION,
    carType: TEST_CAR_TYPE,
    routeCoordinates: [
      { lat: PICKUP.lat, lng: PICKUP.lng },
      { lat: DESTINATION.lat, lng: DESTINATION.lng }
    ]
  }, 20000, {
    'x-leaf-quote-session-id': quoteSessionId
  });

  assert(quote.ok, `pricing_quote_failed:${quote?.data?.message || quote.status}`);
  assert(quote.data?.quoteLockId, 'pricing_quote_missing_quote_lock');

  const amountInCents = reaisToCents(
    quote.data.passengerPayableFare ??
    quote.data.estimatedFare ??
    quote.data.grossEstimatedFare
  );
  assert(amountInCents > 0, 'pricing_quote_invalid_amount');

  return {
    ...quote.data,
    quoteSessionId: quote.data.quoteSessionId || quoteSessionId,
    amountInCents
  };
}

async function createPaymentAdvance(quote) {
  const rideId = `ride_normal_${Date.now()}`;
  const passengerIdToken = await getIdTokenForUid(PASSENGER_UID);
  const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
    passengerId: PASSENGER_UID,
    amount: quote.amountInCents,
    rideId,
    quoteSessionId: quote.quoteSessionId,
    quoteLockId: quote.quoteLockId,
    pickupLocation: PICKUP,
    destinationLocation: DESTINATION,
    carType: quote.carType || TEST_CAR_TYPE,
    rideDetails: {
      origin: PICKUP.address,
      destination: DESTINATION.address,
      pickupLocation: PICKUP,
      destinationLocation: DESTINATION,
      carType: quote.carType || TEST_CAR_TYPE,
      routeDistanceKm: quote.routeDistanceKm,
      routeDurationSecs: quote.routeDurationSecs,
      quoteSessionId: quote.quoteSessionId,
      quoteLockId: quote.quoteLockId
    },
    passengerName: 'Leaf Passageiro Teste',
    passengerEmail: 'qa@leaf.local'
  }, 20000, {
    authorization: `Bearer ${passengerIdToken}`
  });
  const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
  assert(paymentAdvance.ok, `payment_advance_failed:${paymentAdvance?.data?.message || paymentAdvance.status}`);
  assert(chargeId, 'payment_advance_missing_charge');
  return {
    rideId,
    chargeId,
    paymentIntentId: paymentAdvance?.data?.paymentIntentId || null,
    amountInCents: quote.amountInCents,
    quote
  };
}
async function confirmAdvancePaymentByWebhook({
  rideId,
  chargeId,
  paymentIntentId = null,
  amountInCents,
  passengerId = PASSENGER_UID
}) {
  if (String(process.env.CONFIRM_SANDBOX_PAYMENT_VIA_APP || '').toLowerCase() === 'true') {
    const passengerIdToken = await getIdTokenForUid(passengerId);
    const response = await postJson(`${API_BASE_URL}/api/woovi/test-confirm-sandbox-payment-app`, {
      passengerId,
      paymentIntentId
    }, 30000, {
      authorization: `Bearer ${passengerIdToken}`
    });
    assert(response.ok, `sandbox_app_payment_confirm_failed:${response?.data?.code || response?.data?.error || response.status}`);
    return response;
  }

  if (String(process.env.CANARY_DIRECT_PAYMENT_CONFIRMATION || '').toLowerCase() === 'true') {
    const PaymentService = require('../../services/payment-service');
    const paymentService = new PaymentService();
    const paidAt = nowIso();
    const metadata = {
      event: 'CANARY:DIRECT_PAYMENT_CONFIRMED',
      correlationID: `ride_${rideId}_direct_canary`,
      paidAt,
      source: 'smoke-normal-ride-vps'
    };

    const storeResult = await paymentService.storeConfirmedPayment({
      rideId,
      chargeId,
      amount: amountInCents,
      passengerId,
      metadata
    });
    assert(storeResult.success, `direct_payment_store_failed:${storeResult.error || 'unknown'}`);

    const holdingResult = await paymentService.savePaymentHolding(rideId, {
      status: 'in_holding',
      amount: amountInCents,
      paymentMethod: 'pix',
      paymentId: chargeId,
      chargeId,
      passengerId,
      paidAt,
      confirmedAt: paidAt,
      temporaryRideId: rideId,
      source: 'smoke_normal_ride_direct_canary'
    });
    assert(holdingResult.success, `direct_payment_holding_failed:${holdingResult.error || 'unknown'}`);
    return {
      ok: true,
      status: 200,
      data: {
        success: true,
        method: 'direct_canary_payment_confirmation',
        rideId,
        chargeId
      }
    };
  }

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
    pix: { status: 'COMPLETED' }
  };
  const webhookHeaders = {};
  const webhookAuthorization = String(
    process.env.WOOVI_WEBHOOK_AUTHORIZATION ||
    process.env.OPENPIX_WEBHOOK_AUTHORIZATION ||
    process.env.WOOVI_WEBHOOK_AUTH_TOKEN ||
    process.env.OPENPIX_WEBHOOK_AUTH_TOKEN ||
    ''
  ).trim();
  if (webhookAuthorization) {
    webhookHeaders.authorization = webhookAuthorization.startsWith('Bearer ')
      ? webhookAuthorization
      : `Bearer ${webhookAuthorization}`;
  }

  const webhookSignatureSecret = String(
    process.env.WOOVI_WEBHOOK_SIGNATURE_SECRET ||
    process.env.OPENPIX_WEBHOOK_SIGNATURE_SECRET ||
    process.env.WOOVI_WEBHOOK_HMAC_SECRET ||
    process.env.OPENPIX_WEBHOOK_HMAC_SECRET ||
    ''
  ).trim();
  if (webhookSignatureSecret) {
    const rawBody = JSON.stringify(webhookPayload);
    webhookHeaders['x-webhook-signature'] = `sha256=${crypto
      .createHmac('sha256', webhookSignatureSecret)
      .update(rawBody)
      .digest('hex')}`;
  }

  const webhookResponse = await postJson(`${API_BASE_URL}/api/woovi/webhook`, webhookPayload, 20000, webhookHeaders);
  assert(webhookResponse.ok, `advance_payment_webhook_failed:${webhookResponse.status}`);
  await sleep(400);
  return webhookResponse;
}

async function main() {
  const reportPath = buildReportPath();
  const report = {
    meta: {
      startedAt: new Date().toISOString(),
      wsUrl: WS_URL,
      baseUrl: API_BASE_URL,
      passengerUid: PASSENGER_UID,
      driverUid: DRIVER_UID,
      reportPath,
      visualWindows: {
        searchMs: VISUAL_SEARCH_HOLD_MS,
        pickupMs: VISUAL_PICKUP_HOLD_MS,
        tripStartMs: VISUAL_TRIP_START_HOLD_MS,
      },
      driverStart: {
        ...DRIVER_START,
        straightLineDistanceMeters: Math.round(calculateDistanceMeters(DRIVER_START, PICKUP)),
      },
    },
    flow: {},
    status: 'running'
  };

  const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
  let heartbeatTimer = null;
  let reportedDriverCoordinate = { ...DRIVER_PAYMENT_PRESENCE };
  let reportedDriverHeading = calculateHeadingDegrees(DRIVER_PAYMENT_PRESENCE, PICKUP);

  const emitDriverLocation = ({
    coordinate = reportedDriverCoordinate,
    tripStatus = 'idle',
    isInTrip = false,
    speed = 0,
  } = {}) => {
    const nextCoordinate = {
      lat: Number(coordinate.lat),
      lng: Number(coordinate.lng),
    };
    if (!Number.isFinite(nextCoordinate.lat) || !Number.isFinite(nextCoordinate.lng)) {
      throw new Error('invalid_driver_location');
    }
    reportedDriverHeading = calculateHeadingDegrees(reportedDriverCoordinate, nextCoordinate);
    reportedDriverCoordinate = nextCoordinate;
    driver.socket.emit('updateLocation', {
      lat: nextCoordinate.lat,
      lng: nextCoordinate.lng,
      heading: reportedDriverHeading,
      speed,
      tripStatus,
      isInTrip,
      seq: Date.now(),
    });
  };

  try {
    await passenger.connect();
    await driver.connect();
    await passenger.authenticate(PASSENGER_UID, 'customer');
    await driver.authenticate(DRIVER_UID, 'driver');

    const preflight = await cleanupPreExistingActiveRide(passenger, driver);
    report.meta.preflight = preflight;
    if (preflight.passengerAfter?.hasActiveRide && preflight.passengerAfter?.bookingId) {
      throw new Error(`preflight_active_ride_remaining_passenger:${preflight.passengerAfter.bookingId}`);
    }
    if (preflight.driverAfter?.hasActiveRide && preflight.driverAfter?.bookingId) {
      throw new Error(`preflight_active_ride_remaining_driver:${preflight.driverAfter.bookingId}`);
    }

    const online = await ensureDriverOnline(driver);
    assert(online.success, `driver_online_failed:${online.error?.code || 'unknown'}`);
    report.meta.driverOnline = online;

    const sendDriverIdleLocation = () => {
      emitDriverLocation({ coordinate: reportedDriverCoordinate, tripStatus: 'idle' });
    };

    sendDriverIdleLocation();
    heartbeatTimer = setInterval(sendDriverIdleLocation, 1200);
    await sleep(1000);

    const quote = await createBackendQuote();
    report.flow.quote = quote;

    const payment = await createPaymentAdvance(quote);
    report.flow.payment = payment;
    await confirmAdvancePaymentByWebhook(payment);

    // Payment availability must be checked against a genuinely available
    // driver. Only after that guard passes do we reposition the test driver to
    // the 2 km navigation starting point used by this visual scenario.
    emitDriverLocation({ coordinate: DRIVER_START, tripStatus: 'idle' });
    await sleep(900);

    const booking = await createBookingWithTimeout(passenger, {
      customerId: PASSENGER_UID,
      pickupLocation: PICKUP,
      destinationLocation: DESTINATION,
      estimatedFare: payment.amountInCents / 100,
      carType: 'Leaf Plus',
      selectedVehicle: 'Leaf Plus',
      paymentMethod: 'pix',
      paymentStatus: 'confirmed',
      paymentData: {
        chargeId: payment.chargeId,
        rideId: payment.rideId,
        amountInCents: payment.amountInCents,
        quoteSessionId: quote.quoteSessionId,
        quoteLockId: quote.quoteLockId
      },
      quoteSessionId: quote.quoteSessionId,
      quoteLockId: quote.quoteLockId,
      routeDistanceKm: quote.routeDistanceKm,
      routeDurationSecs: quote.routeDurationSecs,
      idempotencyKey: `normal_ride_${Date.now()}`
    });
    assert(booking?.bookingId, 'booking_id_missing');
    report.flow.booking = booking;

    report.flow.paymentConfirmed = {
      skipped: true,
      reason: 'booking_is_created_after_authoritative_advance_payment'
    };

    const newRideRequest = await driver.waitForEvent('newRideRequest', 45000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);
    if (VISUAL_SEARCH_HOLD_MS > 0) {
      await sleep(VISUAL_SEARCH_HOLD_MS);
    }
    const accepted = await emitAndWait(driver, {
      emitEvent: 'acceptRide',
      emitPayload: { bookingId: booking.bookingId },
      successEvent: 'rideAccepted',
      errorEvent: 'acceptRideError',
      timeoutMs: 15000,
      predicate: (payload) => String(payload?.bookingId || payload?.rideId || '') === String(booking.bookingId),
      errorPredicate: (payload = {}) => {
        const eventBookingId = String(payload?.bookingId || payload?.rideId || '');
        if (!eventBookingId) return true;
        return eventBookingId === String(booking.bookingId);
      }
    });
    await passenger.waitForEvent('rideAccepted', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const pickupApproach = [0.18, 0.44, 0.72, 1].map((ratio) =>
      interpolateCoordinate(DRIVER_START, PICKUP, ratio),
    );
    const pickupStepHoldMs = Math.max(
      250,
      Math.round(VISUAL_PICKUP_HOLD_MS / pickupApproach.length),
    );
    for (const coordinate of pickupApproach) {
      emitDriverLocation({
        coordinate,
        tripStatus: 'accepted',
        speed: VISUAL_PICKUP_HOLD_MS > 0 ? 8 : 0,
      });
      await sleep(pickupStepHoldMs);
    }
    const arrived = await emitAndWait(driver, {
      emitEvent: 'notificationAction',
      emitPayload: { action: 'arrived_at_pickup', bookingId: booking.bookingId, location: { lat: PICKUP.lat, lng: PICKUP.lng } },
      successEvent: 'notificationActionSuccess',
      errorEvent: 'notificationActionError',
      timeoutMs: 15000,
      predicate: (payload) => String(payload?.bookingId || '') === String(booking.bookingId),
      errorPredicate: (payload = {}) => {
        const eventBookingId = String(payload?.bookingId || payload?.rideId || '');
        if (!eventBookingId) return true;
        return eventBookingId === String(booking.bookingId);
      }
    });
    await passenger.waitForEvent('driverArrived', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId).catch(() => null);

    const started = await emitAndWait(driver, {
      emitEvent: 'startTrip',
      emitPayload: { bookingId: booking.bookingId, startLocation: { lat: PICKUP.lat, lng: PICKUP.lng } },
      successEvent: 'tripStarted',
      errorEvent: 'tripStartError',
      timeoutMs: 25000,
      predicate: (payload) => String(payload?.bookingId || payload?.rideId || '') === String(booking.bookingId),
      errorPredicate: (payload = {}) => {
        const eventBookingId = String(payload?.bookingId || payload?.rideId || '');
        if (!eventBookingId) return true;
        return eventBookingId === String(booking.bookingId);
      }
    });
    const passengerStarted = await passenger.waitForEvent('tripStarted', 15000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    if (VISUAL_TRIP_START_HOLD_MS > 0) {
      await sleep(VISUAL_TRIP_START_HOLD_MS);
    }
    const tripNavigationPreview = [0.12, 0.28].map((ratio) =>
      interpolateCoordinate(PICKUP, DESTINATION, ratio),
    );
    for (const coordinate of tripNavigationPreview) {
      reportedDriverHeading = calculateHeadingDegrees(reportedDriverCoordinate, coordinate);
      reportedDriverCoordinate = coordinate;
      driver.socket.emit('updateTripLocation', {
        bookingId: booking.bookingId,
        lat: coordinate.lat,
        lng: coordinate.lng,
        heading: reportedDriverHeading,
        speed: 10,
      });
      await sleep(Math.max(250, Math.round(VISUAL_TRIP_START_HOLD_MS / Math.max(1, tripNavigationPreview.length))));
    }

    const lockedFare = payment.amountInCents / 100;
    const completionDistanceKm = Number(quote.routeDistanceKm || 0) > 0 ? Number(quote.routeDistanceKm) : 1.31;
    const completionDurationSecs = Number(quote.routeDurationSecs || 0) > 0 ? Number(quote.routeDurationSecs) : 168;
    const completionPayload = {
      bookingId: booking.bookingId,
      endLocation: { lat: DESTINATION.lat, lng: DESTINATION.lng },
      fare: lockedFare,
      distance: completionDistanceKm,
      duration: completionDurationSecs
    };

    const completed = await emitAndWait(driver, {
      emitEvent: 'completeTrip',
      emitPayload: completionPayload,
      successEvent: 'tripCompleted',
      errorEvent: 'tripCompleteError',
      timeoutMs: 30000,
      predicate: (payload) => String(payload?.bookingId || payload?.rideId || '') === String(booking.bookingId),
      errorPredicate: (payload = {}) => {
        const eventBookingId = String(payload?.bookingId || payload?.rideId || '');
        if (!eventBookingId) return true;
        return eventBookingId === String(booking.bookingId);
      }
    });
    const passengerCompleted = await passenger.waitForEvent('tripCompleted', 20000, (payload) => (payload?.bookingId || payload?.rideId) === booking.bookingId);

    passenger.socket.emit('submitRating', { tripId: booking.bookingId, bookingId: booking.bookingId, customerId: PASSENGER_UID, driverId: DRIVER_UID, rating: 5, comment: 'ok' });
    const ratingResult = await Promise.race([
      passenger.waitForEvent('ratingSubmitted', 10000, (payload) => payload?.tripId === booking.bookingId || payload?.bookingId === booking.bookingId),
      passenger.waitForEvent('ratingError', 10000, () => true)
    ]).catch(() => null);

    report.flow = {
      ...report.flow,
      newRideRequest,
      accepted,
      arrived,
      started,
      passengerStarted,
      completionPayload,
      completed,
      passengerCompleted,
      ratingResult
    };
    report.status = 'success';
    report.meta.finishedAt = new Date().toISOString();
  } catch (error) {
    report.status = 'failed';
    report.meta.finishedAt = new Date().toISOString();
    report.meta.error = error.message;
    report.meta.stack = error.stack;
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    try { passenger.disconnect(); } catch (_error) {}
    try { driver.disconnect(); } catch (_error) {}
    writeReport(report, reportPath);
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'success') process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

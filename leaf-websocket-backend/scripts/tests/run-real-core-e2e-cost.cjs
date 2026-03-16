#!/usr/bin/env node

/**
 * Real core end-to-end simulation with cost accounting.
 *
 * Flow:
 * 1) Create passenger + driver records in Redis (and Firebase when available)
 * 2) createBooking -> confirmPayment (mock) -> notify driver
 * 3) Simulate driver movement to pickup (persist coordinates)
 * 4) Chat exchange (6 messages)
 * 5) startTrip -> trip movement coordinates (persist)
 * 6) completeTrip (mock payment distribution)
 * 7) Persist final ride snapshot
 * 8) Generate receipt + PDF
 * 9) Submit and receive rating
 * 10) Collect before/after metrics and compute deltas
 */

const fs = require('fs');
const path = require('path');

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../../tests/e2e/backend/__helpers__/redis-driver-simulator');
const redisPool = require('../../utils/redis-pool');
const firebaseConfig = require('../../firebase-config');
const ReceiptService = require('../../services/receipt-service');

const SERVER_URL = process.env.REAL_CORE_SERVER_URL || process.env.WS_URL || 'http://127.0.0.1:3001';
const REPORT_DIR = path.join(__dirname, '../../reports');
const nowTag = Date.now();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryWaitForEvent(client, eventName, timeout, predicate = null) {
  try {
    const data = await client.waitForEvent(eventName, timeout, predicate);
    return { ok: true, event: eventName, data };
  } catch (error) {
    return { ok: false, event: eventName, error: error.message };
  }
}

function buildLinePoints(start, end, count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 1 : i / (count - 1);
    const lat = start.lat + (end.lat - start.lat) * t;
    const lng = start.lng + (end.lng - start.lng) * t;
    points.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
  }
  return points;
}

function parseLabelString(raw = '') {
  if (!raw) return {};
  const labels = {};
  const re = /(\w+)="((?:\\.|[^"])*)"/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    labels[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return labels;
}

function parsePrometheusText(text) {
  const rows = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const withLabels = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([-+eE0-9.]+)$/);
    if (withLabels) {
      rows.push({
        metric: withLabels[1],
        labels: parseLabelString(withLabels[2]),
        value: Number(withLabels[3])
      });
      continue;
    }

    const plain = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([-+eE0-9.]+)$/);
    if (plain) {
      rows.push({ metric: plain[1], labels: {}, value: Number(plain[2]) });
    }
  }
  return rows;
}

function sumMetric(rows, metricName, matchLabels = {}) {
  return rows
    .filter((row) => row.metric === metricName)
    .filter((row) => Object.entries(matchLabels).every(([k, v]) => row.labels[k] === v))
    .reduce((acc, row) => acc + (Number.isFinite(row.value) ? row.value : 0), 0);
}

function metricDelta(beforeRows, afterRows, metricName, labels = {}) {
  const before = sumMetric(beforeRows, metricName, labels);
  const after = sumMetric(afterRows, metricName, labels);
  return Number((after - before).toFixed(6));
}

async function fetchMetricsRows(baseUrl) {
  const res = await fetch(`${baseUrl}/metrics`);
  if (!res.ok) {
    throw new Error(`Falha ao ler /metrics: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parsePrometheusText(text);
}

function normalizeBookingLocation(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function toIsoTimestamp(value, fallbackIso) {
  if (!value) return fallbackIso;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  const str = String(value).trim();
  if (!str) return fallbackIso;

  const asNumber = Number.parseInt(str, 10);
  if (Number.isFinite(asNumber) && String(asNumber) === str) {
    const fromMs = new Date(asNumber);
    if (!Number.isNaN(fromMs.getTime())) return fromMs.toISOString();
  }

  const fromText = new Date(str);
  if (!Number.isNaN(fromText.getTime())) return fromText.toISOString();
  return fallbackIso;
}

async function main() {
  const report = {
    meta: {
      scenario: 'real_core_e2e_cost',
      startedAt: new Date().toISOString(),
      serverUrl: SERVER_URL,
      mode: 'local_real_execution',
      paymentMode: 'mock_bypass_only'
    },
    entities: {},
    flow: {
      steps: [],
      chatMessages: [],
      pickupCoordinates: [],
      tripCoordinates: []
    },
    outputs: {},
    debug: {},
    metrics: {},
    cost: {}
  };

  const passengerId = `real_passenger_${nowTag}`;
  const driverId = `real_driver_${nowTag}`;

  const pickup = { lat: -23.5505, lng: -46.6333, address: 'Av. Paulista, 1000 - São Paulo, SP' };
  const destination = { lat: -23.5615, lng: -46.6553, address: 'Rua Oscar Freire, 1000 - São Paulo, SP' };
  const driverStart = { lat: -23.547, lng: -46.628 };

  report.entities = {
    passengerId,
    driverId,
    pickup,
    destination,
    driverStart
  };

  const metricsBefore = await fetchMetricsRows(SERVER_URL);

  const redis = redisPool.getConnection();
  const simulator = new RedisDriverSimulator();

  const passengerClient = new WebSocketTestClient(SERVER_URL);
  const driverClient = new WebSocketTestClient(SERVER_URL);

  let bookingId = null;

  try {
    // 1) Create users in DB (Redis + optional Firebase)
    await redis.hset(`user:${passengerId}`, {
      id: passengerId,
      firstName: 'Passageiro',
      lastName: 'Core',
      userType: 'customer',
      isActive: 'true',
      createdAt: new Date().toISOString()
    });

    await redis.hset(`driver:${driverId}`, {
      id: driverId,
      firstName: 'Motorista',
      lastName: 'Core',
      userType: 'driver',
      status: 'AVAILABLE',
      isOnline: 'true',
      createdAt: new Date().toISOString(),
      rating: '5.0'
    });

    const realtimeDb = firebaseConfig.getRealtimeDB();
    if (realtimeDb) {
      await realtimeDb.ref(`users/${passengerId}`).set({
        id: passengerId,
        firstName: 'Passageiro',
        lastName: 'Core',
        userType: 'customer',
        createdAt: new Date().toISOString()
      });
      await realtimeDb.ref(`drivers/${driverId}`).set({
        id: driverId,
        firstName: 'Motorista',
        lastName: 'Core',
        userType: 'driver',
        status: 'AVAILABLE',
        createdAt: new Date().toISOString()
      });
    }
    report.flow.steps.push({ step: 'create_users', ok: true });

    // 2) Connect/auth
    await passengerClient.connect();
    await driverClient.connect();

    await passengerClient.authenticate(passengerId, 'customer');
    await driverClient.authenticate(driverId, 'driver');

    await simulator.setDriverOnline(driverId, driverStart.lat, driverStart.lng, 0, 0, true, false);
    report.flow.steps.push({ step: 'connect_and_auth', ok: true });

    // 3) Create booking + confirm payment mock
    const bookingResponse = await passengerClient.createBooking({
      customerId: passengerId,
      pickupLocation: pickup,
      destinationLocation: destination,
      estimatedFare: 42.5,
      paymentMethod: 'pix',
      carType: 'normal'
    });

    bookingId = bookingResponse.bookingId;
    report.outputs.booking = bookingResponse;

    const paymentResponse = await passengerClient.confirmPayment({
      bookingId,
      paymentMethod: 'pix',
      paymentId: `mock_payment_${nowTag}`,
      amount: 42.5,
      mockPayment: true,
      __mockPayment: true
    });
    report.outputs.payment = paymentResponse;

    const rideRequestForDriver = await tryWaitForEvent(
      driverClient,
      'newRideRequest',
      15000,
      (evt) => (evt?.bookingId || evt?.rideId) === bookingId
    );
    report.outputs.rideRequestForDriver = rideRequestForDriver.ok ? rideRequestForDriver.data : null;
    report.debug.newRideRequest = rideRequestForDriver;
    report.flow.steps.push({ step: 'booking_and_payment', ok: true, bookingId });

    // 4) Driver displacement to pickup + persist coords
    const pickupPoints = buildLinePoints(driverStart, pickup, 6);
    for (let i = 0; i < pickupPoints.length; i += 1) {
      const point = pickupPoints[i];
      const payload = {
        driverId,
        lat: point.lat,
        lng: point.lng,
        heading: 90,
        speed: i === pickupPoints.length - 1 ? 0 : 28,
        bookingId,
        timestamp: Date.now()
      };

      driverClient.socket.emit('updateDriverLocation', payload);
      await redis.rpush(`trip:coords:${bookingId}:pickup`, JSON.stringify(payload));
      report.flow.pickupCoordinates.push(payload);
      await sleep(350);
    }

    await driverClient.acceptRide(bookingId);
    await passengerClient.waitForEvent('rideAccepted', 15000, (evt) => (evt?.bookingId || evt?.rideId) === bookingId);
    const activeBookingAfterAccept = await redis.hget('bookings:active', bookingId);
    report.debug.bookingStateAfterAccept = {
      bookingHash: await redis.hgetall(`booking:${bookingId}`),
      activeBooking: activeBookingAfterAccept ? JSON.parse(activeBookingAfterAccept) : null
    };
    report.flow.steps.push({ step: 'driver_to_pickup_and_accept', ok: true });

    // Open trip chat with retries, because chat policy may lag a few seconds after acceptRide.
    let chatCreationAck = null;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      passengerClient.socket.emit('createChat', {
        bookingId,
        participants: [passengerId, driverId],
        type: 'trip_chat'
      });

      // Allow socket handlers to process and populate event history before waiting.
      await sleep(120);

      const created = await tryWaitForEvent(
        passengerClient,
        'chatCreated',
        1500,
        (evt) => evt?.bookingId === bookingId || evt?.chatId === bookingId
      );
      if (created.ok) {
        chatCreationAck = { ...created, attempt };
        break;
      }

      const chatError = await tryWaitForEvent(
        passengerClient,
        'chatError',
        1000,
        (evt) => (evt?.bookingId || evt?.chatId) === bookingId || !evt?.bookingId
      );
      chatCreationAck = { ...chatError, attempt };
      await sleep(700);
    }
    report.debug.chatCreation = chatCreationAck;
    if (!chatCreationAck?.ok || chatCreationAck?.event !== 'chatCreated') {
      throw new Error(`Falha ao criar chat: ${chatCreationAck?.data?.error || chatCreationAck?.error || 'sem ack'}`);
    }

    // 5) 6 chat messages (real socket events)
    const chatScript = [
      { from: 'passenger', text: 'Oi! Estou no portão principal.' },
      { from: 'driver', text: 'Perfeito, chego em 2 minutos.' },
      { from: 'passenger', text: 'Vou ficar de camisa azul.' },
      { from: 'driver', text: 'Vi você no mapa, já estou na esquina.' },
      { from: 'passenger', text: 'Beleza, te vi chegando.' },
      { from: 'driver', text: 'Pode entrar, estou de Civic prata.' }
    ];

    for (const msg of chatScript) {
      const senderClient = msg.from === 'passenger' ? passengerClient : driverClient;
      const senderId = msg.from === 'passenger' ? passengerId : driverId;
      const receiverId = msg.from === 'passenger' ? driverId : passengerId;
      const senderType = msg.from === 'passenger' ? 'passenger' : 'driver';

      senderClient.socket.emit('sendMessage', {
        bookingId,
        senderId,
        receiverId,
        senderType,
        message: msg.text
      });

      const receiverClient = msg.from === 'passenger' ? driverClient : passengerClient;
      const sendAck = await Promise.race([
        tryWaitForEvent(senderClient, 'messageSent', 12000, (evt) => evt?.bookingId === bookingId && evt?.text === msg.text),
        tryWaitForEvent(senderClient, 'messageError', 12000, () => true),
        tryWaitForEvent(receiverClient, 'newMessage', 12000, (evt) => evt?.bookingId === bookingId && evt?.message === msg.text)
      ]);

      if (!sendAck?.ok && sendAck?.event !== 'newMessage') {
        throw new Error(`Falha ao enviar mensagem de chat: ${sendAck?.error || 'ack ausente'}`);
      }
      if (sendAck?.ok && sendAck?.event === 'messageError') {
        throw new Error(`Falha ao enviar mensagem de chat: ${sendAck.data?.error || 'messageError'}`);
      }

      report.flow.chatMessages.push({ from: msg.from, text: msg.text, at: new Date().toISOString() });
      await sleep(200);
    }

    report.flow.steps.push({ step: 'chat_6_messages', ok: true, total: report.flow.chatMessages.length });

    // 6) Start trip + ride coordinates
    await driverClient.startTrip({ bookingId, startLocation: pickup });
    await passengerClient.waitForEvent('tripStarted', 15000, (evt) => (evt?.bookingId || evt?.rideId) === bookingId);

    const tripPoints = buildLinePoints(pickup, destination, 9);
    for (let i = 0; i < tripPoints.length; i += 1) {
      const point = tripPoints[i];
      const payload = {
        bookingId,
        driverId,
        lat: point.lat,
        lng: point.lng,
        heading: 95,
        speed: i === tripPoints.length - 1 ? 0 : 36,
        timestamp: Date.now()
      };

      driverClient.socket.emit('updateTripLocation', payload);
      driverClient.socket.emit('updateDriverLocation', payload);
      await redis.rpush(`trip:coords:${bookingId}:trip`, JSON.stringify(payload));
      report.flow.tripCoordinates.push(payload);
      await sleep(300);
    }

    report.flow.steps.push({ step: 'trip_coordinates_persisted', ok: true, total: report.flow.tripCoordinates.length });

    // 7) Complete trip
    const completeResponse = await driverClient.finishTrip({
      bookingId,
      endLocation: destination,
      distance: 6.4,
      fare: 42.5,
      mockPayment: true,
      __mockPayment: true
    });

    const tripCompletedPassenger = await passengerClient.waitForEvent('tripCompleted', 20000, (evt) => evt?.bookingId === bookingId);
    const tripCompletedDriver = await driverClient.waitForEvent('tripCompleted', 20000, (evt) => evt?.bookingId === bookingId);

    report.outputs.completeTrip = completeResponse;
    report.outputs.tripCompletedPassenger = tripCompletedPassenger;
    report.outputs.tripCompletedDriver = tripCompletedDriver;
    report.flow.steps.push({ step: 'complete_trip', ok: true });

    // 8) Persist final ride snapshot
    const bookingHash = await redis.hgetall(`booking:${bookingId}`);
    const pickupSaved = normalizeBookingLocation(bookingHash.pickupLocation) || pickup;
    const dropSaved = normalizeBookingLocation(bookingHash.destinationLocation || bookingHash.drop) || destination;

    const finalSnapshot = {
      bookingId,
      passengerId,
      driverId,
      status: bookingHash.status || 'COMPLETED',
      fare: Number(bookingHash.finalFare || 42.5),
      distanceKm: Number(bookingHash.distance || 6.4),
      chatMessages: report.flow.chatMessages.length,
      pickupCoordsCount: report.flow.pickupCoordinates.length,
      tripCoordsCount: report.flow.tripCoordinates.length,
      completedAt: new Date().toISOString()
    };

    await redis.hset(`trip:summary:${bookingId}`, Object.fromEntries(Object.entries(finalSnapshot).map(([k, v]) => [k, String(v)])));

    const realtimeDb2 = firebaseConfig.getRealtimeDB();
    if (realtimeDb2) {
      await realtimeDb2.ref(`rides/${bookingId}/simulation`).set(finalSnapshot);
    }

    report.outputs.finalSnapshot = finalSnapshot;
    report.flow.steps.push({ step: 'persist_final_ride_data', ok: true });

    // 9) Emit receipt (generate + PDF)
    const receiptService = new ReceiptService();
    const nowIso = new Date().toISOString();
    const bookingDateIso = toIsoTimestamp(
      bookingHash.createdAt || bookingHash.timestamp || bookingHash.created_at,
      nowIso
    );
    const tripStartIso = toIsoTimestamp(
      bookingHash.tripStartTime || bookingHash.startedAt || bookingHash.startTime || bookingHash.started_at || bookingDateIso,
      bookingDateIso
    );
    const tripEndIso = toIsoTimestamp(
      bookingHash.endTime || bookingHash.completedAt || bookingHash.endedAt || nowIso,
      nowIso
    );

    const receiptData = {
      ...bookingHash,
      pickup: {
        add: pickupSaved?.address || pickupSaved?.add || pickup.address,
        lat: pickupSaved?.lat || pickup.lat,
        lng: pickupSaved?.lng || pickup.lng
      },
      drop: {
        add: dropSaved?.address || dropSaved?.add || destination.address,
        lat: dropSaved?.lat || destination.lat,
        lng: dropSaved?.lng || destination.lng
      },
      customer: passengerId,
      driver: driverId,
      customer_name: 'Passageiro Core',
      driver_name: 'Motorista Core',
      finalPrice: 42.5,
      distance: 6400,
      payment_mode: 'pix',
      payment_status: 'completed',
      bookingDate: bookingDateIso,
      tripStartTime: tripStartIso,
      endTime: tripEndIso,
      completedAt: tripEndIso,
      paymentDate: tripEndIso,
      status: 'COMPLETED'
    };

    const receipt = await receiptService.generateAndSaveReceipt(bookingId, receiptData, realtimeDb2);
    const receiptPdf = await receiptService.generatePDFReceipt(receipt);

    report.outputs.receipt = {
      receiptId: receipt.receiptId,
      hash: receipt.hash,
      totalPaid: receipt.financial?.totalPaid?.formatted || null,
      pdfBytes: receiptPdf.length
    };
    report.flow.steps.push({ step: 'receipt_generated', ok: true });

    // 10) Submit rating and verify receiving side
    passengerClient.socket.emit('submitRating', {
      tripId: bookingId,
      bookingId,
      rating: 5,
      comment: 'Corrida excelente, motorista muito atencioso.',
      driverId,
      userId: passengerId,
      userType: 'passenger'
    });

    const ratingSubmitted = await passengerClient.waitForEvent('ratingSubmitted', 15000, (evt) => evt?.tripId === bookingId && evt?.success === true);
    const ratingReceived = await driverClient.waitForEvent('ratingReceived', 15000, (evt) => evt?.tripId === bookingId && evt?.success === true);

    report.outputs.rating = {
      submitted: ratingSubmitted,
      received: ratingReceived
    };
    report.flow.steps.push({ step: 'rating_submitted_and_received', ok: true });

    // 11) Metrics delta
    const metricsAfter = await fetchMetricsRows(SERVER_URL);

    const redisOps = ['hset', 'hgetall', 'geoadd', 'georadius', 'zrem', 'expire', 'set', 'get', 'del', 'xadd', 'zadd'];
    const redisDelta = redisOps
      .map((op) => ({
        operation: op,
        successCount: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_count', { operation: op, status: 'success' }),
        failureCount: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_count', { operation: op, status: 'failure' }),
        totalDurationSeconds: metricDelta(metricsBefore, metricsAfter, 'leaf_redis_duration_seconds_sum', { operation: op, status: 'success' })
      }))
      .filter((row) => row.successCount !== 0 || row.failureCount !== 0);

    const commands = ['request_ride', 'accept_ride', 'start_trip', 'complete_trip'];
    const commandDelta = commands
      .map((cmd) => ({
        command: cmd,
        successCount: metricDelta(metricsBefore, metricsAfter, 'leaf_command_total', { command_name: cmd, status: 'success' }),
        failureCount: metricDelta(metricsBefore, metricsAfter, 'leaf_command_total', { command_name: cmd, status: 'failure' }),
        durationSeconds: metricDelta(metricsBefore, metricsAfter, 'leaf_command_duration_seconds_sum', { command_name: cmd, status: 'success' })
      }))
      .filter((row) => row.successCount !== 0 || row.failureCount !== 0);

    const eventPublishedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_event_published_total', {});
    const eventConsumedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_event_consumed_total', {});

    const ridesRequestedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_requested_total', {});
    const ridesAcceptedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_accepted_total', {});
    const ridesCompletedDelta = metricDelta(metricsBefore, metricsAfter, 'leaf_rides_completed_total', {});

    report.metrics = {
      redis: redisDelta,
      commands: commandDelta,
      events: {
        publishedTotalDelta: eventPublishedDelta,
        consumedTotalDelta: eventConsumedDelta
      },
      rides: {
        requestedDelta: ridesRequestedDelta,
        acceptedDelta: ridesAcceptedDelta,
        completedDelta: ridesCompletedDelta
      },
      apiCalls: {
        websocket: {
          createBooking: 1,
          confirmPayment: 1,
          updateDriverLocation: report.flow.pickupCoordinates.length + report.flow.tripCoordinates.length,
          sendMessage: report.flow.chatMessages.length,
          startTrip: 1,
          updateTripLocation: report.flow.tripCoordinates.length,
          completeTrip: 1,
          submitRating: 1
        },
        http: {
          metricsScrapes: 2,
          otherCoreCalls: 0
        },
        externalProvidersObserved: {
          googlePlaces: 0,
          googleDirections: 0,
          woovi: 0,
          notes: 'Execucao usou coordenadas predefinidas + pagamento mock.'
        }
      }
    };

    // Local execution monetary cost is effectively zero for provider billing.
    report.cost = {
      executionCurrency: 'BRL',
      localExecution: {
        providerBillableCost: 0,
        description: 'Execucao local com Redis/backend locais e pagamento mock.'
      },
      technicalConsumptionSummary: {
        redisSuccessfulOps: redisDelta.reduce((acc, item) => acc + item.successCount, 0),
        redisDurationSeconds: Number(redisDelta.reduce((acc, item) => acc + item.totalDurationSeconds, 0).toFixed(6)),
        commandSuccess: commandDelta.reduce((acc, item) => acc + item.successCount, 0),
        commandDurationSeconds: Number(commandDelta.reduce((acc, item) => acc + item.durationSeconds, 0).toFixed(6)),
        wsMessages: report.flow.chatMessages.length,
        pickupCoordinatesPersisted: report.flow.pickupCoordinates.length,
        tripCoordinatesPersisted: report.flow.tripCoordinates.length
      }
    };

    report.meta.finishedAt = new Date().toISOString();
    report.meta.status = 'success';
  } catch (error) {
    report.meta.finishedAt = new Date().toISOString();
    report.meta.status = 'failed';
    report.meta.error = error.message;
    report.meta.stack = error.stack;
  } finally {
    try {
      if (bookingId) {
        await redis.expire(`trip:coords:${bookingId}:pickup`, 86400);
        await redis.expire(`trip:coords:${bookingId}:trip`, 86400);
        await redis.expire(`trip:summary:${bookingId}`, 86400);
      }
    } catch (_e) {
      // ignore cleanup errors
    }

    passengerClient.disconnect();
    driverClient.disconnect();
  }

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  const reportFile = path.join(REPORT_DIR, `real-core-e2e-cost-${nowTag}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    reportFile,
    status: report.meta.status,
    bookingId: report.outputs?.booking?.bookingId || null,
    passengerId: report.entities?.passengerId,
    driverId: report.entities?.driverId,
    redisOps: report.cost?.technicalConsumptionSummary?.redisSuccessfulOps || 0,
    commandSuccess: report.cost?.technicalConsumptionSummary?.commandSuccess || 0
  }, null, 2));

  if (report.meta.status !== 'success') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

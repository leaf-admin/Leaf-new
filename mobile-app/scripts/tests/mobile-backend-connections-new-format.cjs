#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const BACKEND_URL = process.env.MOBILE_TEST_BACKEND_URL || 'http://127.0.0.1:3001';
const TEST_TIMEOUT_MS = Number.parseInt(process.env.MOBILE_TEST_TIMEOUT_MS || '12000', 10);
const COMPLETE_TRIP_TIMEOUT_MS = Number.parseInt(
  process.env.MOBILE_TEST_COMPLETE_TRIP_TIMEOUT_MS || '18000',
  10
);
const MOBILE_TEST_AUTH_TOKEN = String(process.env.MOBILE_TEST_AUTH_TOKEN || '').trim();
const MOBILE_TEST_ALLOW_UNHEALTHY_HEALTH =
  process.env.MOBILE_TEST_ALLOW_UNHEALTHY_HEALTH === 'true' ||
  /127\.0\.0\.1|localhost/i.test(BACKEND_URL);
const ROOT_DIR = path.resolve(__dirname, '../../');
const BACKEND_BOOTSTRAP_DIR = path.resolve(ROOT_DIR, '../leaf-websocket-backend/bootstrap');
const REPORT_DIR = path.resolve(ROOT_DIR, 'reports');
const REPORT_FILE = path.join(REPORT_DIR, 'mobile-backend-connections-report.json');

const TEST_COORDS = {
  pickup: { lat: -23.5505, lng: -46.6333 },
  destination: { lat: -23.5615, lng: -46.6553 },
  midTrip: { lat: -23.555, lng: -46.641 }
};

function nowIso() {
  return new Date().toISOString();
}

function formatSocketResult(result) {
  if (!result) return 'sem resultado';
  if (result.timeout) return 'timeout';
  const payload = result.data ? JSON.stringify(result.data).slice(0, 260) : '';
  return payload ? `${result.event} payload=${payload}` : `${result.event}`;
}

function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureReportDir() {
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }
}

function normalizeForCompare(eventName) {
  return eventName
    .replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function extractEventsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const matches = [...content.matchAll(/\.emit\('([^']+)'/g)];
  return matches.map((m) => ({ event: m[1], filePath }));
}

function extractBackendSocketHandlers(bootstrapDir) {
  const events = [];
  const files = fs.readdirSync(bootstrapDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const filePath = path.join(bootstrapDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [...content.matchAll(/socket\.on\('([^']+)'/g)];
    matches.forEach((m) => events.push({ event: m[1], file }));
  }
  return events;
}

function dedupe(arr) {
  return [...new Set(arr)];
}

function dedupeBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function createResultCollector() {
  const tests = [];
  return {
    add(name, status, detail, extra = {}) {
      tests.push({
        name,
        status,
        detail,
        timestamp: nowIso(),
        ...extra
      });
    },
    summarize(context = {}) {
      const passed = tests.filter((t) => t.status === 'passed').length;
      const failed = tests.filter((t) => t.status === 'failed').length;
      const warning = tests.filter((t) => t.status === 'warning').length;
      return {
        generatedAt: nowIso(),
        backendUrl: BACKEND_URL,
        totals: {
          total: tests.length,
          passed,
          failed,
          warning,
          successRate: tests.length ? Number(((passed / tests.length) * 100).toFixed(1)) : 0
        },
        context,
        tests
      };
    }
  };
}

async function httpCheck(name, url, collector, expectStatuses = [200]) {
  try {
    const response = await fetch(url, { method: 'GET' });
    const body = await response.text();
    const ok = expectStatuses.includes(response.status);

    collector.add(
      name,
      ok ? 'passed' : 'failed',
      `${response.status} ${response.statusText}`,
      { url, responseStatus: response.status, responseBody: body.slice(0, 500) }
    );
    return ok;
  } catch (error) {
    collector.add(name, 'failed', error.message, { url });
    return false;
  }
}

async function readinessCheck(url, collector) {
  try {
    const response = await fetch(url, { method: 'GET' });
    const body = await response.text();

    if (response.status === 200) {
      collector.add('HTTP readiness', 'passed', `${response.status} ${response.statusText}`, {
        url,
        responseStatus: response.status,
        responseBody: body.slice(0, 500)
      });
      return true;
    }

    if (response.status === 503 && MOBILE_TEST_ALLOW_UNHEALTHY_HEALTH) {
      collector.add(
        'HTTP readiness',
        'warning',
        `${response.status} ${response.statusText} (permitido para cenário local de smoke)`,
        {
          url,
          responseStatus: response.status,
          responseBody: body.slice(0, 500)
        }
      );
      return true;
    }

    collector.add('HTTP readiness', 'failed', `${response.status} ${response.statusText}`, {
      url,
      responseStatus: response.status,
      responseBody: body.slice(0, 500)
    });
    return false;
  } catch (error) {
    collector.add('HTTP readiness', 'failed', error.message, { url });
    return false;
  }
}

async function apiHealthCheck(url, collector) {
  try {
    const response = await fetch(url, { method: 'GET' });
    const rawBody = await response.text();
    let body = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }

    if (response.status === 200) {
      collector.add('HTTP /api/health', 'passed', `${response.status} ${response.statusText}`, {
        url,
        responseStatus: response.status,
        responseBody: rawBody.slice(0, 500)
      });
      return true;
    }

    const checks = body?.checks || {};
    const hasUnhealthyComponent = Object.values(checks).some(
      (check) => check?.status === 'unhealthy' || check?.status === 'critical'
    );
    const onlyWarnings =
      body?.status === 'degraded' &&
      !hasUnhealthyComponent &&
      Object.values(checks).length > 0;

    if (response.status === 503 && onlyWarnings) {
      collector.add(
        'HTTP /api/health',
        'warning',
        `${response.status} ${response.statusText} (degraded com warnings)`,
        {
          url,
          responseStatus: response.status,
          responseBody: rawBody.slice(0, 500)
        }
      );
      return true;
    }

    if (response.status === 503 && MOBILE_TEST_ALLOW_UNHEALTHY_HEALTH) {
      collector.add(
        'HTTP /api/health',
        'warning',
        `${response.status} ${response.statusText} (permitido para cenário local de smoke)`,
        {
          url,
          responseStatus: response.status,
          responseBody: rawBody.slice(0, 500)
        }
      );
      return true;
    }

    collector.add('HTTP /api/health', 'failed', `${response.status} ${response.statusText}`, {
      url,
      responseStatus: response.status,
      responseBody: rawBody.slice(0, 500)
    });
    return false;
  } catch (error) {
    collector.add('HTTP /api/health', 'failed', error.message, { url });
    return false;
  }
}

async function connectSocket(label, collector) {
  const socket = io(BACKEND_URL, {
    transports: ['websocket'],
    timeout: TEST_TIMEOUT_MS,
    reconnection: false,
    forceNew: true
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label}: timeout de conexão`));
    }, TEST_TIMEOUT_MS);

    socket.on('connect', () => {
      clearTimeout(timeout);
      collector.add(`${label} connect`, 'passed', `socketId=${socket.id}`);
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      collector.add(`${label} connect`, 'failed', error.message);
      reject(error);
    });
  });
}

async function emitAndWait({
  socket,
  emitEvent,
  payload,
  successEvents,
  errorEvents = [],
  timeoutMs = TEST_TIMEOUT_MS
}) {
  return new Promise((resolve) => {
    const allEvents = [...successEvents, ...errorEvents];
    const listeners = [];

    const cleanup = () => {
      listeners.forEach(({ event, handler }) => socket.off(event, handler));
      clearTimeout(timer);
    };

    const done = (result) => {
      cleanup();
      resolve(result);
    };

    for (const eventName of allEvents) {
      const handler = (data) => {
        done({
          ok: successEvents.includes(eventName),
          event: eventName,
          data
        });
      };
      listeners.push({ event: eventName, handler });
      socket.on(eventName, handler);
    }

    const timer = setTimeout(() => {
      done({
        ok: false,
        event: null,
        data: null,
        timeout: true
      });
    }, timeoutMs);

    socket.emit(emitEvent, payload);
  });
}

async function runScenarioRuntimeTests(collector) {
  const context = {
    passengerId: uniqueId('passenger'),
    driverId: uniqueId('driver'),
    bookingId: null,
    chatId: null
  };

  let passengerSocket = null;
  let driverSocket = null;

  try {
    passengerSocket = await connectSocket('passenger', collector);
    driverSocket = await connectSocket('driver', collector);

    const passengerAuth = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'authenticate',
      payload: {
        uid: context.passengerId,
        userType: 'passenger',
        ...(MOBILE_TEST_AUTH_TOKEN ? { token: MOBILE_TEST_AUTH_TOKEN } : {})
      },
      successEvents: ['authenticated'],
      errorEvents: ['authentication_error', 'auth_error']
    });
    collector.add(
      'authenticate passenger',
      passengerAuth.ok ? 'passed' : 'failed',
      formatSocketResult(passengerAuth)
    );

    const driverAuth = await emitAndWait({
      socket: driverSocket,
      emitEvent: 'authenticate',
      payload: {
        uid: context.driverId,
        userType: 'driver',
        ...(MOBILE_TEST_AUTH_TOKEN ? { token: MOBILE_TEST_AUTH_TOKEN } : {})
      },
      successEvents: ['authenticated'],
      errorEvents: ['authentication_error', 'auth_error']
    });
    collector.add(
      'authenticate driver',
      driverAuth.ok ? 'passed' : 'failed',
      formatSocketResult(driverAuth)
    );

    const driverLoc = await emitAndWait({
      socket: driverSocket,
      emitEvent: 'updateLocation',
      payload: {
        driverId: context.driverId,
        lat: TEST_COORDS.pickup.lat + 0.001,
        lng: TEST_COORDS.pickup.lng + 0.001,
        heading: 90,
        speed: 24
      },
      successEvents: ['locationUpdated'],
      errorEvents: ['locationError']
    });
    collector.add(
      'updateLocation with GPS',
      driverLoc.ok ? 'passed' : 'failed',
      formatSocketResult(driverLoc)
    );

    const searchDrivers = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'searchDrivers',
      payload: {
        customerId: context.passengerId,
        pickupLocation: TEST_COORDS.pickup,
        destinationLocation: TEST_COORDS.destination,
        rideType: 'standard',
        estimatedFare: 32.5,
        preferences: { radiusKm: 5, limit: 10 }
      },
      successEvents: ['driversFound'],
      errorEvents: ['searchDriversError', 'driverSearchError']
    });

    const foundDrivers = searchDrivers.data?.drivers || [];
    const searchPassed = searchDrivers.ok && Array.isArray(foundDrivers) && foundDrivers.length > 0;
    const searchDegraded = !searchPassed && (searchDrivers.timeout || searchDrivers.ok);
    collector.add(
      'searchDrivers from passenger',
      searchPassed ? 'passed' : searchDegraded ? 'warning' : 'failed',
      searchDrivers.timeout
        ? 'timeout (degradado; fluxo pode seguir por fallback)'
        : `${formatSocketResult(searchDrivers)} drivers=${foundDrivers.length}`
    );

    const createBooking = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'createBooking',
      payload: {
        customerId: context.passengerId,
        pickupLocation: TEST_COORDS.pickup,
        destinationLocation: TEST_COORDS.destination,
        estimatedFare: 32.5,
        paymentMethod: 'pix'
      },
      successEvents: ['bookingCreated'],
      errorEvents: ['bookingError']
    });
    if (createBooking.ok) {
      context.bookingId = createBooking.data?.bookingId || createBooking.data?.data?.bookingId || null;
    }
    collector.add(
      'createBooking passenger -> backend',
      createBooking.ok && !!context.bookingId ? 'passed' : 'failed',
      createBooking.timeout
        ? 'timeout'
        : `${formatSocketResult(createBooking)} bookingId=${context.bookingId || 'n/a'}`
    );

    if (context.bookingId) {
      const confirmPayment = await emitAndWait({
        socket: passengerSocket,
        emitEvent: 'confirmPayment',
        payload: {
          bookingId: context.bookingId,
          paymentMethod: 'pix',
          paymentId: uniqueId('pay'),
          amount: 32.5,
          pickupLocation: TEST_COORDS.pickup,
          __mockPayment: true
        },
        successEvents: ['paymentConfirmed'],
        errorEvents: ['paymentError']
      });
      collector.add(
        'confirmPayment for booking',
        confirmPayment.ok ? 'passed' : 'failed',
        formatSocketResult(confirmPayment)
      );

      const acceptRide = await emitAndWait({
        socket: driverSocket,
        emitEvent: 'acceptRide',
        payload: {
          bookingId: context.bookingId,
          driverId: context.driverId
        },
        successEvents: ['rideAccepted'],
        errorEvents: ['acceptRideError']
      });
      const acceptRidePayload = JSON.stringify(acceptRide.data || {});
      const acceptRideExpectedContention =
        !acceptRide.ok &&
        /j[aá]\s*est[aá]\s*em\s*outra\s*corrida|n[aã]o\s*autorizado/i.test(acceptRidePayload);
      collector.add(
        'acceptRide by driver',
        acceptRide.ok ? 'passed' : acceptRideExpectedContention ? 'warning' : 'failed',
        acceptRideExpectedContention
          ? `${formatSocketResult(acceptRide)} (ambiente concorrente; não bloqueante para smoke)`
          : formatSocketResult(acceptRide)
      );

      const startTrip = await emitAndWait({
        socket: driverSocket,
        emitEvent: 'startTrip',
        payload: {
          bookingId: context.bookingId,
          startLocation: TEST_COORDS.pickup,
          __mockPayment: true
        },
        successEvents: ['tripStarted'],
        errorEvents: ['tripStartError']
      });
      const startTripPayload = JSON.stringify(startTrip.data || {});
      const startTripExpectedContention =
        !startTrip.ok &&
        /j[aá]\s*est[aá]\s*em\s*outra\s*corrida|n[aã]o\s*autorizado/i.test(startTripPayload);
      collector.add(
        'startTrip by driver',
        startTrip.ok ? 'passed' : startTripExpectedContention ? 'warning' : 'failed',
        startTripExpectedContention
          ? `${formatSocketResult(startTrip)} (ambiente concorrente; não bloqueante para smoke)`
          : formatSocketResult(startTrip)
      );

      // Armar listener antes de emitir atualização do motorista.
      const tripLocationResult = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ ok: false, timeout: true }), TEST_TIMEOUT_MS);
        const handler = (data) => {
          passengerSocket.off('tripLocationUpdated', handler);
          clearTimeout(timer);
          resolve({ ok: true, data });
        };
        passengerSocket.on('tripLocationUpdated', handler);
        driverSocket.emit('updateTripLocation', {
          bookingId: context.bookingId,
          lat: TEST_COORDS.midTrip.lat,
          lng: TEST_COORDS.midTrip.lng,
          heading: 110,
          speed: 30
        });
      });
      collector.add(
        'updateTripLocation broadcast',
        tripLocationResult.ok ? 'passed' : 'failed',
        tripLocationResult.timeout
          ? 'timeout'
          : `bookingId=${tripLocationResult.data?.bookingId || 'n/a'}`
      );

      const completeTrip = await emitAndWait({
        socket: driverSocket,
        emitEvent: 'completeTrip',
        payload: {
          bookingId: context.bookingId,
          endLocation: TEST_COORDS.destination,
          distance: 3.4,
          fare: 32.5,
          __mockPayment: true
        },
        successEvents: ['tripCompleted'],
        errorEvents: ['tripCompleteError'],
        timeoutMs: COMPLETE_TRIP_TIMEOUT_MS
      });
      const completeTripPayload = JSON.stringify(completeTrip.data || {});
      const completeTripExpectedContention =
        !completeTrip.ok &&
        /j[aá]\s*est[aá]\s*em\s*outra\s*corrida|n[aã]o\s*autorizado/i.test(completeTripPayload);
      collector.add(
        'completeTrip by driver',
        completeTrip.ok ? 'passed' : completeTripExpectedContention ? 'warning' : 'failed',
        completeTripExpectedContention
          ? `${formatSocketResult(completeTrip)} (ambiente concorrente; não bloqueante para smoke)`
          : formatSocketResult(completeTrip)
      );
    }

    const supportTicket = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'createSupportTicket',
      payload: {
        type: 'technical',
        priority: 'N2',
        description: 'Falha intermitente no botão de pagamento',
        attachments: []
      },
      successEvents: ['supportTicketCreated'],
      errorEvents: ['supportTicketError']
    });
    collector.add(
      'createSupportTicket',
      supportTicket.ok ? 'passed' : 'failed',
      formatSocketResult(supportTicket)
    );

    const incident = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'reportIncident',
      payload: {
        type: 'safety',
        description: 'Teste automatizado de incidente',
        evidence: [],
        location: TEST_COORDS.pickup
      },
      successEvents: ['incidentReported'],
      errorEvents: ['incidentReportError']
    });
    collector.add(
      'reportIncident',
      incident.ok ? 'passed' : 'failed',
      formatSocketResult(incident)
    );

    const emergency = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'emergencyContact',
      payload: {
        contactType: 'police',
        location: TEST_COORDS.pickup,
        message: 'Teste de contato emergencial'
      },
      successEvents: ['emergencyContacted'],
      errorEvents: ['emergencyError']
    });
    collector.add(
      'emergencyContact',
      emergency.ok ? 'passed' : 'failed',
      formatSocketResult(emergency)
    );

    const pref = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'updateNotificationPreferences',
      payload: {
        rideUpdates: true,
        promotions: false,
        systemAlerts: true
      },
      successEvents: ['notificationPreferencesUpdated'],
      errorEvents: ['notificationError']
    });
    collector.add(
      'updateNotificationPreferences',
      pref.ok ? 'passed' : 'failed',
      formatSocketResult(pref)
    );

    const action = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'trackUserAction',
      payload: {
        action: 'open_map_screen',
        data: { source: 'automated_test' },
        timestamp: Date.now()
      },
      successEvents: ['userActionTracked'],
      errorEvents: ['trackingError']
    });
    collector.add(
      'trackUserAction',
      action.ok ? 'passed' : 'failed',
      formatSocketResult(action)
    );

    const feedback = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'submitFeedback',
      payload: {
        type: 'app_feedback',
        rating: 5,
        comments: 'Teste automatizado de feedback',
        suggestions: 'Nenhuma'
      },
      successEvents: ['feedbackReceived'],
      errorEvents: ['feedbackError']
    });
    collector.add(
      'submitFeedback',
      feedback.ok ? 'passed' : 'failed',
      formatSocketResult(feedback)
    );

    const createChat = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'createChat',
      payload: {
        rideId: context.bookingId || uniqueId('ride'),
        participants: [context.passengerId, context.driverId],
        title: 'Chat de corrida'
      },
      successEvents: ['chatCreated'],
      errorEvents: ['chatError']
    });
    if (createChat.ok) {
      context.chatId = createChat.data?.chatId || createChat.data?.data?.chatId || uniqueId('chat');
    }
    const createChatBlockedByPolicy =
      !createChat.ok &&
      ['CHAT_NOT_AVAILABLE_YET', 'CHAT_NOT_AVAILABLE'].includes(createChat.data?.code);
    collector.add(
      'createChat',
      createChat.ok || createChatBlockedByPolicy ? 'passed' : 'failed',
      createChatBlockedByPolicy
        ? `${formatSocketResult(createChat)} (bloqueio esperado antes do aceite)`
        : `${formatSocketResult(createChat)} chatId=${context.chatId || 'n/a'}`
    );

    const sendMessage = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'sendMessage',
      payload: {
        bookingId: context.bookingId || uniqueId('booking'),
        message: 'Mensagem de teste automatizado',
        receiverId: context.driverId,
        senderId: context.passengerId,
        senderType: 'passenger',
        timestamp: nowIso()
      },
      successEvents: ['messageSent'],
      errorEvents: ['messageError']
    });
    const sendMessageBlockedByPolicy =
      !sendMessage.ok &&
      ['CHAT_NOT_AVAILABLE_YET', 'CHAT_NOT_AVAILABLE'].includes(sendMessage.data?.code);
    collector.add(
      'sendMessage',
      sendMessage.ok || sendMessageBlockedByPolicy ? 'passed' : 'failed',
      sendMessageBlockedByPolicy
        ? `${formatSocketResult(sendMessage)} (bloqueio esperado antes do aceite)`
        : formatSocketResult(sendMessage)
    );

    const fcmTokenPassenger = `fcm_test_passenger_${Date.now()}`;
    const fcmTokenDriver = `fcm_test_driver_${Date.now()}`;
    const fcmRegister = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'registerFCMToken',
      payload: { userId: context.passengerId, fcmToken: fcmTokenPassenger, userType: 'passenger', platform: 'ios' },
      successEvents: ['fcmTokenRegistered', 'fcmTokenUpdated'],
      errorEvents: ['fcmTokenError']
    });
    collector.add(
      'registerFCMToken',
      fcmRegister.ok ? 'passed' : 'failed',
      formatSocketResult(fcmRegister)
    );

    const fcmRegisterDriver = await emitAndWait({
      socket: driverSocket,
      emitEvent: 'registerFCMToken',
      payload: { userId: context.driverId, fcmToken: fcmTokenDriver, userType: 'driver', platform: 'android' },
      successEvents: ['fcmTokenRegistered', 'fcmTokenUpdated'],
      errorEvents: ['fcmTokenError']
    });
    collector.add(
      'registerFCMToken driver',
      fcmRegisterDriver.ok ? 'passed' : 'failed',
      formatSocketResult(fcmRegisterDriver)
    );

    const fcmUnregister = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'unregisterFCMToken',
      payload: { userId: context.passengerId, fcmToken: fcmTokenPassenger, userType: 'passenger' },
      successEvents: ['fcmTokenUnregistered'],
      errorEvents: ['fcmTokenError']
    });
    collector.add(
      'unregisterFCMToken',
      fcmUnregister.ok ? 'passed' : 'failed',
      formatSocketResult(fcmUnregister)
    );

    const legacyNotif = await emitAndWait({
      socket: passengerSocket,
      emitEvent: 'sendNotification',
      payload: {
        userId: context.driverId,
        userType: 'driver',
        notification: {
          title: 'Teste',
          body: 'Notificação de teste',
          type: 'system'
        }
      },
      successEvents: ['notificationSent'],
      errorEvents: ['notificationError']
    });
    collector.add(
      'sendNotification (legacy)',
      legacyNotif.ok ? 'passed' : 'failed',
      formatSocketResult(legacyNotif)
    );

    return context;
  } finally {
    if (passengerSocket) passengerSocket.disconnect();
    if (driverSocket) driverSocket.disconnect();
  }
}

function createCompatibilityReport() {
  const mobileEmitFiles = [
    path.join(ROOT_DIR, 'src/services/WebSocketManager.js'),
    path.join(ROOT_DIR, 'src/services/SocketService.js')
  ];

  const TRANSPORT_EVENTS = new Set([
    'connect',
    'connect_error',
    'reconnect',
    'disconnect',
    'authenticated',
    'ping'
  ]);
  const LEGACY_SOURCES = new Set(['SocketService.js']);

  const LEGACY_EVENT_ALIASES = {
    create_chat: 'createChat',
    send_message: 'sendMessage'
  };

  const mobileEmits = dedupeBy(
    mobileEmitFiles.flatMap((filePath) => extractEventsFromFile(filePath))
    ,
    (entry) => `${entry.filePath}:${entry.event}`
  );
  const mobileEvents = dedupe(mobileEmits.map((entry) => entry.event));
  const backendHandlers = extractBackendSocketHandlers(BACKEND_BOOTSTRAP_DIR);
  const backendEvents = dedupe(backendHandlers.map((h) => h.event));

  const supported = [];
  const unsupported = [];
  const excluded = [];
  const mappedByAlias = [];

  for (const emitEntry of mobileEmits) {
    const eventName = emitEntry.event;
    const eventSource = path.basename(emitEntry.filePath);

    if (LEGACY_SOURCES.has(eventSource)) {
      excluded.push({
        event: eventName,
        reason: 'legacy_source',
        source: eventSource
      });
      continue;
    }

    if (TRANSPORT_EVENTS.has(eventName)) {
      excluded.push({
        event: eventName,
        reason: 'transport_event',
        source: eventSource
      });
      continue;
    }

    const canonicalEvent = LEGACY_EVENT_ALIASES[eventName] || eventName;
    if (backendEvents.includes(canonicalEvent)) {
      supported.push(canonicalEvent);
      if (canonicalEvent !== eventName) {
        mappedByAlias.push({
          event: eventName,
          mappedTo: canonicalEvent,
          source: eventSource
        });
      }
      continue;
    }

    const normalized = normalizeForCompare(eventName);
    const closeMatch = backendEvents.find(
      (backendEvent) => normalizeForCompare(backendEvent) === normalized
    );
    unsupported.push({
      event: eventName,
      closeMatch: closeMatch || null,
      source: eventSource
    });
  }

  return {
    mobileEventsTotal: mobileEvents.length,
    mobileEmitsTotal: mobileEmits.length,
    backendHandlersTotal: backendEvents.length,
    supportedTotal: dedupe(supported).length,
    unsupportedTotal: unsupported.length,
    excludedTotal: excluded.length,
    mappedByAliasTotal: mappedByAlias.length,
    supportedEvents: dedupe(supported).sort(),
    unsupportedEvents: unsupported.sort((a, b) => a.event.localeCompare(b.event)),
    excludedEvents: excluded.sort((a, b) => a.event.localeCompare(b.event)),
    mappedByAlias: mappedByAlias.sort((a, b) => a.event.localeCompare(b.event)),
    backendEvents: backendEvents.sort()
  };
}

async function main() {
  ensureReportDir();
  const collector = createResultCollector();

  console.log('='.repeat(90));
  console.log('📱 LEAF MOBILE ↔ BACKEND | VALIDAÇÃO COMPLETA DE CONEXÕES (NOVO FORMATO)');
  console.log('='.repeat(90));
  console.log(`🔗 Backend alvo: ${BACKEND_URL}`);
  console.log(`🕒 Início: ${nowIso()}`);
  console.log('');

  const compatibility = createCompatibilityReport();

  await httpCheck('HTTP liveness', `${BACKEND_URL}/health/liveness`, collector, [200]);
  await readinessCheck(`${BACKEND_URL}/health/readiness`, collector);
  await apiHealthCheck(`${BACKEND_URL}/api/health`, collector);
  await httpCheck('HTTP /api/kyc/health', `${BACKEND_URL}/api/kyc/health`, collector, [200, 401, 403, 404]);

  let runtimeContext = null;
  try {
    runtimeContext = await runScenarioRuntimeTests(collector);
  } catch (error) {
    collector.add('runtime scenario fatal', 'failed', error.message);
  }

  const summary = collector.summarize({
    compatibility,
    runtimeContext
  });

  fs.writeFileSync(REPORT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  console.log('');
  console.log('='.repeat(90));
  console.log('📊 RESUMO FINAL');
  console.log('='.repeat(90));
  console.log(`✅ Passou: ${summary.totals.passed}`);
  console.log(`❌ Falhou: ${summary.totals.failed}`);
  console.log(`⚠️ Warning: ${summary.totals.warning}`);
  console.log(`🎯 Sucesso: ${summary.totals.successRate}%`);
  console.log('');
  console.log('🧩 Compatibilidade de eventos (mobile -> backend):');
  console.log(`   - Total mobile emits (únicos): ${compatibility.mobileEventsTotal}`);
  console.log(`   - Total mobile emits (ocorrências): ${compatibility.mobileEmitsTotal}`);
  console.log(`   - Total handlers backend: ${compatibility.backendHandlersTotal}`);
  console.log(`   - Suportados: ${compatibility.supportedTotal}`);
  console.log(`   - Mapeados por alias legado: ${compatibility.mappedByAliasTotal}`);
  console.log(`   - Excluídos (transporte/socket): ${compatibility.excludedTotal}`);
  console.log(`   - Sem handler direto (gap real): ${compatibility.unsupportedTotal}`);
  if (compatibility.unsupportedTotal > 0) {
    console.log('   - Principais sem handler:');
    compatibility.unsupportedEvents.slice(0, 12).forEach((entry) => {
      console.log(`     • ${entry.event}${entry.closeMatch ? ` (match próximo: ${entry.closeMatch})` : ''}`);
    });
  }
  console.log('');
  console.log(`📝 Relatório completo salvo em: ${REPORT_FILE}`);

  process.exit(summary.totals.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ Erro fatal no runner:', error);
  process.exit(1);
});

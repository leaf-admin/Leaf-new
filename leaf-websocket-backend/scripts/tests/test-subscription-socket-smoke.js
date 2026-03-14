#!/usr/bin/env node

const { io } = require('socket.io-client');
const firebaseConfig = require('../../firebase-config');

const SERVER_URL = process.env.SMOKE_SERVER_URL || 'http://127.0.0.1:3011';
const DRIVER_ID = `smoke_driver_${Date.now()}`;

function withTimeout(promise, ms, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function getDB() {
  const maybe = firebaseConfig.getRealtimeDB();
  return typeof maybe?.then === 'function' ? await maybe : maybe;
}

async function setupDriverBlocked(db) {
  await db.ref(`users/${DRIVER_ID}`).set({
    usertype: 'driver',
    approved: true,
    planType: 'plus',
    billing_status: 'suspended',
    firstName: 'Smoke',
    lastName: 'Blocked',
    createdAt: new Date().toISOString(),
  });

  await db.ref(`subscriptions/${DRIVER_ID}`).set({
    planType: 'plus',
    status: 'blocked',
    pendingFeeCents: 1400,
    gracePeriodStartsAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    gracePeriodEndsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function cleanup(db) {
  await Promise.all([
    db.ref(`users/${DRIVER_ID}`).remove(),
    db.ref(`subscriptions/${DRIVER_ID}`).remove(),
  ]);
}

async function run() {
  const db = await getDB();
  if (!db) throw new Error('Realtime DB indisponível para smoke test');

  await setupDriverBlocked(db);

  const socket = io(SERVER_URL, {
    transports: ['websocket'],
    timeout: 10000,
    reconnection: false,
    forceNew: true,
  });

  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      }),
      12000,
      'timeout conectando socket'
    );

    socket.emit('authenticate', {
      uid: DRIVER_ID,
      userType: 'driver',
      usertype: 'driver',
    });

    await withTimeout(
      new Promise((resolve, reject) => {
        socket.once('authenticated', resolve);
        socket.once('authentication_error', (err) => reject(new Error(`authentication_error: ${JSON.stringify(err)}`)));
        socket.once('auth_error', (err) => reject(new Error(`auth_error: ${JSON.stringify(err)}`)));
      }),
      12000,
      'timeout autenticando socket'
    );

    socket.emit('setDriverStatus', {
      driverId: DRIVER_ID,
      status: 'online',
      isOnline: true,
    });

    const blockEvent = await withTimeout(
      new Promise((resolve, reject) => {
        socket.once('driverStatusError', resolve);
        socket.once('driverStatusUpdated', (ok) => reject(new Error(`esperava bloqueio, mas recebeu sucesso: ${JSON.stringify(ok)}`)));
      }),
      12000,
      'timeout aguardando driverStatusError por assinatura'
    );

    if (!blockEvent || blockEvent.subscriptionRequired !== true) {
      throw new Error(`bloqueio inválido: ${JSON.stringify(blockEvent)}`);
    }

    const code = String(blockEvent.code || '');
    if (code !== 'subscriptionBlocked') {
      throw new Error(`código inesperado (${code}) em bloqueio: ${JSON.stringify(blockEvent)}`);
    }

    console.log('✅ SMOKE OK: setDriverStatus bloqueado por assinatura como esperado');
    console.log(JSON.stringify({
      driverId: DRIVER_ID,
      server: SERVER_URL,
      blockEvent,
    }, null, 2));
  } finally {
    socket.disconnect();
    await cleanup(db);
  }
}

run().catch((error) => {
  console.error('❌ SMOKE FAIL:', error.message);
  process.exit(1);
});

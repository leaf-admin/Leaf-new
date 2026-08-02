#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const admin = require('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-leaf-rules';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!firestoreHost || !authHost) {
  throw new Error('Execute este teste com os emuladores Auth e Firestore ativos.');
}

admin.initializeApp({ projectId });

const auth = admin.auth();
const firestore = admin.firestore();
const firestoreBaseUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const authBaseUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1`;
const password = 'Rules-test-password-2026!';

function fields(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (typeof value === 'string') return [key, { stringValue: value }];
      if (typeof value === 'boolean') return [key, { booleanValue: value }];
      throw new Error(`Tipo não suportado no fixture: ${key}`);
    })
  );
}

async function createIdentity(label, customClaims = null) {
  const email = `${label}@leaf-rules.test`;
  const user = await auth.createUser({ email, password });
  if (customClaims) {
    await auth.setCustomUserClaims(user.uid, customClaims);
  }

  const response = await fetch(`${authBaseUrl}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return { uid: user.uid, token: payload.idToken };
}

async function firestoreRequest(identity, path, { method = 'GET', data } = {}) {
  const response = await fetch(`${firestoreBaseUrl}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${identity.token}`,
      'content-type': 'application/json'
    },
    body: data ? JSON.stringify({ fields: fields(data) }) : undefined
  });

  return {
    status: response.status,
    payload: await response.json().catch(() => ({}))
  };
}

function assertAllowed(result, label) {
  assert.ok(result.status >= 200 && result.status < 300, `${label}: ${result.status} ${JSON.stringify(result.payload)}`);
}

function assertDenied(result, label) {
  assert.equal(result.status, 403, `${label}: ${result.status} ${JSON.stringify(result.payload)}`);
}

async function seedFixtures(owner, other) {
  await Promise.all([
    firestore.collection('users').doc(owner.uid).set({ name: 'Owner' }),
    firestore.collection('adminUsers').doc(owner.uid).set({ role: 'admin' }),
    firestore.collection('adminUsers').doc(other.uid).set({ role: 'admin' }),
    firestore.collection('driver_withdrawals').doc('withdraw-owner').set({ driverId: owner.uid }),
    firestore.collection('driver_withdrawals').doc('withdraw-other').set({ driverId: other.uid }),
    firestore.collection('support_tickets').doc('ticket-owner').set({ userId: owner.uid }),
    firestore.collection('support_tickets').doc('ticket-other').set({ userId: other.uid }),
    firestore.collection('vehicles').doc('vehicle-1').set({ ownerId: owner.uid }),
    firestore.collection('trip_data').doc('trip-1').set({ userId: owner.uid })
  ]);
}

async function main() {
  const owner = await createIdentity('owner');
  const other = await createIdentity('other');
  const adminUser = await createIdentity('admin', { admin: true, role: 'admin' });
  const superAdmin = await createIdentity('super-admin', { admin: true, role: 'super-admin' });

  await seedFixtures(owner, other);

  assertAllowed(await firestoreRequest(owner, `users/${owner.uid}`), 'usuário lê o próprio perfil');
  assertDenied(
    await firestoreRequest(owner, `users/${owner.uid}`, { method: 'PATCH', data: { name: 'Changed' } }),
    'usuário não altera perfil fora da API'
  );

  assertAllowed(await firestoreRequest(owner, `adminUsers/${owner.uid}`), 'usuário consulta a própria identidade administrativa');
  assertDenied(await firestoreRequest(owner, `adminUsers/${other.uid}`), 'usuário não lê outro admin');
  assertAllowed(await firestoreRequest(adminUser, `adminUsers/${other.uid}`), 'admin lê identidade administrativa');
  assertDenied(
    await firestoreRequest(owner, `adminUsers/${owner.uid}`, { method: 'PATCH', data: { role: 'super-admin' } }),
    'usuário não promove a si próprio'
  );
  assertDenied(
    await firestoreRequest(superAdmin, `adminUsers/${other.uid}`, { method: 'PATCH', data: { role: 'super-admin' } }),
    'super-admin cliente não contorna a API'
  );

  assertDenied(await firestoreRequest(owner, 'vehicles/vehicle-1'), 'veículo não é lido diretamente');
  assertDenied(
    await firestoreRequest(owner, 'vehicles/vehicle-new', { method: 'PATCH', data: { ownerId: owner.uid } }),
    'veículo não é criado diretamente'
  );

  assertAllowed(await firestoreRequest(owner, 'driver_withdrawals/withdraw-owner'), 'motorista lê o próprio saque');
  assertDenied(await firestoreRequest(owner, 'driver_withdrawals/withdraw-other'), 'motorista não lê saque alheio');
  assertAllowed(await firestoreRequest(adminUser, 'driver_withdrawals/withdraw-other'), 'admin lê saque para revisão');
  assertDenied(
    await firestoreRequest(owner, 'driver_withdrawals/withdraw-new', { method: 'PATCH', data: { driverId: owner.uid } }),
    'motorista não cria saque fora da API'
  );

  assertAllowed(await firestoreRequest(owner, 'support_tickets/ticket-owner'), 'usuário lê o próprio ticket');
  assertDenied(await firestoreRequest(owner, 'support_tickets/ticket-other'), 'usuário não lê ticket alheio');
  assertAllowed(await firestoreRequest(adminUser, 'support_tickets/ticket-other'), 'admin lê ticket para atendimento');
  assertDenied(
    await firestoreRequest(owner, 'support_tickets/ticket-new', { method: 'PATCH', data: { userId: owner.uid } }),
    'usuário não cria ticket fora da API'
  );

  assertDenied(await firestoreRequest(owner, 'trip_data/trip-1'), 'trip_data não é exposto ao cliente');
  assertDenied(
    await firestoreRequest(owner, 'trip_data/trip-new', { method: 'PATCH', data: { userId: owner.uid } }),
    'trip_data não é escrito pelo cliente'
  );

  console.log('[firestore-rules] 19 contratos de autorização aprovados');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

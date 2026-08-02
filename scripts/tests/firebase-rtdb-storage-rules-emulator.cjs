#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const admin = require('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'demo-leaf-rules';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const databaseHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

if (!authHost || !databaseHost || !storageHost) {
  throw new Error('Execute este teste com os emuladores Auth, RTDB e Storage ativos.');
}

admin.initializeApp({ projectId });

const auth = admin.auth();
const authBaseUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1`;
const databaseBaseUrl = `http://${databaseHost}`;
const databaseNamespace = `${projectId}-default-rtdb`;
const storageBaseUrl = `http://${storageHost}/v0/b/${projectId}.appspot.com/o`;
const password = 'Rules-test-password-2026!';

async function createIdentity(label) {
  const email = `${label}@leaf-rules.test`;
  const user = await auth.createUser({ email, password });
  const response = await fetch(`${authBaseUrl}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return { uid: user.uid, token: payload.idToken };
}

async function databaseRequest(identity, path, { method = 'GET', data } = {}) {
  const headers = { 'content-type': 'application/json' };
  const authQuery = identity?.token ? `&auth=${encodeURIComponent(identity.token)}` : '';
  const response = await fetch(`${databaseBaseUrl}/${path}.json?ns=${databaseNamespace}${authQuery}`, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  return { status: response.status, payload: await response.json().catch(() => ({})) };
}

async function storageRequest(identity, path, { method = 'GET', data } = {}) {
  const headers = {};
  if (identity?.token) headers.authorization = `Bearer ${identity.token}`;

  let url = `${storageBaseUrl}/${encodeURIComponent(path)}?alt=media`;
  if (method === 'POST') {
    url = `${storageBaseUrl}?name=${encodeURIComponent(path)}`;
    headers['content-type'] = 'text/plain';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: data
  });
  return { status: response.status, payload: await response.text() };
}

function assertDenied(result, label) {
  assert.ok(
    result.status === 401 || result.status === 403,
    `${label}: ${result.status} ${String(result.payload)}`
  );
}

async function main() {
  const user = await createIdentity('rtdb-storage-user');

  assertDenied(await databaseRequest(null, `users/${user.uid}`), 'anônimo não lê RTDB');
  assertDenied(await databaseRequest(user, `users/${user.uid}`), 'usuário não lê perfil direto no RTDB');
  assertDenied(
    await databaseRequest(user, `users/${user.uid}`, { method: 'PUT', data: { uid: user.uid } }),
    'usuário não escreve perfil direto no RTDB'
  );
  assertDenied(await databaseRequest(user, 'vehicles/vehicle-1'), 'usuário não lê catálogo de veículos direto');
  assertDenied(
    await databaseRequest(user, 'user_vehicles/link-1', { method: 'PUT', data: { userId: user.uid } }),
    'usuário não escreve vínculo de veículo direto'
  );
  assertDenied(await databaseRequest(user, `driver_activation/${user.uid}`), 'usuário não lê ativação KYC direta');
  assertDenied(
    await databaseRequest(user, 'trip_data/trip-1', { method: 'PUT', data: { userId: user.uid } }),
    'usuário não escreve trip_data direto'
  );

  assertDenied(await storageRequest(null, 'public/file.txt'), 'anônimo não lê Storage');
  assertDenied(await storageRequest(user, `documents/${user.uid}/cnh.pdf`), 'usuário não lê documento direto');
  assertDenied(
    await storageRequest(user, `documents/${user.uid}/cnh.pdf`, { method: 'POST', data: 'pdf' }),
    'usuário não envia documento direto'
  );
  assertDenied(await storageRequest(user, `vehicles/${user.uid}/crlv.pdf`), 'usuário não lê CRLV direto');
  assertDenied(
    await storageRequest(user, `vehicles/${user.uid}/crlv.pdf`, { method: 'POST', data: 'pdf' }),
    'usuário não envia CRLV direto'
  );
  assertDenied(await storageRequest(user, `users/${user.uid}/profile.jpg`), 'usuário não lê perfil direto');
  assertDenied(
    await storageRequest(user, `users/${user.uid}/profile.jpg`, { method: 'POST', data: 'image' }),
    'usuário não envia imagem de perfil direta'
  );

  console.log('[rtdb-storage-rules] 14 contratos de autorização aprovados');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const { getIdTokenForUid } = require('../../tests/e2e/backend/__helpers__/firebase-id-token');

const backendDir = path.resolve(__dirname, '..', '..');
const workspaceDir = path.resolve(backendDir, '..');

dotenv.config({ path: path.join(backendDir, '.env') });
dotenv.config({ path: path.join(workspaceDir, 'mobile-app', '.env') });
dotenv.config({ path: path.join(workspaceDir, 'mobile-app', '.env.production') });

const SERVER_URL = process.env.SMOKE_SERVER_URL || 'http://127.0.0.1:3001';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const PASSENGER_EMAIL = process.env.SMOKE_PASSENGER_EMAIL || process.env.QA_PASSENGER_EMAIL || 'joao.teste@leaf.com';
const PASSENGER_PASSWORD = process.env.SMOKE_PASSENGER_PASSWORD || process.env.QA_PASSENGER_PASSWORD || 'teste123';
const PASSENGER_UID = process.env.SMOKE_PASSENGER_UID || process.env.QA_PASSENGER_UID || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || process.env.ADMIN_AUTH_EMAIL || process.env.TEST_ADMIN_EMAIL || 'admin@leaf.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_AUTH_PASSWORD || process.env.TEST_ADMIN_PASSWORD || 'admin123';

const http = axios.create({
  timeout: 25000,
  validateStatus: () => true
});

const steps = [];

function assertOrThrow(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function statusError(label, response) {
  const details = JSON.stringify(response.data || {}).slice(0, 240);
  return `${label}_${response.status}${details ? `:${details}` : ''}`;
}

function ensureAdminInitialized() {
  if (admin.apps.length > 0) return admin.app();

  const databaseURL = process.env.FIREBASE_DATABASE_URL || 'https://leaf-reactnative-default-rtdb.firebaseio.com';
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (serviceAccountJson) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
      databaseURL
    });
  }

  const serviceAccountPath = path.join(backendDir, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error('missing_service_account_for_custom_token');
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    databaseURL
  });
}

async function runStep(name, fn) {
  const startedAt = Date.now();
  try {
    const data = await fn();
    steps.push({
      name,
      ok: true,
      durationMs: Date.now() - startedAt,
      details: data || {}
    });
    console.log(`PASS ${name}`);
    return data;
  } catch (error) {
    steps.push({
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    console.log(`FAIL ${name} -> ${error.message}`);
    throw error;
  }
}

async function signInFirebase(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
  const response = await http.post(url, {
    email,
    password,
    returnSecureToken: true
  });

  if (response.status !== 200) {
    const apiMessage = response.data?.error?.message || response.data?.error || 'unknown';
    throw new Error(`firebase_signin_status_${response.status}:${apiMessage}`);
  }
  assertOrThrow(response.data && response.data.idToken && response.data.localId, 'firebase_signin_invalid_payload');

  return {
    idToken: response.data.idToken,
    uid: response.data.localId
  };
}

async function signInWithCustomToken(uid) {
  ensureAdminInitialized();
  const customToken = await admin.auth().createCustomToken(uid);
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;
  const response = await http.post(url, {
    token: customToken,
    returnSecureToken: true
  });

  if (response.status !== 200) {
    const apiMessage = response.data?.error?.message || response.data?.error || 'unknown';
    throw new Error(`firebase_custom_signin_status_${response.status}:${apiMessage}`);
  }

  assertOrThrow(response.data && response.data.idToken, 'firebase_custom_signin_invalid_payload');

  return {
    idToken: response.data.idToken,
    uid: response.data.localId || uid
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const tag = `smoke-${Date.now()}`;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('missing_admin_credentials');
  }

  let userToken = null;
  let userId = null;
  let adminToken = null;
  let ticketId = null;
  const userMessage = `Mensagem usuário ${tag}`;
  const adminMessage = `Resposta admin ${tag}`;
  const chatMessage = `Chat usuário ${tag}`;

  await runStep('firebase user login', async () => {
    let result = null;

    try {
      if (!FIREBASE_API_KEY || /YOUR_FIREBASE_API_KEY/i.test(FIREBASE_API_KEY)) {
        throw new Error('firebase_api_key_placeholder');
      }
      result = await signInFirebase(PASSENGER_EMAIL, PASSENGER_PASSWORD);
    } catch (error) {
      const canFallbackToCustomToken =
        PASSENGER_UID &&
        /INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD|API key not valid|firebase_api_key_placeholder/i.test(String(error.message || ''));

      if (!canFallbackToCustomToken) {
        throw error;
      }

      result = {
        idToken: await getIdTokenForUid(PASSENGER_UID),
        uid: PASSENGER_UID
      };
    }

    userToken = result.idToken;
    userId = result.uid;
    return { userId };
  });

  await runStep('admin login', async () => {
    const response = await http.post(`${SERVER_URL}/api/admin/auth/login`, {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD
    });

    assertOrThrow(response.status === 200, `admin_login_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'admin_login_unsuccessful');
    assertOrThrow(response.data?.accessToken, 'admin_access_token_missing');
    adminToken = response.data.accessToken;

    return {
      adminRole: response.data?.user?.role || null
    };
  });

  await runStep('user create support ticket', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/tickets`,
      {
        subject: `Ticket ${tag}`,
        description: userMessage,
        category: 'technical',
        priority: 'N2'
      },
      {
        headers: { Authorization: `Bearer ${userToken}` }
      }
    );

    assertOrThrow(response.status === 201, `create_ticket_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'create_ticket_unsuccessful');
    assertOrThrow(response.data?.ticket?.id, 'ticket_id_missing');
    ticketId = response.data.ticket.id;

    return { ticketId };
  });

  await runStep('user list own tickets', async () => {
    let response = await http.get(`${SERVER_URL}/api/support/tickets`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    if (response.status === 401 && userId) {
      userToken = await getIdTokenForUid(userId);
      response = await http.get(`${SERVER_URL}/api/support/tickets`, {
        headers: { Authorization: `Bearer ${userToken}` }
      });
    }

    assertOrThrow(response.status === 200, statusError('list_user_tickets_status', response));
    assertOrThrow(Array.isArray(response.data?.tickets), 'list_user_tickets_invalid_payload');
    const hasTicket = response.data.tickets.some((ticket) => ticket.id === ticketId);
    assertOrThrow(hasTicket, 'created_ticket_not_found_for_user');

    return { total: response.data.total };
  });

  await runStep('user get ticket detail', async () => {
    const response = await http.get(`${SERVER_URL}/api/support/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    assertOrThrow(response.status === 200, `get_ticket_status_${response.status}`);
    assertOrThrow(response.data?.ticket?.id === ticketId, 'ticket_detail_id_mismatch');

    return {
      status: response.data?.ticket?.status || null
    };
  });

  await runStep('admin list support queue', async () => {
    const response = await http.get(`${SERVER_URL}/api/support/admin/tickets`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assertOrThrow(response.status === 200, `list_admin_tickets_status_${response.status}`);
    assertOrThrow(Array.isArray(response.data?.tickets), 'list_admin_tickets_invalid_payload');
    const hasTicket = response.data.tickets.some((ticket) => ticket.id === ticketId);
    assertOrThrow(hasTicket, 'created_ticket_not_found_for_admin');

    return { total: response.data.total };
  });

  await runStep('admin assign ticket', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/admin/tickets/${ticketId}/assign`,
      {
        agentId: 'support-agent-smoke',
        agentName: 'Support Smoke Agent'
      },
      {
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );

    assertOrThrow(response.status === 200, `assign_ticket_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'assign_ticket_unsuccessful');
    return {};
  });

  await runStep('admin send ticket message', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/tickets/${ticketId}/messages`,
      {
        message: adminMessage
      },
      {
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );

    assertOrThrow(response.status === 201, `admin_send_ticket_msg_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'admin_send_ticket_msg_unsuccessful');
    return { messageId: response.data?.message?.id || null };
  });

  await runStep('user read ticket messages', async () => {
    const response = await http.get(`${SERVER_URL}/api/support/tickets/${ticketId}/messages`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });

    assertOrThrow(response.status === 200, `user_read_ticket_msgs_status_${response.status}`);
    assertOrThrow(Array.isArray(response.data?.messages), 'user_read_ticket_msgs_invalid_payload');
    const hasAdminReply = response.data.messages.some((message) => message.message === adminMessage);
    assertOrThrow(hasAdminReply, 'admin_reply_not_visible_to_user');

    return { messageCount: response.data.messages.length };
  });

  await runStep('user send support chat message', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/chat/${userId}/message`,
      {
        message: chatMessage
      },
      {
        headers: { Authorization: `Bearer ${userToken}` }
      }
    );

    assertOrThrow(response.status === 200, `user_send_chat_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'user_send_chat_unsuccessful');
    return {};
  });

  await runStep('admin read support chat history', async () => {
    const response = await http.get(`${SERVER_URL}/api/support/chat/${userId}/history`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assertOrThrow(response.status === 200, `admin_read_chat_history_status_${response.status}`);
    assertOrThrow(Array.isArray(response.data?.messages), 'admin_read_chat_history_invalid_payload');
    const hasUserMessage = response.data.messages.some((message) => message.message === chatMessage);
    assertOrThrow(hasUserMessage, 'user_chat_message_not_in_history');

    return { messageCount: response.data.messages.length };
  });

  await runStep('admin close support chat', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/chat/${userId}/close`,
      {
        closedBy: 'agent'
      },
      {
        headers: { Authorization: `Bearer ${adminToken}` }
      }
    );

    assertOrThrow(response.status === 200, `admin_close_chat_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'admin_close_chat_unsuccessful');
    return {};
  });

  await runStep('user reopens chat after close', async () => {
    const response = await http.post(
      `${SERVER_URL}/api/support/chat/${userId}/message`,
      {
        message: `Mensagem apos fechamento ${tag}`
      },
      {
        headers: { Authorization: `Bearer ${userToken}` }
      }
    );

    assertOrThrow(response.status === 200, `user_message_after_close_status_${response.status}`);
    assertOrThrow(response.data?.success === true, 'user_message_after_close_unsuccessful');
    return {
      reopenedMessageId: response.data?.message?.id || null
    };
  });

  await runStep('admin verify chat reopened status', async () => {
    const response = await http.get(`${SERVER_URL}/api/support/chat/${userId}/status`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assertOrThrow(response.status === 200, `admin_chat_status_status_${response.status}`);
    assertOrThrow(response.data?.status?.status === 'active', `chat_status_expected_active_got_${response.data?.status?.status || 'undefined'}`);
    return { chatStatus: response.data.status.status };
  });

  const passed = steps.filter((step) => step.ok).length;
  const failed = steps.filter((step) => !step.ok).length;

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    serverUrl: SERVER_URL,
    passengerEmail: PASSENGER_EMAIL,
    adminEmail: ADMIN_EMAIL,
    ticketId,
    userId,
    passed,
    failed,
    steps
  };

  console.log('\n=== SMOKE SUPPORT TWO PROFILES SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  const passed = steps.filter((step) => step.ok).length;
  const failed = steps.filter((step) => !step.ok).length;
  console.error('\n=== SMOKE SUPPORT TWO PROFILES FAILED ===');
  console.error(error.message);
  console.error(JSON.stringify({ passed, failed, steps }, null, 2));
  process.exit(1);
});

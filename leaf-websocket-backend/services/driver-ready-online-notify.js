'use strict';

// Avisa o motorista quando o cadastro fica pronto e só falta a primeira validação
// facial (estado APPROVED_NEEDS_LIVENESS), que acontece quando ele toca em "Ficar
// online" pela primeira vez. Sem esse push, quem está com o app fechado não sabe.
//
// 1. Push na hora em que ele entra nesse estado pela primeira vez (uma vez só).
// 2. Lembretes 24 h e 72 h depois se ele continuar sem fazer a validação facial
//    (= nunca ficou online). No máximo 2, só entre 10h e 19h de Brasília.
//
// O texto não promete corrida nem liberação imediata: com a fila de entrada
// ligada, depois da validação facial o motorista ainda pode ir para a fila, que
// tem os próprios avisos (waitlist-notification-service).
//
// Custo: no gatilho, 1 leitura do usuário só quando o estado é o de "pronto";
// no lembrete, 1 consulta por hora que só traz quem está com o lembrete
// pendente (campo de topo, índice simples, com limite). FCM não tem custo.

const { logStructured, logError } = require('../utils/logger');
const userStore = require('./user-store');

const READY_STATE = 'APPROVED_NEEDS_LIVENESS';
const PENDING_FIELD = 'driverReadyReminderPending';
const INFO_FIELD = 'driverReadyReminder';
const REMINDER_DELAYS_HOURS = [24, 72];
const SEND_WINDOW_BRT = { start: 10, end: 19 };
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const QUERY_LIMIT = 100;

const MESSAGES = Object.freeze({
  ready: {
    title: 'Cadastro aprovado!',
    body: 'Falta só a validação facial. Abra o app e toque em Ficar online para fazer agora.'
  },
  reminder_1: {
    title: 'Seu cadastro está pronto',
    body: 'Falta só um passo: a validação facial. Abra o app e toque em Ficar online.'
  },
  reminder_2: {
    title: 'Ainda dá tempo de começar',
    body: 'Seu cadastro na Leaf está aprovado. Toque em Ficar online e faça a validação facial quando quiser.'
  }
});

let lastCheckAt = 0;

function isEnabled(env = process.env) {
  return String(env.DRIVER_READY_ONLINE_NOTIFY_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function brtHour(now = new Date()) {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

function isFirstLivenessPending(canonicalState = {}) {
  return canonicalState?.state === READY_STATE
    && canonicalState?.liveness?.passed !== true
    && canonicalState?.kyc?.reverifyRequired !== true;
}

function defaultSendPush() {
  return async (driverId, kind) => {
    const FCMService = require('./fcm-service');
    const redisPool = require('../utils/redis-pool');
    const fcmService = new FCMService(redisPool.getConnection());
    await fcmService.initialize();
    const message = MESSAGES[kind] || MESSAGES.ready;
    return fcmService.sendNotificationToUser(driverId, {
      title: message.title,
      body: message.body,
      data: {
        type: 'driver_ready_online',
        kind,
        userType: 'driver',
        driverId: String(driverId),
        screen: 'RobotaxiPrototype',
        source: 'driver_ready_online'
      },
      channelId: 'driver_updates',
      priority: 'high'
    });
  };
}

/**
 * Chamado depois de recalcular o estado de ativação. Só age na primeira vez em
 * que o motorista fica pronto para a primeira validação facial.
 */
async function maybeNotifyDriverReady({
  driverId,
  canonicalState,
  firestore,
  env = process.env,
  now = () => new Date(),
  sendPush = defaultSendPush()
} = {}) {
  if (!isEnabled(env) || !driverId || !isFirstLivenessPending(canonicalState)) return { sent: false, status: 'not_ready' };

  const existing = await userStore.readUserField(firestore, driverId, INFO_FIELD);
  if (existing?.readyAt) return { sent: false, status: 'already_notified' };

  const at = now().toISOString();
  // Marca antes de enviar: se o recálculo rodar de novo em paralelo, não duplica.
  await userStore.updateUser(firestore, driverId, {
    [PENDING_FIELD]: true,
    [INFO_FIELD]: { readyAt: at, remindersSent: 0, lastSentAt: at }
  });

  const result = await sendPush(driverId, 'ready').catch((error) => ({ success: false, error: error?.message }));
  logStructured('info', 'Push de cadastro pronto para a primeira validação facial', {
    service: 'driver-ready-online-notify',
    driverId,
    success: result?.success === true
  });
  return { sent: result?.success === true, status: 'notified' };
}

function nextReminderKind(info = {}, nowMs) {
  const sent = Number(info.remindersSent || 0);
  if (sent >= REMINDER_DELAYS_HOURS.length) return null;
  const readyMs = Date.parse(info.readyAt || '');
  if (!Number.isFinite(readyMs)) return null;
  if (nowMs - readyMs < REMINDER_DELAYS_HOURS[sent] * 3600000) return null;
  return `reminder_${sent + 1}`;
}

/**
 * Ciclo do worker de ride health (líder único). Roda de hora em hora dentro da
 * janela de envio e manda o próximo lembrete devido de cada motorista pendente.
 */
async function maybeRunDriverReadyReminders({
  firestore = null,
  env = process.env,
  now = new Date(),
  sendPush = defaultSendPush(),
  resolveLiveness = (user) => require('./driver-activation-state-service').resolveLivenessEvidence(user)
} = {}) {
  if (!isEnabled(env)) return null;
  const nowMs = now.getTime();
  if (nowMs - lastCheckAt < CHECK_INTERVAL_MS) return null;
  const hour = brtHour(now);
  if (hour < SEND_WINDOW_BRT.start || hour >= SEND_WINDOW_BRT.end) return null;
  lastCheckAt = nowMs;

  const store = firestore || require('../firebase-config').getFirestore();
  const summary = { checked: 0, sent: 0, closed: 0 };
  try {
    const users = await userStore.queryUsers(store, PENDING_FIELD, true, { limit: QUERY_LIMIT });
    for (const [driverId, user] of Object.entries(users || {})) {
      summary.checked += 1;
      const info = user?.[INFO_FIELD] || {};
      const stillReady = String(user?.driverActivation?.activationState || '') === READY_STATE
        && resolveLiveness(user || {})?.passed !== true;
      const kind = stillReady ? nextReminderKind(info, nowMs) : null;
      const exhausted = Number(info.remindersSent || 0) >= REMINDER_DELAYS_HOURS.length;

      if (!stillReady || exhausted) {
        await userStore.updateUser(store, driverId, {
          [PENDING_FIELD]: null,
          [`${INFO_FIELD}/closedAt`]: now.toISOString(),
          [`${INFO_FIELD}/closedReason`]: stillReady ? 'reminders_exhausted' : 'left_ready_state'
        });
        summary.closed += 1;
        continue;
      }
      if (!kind) continue;

      const remindersSent = Number(info.remindersSent || 0) + 1;
      const isLast = remindersSent >= REMINDER_DELAYS_HOURS.length;
      await userStore.updateUser(store, driverId, {
        [`${INFO_FIELD}/remindersSent`]: remindersSent,
        [`${INFO_FIELD}/lastSentAt`]: now.toISOString(),
        ...(isLast ? { [PENDING_FIELD]: null, [`${INFO_FIELD}/closedReason`]: 'reminders_exhausted' } : {})
      });
      const result = await sendPush(driverId, kind).catch((error) => ({ success: false, error: error?.message }));
      if (result?.success === true) summary.sent += 1;
    }
    if (summary.checked > 0) {
      logStructured('info', 'Lembretes de cadastro pronto processados', { service: 'driver-ready-online-notify', ...summary });
    }
    return summary;
  } catch (error) {
    logError(error, 'Falha nos lembretes de cadastro pronto', { service: 'driver-ready-online-notify' });
    return null;
  }
}

function resetDriverReadyRemindersState() {
  lastCheckAt = 0;
}

module.exports = {
  MESSAGES,
  PENDING_FIELD,
  INFO_FIELD,
  READY_STATE,
  isFirstLivenessPending,
  nextReminderKind,
  maybeNotifyDriverReady,
  maybeRunDriverReadyReminders,
  resetDriverReadyRemindersState
};

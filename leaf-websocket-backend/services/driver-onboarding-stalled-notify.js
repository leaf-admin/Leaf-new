'use strict';

// Lembrete para o motorista que começou o cadastro e parou: cadastro na fila
// "Em cadastro" (bucket onboarding do espelho driver_applications), ou seja,
// falta algo que depende dele (documento, veículo, KYC ou documento reprovado).
//
// - 24 h e 72 h depois de parar, no máximo 2 por período parado, 24 h entre eles.
// - Só entre 10h e 19h de Brasília, checado de hora em hora no worker de ride health.
// - Fica de fora quem está pronto para a primeira validação facial (tem aviso
//   próprio, driver-ready-online-notify), reprovado, suspenso ou parado há mais
//   de 30 dias.
// - Se ele avança e volta a parar (ex.: documento reprovado), o período recomeça.
//
// Custo: 1 consulta por hora na janela, só dos cadastros em "Em cadastro",
// poucos campos e com limite. Uma gravação por lembrete enviado. FCM não tem custo.

const { logStructured, logError } = require('../utils/logger');
const { estimateWaitingSince } = require('./driver-review-queue');

const REMINDER_DELAYS_HOURS = [24, 72];
const MIN_GAP_MS = 24 * 60 * 60 * 1000;
const MAX_STALLED_MS = 30 * 24 * 60 * 60 * 1000;
const SEND_WINDOW_BRT = { start: 10, end: 19 };
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const QUERY_LIMIT = 300;
const SKIP_STATES = new Set(['APPROVED_NEEDS_LIVENESS', 'ACTIVE', 'REJECTED', 'SUSPENDED']);

const MESSAGES = Object.freeze({
  reminder_1: {
    title: 'Seu cadastro está quase pronto',
    body: 'Falta pouco para você dirigir com a Leaf. Abra o app e continue de onde parou.'
  },
  reminder_2: {
    title: 'Continue seu cadastro na Leaf',
    body: 'Seus dados ficam salvos. Envie o que falta quando puder.'
  }
});

let lastCheckAt = 0;

function isEnabled(env = process.env) {
  return String(env.DRIVER_ONBOARDING_REMINDER_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function brtHour(now) {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getUTCHours();
}

function buildPush(driverId, kind) {
  const message = MESSAGES[kind] || MESSAGES.reminder_1;
  return {
    title: message.title,
    body: message.body,
    collapseKey: `leaf-onboarding-${driverId}`,
    data: {
      type: 'driver_onboarding_reminder',
      kind,
      userType: 'driver',
      driverId: String(driverId),
      screen: 'RobotaxiPrototypeDriverDocuments'
    },
    channelId: 'driver_updates',
    priority: 'high'
  };
}

/**
 * Decide o próximo lembrete de um cadastro parado. Devolve null quando nada é devido.
 */
function planReminder(application = {}, nowMs) {
  const namespace = String(application?.persistenceScope?.namespace || 'operational').toLowerCase();
  if (namespace !== 'operational') return null;
  if (application?.driver?.approved === true) return null;
  if (SKIP_STATES.has(String(application?.activation?.state || ''))) return null;

  const since = application.onboardingSince || estimateWaitingSince(application);
  const sinceMs = Date.parse(since || '');
  if (!Number.isFinite(sinceMs)) return null;
  const stalledMs = nowMs - sinceMs;
  if (stalledMs > MAX_STALLED_MS) return null;

  const previous = application.onboardingReminder || {};
  const sent = previous.since === since ? Number(previous.sent || 0) : 0;
  if (sent >= REMINDER_DELAYS_HOURS.length) return null;
  if (stalledMs < REMINDER_DELAYS_HOURS[sent] * 3600000) return null;
  const lastSentMs = previous.since === since ? Date.parse(previous.lastSentAt || '') : NaN;
  if (Number.isFinite(lastSentMs) && nowMs - lastSentMs < MIN_GAP_MS) return null;

  return { kind: `reminder_${sent + 1}`, since, sent: sent + 1 };
}

async function maybeRunDriverOnboardingReminders({
  firestore = null,
  env = process.env,
  now = new Date(),
  sendPush = (driverId, push) => require('./transactional-push').sendTransactionalPush(driverId, push, { driverId })
} = {}) {
  if (!isEnabled(env)) return null;
  const nowMs = now.getTime();
  if (nowMs - lastCheckAt < CHECK_INTERVAL_MS) return null;
  const hour = brtHour(now);
  if (hour < SEND_WINDOW_BRT.start || hour >= SEND_WINDOW_BRT.end) return null;
  lastCheckAt = nowMs;

  const store = firestore || require('../firebase-config').getFirestore();
  const summary = { checked: 0, sent: 0 };
  try {
    const snapshot = await store
      .collection('driver_applications')
      .where('reviewBucket', '==', 'onboarding')
      .select('onboardingSince', 'onboardingReminder', 'persistenceScope', 'activation', 'driver',
        'updatedAt', 'lastUpdated', 'submissionDate', 'createdAt')
      .limit(QUERY_LIMIT)
      .get();

    for (const doc of snapshot.docs) {
      summary.checked += 1;
      const plan = planReminder(doc.data() || {}, nowMs);
      if (!plan) continue;
      // Grava antes de enviar: o worker tem líder único, mas um reinício no meio não repete.
      await doc.ref.set({
        onboardingReminder: { since: plan.since, sent: plan.sent, lastSentAt: now.toISOString(), lastKind: plan.kind }
      }, { merge: true });
      const result = await sendPush(doc.id, buildPush(doc.id, plan.kind)).catch(() => null);
      if (result?.success === true) summary.sent += 1;
    }
    if (summary.sent > 0) {
      logStructured('info', 'Lembretes de cadastro parado enviados', { service: 'driver-onboarding-stalled-notify', ...summary });
    }
    return summary;
  } catch (error) {
    logError(error, 'Falha nos lembretes de cadastro parado', { service: 'driver-onboarding-stalled-notify' });
    return null;
  }
}

function resetDriverOnboardingRemindersState() {
  lastCheckAt = 0;
}

module.exports = {
  MESSAGES,
  buildPush,
  planReminder,
  maybeRunDriverOnboardingReminders,
  resetDriverOnboardingRemindersState
};

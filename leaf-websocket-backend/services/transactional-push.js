'use strict';

// Pushes transacionais disparados no próprio evento (sem leitura extra):
// - suporte respondeu (motorista ou passageiro)
// - saque enviado / saque demorando (motorista)
// - reembolso enviado (passageiro)
//
// Nunca lançam nem atrasam o fluxo de origem: erro vira aviso no log.
// Sandbox não recebe push.

const { logStructured } = require('../utils/logger');

const SUPPORT_REPLY_COALESCE_SECONDS = 5 * 60;
const HISTORY_SCREEN = 'RobotaxiMenuTripHistory';
const SUPPORT_THREAD_SCREEN = 'RobotaxiPrototypeSupportThread';

let sharedFcmService = null;

function isEnabled(env = process.env) {
  return String(env.TRANSACTIONAL_PUSH_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function brl(cents) {
  const value = Number(cents || 0) / 100;
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function resolveFcmService() {
  if (!sharedFcmService) {
    const FCMService = require('./fcm-service');
    const redisPool = require('../utils/redis-pool');
    sharedFcmService = new FCMService(redisPool.getConnection());
  }
  if (!sharedFcmService.isServiceAvailable()) {
    await sharedFcmService.initialize();
  }
  return sharedFcmService;
}

function buildSupportReplyPush({ ticketId, userType }) {
  return {
    title: 'A equipe Leaf respondeu',
    body: 'Abra o app para ver a resposta do seu chamado.',
    collapseKey: `leaf-support-${ticketId}`,
    data: {
      type: 'support_reply',
      ticketId: String(ticketId),
      userType: String(userType || ''),
      screen: SUPPORT_THREAD_SCREEN,
      params: JSON.stringify({ ticketId: String(ticketId) })
    },
    channelId: 'support',
    priority: 'high'
  };
}

function buildWithdrawalProcessedPush({ withdrawalId, amountCents }) {
  return {
    title: 'Saque enviado',
    body: `${brl(amountCents)} foram enviados para sua chave Pix.`,
    collapseKey: `leaf-withdrawal-${withdrawalId}`,
    data: {
      type: 'withdrawal_processed',
      withdrawalId: String(withdrawalId),
      userType: 'driver',
      screen: HISTORY_SCREEN
    },
    channelId: 'driver_updates',
    priority: 'high'
  };
}

function buildWithdrawalDelayedPush({ withdrawalId }) {
  return {
    title: 'Seu saque está demorando',
    body: 'Tivemos um problema ao enviar o Pix. Já estamos resolvendo e você não precisa fazer nada.',
    collapseKey: `leaf-withdrawal-${withdrawalId}`,
    data: {
      type: 'withdrawal_delayed',
      withdrawalId: String(withdrawalId),
      userType: 'driver',
      screen: HISTORY_SCREEN
    },
    channelId: 'driver_updates',
    priority: 'high'
  };
}

function buildRefundProcessedPush({ bookingId, amountCents }) {
  return {
    title: 'Reembolso enviado',
    body: `Devolvemos ${brl(amountCents)} para a conta de onde saiu o Pix. Pode levar alguns minutos para aparecer no banco.`,
    collapseKey: `leaf-refund-${bookingId}`,
    data: {
      type: 'refund_processed',
      bookingId: String(bookingId || ''),
      userType: 'passenger',
      screen: HISTORY_SCREEN
    },
    channelId: 'payments',
    priority: 'high'
  };
}

async function send(userId, push, context = {}, { fcmService = null, env = process.env } = {}) {
  if (!isEnabled(env) || !userId) return { success: false, skipped: true };
  // Testes de outros módulos não abrem o Firebase de verdade.
  if (!fcmService && env.NODE_ENV === 'test') return { success: false, skipped: true };
  try {
    const service = fcmService || await resolveFcmService();
    const result = await service.sendNotificationToUser(String(userId), push);
    logStructured('info', 'Push transacional enviado', {
      service: 'transactional-push',
      type: push?.data?.type,
      success: result?.success === true,
      ...context
    });
    return result;
  } catch (error) {
    logStructured('warn', 'Push transacional não enviado', {
      service: 'transactional-push',
      type: push?.data?.type,
      error: error?.message || String(error),
      ...context
    });
    return { success: false, error: error?.message };
  }
}

/**
 * Resposta da equipe num chamado. No máximo um push a cada 5 min por chamado,
 * para uma conversa rápida não virar uma rajada de avisos.
 */
async function notifySupportReply(ticket = {}, { redis = null, ...options } = {}) {
  if (!ticket?.id || !ticket?.userId || ticket.financialNamespace === 'sandbox') return { success: false, skipped: true };
  try {
    const client = redis || require('../utils/redis-pool').getConnection();
    if (client) {
      const acquired = await client.set(`push:support_reply:${ticket.id}`, '1', 'EX', SUPPORT_REPLY_COALESCE_SECONDS, 'NX');
      if (!acquired) return { success: false, skipped: true, coalesced: true };
    }
  } catch (_) {
    // Sem Redis: envia mesmo assim.
  }
  return send(ticket.userId, buildSupportReplyPush({ ticketId: ticket.id, userType: ticket.userType }), {
    ticketId: ticket.id
  }, options);
}

function notifyWithdrawalProcessed({ driverId, withdrawalId, amountCents }, options = {}) {
  return send(driverId, buildWithdrawalProcessedPush({ withdrawalId, amountCents }), { withdrawalId }, options);
}

function notifyWithdrawalDelayed({ driverId, withdrawalId }, options = {}) {
  return send(driverId, buildWithdrawalDelayedPush({ withdrawalId }), { withdrawalId }, options);
}

function notifyRefundProcessed({ passengerId, bookingId, amountCents, namespace = null }, options = {}) {
  if (namespace === 'sandbox') return Promise.resolve({ success: false, skipped: true });
  return send(passengerId, buildRefundProcessedPush({ bookingId, amountCents }), { bookingId }, options);
}

module.exports = {
  sendTransactionalPush: send,
  brl,
  buildSupportReplyPush,
  buildWithdrawalProcessedPush,
  buildWithdrawalDelayedPush,
  buildRefundProcessedPush,
  notifySupportReply,
  notifyWithdrawalProcessed,
  notifyWithdrawalDelayed,
  notifyRefundProcessed
};

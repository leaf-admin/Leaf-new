'use strict';

const { getConfig, assertConfigured, recipientFor, supportError } = require('./whatsapp-support-config');
const { WhatsAppSupportRepository, hash } = require('../repositories/whatsapp-support-repository');
const { emitSupportToDashboard } = require('./support-realtime-publisher');

function createWhatsAppSupportService({ config = getConfig, repository, post, clock = Date.now } = {}) {
  let io = null;
  let storedRepository = repository;
  const getRepository = () => {
    if (!storedRepository) {
      const db = require('../firebase-config').getFirestore();
      if (!db) throw supportError('Persistência do WhatsApp indisponível.');
      storedRepository = new WhatsAppSupportRepository(db);
    }
    return storedRepository;
  };
  const ready = () => { const value = config(); assertConfigured(value); return value; };
  const notify = (message) => emitSupportToDashboard(io, 'support:chat:new', message);
  const scoped = (userId) => { const value = ready(); recipientFor(userId, value); return value; };

  return {
    setIO(value) { io = value; },
    async listActiveChats({ limit = 50, includeClosed = false } = {}) {
      if (!config().enabled) return [];
      const cfg = ready();
      return getRepository().list(cfg.phoneNumberId, Math.min(100, Math.max(1, Number(limit) || 50)), includeClosed);
    },
    async history(userId, limit) {
      scoped(userId);
      await getRepository().getChat(userId);
      return getRepository().history(userId, Math.min(100, Math.max(1, Number(limit) || 50)));
    },
    async status(userId) { scoped(userId); return getRepository().getChat(userId); },
    async markRead(userId) { scoped(userId); await getRepository().markRead(userId); },
    async close(userId) {
      scoped(userId);
      await getRepository().close(userId);
      emitSupportToDashboard(io, 'support:chat:closed', { userId, channel: 'whatsapp' });
    },
    async receive(payload) {
      const cfg = ready();
      if (payload?.object !== 'whatsapp_business_account') return;
      for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
        if (String(entry.id) !== cfg.wabaId) continue;
        for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
          const value = change.value;
          if (change.field !== 'messages' || String(value?.metadata?.phone_number_id) !== cfg.phoneNumberId) continue;
          for (const incoming of Array.isArray(value.messages) ? value.messages : []) {
            if (!/^\d{7,15}$/.test(String(incoming.from || '')) || typeof incoming.id !== 'string' || !incoming.id || incoming.id.length > 256) continue;
            const receivedAt = clock();
            const timestampMs = Number(incoming.timestamp) * 1000;
            if (!Number.isFinite(timestampMs) || timestampMs <= 0 || timestampMs > receivedAt + 60_000) continue;
            const userId = `whatsapp:${cfg.phoneNumberId}:${incoming.from}`;
            const contact = (Array.isArray(value.contacts) ? value.contacts : []).find((item) => item.wa_id === incoming.from);
            const message = {
              id: incoming.id, userId, channel: 'whatsapp', senderType: 'user',
              message: incoming.type === 'text' && typeof incoming.text?.body === 'string'
                ? incoming.text.body.slice(0, 4096)
                : '[Mensagem recebida sem suporte de visualização nesta etapa: mídia ou outro formato]',
              messageType: incoming.type === 'text' ? 'text' : 'unsupported',
              timestamp: new Date(timestampMs).toISOString(), createdAt: new Date(timestampMs).toISOString(), read: false
            };
            const inserted = await getRepository().receive({ userId, channel: 'whatsapp',
              phoneNumberId: cfg.phoneNumberId, phone: incoming.from,
              userName: String(contact?.profile?.name || incoming.from).slice(0, 100), identityVerified: false
            }, message, receivedAt);
            if (inserted) notify(message);
          }
          for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
            if (!/^\d{7,15}$/.test(String(status.recipient_id || ''))
              || !/^waop_[a-f0-9]{64}$/.test(String(status.biz_opaque_callback_data || ''))
              || !['sent', 'delivered', 'read', 'failed'].includes(status.status)
              || typeof status.id !== 'string') continue;
            const userId = `whatsapp:${cfg.phoneNumberId}:${status.recipient_id}`;
            const message = await getRepository().delivery(userId, status.biz_opaque_callback_data, status.status, status.id);
            if (message) notify(message);
          }
        }
      }
    },
    async send(userId, text, requestId, actorId) {
      const cfg = scoped(userId);
      const recipient = recipientFor(userId, cfg);
      if (typeof text !== 'string' || !text.trim() || text.trim().length > 4096) {
        throw supportError('Informe uma mensagem de até 4096 caracteres.', 400);
      }
      if (!/^[a-zA-Z0-9_-]{16,128}$/.test(String(requestId || ''))) throw supportError('Identificador de envio inválido.', 400);
      const operationId = `waop_${hash(`${userId}:${requestId}`)}`;
      const reserved = await getRepository().reserve(userId, operationId, text.trim(), actorId, clock());
      if (reserved.existing) return reserved.message;
      // No retries: a timeout can mean the provider accepted the message. The
      // signed status webhook reconciles it using biz_opaque_callback_data.
      let response;
      try {
        const send = post || require('axios').post;
        response = await send(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
          messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient,
          type: 'text', text: { preview_url: false, body: text.trim() },
          biz_opaque_callback_data: operationId
        }, { headers: { Authorization: `Bearer ${cfg.accessToken}` }, timeout: 10000, validateStatus: () => true });
      } catch {
        await getRepository().delivery(userId, operationId, 'unknown');
        throw supportError('Não foi possível confirmar o envio. Aguarde a confirmação da Meta antes de reenviar.', 503);
      }
      const providerMessageId = response.data?.messages?.[0]?.id;
      if (response.status >= 200 && response.status < 300 && typeof providerMessageId === 'string') {
        const message = await getRepository().delivery(userId, operationId, 'accepted', providerMessageId);
        if (message) notify(message);
        return message;
      }
      const definitiveRejection = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
      const message = await getRepository().delivery(userId, operationId, definitiveRejection ? 'failed' : 'unknown');
      if (message) notify(message);
      const error = supportError(definitiveRejection
        ? 'A Meta recusou o envio. Confira o status do canal antes de tentar novamente.'
        : 'Envio sem confirmação da Meta. Não reenvie até confirmar a entrega.', 503);
      error.code = definitiveRejection ? 'WHATSAPP_REJECTED' : 'WHATSAPP_UNCONFIRMED';
      throw error;
    }
  };
}

module.exports = createWhatsAppSupportService();
module.exports.createWhatsAppSupportService = createWhatsAppSupportService;

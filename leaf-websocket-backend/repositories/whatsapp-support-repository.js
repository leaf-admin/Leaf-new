'use strict';

const { createHash } = require('crypto');
const { supportError } = require('../services/whatsapp-support-config');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DELIVERY_RANK = { sending: 0, unknown: 0, accepted: 1, sent: 2, delivered: 3, read: 4, failed: 5 };

class WhatsAppSupportRepository {
  constructor(db) {
    this.chats = db.collection('support_whatsapp_chats');
    this.db = db;
  }

  ref(userId) { return this.chats.doc(hash(userId)); }
  messageRef(userId, id) { return this.ref(userId).collection('messages').doc(hash(id)); }

  async getChat(userId) {
    const snapshot = await this.ref(userId).get();
    if (!snapshot.exists) throw supportError('Conversa WhatsApp não encontrada.', 404);
    return snapshot.data();
  }

  async list(phoneNumberId, limit, includeClosed) {
    let query = this.chats.where('phoneNumberId', '==', phoneNumberId);
    if (!includeClosed) query = query.where('status', '==', 'active');
    const snapshot = await query.orderBy('lastMessageAt', 'desc').limit(limit).get();
    return snapshot.docs.map((doc) => doc.data())
      .filter((chat) => includeClosed || chat.status !== 'closed')
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, limit);
  }

  async history(userId, limit) {
    const chat = await this.getChat(userId);
    const snapshot = await this.ref(userId).collection('messages').orderBy('timestamp', 'desc').limit(limit).get();
    return snapshot.docs.map((doc) => {
      const message = doc.data();
      return { ...message, read: message.senderType === 'user' && message.timestamp <= (chat.lastReadAt || '') };
    }).reverse();
  }

  async receive(chat, message, receivedAt) {
    const ref = this.ref(chat.userId);
    const messageRef = this.messageRef(chat.userId, message.id);
    return this.db.runTransaction(async (tx) => {
      const [existing, current] = await Promise.all([tx.get(messageRef), tx.get(ref)]);
      if (existing.exists) return false;
      const previous = current.exists ? current.data() : {};
      const incomingMs = Date.parse(message.timestamp);
      const lastInboundAt = Math.max(previous.lastInboundAt || 0, Math.min(incomingMs, receivedAt));
      const latest = !previous.lastMessageAt || message.timestamp >= previous.lastMessageAt;
      tx.set(messageRef, message);
      tx.set(ref, {
        ...previous, ...chat, status: 'active',
        createdAt: previous.createdAt || new Date(receivedAt).toISOString(),
        updatedAt: new Date(receivedAt).toISOString(),
        lastInboundAt, replyWindowExpiresAt: new Date(lastInboundAt + WINDOW_MS).toISOString(),
        lastMessageAt: latest ? message.timestamp : previous.lastMessageAt,
        lastMessage: latest ? message : previous.lastMessage,
        messageCount: Number(previous.messageCount || 0) + 1,
        unreadFromUser: Number(previous.unreadFromUser || 0) + 1
      });
      return true;
    });
  }

  async reserve(userId, operationId, text, actorId, now) {
    const chatRef = this.ref(userId);
    const messageRef = this.messageRef(userId, operationId);
    return this.db.runTransaction(async (tx) => {
      const [chatSnapshot, messageSnapshot] = await Promise.all([tx.get(chatRef), tx.get(messageRef)]);
      if (!chatSnapshot.exists) throw supportError('Conversa não encontrada.', 404);
      const chat = chatSnapshot.data();
      if (messageSnapshot.exists) {
        const message = messageSnapshot.data();
        if (message.message !== text || message.actorId !== actorId) throw supportError('Chave de envio já utilizada.', 409);
        if (['sending', 'unknown'].includes(message.deliveryStatus)) {
          throw supportError('Envio aguardando confirmação da Meta. Não reenvie a mensagem.', 409);
        }
        if (message.deliveryStatus === 'failed') throw supportError('Envio anterior recusado. Atualize a conversa antes de tentar novamente.', 409);
        return { existing: true, message };
      }
      if (chat.status === 'closed') throw supportError('Conversa encerrada. Aguarde uma nova mensagem do contato.', 409);
      if (!chat.lastInboundAt || now >= chat.lastInboundAt + WINDOW_MS) {
        throw supportError('A janela de 24 horas terminou. Aguarde uma nova mensagem do contato.', 409);
      }
      if (chat.pendingOperationId) throw supportError('Há um envio aguardando confirmação da Meta. Não reenvie.', 409);
      const timestamp = new Date(now).toISOString();
      const message = { id: operationId, userId, channel: 'whatsapp', message: text,
        senderType: 'agent', actorId, timestamp, createdAt: timestamp, deliveryStatus: 'sending' };
      tx.set(messageRef, message);
      tx.update(chatRef, { pendingOperationId: operationId, updatedAt: timestamp });
      return { existing: false, message };
    });
  }

  async delivery(userId, operationId, status, providerMessageId = null) {
    const chatRef = this.ref(userId);
    const messageRef = this.messageRef(userId, operationId);
    return this.db.runTransaction(async (tx) => {
      const [chatSnapshot, messageSnapshot] = await Promise.all([tx.get(chatRef), tx.get(messageRef)]);
      if (!chatSnapshot.exists || !messageSnapshot.exists) return null;
      const chat = chatSnapshot.data();
      const previous = messageSnapshot.data();
      if (providerMessageId && previous.providerMessageId && previous.providerMessageId !== providerMessageId) return null;
      if (status === 'failed' && ['delivered', 'read'].includes(previous.deliveryStatus)) return previous;
      if ((DELIVERY_RANK[status] ?? -1) < (DELIVERY_RANK[previous.deliveryStatus] ?? 0)) return previous;
      const message = { ...previous, deliveryStatus: status,
        providerMessageId: providerMessageId || previous.providerMessageId || null };
      tx.set(messageRef, message);
      const definitive = ['accepted', 'sent', 'delivered', 'read', 'failed'].includes(status);
      const update = { updatedAt: new Date().toISOString() };
      if (chat.pendingOperationId === operationId && definitive) update.pendingOperationId = null;
      if (!['sending', 'unknown', 'failed'].includes(status) && !previous.counted) {
        message.counted = true;
        tx.set(messageRef, message);
        update.messageCount = Number(chat.messageCount || 0) + 1;
      }
      if (!chat.lastMessageAt || message.timestamp >= chat.lastMessageAt) {
        update.lastMessage = message;
        update.lastMessageAt = message.timestamp;
      }
      tx.update(chatRef, update);
      return message;
    });
  }

  async markRead(userId) {
    await this.getChat(userId);
    await this.ref(userId).update({ unreadFromUser: 0, lastReadAt: new Date().toISOString() });
  }

  async close(userId) {
    await this.getChat(userId);
    await this.ref(userId).update({ status: 'closed', closedAt: new Date().toISOString() });
  }
}

module.exports = { WhatsAppSupportRepository, WINDOW_MS, hash };

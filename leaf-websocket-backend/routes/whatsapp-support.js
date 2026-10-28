'use strict';

const express = require('express');
const service = require('../services/whatsapp-support-service');
const { getConfig, assertConfigured, secureEquals, validSignature, isWhatsAppChat, supportError } = require('../services/whatsapp-support-config');
const { authenticateSupport, isSupportAgent } = require('../middleware/support-auth');

const webhook = express.Router();
const conversations = express.Router();

function respondError(res, error) {
  // Never return/log provider payloads, access tokens or customer messages.
  return res.status(error.status || 503).json({ success: false,
    error: error.status ? error.message : 'Canal WhatsApp temporariamente indisponível.',
    code: error.code || null });
}

webhook.get('/', (req, res) => {
  try {
    const config = getConfig();
    assertConfigured(config);
    if (req.query['hub.mode'] !== 'subscribe'
      || !secureEquals(req.query['hub.verify_token'], config.verifyToken)
      || !/^\d{1,256}$/.test(String(req.query['hub.challenge'] || ''))) {
      return res.sendStatus(403);
    }
    return res.type('text/plain').send(String(req.query['hub.challenge']));
  } catch (error) { return respondError(res, error); }
});

webhook.post('/', async (req, res) => {
  try {
    const config = getConfig();
    assertConfigured(config);
    if (!validSignature(req.rawBody, req.headers['x-hub-signature-256'], config.appSecret)) return res.sendStatus(403);
    if (req.rawBody.length > 1024 * 1024) return res.sendStatus(413);
    await service.receive(req.body);
    // Only acknowledge after durable storage; Meta can retry failures.
    return res.sendStatus(200);
  } catch (error) { return respondError(res, error); }
});

// Only reserve external identities; native Leaf chat routes continue unchanged.
conversations.use('/chat/:userId', (req, _res, next) => {
  if (!isWhatsAppChat(req.params.userId)) return next('router');
  req.whatsappChatId = req.params.userId;
  return next();
}, authenticateSupport, (req, res, next) => {
  if (!isSupportAgent(req.user) || req.user.readOnly === true && req.method !== 'GET') return res.sendStatus(403);
  const scopes = [req.query.scope, req.headers['x-leaf-support-scope']].filter(Boolean);
  if (scopes.some((scope) => scope !== 'operational')) return res.sendStatus(403);
  return next();
});

conversations.use('/chat/:userId', async (req, res) => {
  try {
    const id = req.whatsappChatId;
    if (req.method === 'GET' && req.path === '/history') {
      const messages = await service.history(id, req.query.limit);
      return res.json({ success: true, messages, count: messages.length });
    }
    if (req.method === 'GET' && req.path === '/status') return res.json({ success: true, status: await service.status(id) });
    if (req.method === 'POST' && req.path === '/message') {
      const message = await service.send(id, req.body?.message, req.headers['idempotency-key'], String(req.user.id || req.user.uid));
      return res.json({ success: true, message });
    }
    if (req.method === 'POST' && req.path === '/mark-read') {
      await service.markRead(id);
      return res.json({ success: true });
    }
    if (req.method === 'POST' && req.path === '/close') {
      await service.close(id);
      return res.json({ success: true });
    }
    if (req.path === '/convert-ticket') {
      throw supportError('Contato WhatsApp sem identidade Leaf verificada. Abra um chamado após confirmar a identidade.', 409);
    }
    return res.sendStatus(404);
  } catch (error) { return respondError(res, error); }
});

module.exports = { webhook, conversations };

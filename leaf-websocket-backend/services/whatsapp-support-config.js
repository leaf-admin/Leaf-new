'use strict';

const crypto = require('crypto');

function supportError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getConfig(env = process.env) {
  return {
    enabled: env.WHATSAPP_SUPPORT_ENABLED === 'true',
    appSecret: String(env.WHATSAPP_SUPPORT_APP_SECRET || '').trim(),
    verifyToken: String(env.WHATSAPP_SUPPORT_VERIFY_TOKEN || '').trim(),
    accessToken: String(env.WHATSAPP_SUPPORT_ACCESS_TOKEN || '').trim(),
    phoneNumberId: String(env.WHATSAPP_SUPPORT_PHONE_NUMBER_ID || '').trim(),
    wabaId: String(env.WHATSAPP_SUPPORT_WABA_ID || '').trim(),
    graphVersion: String(env.WHATSAPP_SUPPORT_GRAPH_VERSION || 'v25.0').trim()
  };
}

function assertConfigured(config) {
  if (!config.enabled || !config.appSecret || !config.verifyToken || !config.accessToken
    || !/^\d+$/.test(config.phoneNumberId) || !/^\d+$/.test(config.wabaId)
    || !/^v\d+\.\d+$/.test(config.graphVersion)) {
    throw supportError('Canal WhatsApp indisponível.');
  }
}

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !/^sha256=[a-f0-9]{64}$/.test(String(signature || '')) || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return secureEquals(signature, expected);
}

function isWhatsAppChat(id) {
  return String(id || '').startsWith('whatsapp:');
}

function recipientFor(id, config) {
  const match = /^whatsapp:(\d+):(\d{7,15})$/.exec(String(id || ''));
  if (!match || match[1] !== config.phoneNumberId) throw supportError('Conversa WhatsApp inválida.', 404);
  return match[2];
}

module.exports = { getConfig, assertConfigured, secureEquals, validSignature, isWhatsAppChat, recipientFor, supportError };

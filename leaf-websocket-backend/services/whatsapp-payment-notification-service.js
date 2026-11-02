const axios = require('axios');
const { logger } = require('../utils/logger');
const {
  DEFAULT_GRAPH_BASE_URL,
  DEFAULT_GRAPH_VERSION,
  normalizeRecipient
} = require('./whatsapp-otp-service');

const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';
const DEFAULT_CONFIRMED_TEMPLATE = 'leaf_pagamento_confirmado';
const DEFAULT_CONFIRMED_NO_TOLL_TEMPLATE = 'leaf_pagamento_confirmado_sem_pedagio';
const DEFAULT_TIMEOUT_MS = 10000;
// The context only has to outlive the Pix charge; the sent marker blocks a
// second paid message when the webhook and a retry both confirm the charge.
const CONTEXT_TTL_SECONDS = 2 * 60 * 60;
const SENT_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60;
// Meta rejects template parameters with line breaks, tabs or long runs of spaces.
const MAX_TEXT_PARAMETER_LENGTH = 60;

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on', 'sim'].includes(String(value ?? '').trim().toLowerCase());
}

function getWhatsAppPaymentNotificationConfig(env = process.env) {
  const enabled = isTruthy(env.WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED);
  const accessToken = String(env.WHATSAPP_META_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(env.WHATSAPP_META_PHONE_NUMBER_ID || '').trim();
  const timeoutMs = Number.parseInt(env.WHATSAPP_OTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS, 10);

  const missing = [];
  if (enabled && !accessToken) missing.push('WHATSAPP_META_ACCESS_TOKEN');
  if (enabled && !phoneNumberId) missing.push('WHATSAPP_META_PHONE_NUMBER_ID');

  return {
    enabled,
    configured: enabled && missing.length === 0,
    missing,
    accessToken,
    phoneNumberId,
    graphBaseUrl: String(env.WHATSAPP_META_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL)
      .trim()
      .replace(/\/+$/, ''),
    graphVersion: String(env.WHATSAPP_META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim(),
    templateLanguage: String(
      env.WHATSAPP_PAYMENT_TEMPLATE_LANGUAGE || DEFAULT_TEMPLATE_LANGUAGE
    ).trim(),
    confirmedTemplate: String(
      env.WHATSAPP_PAYMENT_CONFIRMED_TEMPLATE || DEFAULT_CONFIRMED_TEMPLATE
    ).trim(),
    confirmedNoTollTemplate: String(
      env.WHATSAPP_PAYMENT_CONFIRMED_NO_TOLL_TEMPLATE || DEFAULT_CONFIRMED_NO_TOLL_TEMPLATE
    ).trim(),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS
  };
}

function contextKey(chargeId) {
  return `whatsapp_pix_ctx:${chargeId}`;
}

function sentMarkerKey(chargeId) {
  return `whatsapp_pix_sent:${chargeId}:confirmed`;
}

function sanitizeTextParameter(value, fallback) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return fallback;
  if (text.length <= MAX_TEXT_PARAMETER_LENGTH) return text;
  return `${text.slice(0, MAX_TEXT_PARAMETER_LENGTH - 3).trimEnd()}...`;
}

function firstName(fullName) {
  return sanitizeTextParameter(String(fullName || '').trim().split(/\s+/)[0], 'passageiro');
}

function formatCentsAsReais(cents) {
  const value = Math.max(0, Math.round(Number(cents) || 0)) / 100;
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function textParameter(text) {
  return { type: 'text', text };
}

function buildPaymentConfirmedPayload({ to, context, amountInCents, config }) {
  const tollCents = Math.max(0, Math.round(Number(context.tollCents) || 0));
  const hasToll = tollCents > 0;
  const parameters = [
    textParameter(firstName(context.passengerName)),
    textParameter(formatCentsAsReais(amountInCents)),
    textParameter(sanitizeTextParameter(context.destination, 'seu destino'))
  ];
  if (hasToll) parameters.push(textParameter(formatCentsAsReais(tollCents)));

  return {
    messaging_product: 'whatsapp',
    to: normalizeRecipient(to),
    type: 'template',
    template: {
      name: hasToll ? config.confirmedTemplate : config.confirmedNoTollTemplate,
      language: { code: config.templateLanguage },
      components: [{ type: 'body', parameters }]
    }
  };
}

// Called when the Pix charge is created. Only the phone verified in the
// passenger's Firebase token is stored, never a phone sent in the request body.
async function rememberPixChargeContext({
  redis,
  chargeId,
  passengerId,
  verifiedPhone,
  passengerName,
  destination,
  tollCents,
  env = process.env
}) {
  const config = getWhatsAppPaymentNotificationConfig(env);
  const safeChargeId = String(chargeId || '').trim();
  const phone = String(verifiedPhone || '').trim();
  if (!config.enabled || !redis || !safeChargeId || !phone) {
    return { stored: false };
  }

  const context = {
    passengerId: String(passengerId || '').trim() || null,
    phone,
    passengerName: String(passengerName || '').trim(),
    destination: String(destination || '').trim(),
    tollCents: Math.max(0, Math.round(Number(tollCents) || 0))
  };
  await redis.set(contextKey(safeChargeId), JSON.stringify(context), 'EX', CONTEXT_TTL_SECONDS);
  return { stored: true };
}

// Called after the Pix webhook confirms the charge. Never throws: a failed
// WhatsApp message must not affect payment confirmation or dispatch.
async function sendPaymentConfirmedNotification({
  redis,
  chargeId,
  amountInCents,
  axiosClient = axios,
  env = process.env
}) {
  const safeChargeId = String(chargeId || '').trim();
  try {
    const config = getWhatsAppPaymentNotificationConfig(env);
    if (!config.configured || !redis || !safeChargeId) {
      return { sent: false, reason: 'DISABLED' };
    }

    const rawContext = await redis.get(contextKey(safeChargeId));
    if (!rawContext) return { sent: false, reason: 'NO_CONTEXT' };
    const context = JSON.parse(rawContext);

    const claimed = await redis.set(
      sentMarkerKey(safeChargeId),
      new Date().toISOString(),
      'EX',
      SENT_MARKER_TTL_SECONDS,
      'NX'
    );
    if (claimed !== 'OK') return { sent: false, reason: 'ALREADY_SENT' };

    const payload = buildPaymentConfirmedPayload({
      to: context.phone,
      context,
      amountInCents,
      config
    });
    // A single attempt: a retried timeout could deliver two paid messages.
    const response = await axiosClient.post(
      `${config.graphBaseUrl}/${config.graphVersion}/${config.phoneNumberId}/messages`,
      payload,
      {
        timeout: config.timeoutMs,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const messageId = response?.data?.messages?.[0]?.id || null;
    logger.info('[WHATSAPP PAYMENT] payment confirmed message accepted', {
      service: 'whatsapp-payment-notification-service',
      chargeId: safeChargeId,
      template: payload.template.name,
      phoneLast4: String(context.phone).replace(/\D/g, '').slice(-4),
      messageId
    });
    return { sent: true, messageId };
  } catch (error) {
    logger.warn('[WHATSAPP PAYMENT] payment confirmed message failed', {
      service: 'whatsapp-payment-notification-service',
      chargeId: safeChargeId || null,
      providerStatus: Number(error?.response?.status) || null,
      code: error?.code || null
    });
    return { sent: false, reason: 'DELIVERY_FAILED' };
  }
}

module.exports = {
  CONTEXT_TTL_SECONDS,
  SENT_MARKER_TTL_SECONDS,
  getWhatsAppPaymentNotificationConfig,
  sanitizeTextParameter,
  formatCentsAsReais,
  buildPaymentConfirmedPayload,
  rememberPixChargeContext,
  sendPaymentConfirmedNotification
};

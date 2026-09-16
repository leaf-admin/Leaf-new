const axios = require('axios');
const { logger } = require('../utils/logger');

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v23.0';
const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 150;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETRESET',
  'ETIMEDOUT'
]);

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on', 'sim'].includes(String(value ?? '').trim().toLowerCase());
}

function hasPlaceholder(value) {
  return /^(your_|<|>)/i.test(String(value || '').trim());
}

function providerName(env = process.env) {
  const explicitProvider = String(env.AUTH_OTP_PROVIDER || '').trim().toLowerCase();
  if (explicitProvider) return explicitProvider;
  return isTruthy(env.WHATSAPP_OTP_ENABLED) ? 'whatsapp' : 'simulation';
}

function getWhatsAppOtpConfig(env = process.env) {
  const provider = providerName(env);
  const enabled = provider === 'whatsapp';
  const accessToken = String(env.WHATSAPP_META_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(env.WHATSAPP_META_PHONE_NUMBER_ID || '').trim();
  const templateName = String(env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
  const templateLanguage = String(
    env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || DEFAULT_TEMPLATE_LANGUAGE
  ).trim();
  const graphBaseUrl = String(env.WHATSAPP_META_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
  const graphVersion = String(env.WHATSAPP_META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim();
  const timeoutMs = Number.parseInt(env.WHATSAPP_OTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS, 10);
  const maxAttempts = Number.parseInt(env.WHATSAPP_OTP_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS, 10);
  const retryDelayMs = Number.parseInt(env.WHATSAPP_OTP_RETRY_DELAY_MS || DEFAULT_RETRY_DELAY_MS, 10);

  const missing = [];
  if (enabled && (!accessToken || hasPlaceholder(accessToken))) missing.push('WHATSAPP_META_ACCESS_TOKEN');
  if (enabled && (!phoneNumberId || hasPlaceholder(phoneNumberId))) missing.push('WHATSAPP_META_PHONE_NUMBER_ID');
  if (enabled && (!templateName || hasPlaceholder(templateName))) missing.push('WHATSAPP_OTP_TEMPLATE_NAME');
  if (enabled && !templateLanguage) missing.push('WHATSAPP_OTP_TEMPLATE_LANGUAGE');

  return {
    provider,
    enabled,
    configured: enabled && missing.length === 0,
    missing,
    accessToken,
    phoneNumberId,
    templateName,
    templateLanguage,
    graphBaseUrl,
    graphVersion,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 3
      ? maxAttempts
      : DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: Number.isFinite(retryDelayMs) && retryDelayMs >= 0 && retryDelayMs <= 2000
      ? retryDelayMs
      : DEFAULT_RETRY_DELAY_MS
  };
}

function normalizeRecipient(phoneNumber) {
  const digits = String(phoneNumber || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    const error = new Error('Invalid WhatsApp recipient');
    error.code = 'WHATSAPP_OTP_INVALID_RECIPIENT';
    throw error;
  }
  return digits;
}

function buildAuthenticationTemplatePayload({
  to,
  otp,
  templateName,
  templateLanguage
}) {
  const code = String(otp || '').trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('OTP must contain exactly 6 digits');
    error.code = 'OTP_INVALID_FORMAT';
    throw error;
  }

  return {
    messaging_product: 'whatsapp',
    to: normalizeRecipient(to),
    type: 'template',
    template: {
      name: String(templateName || '').trim(),
      language: { code: String(templateLanguage || '').trim() },
      components: [
        {
          type: 'body',
          parameters: [{ type: 'text', text: code }]
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }]
        }
      ]
    }
  };
}

function buildMessagesUrl(config) {
  return `${config.graphBaseUrl}/${config.graphVersion}/${config.phoneNumberId}/messages`;
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDeliveryError() {
  const error = new Error('Falha ao enviar OTP via WhatsApp');
  error.code = 'WHATSAPP_OTP_DELIVERY_FAILED';
  error.status = 502;
  return error;
}

function isRetryableDeliveryError(error) {
  const status = Number(error?.response?.status) || null;
  if (status != null) return RETRYABLE_HTTP_STATUSES.has(status);
  if (RETRYABLE_NETWORK_CODES.has(String(error?.code || '').trim().toUpperCase())) {
    return true;
  }
  return Boolean(error?.request && !error?.response);
}

async function sendOtp({
  phoneNumber,
  otp,
  verificationId,
  axiosClient = axios,
  env = process.env
}) {
  const config = getWhatsAppOtpConfig(env);
  if (!config.enabled || !config.configured) {
    const error = new Error('WhatsApp OTP provider is not configured');
    error.code = 'WHATSAPP_OTP_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const payload = buildAuthenticationTemplatePayload({
    to: phoneNumber,
    otp,
    templateName: config.templateName,
    templateLanguage: config.templateLanguage
  });
  let lastStatus = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const response = await axiosClient.post(buildMessagesUrl(config), payload, {
        timeout: config.timeoutMs,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      const messageId = response?.data?.messages?.[0]?.id || null;
      logger.info('[WHATSAPP OTP] delivery accepted', {
        service: 'whatsapp-otp-service',
        phoneLast4: String(phoneNumber || '').replace(/\D/g, '').slice(-4),
        verificationId: String(verificationId || '').trim() || null,
        messageId
      });
      return { provider: 'whatsapp', messageId };
    } catch (error) {
      lastStatus = Number(error?.response?.status) || null;
      const retryable = isRetryableDeliveryError(error);
      if (!retryable || attempt >= config.maxAttempts) break;
      await delay(config.retryDelayMs);
    }
  }

  logger.warn('[WHATSAPP OTP] delivery failed', {
    service: 'whatsapp-otp-service',
    phoneLast4: String(phoneNumber || '').replace(/\D/g, '').slice(-4),
    verificationId: String(verificationId || '').trim() || null,
    providerStatus: lastStatus
  });
  throw safeDeliveryError();
}

module.exports = {
  DEFAULT_GRAPH_BASE_URL,
  DEFAULT_GRAPH_VERSION,
  getWhatsAppOtpConfig,
  normalizeRecipient,
  buildAuthenticationTemplatePayload,
  buildMessagesUrl,
  isRetryableDeliveryError,
  sendOtp
};

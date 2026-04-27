const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

const DEFAULT_BYPASS_PHONES = ['11999999999', '11888888888'];
const DEFAULT_BYPASS_OTP_CODE = '000000';

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeBypassPhone(rawPhone) {
  const digits = normalizePhoneDigits(rawPhone);
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith('55') && digits.length > 11) {
    variants.add(digits.slice(2));
  } else if (digits.length === 11) {
    variants.add(`55${digits}`);
  }

  return [...variants];
}

function parseBypassPhoneEnv(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isBypassEnabled() {
  const raw = String(process.env.AUTH_TEST_OTP_BYPASS_ENABLED || 'true').trim().toLowerCase();
  return !process.env.AUTH_TEST_OTP_BYPASS_ENABLED || TRUTHY_VALUES.has(raw);
}

function getBypassPhoneSet() {
  const envPhones = parseBypassPhoneEnv(process.env.AUTH_TEST_OTP_BYPASS_PHONES);
  const configuredPhones = envPhones.length ? envPhones : DEFAULT_BYPASS_PHONES;
  const normalized = new Set();

  configuredPhones.forEach((phone) => {
    normalizeBypassPhone(phone).forEach((variant) => normalized.add(variant));
  });

  return normalized;
}

function getBypassOtpCode() {
  const candidate = String(process.env.AUTH_TEST_OTP_BYPASS_CODE || DEFAULT_BYPASS_OTP_CODE).trim();
  return /^\d{6}$/.test(candidate) ? candidate : DEFAULT_BYPASS_OTP_CODE;
}

function isOtpBypassPhone(phone) {
  if (!isBypassEnabled()) return false;

  const phoneVariants = normalizeBypassPhone(phone);
  if (!phoneVariants.length) return false;

  const bypassPhones = getBypassPhoneSet();
  return phoneVariants.some((variant) => bypassPhones.has(variant));
}

module.exports = {
  DEFAULT_BYPASS_PHONES,
  DEFAULT_BYPASS_OTP_CODE,
  normalizePhoneDigits,
  getBypassOtpCode,
  isOtpBypassPhone,
  isBypassEnabled
};

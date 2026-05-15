const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);

const DEFAULT_BYPASS_PHONE_CODES = Object.freeze({
  '21102938475': '992111',
  '5521102938475': '992111',
  '21123456789': '992000',
  '5521123456789': '992000'
});
const DEFAULT_BYPASS_PHONES = ['21102938475', '21123456789'];
const DEFAULT_BYPASS_OTP_CODE = '992111';
const DEFAULT_REVIEW_CREDENTIAL_PHONES = [...DEFAULT_BYPASS_PHONES];

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

function parseBypassPhoneCodeEnv(rawValue) {
  const parsed = {};
  String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const [rawPhone, rawCode] = item.split(/[:=]/);
      const phone = normalizePhoneDigits(rawPhone);
      const code = String(rawCode || '').trim();
      if (phone && /^\d{6}$/.test(code)) {
        normalizeBypassPhone(phone).forEach((variant) => {
          parsed[variant] = code;
        });
      }
    });
  return parsed;
}

function isBypassEnabled() {
  const rawFlag = process.env.AUTH_TEST_OTP_BYPASS_ENABLED;
  if (rawFlag === undefined || rawFlag === null) {
    return false;
  }

  const raw = String(rawFlag).trim().toLowerCase();
  return TRUTHY_VALUES.has(raw);
}

function isReviewOtpBypassEnabled() {
  const reviewMode = String(process.env.APP_REVIEW || '').trim().toLowerCase();
  if (!TRUTHY_VALUES.has(reviewMode)) {
    return false;
  }

  const explicitReviewBypass = String(process.env.AUTH_REVIEW_OTP_BYPASS_ENABLED || '').trim().toLowerCase();
  return TRUTHY_VALUES.has(explicitReviewBypass);
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

function getReviewCredentialPhoneSet() {
  const envPhones = parseBypassPhoneEnv(process.env.AUTH_REVIEW_CREDENTIAL_PHONES);
  const configuredPhones = envPhones.length ? envPhones : DEFAULT_REVIEW_CREDENTIAL_PHONES;
  const normalized = new Set();

  configuredPhones.forEach((phone) => {
    normalizeBypassPhone(phone).forEach((variant) => normalized.add(variant));
  });

  return normalized;
}

function getBypassOtpCode(phone = '') {
  const explicitGlobalCode = String(process.env.AUTH_TEST_OTP_BYPASS_CODE || '').trim();
  if (/^\d{6}$/.test(explicitGlobalCode)) {
    return explicitGlobalCode;
  }

  const phoneCodes = {
    ...DEFAULT_BYPASS_PHONE_CODES,
    ...parseBypassPhoneCodeEnv(process.env.AUTH_TEST_OTP_BYPASS_PHONE_CODES)
  };
  const variants = normalizeBypassPhone(phone);
  for (const variant of variants) {
    if (/^\d{6}$/.test(String(phoneCodes[variant] || ''))) {
      return phoneCodes[variant];
    }
  }

  const candidate = String(process.env.AUTH_TEST_OTP_BYPASS_DEFAULT_CODE || DEFAULT_BYPASS_OTP_CODE).trim();
  return /^\d{6}$/.test(candidate) ? candidate : DEFAULT_BYPASS_OTP_CODE;
}

function isOtpBypassPhone(phone) {
  if (!isBypassEnabled()) return false;

  const phoneVariants = normalizeBypassPhone(phone);
  if (!phoneVariants.length) return false;

  const bypassPhones = getBypassPhoneSet();
  return phoneVariants.some((variant) => bypassPhones.has(variant));
}

function isReviewCredentialPhone(phone) {
  const phoneVariants = normalizeBypassPhone(phone);
  if (!phoneVariants.length) return false;

  const reviewPhones = getReviewCredentialPhoneSet();
  return phoneVariants.some((variant) => reviewPhones.has(variant));
}

module.exports = {
  DEFAULT_BYPASS_PHONES,
  DEFAULT_BYPASS_PHONE_CODES,
  DEFAULT_BYPASS_OTP_CODE,
  DEFAULT_REVIEW_CREDENTIAL_PHONES,
  normalizePhoneDigits,
  getBypassOtpCode,
  isOtpBypassPhone,
  isReviewCredentialPhone,
  isBypassEnabled,
  isReviewOtpBypassEnabled
};

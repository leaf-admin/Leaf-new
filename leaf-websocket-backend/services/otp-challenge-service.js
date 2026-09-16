const crypto = require('crypto');
const redisPool = require('../utils/redis-pool');

const OTP_LENGTH = 6;
const DEVELOPMENT_HMAC_FALLBACK = 'leaf-development-otp-hmac-key-change-me';
const ATOMIC_CONSUME_SCRIPT = `
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    for _, alias in ipairs(KEYS) do
      redis.call('DEL', alias)
    end
    return 1
  end
end
return 0
`;

function isProductionRuntime(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function getOtpHmacKey(env = process.env) {
  const configuredKey = String(env.AUTH_OTP_HMAC_KEY || '').trim();
  if (configuredKey) {
    return Buffer.from(configuredKey, 'utf8');
  }

  // Simulation is intentionally available only outside production. A real
  // deployment must provide a dedicated secret so OTP hashes are independent
  // from JWT/password secrets and stable across gateway instances.
  if (!isProductionRuntime(env)) {
    const jwtFallback = String(env.JWT_SECRET || '').trim();
    const developmentKey = jwtFallback.length >= 32 ? jwtFallback : DEVELOPMENT_HMAC_FALLBACK;
    return Buffer.from(developmentKey, 'utf8');
  }

  return null;
}

function assertOtpHmacKey(env = process.env) {
  const key = getOtpHmacKey(env);
  if (!key || key.length < 32) {
    const error = new Error('AUTH_OTP_HMAC_KEY must contain at least 32 bytes');
    error.code = 'AUTH_OTP_HMAC_KEY_NOT_CONFIGURED';
    throw error;
  }
  return key;
}

function normalizePhoneE164(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(OTP_LENGTH, '0');
}

function generateVerificationId(prefix = 'vid') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(9).toString('base64url')}`;
}

function buildOtpContext({ namespace, verificationId, phone }) {
  return [
    String(namespace || 'auth_otp').trim(),
    String(verificationId || '').trim(),
    normalizePhoneE164(phone)
  ].join(':');
}

function hashOtp({ namespace, verificationId, phone, otp, env = process.env }) {
  const code = String(otp || '').trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('OTP must contain exactly 6 digits');
    error.code = 'OTP_INVALID_FORMAT';
    throw error;
  }

  return crypto
    .createHmac('sha256', assertOtpHmacKey(env))
    .update(`${buildOtpContext({ namespace, verificationId, phone })}:${code}`, 'utf8')
    .digest('hex');
}

function hashesMatch(storedHash, expectedHash) {
  const stored = Buffer.from(String(storedHash || ''), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  if (!stored.length || stored.length !== expected.length) return false;
  return crypto.timingSafeEqual(stored, expected);
}

function normalizeKeys(keys) {
  return Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || '').trim())
    .filter(Boolean)));
}

async function storeChallenge({
  namespace,
  verificationId,
  phone,
  otp,
  keys,
  ttlSeconds = 300,
  env = process.env
}) {
  const storageKeys = normalizeKeys(keys);
  if (!storageKeys.length) {
    const error = new Error('OTP storage key is required');
    error.code = 'OTP_STORAGE_KEY_REQUIRED';
    throw error;
  }

  const hash = hashOtp({ namespace, verificationId, phone, otp, env });
  const redis = redisPool.getConnection();
  try {
    await Promise.all(storageKeys.map((key) => (
      redis.set(key, hash, 'EX', Number(ttlSeconds))
    )));
  } catch (error) {
    // A partial alias write must never leave a challenge usable after a failed
    // request; remove every alias before returning the storage error.
    await redis.del(...storageKeys).catch(() => undefined);
    throw error;
  }

  return { keys: storageKeys, hash };
}

async function consumeChallenge({
  namespace,
  verificationId,
  phone,
  otp,
  keys,
  env = process.env
}) {
  const storageKeys = normalizeKeys(keys);
  if (!storageKeys.length) return false;

  const expectedHash = hashOtp({ namespace, verificationId, phone, otp, env });
  const redis = redisPool.getConnection();

  // ioredis supports EVAL and executes this compare-and-delete atomically,
  // preventing two concurrent verification requests from consuming the same
  // challenge. Lightweight unit-test doubles may omit EVAL, so retain the
  // sequential fallback for those adapters only.
  if (typeof redis.eval === 'function') {
    const result = await redis.eval(
      ATOMIC_CONSUME_SCRIPT,
      storageKeys.length,
      ...storageKeys,
      expectedHash
    );
    return Number(result) === 1;
  }

  for (const key of storageKeys) {
    const storedHash = await redis.get(key);
    if (!hashesMatch(storedHash, expectedHash)) continue;

    await redis.del(...storageKeys);
    return true;
  }

  return false;
}

async function deleteChallenge(keys) {
  const storageKeys = normalizeKeys(keys);
  if (!storageKeys.length) return 0;
  const redis = redisPool.getConnection();
  return redis.del(...storageKeys);
}

module.exports = {
  OTP_LENGTH,
  normalizePhoneE164,
  generateOtp,
  generateVerificationId,
  hashOtp,
  hashesMatch,
  storeChallenge,
  consumeChallenge,
  deleteChallenge,
  getOtpHmacKey,
  assertOtpHmacKey
};

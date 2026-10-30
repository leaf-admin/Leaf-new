'use strict';

const crypto = require('crypto');

// Backend is the source of truth for custom OTP (WhatsApp) challenges:
// only an HMAC of the code is stored, every challenge expires, wrong codes
// are counted and each phone/IP has send limits. Limits protect the paid
// Meta authentication template from abuse.
const OTP_TTL_SECONDS = 300;
const MAX_VERIFY_ATTEMPTS = 5;
// Matches the 30 s resend timer on the app's OTP screen.
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_SENDS_PER_PHONE_PER_HOUR = 5;
const MAX_SENDS_PER_IP_PER_HOUR = 20;
const HOUR_SECONDS = 3600;
const DEV_HMAC_KEY = 'leaf-dev-only-otp-hmac-key-not-for-production';

function otpError(message, status, code, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function resolveHmacKey(env = process.env) {
  const key = String(env.AUTH_OTP_HMAC_KEY || '').trim();
  if (Buffer.byteLength(key) >= 32) return key;
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production' ? null : DEV_HMAC_KEY;
}

function hashCode({ verificationId, phone, otp, key }) {
  return crypto.createHmac('sha256', key).update(`${verificationId}:${phone}:${otp}`).digest('hex');
}

function sameHash(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length === 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function phoneKey(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function ipKey(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32);
}

async function countWithin(redis, key, windowSeconds) {
  const count = await redis.incr(key);
  if (Number(count) === 1) await redis.expire(key, windowSeconds);
  return Number(count);
}

function createOtpChallengeService({ redis, env = process.env, random = crypto } = {}) {
  const keys = {
    challenge: (id) => `otp:challenge:${id}`,
    attempts: (id) => `otp:attempts:${id}`,
    cooldown: (phone) => `otp:cooldown:${phoneKey(phone)}`,
    phoneHour: (phone) => `otp:sends:phone:${phoneKey(phone)}`,
    ipHour: (ip) => `otp:sends:ip:${ipKey(ip)}`
  };

  return {
    // Reserves a send slot. Must run before the provider is called.
    async reserveSend({ phone, ip }) {
      const cooldown = await redis.set(keys.cooldown(phone), '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
      if (cooldown !== 'OK') {
        throw otpError('Aguarde alguns segundos para pedir um novo código.', 429, 'OTP_RESEND_COOLDOWN',
          { retryAfterSeconds: RESEND_COOLDOWN_SECONDS });
      }
      const [phoneCount, ipCount] = await Promise.all([
        countWithin(redis, keys.phoneHour(phone), HOUR_SECONDS),
        countWithin(redis, keys.ipHour(ip), HOUR_SECONDS)
      ]);
      if (phoneCount > MAX_SENDS_PER_PHONE_PER_HOUR || ipCount > MAX_SENDS_PER_IP_PER_HOUR) {
        throw otpError('Muitos pedidos de código. Tente novamente mais tarde.', 429, 'OTP_SEND_LIMIT',
          { retryAfterSeconds: HOUR_SECONDS });
      }
    },

    // A failed provider send frees the cooldown so the app can fall back to SMS
    // or retry; the hourly counters stay as they are.
    async releaseCooldown(phone) {
      await redis.del(keys.cooldown(phone));
    },

    async create({ phone }) {
      const key = resolveHmacKey(env);
      if (!key) throw otpError('OTP provider not configured for production', 503, 'OTP_PROVIDER_NOT_CONFIGURED');
      const verificationId = `vid_${random.randomBytes(16).toString('hex')}`;
      const otp = String(random.randomInt(0, 1000000)).padStart(6, '0');
      const record = JSON.stringify({ phone, codeHash: hashCode({ verificationId, phone, otp, key }) });
      await redis.set(keys.challenge(verificationId), record, 'EX', OTP_TTL_SECONDS);
      return { verificationId, otp, expiresIn: OTP_TTL_SECONDS };
    },

    async discard(verificationId) {
      await redis.del(keys.challenge(verificationId), keys.attempts(verificationId));
    },

    async verify({ verificationId, phone, otp }) {
      const key = resolveHmacKey(env);
      if (!key) throw otpError('OTP provider not configured for production', 503, 'OTP_PROVIDER_NOT_CONFIGURED');
      const id = String(verificationId || '');
      const expired = () => otpError('Código expirado. Peça um novo código.', 400, 'OTP_EXPIRED');
      if (!/^vid_[a-f0-9]{32}$/.test(id)) throw expired();
      const raw = await redis.get(keys.challenge(id));
      if (!raw) throw expired();
      let record;
      try { record = JSON.parse(raw); } catch { throw expired(); }

      const attempts = await countWithin(redis, keys.attempts(id), OTP_TTL_SECONDS);
      if (attempts > MAX_VERIFY_ATTEMPTS) {
        await redis.del(keys.challenge(id), keys.attempts(id));
        throw otpError('Muitas tentativas. Peça um novo código.', 429, 'OTP_TOO_MANY_ATTEMPTS');
      }
      const code = String(otp || '').trim();
      const matches = record.phone === phone && /^\d{6}$/.test(code)
        && sameHash(record.codeHash, hashCode({ verificationId: id, phone, otp: code, key }));
      if (!matches) {
        throw otpError('Código inválido.', 400, 'OTP_INVALID',
          { attemptsRemaining: Math.max(0, MAX_VERIFY_ATTEMPTS - attempts) });
      }
      // Single use: only the request that actually deletes the challenge wins.
      const removed = await redis.del(keys.challenge(id));
      await redis.del(keys.attempts(id));
      if (Number(removed) !== 1) throw expired();
      return true;
    }
  };
}

module.exports = {
  createOtpChallengeService,
  resolveHmacKey,
  OTP_TTL_SECONDS,
  MAX_VERIFY_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  MAX_SENDS_PER_PHONE_PER_HOUR,
  MAX_SENDS_PER_IP_PER_HOUR
};

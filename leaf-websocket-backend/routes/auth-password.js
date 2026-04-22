const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

const router = express.Router();
const PASSWORD_COLLECTION = 'auth_password_credentials';
const PASSWORD_RESET_TTL_SECONDS = 300;
const PASSWORD_FAILED_ATTEMPTS_LIMIT = Number.parseInt(process.env.AUTH_PASSWORD_FAILED_ATTEMPTS_LIMIT || '5', 10);
const PASSWORD_LOCKOUT_SECONDS = Number.parseInt(process.env.AUTH_PASSWORD_LOCKOUT_SECONDS || '900', 10);
const BCRYPT_ROUNDS = Number.parseInt(process.env.AUTH_PASSWORD_BCRYPT_ROUNDS || '12', 10);

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function hashPhone(phoneDigits) {
  const pepper = process.env.AUTH_PASSWORD_PHONE_HASH_PEPPER || process.env.JWT_SECRET || 'leaf-phone-hash';
  return crypto.createHmac('sha256', pepper).update(String(phoneDigits || '')).digest('hex');
}

function getFirestoreOrThrow() {
  const firestore = firebaseConfig.getFirestore();
  if (!firestore) {
    throw new Error('Firestore não disponível');
  }
  return firestore;
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return { ok: false, error: 'Senha deve ter pelo menos 8 caracteres' };
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return { ok: false, error: 'Senha deve conter letras e números' };
  }
  return { ok: true };
}

async function requireFirebaseUser(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  }
}

async function getCredentialByPhone(phoneDigits) {
  const firestore = getFirestoreOrThrow();
  const phoneHash = hashPhone(phoneDigits);
  const ref = firestore.collection(PASSWORD_COLLECTION).doc(phoneHash);
  const doc = await ref.get();
  return { ref, doc, phoneHash, data: doc.exists ? doc.data() : null };
}

async function recordPasswordAudit(event, payload = {}) {
  logStructured('info', 'Auth password audit', {
    service: 'auth-password-routes',
    event,
    ...payload,
    auditedAt: new Date().toISOString()
  });
}

function lockoutUntilFromData(data = {}) {
  const raw = data.lockedUntil;
  if (!raw) return null;
  if (typeof raw.toDate === 'function') return raw.toDate();
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function generateResetOtp(phoneDigits) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const verificationId = `pwd_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const redis = redisPool.getConnection();
  await redis.set(`password_reset_otp:${verificationId}:${phoneDigits}`, otp, 'EX', PASSWORD_RESET_TTL_SECONDS);

  if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_OTP === 'true') {
    logStructured('info', 'OTP de reset gerado', {
      service: 'auth-password-routes',
      phoneLast4: phoneDigits.slice(-4),
      verificationId
    });
  }

  return { verificationId };
}

async function verifyResetOtp({ phoneDigits, verificationId, otp }) {
  const appReviewOtpBypassEnabled = String(process.env.APP_REVIEW || 'false').toLowerCase() === 'true';
  if (otp === '000000' && appReviewOtpBypassEnabled) {
    return true;
  }
  if (otp === '000000') {
    return false;
  }

  const redis = redisPool.getConnection();
  const key = `password_reset_otp:${verificationId}:${phoneDigits}`;
  const storedOtp = await redis.get(key);
  if (!storedOtp || storedOtp !== otp) {
    return false;
  }
  await redis.del(key);
  return true;
}

router.post('/setup', requireFirebaseUser, async (req, res) => {
  try {
    const { phone, password, confirmPassword } = req.body || {};
    const phoneDigits = normalizePhone(phone || req.firebaseUser.phone_number || req.firebaseUser.phoneNumber);
    const firebasePhoneDigits = normalizePhone(req.firebaseUser.phone_number || req.firebaseUser.phoneNumber);

    if (!phoneDigits) {
      return res.status(400).json({ success: false, error: 'Telefone é obrigatório' });
    }
    if (firebasePhoneDigits && firebasePhoneDigits !== phoneDigits) {
      return res.status(403).json({ success: false, error: 'Telefone não confere com o OTP validado' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Confirmação de senha não confere' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.ok) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    const { ref, doc, phoneHash } = await getCredentialByPhone(phoneDigits);
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await ref.set({
      uid: req.firebaseUser.uid,
      phoneHash,
      phoneLast4: phoneDigits.slice(-4),
      userType: 'customer',
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: now,
      ...(doc.exists ? {} : { createdAt: now })
    }, { merge: true });

    await recordPasswordAudit('password_setup', {
      uid: req.firebaseUser.uid,
      phoneLast4: phoneDigits.slice(-4)
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logError(error, 'Erro ao definir senha do passageiro', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    const phoneDigits = normalizePhone(phone);
    if (!phoneDigits || !password) {
      return res.status(400).json({ success: false, error: 'Telefone e senha são obrigatórios' });
    }

    const { ref, data } = await getCredentialByPhone(phoneDigits);
    const genericError = { success: false, error: 'Telefone ou senha inválidos' };
    if (!data?.passwordHash || !data?.uid) {
      return res.status(401).json(genericError);
    }

    const lockedUntil = lockoutUntilFromData(data);
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      return res.status(423).json({
        success: false,
        error: 'Conta temporariamente bloqueada por tentativas inválidas',
        lockedUntil: lockedUntil.toISOString()
      });
    }

    const passwordMatches = await bcrypt.compare(String(password), data.passwordHash);
    if (!passwordMatches) {
      const failedAttempts = Number(data.failedAttempts || 0) + 1;
      const shouldLock = failedAttempts >= PASSWORD_FAILED_ATTEMPTS_LIMIT;
      await ref.set({
        failedAttempts,
        lockedUntil: shouldLock
          ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + PASSWORD_LOCKOUT_SECONDS * 1000))
          : null,
        lastFailedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await recordPasswordAudit('password_login_failed', {
        phoneLast4: phoneDigits.slice(-4),
        failedAttempts,
        locked: shouldLock
      });

      return res.status(401).json(genericError);
    }

    await ref.set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const customToken = await admin.auth().createCustomToken(data.uid, {
      userType: 'customer',
      authMethod: 'phone_password'
    });

    await recordPasswordAudit('password_login_success', {
      uid: data.uid,
      phoneLast4: phoneDigits.slice(-4)
    });

    return res.status(200).json({
      success: true,
      customToken,
      uid: data.uid,
      userType: 'customer'
    });
  } catch (error) {
    logError(error, 'Erro no login telefone+senha', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

router.post('/reset/request', async (req, res) => {
  try {
    const phoneDigits = normalizePhone(req.body?.phone);
    if (!phoneDigits) {
      return res.status(400).json({ success: false, error: 'Telefone é obrigatório' });
    }

    const { data } = await getCredentialByPhone(phoneDigits);
    if (!data?.uid) {
      return res.status(200).json({ success: true, message: 'Se o telefone existir, enviaremos um OTP.' });
    }

    await redisPool.ensureConnection();
    const { verificationId } = await generateResetOtp(phoneDigits);
    await recordPasswordAudit('password_reset_requested', { phoneLast4: phoneDigits.slice(-4) });

    return res.status(200).json({
      success: true,
      verificationId,
      expiresIn: PASSWORD_RESET_TTL_SECONDS
    });
  } catch (error) {
    logError(error, 'Erro ao solicitar reset de senha', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

router.post('/reset/confirm', async (req, res) => {
  try {
    const { phone, verificationId, otp, password, confirmPassword } = req.body || {};
    const phoneDigits = normalizePhone(phone);
    if (!phoneDigits || !verificationId || !otp) {
      return res.status(400).json({ success: false, error: 'Telefone, verificationId e OTP são obrigatórios' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Confirmação de senha não confere' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.ok) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    await redisPool.ensureConnection();
    const otpValid = await verifyResetOtp({ phoneDigits, verificationId, otp });
    if (!otpValid) {
      return res.status(400).json({ success: false, error: 'OTP inválido ou expirado' });
    }

    const { ref, data } = await getCredentialByPhone(phoneDigits);
    if (!data?.uid) {
      return res.status(404).json({ success: false, error: 'Credencial não encontrada' });
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    await ref.set({
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      passwordResetAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await recordPasswordAudit('password_reset_confirmed', {
      uid: data.uid,
      phoneLast4: phoneDigits.slice(-4)
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logError(error, 'Erro ao confirmar reset de senha', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

module.exports = router;

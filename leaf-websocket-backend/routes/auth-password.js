const express = require('express');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const redisPool = require('../utils/redis-pool');
const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');
const { getBypassOtpCode, isOtpBypassPhone } = require('../utils/test-auth-bypass');

const router = express.Router();
const PASSWORD_COLLECTION = 'auth_password_credentials';
const PASSWORD_RESET_TTL_SECONDS = 300;
const PASSWORD_FAILED_ATTEMPTS_LIMIT = Number.parseInt(process.env.AUTH_PASSWORD_FAILED_ATTEMPTS_LIMIT || '5', 10);
const PASSWORD_LOCKOUT_SECONDS = Number.parseInt(process.env.AUTH_PASSWORD_LOCKOUT_SECONDS || '900', 10);
const BCRYPT_ROUNDS = Number.parseInt(process.env.AUTH_PASSWORD_BCRYPT_ROUNDS || '12', 10);

function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

function buildPhoneLookupCandidates(phoneDigits) {
  const normalizedDigits = normalizePhone(phoneDigits);
  if (!normalizedDigits) return [];

  const candidates = new Set();
  if (normalizedDigits.startsWith('55')) {
    candidates.add(`+${normalizedDigits}`);
    const localDigits = normalizedDigits.slice(2);
    if (localDigits) {
      candidates.add(`+${localDigits}`);
    }
  } else {
    candidates.add(`+55${normalizedDigits}`);
    candidates.add(`+${normalizedDigits}`);
  }

  return Array.from(candidates);
}

function formatPhoneE164(phoneDigits) {
  const normalizedDigits = normalizePhone(phoneDigits);
  if (!normalizedDigits) return null;
  if (normalizedDigits.startsWith('55')) {
    return `+${normalizedDigits}`;
  }
  return `+55${normalizedDigits}`;
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

function normalizeUserType(rawValue, fallback = 'customer') {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'driver') return 'driver';
  if (normalized === 'customer' || normalized === 'passenger') return 'customer';
  return String(fallback || 'customer').toLowerCase() === 'driver' ? 'driver' : 'customer';
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

async function lookupFirebaseAuthUserByPhone(phoneDigits) {
  const candidates = buildPhoneLookupCandidates(phoneDigits);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    try {
      const userRecord = await admin.auth().getUserByPhoneNumber(candidate);
      return { userRecord, phoneNumber: candidate };
    } catch (error) {
      if (error?.code === 'auth/user-not-found') {
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function getRealtimeUserByUid(uid) {
  if (!uid) return null;
  const realtimeDB =
    typeof firebaseConfig.getRealtimeDB === 'function'
      ? firebaseConfig.getRealtimeDB()
      : null;
  if (!realtimeDB) return null;

  try {
    const snapshot = await realtimeDB.ref(`users/${uid}`).once('value');
    return snapshot?.exists() ? snapshot.val() : null;
  } catch (error) {
    logStructured('warn', 'Falha ao consultar perfil no Realtime DB para resolver fluxo de autenticação', {
      service: 'auth-password-routes',
      uid,
      error: error?.message || String(error)
    });
    return null;
  }
}

function buildDefaultRealtimeProfile({ uid, phoneDigits, userType }) {
  const normalizedUserType = normalizeUserType(userType, 'customer');
  const phoneE164 = formatPhoneE164(phoneDigits);
  const nowIso = new Date().toISOString();
  const last4 = String(phoneDigits || '').slice(-4);
  const isDriver = normalizedUserType === 'driver';

  return {
    uid,
    name: last4 ? `Usuário ${last4}` : 'Usuário Leaf',
    firstName: 'Usuário',
    lastName: last4 || 'Leaf',
    mobile: phoneE164,
    phone: phoneE164,
    phoneNumber: phoneE164,
    usertype: normalizedUserType,
    userType: normalizedUserType,
    approved: !isDriver,
    isApproved: !isDriver,
    status: isDriver ? 'pending' : 'active',
    phoneValidated: true,
    profileComplete: false,
    onboardingCompleted: false,
    hasPassword: true,
    createdVia: 'auth_password',
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLogin: nowIso
  };
}

async function ensureRealtimeProfileForPasswordAuth({ uid, phoneDigits, userType }) {
  if (!uid) return;
  const realtimeDB =
    typeof firebaseConfig.getRealtimeDB === 'function'
      ? firebaseConfig.getRealtimeDB()
      : null;
  if (!realtimeDB) return;

  const userRef = realtimeDB.ref(`users/${uid}`);
  const existingSnapshot = await userRef.once('value');
  const existing = existingSnapshot?.exists() ? existingSnapshot.val() : null;

  if (!existing) {
    await userRef.set(buildDefaultRealtimeProfile({ uid, phoneDigits, userType }));
    return;
  }

  const nowIso = new Date().toISOString();
  const phoneE164 = formatPhoneE164(phoneDigits);
  const normalizedUserType = normalizeUserType(
    existing?.usertype || existing?.userType || userType,
    'customer'
  );
  const patch = { updatedAt: nowIso };

  if (!existing.hasPassword) patch.hasPassword = true;
  if (phoneE164 && !existing.mobile) patch.mobile = phoneE164;
  if (phoneE164 && !existing.phone) patch.phone = phoneE164;
  if (phoneE164 && !existing.phoneNumber) patch.phoneNumber = phoneE164;
  if (!existing.usertype) patch.usertype = normalizedUserType;
  if (!existing.userType) patch.userType = normalizedUserType;
  if (existing.phoneValidated !== true) patch.phoneValidated = true;

  if (Object.keys(patch).length > 1) {
    await userRef.update(patch);
  }
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
  const otpBypassEnabled = isOtpBypassPhone(phoneDigits);
  const otp = otpBypassEnabled
    ? getBypassOtpCode()
    : Math.floor(100000 + Math.random() * 900000).toString();
  const verificationId = `pwd_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  if (!otpBypassEnabled) {
    const redis = redisPool.getConnection();
    await redis.set(`password_reset_otp:${verificationId}:${phoneDigits}`, otp, 'EX', PASSWORD_RESET_TTL_SECONDS);
  }

  if (otpBypassEnabled) {
    logStructured('info', 'OTP de reset com bypass de teste habilitado', {
      service: 'auth-password-routes',
      phoneLast4: phoneDigits.slice(-4),
      verificationId
    });
  } else if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_OTP === 'true') {
    logStructured('info', 'OTP de reset gerado', {
      service: 'auth-password-routes',
      phoneLast4: phoneDigits.slice(-4),
      verificationId
    });
  }

  return { verificationId };
}

async function verifyResetOtp({ phoneDigits, verificationId, otp }) {
  const bypassOtpCode = getBypassOtpCode();
  if (otp === bypassOtpCode && isOtpBypassPhone(phoneDigits)) {
    return true;
  }

  const appReviewOtpBypassEnabled = String(process.env.APP_REVIEW || 'false').toLowerCase() === 'true';
  if (otp === bypassOtpCode && appReviewOtpBypassEnabled) {
    return true;
  }
  if (otp === bypassOtpCode) {
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
    const requestedUserType = normalizeUserType(
      req.body?.userType || req.body?.usertype || req.firebaseUser?.userType,
      'customer'
    );
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
      userType: requestedUserType,
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

    await ensureRealtimeProfileForPasswordAuth({
      uid: req.firebaseUser.uid,
      phoneDigits,
      userType: requestedUserType
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logError(error, 'Erro ao definir senha do passageiro', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
});

async function resolvePhoneAuthFlowHandler(req, res) {
  try {
    const phoneDigits = normalizePhone(req.body?.phone);
    if (!phoneDigits) {
      return res.status(400).json({ success: false, error: 'Telefone é obrigatório' });
    }

    const { data: credentialData } = await getCredentialByPhone(phoneDigits);
    const hasPassword = Boolean(credentialData?.passwordHash);
    let uid = credentialData?.uid || null;
    let resolvedUserType = normalizeUserType(credentialData?.userType || credentialData?.usertype, null);
    let source = credentialData?.uid ? 'password_credentials' : 'none';

    if (!uid) {
      const authLookup = await lookupFirebaseAuthUserByPhone(phoneDigits);
      if (authLookup?.userRecord?.uid) {
        uid = authLookup.userRecord.uid;
        source = 'firebase_auth';
      }
    }

    if (uid) {
      const realtimeProfile = await getRealtimeUserByUid(uid);
      resolvedUserType = normalizeUserType(
        realtimeProfile?.usertype || realtimeProfile?.userType || resolvedUserType,
        'customer'
      );
    }

    const exists = Boolean(uid);
    const requiresPassword = exists;
    const requiresOtp = !exists;

    return res.status(200).json({
      success: true,
      exists,
      hasPassword,
      requiresPassword,
      requiresOtp,
      uid: uid || null,
      userType: exists ? (resolvedUserType || 'customer') : null,
      source
    });
  } catch (error) {
    logError(error, 'Erro ao resolver fluxo de autenticação por telefone', { service: 'auth-password-routes' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}

router.post('/resolve-phone', resolvePhoneAuthFlowHandler);
router.post('/resolve', resolvePhoneAuthFlowHandler);

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

    const resolvedUserType = normalizeUserType(data.userType || data.usertype, 'customer');
    const customToken = await admin.auth().createCustomToken(data.uid, {
      userType: resolvedUserType,
      authMethod: 'phone_password'
    });

    await recordPasswordAudit('password_login_success', {
      uid: data.uid,
      phoneLast4: phoneDigits.slice(-4)
    });

    await ensureRealtimeProfileForPasswordAuth({
      uid: data.uid,
      phoneDigits,
      userType: resolvedUserType
    });

    return res.status(200).json({
      success: true,
      customToken,
      uid: data.uid,
      userType: resolvedUserType
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

    const { ref, doc, phoneHash, data } = await getCredentialByPhone(phoneDigits);
    let credentialData = data;

    if (!credentialData?.uid) {
      const authLookup = await lookupFirebaseAuthUserByPhone(phoneDigits);
      if (!authLookup?.userRecord?.uid) {
        return res.status(200).json({ success: true, message: 'Se o telefone existir, enviaremos um OTP.' });
      }

      const fallbackUid = authLookup.userRecord.uid;
      const realtimeProfile = await getRealtimeUserByUid(fallbackUid);
      const fallbackUserType = normalizeUserType(
        realtimeProfile?.usertype || realtimeProfile?.userType || authLookup?.userRecord?.customClaims?.userType,
        'customer'
      );

      await ref.set({
        uid: fallbackUid,
        phoneHash,
        phoneLast4: phoneDigits.slice(-4),
        userType: fallbackUserType,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(doc.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() })
      }, { merge: true });

      credentialData = {
        uid: fallbackUid,
        userType: fallbackUserType
      };
    }

    const otpBypassEnabled = isOtpBypassPhone(phoneDigits);
    if (!otpBypassEnabled) {
      await redisPool.ensureConnection();
    }
    const { verificationId } = await generateResetOtp(phoneDigits);
    await recordPasswordAudit('password_reset_requested', { phoneLast4: phoneDigits.slice(-4) });

    return res.status(200).json({
      success: true,
      verificationId,
      expiresIn: PASSWORD_RESET_TTL_SECONDS,
      otpBypassEnabled
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
    const bypassOtpCode = getBypassOtpCode();
    const bypassAttempt = otp === bypassOtpCode;
    const appReviewOtpBypassEnabled = String(process.env.APP_REVIEW || 'false').toLowerCase() === 'true';
    const bypassAllowedForRequest = bypassAttempt && (isOtpBypassPhone(phoneDigits) || appReviewOtpBypassEnabled);

    if (!phoneDigits || !otp || (!verificationId && !bypassAllowedForRequest)) {
      return res.status(400).json({ success: false, error: 'Telefone, verificationId e OTP são obrigatórios' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Confirmação de senha não confere' });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.ok) {
      return res.status(400).json({ success: false, error: passwordValidation.error });
    }

    if (!bypassAllowedForRequest) {
      await redisPool.ensureConnection();
    }
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

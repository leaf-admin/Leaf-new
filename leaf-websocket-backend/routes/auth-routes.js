const express = require('express');
const admin = require('firebase-admin');
const { verifyFirebaseIdToken } = require('../utils/firebase-id-token');
// const firebaseConfig = require('../firebase-config');
const { logger, logStructured } = require('../utils/logger');

const router = express.Router();

function shouldLoadFirestoreUserProfile(req) {
  const requestFlag = req.method === 'GET'
    ? req.query?.includeFirestoreProfile
    : req.body?.includeFirestoreProfile;
  const normalizedRequestFlag = String(requestFlag || '').toLowerCase();

  if (normalizedRequestFlag === 'true' || normalizedRequestFlag === '1') {
    return true;
  }

  return String(process.env.AUTH_VERIFY_INCLUDE_FIRESTORE_PROFILE || '').toLowerCase() === 'true';
}

async function resolveOptionalFirestoreUserData(uid, req) {
  if (!shouldLoadFirestoreUserProfile(req)) {
    return null;
  }

  try {
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    if (!userDoc.exists) {
      logStructured('warn', 'Firestore users doc ausente em auth verify', {
        service: 'auth-routes',
        firestore_collection: 'users',
        firestore_result: 'NOT_FOUND',
        userId: String(uid),
        source: `auth-routes.${req.method.toLowerCase()}.verify`
      });
      return null;
    }

    return userDoc.data() || null;
  } catch (firestoreError) {
    logger.warn(`Erro ao buscar dados do usuário ${uid}:`, firestoreError);
    return null;
  }
}

// O login mock (POST /login, usuários simulados) foi removido em 02/11/2026:
// o app entra pelo Firebase (OTP ou senha) e o painel por /api/admin/auth.

// Endpoint para verificar token Firebase
// GET /auth/verify e /api/auth/verify
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    // Aceitar token no header ou query string
    const token = authHeader
      ? authHeader.replace(/^Bearer\s+/i, '')
      : req.query.token;

    if (!token) {
      return res.status(401).json({
        authenticated: false,
        success: false,
        message: 'Token não fornecido'
      });
    }

    try {
      // Verificar token Firebase
      const decodedToken = await verifyFirebaseIdToken(admin.auth(), token);

      // Buscar dados adicionais do usuário no Firestore apenas quando explicitamente necessário
      const userData = await resolveOptionalFirestoreUserData(decodedToken.uid, req);

      res.json({
        authenticated: true,
        success: true,
        token: token,
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email || userData?.email,
          phone: userData?.phone || userData?.phoneNumber,
          name: decodedToken.name || userData?.name || userData?.fullName
        },
        valid: true
      });

    } catch (firebaseError) {
      logger.warn('Token Firebase inválido:', firebaseError.message);
      return res.status(401).json({
        authenticated: false,
        success: false,
        message: 'Token inválido ou expirado',
        valid: false
      });
    }

  } catch (error) {
    logger.error('Erro ao verificar token:', error);
    res.status(500).json({
      authenticated: false,
      success: false,
      message: 'Erro ao verificar token',
      valid: false
    });
  }
});

// POST /auth/verify e /api/auth/verify (alternativa)
router.post('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    const token = authHeader
      ? authHeader.replace(/^Bearer\s+/i, '')
      : req.body.token;

    if (!token) {
      return res.status(401).json({
        authenticated: false,
        success: false,
        message: 'Token não fornecido'
      });
    }

    try {
      const decodedToken = await verifyFirebaseIdToken(admin.auth(), token);

      const userData = await resolveOptionalFirestoreUserData(decodedToken.uid, req);

      res.json({
        authenticated: true,
        success: true,
        token: token,
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email || userData?.email,
          phone: userData?.phone || userData?.phoneNumber,
          name: decodedToken.name || userData?.name || userData?.fullName
        },
        valid: true
      });

    } catch (firebaseError) {
      logger.warn('Token Firebase inválido:', firebaseError.message);
      return res.status(401).json({
        authenticated: false,
        success: false,
        message: 'Token inválido ou expirado',
        valid: false
      });
    }

  } catch (error) {
    logger.error('Erro ao verificar token:', error);
    res.status(500).json({
      authenticated: false,
      success: false,
      message: 'Erro ao verificar token',
      valid: false
    });
  }
});

module.exports = router;

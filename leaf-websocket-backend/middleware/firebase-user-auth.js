const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { logError } = require('../utils/logger');

function extractBearerToken(req) {
  const header = String(req.headers?.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  return header.slice(7).trim();
}

async function requireFirebaseUser(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token de autenticação ausente.'
      });
    }

    try {
      firebaseConfig.initializeFirebase();
    } catch (_error) {
      // initializeFirebase already logs failures and can reuse an existing app.
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = String(decoded?.uid || '').trim();
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Token sem UID válido.'
      });
    }

    req.firebaseUser = decoded;
    req.authenticatedUser = {
      uid,
      phoneNumber: decoded.phone_number || decoded.phoneNumber || null,
      userType: decoded.userType || decoded.usertype || null,
      authSource: 'firebase'
    };

    return next();
  } catch (error) {
    logError(error, 'Falha ao autenticar usuário Firebase', {
      service: 'firebase-user-auth'
    });
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado.'
    });
  }
}

function requireFirebaseSelf(resolveTargetUserId) {
  return (req, res, next) => {
    const requesterUid = String(req.authenticatedUser?.uid || req.firebaseUser?.uid || '').trim();
    const targetUserId = String(resolveTargetUserId(req) || '').trim();

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: 'userId é obrigatório.'
      });
    }

    if (!requesterUid || requesterUid !== targetUserId) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado para este usuário.'
      });
    }

    return next();
  };
}

module.exports = {
  requireFirebaseUser,
  requireFirebaseSelf
};

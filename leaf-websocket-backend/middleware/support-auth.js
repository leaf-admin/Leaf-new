const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { logError } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const { resolveJwtSecretList } = require('../utils/jwt-secret-resolver');
const { getAdminUser } = require('../utils/admin-user-cache');

const SUPPORT_TIER_ROLES = ['support', 'support_n1', 'support_n2', 'support_n3'];
const ADMIN_ROLES = new Set(['admin', 'manager', 'super-admin', 'viewer', ...SUPPORT_TIER_ROLES, 'development']);
const AGENT_ROLES = new Set(['admin', 'manager', 'super-admin', ...SUPPORT_TIER_ROLES, 'development']);

const JWT_SECRETS = resolveJwtSecretList(
  ['JWT_SECRET', 'ADMIN_JWT_SECRET'],
  { context: 'support-auth' }
);

function extractBearerToken(req) {
  const authHeader = req.headers?.authorization || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim();
}

function normalizeAdminUser(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;

  const userId = decoded.userId || decoded.id || decoded.sub;
  if (!userId) return null;

  const role = String(decoded.role || 'viewer').toLowerCase();
  if (!ADMIN_ROLES.has(role)) return null;

  return {
    id: String(userId),
    uid: String(userId),
    email: decoded.email || null,
    username: decoded.username || null,
    role,
    permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
    authSource: 'admin_jwt'
  };
}

async function verifyAdminToken(token) {
  try {
    firebaseConfig.initializeFirebase();
  } catch {}

  for (const secret of JWT_SECRETS) {
    try {
      const decoded = jwt.verify(token, secret);
      const user = normalizeAdminUser(decoded);
      if (!user) continue;

      // Se existir cadastro admin no Firestore, respeita status/role.
      try {
        const adminRecord = await getAdminUser(user.id, {
          source: 'support-auth.verifyAdminToken',
          maxAgeMs: 15 * 1000
        });
        if (adminRecord.exists) {
          const data = adminRecord.data || {};
          if (data.active === false) return null;

          if (data.role) {
            user.role = String(data.role).toLowerCase();
          }
          if (Array.isArray(data.permissions)) {
            user.permissions = data.permissions;
          }
          user.email = user.email || data.email || null;
        }
      } catch {
        // Firestore adminUsers pode não estar configurado em todos ambientes.
      }

      return user;
    } catch {
      // tenta próximo segredo
    }
  }

  return null;
}

async function verifyFirebaseUserToken(token) {
  try {
    firebaseConfig.initializeFirebase();
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded?.uid) return null;

    return {
      id: String(decoded.uid),
      uid: String(decoded.uid),
      email: decoded.email || null,
      username: decoded.name || null,
      role: String(decoded.role || decoded.userType || 'user').toLowerCase(),
      userType: decoded.userType || null,
      permissions: [],
      authSource: 'firebase'
    };
  } catch {
    return null;
  }
}

async function authenticateSupport(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }

    const adminUser = await verifyAdminToken(token);
    if (adminUser) {
      req.user = adminUser;
      return next();
    }

    const firebaseUser = await verifyFirebaseUserToken(token);
    if (firebaseUser) {
      req.user = firebaseUser;
      return next();
    }

    return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  } catch (error) {
    logError(error, { service: 'support-auth', operation: 'authenticateSupport' });
    return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
  }
}

function isSupportAgent(user) {
  return AGENT_ROLES.has(String(user?.role || '').toLowerCase());
}

function requireSupportRoles(roles) {
  const normalized = new Set((roles || []).map((role) => String(role).toLowerCase()));

  return (req, res, next) => {
    const role = String(req.user?.role || '').toLowerCase();
    if (!normalized.has(role)) {
      return res.status(403).json({ success: false, error: 'Acesso negado' });
    }
    return next();
  };
}

function canAccessUserScope(reqUser, targetUserId) {
  if (!targetUserId) return false;

  const requesterId = String(reqUser?.uid || reqUser?.id || '');
  const targetId = String(targetUserId);

  if (requesterId && requesterId === targetId) {
    return true;
  }

  return isSupportAgent(reqUser);
}

module.exports = {
  authenticateSupport,
  requireSupportRoles,
  isSupportAgent,
  canAccessUserScope,
  SUPPORT_TIER_ROLES
};

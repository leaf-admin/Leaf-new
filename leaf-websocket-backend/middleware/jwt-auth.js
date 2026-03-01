const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const { logError } = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || 'leaf-admin-secret-key-change-in-production';

/**
 * Middleware para autenticar requisições usando JWT
 * Adiciona req.user com dados do usuário autenticado
 */
const authenticateJWT = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Token inválido ou expirado'
      });
    }

    // Verificar se usuário ainda existe e está ativo
    const firestore = admin.firestore();
    const userDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();
    
    if (!userDoc.exists || userDoc.data().active === false) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
      });
    }

    const userData = userDoc.data();

    // Adicionar dados do usuário ao request
    req.user = {
      id: decoded.userId,
      email: decoded.email || userData.email,
      role: decoded.role || userData.role || 'viewer',
      permissions: decoded.permissions || userData.permissions || []
    };

    next();
  } catch (error) {
    logError(error, 'Erro no middleware JWT', {
      service: 'jwt-auth',
      operation: 'authenticate'
    });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
};

/**
 * Middleware para verificar se usuário tem permissão específica
 * @param {string} permission - Permissão necessária (ex: 'dashboard:read', 'users:write')
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado'
      });
    }

    // Super-admin tem todas as permissões
    if (req.user.role === 'super-admin') {
      return next();
    }

    // Verificar se usuário tem a permissão específica
    if (!req.user.permissions || !req.user.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: 'Permissão insuficiente',
        required: permission,
        userPermissions: req.user.permissions
      });
    }

    next();
  };
};

/**
 * Middleware para verificar se usuário tem um dos roles especificados
 * @param {string[]} roles - Array de roles permitidos (ex: ['admin', 'super-admin'])
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Acesso negado',
        required: roles,
        userRole: req.user.role
      });
    }

    next();
  };
};

module.exports = {
  authenticateJWT,
  requirePermission,
  requireRole
};




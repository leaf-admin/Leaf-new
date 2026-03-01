const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const auditService = require('../services/audit-service');
const { logStructured, logError } = require('../utils/logger');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || 'leaf-admin-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.ADMIN_JWT_REFRESH_SECRET || 'leaf-admin-refresh-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * POST /api/admin/auth/login
 * Login de administrador com JWT
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validar entrada
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email e senha são obrigatórios'
      });
    }

    // Buscar usuário admin no Firestore
    const firestore = admin.firestore();
    const adminUsersRef = firestore.collection('adminUsers');
    const snapshot = await adminUsersRef.where('email', '==', email).limit(1).get();
    
    if (snapshot.empty) {
      auditService.logSecurityAction(null, 'loginFailed', 'adminLogin', {
        email,
        reason: 'User not found'
      }, { ip: req.ip, userAgent: req.get('user-agent') }).catch(() => {});
      
      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    // Verificar se usuário está ativo
    if (userData.active === false) {
      auditService.logSecurityAction(userId, 'loginFailed', 'adminLogin', {
        email,
        reason: 'User inactive'
      }, { ip: req.ip, userAgent: req.get('user-agent') }).catch(() => {});
      
      return res.status(403).json({
        success: false,
        error: 'Usuário inativo'
      });
    }

    // Verificar senha
    // Opção 1: Se tem passwordHash no Firestore, usar bcrypt
    // Opção 2: Se não tem, usar Firebase Auth (precisa de token do Firebase)
    let validPassword = false;
    
    if (userData.passwordHash) {
      // Senha armazenada como hash no Firestore
      validPassword = await bcrypt.compare(password, userData.passwordHash);
    } else {
      // Se não tem hash, assumir que está usando Firebase Auth
      // Por enquanto, retornar erro pedindo para configurar senha
      // Em produção, integrar com Firebase Auth
      return res.status(400).json({
        success: false,
        error: 'Senha não configurada. Use Firebase Auth ou configure senha no Firestore.'
      });
    }

    if (!validPassword) {
      auditService.logSecurityAction(userId, 'loginFailed', 'adminLogin', {
        email,
        reason: 'Invalid password'
      }, { ip: req.ip, userAgent: req.get('user-agent') }).catch(() => {});
      
      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    // Gerar tokens
    const accessToken = jwt.sign(
      {
        userId,
        email: userData.email,
        role: userData.role || 'viewer',
        permissions: userData.permissions || []
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
      { userId, type: 'refresh' },
      JWT_REFRESH_SECRET,
      { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );

    // Salvar refresh token no Firestore
    await firestore.collection('adminRefreshTokens').doc(userId).set({
      token: refreshToken,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias
    }, { merge: true });

    // Atualizar lastLogin
    await firestore.collection('adminUsers').doc(userId).update({
      lastLogin: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log de auditoria (não-bloqueante)
    auditService.logSecurityAction(userId, 'loginSuccess', 'adminLogin', {
      email,
      role: userData.role || 'viewer'
    }, { ip: req.ip, userAgent: req.get('user-agent') }).catch(err => {
      logStructured('warn', '⚠️ Erro ao registrar log de auditoria:', err.message, { service: 'admin-auth-routes' });
    });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email: userData.email,
        name: userData.displayName || userData.name || 'Administrador',
        role: userData.role || 'viewer',
        permissions: userData.permissions || []
      },
      expiresIn: JWT_EXPIRES_IN
    });

  } catch (error) {
    logError(error, '❌ Erro no login admin:', { service: 'admin-auth-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

/**
 * POST /api/admin/auth/refresh
 * Renovar access token usando refresh token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: 'Refresh token é obrigatório'
      });
    }

    // Verificar refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido ou expirado'
      });
    }

    // Verificar se token existe no Firestore
    const firestore = admin.firestore();
    const tokenDoc = await firestore.collection('adminRefreshTokens').doc(decoded.userId).get();
    
    if (!tokenDoc.exists || tokenDoc.data().token !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido'
      });
    }

    // Verificar se token não expirou
    const tokenData = tokenDoc.data();
    if (tokenData.expiresAt && tokenData.expiresAt.toDate() < new Date()) {
      // Remover token expirado
      await firestore.collection('adminRefreshTokens').doc(decoded.userId).delete();
      return res.status(401).json({
        success: false,
        error: 'Refresh token expirado'
      });
    }

    // Buscar dados do usuário
    const userDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();
    if (!userDoc.exists || userDoc.data().active === false) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
      });
    }

    const userData = userDoc.data();

    // Gerar novo access token
    const accessToken = jwt.sign(
      {
        userId: decoded.userId,
        email: userData.email,
        role: userData.role || 'viewer',
        permissions: userData.permissions || []
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      success: true,
      accessToken,
      expiresIn: JWT_EXPIRES_IN
    });

  } catch (error) {
    logError(error, '❌ Erro ao renovar token:', { service: 'admin-auth-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

/**
 * GET /api/admin/auth/verify
 * Verificar se access token é válido
 */
router.get('/verify', async (req, res) => {
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

    res.json({
      success: true,
      user: {
        id: decoded.userId,
        email: decoded.email || userData.email,
        name: userData.displayName || userData.name || 'Administrador',
        role: decoded.role || userData.role || 'viewer',
        permissions: decoded.permissions || userData.permissions || []
      }
    });

  } catch (error) {
    logError(error, '❌ Erro ao verificar token:', { service: 'admin-auth-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

/**
 * POST /api/admin/auth/logout
 * Logout e invalidar refresh token
 */
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      // Token inválido, mas ainda assim retornar sucesso
      return res.json({
        success: true,
        message: 'Logout realizado'
      });
    }

    // Remover refresh token do Firestore
    const firestore = admin.firestore();
    await firestore.collection('adminRefreshTokens').doc(decoded.userId).delete();

    // Log de auditoria
    await auditService.logSecurityAction(decoded.userId, 'logout', 'adminLogout', {
      email: decoded.email
    }, { ip: req.ip, userAgent: req.get('user-agent') });

    res.json({
      success: true,
      message: 'Logout realizado com sucesso'
    });

  } catch (error) {
    logError(error, '❌ Erro no logout:', { service: 'admin-auth-routes' });
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

module.exports = router;




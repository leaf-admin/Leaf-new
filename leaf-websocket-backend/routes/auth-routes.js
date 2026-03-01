const express = require('express');
const admin = require('firebase-admin');
// const graphqlAuth = require('../middleware/graphql-auth');
// const firebaseConfig = require('../firebase-config');
const { logger } = require('../utils/logger');

const router = express.Router();

// Endpoint para login e geração de token
router.post('/login', async (req, res) => {
  try {
    const { phone, password, userType } = req.body;

    // Validar entrada básica
    if (!phone || !password || !userType) {
      return res.status(400).json({
        success: false,
        message: 'Dados inválidos: phone, password e userType são obrigatórios'
      });
    }

    // Simular autenticação (em produção, usar Firebase Auth)
    const user = await authenticateUser(phone, password, userType);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas'
      });
    }

    // Gerar token JWT simples
    const token = 'mock-jwt-token-' + Date.now();

    // Log de auditoria simples
    logStructured('info', `📋 LOGIN: ${user.name} (${user.userType}) - ${req.ip}`, { service: 'auth-routes-routes' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType
      },
      expiresIn: '24h'
    });

  } catch (error) {
    logStructured('error', '❌ Erro no login:', error.message, { service: 'auth-routes-routes' });
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// Endpoint para verificar token Firebase
// GET /api/auth/verify
router.get('/api/auth/verify', async (req, res) => {
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
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Buscar dados adicionais do usuário no Firestore (opcional)
      let userData = null;
      try {
        const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        if (userDoc.exists) {
          userData = userDoc.data();
        }
      } catch (firestoreError) {
        logger.warn(`Erro ao buscar dados do usuário ${decodedToken.uid}:`, firestoreError);
        // Continuar mesmo se não conseguir buscar dados do Firestore
      }

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

// POST /api/auth/verify (alternativa)
router.post('/api/auth/verify', async (req, res) => {
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
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      let userData = null;
      try {
        const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
        if (userDoc.exists) {
          userData = userDoc.data();
        }
      } catch (firestoreError) {
        logger.warn(`Erro ao buscar dados do usuário ${decodedToken.uid}:`, firestoreError);
      }

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

// Endpoint legacy para verificar token (mantido para compatibilidade)
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Token não fornecido'
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    
    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      res.json({
        success: true,
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          name: decodedToken.name
        },
        valid: true
      });
    } catch (firebaseError) {
      return res.status(401).json({
        success: false,
        message: 'Token inválido ou expirado',
        valid: false
      });
    }

  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message,
      valid: false
    });
  }
});

// Endpoint para refresh de token
router.post('/refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Token não fornecido'
      });
    }

    const decoded = graphqlAuth.verifyToken(authHeader);
    
    // Gerar novo token
    const newToken = graphqlAuth.generateToken({
      userId: decoded.userId,
      email: decoded.email,
      phone: decoded.phone,
      userType: decoded.userType,
      name: decoded.name
    });

    res.json({
      success: true,
      token: newToken,
      expiresIn: '24h'
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message
    });
  }
});

// Endpoint para logout
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader) {
      const decoded = graphqlAuth.verifyToken(authHeader);
      
      // Log de auditoria
      graphqlAuth.logAuditEvent(decoded.userId, 'LOGOUT', {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
    }

    res.json({
      success: true,
      message: 'Logout realizado com sucesso'
    });

  } catch (error) {
    // Mesmo com erro, considerar logout bem-sucedido
    res.json({
      success: true,
      message: 'Logout realizado'
    });
  }
});

// Função auxiliar para autenticação (simulada)
async function authenticateUser(phone, password, userType) {
  try {
    // Em produção, usar Firebase Auth
    // Por enquanto, simular com dados mock
    
    const mockUsers = {
      '+5511999999999': {
        id: 'user-001',
        name: 'João Silva',
        email: 'joao@leaf.com',
        phone: '+5511999999999',
        userType: 'CUSTOMER',
        password: '123456'
      },
      '+5511888888888': {
        id: 'driver-001',
        name: 'Maria Santos',
        email: 'maria@leaf.com',
        phone: '+5511888888888',
        userType: 'DRIVER',
        password: '123456'
      },
      '+5511777777777': {
        id: 'admin-001',
        name: 'Admin Leaf',
        email: 'admin@leaf.com',
        phone: '+5511777777777',
        userType: 'ADMIN',
        password: '123456'
      }
    };

    const user = mockUsers[phone];
    
    if (user && user.password === password && user.userType === userType) {
      // Remover senha do retorno
      delete user.password;
      return user;
    }

    return null;

  } catch (error) {
    logStructured('error', '❌ Erro na autenticação:', error.message, { service: 'auth-routes-routes' });
    return null;
  }
}

module.exports = router;


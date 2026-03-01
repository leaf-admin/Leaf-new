const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { authenticateToken, authorizeRole } = require('./auth');

// Firebase integration
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'admin-users-routes' });
}

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-dashboard-secret-key-2025';
const SALT_ROUNDS = 12; // Aumentar segurança da senha

// ===== MIDDLEWARE DE SEGURANÇA =====

// Rate limiting para APIs de admin
const rateLimit = require('express-rate-limit');
const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 50, // máximo 50 requests por IP
  message: 'Muitas tentativas, tente novamente em 15 minutos',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware de validação de usuário
const validateUserData = (req, res, next) => {
  const { username, email, role, name } = req.body;
  
  if (!username || !email || !role || !name) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  
  // Validar username
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username deve ter entre 3 e 20 caracteres' });
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username deve conter apenas letras, números e underscore' });
  }
  
  // Validar email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Email inválido' });
  }
  
  // Validar role
  const validRoles = ['admin', 'manager', 'agent', 'viewer'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role inválida' });
  }
  
  // Validar nome
  if (name.length < 2 || name.length > 50) {
    return res.status(400).json({ error: 'Nome deve ter entre 2 e 50 caracteres' });
  }
  
  next();
};

// Middleware de validação de senha
const validatePassword = (req, res, next) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ error: 'Senha é obrigatória' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres' });
  }
  
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return res.status(400).json({ error: 'Senha deve conter pelo menos uma letra minúscula, uma maiúscula e um número' });
  }
  
  next();
};

// Middleware de sanitização
const sanitizeInput = (req, res, next) => {
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/[<>]/g, '') // Remove < e >
      .replace(/javascript:/gi, '') // Remove javascript:
      .replace(/on\w+=/gi, '') // Remove event handlers
      .trim();
  };
  
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeString(req.body[key]);
      }
    });
  }
  
  next();
};

// ===== APIS DE GESTÃO DE USUÁRIOS =====

// Listar todos os usuários (apenas admin)
router.get('/users', adminRateLimit, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref('admin_users').once('value');
    
    let users = [];
    if (snapshot.val()) {
      users = Object.values(snapshot.val());
    }
    
    // Remover senhas dos dados de retorno
    const safeUsers = users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy,
      passwordChanged: user.passwordChanged,
      firstAccess: user.firstAccess
    }));
    
    res.json({
      success: true,
      users: safeUsers
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao listar usuários:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar novo usuário (apenas admin)
router.post('/users', adminRateLimit, sanitizeInput, validateUserData, validatePassword, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    const { username, email, password, role, name, isActive = true } = req.body;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se username já existe
    const usernameSnapshot = await db.ref('admin_users')
      .orderByChild('username')
      .equalTo(username)
      .once('value');
    
    if (usernameSnapshot.val()) {
      return res.status(400).json({ error: 'Username já existe' });
    }
    
    // Verificar se email já existe
    const emailSnapshot = await db.ref('admin_users')
      .orderByChild('email')
      .equalTo(email)
      .once('value');
    
    if (emailSnapshot.val()) {
      return res.status(400).json({ error: 'Email já existe' });
    }
    
    // Criptografar senha
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Gerar ID único
    const userId = `ADMIN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const newUser = {
      id: userId,
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      role: role,
      name: name.trim(),
      isActive: isActive,
      lastLogin: null,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.id,
      passwordChanged: false,
      firstAccess: true,
      loginAttempts: 0,
      lockedUntil: null
    };
    
    // Salvar no Firebase
    await db.ref(`admin_users/${userId}`).set(newUser);
    
    // Log de criação
    logStructured('info', `👤 Novo usuário admin criado: ${username} (${role}) por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        name: newUser.name,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
        firstAccess: newUser.firstAccess
      }
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao criar usuário:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar usuário (apenas admin)
router.put('/users/:userId', adminRateLimit, sanitizeInput, validateUserData, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, role, name, isActive } = req.body;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se usuário existe
    const userSnapshot = await db.ref(`admin_users/${userId}`).once('value');
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const existingUser = userSnapshot.val();
    
    // Verificar se username já existe (exceto para o próprio usuário)
    if (username !== existingUser.username) {
      const usernameSnapshot = await db.ref('admin_users')
        .orderByChild('username')
        .equalTo(username)
        .once('value');
      
      if (usernameSnapshot.val()) {
        return res.status(400).json({ error: 'Username já existe' });
      }
    }
    
    // Verificar se email já existe (exceto para o próprio usuário)
    if (email !== existingUser.email) {
      const emailSnapshot = await db.ref('admin_users')
        .orderByChild('email')
        .equalTo(email)
        .once('value');
      
      if (emailSnapshot.val()) {
        return res.status(400).json({ error: 'Email já existe' });
      }
    }
    
    // Atualizar usuário
    const updates = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      role: role,
      name: name.trim(),
      isActive: isActive,
      updatedAt: new Date().toISOString()
    };
    
    await db.ref(`admin_users/${userId}`).update(updates);
    
    logStructured('info', `👤 Usuário admin atualizado: ${username} por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: 'Usuário atualizado com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao atualizar usuário:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Alterar senha de usuário (apenas admin)
router.post('/users/:userId/change-password', adminRateLimit, validatePassword, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se usuário existe
    const userSnapshot = await db.ref(`admin_users/${userId}`).once('value');
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Criptografar nova senha
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    
    // Atualizar senha
    await db.ref(`admin_users/${userId}`).update({
      password: hashedPassword,
      passwordChanged: true,
      firstAccess: false,
      updatedAt: new Date().toISOString()
    });
    
    logStructured('info', `🔐 Senha alterada para usuário ${userId} por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: 'Senha alterada com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao alterar senha:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Desativar/Ativar usuário (apenas admin)
router.post('/users/:userId/toggle-status', adminRateLimit, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se usuário existe
    const userSnapshot = await db.ref(`admin_users/${userId}`).once('value');
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const user = userSnapshot.val();
    const newStatus = !user.isActive;
    
    // Atualizar status
    await db.ref(`admin_users/${userId}`).update({
      isActive: newStatus,
      updatedAt: new Date().toISOString()
    });
    
    logStructured('info', `👤 Usuário ${user.username} ${newStatus ? 'ativado' : 'desativado'} por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: `Usuário ${newStatus ? 'ativado' : 'desativado'} com sucesso`,
      isActive: newStatus
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao alterar status do usuário:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar usuário (apenas admin)
router.delete('/users/:userId', adminRateLimit, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Não permitir deletar o próprio usuário
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Não é possível deletar seu próprio usuário' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se usuário existe
    const userSnapshot = await db.ref(`admin_users/${userId}`).once('value');
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const user = userSnapshot.val();
    
    // Deletar usuário
    await db.ref(`admin_users/${userId}`).remove();
    
    logStructured('info', `🗑️ Usuário admin deletado: ${user.username} por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: 'Usuário deletado com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao deletar usuário:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== APIS DE PERFIS =====

// Obter perfil do usuário logado
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const userSnapshot = await db.ref(`admin_users/${req.user.id}`).once('value');
    
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const user = userSnapshot.val();
    
    // Remover senha dos dados de retorno
    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      name: user.name,
      isActive: user.isActive,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      passwordChanged: user.passwordChanged,
      firstAccess: user.firstAccess
    };
    
    res.json({
      success: true,
      user: safeUser
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao obter perfil:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar perfil do usuário logado
router.put('/profile', adminRateLimit, sanitizeInput, authenticateToken, async (req, res) => {
  try {
    const { name, email } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Verificar se email já existe (exceto para o próprio usuário)
    const emailSnapshot = await db.ref('admin_users')
      .orderByChild('email')
      .equalTo(email)
      .once('value');
    
    if (emailSnapshot.val()) {
      const existingUser = Object.values(emailSnapshot.val())[0];
      if (existingUser.id !== req.user.id) {
        return res.status(400).json({ error: 'Email já existe' });
      }
    }
    
    // Atualizar perfil
    await db.ref(`admin_users/${req.user.id}`).update({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      updatedAt: new Date().toISOString()
    });
    
    logStructured('info', `👤 Perfil atualizado por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: 'Perfil atualizado com sucesso'
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao atualizar perfil:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Alterar senha do usuário logado
router.post('/profile/change-password', adminRateLimit, validatePassword, authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }
    
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    
    // Buscar usuário atual
    const userSnapshot = await db.ref(`admin_users/${req.user.id}`).once('value');
    if (!userSnapshot.val()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const user = userSnapshot.val();
    
    // Verificar senha atual
    const validCurrentPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validCurrentPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    
    // Criptografar nova senha
    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Atualizar senha
    await db.ref(`admin_users/${req.user.id}`).update({
      password: hashedNewPassword,
      passwordChanged: true,
      firstAccess: false,
      updatedAt: new Date().toISOString()
    });
    
    // Gerar novo token
    const newToken = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        name: user.name,
        passwordChanged: true,
        firstAccess: false
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    logStructured('info', `🔐 Senha alterada por ${req.user.username}`, { service: 'admin-users-routes' });
    
    res.json({
      success: true,
      message: 'Senha alterada com sucesso',
      token: newToken
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao alterar senha:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ===== ESTATÍSTICAS =====

// Estatísticas de usuários (apenas admin)
router.get('/stats', adminRateLimit, authenticateToken, authorizeRole(['admin', 'super-admin']), async (req, res) => {
  try {
    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Serviço de usuários temporariamente indisponível' });
    }
    
    const db = firebaseConfig.getRealtimeDB();
    const snapshot = await db.ref('admin_users').once('value');
    
    let users = [];
    if (snapshot.val()) {
      users = Object.values(snapshot.val());
    }
    
    const stats = {
      total: users.length,
      active: users.filter(u => u.isActive).length,
      inactive: users.filter(u => !u.isActive).length,
      byRole: {
        admin: users.filter(u => u.role === 'admin').length,
        manager: users.filter(u => u.role === 'manager').length,
        agent: users.filter(u => u.role === 'agent').length,
        viewer: users.filter(u => u.role === 'viewer').length
      },
      firstAccess: users.filter(u => u.firstAccess).length,
      passwordChanged: users.filter(u => u.passwordChanged).length,
      lastLoginToday: users.filter(u => {
        if (!u.lastLogin) return false;
        const today = new Date();
        const lastLogin = new Date(u.lastLogin);
        return lastLogin.toDateString() === today.toDateString();
      }).length
    };
    
    res.json({
      success: true,
      stats
    });
    
  } catch (error) {
    logError(error, '❌ Erro ao obter estatísticas:', { service: 'admin-users-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

module.exports = router;











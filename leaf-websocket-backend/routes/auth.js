const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { logStructured, logError } = require('../utils/logger');
const router = express.Router();

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'leaf-dashboard-secret-key-2025';
const JWT_EXPIRES_IN = '24h';

// Usuários padrão (em produção, usar banco de dados)
const users = [
  {
    id: 1,
    username: 'admin',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    role: 'admin',
    name: 'Administrador',
    passwordChanged: false, // Flag para controlar se a senha foi alterada
    firstAccess: true // Flag para primeiro acesso
  },
  {
    id: 2,
    username: 'manager',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    role: 'manager',
    name: 'Gerente',
    passwordChanged: false,
    firstAccess: true
  },
  {
    id: 3,
    username: 'viewer',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    role: 'viewer',
    name: 'Visualizador',
    passwordChanged: false,
    firstAccess: true
  }
];

// Middleware de autenticação
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

// Middleware de autorização
const authorizeRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Usuário não autenticado' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    next();
  };
};

// Rota de login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    // Buscar usuário
    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Gerar token
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        name: user.name,
        passwordChanged: user.passwordChanged,
        firstAccess: user.firstAccess
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log de login
    logStructured('info', `🔐 Login realizado: ${username} (${user.role}) - IP: ${req.ip} - Primeiro acesso: ${user.firstAccess}`, { service: 'auth-routes' });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        passwordChanged: user.passwordChanged,
        firstAccess: user.firstAccess
      }
    });

  } catch (error) {
    logError(error, '❌ Erro no login:', { service: 'auth-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota para trocar senha (primeiro acesso)
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres' });
    }

    // Buscar usuário
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Verificar senha atual
    const validCurrentPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validCurrentPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    // Criptografar nova senha
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Atualizar senha e flags
    user.password = hashedNewPassword;
    user.passwordChanged = true;
    user.firstAccess = false;

    // Gerar novo token
    const newToken = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        name: user.name,
        passwordChanged: user.passwordChanged,
        firstAccess: user.firstAccess
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    logStructured('info', `🔐 Senha alterada: ${user.username} - IP: ${req.ip}`, { service: 'auth-routes' });

    res.json({
      message: 'Senha alterada com sucesso!',
      token: newToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        passwordChanged: user.passwordChanged,
        firstAccess: user.firstAccess
      }
    });

  } catch (error) {
    logError(error, '❌ Erro ao alterar senha:', { service: 'auth-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota de verificação de token
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      name: req.user.name,
      passwordChanged: req.user.passwordChanged,
      firstAccess: req.user.firstAccess
    }
  });
});

// Rota de logout (opcional, pois o token expira no cliente)
router.post('/logout', authenticateToken, (req, res) => {
  logStructured('info', `🔓 Logout: ${req.user.username} - IP: ${req.ip}`, { service: 'auth-routes' });
  res.json({ message: 'Logout realizado com sucesso' });
});

// Rota para obter usuários (apenas admin)
router.get('/users', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const safeUsers = users.map(user => ({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    passwordChanged: user.passwordChanged,
    firstAccess: user.firstAccess
  }));
  
  res.json(safeUsers);
});

module.exports = { router, authenticateToken, authorizeRole }; 
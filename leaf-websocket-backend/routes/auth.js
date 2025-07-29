const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
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
    name: 'Administrador'
  },
  {
    id: 2,
    username: 'manager',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    role: 'manager',
    name: 'Gerente'
  },
  {
    id: 3,
    username: 'viewer',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    role: 'viewer',
    name: 'Visualizador'
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
        name: user.name
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Log de login
    console.log(`🔐 Login realizado: ${username} (${user.role}) - IP: ${req.ip}`);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name
      }
    });

  } catch (error) {
    console.error('❌ Erro no login:', error);
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
      name: req.user.name
    }
  });
});

// Rota de logout (opcional, pois o token expira no cliente)
router.post('/logout', authenticateToken, (req, res) => {
  console.log(`🔓 Logout: ${req.user.username} - IP: ${req.ip}`);
  res.json({ message: 'Logout realizado com sucesso' });
});

// Rota para obter usuários (apenas admin)
router.get('/users', authenticateToken, authorizeRole(['admin']), (req, res) => {
  const safeUsers = users.map(user => ({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name
  }));
  
  res.json(safeUsers);
});

module.exports = { router, authenticateToken, authorizeRole }; 
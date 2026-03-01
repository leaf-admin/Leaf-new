const jwt = require('jsonwebtoken');
const { AuthenticationError, ForbiddenError } = require('apollo-server-express');

class GraphQLAuthMiddleware {
  constructor() {
    this.secretKey = process.env.JWT_SECRET || 'leaf-secret-key-2024';
    this.tokenExpiry = process.env.JWT_EXPIRY || '24h';
  }

  // Gerar token JWT
  generateToken(payload) {
    try {
      return jwt.sign(payload, this.secretKey, { 
        expiresIn: this.tokenExpiry,
        issuer: 'leaf-app',
        audience: 'leaf-users'
      });
    } catch (error) {
      console.error('❌ Erro ao gerar token:', error.message);
      throw new Error('Erro ao gerar token de autenticação');
    }
  }

  // Verificar token JWT
  verifyToken(token) {
    try {
      if (!token) {
        throw new AuthenticationError('Token não fornecido');
      }

      // Remover "Bearer " se presente
      const cleanToken = token.replace(/^Bearer\s+/i, '');
      
      const decoded = jwt.verify(cleanToken, this.secretKey, {
        issuer: 'leaf-app',
        audience: 'leaf-users'
      });

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new AuthenticationError('Token expirado');
      } else if (error.name === 'JsonWebTokenError') {
        throw new AuthenticationError('Token inválido');
      } else {
        throw new AuthenticationError('Erro na verificação do token');
      }
    }
  }

  // Middleware para contexto GraphQL
  createContextMiddleware() {
    return async ({ req }) => {
      const context = {
        user: null,
        isAuthenticated: false,
        userType: null,
        permissions: []
      };

      try {
        // Extrair token do header Authorization
        const authHeader = req.headers.authorization;
        
        if (authHeader) {
          const decoded = this.verifyToken(authHeader);
          
          context.user = {
            id: decoded.userId,
            email: decoded.email,
            phone: decoded.phone,
            userType: decoded.userType,
            name: decoded.name
          };
          
          context.isAuthenticated = true;
          context.userType = decoded.userType;
          context.permissions = this.getUserPermissions(decoded.userType);
        }
      } catch (error) {
        // Log do erro mas não falha o request
        console.log('⚠️ Token inválido ou ausente:', error.message);
      }

      return context;
    };
  }

  // Obter permissões por tipo de usuário
  getUserPermissions(userType) {
    const permissions = {
      CUSTOMER: [
        'read:own_profile',
        'update:own_profile',
        'create:booking',
        'read:own_bookings',
        'cancel:own_booking'
      ],
      DRIVER: [
        'read:own_profile',
        'update:own_profile',
        'read:booking_requests',
        'accept:booking',
        'update:location',
        'read:own_bookings',
        'complete:booking'
      ],
      ADMIN: [
        'read:all_users',
        'update:all_users',
        'delete:users',
        'read:all_bookings',
        'update:all_bookings',
        'read:analytics',
        'read:financial_reports',
        'manage:system'
      ]
    };

    return permissions[userType] || [];
  }

  // Verificar se usuário tem permissão específica
  hasPermission(userPermissions, requiredPermission) {
    return userPermissions.includes(requiredPermission) || 
           userPermissions.includes('manage:system');
  }

  // Middleware de autorização para resolvers
  requireAuth(requiredPermission = null) {
    return (next) => {
      return async (parent, args, context, info) => {
        // Verificar se está autenticado
        if (!context.isAuthenticated) {
          throw new AuthenticationError('Usuário não autenticado');
        }

        // Verificar permissão específica se fornecida
        if (requiredPermission && !this.hasPermission(context.permissions, requiredPermission)) {
          throw new ForbiddenError(`Permissão necessária: ${requiredPermission}`);
        }

        return next(parent, args, context, info);
      };
    };
  }

  // Middleware para verificar tipo de usuário
  requireUserType(allowedTypes) {
    return (next) => {
      return async (parent, args, context, info) => {
        if (!context.isAuthenticated) {
          throw new AuthenticationError('Usuário não autenticado');
        }

        if (!allowedTypes.includes(context.userType)) {
          throw new ForbiddenError(`Acesso restrito para: ${allowedTypes.join(', ')}`);
        }

        return next(parent, args, context, info);
      };
    };
  }

  // Middleware para operações de proprietário (só pode acessar próprios dados)
  requireOwnership(fieldName = 'userId') {
    return (next) => {
      return async (parent, args, context, info) => {
        if (!context.isAuthenticated) {
          throw new AuthenticationError('Usuário não autenticado');
        }

        // Admin pode acessar tudo
        if (context.userType === 'ADMIN') {
          return next(parent, args, context, info);
        }

        // Verificar se está acessando próprios dados
        const targetUserId = args[fieldName] || parent?.[fieldName];
        
        if (targetUserId && targetUserId !== context.user.id) {
          throw new ForbiddenError('Acesso negado: você só pode acessar seus próprios dados');
        }

        return next(parent, args, context, info);
      };
    };
  }

  // Validar dados de entrada
  validateInput(input, rules) {
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const value = input[field];

      if (rule.required && (!value || value === '')) {
        errors.push(`${field} é obrigatório`);
        continue;
      }

      if (value && rule.type) {
        if (rule.type === 'email' && !this.isValidEmail(value)) {
          errors.push(`${field} deve ser um email válido`);
        } else if (rule.type === 'phone' && !this.isValidPhone(value)) {
          errors.push(`${field} deve ser um telefone válido`);
        } else if (rule.type === 'number' && isNaN(value)) {
          errors.push(`${field} deve ser um número válido`);
        }
      }

      if (value && rule.minLength && value.length < rule.minLength) {
        errors.push(`${field} deve ter pelo menos ${rule.minLength} caracteres`);
      }

      if (value && rule.maxLength && value.length > rule.maxLength) {
        errors.push(`${field} deve ter no máximo ${rule.maxLength} caracteres`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Dados inválidos: ${errors.join(', ')}`);
    }

    return true;
  }

  // Validações auxiliares
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  isValidPhone(phone) {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
  }

  // Rate limiting por usuário
  async checkRateLimit(userId, operation, limit = 100, windowMs = 60000) {
    const key = `rate_limit:${userId}:${operation}`;
    const current = await this.redis?.incr(key);
    
    if (current === 1) {
      await this.redis?.expire(key, Math.ceil(windowMs / 1000));
    }
    
    if (current > limit) {
      throw new Error(`Rate limit excedido para ${operation}. Máximo: ${limit} por minuto`);
    }
    
    return true;
  }

  // Log de auditoria
  logAuditEvent(userId, action, details = {}) {
    const auditLog = {
      userId,
      action,
      details,
      timestamp: new Date().toISOString(),
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    console.log('📋 AUDIT LOG:', JSON.stringify(auditLog));
    
    // Aqui você pode salvar no banco de dados ou sistema de logs
    return auditLog;
  }
}

// Singleton instance
const graphqlAuth = new GraphQLAuthMiddleware();

module.exports = graphqlAuth;





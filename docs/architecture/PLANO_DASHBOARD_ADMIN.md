# 🚀 PLANO DE IMPLEMENTAÇÃO - DASHBOARD ADMIN

**Data:** 16/12/2025  
**Status:** Em Implementação

---

## 📊 **ANÁLISE DO ESTADO ATUAL**

### ✅ **O QUE JÁ EXISTE:**

1. **Estrutura Base:**
   - ✅ Next.js 14 + TypeScript configurado
   - ✅ Chakra UI instalado e funcionando
   - ✅ Firebase Auth integrado (`AuthContext.tsx`)
   - ✅ Sistema de permissões básico (admin/super-admin/viewer)
   - ✅ Página de login funcional
   - ✅ ProtectedRoute implementado
   - ✅ Navegação básica

2. **APIs Backend:**
   - ✅ Endpoints de métricas existentes (`/api/metrics/*`)
   - ✅ Endpoints de usuários (`/api/users/stats`)
   - ✅ Endpoints de corridas (`/api/rides/stats`)
   - ✅ Endpoints de motoristas (`/api/drivers/*`)
   - ✅ Endpoints de KYC (`/api/kyc/*`)
   - ✅ Endpoints de sistema (`/api/system/*`)

3. **Frontend:**
   - ✅ Serviço de API (`api.ts`) com interfaces TypeScript
   - ✅ Hooks customizados (`useDashboard.ts`)
   - ✅ Página de dashboard principal (`dashboard.tsx`)
   - ✅ Páginas de métricas, motoristas, mapas, etc.

### ⚠️ **O QUE PRECISA SER MELHORADO:**

1. **Autenticação JWT:**
   - ⚠️ Atualmente usa Firebase Auth (OK, mas pode melhorar)
   - ⚠️ Falta integração com JWT do backend
   - ⚠️ Falta refresh token automático
   - ⚠️ Falta middleware de validação JWT no backend

2. **Métricas em Tempo Real:**
   - ⚠️ Falta WebSocket para atualizações em tempo real
   - ⚠️ Falta polling automático para métricas
   - ⚠️ Falta cache inteligente (React Query)

3. **Interface:**
   - ⚠️ Usa Chakra UI (funcional, mas pode migrar para Tailwind + shadcn/ui)
   - ⚠️ Falta design system consistente
   - ⚠️ Falta responsividade completa

---

## 🎯 **PLANO DE IMPLEMENTAÇÃO**

### **FASE 1: Melhorar Autenticação JWT** ✅ (Prioridade Alta)

#### **1.1 Backend - Endpoint JWT Admin**
- [ ] Criar endpoint `/api/admin/auth/login` com JWT
- [ ] Integrar com Firestore `adminUsers` collection
- [ ] Implementar refresh token
- [ ] Adicionar middleware de validação JWT
- [ ] Logs de auditoria de login

#### **1.2 Frontend - Integração JWT**
- [ ] Criar serviço de autenticação JWT
- [ ] Armazenar token no localStorage/sessionStorage
- [ ] Implementar refresh automático
- [ ] Interceptar requests para adicionar token
- [ ] Tratamento de expiração de token

---

### **FASE 2: Métricas em Tempo Real** ✅ (Prioridade Alta)

#### **2.1 Backend - WebSocket para Dashboard**
- [ ] Criar namespace `/dashboard` no Socket.IO
- [ ] Emitir eventos de métricas atualizadas
- [ ] Implementar broadcast de estatísticas
- [ ] Rate limiting para conexões dashboard

#### **2.2 Frontend - WebSocket Client**
- [ ] Conectar ao namespace `/dashboard`
- [ ] Escutar eventos de métricas
- [ ] Atualizar UI em tempo real
- [ ] Reconexão automática

#### **2.3 Frontend - React Query**
- [ ] Instalar e configurar React Query
- [ ] Criar queries para métricas
- [ ] Implementar cache e refetch automático
- [ ] Otimizar requisições

---

### **FASE 3: Melhorias de Interface** (Prioridade Média)

#### **3.1 Design System**
- [ ] Avaliar migração para Tailwind + shadcn/ui
- [ ] Criar componentes base reutilizáveis
- [ ] Definir paleta de cores consistente
- [ ] Melhorar tipografia

#### **3.2 Responsividade**
- [ ] Testar em diferentes tamanhos de tela
- [ ] Ajustar layout mobile
- [ ] Otimizar tabelas para mobile

---

## 📋 **IMPLEMENTAÇÃO DETALHADA - FASE 1**

### **Backend - JWT Admin Auth**

**Arquivo:** `leaf-websocket-backend/routes/admin-auth.js`

```javascript
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const admin = require('firebase-admin');
const { auditService } = require('../services/audit-service');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
const JWT_EXPIRES_IN = '24h';
const JWT_REFRESH_EXPIRES_IN = '7d';

// POST /api/admin/auth/login
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
      await auditService.logSecurityAction(null, 'loginFailed', 'adminLogin', {
        email,
        reason: 'User not found'
      }, { ip: req.ip, userAgent: req.get('user-agent') });
      
      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    // Verificar se usuário está ativo
    if (!userData.active) {
      await auditService.logSecurityAction(userId, 'loginFailed', 'adminLogin', {
        email,
        reason: 'User inactive'
      }, { ip: req.ip, userAgent: req.get('user-agent') });
      
      return res.status(403).json({
        success: false,
        error: 'Usuário inativo'
      });
    }

    // Verificar senha (se estiver usando Firebase Auth, validar token)
    // Por enquanto, assumindo que a senha está no Firestore (hash)
    const validPassword = userData.passwordHash 
      ? await bcrypt.compare(password, userData.passwordHash)
      : false; // Se não tem hash, usar Firebase Auth

    if (!validPassword) {
      await auditService.logSecurityAction(userId, 'loginFailed', 'adminLogin', {
        email,
        reason: 'Invalid password'
      }, { ip: req.ip, userAgent: req.get('user-agent') });
      
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
        role: userData.role,
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
    });

    // Atualizar lastLogin
    await firestore.collection('adminUsers').doc(userId).update({
      lastLogin: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log de auditoria
    await auditService.logSecurityAction(userId, 'loginSuccess', 'adminLogin', {
      email,
      role: userData.role
    }, { ip: req.ip, userAgent: req.get('user-agent') });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: userId,
        email: userData.email,
        name: userData.displayName || userData.name,
        role: userData.role,
        permissions: userData.permissions || []
      },
      expiresIn: JWT_EXPIRES_IN
    });

  } catch (error) {
    console.error('❌ Erro no login admin:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor'
    });
  }
});

// POST /api/admin/auth/refresh
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
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    
    // Verificar se token existe no Firestore
    const firestore = admin.firestore();
    const tokenDoc = await firestore.collection('adminRefreshTokens').doc(decoded.userId).get();
    
    if (!tokenDoc.exists || tokenDoc.data().token !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token inválido'
      });
    }

    // Buscar dados do usuário
    const userDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();
    if (!userDoc.exists || !userDoc.data().active) {
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
        role: userData.role,
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
    console.error('❌ Erro ao renovar token:', error);
    res.status(401).json({
      success: false,
      error: 'Refresh token inválido ou expirado'
    });
  }
});

// GET /api/admin/auth/verify
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar se usuário ainda existe e está ativo
    const firestore = admin.firestore();
    const userDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();
    
    if (!userDoc.exists || !userDoc.data().active) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
      });
    }

    res.json({
      success: true,
      user: {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        permissions: decoded.permissions
      }
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
});

module.exports = router;
```

### **Backend - Middleware JWT**

**Arquivo:** `leaf-websocket-backend/middleware/jwt-auth.js`

```javascript
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const authenticateJWT = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Token não fornecido'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verificar se usuário ainda existe e está ativo
    const firestore = admin.firestore();
    const userDoc = await firestore.collection('adminUsers').doc(decoded.userId).get();
    
    if (!userDoc.exists || !userDoc.data().active) {
      return res.status(403).json({
        success: false,
        error: 'Usuário não encontrado ou inativo'
      });
    }

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      permissions: decoded.permissions || []
    };

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Não autenticado'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: 'Permissão insuficiente'
      });
    }

    next();
  };
};

module.exports = {
  authenticateJWT,
  requirePermission
};
```

---

### **Frontend - Serviço de Autenticação JWT**

**Arquivo:** `leaf-dashboard/src/services/auth-service.ts`

```typescript
import { leafAPI } from './api';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'super-admin' | 'viewer';
  permissions: string[];
}

class AuthService {
  private readonly ACCESS_TOKEN_KEY = 'leaf_admin_access_token';
  private readonly REFRESH_TOKEN_KEY = 'leaf_admin_refresh_token';
  private readonly USER_KEY = 'leaf_admin_user';
  private refreshTimer: NodeJS.Timeout | null = null;

  async login(email: string, password: string): Promise<{ tokens: AuthTokens; user: AdminUser }> {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://216.238.107.59:3001'}/api/admin/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Erro ao fazer login');
    }

    const data = await response.json();
    
    // Salvar tokens
    this.setTokens(data.accessToken, data.refreshToken);
    this.setUser(data.user);
    
    // Configurar refresh automático
    this.setupAutoRefresh(data.expiresIn);
    
    return {
      tokens: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn
      },
      user: data.user
    };
  }

  async refreshToken(): Promise<string | null> {
    const refreshToken = this.getRefreshToken();
    
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://216.238.107.59:3001'}/api/admin/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        this.logout();
        return null;
      }

      const data = await response.json();
      this.setAccessToken(data.accessToken);
      this.setupAutoRefresh(data.expiresIn);
      
      return data.accessToken;
    } catch (error) {
      console.error('Erro ao renovar token:', error);
      this.logout();
      return null;
    }
  }

  async verifyToken(): Promise<AdminUser | null> {
    const token = this.getAccessToken();
    
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://216.238.107.59:3001'}/api/admin/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        // Tentar renovar token
        const newToken = await this.refreshToken();
        if (!newToken) {
          return null;
        }
        // Retentar verificação
        return this.verifyToken();
      }

      const data = await response.json();
      this.setUser(data.user);
      return data.user;
    } catch (error) {
      console.error('Erro ao verificar token:', error);
      return null;
    }
  }

  logout(): void {
    this.clearTokens();
    this.clearUser();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  getUser(): AdminUser | null {
    if (typeof window === 'undefined') return null;
    const userStr = localStorage.getItem(this.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  private setAccessToken(accessToken: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
  }

  private setUser(user: AdminUser): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  private clearTokens(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  private clearUser(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.USER_KEY);
  }

  private setupAutoRefresh(expiresIn: string): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Converter expiresIn (ex: "24h") para milissegundos
    const expiresInMs = this.parseExpiresIn(expiresIn);
    // Renovar 5 minutos antes de expirar
    const refreshInMs = expiresInMs - (5 * 60 * 1000);

    this.refreshTimer = setTimeout(() => {
      this.refreshToken();
    }, refreshInMs);
  }

  private parseExpiresIn(expiresIn: string): number {
    // "24h" -> 24 * 60 * 60 * 1000
    const match = expiresIn.match(/(\d+)([hms])/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24h

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'h': return value * 60 * 60 * 1000;
      case 'm': return value * 60 * 1000;
      case 's': return value * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }
}

export const authService = new AuthService();
```

---

## 🎯 **PRÓXIMOS PASSOS**

1. ✅ Implementar backend JWT (`/api/admin/auth/*`)
2. ✅ Implementar middleware JWT
3. ✅ Implementar frontend auth service
4. ✅ Integrar com AuthContext existente
5. ✅ Testar fluxo completo de autenticação
6. ⏭️ Implementar WebSocket para métricas em tempo real
7. ⏭️ Implementar React Query para cache

---

**Última atualização:** 16/12/2025




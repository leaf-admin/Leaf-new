// Serviço de autenticação JWT para Dashboard Admin

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://dashboard.leaf.app.br/api';

class AuthService {
  constructor() {
    this.ACCESS_TOKEN_KEY = 'leaf_admin_access_token';
    this.REFRESH_TOKEN_KEY = 'leaf_admin_refresh_token';
    this.USER_KEY = 'leaf_admin_user';
    this.refreshTimer = null;
  }

  /**
   * Fazer login e obter tokens JWT
   */
  async login(email, password) {
    const response = await fetch(`${API_BASE_URL}/admin/auth/login`, {
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
    
    if (!data.success) {
      throw new Error(data.error || 'Erro ao fazer login');
    }
    
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

  /**
   * Renovar access token usando refresh token
   */
  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    
    if (!refreshToken) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/auth/refresh`, {
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
      
      if (!data.success) {
        this.logout();
        return null;
      }

      this.setAccessToken(data.accessToken);
      this.setupAutoRefresh(data.expiresIn);
      
      return data.accessToken;
    } catch (error) {
      console.error('Erro ao renovar token:', error);
      this.logout();
      return null;
    }
  }

  /**
   * Verificar se token atual é válido
   */
  async verifyToken() {
    const token = this.getAccessToken();
    
    if (!token) {
      return null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/admin/auth/verify`, {
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
        // Retentar verificação com novo token
        return this.verifyToken();
      }

      const data = await response.json();
      
      if (!data.success) {
        return null;
      }

      this.setUser(data.user);
      return data.user;
    } catch (error) {
      console.error('Erro ao verificar token:', error);
      return null;
    }
  }

  /**
   * Fazer logout e limpar tokens
   */
  async logout() {
    const token = this.getAccessToken();
    
    // Tentar invalidar token no servidor (opcional, não bloquear se falhar)
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/admin/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      } catch (error) {
        console.warn('Erro ao fazer logout no servidor:', error);
      }
    }

    this.clearTokens();
    this.clearUser();
    
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Obter access token atual
   */
  getAccessToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  /**
   * Obter refresh token atual
   */
  getRefreshToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Obter dados do usuário atual
   */
  getUser() {
    if (typeof window === 'undefined') return null;
    const userStr = localStorage.getItem(this.USER_KEY);
    return userStr ? JSON.parse(userStr) : null;
  }

  /**
   * Verificar se usuário está autenticado
   */
  isAuthenticated() {
    return this.getAccessToken() !== null && this.getUser() !== null;
  }

  /**
   * Obter headers de autenticação para requisições
   */
  getAuthHeaders() {
    const token = this.getAccessToken();
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
  }

  setTokens(accessToken, refreshToken) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  setAccessToken(accessToken) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
  }

  setUser(user) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  clearTokens() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  clearUser() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.USER_KEY);
  }

  /**
   * Configurar refresh automático do token
   */
  setupAutoRefresh(expiresIn) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Converter expiresIn (ex: "24h") para milissegundos
    const expiresInMs = this.parseExpiresIn(expiresIn);
    // Renovar 5 minutos antes de expirar
    const refreshInMs = Math.max(expiresInMs - (5 * 60 * 1000), 60000); // Mínimo 1 minuto

    this.refreshTimer = setTimeout(() => {
      this.refreshToken();
    }, refreshInMs);
  }

  /**
   * Converter string de expiração para milissegundos
   * Ex: "24h" -> 24 * 60 * 60 * 1000
   */
  parseExpiresIn(expiresIn) {
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
export default authService;


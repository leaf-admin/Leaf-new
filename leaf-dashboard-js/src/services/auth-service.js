import config from "@/src/config";

const API_BASE_URL = config.api.baseUrl;

class AuthService {
  constructor() {
    this.ACCESS_TOKEN_KEY = "leaf_admin_access_token";
    this.REFRESH_TOKEN_KEY = "leaf_admin_refresh_token";
    this.USER_KEY = "leaf_admin_user";
    this.refreshTimer = null;
  }

  async login(email, password) {
    const response = await fetch(`${API_BASE_URL}/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.success) {
      throw new Error(data?.error || "Erro ao fazer login");
    }

    this.setTokens(data.accessToken, data.refreshToken);
    this.setUser(data.user);
    this.setupAutoRefresh(data.expiresIn);
    return data.user;
  }

  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        this.logout();
        return null;
      }

      this.setAccessToken(data.accessToken);
      this.setupAutoRefresh(data.expiresIn);
      return data.accessToken;
    } catch {
      this.logout();
      return null;
    }
  }

  async verifyToken() {
    const token = this.getAccessToken();
    if (!token) return null;

    const doVerify = async (accessToken) => {
      const response = await fetch(`${API_BASE_URL}/admin/auth/verify`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;
      const data = await response.json().catch(() => ({}));
      return data?.success ? data.user : null;
    };

    let user = await doVerify(token);
    if (user) {
      this.setUser(user);
      return user;
    }

    const renewed = await this.refreshToken();
    if (!renewed) return null;

    user = await doVerify(renewed);
    if (user) this.setUser(user);
    return user;
  }

  async logout() {
    const token = this.getAccessToken();
    if (token) {
      try {
        await fetch(`${API_BASE_URL}/admin/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    this.clearTokens();
    this.clearUser();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  isAuthenticated() {
    return !!this.getAccessToken() && !!this.getUser();
  }

  getAccessToken() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(this.ACCESS_TOKEN_KEY);
  }

  getRefreshToken() {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  getUser() {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  setTokens(accessToken, refreshToken) {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  setAccessToken(accessToken) {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
  }

  setUser(user) {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  clearTokens() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }

  clearUser() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(this.USER_KEY);
  }

  setupAutoRefresh(expiresIn) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const ttl = this.parseExpiresIn(expiresIn);
    const refreshInMs = Math.max(ttl - 5 * 60 * 1000, 60 * 1000);
    this.refreshTimer = setTimeout(() => this.refreshToken(), refreshInMs);
  }

  parseExpiresIn(expiresIn) {
    if (!expiresIn) return 60 * 60 * 1000;
    if (typeof expiresIn === "number") return expiresIn * 1000;
    const match = String(expiresIn).match(/^(\d+)([smhd])$/i);
    if (!match) return 60 * 60 * 1000;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const map = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (map[unit] || 60 * 60 * 1000);
  }
}

export const authService = new AuthService();
export default authService;

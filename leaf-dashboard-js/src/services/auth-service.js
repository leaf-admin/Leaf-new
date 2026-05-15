import config from "@/src/config";

const API_BASE_URL = config.api.baseUrl;

const getApiBaseUrl = () => {
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return "/api";
  }
  return API_BASE_URL;
};

class AuthService {
  constructor() {
    this.ACCESS_TOKEN_KEY = "leaf_admin_access_token";
    this.REFRESH_TOKEN_KEY = "leaf_admin_refresh_token";
    this.USER_KEY = "leaf_admin_user";
    this.refreshTimer = null;
  }

  async login(email, password) {
    const response = await fetch(`${getApiBaseUrl()}/admin/auth/login`, {
      method: "POST",
      credentials: "omit",
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
      const response = await fetch(`${getApiBaseUrl()}/admin/auth/refresh`, {
        method: "POST",
        credentials: "omit",
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
      const response = await fetch(`${getApiBaseUrl()}/admin/auth/verify`, {
        credentials: "omit",
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
        await fetch(`${getApiBaseUrl()}/admin/auth/logout`, {
          method: "POST",
          credentials: "omit",
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

  getPrimaryStorage() {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  }

  getLegacyStorage() {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  }

  readValue(key) {
    const primary = this.getPrimaryStorage();
    const legacy = this.getLegacyStorage();
    let value = primary?.getItem(key) || null;

    // Migração suave: move token legado para sessionStorage na primeira leitura.
    if (!value && legacy) {
      value = legacy.getItem(key);
      if (value && primary) {
        primary.setItem(key, value);
        legacy.removeItem(key);
      }
    }

    return value;
  }

  writeValue(key, value) {
    const primary = this.getPrimaryStorage();
    const legacy = this.getLegacyStorage();
    if (primary) primary.setItem(key, value);
    if (legacy) legacy.removeItem(key);
  }

  removeValue(key) {
    const primary = this.getPrimaryStorage();
    const legacy = this.getLegacyStorage();
    if (primary) primary.removeItem(key);
    if (legacy) legacy.removeItem(key);
  }

  getAccessToken() {
    return this.readValue(this.ACCESS_TOKEN_KEY);
  }

  getRefreshToken() {
    return this.readValue(this.REFRESH_TOKEN_KEY);
  }

  getUser() {
    const raw = this.readValue(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  setTokens(accessToken, refreshToken) {
    this.writeValue(this.ACCESS_TOKEN_KEY, accessToken);
    this.writeValue(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  setAccessToken(accessToken) {
    this.writeValue(this.ACCESS_TOKEN_KEY, accessToken);
  }

  setUser(user) {
    this.writeValue(this.USER_KEY, JSON.stringify(user));
  }

  clearTokens() {
    this.removeValue(this.ACCESS_TOKEN_KEY);
    this.removeValue(this.REFRESH_TOKEN_KEY);
  }

  clearUser() {
    this.removeValue(this.USER_KEY);
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

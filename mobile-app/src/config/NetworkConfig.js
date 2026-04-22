import Logger from "../utils/Logger";
// NetworkConfig.js
// Configuração centralizada de rede para desenvolvimento

const normalizeBaseUrl = (rawUrl, fallback) => {
  const raw = String(rawUrl || "").trim();
  if (!raw) return fallback;
  return raw.replace(/\/+$/, "").replace(/\/api$/i, "");
};

const deriveSocketBaseUrlFromApi = (
  rawUrl,
  fallback = "https://socket.62.169.31.231.sslip.io",
) => {
  const normalized = normalizeBaseUrl(rawUrl, fallback);
  try {
    const parsed = new URL(normalized);
    if (/^api(?=[.-])/i.test(parsed.hostname)) {
      parsed.hostname = parsed.hostname.replace(/^api(?=[.-])/i, "socket");
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
};

const normalizeSocketBaseUrl = (
  rawUrl,
  fallback = "https://socket.62.169.31.231.sslip.io",
) => {
  const normalized = normalizeBaseUrl(rawUrl, fallback);
  try {
    const parsed = new URL(normalized);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return fallback;
  }
};

const DEFAULT_API_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_URL,
  "https://api.62.169.31.231.sslip.io",
);
const DEFAULT_WS_URL = normalizeSocketBaseUrl(
  process.env.EXPO_PUBLIC_WS_URL ||
    process.env.EXPO_PUBLIC_SOCKET_URL ||
    process.env.MOBILE_TEST_WS_URL,
  deriveSocketBaseUrlFromApi(
    process.env.EXPO_PUBLIC_API_URL || process.env.MOBILE_TEST_BACKEND_URL,
    "https://socket.62.169.31.231.sslip.io",
  ),
);

// Configurações de rede
const NETWORK_CONFIG = {
  // Hosts canônicos de produção
  HOSTS: {
    API: "api.62.169.31.231.sslip.io",
    WEBSOCKET: "socket.62.169.31.231.sslip.io",
    DASHBOARD: "dashboard.62.169.31.231.sslip.io",
  },

  // Porta padrão de produção
  PORTS: {
    HTTPS: 443,
  },

  // URLs de desenvolvimento (via domínios oficiais)
  DEV_URLS: {
    WEBSOCKET: DEFAULT_WS_URL,
    API: DEFAULT_API_URL,
    NOTIFICATIONS: DEFAULT_API_URL,
  },

  // URLs de produção (domínios)
  PROD_URLS: {
    WEBSOCKET: DEFAULT_WS_URL,
    API: DEFAULT_API_URL,
    NOTIFICATIONS: DEFAULT_API_URL,
  },
};

// Função para obter URL baseada no ambiente
export const getWebSocketURL = () => {
  return DEFAULT_WS_URL || NETWORK_CONFIG.PROD_URLS.WEBSOCKET;
};

export const getApiURL = () => {
  // ✅ SEMPRE usar VPS
  return NETWORK_CONFIG.PROD_URLS.API;
};

export const getNotificationsURL = () => {
  // ✅ SEMPRE usar VPS
  return NETWORK_CONFIG.PROD_URLS.NOTIFICATIONS;
};

// Função para obter IP local automaticamente (futuro)
export const getLocalIP = async () => {
  try {
    return NETWORK_CONFIG.HOSTS.API;
  } catch (error) {
    Logger.error("Erro ao obter IP local:", error);
    return NETWORK_CONFIG.HOSTS.API;
  }
};

// Função para validar configuração
export const validateNetworkConfig = () => {
  const issues = [];
  const wsUrl = getWebSocketURL();
  const apiUrl = getApiURL();

  if (!__DEV__ && /(localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(wsUrl)) {
    issues.push("URL local de WebSocket detectada fora de dev");
  }

  if (!__DEV__ && /(localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(apiUrl)) {
    issues.push("URL local de API detectada fora de dev");
  }

  return {
    isValid: issues.length === 0,
    issues,
    config: NETWORK_CONFIG,
  };
};

export default NETWORK_CONFIG;

// Instruções para configurar via env:
/*
Defina EXPO_PUBLIC_API_URL e EXPO_PUBLIC_WS_URL:
EXPO_PUBLIC_API_URL=https://api.62.169.31.231.sslip.io
EXPO_PUBLIC_WS_URL=https://socket.62.169.31.231.sslip.io
*/

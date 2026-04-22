import Logger from "../utils/Logger";
import { Platform } from "react-native";

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

const DEFAULT_WS_URL = normalizeSocketBaseUrl(
  process.env.EXPO_PUBLIC_WS_URL ||
    process.env.EXPO_PUBLIC_SOCKET_URL ||
    process.env.MOBILE_TEST_WS_URL,
  deriveSocketBaseUrlFromApi(
    process.env.EXPO_PUBLIC_API_URL || process.env.MOBILE_TEST_BACKEND_URL,
    "https://socket.62.169.31.231.sslip.io",
  ),
);

// Configurações do WebSocket
const WEBSOCKET_CONFIG = {
  // Para desenvolvimento local (opcional via env vars)
  LOCAL: {
    ANDROID_EMULATOR:
      process.env.EXPO_PUBLIC_ANDROID_EMULATOR_WS_URL || DEFAULT_WS_URL,
    IOS_SIMULATOR:
      process.env.EXPO_PUBLIC_IOS_SIMULATOR_WS_URL || DEFAULT_WS_URL,
    DEVICE: DEFAULT_WS_URL,
  },

  // Para produção
  PRODUCTION: {
    URL: DEFAULT_WS_URL,
  },

  // Configurações de conexão
  CONNECTION: {
    TIMEOUT: 20000, // 20 segundos
    RECONNECTION_ATTEMPTS: 5,
    RECONNECTION_DELAY: 1000, // 1 segundo
    PING_INTERVAL: 30000, // 30 segundos
  },

  // Configurações de localização
  LOCATION: {
    UPDATE_INTERVAL: 2000, // 2 segundos
    ACCURACY: "high", // 'high', 'balanced', 'low'
    DISTANCE_FILTER: 10, // metros
  },

  // Configurações de busca de motoristas
  DRIVER_SEARCH: {
    DEFAULT_RADIUS: 5000, // 5km
    DEFAULT_LIMIT: 10,
    MAX_RADIUS: 50000, // 50km
    MIN_RADIUS: 100, // 100m
  },
};

// Determinar URL baseada na plataforma e ambiente
const getWebSocketURL = () => {
  return DEFAULT_WS_URL;

  // Código antigo (comentado para referência):
  // if (__DEV__) {
  //   // Desenvolvimento
  //   if (Platform.OS === 'android') {
  //     return WEBSOCKET_CONFIG.LOCAL.ANDROID_EMULATOR;
  //   } else if (Platform.OS === 'ios') {
  //     return WEBSOCKET_CONFIG.LOCAL.IOS_SIMULATOR;
  //   }
  //   return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  // } else {
  //   // Produção
  //   return WEBSOCKET_CONFIG.PRODUCTION.URL;
  // }
};

// Obter configurações de conexão
const getConnectionOptions = () => {
  return {
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: WEBSOCKET_CONFIG.CONNECTION.RECONNECTION_ATTEMPTS,
    reconnectionDelay: WEBSOCKET_CONFIG.CONNECTION.RECONNECTION_DELAY,
    timeout: WEBSOCKET_CONFIG.CONNECTION.TIMEOUT,
  };
};

// Obter configurações de localização
const getLocationConfig = () => {
  return {
    updateInterval: WEBSOCKET_CONFIG.LOCATION.UPDATE_INTERVAL,
    accuracy: WEBSOCKET_CONFIG.LOCATION.ACCURACY,
    distanceFilter: WEBSOCKET_CONFIG.LOCATION.DISTANCE_FILTER,
  };
};

// Obter configurações de busca de motoristas
const getDriverSearchConfig = () => {
  return {
    defaultRadius: WEBSOCKET_CONFIG.DRIVER_SEARCH.DEFAULT_RADIUS,
    defaultLimit: WEBSOCKET_CONFIG.DRIVER_SEARCH.DEFAULT_LIMIT,
    maxRadius: WEBSOCKET_CONFIG.DRIVER_SEARCH.MAX_RADIUS,
    minRadius: WEBSOCKET_CONFIG.DRIVER_SEARCH.MIN_RADIUS,
  };
};

// Função para obter IP da máquina local (para desenvolvimento)
const getLocalIP = async () => {
  try {
    // Esta função pode ser implementada para detectar automaticamente o IP
    // Por enquanto, retorna o IP configurado
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  } catch (error) {
    Logger.error("Erro ao obter IP local:", error);
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  }
};

// Função para validar configurações
const validateConfig = () => {
  const url = getWebSocketURL();
  const issues = [];

  if (__DEV__) {
    if (url.includes("your-backend-domain.com")) {
      issues.push("⚠️ Configure EXPO_PUBLIC_WS_URL com a URL real do backend");
    }
  }

  if (!__DEV__ && /(localhost|127\.0\.0\.1|10\.0\.2\.2)/i.test(url)) {
    issues.push("⚠️ URL local de WebSocket detectada fora de dev");
  }

  return {
    isValid: issues.length === 0,
    issues,
    url,
  };
};

export default {
  getWebSocketURL,
  getConnectionOptions,
  getLocationConfig,
  getDriverSearchConfig,
  getLocalIP,
  validateConfig,
  config: WEBSOCKET_CONFIG,
};

// Função para obter configuração baseada no ambiente
export const getWebSocketConfig = () => {
  return __DEV__ ? getConnectionOptions() : getConnectionOptions();
};

// Função para obter URL do WebSocket
export const getWebSocketUrl = () => {
  return getWebSocketURL();
};

// Instruções para configurar via env:
/*
Defina EXPO_PUBLIC_WS_URL no ambiente:
EXPO_PUBLIC_WS_URL=https://socket.62.169.31.231.sslip.io
*/

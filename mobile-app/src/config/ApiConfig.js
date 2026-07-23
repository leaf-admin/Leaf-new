import Logger from "../utils/Logger";
// ApiConfig.js - Configuração centralizada para URLs da API
import { Platform } from "react-native";
import {
  deriveRuntimeSocketBaseUrlFromApi,
  getRuntimeApiBaseUrl,
  getRuntimeSocketBaseUrl,
} from "./runtimeEndpointConfig";

const normalizeBaseUrl = (
  url,
  fallback = "https://api.leaf.app.br",
) => {
  const raw = String(url || "").trim();
  if (!raw) return fallback;
  const withoutTrailingSlash = raw.replace(/\/+$/, "");
  // Evita /api/api/* quando a variável de ambiente já inclui o prefixo /api
  return withoutTrailingSlash.replace(/\/api$/i, "");
};

const deriveSocketBaseUrlFromApi = (url, fallback = DEFAULT_WS_BASE_URL) => {
  const normalized = normalizeBaseUrl(url, fallback);
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

const normalizeSocketBaseUrl = (url, fallback = DEFAULT_WS_BASE_URL) => {
  const normalized = normalizeBaseUrl(url, fallback);
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

const DEFAULT_API_BASE_URL = "https://api.leaf.app.br";
const DEFAULT_WS_BASE_URL = "https://socket.leaf.app.br";
const RUNTIME_API_BASE_URL = getRuntimeApiBaseUrl(DEFAULT_API_BASE_URL);
const RUNTIME_WS_BASE_URL = getRuntimeSocketBaseUrl(
  deriveRuntimeSocketBaseUrlFromApi(RUNTIME_API_BASE_URL, DEFAULT_WS_BASE_URL),
);
const DEFAULT_DASHBOARD_URL = "https://dashboard.leaf.app.br";
const DEFAULT_FIREBASE_FUNCTIONS_BASE_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_URL ||
    process.env.FIREBASE_FUNCTIONS_URL ||
    "",
  "",
);
const FIREBASE_FALLBACK_ENABLED =
  String(
    process.env.EXPO_PUBLIC_ENABLE_FIREBASE_FALLBACK ||
      process.env.ENABLE_FIREBASE_FALLBACK ||
      "",
  )
    .trim()
    .toLowerCase() === "true" && Boolean(DEFAULT_FIREBASE_FUNCTIONS_BASE_URL);

// Configurações por ambiente
const ENV = {
  development: {
    // 🏠 SELF-HOSTED VPS - PRINCIPAL
    selfHostedApi: {
      web: normalizeBaseUrl(
        RUNTIME_API_BASE_URL,
        RUNTIME_API_BASE_URL,
      ),
      mobile: normalizeBaseUrl(
        RUNTIME_API_BASE_URL,
        RUNTIME_API_BASE_URL,
      ),
    },
    selfHostedWebSocket: {
      web: normalizeSocketBaseUrl(
        RUNTIME_WS_BASE_URL,
        deriveSocketBaseUrlFromApi(
          RUNTIME_API_BASE_URL,
          RUNTIME_WS_BASE_URL,
        ),
      ),
      mobile: normalizeSocketBaseUrl(
        RUNTIME_WS_BASE_URL,
        deriveSocketBaseUrlFromApi(
          RUNTIME_API_BASE_URL,
          RUNTIME_WS_BASE_URL,
        ),
      ),
    },
    // 🔄 FALLBACK - Firebase Functions (se necessário)
    firebaseFunctions: {
      web: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : "",
      mobile: FIREBASE_FALLBACK_ENABLED
        ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL
        : "",
    },
    // 📊 Dashboard VPS
    dashboard: {
      web: process.env.EXPO_PUBLIC_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
      mobile: process.env.EXPO_PUBLIC_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    },
  },
  production: {
    // 🏠 SELF-HOSTED VPS - PRODUÇÃO
    selfHostedApi: {
      web: normalizeBaseUrl(
        RUNTIME_API_BASE_URL,
        RUNTIME_API_BASE_URL,
      ),
      mobile: normalizeBaseUrl(
        RUNTIME_API_BASE_URL,
        RUNTIME_API_BASE_URL,
      ),
    },
    selfHostedWebSocket: {
      web: normalizeSocketBaseUrl(
        RUNTIME_WS_BASE_URL,
        deriveSocketBaseUrlFromApi(
          RUNTIME_API_BASE_URL,
          RUNTIME_WS_BASE_URL,
        ),
      ),
      mobile: normalizeSocketBaseUrl(
        RUNTIME_WS_BASE_URL,
        deriveSocketBaseUrlFromApi(
          RUNTIME_API_BASE_URL,
          RUNTIME_WS_BASE_URL,
        ),
      ),
    },
    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: {
      web: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : "",
      mobile: FIREBASE_FALLBACK_ENABLED
        ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL
        : "",
    },
    // 📊 Dashboard
    dashboard: {
      web: process.env.EXPO_PUBLIC_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
      mobile: process.env.EXPO_PUBLIC_DASHBOARD_URL || DEFAULT_DASHBOARD_URL,
    },
  },
};

// Determinar ambiente (pode ser expandido para usar variáveis de ambiente)
const getEnvironment = () => {
  // ✅ CORREÇÃO: Sempre usar 'production' para garantir uso da VPS
  // A VPS está configurada tanto em development quanto production
  return __DEV__ ? "development" : "production";
};

// Obter configuração baseada na plataforma
const getConfig = () => {
  const env = getEnvironment();
  const platform = Platform.OS;

  // ✅ CORREÇÃO: Para dispositivos móveis (android/ios), sempre usar 'mobile'
  // Isso garante que use o host canônico configurado para produção.
  const platformKey =
    platform === "android" || platform === "ios" ? "mobile" : platform;

  Logger.log(
    "🔧 [ApiConfig] Platform.OS:",
    platform,
    "| Usando chave:",
    platformKey,
  );

  return {
    // 🏠 SELF-HOSTED VPS (PRINCIPAL)
    // ✅ CORREÇÃO: Usar platformKey para garantir IP correto em dispositivos móveis
    selfHostedApi:
      ENV[env].selfHostedApi[platformKey] ||
      ENV[env].selfHostedApi.mobile ||
      ENV[env].selfHostedApi.web,
    selfHostedWebSocket:
      ENV[env].selfHostedWebSocket[platformKey] ||
      ENV[env].selfHostedWebSocket.mobile ||
      ENV[env].selfHostedWebSocket.web,

    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions:
      ENV[env].firebaseFunctions[platformKey] || ENV[env].firebaseFunctions.web,

    // 📊 Dashboard
    dashboard: ENV[env].dashboard[platformKey] || ENV[env].dashboard.web,

    environment: env,
    platform: platform,
    platformKey: platformKey,
  };
};

// Configuração atual
const config = getConfig();

// ✅ LOG DE DEBUG: Verificar URL configurada
Logger.log("🔧 [ApiConfig] Configuração carregada:", {
  platform: config.platform,
  platformKey: config.platformKey,
  selfHostedApi: config.selfHostedApi,
  selfHostedWebSocket: config.selfHostedWebSocket,
  environment: config.environment,
});

// URLs específicas para serviços
export const API_URLS = {
  // 🏠 SELF-HOSTED API (PRINCIPAL)
  selfHostedApi: config.selfHostedApi,

  // 🔌 SELF-HOSTED WEBSOCKET
  selfHostedWebSocket: config.selfHostedWebSocket,

  // 🔄 FALLBACK - Firebase Functions
  firebaseFunctions: config.firebaseFunctions,

  // 📊 Dashboard
  dashboard: config.dashboard,

  // Endpoints específicos - SELF-HOSTED
  selfHostedEndpoints: {
    // WebSocket-only no backend atual
    updateUserLocation: "__WS_ONLY__",
    updateDriverLocation: "__WS_ONLY__",
    getNearbyDrivers: "/api/drivers/nearby",
    getStats: "/api/app/stats",
    health: "/api/health",
    startTripTracking: "__WS_ONLY__",
    updateTripLocation: "__WS_ONLY__",
    endTripTracking: "__WS_ONLY__",
    getTripData: "__WS_ONLY__",
    getRedisStats: "/api/queue/cache/stats",
  },

  // Endpoints específicos - Firebase Functions (FALLBACK)
  firebaseEndpoints: {
    updateUserLocation: "/update_user_location",
    updateDriverLocation: "/update_driver_location",
    getNearbyDrivers: "/get_nearby_drivers",
    getStats: "/get_redis_stats",
    health: "/health",
    startTripTracking: "/start_trip_tracking",
    updateTripLocation: "/update_trip_location",
    endTripTracking: "/end_trip_tracking",
    getTripData: "/get_trip_data",
  },
};

export const getSelfHostedApiUrl = (endpoint) => {
  let baseUrl = normalizeBaseUrl(
    RUNTIME_API_BASE_URL || API_URLS.selfHostedApi,
  );
  return `${baseUrl}${endpoint}`;
};

// Função para obter URL da API Firebase (fallback)
export const getFirebaseApiUrl = (endpoint) => {
  if (!API_URLS.firebaseFunctions) {
    throw new Error(
      "Firebase Functions fallback is disabled for the current runtime.",
    );
  }
  return `${API_URLS.firebaseFunctions}${endpoint}`;
};

// Função para obter URL do WebSocket Self-Hosted
export const getSelfHostedWebSocketUrl = () => {
  return API_URLS.selfHostedWebSocket;
};

// Função para obter URL do Dashboard
export const getDashboardUrl = () => {
  return API_URLS.dashboard;
};

// Função principal para obter URL da API (usa Self-Hosted como principal)
export const getApiUrl = (endpoint, useFallback = false) => {
  const mapped = useFallback
    ? API_URLS.firebaseEndpoints[endpoint] || endpoint
    : API_URLS.selfHostedEndpoints[endpoint] || endpoint;

  if (mapped === "__WS_ONLY__") {
    throw new Error(
      `Endpoint "${endpoint}" é WebSocket-only e não possui fallback HTTP.`,
    );
  }

  if (useFallback) {
    return getFirebaseApiUrl(mapped);
  }
  return getSelfHostedApiUrl(mapped);
};

// Função principal para obter URL do WebSocket (usa Self-Hosted como principal)
export const getWebSocketUrl = (useFallback = false) => {
  if (useFallback) {
    if (!API_URLS.firebaseFunctions) {
      throw new Error(
        "Firebase Functions fallback is disabled for the current runtime.",
      );
    }
    return API_URLS.firebaseFunctions;
  }
  return getSelfHostedWebSocketUrl();
};

// Configuração de ambiente
export const ENVIRONMENT = {
  isDevelopment: __DEV__,
  isProduction: !__DEV__,
  platform: Platform.OS,
  environment: getEnvironment(),
};

// Configuração de debug
export const DEBUG_CONFIG = {
  logApiCalls: __DEV__,
  logWebSocketEvents: __DEV__,
  showNetworkErrors: __DEV__,
  enableMockData: false,
};

// Configuração de timeout
export const TIMEOUT_CONFIG = {
  apiRequest: 30000, // 30 segundos
  webSocketConnection: 20000, // 20 segundos
  locationUpdate: 5000, // 5 segundos
  driverSearch: 10000, // 10 segundos
};

// Configuração de retry
export const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1 segundo
  exponentialBackoff: true,
};

// Exportar configuração completa
export default {
  API_URLS,
  getApiUrl,
  getWebSocketUrl,
  getSelfHostedApiUrl,
  getFirebaseApiUrl,
  getSelfHostedWebSocketUrl,
  getDashboardUrl,
  ENVIRONMENT,
  DEBUG_CONFIG,
  TIMEOUT_CONFIG,
  RETRY_CONFIG,
};

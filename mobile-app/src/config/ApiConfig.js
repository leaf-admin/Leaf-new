import Logger from '../utils/Logger';
// ApiConfig.js - Configuração centralizada para URLs da API
import { Platform } from 'react-native';


// Configurações por ambiente
const ENV = {
  development: {
    // 🏠 SELF-HOSTED VPS - PRINCIPAL
    selfHostedApi: {
      web: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br',
      mobile: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br'
    },
    selfHostedWebSocket: {
      web: process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3001',
      mobile: process.env.EXPO_PUBLIC_WS_URL || 'http://localhost:3001'
    },
    // 🔄 FALLBACK - Firebase Functions (se necessário)
    firebaseFunctions: {
      web: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net',
      mobile: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net'
    },
    // 📊 Dashboard VPS
    dashboard: {
      web: process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://dashboard.leaf.app.br',
      mobile: process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://dashboard.leaf.app.br'
    }
  },
  production: {
    // 🏠 SELF-HOSTED VPS - PRODUÇÃO
    selfHostedApi: {
      web: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br',
      mobile: process.env.EXPO_PUBLIC_API_URL || 'https://api.leaf.app.br'
    },
    selfHostedWebSocket: {
      web: process.env.EXPO_PUBLIC_WS_URL || 'https://api.leaf.app.br',
      mobile: process.env.EXPO_PUBLIC_WS_URL || 'https://api.leaf.app.br'
    },
    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: {
      web: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net',
      mobile: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net'
    },
    // 📊 Dashboard
    dashboard: {
      web: process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://dashboard.leaf.app.br',
      mobile: process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://dashboard.leaf.app.br'
    }
  }
};

// Determinar ambiente (pode ser expandido para usar variáveis de ambiente)
const getEnvironment = () => {
  // ✅ CORREÇÃO: Sempre usar 'production' para garantir uso da VPS
  // A VPS está configurada tanto em development quanto production
  return __DEV__ ? 'development' : 'production';
};

// Obter configuração baseada na plataforma
const getConfig = () => {
  const env = getEnvironment();
  const platform = Platform.OS;

  // ✅ CORREÇÃO: Para dispositivos móveis (android/ios), sempre usar 'mobile'
  // Isso garante que use a VPS (https://api.leaf.app.br) ao invés de localhost
  const platformKey = (platform === 'android' || platform === 'ios') ? 'mobile' : platform;

  Logger.log('🔧 [ApiConfig] Platform.OS:', platform, '| Usando chave:', platformKey);

  return {
    // 🏠 SELF-HOSTED VPS (PRINCIPAL)
    // ✅ CORREÇÃO: Usar platformKey para garantir IP correto em dispositivos móveis
    selfHostedApi: ENV[env].selfHostedApi[platformKey] || ENV[env].selfHostedApi.mobile || ENV[env].selfHostedApi.web,
    selfHostedWebSocket: ENV[env].selfHostedWebSocket[platformKey] || ENV[env].selfHostedWebSocket.mobile || ENV[env].selfHostedWebSocket.web,

    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: ENV[env].firebaseFunctions[platformKey] || ENV[env].firebaseFunctions.web,

    // 📊 Dashboard
    dashboard: ENV[env].dashboard[platformKey] || ENV[env].dashboard.web,

    environment: env,
    platform: platform,
    platformKey: platformKey
  };
};

// Configuração atual
const config = getConfig();

// ✅ LOG DE DEBUG: Verificar URL configurada
Logger.log('🔧 [ApiConfig] Configuração carregada:', {
  platform: config.platform,
  platformKey: config.platformKey,
  selfHostedApi: config.selfHostedApi,
  selfHostedWebSocket: config.selfHostedWebSocket,
  environment: config.environment
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
    updateUserLocation: '/api/update_user_location',
    updateDriverLocation: '/api/update_driver_location',
    getNearbyDrivers: '/api/nearby_drivers',
    getStats: '/api/stats',
    health: '/api/health',
    startTripTracking: '/api/start_trip_tracking',
    updateTripLocation: '/api/update_trip_location',
    endTripTracking: '/api/end_trip_tracking',
    getTripData: '/api/get_trip_data',
    getRedisStats: '/api/get_redis_stats'
  },

  // Endpoints específicos - Firebase Functions (FALLBACK)
  firebaseEndpoints: {
    updateUserLocation: '/update_user_location',
    updateDriverLocation: '/update_driver_location',
    getNearbyDrivers: '/get_nearby_drivers',
    getStats: '/get_redis_stats',
    health: '/health',
    startTripTracking: '/start_trip_tracking',
    updateTripLocation: '/update_trip_location',
    endTripTracking: '/end_trip_tracking',
    getTripData: '/get_trip_data'
  }
};

export const getSelfHostedApiUrl = (endpoint) => {
  let baseUrl = process.env.EXPO_PUBLIC_API_URL || API_URLS.selfHostedApi;
  return `${baseUrl}${endpoint}`;
};

// Função para obter URL da API Firebase (fallback)
export const getFirebaseApiUrl = (endpoint) => {
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
  if (useFallback) {
    return getFirebaseApiUrl(API_URLS.firebaseEndpoints[endpoint] || endpoint);
  }
  return getSelfHostedApiUrl(API_URLS.selfHostedEndpoints[endpoint] || endpoint);
};

// Função principal para obter URL do WebSocket (usa Self-Hosted como principal)
export const getWebSocketUrl = (useFallback = false) => {
  if (useFallback) {
    // Para fallback, usar Firebase Functions com WebSocket
    return API_URLS.firebaseFunctions;
  }
  return getSelfHostedWebSocketUrl();
};

// Configuração de ambiente
export const ENVIRONMENT = {
  isDevelopment: __DEV__,
  isProduction: !__DEV__,
  platform: Platform.OS,
  environment: getEnvironment()
};

// Configuração de debug
export const DEBUG_CONFIG = {
  logApiCalls: __DEV__,
  logWebSocketEvents: __DEV__,
  showNetworkErrors: __DEV__,
  enableMockData: false
};

// Configuração de timeout
export const TIMEOUT_CONFIG = {
  apiRequest: 30000, // 30 segundos
  webSocketConnection: 20000, // 20 segundos
  locationUpdate: 5000, // 5 segundos
  driverSearch: 10000 // 10 segundos
};

// Configuração de retry
export const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1 segundo
  exponentialBackoff: true
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
  RETRY_CONFIG
}; 
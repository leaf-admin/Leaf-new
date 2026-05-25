// ApiConfig.cjs - Configuração centralizada para URLs da API (versão Node.js)
// Compatível com testes CommonJS

const normalizeBaseUrl = (url, fallback = 'https://api.leaf.app.br') => {
  const raw = String(url || '').trim();
  if (!raw) return fallback;
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  return withoutTrailingSlash.replace(/\/api$/i, '');
};

const deriveSocketBaseUrlFromApi = (url, fallback = 'https://socket.leaf.app.br') => {
  const normalized = normalizeBaseUrl(url, fallback);
  try {
    const parsed = new URL(normalized);
    if (/^api(?=[.-])/i.test(parsed.hostname)) {
      parsed.hostname = parsed.hostname.replace(/^api(?=[.-])/i, 'socket');
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_error) {
    return fallback;
  }
};

const normalizeSocketBaseUrl = (url, fallback = 'https://socket.leaf.app.br') => {
  const normalized = normalizeBaseUrl(url, fallback);
  try {
    const parsed = new URL(normalized);
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_error) {
    return fallback;
  }
};

const DEFAULT_BACKEND_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  process.env.MOBILE_TEST_BACKEND_URL ||
  'https://api.leaf.app.br'
);
const DEFAULT_WS_URL =
  normalizeSocketBaseUrl(
    process.env.EXPO_PUBLIC_WS_URL ||
    process.env.EXPO_PUBLIC_SOCKET_URL ||
    process.env.MOBILE_TEST_WS_URL,
    deriveSocketBaseUrlFromApi(
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      process.env.MOBILE_TEST_BACKEND_URL,
      'https://socket.leaf.app.br'
    )
  );
const DEFAULT_DASHBOARD_URL =
  process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://dashboard.leaf.app.br';
const DEFAULT_FIREBASE_FUNCTIONS_BASE_URL = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_URL ||
  process.env.FIREBASE_FUNCTIONS_URL ||
  '',
  ''
);
const FIREBASE_FALLBACK_ENABLED =
  String(process.env.EXPO_PUBLIC_ENABLE_FIREBASE_FALLBACK || process.env.ENABLE_FIREBASE_FALLBACK || '')
    .trim()
    .toLowerCase() === 'true' &&
  Boolean(DEFAULT_FIREBASE_FUNCTIONS_BASE_URL);

// Configurações por ambiente
const ENV = {
  development: {
    // 🏠 SELF-HOSTED VPS
    selfHostedApi: {
      web: DEFAULT_BACKEND_URL,
      mobile: DEFAULT_BACKEND_URL
    },
    selfHostedWebSocket: {
      web: DEFAULT_WS_URL,
      mobile: DEFAULT_WS_URL
    },
    // 🔄 FALLBACK - Firebase Functions (se necessário)
    firebaseFunctions: {
      web: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : '',
      mobile: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : ''
    },
    // 📊 Dashboard local
    dashboard: {
      web: DEFAULT_DASHBOARD_URL,
      mobile: DEFAULT_DASHBOARD_URL
    }
  },
  production: {
    // 🏠 SELF-HOSTED VPS - PRODUÇÃO
    selfHostedApi: {
      web: DEFAULT_BACKEND_URL,
      mobile: DEFAULT_BACKEND_URL
    },
    selfHostedWebSocket: {
      web: DEFAULT_WS_URL,
      mobile: DEFAULT_WS_URL
    },
    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: {
      web: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : '',
      mobile: FIREBASE_FALLBACK_ENABLED ? DEFAULT_FIREBASE_FUNCTIONS_BASE_URL : ''
    },
    // 📊 Dashboard
    dashboard: {
      web: DEFAULT_DASHBOARD_URL,
      mobile: DEFAULT_DASHBOARD_URL
    }
  }
};

// Determinar ambiente (pode ser expandido para usar variáveis de ambiente)
const getEnvironment = () => {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
};

// Obter configuração baseada na plataforma
const getConfig = () => {
  const env = getEnvironment();
  const platform = 'web'; // Para testes Node.js
  
  return {
    // 🏠 SELF-HOSTED VPS (PRINCIPAL)
    selfHostedApi: ENV[env].selfHostedApi[platform] || ENV[env].selfHostedApi.web,
    selfHostedWebSocket: ENV[env].selfHostedWebSocket[platform] || ENV[env].selfHostedWebSocket.web,
    
    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: ENV[env].firebaseFunctions[platform] || ENV[env].firebaseFunctions.web,
    
    // 📊 Dashboard
    dashboard: ENV[env].dashboard[platform] || ENV[env].dashboard.web,
    
    environment: env,
    platform
  };
};

// Configuração atual
const config = getConfig();

// URLs específicas para serviços
const API_URLS = {
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
    updateUserLocation: '__WS_ONLY__',
    updateDriverLocation: '__WS_ONLY__',
    getNearbyDrivers: '/api/drivers/nearby',
    getStats: '/api/app/stats',
    health: '/api/health',
    getRedisStats: '/api/queue/cache/stats'
  },
  
  // Endpoints específicos - FIREBASE (fallback)
  firebaseEndpoints: {
    updateUserLocation: '/update_user_location',
    getNearbyDrivers: '/get_nearby_drivers',
    startTripTracking: '/start_trip_tracking',
    updateTripLocation: '/update_trip_location',
    endTripTracking: '/end_trip_tracking',
    getTripData: '/get_trip_data',
    getRedisStats: '/get_redis_stats',
    firebaseSync: '/firebase_sync',
    health: '/health'
  }
};

// Configuração geral
const API_CONFIG = {
  ...config,
  timeout: 10000, // 10 segundos
  retryAttempts: 3,
  retryDelay: 1000, // 1 segundo
  
  // 🔄 Estratégia de fallback
  useSelfHosted: true, // Usar VPS como principal
  useFirebaseFallback: true, // Usar Firebase como fallback
  maxRetries: 3
};

// Função para obter URL completa - SELF-HOSTED
const getSelfHostedApiUrl = (endpoint) => {
  return `${normalizeBaseUrl(API_URLS.selfHostedApi)}${endpoint}`;
};

// Função para obter URL completa - FIREBASE (fallback)
const getFirebaseApiUrl = (endpoint) => {
  if (!API_URLS.firebaseFunctions) {
    throw new Error('Firebase Functions fallback is disabled for the current runtime.');
  }
  return `${API_URLS.firebaseFunctions}${endpoint}`;
};

// Função para obter URL do WebSocket - SELF-HOSTED
const getSelfHostedWebSocketUrl = () => {
  return API_URLS.selfHostedWebSocket;
};

// Função para obter URL do Dashboard
const getDashboardUrl = () => {
  return API_URLS.dashboard;
};

// 🔄 Função inteligente para escolher API
const getApiUrl = (endpoint, useFallback = false) => {
  const mapped = useFallback
    ? API_URLS.firebaseEndpoints[endpoint] || endpoint
    : API_URLS.selfHostedEndpoints[endpoint] || endpoint;

  if (mapped === '__WS_ONLY__') {
    throw new Error(`Endpoint "${endpoint}" é WebSocket-only e não possui fallback HTTP.`);
  }

  if (useFallback) {
    return getFirebaseApiUrl(mapped);
  }
  return getSelfHostedApiUrl(mapped);
};

// 🔄 Função inteligente para escolher WebSocket
const getWebSocketUrl = (useFallback = false) => {
  if (useFallback) {
    if (!API_URLS.firebaseFunctions) {
      throw new Error('Firebase Functions fallback is disabled for the current runtime.');
    }
    return API_URLS.firebaseFunctions; // Fallback para Firebase
  }
  return getSelfHostedWebSocketUrl();
};

module.exports = {
  API_URLS,
  API_CONFIG,
  getApiUrl,
  getSelfHostedApiUrl,
  getFirebaseApiUrl,
  getWebSocketUrl,
  getSelfHostedWebSocketUrl,
  getDashboardUrl
}; 

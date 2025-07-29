// ApiConfig.cjs - Configuração centralizada para URLs da API (versão Node.js)
// Compatível com testes CommonJS

// Configurações por ambiente
const ENV = {
  development: {
    // 🏠 SELF-HOSTED VPS (Vultr)
    selfHostedApi: {
      web: 'https://216.238.107.59.nip.io',
      mobile: 'https://216.238.107.59.nip.io'
    },
    selfHostedWebSocket: {
      web: 'wss://216.238.107.59.nip.io',
      mobile: 'wss://216.238.107.59.nip.io'
    },
    // 🔄 FALLBACK - Firebase Functions (se necessário)
    firebaseFunctions: {
      web: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net',
      mobile: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net'
    },
    // 📊 Dashboard local
    dashboard: {
      web: 'http://192.168.0.39:3000',
      mobile: 'http://192.168.0.37:3000'
    }
  },
  production: {
    // 🏠 SELF-HOSTED VPS (Vultr) - PRODUÇÃO
    selfHostedApi: {
      web: 'https://216.238.107.59.nip.io',
      mobile: 'https://216.238.107.59.nip.io'
    },
    selfHostedWebSocket: {
      web: 'wss://216.238.107.59.nip.io',
      mobile: 'wss://216.238.107.59.nip.io'
    },
    // 🔄 FALLBACK - Firebase Functions
    firebaseFunctions: {
      web: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net',
      mobile: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net'
    },
    // 📊 Dashboard
    dashboard: {
      web: 'https://dashboard.leafapp.com',
      mobile: 'https://dashboard.leafapp.com'
    }
  }
};

// Determinar ambiente (pode ser expandido para usar variáveis de ambiente)
const getEnvironment = () => {
  // Por enquanto, sempre development
  // TODO: Implementar lógica para detectar ambiente
  return 'development';
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
    updateUserLocation: '/api/update_user_location',
    updateDriverLocation: '/api/update_driver_location',
    getNearbyDrivers: '/api/nearby_drivers',
    getStats: '/api/stats',
    health: '/api/health'
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
  return `${API_URLS.selfHostedApi}${endpoint}`;
};

// Função para obter URL completa - FIREBASE (fallback)
const getFirebaseApiUrl = (endpoint) => {
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
  if (useFallback) {
    return getFirebaseApiUrl(API_URLS.firebaseEndpoints[endpoint] || endpoint);
  }
  return getSelfHostedApiUrl(API_URLS.selfHostedEndpoints[endpoint] || endpoint);
};

// 🔄 Função inteligente para escolher WebSocket
const getWebSocketUrl = (useFallback = false) => {
  if (useFallback) {
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
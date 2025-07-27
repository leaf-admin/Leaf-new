// ApiConfig.cjs - Configuração centralizada para URLs da API (versão Node.js)
// Compatível com testes CommonJS

// Configurações por ambiente
const ENV = {
  development: {
    webSocketBackend: {
      web: 'http://192.168.0.39:5001',
      mobile: 'http://192.168.0.37:5001'
    },
    firebaseFunctions: {
      web: 'http://192.168.0.39:5001/leaf-app-91dfdce0/us-central1',
      mobile: 'http://192.168.0.37:5001/leaf-app-91dfdce0/us-central1'
    },
    dashboard: {
      web: 'http://192.168.0.39:3000',
      mobile: 'http://192.168.0.37:3000'
    }
  },
  production: {
    webSocketBackend: {
      web: 'https://api.leafapp.com',
      mobile: 'https://api.leafapp.com'
    },
    firebaseFunctions: {
      web: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net',
      mobile: 'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net'
    },
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
    webSocketBackend: ENV[env].webSocketBackend[platform] || ENV[env].webSocketBackend.web,
    firebaseFunctions: ENV[env].firebaseFunctions[platform] || ENV[env].firebaseFunctions.web,
    dashboard: ENV[env].dashboard[platform] || ENV[env].dashboard.web,
    environment: env,
    platform
  };
};

// Configuração atual
const config = getConfig();

// URLs específicas para serviços
const API_URLS = {
  // Redis API via Firebase Functions
  redisApi: config.firebaseFunctions,
  
  // WebSocket Backend
  webSocketBackend: config.webSocketBackend,
  
  // Dashboard
  dashboard: config.dashboard,
  
  // Endpoints específicos
  endpoints: {
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
  retryDelay: 1000 // 1 segundo
};

// Função para obter URL completa
const getApiUrl = (endpoint) => {
  return `${API_URLS.redisApi}${endpoint}`;
};

// Função para obter URL do WebSocket
const getWebSocketUrl = () => {
  return API_URLS.webSocketBackend;
};

// Função para obter URL do Dashboard
const getDashboardUrl = () => {
  return API_URLS.dashboard;
};

module.exports = {
  API_URLS,
  API_CONFIG,
  getApiUrl,
  getWebSocketUrl,
  getDashboardUrl,
  config
}; 
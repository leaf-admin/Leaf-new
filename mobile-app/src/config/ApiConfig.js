// ApiConfig.js - Configuração centralizada para URLs da API
import { Platform } from 'react-native';

// Configurações por ambiente
const ENV = {
  development: {
    // 🏠 SELF-HOSTED VPS (Hostinger)
    selfHostedApi: {
      web: 'http://147.93.66.253:3000',
      mobile: 'http://147.93.66.253:3000'
    },
    selfHostedWebSocket: {
      web: 'ws://147.93.66.253:3001',
      mobile: 'ws://147.93.66.253:3001'
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
    // 🏠 SELF-HOSTED VPS (Hostinger) - PRODUÇÃO
    selfHostedApi: {
      web: 'http://147.93.66.253:3000',
      mobile: 'http://147.93.66.253:3000'
    },
    selfHostedWebSocket: {
      web: 'ws://147.93.66.253:3001',
      mobile: 'ws://147.93.66.253:3001'
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
  const platform = Platform.OS;
  
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
export const API_CONFIG = {
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
export const getSelfHostedApiUrl = (endpoint) => {
  return `${API_URLS.selfHostedApi}${endpoint}`;
};

// Função para obter URL completa - FIREBASE (fallback)
export const getFirebaseApiUrl = (endpoint) => {
  return `${API_URLS.firebaseFunctions}${endpoint}`;
};

// Função para obter URL do WebSocket - SELF-HOSTED
export const getSelfHostedWebSocketUrl = () => {
  return API_URLS.selfHostedWebSocket;
};

// Função para obter URL do Dashboard
export const getDashboardUrl = () => {
  return API_URLS.dashboard;
};

// 🔄 Função inteligente para escolher API
export const getApiUrl = (endpoint, useFallback = false) => {
  if (useFallback) {
    return getFirebaseApiUrl(API_URLS.firebaseEndpoints[endpoint] || endpoint);
  }
  return getSelfHostedApiUrl(API_URLS.selfHostedEndpoints[endpoint] || endpoint);
};

// 🔄 Função inteligente para escolher WebSocket
export const getWebSocketUrl = (useFallback = false) => {
  if (useFallback) {
    return API_URLS.firebaseFunctions; // Fallback para Firebase
  }
  return getSelfHostedWebSocketUrl();
};

export default {
  API_URLS,
  API_CONFIG,
  getApiUrl,
  getSelfHostedApiUrl,
  getFirebaseApiUrl,
  getWebSocketUrl,
  getSelfHostedWebSocketUrl,
  getDashboardUrl
}; 
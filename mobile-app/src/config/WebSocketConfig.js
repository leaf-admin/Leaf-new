import { Platform } from 'react-native';
import { getWebSocketUrl } from './ApiConfig';

// Configurações do WebSocket
const WEBSOCKET_CONFIG = {
  // URLs agora vêm da configuração centralizada
  LOCAL: {
    ANDROID_EMULATOR: 'ws://147.93.66.253:3001', // VPS como principal
    IOS_SIMULATOR: 'ws://147.93.66.253:3001', // VPS como principal
    DEVICE: getWebSocketUrl(), // Usa configuração centralizada (VPS)
  },
  
  // Para produção
  PRODUCTION: {
    URL: 'ws://147.93.66.253:3001', // VPS como principal
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
    ACCURACY: 'high', // 'high', 'balanced', 'low'
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
  if (__DEV__) {
    // Desenvolvimento - sempre usar VPS
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  } else {
    // Produção - usar VPS
    return WEBSOCKET_CONFIG.PRODUCTION.URL;
  }
};

// Obter configurações de conexão
const getConnectionOptions = () => {
  return {
    transports: ['websocket'],
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
    // Sempre retornar VPS como principal
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  } catch (error) {
    console.error('Erro ao obter IP local:', error);
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  }
};

// Validação de configuração
const validateConfig = () => {
  const errors = [];
  
  if (!WEBSOCKET_CONFIG.LOCAL.DEVICE) {
    errors.push('URL do WebSocket não configurada');
  }
  
  if (WEBSOCKET_CONFIG.CONNECTION.TIMEOUT < 5000) {
    errors.push('Timeout muito baixo para WebSocket');
  }
  
  if (WEBSOCKET_CONFIG.LOCATION.UPDATE_INTERVAL < 1000) {
    errors.push('Intervalo de atualização de localização muito baixo');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Configuração de debug
const DEBUG_CONFIG = {
  logConnectionEvents: __DEV__,
  logLocationUpdates: __DEV__,
  logDriverSearch: __DEV__,
  showNetworkErrors: __DEV__,
  enableMockData: false
};

// Configuração de monitoramento
const MONITORING_CONFIG = {
  enableHealthCheck: true,
  healthCheckInterval: 30000, // 30 segundos
  enableMetrics: true,
  metricsInterval: 60000, // 1 minuto
  enableAlerts: true
};

// Exportar configuração completa
export const getWebSocketConfig = () => {
  return {
    url: getWebSocketURL(),
    connection: getConnectionOptions(),
    location: getLocationConfig(),
    driverSearch: getDriverSearchConfig(),
    debug: DEBUG_CONFIG,
    monitoring: MONITORING_CONFIG,
    validation: validateConfig()
  };
};

// Exportar funções específicas
export const getWebSocketUrl = () => getWebSocketURL();

// Configuração padrão
export default getWebSocketConfig(); 
import { Platform } from 'react-native';

// Configurações do WebSocket
const WEBSOCKET_CONFIG = {
  // Para desenvolvimento local (emulador Android/iOS)
  LOCAL: {
    ANDROID_EMULATOR: 'http://10.0.2.2:3001', // Android Emulator
    IOS_SIMULATOR: 'http://localhost:3001', // iOS Simulator
    DEVICE: 'http://192.168.0.39:3001', // Dispositivo físico - IP configurado
  },
  
  // Para produção
  PRODUCTION: {
    URL: 'https://your-backend-domain.com',
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
    // Desenvolvimento
    if (Platform.OS === 'android') {
      // Verificar se está rodando no emulador ou dispositivo físico
      // Para dispositivo físico, você precisa alterar o IP abaixo
      return WEBSOCKET_CONFIG.LOCAL.ANDROID_EMULATOR;
    } else if (Platform.OS === 'ios') {
      return WEBSOCKET_CONFIG.LOCAL.IOS_SIMULATOR;
    }
    // Fallback para dispositivo físico
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  } else {
    // Produção
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
    // Esta função pode ser implementada para detectar automaticamente o IP
    // Por enquanto, retorna o IP configurado
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  } catch (error) {
    console.error('Erro ao obter IP local:', error);
    return WEBSOCKET_CONFIG.LOCAL.DEVICE;
  }
};

// Função para validar configurações
const validateConfig = () => {
  const url = getWebSocketURL();
  const issues = [];

  if (__DEV__) {
    if (url.includes('192.168.1.100')) {
      issues.push('⚠️ Altere o IP em WebSocketConfig.js para o IP da sua máquina');
    }
  }

  if (url.includes('your-backend-domain.com')) {
    issues.push('⚠️ Configure o domínio de produção em WebSocketConfig.js');
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

// Instruções para configurar o IP:
/*
1. No Windows, abra o CMD e digite: ipconfig
2. Procure por "IPv4 Address" na sua rede Wi-Fi
3. Copie o IP (exemplo: 192.168.1.100)
4. Substitua no arquivo acima na linha: url: 'http://SEU_IP:3001'

Exemplo:
- Seu IP é 192.168.1.50
- Mude para: url: 'http://192.168.1.50:3001'

IMPORTANTE:
- Use o IP da sua máquina, não localhost
- O app no dispositivo físico não consegue acessar localhost do PC
- Certifique-se que o backend está rodando na porta 3001
*/ 
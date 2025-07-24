import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import WebSocketConfig from '../config/WebSocketConfig';

class WebSocketService {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.isAuthenticated = false;
    this.userId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000; // 1 segundo
    
    // Callbacks para eventos
    this.eventCallbacks = {
      onConnect: null,
      onDisconnect: null,
      onAuthenticated: null,
      onLocationUpdated: null,
      onNearbyDrivers: null,
      onDriverStatusUpdated: null,
      onError: null,
    };
  }

  // Conectar ao WebSocket
  connect(userId = null) {
    if (this.socket && this.isConnected) {
      console.log('WebSocket já está conectado');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        const url = WebSocketConfig.getWebSocketURL();
        const connectionOptions = WebSocketConfig.getConnectionOptions();
        console.log('Conectando ao WebSocket:', url);

        this.socket = io(url, connectionOptions);

        this.setupEventListeners();
        this.userId = userId;

        // Timeout para conexão
        const connectionTimeout = setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Timeout ao conectar WebSocket'));
          }
        }, 10000);

        this.socket.on('connect', () => {
          clearTimeout(connectionTimeout);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          console.log('✅ WebSocket conectado');
          
          if (this.eventCallbacks.onConnect) {
            this.eventCallbacks.onConnect();
          }

          // Autenticar automaticamente se userId foi fornecido
          if (this.userId) {
            this.authenticate(this.userId);
          }

          resolve();
        });

        this.socket.on('connect_error', (error) => {
          clearTimeout(connectionTimeout);
          console.error('❌ Erro ao conectar WebSocket:', error);
          reject(error);
        });

      } catch (error) {
        console.error('❌ Erro ao criar conexão WebSocket:', error);
        reject(error);
      }
    });
  }

  // Configurar listeners de eventos
  setupEventListeners() {
    if (!this.socket) return;

    this.socket.on('disconnect', (reason) => {
      this.isConnected = false;
      this.isAuthenticated = false;
      console.log('🔌 WebSocket desconectado:', reason);
      
      if (this.eventCallbacks.onDisconnect) {
        this.eventCallbacks.onDisconnect(reason);
      }
    });

    this.socket.on('authenticated', (data) => {
      this.isAuthenticated = true;
      console.log('🔐 Autenticado:', data);
      
      if (this.eventCallbacks.onAuthenticated) {
        this.eventCallbacks.onAuthenticated(data);
      }
    });

    this.socket.on('locationUpdated', (data) => {
      console.log('📍 Localização atualizada:', data);
      
      if (this.eventCallbacks.onLocationUpdated) {
        this.eventCallbacks.onLocationUpdated(data);
      }
    });

    this.socket.on('nearbyDrivers', (data) => {
      console.log('🚗 Motoristas próximos:', data);
      
      if (this.eventCallbacks.onNearbyDrivers) {
        this.eventCallbacks.onNearbyDrivers(data);
      }
    });

    this.socket.on('driverStatusUpdated', (data) => {
      console.log('🔄 Status do motorista atualizado:', data);
      
      if (this.eventCallbacks.onDriverStatusUpdated) {
        this.eventCallbacks.onDriverStatusUpdated(data);
      }
    });

    this.socket.on('error', (error) => {
      console.error('❌ Erro WebSocket:', error);
      
      if (this.eventCallbacks.onError) {
        this.eventCallbacks.onError(error);
      }
    });
  }

  // Autenticar usuário
  authenticate(userId) {
    if (!this.socket || !this.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    this.userId = userId;
    console.log('🔐 Autenticando usuário:', userId);
    
    this.socket.emit('authenticate', { uid: userId });
    return true;
  }

  // Atualizar localização
  updateLocation(latitude, longitude, platform = 'mobile') {
    if (!this.socket || !this.isConnected || !this.isAuthenticated) {
      console.error('WebSocket não está pronto para enviar localização');
      return false;
    }

    const locationData = {
      uid: this.userId,
      lat: latitude,
      lng: longitude,
      timestamp: Date.now(),
      platform: platform,
    };

    console.log('📍 Enviando localização:', locationData);
    this.socket.emit('updateLocation', locationData);
    return true;
  }

  // Buscar motoristas próximos
  findNearbyDrivers(latitude, longitude, radius = 5000, limit = 10) {
    if (!this.socket || !this.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    const searchData = {
      lat: latitude,
      lng: longitude,
      radius: radius,
      limit: limit,
    };

    console.log('🔍 Buscando motoristas próximos:', searchData);
    this.socket.emit('findNearbyDrivers', searchData);
    return true;
  }

  // Atualizar status do motorista
  updateDriverStatus(status, isOnline = true) {
    if (!this.socket || !this.isConnected || !this.isAuthenticated) {
      console.error('WebSocket não está pronto para atualizar status');
      return false;
    }

    const statusData = {
      uid: this.userId,
      status: status,
      isOnline: isOnline,
      timestamp: Date.now(),
    };

    console.log('🔄 Atualizando status do motorista:', statusData);
    this.socket.emit('updateDriverStatus', statusData);
    return true;
  }

  // Obter estatísticas
  getStats() {
    if (!this.socket || !this.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    console.log('📊 Solicitando estatísticas');
    this.socket.emit('getStats');
    return true;
  }

  // Ping para testar conexão
  ping(data = {}) {
    if (!this.socket || !this.isConnected) {
      console.error('WebSocket não está conectado');
      return false;
    }

    console.log('🏓 Enviando ping');
    this.socket.emit('ping', data);
    return true;
  }

  // Desconectar
  disconnect() {
    if (this.socket) {
      console.log('🔌 Desconectando WebSocket');
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.isAuthenticated = false;
      this.userId = null;
    }
  }

  // Verificar se está conectado
  isSocketConnected() {
    return this.isConnected && this.socket;
  }

  // Verificar se está autenticado
  isUserAuthenticated() {
    return this.isAuthenticated;
  }

  // Obter ID do usuário
  getUserId() {
    return this.userId;
  }

  // Configurar callbacks de eventos
  onConnect(callback) {
    this.eventCallbacks.onConnect = callback;
  }

  onDisconnect(callback) {
    this.eventCallbacks.onDisconnect = callback;
  }

  onAuthenticated(callback) {
    this.eventCallbacks.onAuthenticated = callback;
  }

  onLocationUpdated(callback) {
    this.eventCallbacks.onLocationUpdated = callback;
  }

  onNearbyDrivers(callback) {
    this.eventCallbacks.onNearbyDrivers = callback;
  }

  onDriverStatusUpdated(callback) {
    this.eventCallbacks.onDriverStatusUpdated = callback;
  }

  onError(callback) {
    this.eventCallbacks.onError = callback;
  }

  // Obter informações de debug
  getDebugInfo() {
    return {
      isConnected: this.isConnected,
      isAuthenticated: this.isAuthenticated,
      userId: this.userId,
      socketId: this.socket?.id,
      url: WebSocketConfig.getWebSocketURL(),
      platform: Platform.OS,
      isDev: __DEV__,
    };
  }
}

// Instância singleton
const webSocketService = new WebSocketService();

export default webSocketService; 
import Logger from '../utils/Logger';
import { io } from 'socket.io-client';
import { Platform } from 'react-native';
import { getWebSocketUrl, getWebSocketConfig } from '../config/WebSocketConfig';


// Configuração da URL do WebSocket
const SOCKET_URL = getWebSocketUrl();
const CONFIG = getWebSocketConfig();

class SocketService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = CONFIG.reconnectionAttempts;
        this.reconnectDelay = CONFIG.reconnectionDelay;
        this.eventListeners = new Map();
    }

    // Conectar ao WebSocket
    connect() {
        if (this.socket && this.isConnected) {
            Logger.log('🔌 Já conectado ao WebSocket');
            return;
        }

        try {
            Logger.log('🔌 Conectando ao WebSocket:', SOCKET_URL);
            
            this.socket = io(SOCKET_URL, {
                transports: ['websocket', 'polling'],
                timeout: CONFIG.timeout,
                forceNew: true,
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: this.reconnectDelay,
                // Configurações específicas para React Native
                ...(Platform.OS === 'android' && {
                    extraHeaders: {
                        'User-Agent': 'ReactNative'
                    }
                })
            });

            this.setupEventListeners();
            
        } catch (error) {
            Logger.error('❌ Erro ao conectar WebSocket:', error);
        }
    }

    // Configurar listeners de eventos
    setupEventListeners() {
        if (!this.socket) return;

        // Conexão estabelecida
        this.socket.on('connect', () => {
            Logger.log('✅ Conectado ao WebSocket:', this.socket.id);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // Emitir evento de autenticação se necessário
            this.emit('authenticate', { platform: Platform.OS });
        });

        // Desconexão
        this.socket.on('disconnect', (reason) => {
            Logger.log('🔌 Desconectado do WebSocket:', reason);
            this.isConnected = false;
        });

        // Erro de conexão
        this.socket.on('connect_error', (error) => {
            Logger.error('❌ Erro de conexão WebSocket:', error.message);
            this.isConnected = false;
            this.reconnectAttempts++;
            
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                Logger.error('❌ Máximo de tentativas de reconexão atingido');
            }
        });

        // Reconexão
        this.socket.on('reconnect', (attemptNumber) => {
            Logger.log('🔄 Reconectado ao WebSocket após', attemptNumber, 'tentativas');
            this.isConnected = true;
            this.reconnectAttempts = 0;
        });

        // Reconexão falhou
        this.socket.on('reconnect_failed', () => {
            Logger.error('❌ Falha na reconexão WebSocket');
        });

        // Eventos de negócio
        this.socket.on('locationUpdated', (data) => {
            Logger.log('📍 Localização atualizada:', data);
            this.triggerEventListeners('locationUpdated', data);
        });

        this.socket.on('nearbyDrivers', (data) => {
            Logger.log('🚗 Motoristas próximos recebidos:', data);
            this.triggerEventListeners('nearbyDrivers', data);
        });

        this.socket.on('driverStatusUpdated', (data) => {
            Logger.log('🔄 Status do motorista atualizado:', data);
            this.triggerEventListeners('driverStatusUpdated', data);
        });

        this.socket.on('error', (error) => {
            Logger.error('❌ Erro do servidor:', error);
            this.triggerEventListeners('error', error);
        });
    }

    // Desconectar
    disconnect() {
        if (this.socket) {
            Logger.log('🔌 Desconectando do WebSocket');
            this.socket.disconnect();
            this.socket = null;
            this.isConnected = false;
            this.eventListeners.clear();
        }
    }

    // Enviar evento
    emit(event, data) {
        if (this.socket && this.isConnected) {
            Logger.log('📤 Enviando evento:', event, data);
            this.socket.emit(event, data);
        } else {
            Logger.warn('⚠️ WebSocket não conectado. Tentando conectar...');
            this.connect();
            // Aguardar um pouco e tentar novamente
            setTimeout(() => {
                if (this.socket && this.isConnected) {
                    this.socket.emit(event, data);
                } else {
                    Logger.error('❌ Falha ao enviar evento:', event);
                }
            }, 1000);
        }
    }

    // Escutar evento
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    // Remover listener
    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    // Trigger listeners internos
    triggerEventListeners(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    Logger.error('❌ Erro no callback do evento', event, ':', error);
                }
            });
        }
    }

    // Verificar se está conectado
    isConnected() {
        return this.isConnected;
    }

    // Obter ID da conexão
    getSocketId() {
        return this.socket ? this.socket.id : null;
    }

    // Métodos específicos para localização
    updateLocation(lat, lng, uid) {
        this.emit('updateLocation', {
            uid,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            timestamp: Date.now(),
            platform: Platform.OS
        });
    }

    // Buscar motoristas próximos
    findNearbyDrivers(lat, lng, radius = 5000, limit = 10) {
        this.emit('findNearbyDrivers', {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            radius: parseInt(radius),
            limit: parseInt(limit)
        });
    }

    // Atualizar status do motorista
    updateDriverStatus(status, isOnline, uid) {
        this.emit('updateDriverStatus', {
            uid,
            status,
            isOnline,
            timestamp: Date.now()
        });
    }

    // Obter estatísticas
    getStats() {
        this.emit('getStats', {});
    }

    // Ping para verificar conexão
    ping() {
        this.emit('ping', { timestamp: Date.now() });
    }
}

// Instância singleton
const socketService = new SocketService();

export default socketService; 
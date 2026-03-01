import Logger from '../utils/Logger';
/**
 * 🔄 SISTEMA DE FALLBACK ROBUSTO
 * WebSocket → REST API com detecção automática de falhas
 */

import { Platform } from 'react-native';
import WebSocketManager from './WebSocketManager';
import { API_CONFIG } from '../config/ApiConfig';


class RobustFallbackService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.apiConfig = API_CONFIG;
        
        // Estados de conectividade
        this.connectionStates = {
            websocket: {
                isConnected: false,
                lastPing: null,
                consecutiveFailures: 0,
                isHealthy: true
            },
            restApi: {
                isConnected: false,
                lastPing: null,
                consecutiveFailures: 0,
                isHealthy: true
            }
        };
        
        // Configurações de fallback
        this.fallbackConfig = {
            maxConsecutiveFailures: 3,
            pingInterval: 30000, // 30 segundos
            healthCheckTimeout: 5000, // 5 segundos
            retryDelay: 2000, // 2 segundos
            autoReconnect: true,
            preferWebSocket: true
        };
        
        // Métricas
        this.metrics = {
            websocketRequests: 0,
            restApiRequests: 0,
            fallbackSwitches: 0,
            totalFailures: 0,
            lastSwitchTime: null
        };
        
        // Cache de requisições para retry
        this.pendingRequests = new Map();
        
        this.isInitialized = false;
    }

    /**
     * Inicializar o sistema de fallback
     */
    async initialize() {
        try {
            Logger.log('🔄 Inicializando sistema de fallback robusto...');
            
            // 1. Configurar WebSocket
            await this.setupWebSocket();
            
            // 2. Configurar REST API
            await this.setupRestApi();
            
            // 3. Iniciar monitoramento de saúde
            this.startHealthMonitoring();
            
            // 4. Configurar listeners de eventos
            this.setupEventListeners();
            
            this.isInitialized = true;
            Logger.log('✅ Sistema de fallback robusto inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar sistema de fallback:', error);
            throw error;
        }
    }

    /**
     * Configurar WebSocket
     */
    async setupWebSocket() {
        try {
            // Conectar WebSocket
            if (!this.wsManager.isConnected()) {
                await this.wsManager.connect();
            }
            
            this.connectionStates.websocket.isConnected = true;
            this.connectionStates.websocket.lastPing = Date.now();
            this.connectionStates.websocket.consecutiveFailures = 0;
            this.connectionStates.websocket.isHealthy = true;
            
            Logger.log('✅ WebSocket configurado para fallback');
            
        } catch (error) {
            Logger.warn('⚠️ WebSocket não disponível:', error.message);
            this.connectionStates.websocket.isConnected = false;
            this.connectionStates.websocket.isHealthy = false;
        }
    }

    /**
     * Configurar REST API
     */
    async setupRestApi() {
        try {
            // Testar conectividade REST API
            const healthCheck = await this.performHealthCheck('rest');
            
            if (healthCheck.success) {
                this.connectionStates.restApi.isConnected = true;
                this.connectionStates.restApi.lastPing = Date.now();
                this.connectionStates.restApi.consecutiveFailures = 0;
                this.connectionStates.restApi.isHealthy = true;
                Logger.log('✅ REST API configurada para fallback');
            } else {
                throw new Error('REST API health check failed');
            }
            
        } catch (error) {
            Logger.warn('⚠️ REST API não disponível:', error.message);
            this.connectionStates.restApi.isConnected = false;
            this.connectionStates.restApi.isHealthy = false;
        }
    }

    /**
     * Iniciar monitoramento de saúde
     */
    startHealthMonitoring() {
        setInterval(async () => {
            await this.performHealthChecks();
        }, this.fallbackConfig.pingInterval);
        
        Logger.log('🔄 Monitoramento de saúde iniciado');
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        // WebSocket listeners
        this.wsManager.on('connect', () => {
            this.connectionStates.websocket.isConnected = true;
            this.connectionStates.websocket.isHealthy = true;
            this.connectionStates.websocket.consecutiveFailures = 0;
            Logger.log('🔄 WebSocket reconectado - fallback atualizado');
        });
        
        this.wsManager.on('disconnect', () => {
            this.connectionStates.websocket.isConnected = false;
            this.connectionStates.websocket.isHealthy = false;
            Logger.log('🔄 WebSocket desconectado - usando REST API');
        });
        
        this.wsManager.on('connect_error', (error) => {
            this.connectionStates.websocket.isConnected = false;
            this.connectionStates.websocket.isHealthy = false;
            this.connectionStates.websocket.consecutiveFailures++;
            Logger.log('🔄 WebSocket erro - incrementando falhas:', this.connectionStates.websocket.consecutiveFailures);
        });
    }

    /**
     * Executar verificações de saúde
     */
    async performHealthChecks() {
        try {
            // Verificar WebSocket
            if (this.connectionStates.websocket.isConnected) {
                await this.performHealthCheck('websocket');
            }
            
            // Verificar REST API
            await this.performHealthCheck('rest');
            
        } catch (error) {
            Logger.error('❌ Erro nas verificações de saúde:', error);
        }
    }

    /**
     * Executar verificação de saúde específica
     */
    async performHealthCheck(type) {
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), this.fallbackConfig.healthCheckTimeout)
        );
        
        try {
            let healthPromise;
            
            if (type === 'websocket') {
                healthPromise = this.wsManager.ping();
            } else if (type === 'rest') {
                healthPromise = this.restApiHealthCheck();
            }
            
            const result = await Promise.race([healthPromise, timeout]);
            
            // Atualizar estado
            this.connectionStates[type].lastPing = Date.now();
            this.connectionStates[type].consecutiveFailures = 0;
            this.connectionStates[type].isHealthy = true;
            
            return { success: true, type, result };
            
        } catch (error) {
            // Incrementar falhas
            this.connectionStates[type].consecutiveFailures++;
            this.connectionStates[type].isHealthy = false;
            this.metrics.totalFailures++;
            
            Logger.warn(`⚠️ Health check falhou para ${type}:`, error.message);
            
            return { success: false, type, error: error.message };
        }
    }

    /**
     * Verificação de saúde da REST API
     */
    async restApiHealthCheck() {
        const response = await fetch(`${this.apiConfig.selfHostedApi}/api/health`, {
            method: 'GET',
            timeout: this.fallbackConfig.healthCheckTimeout
        });
        
        if (!response.ok) {
            throw new Error(`REST API health check failed: ${response.status}`);
        }
        
        return await response.json();
    }

    /**
     * Executar operação com fallback automático
     */
    async executeWithFallback(operation, fallbackOperation, options = {}) {
        const {
            preferWebSocket = this.fallbackConfig.preferWebSocket,
            maxRetries = 3,
            retryDelay = this.fallbackConfig.retryDelay
        } = options;
        
        let lastError = null;
        
        // Tentar operação principal primeiro
        if (preferWebSocket && this.isWebSocketHealthy()) {
            try {
                Logger.log('🔄 Tentando operação via WebSocket...');
                const result = await operation();
                this.metrics.websocketRequests++;
                return result;
            } catch (error) {
                lastError = error;
                Logger.warn('⚠️ WebSocket falhou, tentando REST API:', error.message);
                this.handleConnectionFailure('websocket');
            }
        }
        
        // Tentar fallback (REST API)
        if (this.isRestApiHealthy()) {
            try {
                Logger.log('🔄 Executando operação via REST API...');
                const result = await fallbackOperation();
                this.metrics.restApiRequests++;
                this.metrics.fallbackSwitches++;
                this.metrics.lastSwitchTime = Date.now();
                return result;
            } catch (error) {
                lastError = error;
                Logger.warn('⚠️ REST API também falhou:', error.message);
                this.handleConnectionFailure('rest');
            }
        }
        
        // Se ambos falharam, tentar retry
        if (maxRetries > 0) {
            Logger.log(`🔄 Tentando novamente em ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            
            return this.executeWithFallback(operation, fallbackOperation, {
                ...options,
                maxRetries: maxRetries - 1
            });
        }
        
        // Falha total
        throw new Error(`Falha total: WebSocket e REST API indisponíveis. Último erro: ${lastError?.message}`);
    }

    /**
     * Verificar se WebSocket está saudável
     */
    isWebSocketHealthy() {
        const state = this.connectionStates.websocket;
        return state.isConnected && 
               state.isHealthy && 
               state.consecutiveFailures < this.fallbackConfig.maxConsecutiveFailures;
    }

    /**
     * Verificar se REST API está saudável
     */
    isRestApiHealthy() {
        const state = this.connectionStates.restApi;
        return state.isConnected && 
               state.isHealthy && 
               state.consecutiveFailures < this.fallbackConfig.maxConsecutiveFailures;
    }

    /**
     * Tratar falha de conexão
     */
    handleConnectionFailure(type) {
        const state = this.connectionStates[type];
        state.consecutiveFailures++;
        state.isHealthy = false;
        
        Logger.log(`🔄 Falha de conexão ${type}: ${state.consecutiveFailures}/${this.fallbackConfig.maxConsecutiveFailures}`);
        
        // Se atingiu limite de falhas, marcar como não saudável
        if (state.consecutiveFailures >= this.fallbackConfig.maxConsecutiveFailures) {
            Logger.warn(`⚠️ ${type} marcado como não saudável após ${state.consecutiveFailures} falhas`);
        }
    }

    /**
     * Executar operação de corrida com fallback
     */
    async executeRideOperation(operation, data) {
        const wsOperation = () => this.wsManager[operation](data);
        const restOperation = () => this.executeRestApiCall(operation, data);
        
        return this.executeWithFallback(wsOperation, restOperation);
    }

    /**
     * Executar chamada REST API
     */
    async executeRestApiCall(operation, data) {
        const endpoint = this.getRestApiEndpoint(operation);
        const url = `${this.apiConfig.selfHostedApi}${endpoint}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
            timeout: this.apiConfig.timeout
        });
        
        if (!response.ok) {
            throw new Error(`REST API call failed: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
    }

    /**
     * Mapear operação WebSocket para endpoint REST
     */
    getRestApiEndpoint(operation) {
        const endpointMap = {
            'createBooking': '/api/bookings',
            'confirmPayment': '/api/payments/confirm',
            'searchDrivers': '/api/drivers/search',
            'updateDriverLocation': '/api/drivers/location',
            'setDriverStatus': '/api/drivers/status',
            'submitRating': '/api/ratings',
            'sendMessage': '/api/messages',
            'createSupportTicket': '/api/support/tickets',
            'reportIncident': '/api/incidents',
            'emergencyContact': '/api/emergency',
            'updateNotificationPreferences': '/api/notifications/preferences',
            'trackUserAction': '/api/analytics/track',
            'submitFeedback': '/api/feedback',
            'createChat': '/api/chat',
            'cancelRide': '/api/rides/cancel',
            'cancelDriverSearch': '/api/drivers/search/cancel'
        };
        
        return endpointMap[operation] || '/api/fallback';
    }

    /**
     * Obter métricas do sistema
     */
    getMetrics() {
        return {
            ...this.metrics,
            connectionStates: this.connectionStates,
            isWebSocketHealthy: this.isWebSocketHealthy(),
            isRestApiHealthy: this.isRestApiHealthy(),
            preferredMethod: this.isWebSocketHealthy() ? 'websocket' : 'rest'
        };
    }

    /**
     * Resetar métricas
     */
    resetMetrics() {
        this.metrics = {
            websocketRequests: 0,
            restApiRequests: 0,
            fallbackSwitches: 0,
            totalFailures: 0,
            lastSwitchTime: null
        };
        
        Logger.log('🔄 Métricas resetadas');
    }

    /**
     * Forçar uso de método específico
     */
    forceMethod(method) {
        if (method === 'websocket') {
            this.fallbackConfig.preferWebSocket = true;
        } else if (method === 'rest') {
            this.fallbackConfig.preferWebSocket = false;
        }
        
        Logger.log(`🔄 Método forçado para: ${method}`);
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            // Parar monitoramento
            if (this.healthMonitoringInterval) {
                clearInterval(this.healthMonitoringInterval);
            }
            
            // Limpar requisições pendentes
            this.pendingRequests.clear();
            
            this.isInitialized = false;
            Logger.log('✅ Sistema de fallback limpo');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar sistema de fallback:', error);
        }
    }
}

// Singleton
const robustFallbackService = new RobustFallbackService();
export default robustFallbackService;







import Logger from '../utils/Logger';
/**
 * 🧠 SISTEMA DE FALLBACK INTELIGENTE
 * Estratégia híbrida: Fallback para críticas, Retry para tempo real
 */

import { Platform } from 'react-native';
import WebSocketManager from './WebSocketManager';
import { API_CONFIG } from '../config/ApiConfig';


class IntelligentFallbackService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.apiConfig = API_CONFIG;
        
        // Classificação inteligente de operações
        this.operationTypes = {
            // 🚨 CRÍTICAS - Fallback WebSocket → REST API
            CRITICAL: [
                'createBooking',           // Corrida = dinheiro
                'confirmPayment',          // Pagamento = crítico
                'emergencyContact',        // Segurança = vida
                'reportIncident',          // Segurança = vida
                'cancelRide',              // Cancelamento = dinheiro
                'submitRating'             // Avaliação = reputação
            ],
            
            // ⚡ TEMPO REAL - Retry WebSocket apenas
            REAL_TIME: [
                'updateDriverLocation',    // Localização em tempo real
                'sendMessage',             // Chat em tempo real
                'typingStatus',            // Status em tempo real
                'setDriverStatus',         // Status em tempo real
                'searchDrivers'            // Busca em tempo real
            ],
            
            // 📊 NÃO-CRÍTICAS - Retry WebSocket apenas
            NON_CRITICAL: [
                'trackUserAction',         // Analytics
                'submitFeedback',          // Feedback
                'updateNotificationPreferences', // Preferências
                'createSupportTicket',     // Suporte
                'createChat',              // Chat
                'registerFCMToken',        // Notificações
                'unregisterFCMToken',      // Notificações
                'sendNotification'         // Notificações
            ]
        };
        
        // Configurações de retry
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000, // 1 segundo
            maxDelay: 10000, // 10 segundos
            backoffMultiplier: 2
        };
        
        // Configurações de fallback
        this.fallbackConfig = {
            timeout: 5000, // 5 segundos
            maxConsecutiveFailures: 3
        };
        
        // Estados de conectividade
        this.connectionStates = {
            websocket: {
                isHealthy: true,
                consecutiveFailures: 0,
                lastFailure: null
            },
            restApi: {
                isHealthy: true,
                consecutiveFailures: 0,
                lastFailure: null
            }
        };
        
        // Métricas
        this.metrics = {
            criticalOperations: { success: 0, fallback: 0, failed: 0 },
            realTimeOperations: { success: 0, retry: 0, failed: 0 },
            nonCriticalOperations: { success: 0, retry: 0, failed: 0 },
            totalOperations: 0,
            fallbackSwitches: 0
        };
        
        this.isInitialized = false;
    }

    /**
     * Inicializar o sistema inteligente
     */
    async initialize() {
        try {
            Logger.log('🧠 Inicializando sistema de fallback inteligente...');
            
            // Verificar conectividade inicial
            await this.checkInitialConnectivity();
            
            // Configurar listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            Logger.log('✅ Sistema de fallback inteligente inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar sistema inteligente:', error);
            throw error;
        }
    }

    /**
     * Verificar conectividade inicial
     */
    async checkInitialConnectivity() {
        try {
            // Verificar WebSocket
            if (this.wsManager.isConnected()) {
                this.connectionStates.websocket.isHealthy = true;
                Logger.log('✅ WebSocket conectado');
            } else {
                Logger.warn('⚠️ WebSocket desconectado');
            }
            
            // Verificar REST API
            try {
                const response = await fetch(`${this.apiConfig.selfHostedApi}/api/health`, {
                    method: 'GET',
                    timeout: 3000
                });
                
                if (response.ok) {
                    this.connectionStates.restApi.isHealthy = true;
                    Logger.log('✅ REST API conectada');
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                Logger.warn('⚠️ REST API indisponível:', error.message);
                this.connectionStates.restApi.isHealthy = false;
            }
            
        } catch (error) {
            Logger.error('❌ Erro na verificação de conectividade:', error);
        }
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        // WebSocket listeners
        this.wsManager.on('connect', () => {
            this.connectionStates.websocket.isHealthy = true;
            this.connectionStates.websocket.consecutiveFailures = 0;
            Logger.log('🔄 WebSocket reconectado');
        });
        
        this.wsManager.on('disconnect', () => {
            this.connectionStates.websocket.isHealthy = false;
            this.connectionStates.websocket.consecutiveFailures++;
            Logger.log('🔄 WebSocket desconectado');
        });
        
        this.wsManager.on('connect_error', (error) => {
            this.connectionStates.websocket.isHealthy = false;
            this.connectionStates.websocket.consecutiveFailures++;
            this.connectionStates.websocket.lastFailure = Date.now();
            Logger.log('🔄 WebSocket erro:', error.message);
        });
    }

    /**
     * Executar operação com estratégia inteligente
     */
    async executeOperation(operation, data, options = {}) {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        const operationType = this.getOperationType(operation);
        this.metrics.totalOperations++;
        
        Logger.log(`🧠 Executando ${operation} (${operationType})...`);
        
        try {
            let result;
            
            switch (operationType) {
                case 'CRITICAL':
                    result = await this.executeCriticalOperation(operation, data, options);
                    break;
                case 'REAL_TIME':
                    result = await this.executeRealTimeOperation(operation, data, options);
                    break;
                case 'NON_CRITICAL':
                    result = await this.executeNonCriticalOperation(operation, data, options);
                    break;
                default:
                    throw new Error(`Tipo de operação desconhecido: ${operationType}`);
            }
            
            return result;
            
        } catch (error) {
            Logger.error(`❌ Falha na operação ${operation}:`, error.message);
            throw error;
        }
    }

    /**
     * Executar operação crítica com fallback
     */
    async executeCriticalOperation(operation, data, options) {
        Logger.log(`🚨 Operação CRÍTICA: ${operation}`);
        
        try {
            // Tentar WebSocket primeiro
            if (this.connectionStates.websocket.isHealthy) {
                const result = await this.wsManager[operation](data);
                this.metrics.criticalOperations.success++;
                Logger.log(`✅ ${operation} executada via WebSocket`);
                return result;
            }
            
            // Fallback para REST API
            Logger.log(`🔄 Fallback para REST API: ${operation}`);
            const result = await this.executeRestApiCall(operation, data);
            this.metrics.criticalOperations.fallback++;
            this.metrics.fallbackSwitches++;
            Logger.log(`✅ ${operation} executada via REST API`);
            return result;
            
        } catch (error) {
            this.metrics.criticalOperations.failed++;
            Logger.error(`❌ Falha crítica em ${operation}:`, error.message);
            throw error;
        }
    }

    /**
     * Executar operação de tempo real com retry
     */
    async executeRealTimeOperation(operation, data, options) {
        Logger.log(`⚡ Operação TEMPO REAL: ${operation}`);
        
        let lastError = null;
        
        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                if (!this.wsManager.isConnected()) {
                    throw new Error('WebSocket não conectado');
                }
                
                const result = await this.wsManager[operation](data);
                this.metrics.realTimeOperations.success++;
                Logger.log(`✅ ${operation} executada via WebSocket (tentativa ${attempt + 1})`);
                return result;
                
            } catch (error) {
                lastError = error;
                this.metrics.realTimeOperations.retry++;
                
                if (attempt < this.retryConfig.maxRetries) {
                    const delay = this.calculateRetryDelay(attempt);
                    Logger.log(`🔄 Retry ${operation} em ${delay}ms (tentativa ${attempt + 1}/${this.retryConfig.maxRetries})`);
                    await this.sleep(delay);
                }
            }
        }
        
        this.metrics.realTimeOperations.failed++;
        Logger.error(`❌ Falha em tempo real ${operation} após ${this.retryConfig.maxRetries + 1} tentativas`);
        throw lastError;
    }

    /**
     * Executar operação não-crítica com retry
     */
    async executeNonCriticalOperation(operation, data, options) {
        Logger.log(`📊 Operação NÃO-CRÍTICA: ${operation}`);
        
        let lastError = null;
        
        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                if (!this.wsManager.isConnected()) {
                    throw new Error('WebSocket não conectado');
                }
                
                const result = await this.wsManager[operation](data);
                this.metrics.nonCriticalOperations.success++;
                Logger.log(`✅ ${operation} executada via WebSocket (tentativa ${attempt + 1})`);
                return result;
                
            } catch (error) {
                lastError = error;
                this.metrics.nonCriticalOperations.retry++;
                
                if (attempt < this.retryConfig.maxRetries) {
                    const delay = this.calculateRetryDelay(attempt);
                    Logger.log(`🔄 Retry ${operation} em ${delay}ms (tentativa ${attempt + 1}/${this.retryConfig.maxRetries})`);
                    await this.sleep(delay);
                }
            }
        }
        
        this.metrics.nonCriticalOperations.failed++;
        Logger.warn(`⚠️ Falha não-crítica ${operation} após ${this.retryConfig.maxRetries + 1} tentativas`);
        throw lastError;
    }

    /**
     * Determinar tipo de operação
     */
    getOperationType(operation) {
        if (this.operationTypes.CRITICAL.includes(operation)) {
            return 'CRITICAL';
        } else if (this.operationTypes.REAL_TIME.includes(operation)) {
            return 'REAL_TIME';
        } else if (this.operationTypes.NON_CRITICAL.includes(operation)) {
            return 'NON_CRITICAL';
        } else {
            Logger.warn(`⚠️ Operação desconhecida: ${operation}, tratando como não-crítica`);
            return 'NON_CRITICAL';
        }
    }

    /**
     * Calcular delay de retry com backoff exponencial
     */
    calculateRetryDelay(attempt) {
        const delay = this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt);
        return Math.min(delay, this.retryConfig.maxDelay);
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
                'User-Agent': `LeafApp/${Platform.OS}`,
                'X-Platform': Platform.OS
            },
            body: JSON.stringify(data),
            timeout: this.fallbackConfig.timeout
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
            'cancelRide': '/api/rides/cancel',
            'submitRating': '/api/ratings',
            'emergencyContact': '/api/emergency',
            'reportIncident': '/api/incidents',
            'updateDriverLocation': '/api/drivers/location',
            'setDriverStatus': '/api/drivers/status',
            'searchDrivers': '/api/drivers/search',
            'sendMessage': '/api/messages',
            'createChat': '/api/chat',
            'createSupportTicket': '/api/support/tickets',
            'updateNotificationPreferences': '/api/notifications/preferences',
            'trackUserAction': '/api/analytics/track',
            'submitFeedback': '/api/feedback',
            'registerFCMToken': '/api/notifications/fcm/register',
            'unregisterFCMToken': '/api/notifications/fcm/unregister',
            'sendNotification': '/api/notifications/send'
        };
        
        return endpointMap[operation] || '/api/fallback';
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obter métricas do sistema
     */
    getMetrics() {
        const totalSuccess = this.metrics.criticalOperations.success + 
                           this.metrics.realTimeOperations.success + 
                           this.metrics.nonCriticalOperations.success;
        
        const totalFailed = this.metrics.criticalOperations.failed + 
                          this.metrics.realTimeOperations.failed + 
                          this.metrics.nonCriticalOperations.failed;
        
        return {
            ...this.metrics,
            successRate: this.metrics.totalOperations > 0 ? 
                ((totalSuccess / this.metrics.totalOperations) * 100).toFixed(2) : 0,
            failureRate: this.metrics.totalOperations > 0 ? 
                ((totalFailed / this.metrics.totalOperations) * 100).toFixed(2) : 0,
            connectionStates: this.connectionStates,
            operationTypes: this.operationTypes
        };
    }

    /**
     * Obter status de saúde do sistema
     */
    getHealthStatus() {
        return {
            websocket: {
                isHealthy: this.connectionStates.websocket.isHealthy,
                consecutiveFailures: this.connectionStates.websocket.consecutiveFailures,
                lastFailure: this.connectionStates.websocket.lastFailure
            },
            restApi: {
                isHealthy: this.connectionStates.restApi.isHealthy,
                consecutiveFailures: this.connectionStates.restApi.consecutiveFailures,
                lastFailure: this.connectionStates.restApi.lastFailure
            },
            overallHealth: this.connectionStates.websocket.isHealthy || this.connectionStates.restApi.isHealthy
        };
    }

    /**
     * Resetar métricas
     */
    resetMetrics() {
        this.metrics = {
            criticalOperations: { success: 0, fallback: 0, failed: 0 },
            realTimeOperations: { success: 0, retry: 0, failed: 0 },
            nonCriticalOperations: { success: 0, retry: 0, failed: 0 },
            totalOperations: 0,
            fallbackSwitches: 0
        };
        Logger.log('🧠 Métricas resetadas');
    }

    /**
     * Forçar estratégia específica
     */
    forceStrategy(operation, strategy) {
        if (strategy === 'fallback') {
            // Temporariamente tratar como crítica
            this.operationTypes.CRITICAL.push(operation);
            Logger.log(`🧠 Forçando fallback para ${operation}`);
        } else if (strategy === 'retry') {
            // Temporariamente tratar como não-crítica
            this.operationTypes.NON_CRITICAL.push(operation);
            Logger.log(`🧠 Forçando retry para ${operation}`);
        }
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            this.isInitialized = false;
            Logger.log('✅ Sistema de fallback inteligente limpo');
        } catch (error) {
            Logger.error('❌ Erro ao limpar sistema inteligente:', error);
        }
    }
}

// Singleton
const intelligentFallbackService = new IntelligentFallbackService();
export default intelligentFallbackService;







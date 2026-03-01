import Logger from '../utils/Logger';
/**
 * 📱 SISTEMA DE PERSISTÊNCIA OFFLINE
 * Funcionamento completo do app sem conexão com internet
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNetInfo, addNetInfoListener } from '../utils/NetInfoSafe';
import { Platform } from 'react-native';
import WebSocketManager from './WebSocketManager';
import IntelligentFallbackService from './IntelligentFallbackService';


class OfflinePersistenceService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.fallbackService = IntelligentFallbackService;
        
        // Configurações de persistência
        this.config = {
            maxOfflineOperations: 1000,
            syncInterval: 30000, // 30 segundos
            retryInterval: 60000, // 1 minuto
            maxRetries: 5,
            storageKeys: {
                offlineQueue: '@offline_queue',
                userState: '@user_state',
                rideState: '@ride_state',
                driverState: '@driver_state',
                chatState: '@chat_state',
                settings: '@settings',
                lastSync: '@last_sync'
            }
        };
        
        // Estados
        this.isOnline = true;
        this.isInitialized = false;
        this.syncInProgress = false;
        this.offlineQueue = [];
        
        // Listeners de conectividade
        this.connectivityListeners = [];
        
        // Métricas offline
        this.metrics = {
            offlineOperations: 0,
            syncedOperations: 0,
            failedSyncs: 0,
            lastOfflineTime: null,
            totalOfflineTime: 0,
            queueSize: 0
        };
        
        Logger.log('📱 Sistema de persistência offline inicializado');
    }

    /**
     * Inicializar o sistema offline
     */
    async initialize() {
        try {
            Logger.log('📱 Inicializando sistema de persistência offline...');
            
            // 1. Configurar monitoramento de conectividade
            await this.setupConnectivityMonitoring();
            
            // 2. Carregar estado offline
            await this.loadOfflineState();
            
            // 3. Configurar sincronização automática
            this.setupAutoSync();
            
            // 4. Configurar listeners de eventos
            this.setupEventListeners();
            
            this.isInitialized = true;
            Logger.log('✅ Sistema de persistência offline inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar sistema offline:', error);
            throw error;
        }
    }

    /**
     * Configurar monitoramento de conectividade
     */
    async setupConnectivityMonitoring() {
        try {
            // Verificar estado inicial
            const netInfo = await fetchNetInfo();
            this.isOnline = netInfo.isConnected && netInfo.isInternetReachable;
            
            Logger.log(`📱 Estado inicial de conectividade: ${this.isOnline ? 'ONLINE' : 'OFFLINE'}`);
            
            // Configurar listener
            addNetInfoListener(state => {
                const wasOnline = this.isOnline;
                this.isOnline = state.isConnected && state.isInternetReachable;
                
                if (wasOnline !== this.isOnline) {
                    this.handleConnectivityChange(this.isOnline);
                }
            });
            
        } catch (error) {
            Logger.error('❌ Erro ao configurar monitoramento de conectividade:', error);
        }
    }

    /**
     * Carregar estado offline
     */
    async loadOfflineState() {
        try {
            // Carregar fila offline
            const offlineQueueData = await AsyncStorage.getItem(this.config.storageKeys.offlineQueue);
            if (offlineQueueData) {
                this.offlineQueue = JSON.parse(offlineQueueData);
                this.metrics.queueSize = this.offlineQueue.length;
                Logger.log(`📱 Carregadas ${this.offlineQueue.length} operações offline`);
            }
            
            // Carregar métricas
            const metricsData = await AsyncStorage.getItem('@offline_metrics');
            if (metricsData) {
                this.metrics = { ...this.metrics, ...JSON.parse(metricsData) };
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao carregar estado offline:', error);
        }
    }

    /**
     * Configurar sincronização automática
     */
    setupAutoSync() {
        // Sincronização periódica quando online
        setInterval(async () => {
            if (this.isOnline && !this.syncInProgress && this.offlineQueue.length > 0) {
                await this.syncOfflineOperations();
            }
        }, this.config.syncInterval);
        
        Logger.log('📱 Sincronização automática configurada');
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        // WebSocket listeners
        this.wsManager.on('disconnect', () => {
            this.handleConnectivityChange(false);
        });
        
        this.wsManager.on('connect', () => {
            this.handleConnectivityChange(true);
        });
        
        Logger.log('📱 Listeners de eventos configurados');
    }

    /**
     * Tratar mudança de conectividade
     */
    async handleConnectivityChange(isOnline) {
        Logger.log(`📱 Mudança de conectividade: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
        
        if (isOnline) {
            this.metrics.lastOfflineTime = null;
            // Tentar sincronizar operações offline
            if (this.offlineQueue.length > 0) {
                await this.syncOfflineOperations();
            }
        } else {
            this.metrics.lastOfflineTime = Date.now();
        }
        
        // Notificar listeners
        this.connectivityListeners.forEach(listener => {
            try {
                listener(isOnline);
            } catch (error) {
                Logger.error('❌ Erro em listener de conectividade:', error);
            }
        });
    }

    /**
     * Executar operação com persistência offline
     */
    async executeOfflineOperation(operation, data, options = {}) {
        const {
            priority = 'normal',
            retryable = true,
            expiresAt = null
        } = options;
        
        const operationData = {
            id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            operation,
            data,
            priority,
            retryable,
            expiresAt,
            timestamp: Date.now(),
            attempts: 0
        };
        
        try {
            if (this.isOnline) {
                // Tentar executar online primeiro
                const result = await this.fallbackService.executeOperation(operation, data);
                Logger.log(`📱 Operação ${operation} executada online`);
                return result;
            } else {
                // Adicionar à fila offline
                await this.addToOfflineQueue(operationData);
                Logger.log(`📱 Operação ${operation} adicionada à fila offline`);
                return { success: true, offline: true, queued: true };
            }
        } catch (error) {
            if (this.isOnline && retryable) {
                // Se falhou online, adicionar à fila offline
                await this.addToOfflineQueue(operationData);
                Logger.log(`📱 Operação ${operation} falhou online, adicionada à fila offline`);
                return { success: true, offline: true, queued: true };
            } else {
                throw error;
            }
        }
    }

    /**
     * Adicionar operação à fila offline
     */
    async addToOfflineQueue(operationData) {
        try {
            // Verificar limite de operações
            if (this.offlineQueue.length >= this.config.maxOfflineOperations) {
                // Remover operações mais antigas
                this.offlineQueue = this.offlineQueue.slice(-this.config.maxOfflineOperations + 1);
            }
            
            // Adicionar operação
            this.offlineQueue.push(operationData);
            this.metrics.offlineOperations++;
            this.metrics.queueSize = this.offlineQueue.length;
            
            // Salvar no AsyncStorage
            await AsyncStorage.setItem(
                this.config.storageKeys.offlineQueue,
                JSON.stringify(this.offlineQueue)
            );
            
            // Salvar métricas
            await this.saveMetrics();
            
        } catch (error) {
            Logger.error('❌ Erro ao adicionar à fila offline:', error);
        }
    }

    /**
     * Sincronizar operações offline
     */
    async syncOfflineOperations() {
        if (this.syncInProgress || !this.isOnline) {
            return;
        }
        
        this.syncInProgress = true;
        Logger.log(`📱 Iniciando sincronização de ${this.offlineQueue.length} operações offline`);
        
        try {
            const operationsToSync = [...this.offlineQueue];
            const syncedOperations = [];
            const failedOperations = [];
            
            for (const operationData of operationsToSync) {
                try {
                    // Verificar se operação expirou
                    if (operationData.expiresAt && Date.now() > operationData.expiresAt) {
                        Logger.log(`📱 Operação ${operationData.operation} expirada, removendo`);
                        continue;
                    }
                    
                    // Tentar executar operação
                    const result = await this.fallbackService.executeOperation(
                        operationData.operation,
                        operationData.data
                    );
                    
                    syncedOperations.push(operationData);
                    this.metrics.syncedOperations++;
                    Logger.log(`📱 Operação ${operationData.operation} sincronizada com sucesso`);
                    
                } catch (error) {
                    operationData.attempts++;
                    
                    if (operationData.attempts >= this.config.maxRetries) {
                        Logger.log(`📱 Operação ${operationData.operation} falhou após ${this.config.maxRetries} tentativas`);
                        failedOperations.push(operationData);
                    } else {
                        Logger.log(`📱 Operação ${operationData.operation} falhou, tentativa ${operationData.attempts}/${this.config.maxRetries}`);
                    }
                }
            }
            
            // Atualizar fila offline
            this.offlineQueue = failedOperations;
            this.metrics.queueSize = this.offlineQueue.length;
            
            // Salvar estado atualizado
            await AsyncStorage.setItem(
                this.config.storageKeys.offlineQueue,
                JSON.stringify(this.offlineQueue)
            );
            
            await this.saveMetrics();
            
            Logger.log(`📱 Sincronização concluída: ${syncedOperations.length} sucessos, ${failedOperations.length} falhas`);
            
        } catch (error) {
            Logger.error('❌ Erro na sincronização offline:', error);
            this.metrics.failedSyncs++;
        } finally {
            this.syncInProgress = false;
        }
    }

    /**
     * Salvar estado do usuário offline
     */
    async saveUserState(userState) {
        try {
            const stateData = {
                ...userState,
                timestamp: Date.now(),
                offline: !this.isOnline
            };
            
            await AsyncStorage.setItem(
                this.config.storageKeys.userState,
                JSON.stringify(stateData)
            );
            
            Logger.log('📱 Estado do usuário salvo offline');
            
        } catch (error) {
            Logger.error('❌ Erro ao salvar estado do usuário:', error);
        }
    }

    /**
     * Carregar estado do usuário offline
     */
    async loadUserState() {
        try {
            const stateData = await AsyncStorage.getItem(this.config.storageKeys.userState);
            if (stateData) {
                const state = JSON.parse(stateData);
                Logger.log('📱 Estado do usuário carregado offline');
                return state;
            }
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao carregar estado do usuário:', error);
            return null;
        }
    }

    /**
     * Salvar estado da corrida offline
     */
    async saveRideState(rideState) {
        try {
            const stateData = {
                ...rideState,
                timestamp: Date.now(),
                offline: !this.isOnline
            };
            
            await AsyncStorage.setItem(
                this.config.storageKeys.rideState,
                JSON.stringify(stateData)
            );
            
            Logger.log('📱 Estado da corrida salvo offline');
            
        } catch (error) {
            Logger.error('❌ Erro ao salvar estado da corrida:', error);
        }
    }

    /**
     * Carregar estado da corrida offline
     */
    async loadRideState() {
        try {
            const stateData = await AsyncStorage.getItem(this.config.storageKeys.rideState);
            if (stateData) {
                const state = JSON.parse(stateData);
                Logger.log('📱 Estado da corrida carregado offline');
                return state;
            }
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao carregar estado da corrida:', error);
            return null;
        }
    }

    /**
     * Salvar métricas
     */
    async saveMetrics() {
        try {
            await AsyncStorage.setItem('@offline_metrics', JSON.stringify(this.metrics));
        } catch (error) {
            Logger.error('❌ Erro ao salvar métricas:', error);
        }
    }

    /**
     * Adicionar listener de conectividade
     */
    addConnectivityListener(listener) {
        this.connectivityListeners.push(listener);
        
        // Retornar função para remover listener
        return () => {
            const index = this.connectivityListeners.indexOf(listener);
            if (index > -1) {
                this.connectivityListeners.splice(index, 1);
            }
        };
    }

    /**
     * Obter métricas offline
     */
    getMetrics() {
        return {
            ...this.metrics,
            isOnline: this.isOnline,
            queueSize: this.offlineQueue.length,
            syncInProgress: this.syncInProgress,
            lastSync: this.metrics.lastSync || null
        };
    }

    /**
     * Limpar dados offline
     */
    async clearOfflineData() {
        try {
            await AsyncStorage.multiRemove([
                this.config.storageKeys.offlineQueue,
                this.config.storageKeys.userState,
                this.config.storageKeys.rideState,
                this.config.storageKeys.driverState,
                this.config.storageKeys.chatState,
                '@offline_metrics'
            ]);
            
            this.offlineQueue = [];
            this.metrics = {
                offlineOperations: 0,
                syncedOperations: 0,
                failedSyncs: 0,
                lastOfflineTime: null,
                totalOfflineTime: 0,
                queueSize: 0
            };
            
            Logger.log('📱 Dados offline limpos');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar dados offline:', error);
        }
    }

    /**
     * Forçar sincronização
     */
    async forceSync() {
        if (this.isOnline) {
            await this.syncOfflineOperations();
        } else {
            throw new Error('Não é possível sincronizar offline');
        }
    }

    /**
     * Verificar se está online
     */
    isConnected() {
        return this.isOnline;
    }

    /**
     * Obter tamanho da fila offline
     */
    getQueueSize() {
        return this.offlineQueue.length;
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            // Salvar estado final
            await this.saveMetrics();
            
            this.isInitialized = false;
            this.connectivityListeners = [];
            
            Logger.log('✅ Sistema de persistência offline limpo');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar sistema offline:', error);
        }
    }
}

// Singleton
const offlinePersistenceService = new OfflinePersistenceService();
export default offlinePersistenceService;







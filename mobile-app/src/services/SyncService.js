import Logger from '../utils/Logger';
// SyncService.js - Sincronização híbrida entre cache local, Redis e Firebase
// Mock para testes Node.js
const getApiUrl = (endpoint) => `http://localhost:5001/leaf-app-91dfdce0/us-central1${endpoint}`;
const handleError = (error, showAlert = false) => ({ error: error.message, showAlert });

// Mock AsyncStorage para testes Node.js
const AsyncStorage = {
    setItem: async (key, value) => Promise.resolve(),
    getItem: async (key) => Promise.resolve(null),
    removeItem: async (key) => Promise.resolve()
};

class SyncService {
    constructor() {
        this.syncQueue = [];
        this.isSyncing = false;
        this.syncInterval = null;
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 segundos
    }

    // Inicializar serviço de sincronização
    async initialize() {
        try {
            // Limpar cache expirado na inicialização
            await this.cleanExpiredCache();

            // Iniciar sincronização periódica
            this.startPeriodicSync();

            Logger.log('🔄 SyncService inicializado com sucesso');
        } catch (error) {
            Logger.error('❌ Erro ao inicializar SyncService:', error);
        }
    }

    // Adicionar item à fila de sincronização
    async queueForSync(type, userId, data) {
        try {
            const syncItem = {
                id: `${type}_${userId}_${Date.now()}`,
                type,
                userId,
                data,
                timestamp: Date.now(),
                retries: 0,
                status: 'pending'
            };

            this.syncQueue.push(syncItem);
            Logger.log(`📋 Item adicionado à fila de sincronização: ${type} para ${userId}`);

            // Tentar sincronizar imediatamente se não estiver sincronizando
            if (!this.isSyncing) {
                this.processSyncQueue();
            }

            return syncItem.id;
        } catch (error) {
            Logger.error('❌ Erro ao adicionar item à fila de sincronização:', error);
            return null;
        }
    }

    // Processar fila de sincronização
    async processSyncQueue() {
        if (this.isSyncing || this.syncQueue.length === 0) {
            return;
        }

        this.isSyncing = true;
        Logger.log(`🔄 Processando ${this.syncQueue.length} itens na fila de sincronização`);

        try {
            const itemsToProcess = [...this.syncQueue];
            this.syncQueue = [];

            for (const item of itemsToProcess) {
                await this.syncItem(item);
            }
        } catch (error) {
            Logger.error('❌ Erro ao processar fila de sincronização:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    // Sincronizar item individual
    async syncItem(item) {
        try {
            Logger.log(`🔄 Sincronizando ${item.type} para ${item.userId}`);

            switch (item.type) {
                case 'location':
                    await this.syncLocation(item.userId, item.data);
                    break;
                case 'trip':
                    await this.syncTrip(item.userId, item.data);
                    break;
                case 'driver_status':
                    await this.syncDriverStatus(item.userId, item.data);
                    break;
                default:
                    Logger.warn(`⚠️ Tipo de sincronização desconhecido: ${item.type}`);
                    return;
            }

            item.status = 'completed';
            Logger.log(`✅ Sincronização concluída: ${item.type} para ${item.userId}`);

        } catch (error) {
            Logger.error(`❌ Erro na sincronização de ${item.type}:`, error);

            item.retries++;
            item.status = 'failed';

            if (item.retries < this.maxRetries) {
                // Re-adicionar à fila para nova tentativa
                setTimeout(() => {
                    this.syncQueue.push(item);
                    this.processSyncQueue();
                }, this.retryDelay * item.retries);

                Logger.log(`🔄 Reagendando ${item.type} para ${item.userId} (tentativa ${item.retries + 1})`);
            } else {
                Logger.error(`❌ Máximo de tentativas atingido para ${item.type} (${item.userId})`);
                // Salvar em storage local para sincronização manual posterior
                await this.saveFailedSync(item);
            }
        }
    }

    // Sincronizar localização
    async syncLocation(userId, locationData) {
        try {
            // 1. Sincronizar com Redis (via Firebase Functions)
            const redisResponse = await fetch(getApiUrl('/update_user_location'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    latitude: locationData.lat,
                    longitude: locationData.lng,
                    timestamp: Date.now()
                })
            });

            if (!redisResponse.ok) {
                throw new Error(`Redis sync failed: ${redisResponse.status}`);
            }

            // 2. Sincronizar com Firebase (backup) DESATIVADO PARA CUSTO $0
            // await this.syncToFirebase('location', userId, locationData);

            Logger.log(`📍 Localização sincronizada: ${userId} -> Redis API`);

        } catch (error) {
            Logger.error('❌ Erro na sincronização de localização:', error);
            throw error;
        }
    }

    // Sincronizar dados de viagem
    async syncTrip(userId, tripData) {
        try {
            // 1. Sincronizar com Redis
            const redisResponse = await fetch(getApiUrl('/update_trip_data'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    tripId: tripData.tripId,
                    ...tripData
                })
            });

            if (!redisResponse.ok) {
                throw new Error(`Redis sync failed: ${redisResponse.status}`);
            }

            // 2. Sincronizar com Firebase DESATIVADO PARA CUSTO $0
            // await this.syncToFirebase('trip', userId, tripData);

            Logger.log(`🚕 Viagem sincronizada: ${tripData.tripId} -> Redis API`);

        } catch (error) {
            Logger.error('❌ Erro na sincronização de viagem:', error);
            throw error;
        }
    }

    // Sincronizar status do motorista
    async syncDriverStatus(userId, statusData) {
        try {
            // 1. Sincronizar com Redis
            const redisResponse = await fetch(getApiUrl('/update_driver_status'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    status: statusData.status,
                    timestamp: Date.now()
                })
            });

            if (!redisResponse.ok) {
                throw new Error(`Redis sync failed: ${redisResponse.status}`);
            }

            // 2. Sincronizar com Firebase DESATIVADO PARA CUSTO $0
            // await this.syncToFirebase('driver_status', userId, statusData);

            Logger.log(`🚗 Status do motorista sincronizado: ${userId} -> Redis`);

        } catch (error) {
            Logger.error('❌ Erro na sincronização de status do motorista:', error);
            throw error;
        }
    }

    // Sincronizar com Firebase (backup)
    async syncToFirebase(type, userId, data) {
        // DESATIVADO PARA CUSTO $0 (Proxy do Firebase desligado)
        return;
    }

    // Salvar sincronização falhada
    async saveFailedSync(item) {
        try {
            const failedSyncs = await this.getFailedSyncs();
            failedSyncs.push({
                ...item,
                failedAt: Date.now()
            });

            // Manter apenas os últimos 100 itens falhados
            if (failedSyncs.length > 100) {
                failedSyncs.splice(0, failedSyncs.length - 100);
            }

            await AsyncStorage.setItem('failed_syncs', JSON.stringify(failedSyncs));
            Logger.log(`💾 Sincronização falhada salva: ${item.type} para ${item.userId}`);

        } catch (error) {
            Logger.error('❌ Erro ao salvar sincronização falhada:', error);
        }
    }

    // Obter sincronizações falhadas
    async getFailedSyncs() {
        try {
            const data = await AsyncStorage.getItem('failed_syncs');
            return data ? JSON.parse(data) : [];
        } catch (error) {
            Logger.error('❌ Erro ao obter sincronizações falhadas:', error);
            return [];
        }
    }

    // Tentar sincronizar itens falhados
    async retryFailedSyncs() {
        try {
            const failedSyncs = await this.getFailedSyncs();
            if (failedSyncs.length === 0) {
                Logger.log('✅ Nenhuma sincronização falhada para tentar novamente');
                return;
            }

            Logger.log(`🔄 Tentando sincronizar ${failedSyncs.length} itens falhados`);

            for (const item of failedSyncs) {
                item.retries = 0; // Reset retries
                this.syncQueue.push(item);
            }

            // Limpar lista de falhados
            await AsyncStorage.removeItem('failed_syncs');

            // Processar fila
            this.processSyncQueue();

        } catch (error) {
            Logger.error('❌ Erro ao tentar sincronizações falhadas:', error);
        }
    }

    // Iniciar sincronização periódica
    startPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // Sincronizar a cada 30 segundos
        this.syncInterval = setInterval(() => {
            this.processSyncQueue();
            this.cleanExpiredCache();
        }, 30000);

        Logger.log('⏰ Sincronização periódica iniciada (30s)');
    }

    // Parar sincronização periódica
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            Logger.log('⏹️ Sincronização periódica parada');
        }
    }

    // Limpar cache expirado
    async cleanExpiredCache() {
        try {
            // Esta função será implementada no LocalCacheService
            // Por enquanto, apenas log
            Logger.log('🧹 Limpeza de cache expirado executada');
        } catch (error) {
            Logger.error('❌ Erro na limpeza de cache:', error);
        }
    }

    // Obter estatísticas de sincronização
    getSyncStats() {
        return {
            queueLength: this.syncQueue.length,
            isSyncing: this.isSyncing,
            lastSync: this.lastSyncTime || null
        };
    }

    // Destruir serviço
    destroy() {
        this.stopPeriodicSync();
        this.syncQueue = [];
        this.isSyncing = false;
        Logger.log('🗑️ SyncService destruído');
    }
}

module.exports = SyncService; 
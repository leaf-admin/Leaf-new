// RedisApiService.js - Serviço híbrido Redis + Firebase com cache local
// Mock para testes Node.js

// Importar configuração centralizada
const { API_URLS, API_CONFIG } = require('../config/ApiConfig.js');

const getApiUrl = (endpoint) => `${API_URLS.redisApi}${endpoint}`;
const handleError = (error, showAlert = false) => ({ error: error.message, showAlert });
const logError = (error) => console.error('Error logged:', error);

const LocalCacheService = require('./LocalCacheService.js');
const SyncService = require('./SyncService.js');

class RedisApiService {
    constructor() {
        this.baseUrl = API_URLS.redisApi;
        this.isAvailable = true;
        this.config = API_CONFIG;
        
        // Inicializar serviços híbridos
        this.localCache = new LocalCacheService();
        this.syncService = new SyncService();
        
        // Inicializar sincronização
        this.syncService.initialize();
        
        console.log('🚀 RedisApiService híbrido inicializado');
    }

    // Método genérico para fazer requisições
    async makeRequest(endpoint, method = 'GET', data = null) {
        try {
            const url = getApiUrl(endpoint);
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: this.config.timeout,
            };

            if (data && method !== 'GET') {
                options.body = JSON.stringify(data);
            }

            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            const errorResult = handleError(error, false); // Não mostrar alerta aqui
            logError(error);
            throw errorResult;
        }
    }

    // Atualizar localização do usuário (Híbrido: Cache Local → Redis → Firebase)
    async updateUserLocation(userId, lat, lng, timestamp = Date.now()) {
        try {
            // 1. Salvar no cache local primeiro (instantâneo)
            await this.localCache.setLocation(userId, { lat, lng, timestamp });
            
            // 2. Adicionar à fila de sincronização (Redis + Firebase)
            await this.syncService.queueForSync('location', userId, { lat, lng, timestamp });
            
            console.log(`📍 Localização híbrida: Cache local → Sincronização Redis/Firebase (${userId})`);
            return { success: true, cached: true, syncing: true };
            
        } catch (error) {
            console.error('❌ Erro na atualização híbrida de localização:', error);
            handleError(error, true);
            return null;
        }
    }

    // Buscar motoristas próximos (Híbrido: Cache Local → Redis → Firebase)
    async getNearbyDrivers(lat, lng, radius = 5) {
        try {
            // 1. Verificar cache local primeiro
            const cachedDrivers = await this.localCache.getNearbyDrivers(lat, lng, radius);
            if (cachedDrivers && cachedDrivers.length > 0) {
                console.log(`🚗 Cache local: ${cachedDrivers.length} motoristas encontrados`);
                return cachedDrivers;
            }
            
            // 2. Se não encontrado no cache, buscar no Redis
            if (!this.isAvailable) {
                console.log('📱 Redis API não disponível, tentando Firebase...');
                return await this.getNearbyDriversFromFirebase(lat, lng, radius);
            }

            try {
                const result = await this.makeRequest(API_URLS.endpoints.getNearbyDrivers, 'POST', {
                    latitude: lat,
                    longitude: lng,
                    radius
                });
                
                const drivers = result.drivers || [];
                
                // 3. Salvar no cache local para próximas consultas
                await this.localCache.setNearbyDrivers(lat, lng, radius, drivers);
                
                console.log(`🚗 Redis API: ${drivers.length} motoristas encontrados e salvos no cache`);
                return drivers;
                
            } catch (redisError) {
                console.warn('⚠️ Redis falhou, tentando Firebase...', redisError);
                return await this.getNearbyDriversFromFirebase(lat, lng, radius);
            }
            
        } catch (error) {
            console.error('❌ Erro na busca híbrida de motoristas:', error);
            handleError(error, true);
            return [];
        }
    }
    
    // Fallback para Firebase
    async getNearbyDriversFromFirebase(lat, lng, radius) {
        try {
            const result = await this.makeRequest('/firebase/nearby_drivers', 'POST', {
                latitude: lat,
                longitude: lng,
                radius
            });
            
            const drivers = result.drivers || [];
            console.log(`🔥 Firebase fallback: ${drivers.length} motoristas encontrados`);
            return drivers;
            
        } catch (firebaseError) {
            console.error('❌ Firebase também falhou:', firebaseError);
            return [];
        }
    }

    // Iniciar tracking de viagem
    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest(API_URLS.endpoints.startTripTracking, 'POST', {
                tripId,
                driverId,
                passengerId,
                initialLocation
            });
            
            console.log('🚗 Tracking iniciado via Redis API:', tripId);
            return result;
        } catch (error) {
            handleError(error, true); // Mostrar alerta para o usuário
            return null;
        }
    }

    // Atualizar localização da viagem
    async updateTripLocation(tripId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest(API_URLS.endpoints.updateTripLocation, 'POST', {
                tripId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            console.log('📍 Localização da viagem atualizada via Redis API:', tripId);
            return result;
        } catch (error) {
            handleError(error, true); // Mostrar alerta para o usuário
            return null;
        }
    }

    // Finalizar tracking de viagem
    async endTripTracking(tripId, endLocation) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest(API_URLS.endpoints.endTripTracking, 'POST', {
                tripId,
                endLocation
            });
            
            console.log('✅ Tracking finalizado via Redis API:', tripId);
            return result;
        } catch (error) {
            handleError(error, true); // Mostrar alerta para o usuário
            return null;
        }
    }

    // Obter dados da viagem (Híbrido: Cache Local → Redis → Firebase)
    async getTripData(tripId) {
        try {
            // 1. Verificar cache local primeiro
            const cachedTrip = await this.localCache.getTripData(tripId);
            if (cachedTrip) {
                console.log(`🚕 Cache local: Dados da viagem ${tripId} encontrados`);
                return cachedTrip;
            }
            
            // 2. Se não encontrado no cache, buscar no Redis
            if (!this.isAvailable) {
                console.log('📱 Redis API não disponível, tentando Firebase...');
                return await this.getTripDataFromFirebase(tripId);
            }

            try {
                const result = await this.makeRequest(`${API_URLS.endpoints.getTripData}/${tripId}`, 'GET');
                const tripData = result.tripData || null;
                
                if (tripData) {
                    // 3. Salvar no cache local
                    await this.localCache.setTripData(tripId, tripData);
                    console.log(`🚕 Redis API: Dados da viagem ${tripId} salvos no cache`);
                }
                
                return tripData;
                
            } catch (redisError) {
                console.warn('⚠️ Redis falhou, tentando Firebase...', redisError);
                return await this.getTripDataFromFirebase(tripId);
            }
            
        } catch (error) {
            console.error('❌ Erro na busca híbrida de dados da viagem:', error);
            handleError(error, true);
            return null;
        }
    }
    
    // Fallback para Firebase
    async getTripDataFromFirebase(tripId) {
        try {
            const result = await this.makeRequest(`/firebase/trip_data/${tripId}`, 'GET');
            const tripData = result.tripData || null;
            
            if (tripData) {
                await this.localCache.setTripData(tripId, tripData);
                console.log(`🔥 Firebase fallback: Dados da viagem ${tripId} salvos no cache`);
            }
            
            return tripData;
            
        } catch (firebaseError) {
            console.error('❌ Firebase também falhou:', firebaseError);
            return null;
        }
    }

    // Obter estatísticas do Redis
    async getRedisStats() {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest(API_URLS.endpoints.getRedisStats, 'GET');
            
            console.log('📊 Estatísticas do Redis obtidas via API');
            return result.stats || null;
        } catch (error) {
            handleError(error, true); // Mostrar alerta para o usuário
            return null;
        }
    }

    // Verificar se o serviço está disponível
    isServiceAvailable() {
        return this.isAvailable;
    }

    // Testar conexão com a API
    async testConnection() {
        if (!this.isAvailable) {
            return { available: false, reason: 'Serviço não disponível' };
        }

        try {
            const result = await this.makeRequest(API_URLS.endpoints.health, 'GET');
            return { available: true, data: result };
        } catch (error) {
            return { available: false, reason: error.message };
        }
    }

    // Métodos de gerenciamento de cache
    async getCacheStats() {
        return await this.localCache.getCacheStats();
    }

    async clearCache() {
        return await this.localCache.clearAllCache();
    }

    async cleanExpiredCache() {
        return await this.localCache.cleanExpiredCache();
    }

    // Métodos de gerenciamento de sincronização
    getSyncStats() {
        return this.syncService.getSyncStats();
    }

    async retryFailedSyncs() {
        return await this.syncService.retryFailedSyncs();
    }

    async getFailedSyncs() {
        return await this.syncService.getFailedSyncs();
    }

    // Destruir serviço
    destroy() {
        this.syncService.destroy();
        console.log('🗑️ RedisApiService híbrido destruído');
    }
}

// Instância singleton
const redisApiService = new RedisApiService();
module.exports = { redisApiService }; 
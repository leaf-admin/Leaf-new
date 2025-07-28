// RedisApiService.js - Serviço híbrido Redis + Firebase com cache local
// Mock para testes Node.js

// Importar configuração centralizada
const { API_URLS, API_CONFIG, getSelfHostedApiUrl, getFirebaseApiUrl } = require('../config/ApiConfig.cjs');

const getApiUrl = (endpoint, useFallback = false) => {
    if (useFallback) {
        return getFirebaseApiUrl(endpoint);
    }
    return getSelfHostedApiUrl(endpoint);
};

const handleError = (error, showAlert = false) => ({ error: error.message, showAlert });
const logError = (error) => console.error('Error logged:', error);

const LocalCacheService = require('./LocalCacheService.js');
const SyncService = require('./SyncService.js');

class RedisApiService {
    constructor() {
        this.baseUrl = API_URLS.selfHostedApi;
        this.isAvailable = true;
        this.config = API_CONFIG;
        
        // Inicializar serviços híbridos
        this.localCache = new LocalCacheService();
        this.syncService = new SyncService();
        
        // Inicializar sincronização
        this.syncService.initialize();
        
        console.log('🚀 RedisApiService híbrido inicializado');
        console.log(`🏠 Self-Hosted API: ${this.baseUrl}`);
    }

    // Método genérico para fazer requisições
    async makeRequest(endpoint, method = 'GET', data = null, useFallback = false) {
        try {
            const url = getApiUrl(endpoint, useFallback);
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

            console.log(`🌐 Fazendo requisição: ${method} ${url}`);
            const response = await fetch(url, options);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`❌ Erro na requisição ${endpoint}:`, error);
            const errorResult = handleError(error, false);
            logError(error);
            throw errorResult;
        }
    }

    // Atualizar localização do usuário (Híbrido: Cache Local → Self-Hosted → Firebase)
    async updateUserLocation(userId, lat, lng, timestamp = Date.now()) {
        try {
            // 1. Salvar no cache local primeiro (instantâneo)
            await this.localCache.setLocation(userId, { lat, lng, timestamp });
            
            // 2. Tentar Self-Hosted API primeiro
            try {
                const result = await this.makeRequest('/api/update_user_location', 'POST', {
                    userId,
                    lat,
                    lng,
                    timestamp
                });
                
                console.log(`📍 Self-Hosted API: Localização atualizada (${userId})`);
                return { success: true, cached: true, syncing: true, source: 'self-hosted' };
                
            } catch (selfHostedError) {
                console.log('🔄 Self-Hosted falhou, tentando Firebase...');
                
                // 3. Fallback para Firebase
                const result = await this.makeRequest('/update_user_location', 'POST', {
                    userId,
                    lat,
                    lng,
                    timestamp
                }, true); // useFallback = true
                
                console.log(`📍 Firebase Fallback: Localização atualizada (${userId})`);
                return { success: true, cached: true, syncing: true, source: 'firebase' };
            }
            
        } catch (error) {
            console.error('❌ Erro na atualização híbrida de localização:', error);
            handleError(error, true);
            return null;
        }
    }

    // Buscar motoristas próximos (Híbrido: Cache Local → Self-Hosted → Firebase)
    async getNearbyDrivers(lat, lng, radius = 5) {
        try {
            // 1. Verificar cache local primeiro
            const cachedDrivers = await this.localCache.getNearbyDrivers(lat, lng, radius);
            if (cachedDrivers && cachedDrivers.length > 0) {
                console.log(`🚗 Cache local: ${cachedDrivers.length} motoristas encontrados`);
                return cachedDrivers;
            }
            
            // 2. Se não encontrado no cache, buscar no Self-Hosted
            if (!this.isAvailable) {
                console.log('📱 Self-Hosted API não disponível, tentando Firebase...');
                return await this.getNearbyDriversFromFirebase(lat, lng, radius);
            }

            try {
                const result = await this.makeRequest('/api/nearby_drivers', 'GET', null, false, {
                    lat,
                    lng,
                    radius
                });
                
                if (result.success && result.drivers) {
                    // Salvar no cache local
                    await this.localCache.setNearbyDrivers(lat, lng, result.drivers);
                    console.log(`🚗 Self-Hosted API: ${result.drivers.length} motoristas encontrados`);
                    return result.drivers;
                }
                
                throw new Error('Resposta inválida do Self-Hosted API');
                
            } catch (selfHostedError) {
                console.log('🔄 Self-Hosted falhou, tentando Firebase...');
                return await this.getNearbyDriversFromFirebase(lat, lng, radius);
            }
            
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas próximos:', error);
            handleError(error, true);
            return [];
        }
    }

    // Buscar motoristas no Firebase (fallback)
    async getNearbyDriversFromFirebase(lat, lng, radius) {
        try {
            const result = await this.makeRequest('/get_nearby_drivers', 'POST', {
                latitude: lat,
                longitude: lng,
                radius
            }, true); // useFallback = true
            
            if (result.success && result.drivers) {
                console.log(`🚗 Firebase API: ${result.drivers.length} motoristas encontrados`);
                return result.drivers;
            }
            
            return [];
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas no Firebase:', error);
            return [];
        }
    }

    // Iniciar tracking de viagem
    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (!this.isAvailable) {
            console.log('📱 Self-Hosted API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest('/api/start_trip_tracking', 'POST', {
                tripId,
                driverId,
                passengerId,
                initialLocation
            });
            
            console.log('🚗 Tracking iniciado via Self-Hosted API:', tripId);
            return result;
        } catch (error) {
            console.log('🔄 Self-Hosted falhou, tentando Firebase...');
            return await this.makeRequest('/start_trip_tracking', 'POST', {
                tripId,
                driverId,
                passengerId,
                initialLocation
            }, true); // useFallback = true
        }
    }

    // Atualizar localização da viagem
    async updateTripLocation(tripId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            console.log('📱 Self-Hosted API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest('/api/update_trip_location', 'POST', {
                tripId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            console.log('📍 Localização da viagem atualizada via Self-Hosted API:', tripId);
            return result;
        } catch (error) {
            console.log('🔄 Self-Hosted falhou, tentando Firebase...');
            return await this.makeRequest('/update_trip_location', 'POST', {
                tripId,
                latitude: lat,
                longitude: lng,
                timestamp
            }, true); // useFallback = true
        }
    }

    // Finalizar tracking de viagem
    async endTripTracking(tripId, endLocation) {
        if (!this.isAvailable) {
            console.log('📱 Self-Hosted API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest('/api/end_trip_tracking', 'POST', {
                tripId,
                endLocation
            });
            
            console.log('✅ Tracking finalizado via Self-Hosted API:', tripId);
            return result;
        } catch (error) {
            console.log('🔄 Self-Hosted falhou, tentando Firebase...');
            return await this.makeRequest('/end_trip_tracking', 'POST', {
                tripId,
                endLocation
            }, true); // useFallback = true
        }
    }

    // Obter dados da viagem (Híbrido: Cache Local → Self-Hosted → Firebase)
    async getTripData(tripId) {
        try {
            // 1. Verificar cache local primeiro
            const cachedTrip = await this.localCache.getTripData(tripId);
            if (cachedTrip) {
                console.log(`🚕 Cache local: Dados da viagem ${tripId} encontrados`);
                return cachedTrip;
            }
            
            // 2. Se não encontrado no cache, buscar no Self-Hosted
            if (!this.isAvailable) {
                console.log('📱 Self-Hosted API não disponível, tentando Firebase...');
                return await this.getTripDataFromFirebase(tripId);
            }

            try {
                const result = await this.makeRequest(`/api/get_trip_data/${tripId}`, 'GET');
                const tripData = result.tripData || null;
                
                if (tripData) {
                    // 3. Salvar no cache local
                    await this.localCache.setTripData(tripId, tripData);
                    console.log(`🚕 Self-Hosted API: Dados da viagem ${tripId} salvos no cache`);
                }
                
                return tripData;
                
            } catch (selfHostedError) {
                console.warn('⚠️ Self-Hosted falhou, tentando Firebase...', selfHostedError);
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
            const result = await this.makeRequest(`/get_trip_data/${tripId}`, 'GET', null, true);
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

    // Obter estatísticas do Self-Hosted
    async getRedisStats() {
        if (!this.isAvailable) {
            console.log('📱 Self-Hosted API não disponível');
            return null;
        }

        try {
            const result = await this.makeRequest('/api/stats', 'GET');
            
            console.log('📊 Estatísticas do Self-Hosted obtidas via API');
            return result;
        } catch (error) {
            console.log('🔄 Self-Hosted falhou, tentando Firebase...');
            return await this.makeRequest('/get_redis_stats', 'GET', null, true);
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
            const result = await this.makeRequest('/api/health', 'GET');
            return { available: true, data: result };
        } catch (error) {
            console.log('🔄 Self-Hosted falhou, tentando Firebase...');
            try {
                const firebaseResult = await this.makeRequest('/health', 'GET', null, true);
                return { available: true, data: firebaseResult, source: 'firebase' };
            } catch (firebaseError) {
                return { available: false, reason: error.message };
            }
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

// Exportar classe e instância singleton
const redisApiService = new RedisApiService();
module.exports = { redisApiService, RedisApiService }; 
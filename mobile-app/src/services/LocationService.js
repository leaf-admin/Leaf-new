import Logger from '../utils/Logger';
// LocationService.js - Serviço de localização otimizado com cache híbrido
// Mock para testes Node.js
const { redisApiService } = require('./RedisApiService');
const LocalCacheService = require('./LocalCacheService');

const handleError = (error, showAlert = false) => ({ error: error.message, showAlert });

class LocationService {
    constructor() {
        this.localCache = new LocalCacheService();
        this.updateInterval = null;
        this.isTracking = false;
        this.currentLocation = null;
        this.watchId = null;
    }

    // Inicializar serviço de localização
    async initialize() {
        try {
            // Limpar cache expirado
            await this.localCache.cleanExpiredCache();
            
            Logger.log('📍 LocationService inicializado');
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao inicializar LocationService:', error);
            return false;
        }
    }

    // Obter localização atual (com cache)
    async getCurrentLocation() {
        try {
            // 1. Verificar se já temos localização atual
            if (this.currentLocation) {
                return this.currentLocation;
            }

            // 2. Tentar obter do cache local
            const cachedLocation = await this.localCache.getLocation('current');
            if (cachedLocation) {
                this.currentLocation = cachedLocation;
                return cachedLocation;
            }

            // 3. Obter localização do dispositivo
            const location = await this.getDeviceLocation();
            if (location) {
                this.currentLocation = location;
                await this.localCache.setLocation('current', location);
                return location;
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao obter localização atual:', error);
            handleError(error, true);
            return null;
        }
    }

    // Obter localização do dispositivo
    async getDeviceLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocalização não suportada'));
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000 // 30 segundos
            };

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: position.timestamp,
                        altitude: position.coords.altitude,
                        heading: position.coords.heading,
                        speed: position.coords.speed
                    };
                    resolve(location);
                },
                (error) => {
                    Logger.error('❌ Erro de geolocalização:', error);
                    reject(error);
                },
                options
            );
        });
    }

    // Atualizar localização do usuário (híbrido)
    async updateUserLocation(userId, location = null) {
        try {
            // 1. Obter localização se não fornecida
            if (!location) {
                location = await this.getCurrentLocation();
                if (!location) {
                    throw new Error('Não foi possível obter localização');
                }
            }

            // 2. Atualizar via RedisApiService (cache local + sincronização)
            const result = await redisApiService.updateUserLocation(userId, location.lat, location.lng, location.timestamp);
            
            if (result && result.success) {
                Logger.log(`📍 Localização atualizada: ${userId} (${location.lat}, ${location.lng})`);
                return result;
            } else {
                throw new Error('Falha ao atualizar localização');
            }
        } catch (error) {
            Logger.error('❌ Erro ao atualizar localização do usuário:', error);
            handleError(error, true);
            return null;
        }
    }

    // Buscar motoristas próximos (otimizado)
    async getNearbyDrivers(lat = null, lng = null, radius = 5000) {
        try {
            // 1. Obter localização se não fornecida
            if (!lat || !lng) {
                const currentLocation = await this.getCurrentLocation();
                if (!currentLocation) {
                    throw new Error('Não foi possível obter localização atual');
                }
                lat = currentLocation.lat;
                lng = currentLocation.lng;
            }

            // 2. Buscar via RedisApiService (cache local + Redis + Firebase)
            const drivers = await redisApiService.getNearbyDrivers(lat, lng, radius);
            
            Logger.log(`🚗 ${drivers.length} motoristas encontrados próximos a (${lat}, ${lng})`);
            return drivers;
        } catch (error) {
            Logger.error('❌ Erro ao buscar motoristas próximos:', error);
            handleError(error, true);
            return [];
        }
    }

    // Iniciar tracking de localização
    async startLocationTracking(userId, interval = 30000) {
        try {
            if (this.isTracking) {
                Logger.log('📍 Tracking já está ativo');
                return true;
            }

            this.isTracking = true;
            Logger.log(`📍 Iniciando tracking de localização para ${userId} (${interval}ms)`);

            // 1. Primeira atualização imediata
            await this.updateUserLocation(userId);

            // 2. Configurar atualização periódica
            this.updateInterval = setInterval(async () => {
                try {
                    await this.updateUserLocation(userId);
                } catch (error) {
                    Logger.error('❌ Erro na atualização periódica:', error);
                }
            }, interval);

            // 3. Configurar watch de localização (se disponível)
            if (navigator.geolocation && navigator.geolocation.watchPosition) {
                this.watchId = navigator.geolocation.watchPosition(
                    async (position) => {
                        const location = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude,
                            accuracy: position.coords.accuracy,
                            timestamp: position.timestamp
                        };
                        
                        // Atualizar localização se mudou significativamente
                        if (this.hasLocationChanged(location)) {
                            await this.updateUserLocation(userId, location);
                        }
                    },
                    (error) => {
                        Logger.error('❌ Erro no watch de localização:', error);
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 10000
                    }
                );
            }

            return true;
        } catch (error) {
            Logger.error('❌ Erro ao iniciar tracking:', error);
            this.isTracking = false;
            return false;
        }
    }

    // Parar tracking de localização
    stopLocationTracking() {
        try {
            this.isTracking = false;

            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }

            if (this.watchId && navigator.geolocation) {
                navigator.geolocation.clearWatch(this.watchId);
                this.watchId = null;
            }

            Logger.log('⏹️ Tracking de localização parado');
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao parar tracking:', error);
            return false;
        }
    }

    // Verificar se a localização mudou significativamente
    hasLocationChanged(newLocation, threshold = 50) {
        if (!this.currentLocation) {
            return true;
        }

        const distance = this.calculateDistance(
            this.currentLocation.lat,
            this.currentLocation.lng,
            newLocation.lat,
            newLocation.lng
        );

        return distance > threshold; // 50 metros
    }

    // Calcular distância entre dois pontos
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371e3; // Raio da Terra em metros
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distância em metros
    }

    // Obter estatísticas de localização
    async getLocationStats() {
        try {
            const cacheStats = await this.localCache.getCacheStats();
            const syncStats = redisApiService.getSyncStats();

            return {
                currentLocation: this.currentLocation,
                isTracking: this.isTracking,
                cache: cacheStats,
                sync: syncStats,
                timestamp: Date.now()
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas:', error);
            return null;
        }
    }

    // Limpar dados de localização
    async clearLocationData() {
        try {
            await this.localCache.clearAllCache();
            this.currentLocation = null;
            Logger.log('🗑️ Dados de localização limpos');
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao limpar dados:', error);
            return false;
        }
    }

    // Destruir serviço
    destroy() {
        this.stopLocationTracking();
        this.currentLocation = null;
        Logger.log('🗑️ LocationService destruído');
    }
}

module.exports = LocationService; 
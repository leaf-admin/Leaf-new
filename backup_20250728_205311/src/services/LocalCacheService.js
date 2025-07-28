// LocalCacheService.js - Cache local para otimização de performance
// Mock AsyncStorage para testes Node.js
const AsyncStorage = {
    setItem: async (key, value) => {
        // Simular AsyncStorage
        return Promise.resolve();
    },
    getItem: async (key) => {
        // Simular dados em cache
        if (key.includes('test_user_1')) {
            return JSON.stringify({
                lat: -23.5505,
                lng: -46.6333,
                timestamp: Date.now(),
                ttl: Date.now() + 300000
            });
        }
        if (key.includes('nearby_drivers')) {
            return JSON.stringify({
                drivers: [
                    { id: 'driver_1', lat: -23.5505, lng: -46.6333, distance: 100 },
                    { id: 'driver_2', lat: -23.5506, lng: -46.6334, distance: 200 }
                ],
                timestamp: Date.now(),
                ttl: Date.now() + 300000
            });
        }
        return null;
    },
    removeItem: async (key) => Promise.resolve(),
    getAllKeys: async () => Promise.resolve([]),
    multiRemove: async (keys) => Promise.resolve()
};

class LocalCacheService {
    constructor() {
        this.ttl = 5 * 60 * 1000; // 5 minutos de TTL
        this.maxCacheSize = 50; // Máximo de 50 itens no cache
    }

    // Salvar localização no cache local
    async setLocation(userId, location) {
        try {
            const key = `location:${userId}`;
            const data = {
                ...location,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl
            };
            
            await AsyncStorage.setItem(key, JSON.stringify(data));
            console.log(`📍 Cache local: Localização salva para usuário ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar localização no cache local:', error);
            return false;
        }
    }

    // Buscar localização do cache local
    async getLocation(userId) {
        try {
            const key = `location:${userId}`;
            const data = await AsyncStorage.getItem(key);
            
            if (data) {
                const location = JSON.parse(data);
                if (location.ttl > Date.now()) {
                    console.log(`📍 Cache local: Localização encontrada para usuário ${userId}`);
                    return location;
                } else {
                    // TTL expirado, remover
                    await AsyncStorage.removeItem(key);
                    console.log(`⏰ Cache local: TTL expirado para usuário ${userId}`);
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar localização do cache local:', error);
            return null;
        }
    }

    // Salvar motoristas próximos no cache
    async setNearbyDrivers(lat, lng, radius, drivers) {
        try {
            const key = `nearby_drivers:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
            const data = {
                drivers,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl
            };
            
            await AsyncStorage.setItem(key, JSON.stringify(data));
            console.log(`🚗 Cache local: ${drivers.length} motoristas salvos para área ${lat},${lng}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar motoristas no cache local:', error);
            return false;
        }
    }

    // Buscar motoristas do cache local
    async getNearbyDrivers(lat, lng, radius) {
        try {
            const key = `nearby_drivers:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
            const data = await AsyncStorage.getItem(key);
            
            if (data) {
                const cached = JSON.parse(data);
                if (cached.ttl > Date.now()) {
                    console.log(`🚗 Cache local: ${cached.drivers.length} motoristas encontrados`);
                    return cached.drivers;
                } else {
                    await AsyncStorage.removeItem(key);
                    console.log(`⏰ Cache local: TTL expirado para motoristas próximos`);
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas do cache local:', error);
            return null;
        }
    }

    // Salvar dados de viagem no cache
    async setTripData(tripId, tripData) {
        try {
            const key = `trip:${tripId}`;
            const data = {
                ...tripData,
                timestamp: Date.now(),
                ttl: Date.now() + (30 * 60 * 1000) // 30 minutos para viagens
            };
            
            await AsyncStorage.setItem(key, JSON.stringify(data));
            console.log(`🚕 Cache local: Dados da viagem ${tripId} salvos`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar dados da viagem no cache:', error);
            return false;
        }
    }

    // Buscar dados de viagem do cache
    async getTripData(tripId) {
        try {
            const key = `trip:${tripId}`;
            const data = await AsyncStorage.getItem(key);
            
            if (data) {
                const trip = JSON.parse(data);
                if (trip.ttl > Date.now()) {
                    console.log(`🚕 Cache local: Dados da viagem ${tripId} encontrados`);
                    return trip;
                } else {
                    await AsyncStorage.removeItem(key);
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar dados da viagem do cache:', error);
            return null;
        }
    }

    // Limpar cache expirado
    async cleanExpiredCache() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const expiredKeys = [];
            
            for (const key of keys) {
                if (key.startsWith('location:') || key.startsWith('nearby_drivers:') || key.startsWith('trip:')) {
                    const data = await AsyncStorage.getItem(key);
                    if (data) {
                        const item = JSON.parse(data);
                        if (item.ttl && item.ttl < Date.now()) {
                            expiredKeys.push(key);
                        }
                    }
                }
            }
            
            if (expiredKeys.length > 0) {
                await AsyncStorage.multiRemove(expiredKeys);
                console.log(`🧹 Cache local: ${expiredKeys.length} itens expirados removidos`);
            }
            
            return expiredKeys.length;
        } catch (error) {
            console.error('❌ Erro ao limpar cache expirado:', error);
            return 0;
        }
    }

    // Obter estatísticas do cache
    async getCacheStats() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const cacheKeys = keys.filter(key => 
                key.startsWith('location:') || 
                key.startsWith('nearby_drivers:') || 
                key.startsWith('trip:')
            );
            
            let totalSize = 0;
            let expiredCount = 0;
            
            for (const key of cacheKeys) {
                const data = await AsyncStorage.getItem(key);
                if (data) {
                    totalSize += data.length;
                    const item = JSON.parse(data);
                    if (item.ttl && item.ttl < Date.now()) {
                        expiredCount++;
                    }
                }
            }
            
            return {
                totalItems: cacheKeys.length,
                expiredItems: expiredCount,
                totalSize: totalSize,
                sizeKB: (totalSize / 1024).toFixed(2)
            };
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas do cache:', error);
            return null;
        }
    }

    // Limpar todo o cache
    async clearAllCache() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const cacheKeys = keys.filter(key => 
                key.startsWith('location:') || 
                key.startsWith('nearby_drivers:') || 
                key.startsWith('trip:')
            );
            
            await AsyncStorage.multiRemove(cacheKeys);
            console.log(`🗑️ Cache local: ${cacheKeys.length} itens removidos`);
            return cacheKeys.length;
        } catch (error) {
            console.error('❌ Erro ao limpar cache:', error);
            return 0;
        }
    }
}

module.exports = LocalCacheService; 
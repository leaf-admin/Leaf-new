import Logger from '../utils/Logger';
// LocalCacheService.js - Cache local para otimização de performance
import AsyncStorage from '@react-native-async-storage/async-storage';

class LocalCacheService {
    constructor() {
        this.ttl = {
            location: 5 * 60 * 1000,      // 5 minutos
            nearbyDrivers: 5 * 60 * 1000,  // 5 minutos
            routes: 60 * 60 * 1000,        // 1 hora
            prices: 2 * 60 * 1000,         // 2 minutos
            tripData: 30 * 60 * 1000       // 30 minutos
        };
        this.maxCacheSize = 100; // Máximo de 100 itens no cache
    }

    // ===== CACHE DE ROTAS =====

    // Salvar rota no cache local
    async setRoute(startLoc, destLoc, waypoints, routeData) {
        try {
            const key = this.generateRouteKey(startLoc, destLoc, waypoints);
            const data = {
                routeData,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl.routes,
                accessCount: 1
            };

            await AsyncStorage.setItem(key, JSON.stringify(data));
            Logger.log(`🗺️ Cache local: Rota salva - ${startLoc} → ${destLoc}`);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar rota no cache local:', error);
            return false;
        }
    }

    // Buscar rota do cache local
    async getRoute(startLoc, destLoc, waypoints) {
        try {
            const key = this.generateRouteKey(startLoc, destLoc, waypoints);
            const data = await AsyncStorage.getItem(key);

            if (data) {
                const route = JSON.parse(data);
                if (route.ttl > Date.now()) {
                    // Atualizar contador de acesso
                    route.accessCount = (route.accessCount || 0) + 1;
                    await AsyncStorage.setItem(key, JSON.stringify(route));

                    Logger.log(`🗺️ Cache local: Rota encontrada - ${route.accessCount} acessos`);
                    return route.routeData;
                } else {
                    // TTL expirado, remover
                    await AsyncStorage.removeItem(key);
                    Logger.log(`⏰ Cache local: Rota expirada`);
                }
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar rota do cache local:', error);
            return null;
        }
    }

    // Gerar chave única para rota
    generateRouteKey(startLoc, destLoc, waypoints) {
        const routeParams = {
            start: startLoc,
            dest: destLoc,
            waypoints: waypoints || ''
        };

        // Hash simples para chave única
        const hash = JSON.stringify(routeParams).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);

        return `route:${Math.abs(hash)}`;
    }

    // ===== CACHE DE PREÇOS =====

    // Salvar preço no cache local
    async setPrice(startLoc, destLoc, waypoints, carType, priceData, routeData) {
        try {
            const key = this.generatePriceKey(startLoc, destLoc, waypoints, carType);
            const data = {
                priceData,
                routeData,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl.prices,
                validUntil: Date.now() + this.ttl.prices,
                accessCount: 1
            };

            await AsyncStorage.setItem(key, JSON.stringify(data));
            Logger.log(`💰 Cache local: Preço salvo - R$ ${priceData.totalFare} (${carType})`);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar preço no cache local:', error);
            return false;
        }
    }

    // Buscar preço do cache local
    async getPrice(startLoc, destLoc, waypoints, carType) {
        try {
            const key = this.generatePriceKey(startLoc, destLoc, waypoints, carType);
            const data = await AsyncStorage.getItem(key);

            if (data) {
                const price = JSON.parse(data);
                const timeRemaining = price.validUntil - Date.now();

                if (timeRemaining > 0) {
                    // Atualizar contador de acesso
                    price.accessCount = (price.accessCount || 0) + 1;
                    await AsyncStorage.setItem(key, JSON.stringify(price));

                    Logger.log(`💰 Cache local: Preço encontrado - válido por mais ${Math.round(timeRemaining / 1000)}s`);
                    return {
                        priceData: price.priceData,
                        routeData: price.routeData,
                        timeRemaining,
                        cacheHit: true
                    };
                } else {
                    // TTL expirado, remover
                    await AsyncStorage.removeItem(key);
                    Logger.log(`⏰ Cache local: Preço expirado`);
                }
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar preço do cache local:', error);
            return null;
        }
    }

    // Gerar chave única para preço
    generatePriceKey(startLoc, destLoc, waypoints, carType) {
        const priceParams = {
            start: startLoc,
            dest: destLoc,
            waypoints: waypoints || '',
            carType: carType || 'standard',
            // Arredondar para 2 minutos para agrupar requests próximos
            timeSlot: Math.floor(Date.now() / this.ttl.prices) * this.ttl.prices
        };

        // Hash simples para chave única
        const hash = JSON.stringify(priceParams).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);

        return `price:${Math.abs(hash)}`;
    }

    // ===== CACHE DE LOCALIZAÇÃO (EXISTENTE) =====

    // Salvar localização no cache local
    async setLocation(userId, location) {
        try {
            const key = `location:${userId}`;
            const data = {
                ...location,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl.location
            };

            await AsyncStorage.setItem(key, JSON.stringify(data));
            Logger.log(`📍 Cache local: Localização salva para usuário ${userId}`);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar localização no cache local:', error);
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
                    Logger.log(`📍 Cache local: Localização encontrada para usuário ${userId}`);
                    return location;
                } else {
                    // TTL expirado, remover
                    await AsyncStorage.removeItem(key);
                    Logger.log(`⏰ Cache local: TTL expirado para usuário ${userId}`);
                }
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar localização do cache local:', error);
            return null;
        }
    }

    // ===== CACHE DE MOTORISTAS PRÓXIMOS (EXISTENTE) =====

    // Salvar motoristas próximos no cache
    async setNearbyDrivers(lat, lng, radius, drivers) {
        try {
            const key = `nearby_drivers:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
            const data = {
                drivers,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl.nearbyDrivers
            };

            await AsyncStorage.setItem(key, JSON.stringify(data));
            Logger.log(`🚗 Cache local: ${drivers.length} motoristas salvos para área ${lat},${lng}`);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar motoristas no cache local:', error);
            return false;
        }
    }

    // Buscar motoristas próximos do cache
    async getNearbyDrivers(lat, lng, radius) {
        try {
            const key = `nearby_drivers:${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
            const data = await AsyncStorage.getItem(key);

            if (data) {
                const drivers = JSON.parse(data);
                if (drivers.ttl > Date.now()) {
                    Logger.log(`🚗 Cache local: ${drivers.drivers.length} motoristas encontrados`);
                    return drivers.drivers;
                } else {
                    await AsyncStorage.removeItem(key);
                }
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar motoristas do cache local:', error);
            return null;
        }
    }

    // ===== CACHE DE DADOS DE VIAGEM (EXISTENTE) =====

    // Salvar dados de viagem no cache
    async setTripData(tripId, tripData) {
        try {
            const key = `trip:${tripId}`;
            const data = {
                ...tripData,
                timestamp: Date.now(),
                ttl: Date.now() + this.ttl.tripData
            };

            await AsyncStorage.setItem(key, JSON.stringify(data));
            Logger.log(`🚕 Cache local: Dados da viagem ${tripId} salvos`);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar dados da viagem no cache:', error);
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
                    Logger.log(`🚕 Cache local: Dados da viagem ${tripId} encontrados`);
                    return trip;
                } else {
                    await AsyncStorage.removeItem(key);
                }
            }

            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar dados da viagem do cache:', error);
            return null;
        }
    }

    // ===== LIMPEZA E ESTATÍSTICAS =====

    // Limpar cache expirado
    async cleanExpiredCache() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const expiredKeys = [];

            for (const key of keys) {
                if (key.startsWith('location:') || key.startsWith('nearby_drivers:') ||
                    key.startsWith('trip:') || key.startsWith('route:') || key.startsWith('price:')) {
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
                Logger.log(`🧹 Cache local: ${expiredKeys.length} itens expirados removidos`);
            }

            return expiredKeys.length;
        } catch (error) {
            Logger.error('❌ Erro ao limpar cache expirado:', error);
            return 0;
        }
    }

    // Obter estatísticas do cache
    async getCacheStats() {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const stats = {
                total: 0,
                routes: 0,
                prices: 0,
                locations: 0,
                nearbyDrivers: 0,
                trips: 0,
                expired: 0
            };

            for (const key of keys) {
                if (key.startsWith('route:')) stats.routes++;
                else if (key.startsWith('price:')) stats.prices++;
                else if (key.startsWith('location:')) stats.locations++;
                else if (key.startsWith('nearby_drivers:')) stats.nearbyDrivers++;
                else if (key.startsWith('trip:')) stats.trips++;

                stats.total++;
            }

            Logger.log(`📊 Cache local: ${stats.total} itens totais`);
            return stats;
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas do cache:', error);
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
                key.startsWith('trip:') ||
                key.startsWith('route:') ||
                key.startsWith('price:')
            );

            await AsyncStorage.multiRemove(cacheKeys);
            Logger.log(`🗑️ Cache local: ${cacheKeys.length} itens removidos`);
            return cacheKeys.length;
        } catch (error) {
            Logger.error('❌ Erro ao limpar cache:', error);
            return 0;
        }
    }

    // ===== MÉTODOS DE UTILIDADE =====

    // Verificar se cache está disponível
    isAvailable() {
        return true; // Sempre disponível no mobile
    }

    // Obter TTL restante
    getTimeRemaining(key) {
        // Implementar lógica para calcular tempo restante
        return 0;
    }

    // ===== MÉTODOS GENÉRICOS (Substitutos diretos do AsyncStorage) =====

    /**
     * Obter item genérico do cache
     */
    async getItem(key) {
        try {
            return await AsyncStorage.getItem(key);
        } catch (error) {
            Logger.error(`❌ Erro ao buscar item ${key} do cache:`, error);
            return null;
        }
    }

    /**
     * Salvar item genérico no cache
     */
    async setItem(key, value) {
        try {
            await AsyncStorage.setItem(key, value);
            return true;
        } catch (error) {
            Logger.error(`❌ Erro ao salvar item ${key} no cache:`, error);
            return false;
        }
    }

    /**
     * Salvar múltiplos itens genéricos no cache
     */
    async multiSet(keyValuePairs) {
        try {
            await AsyncStorage.multiSet(keyValuePairs);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao salvar múltiplos itens no cache:', error);
            return false;
        }
    }

    /**
     * Remover item genérico do cache
     */
    async removeItem(key) {
        try {
            await AsyncStorage.removeItem(key);
            return true;
        } catch (error) {
            Logger.error(`❌ Erro ao remover item ${key} do cache:`, error);
            return false;
        }
    }

    /**
     * Remover múltiplos itens genéricos do cache
     */
    async multiRemove(keys) {
        try {
            await AsyncStorage.multiRemove(keys);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao remover múltiplos itens do cache:', error);
            return false;
        }
    }

    /**
     * Obter todas as chaves do cache genérico
     */
    async getAllKeys() {
        try {
            return await AsyncStorage.getAllKeys();
        } catch (error) {
            Logger.error('❌ Erro ao obter todas as chaves do cache:', error);
            return [];
        }
    }

    // Forçar limpeza de cache
    async forceCleanup() {
        Logger.log('🧹 Cache local: Forçando limpeza...');
        return await this.cleanExpiredCache();
    }
}

// Instância singleton
const localCacheService = new LocalCacheService();

export default localCacheService; 
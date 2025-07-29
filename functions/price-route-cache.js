// Price Route Cache Service - Cache de 2 minutos para preços e rotas
// Evita recálculos desnecessários quando passageiro consulta preço

const admin = require('firebase-admin');

// Inicializar Firebase Admin se não estiver inicializado
try {
    if (!admin.apps.length) {
        admin.initializeApp();
    }
} catch (error) {
    // App já inicializado, continuar
}

const crypto = require('crypto');

class PriceRouteCacheService {
    constructor() {
        this.db = admin.database();
        this.cacheTTL = 120000; // 2 minutos em millisegundos
        this.maxCacheSize = 500; // Máximo de caches
    }

    /**
     * Gera chave única para cache de preço/rota
     */
    generatePriceCacheKey(startLoc, destLoc, waypoints = null, carType = null) {
        const priceParams = {
            start: startLoc,
            dest: destLoc,
            waypoints: waypoints || '',
            carType: carType || 'standard',
            timestamp: Math.floor(Date.now() / this.cacheTTL) * this.cacheTTL // Arredonda para 2 minutos
        };
        
        const hash = crypto.createHash('md5')
            .update(JSON.stringify(priceParams))
            .digest('hex');
            
        return `price_cache:${hash}`;
    }

    /**
     * Salva preço/rota no cache
     */
    async savePriceToCache(startLoc, destLoc, waypoints, carType, priceData, routeData) {
        try {
            const cacheKey = this.generatePriceCacheKey(startLoc, destLoc, waypoints, carType);
            const cacheData = {
                priceData: priceData,
                routeData: routeData,
                timestamp: Date.now(),
                accessCount: 1,
                lastAccessed: Date.now(),
                expiresAt: Date.now() + this.cacheTTL
            };

            await this.db.ref(`price_cache/${cacheKey}`).set(cacheData);
            
            console.log(`💰 Price Cache: Preço/rota salvo no cache (${cacheKey}) - Válido por 2 minutos`);
            
            // Limpar cache antigo se necessário
            await this.cleanupOldCache();
            
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar preço no cache:', error);
            return false;
        }
    }

    /**
     * Busca preço/rota no cache
     */
    async getPriceFromCache(startLoc, destLoc, waypoints = null, carType = null) {
        try {
            const cacheKey = this.generatePriceCacheKey(startLoc, destLoc, waypoints, carType);
            const snapshot = await this.db.ref(`price_cache/${cacheKey}`).once('value');
            const cachedData = snapshot.val();

            if (!cachedData) {
                console.log(`💰 Price Cache: Preço não encontrado no cache (${cacheKey})`);
                return null;
            }

            // Verificar se o cache ainda é válido (2 minutos)
            const isExpired = (Date.now() - cachedData.timestamp) > this.cacheTTL;
            if (isExpired) {
                console.log(`💰 Price Cache: Preço expirado no cache (${cacheKey})`);
                await this.removeFromCache(cacheKey);
                return null;
            }

            // Verificar se ainda está dentro dos 2 minutos
            const timeRemaining = cachedData.expiresAt - Date.now();
            if (timeRemaining <= 0) {
                console.log(`💰 Price Cache: Preço expirado (${cacheKey})`);
                await this.removeFromCache(cacheKey);
                return null;
            }

            // Atualizar estatísticas de acesso
            await this.updateCacheStats(cacheKey, cachedData);
            
            console.log(`💰 Price Cache: Preço encontrado no cache (${cacheKey}) - ${Math.round(timeRemaining/1000)}s restantes`);
            
            return {
                priceData: cachedData.priceData,
                routeData: cachedData.routeData,
                timeRemaining: timeRemaining,
                cacheHit: true
            };
        } catch (error) {
            console.error('❌ Erro ao buscar preço no cache:', error);
            return null;
        }
    }

    /**
     * Atualiza estatísticas de acesso do cache
     */
    async updateCacheStats(cacheKey, cachedData) {
        try {
            const updatedData = {
                ...cachedData,
                accessCount: (cachedData.accessCount || 0) + 1,
                lastAccessed: Date.now()
            };
            
            await this.db.ref(`price_cache/${cacheKey}`).update(updatedData);
        } catch (error) {
            console.error('❌ Erro ao atualizar estatísticas do cache:', error);
        }
    }

    /**
     * Remove preço do cache
     */
    async removeFromCache(cacheKey) {
        try {
            await this.db.ref(`price_cache/${cacheKey}`).remove();
            console.log(`💰 Price Cache: Preço removido do cache (${cacheKey})`);
        } catch (error) {
            console.error('❌ Erro ao remover preço do cache:', error);
        }
    }

    /**
     * Limpa cache antigo
     */
    async cleanupOldCache() {
        try {
            const snapshot = await this.db.ref('price_cache').once('value');
            const cacheData = snapshot.val();

            if (!cacheData) return;

            const now = Date.now();
            const keysToRemove = [];

            // Encontrar preços expirados
            Object.keys(cacheData).forEach(key => {
                const priceData = cacheData[key];
                if ((now - priceData.timestamp) > this.cacheTTL) {
                    keysToRemove.push(key);
                }
            });

            // Remover preços expirados
            for (const key of keysToRemove) {
                await this.db.ref(`price_cache/${key}`).remove();
            }

            if (keysToRemove.length > 0) {
                console.log(`💰 Price Cache: ${keysToRemove.length} preços expirados removidos`);
            }

            // Se ainda há muitos caches, remover os menos acessados
            const remainingKeys = Object.keys(cacheData).filter(key => !keysToRemove.includes(key));
            if (remainingKeys.length > this.maxCacheSize) {
                const sortedKeys = remainingKeys.sort((a, b) => {
                    const accessCountA = cacheData[a].accessCount || 0;
                    const accessCountB = cacheData[b].accessCount || 0;
                    return accessCountA - accessCountB;
                });

                const keysToRemoveForSize = sortedKeys.slice(0, remainingKeys.length - this.maxCacheSize);
                for (const key of keysToRemoveForSize) {
                    await this.db.ref(`price_cache/${key}`).remove();
                }

                console.log(`💰 Price Cache: ${keysToRemoveForSize.length} preços menos acessados removidos`);
            }
        } catch (error) {
            console.error('❌ Erro ao limpar cache antigo:', error);
        }
    }

    /**
     * Obtém estatísticas do cache de preços
     */
    async getPriceCacheStats() {
        try {
            const snapshot = await this.db.ref('price_cache').once('value');
            const cacheData = snapshot.val();

            if (!cacheData) {
                return {
                    totalPrices: 0,
                    totalAccesses: 0,
                    averageAccesses: 0,
                    oldestPrice: null,
                    newestPrice: null,
                    activePrices: 0
                };
            }

            const prices = Object.values(cacheData);
            const totalPrices = prices.length;
            const totalAccesses = prices.reduce((sum, price) => sum + (price.accessCount || 0), 0);
            const averageAccesses = totalPrices > 0 ? totalAccesses / totalPrices : 0;

            // Contar preços ativos (não expirados)
            const now = Date.now();
            const activePrices = prices.filter(price => (now - price.timestamp) <= this.cacheTTL).length;

            const timestamps = prices.map(price => price.timestamp);
            const oldestPrice = Math.min(...timestamps);
            const newestPrice = Math.max(...timestamps);

            return {
                totalPrices,
                totalAccesses,
                averageAccesses: Math.round(averageAccesses * 100) / 100,
                oldestPrice: new Date(oldestPrice).toISOString(),
                newestPrice: new Date(newestPrice).toISOString(),
                activePrices,
                cacheHitRate: this.calculatePriceCacheHitRate()
            };
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas do cache de preços:', error);
            return null;
        }
    }

    /**
     * Calcula taxa de acerto do cache de preços
     */
    calculatePriceCacheHitRate() {
        // Implementar lógica para calcular taxa de acerto
        // Por enquanto, retorna valor estimado
        return 0.80; // 80% de taxa de acerto estimada
    }

    /**
     * Wrapper para getDirectionsApi com cache de preço
     */
    async getDirectionsWithPriceCache(startLoc, destLoc, waypoints, carType, originalApiCall) {
        try {
            // Tentar buscar no cache primeiro
            const cachedPrice = await this.getPriceFromCache(startLoc, destLoc, waypoints, carType);
            
            if (cachedPrice) {
                console.log(`💰 Price Cache: REUTILIZANDO preço/rota do cache - válido por mais ${Math.round(cachedPrice.timeRemaining/1000)}s`);
                return cachedPrice;
            }

            // Se não encontrou no cache, fazer request original
            console.log(`💰 Price Cache: Preço não encontrado no cache, calculando novo preço/rota`);
            const routeData = await originalApiCall(startLoc, destLoc, waypoints);
            
            // Calcular preço baseado na rota
            const priceData = this.calculatePriceFromRoute(routeData, carType);
            
            // Salvar no cache para reutilização por 2 minutos
            await this.savePriceToCache(startLoc, destLoc, waypoints, carType, priceData, routeData);
            
            return {
                priceData: priceData,
                routeData: routeData,
                timeRemaining: this.cacheTTL,
                cacheHit: false
            };
        } catch (error) {
            console.error('❌ Erro no getDirectionsWithPriceCache:', error);
            // Em caso de erro, tentar request original sem cache
            const routeData = await originalApiCall(startLoc, destLoc, waypoints);
            const priceData = this.calculatePriceFromRoute(routeData, carType);
            
            return {
                priceData: priceData,
                routeData: routeData,
                timeRemaining: 0,
                cacheHit: false
            };
        }
    }

    /**
     * Calcula preço baseado na rota
     */
    calculatePriceFromRoute(routeData, carType = 'standard') {
        const distance = routeData.distance_in_km || 0;
        const time = routeData.time_in_secs || 0;
        
        // Regras de preço do Leaf
        const baseFare = 5.00;
        const ratePerKm = 2.50;
        const ratePerHour = 30.00;
        
        const distanceCost = distance * ratePerKm;
        const timeCost = (time / 3600) * ratePerHour;
        const totalFare = baseFare + distanceCost + timeCost;
        
        // Aplicar multiplicador por tipo de carro
        const carMultipliers = {
            'standard': 1.0,
            'premium': 1.5,
            'luxury': 2.0
        };
        
        const multiplier = carMultipliers[carType] || 1.0;
        const finalFare = totalFare * multiplier;
        
        return {
            baseFare: baseFare,
            distanceCost: distanceCost,
            timeCost: timeCost,
            totalFare: finalFare,
            distance: distance,
            time: time,
            carType: carType,
            multiplier: multiplier
        };
    }
}

// Instância singleton
const priceRouteCacheService = new PriceRouteCacheService();

module.exports = priceRouteCacheService; 
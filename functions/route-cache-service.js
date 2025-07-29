// Route Cache Service - Reutilização de rotas calculadas
// Evita requests duplicados do Google Maps API

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

class RouteCacheService {
    constructor() {
        this.db = admin.database();
        this.cacheTTL = 3600000; // 1 hora em millisegundos
        this.maxCacheSize = 1000; // Máximo de rotas em cache
    }

    /**
     * Gera chave única para cache baseada nos parâmetros da rota
     */
    generateCacheKey(startLoc, destLoc, waypoints = null) {
        const routeParams = {
            start: startLoc,
            dest: destLoc,
            waypoints: waypoints || ''
        };
        
        const hash = crypto.createHash('md5')
            .update(JSON.stringify(routeParams))
            .digest('hex');
            
        return `route_cache:${hash}`;
    }

    /**
     * Salva rota no cache
     */
    async saveRouteToCache(startLoc, destLoc, waypoints, routeData) {
        try {
            const cacheKey = this.generateCacheKey(startLoc, destLoc, waypoints);
            const cacheData = {
                routeData: routeData,
                timestamp: Date.now(),
                accessCount: 1,
                lastAccessed: Date.now()
            };

            await this.db.ref(`route_cache/${cacheKey}`).set(cacheData);
            
            console.log(`🗺️ Route Cache: Rota salva no cache (${cacheKey})`);
            
            // Limpar cache antigo se necessário
            await this.cleanupOldCache();
            
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar rota no cache:', error);
            return false;
        }
    }

    /**
     * Busca rota no cache
     */
    async getRouteFromCache(startLoc, destLoc, waypoints = null) {
        try {
            const cacheKey = this.generateCacheKey(startLoc, destLoc, waypoints);
            const snapshot = await this.db.ref(`route_cache/${cacheKey}`).once('value');
            const cachedData = snapshot.val();

            if (!cachedData) {
                console.log(`🗺️ Route Cache: Rota não encontrada no cache (${cacheKey})`);
                return null;
            }

            // Verificar se o cache ainda é válido
            const isExpired = (Date.now() - cachedData.timestamp) > this.cacheTTL;
            if (isExpired) {
                console.log(`🗺️ Route Cache: Rota expirada no cache (${cacheKey})`);
                await this.removeFromCache(cacheKey);
                return null;
            }

            // Atualizar estatísticas de acesso
            await this.updateCacheStats(cacheKey, cachedData);
            
            console.log(`🗺️ Route Cache: Rota encontrada no cache (${cacheKey}) - ${cachedData.accessCount} acessos`);
            
            return cachedData.routeData;
        } catch (error) {
            console.error('❌ Erro ao buscar rota no cache:', error);
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
            
            await this.db.ref(`route_cache/${cacheKey}`).update(updatedData);
        } catch (error) {
            console.error('❌ Erro ao atualizar estatísticas do cache:', error);
        }
    }

    /**
     * Remove rota do cache
     */
    async removeFromCache(cacheKey) {
        try {
            await this.db.ref(`route_cache/${cacheKey}`).remove();
            console.log(`🗺️ Route Cache: Rota removida do cache (${cacheKey})`);
        } catch (error) {
            console.error('❌ Erro ao remover rota do cache:', error);
        }
    }

    /**
     * Limpa cache antigo
     */
    async cleanupOldCache() {
        try {
            const snapshot = await this.db.ref('route_cache').once('value');
            const cacheData = snapshot.val();

            if (!cacheData) return;

            const now = Date.now();
            const keysToRemove = [];

            // Encontrar rotas expiradas
            Object.keys(cacheData).forEach(key => {
                const routeData = cacheData[key];
                if ((now - routeData.timestamp) > this.cacheTTL) {
                    keysToRemove.push(key);
                }
            });

            // Remover rotas expiradas
            for (const key of keysToRemove) {
                await this.db.ref(`route_cache/${key}`).remove();
            }

            if (keysToRemove.length > 0) {
                console.log(`🗺️ Route Cache: ${keysToRemove.length} rotas expiradas removidas`);
            }

            // Se ainda há muitas rotas, remover as menos acessadas
            const remainingKeys = Object.keys(cacheData).filter(key => !keysToRemove.includes(key));
            if (remainingKeys.length > this.maxCacheSize) {
                const sortedKeys = remainingKeys.sort((a, b) => {
                    const accessCountA = cacheData[a].accessCount || 0;
                    const accessCountB = cacheData[b].accessCount || 0;
                    return accessCountA - accessCountB;
                });

                const keysToRemoveForSize = sortedKeys.slice(0, remainingKeys.length - this.maxCacheSize);
                for (const key of keysToRemoveForSize) {
                    await this.db.ref(`route_cache/${key}`).remove();
                }

                console.log(`🗺️ Route Cache: ${keysToRemoveForSize.length} rotas menos acessadas removidas`);
            }
        } catch (error) {
            console.error('❌ Erro ao limpar cache antigo:', error);
        }
    }

    /**
     * Obtém estatísticas do cache
     */
    async getCacheStats() {
        try {
            const snapshot = await this.db.ref('route_cache').once('value');
            const cacheData = snapshot.val();

            if (!cacheData) {
                return {
                    totalRoutes: 0,
                    totalAccesses: 0,
                    averageAccesses: 0,
                    oldestRoute: null,
                    newestRoute: null
                };
            }

            const routes = Object.values(cacheData);
            const totalRoutes = routes.length;
            const totalAccesses = routes.reduce((sum, route) => sum + (route.accessCount || 0), 0);
            const averageAccesses = totalRoutes > 0 ? totalAccesses / totalRoutes : 0;

            const timestamps = routes.map(route => route.timestamp);
            const oldestRoute = Math.min(...timestamps);
            const newestRoute = Math.max(...timestamps);

            return {
                totalRoutes,
                totalAccesses,
                averageAccesses: Math.round(averageAccesses * 100) / 100,
                oldestRoute: new Date(oldestRoute).toISOString(),
                newestRoute: new Date(newestRoute).toISOString(),
                cacheHitRate: this.calculateCacheHitRate()
            };
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas do cache:', error);
            return null;
        }
    }

    /**
     * Calcula taxa de acerto do cache
     */
    calculateCacheHitRate() {
        // Implementar lógica para calcular taxa de acerto
        // Por enquanto, retorna valor estimado
        return 0.75; // 75% de taxa de acerto estimada
    }

    /**
     * Wrapper para getDirectionsApi com cache
     */
    async getDirectionsWithCache(startLoc, destLoc, waypoints, originalApiCall) {
        try {
            // Tentar buscar no cache primeiro
            const cachedRoute = await this.getRouteFromCache(startLoc, destLoc, waypoints);
            
            if (cachedRoute) {
                console.log(`🗺️ Route Cache: REUTILIZANDO rota do cache - economia de 1 request Google Maps`);
                return cachedRoute;
            }

            // Se não encontrou no cache, fazer request original
            console.log(`🗺️ Route Cache: Rota não encontrada no cache, fazendo request Google Maps`);
            const routeData = await originalApiCall(startLoc, destLoc, waypoints);
            
            // Salvar no cache para reutilização futura
            await this.saveRouteToCache(startLoc, destLoc, waypoints, routeData);
            
            return routeData;
        } catch (error) {
            console.error('❌ Erro no getDirectionsWithCache:', error);
            // Em caso de erro, tentar request original sem cache
            return await originalApiCall(startLoc, destLoc, waypoints);
        }
    }
}

// Instância singleton
const routeCacheService = new RouteCacheService();

module.exports = routeCacheService; 
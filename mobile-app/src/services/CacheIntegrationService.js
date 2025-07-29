// CacheIntegrationService.js - Integração de cache local + servidor
const localCacheService = require('./LocalCacheService');

// Mock da API para teste
const mockApi = {
    googleapi: async (requestBody) => {
        // Simular resposta da API
        if (requestBody.calltype === 'direction') {
            const distance = 5.2;
            const time = 1200;
            
            if (requestBody.price_estimate) {
                // Simular resposta de preço
                const baseFare = 5.00;
                const distanceCost = distance * 2.50;
                const timeCost = (time / 3600) * 30.00;
                const totalFare = baseFare + distanceCost + timeCost;
                
                const carMultipliers = {
                    'standard': 1.0,
                    'premium': 1.5,
                    'luxury': 2.0
                };
                
                const multiplier = carMultipliers[requestBody.car_type] || 1.0;
                const finalFare = totalFare * multiplier;
                
                return {
                    priceData: {
                        baseFare: baseFare,
                        distanceCost: distanceCost,
                        timeCost: timeCost,
                        totalFare: finalFare,
                        distance: distance,
                        time: time,
                        carType: requestBody.car_type,
                        multiplier: multiplier
                    },
                    routeData: {
                        distance_in_km: distance,
                        time_in_secs: time,
                        polyline: 'mock_polyline',
                        steps: []
                    }
                };
            } else {
                // Simular resposta de rota
                return {
                    distance_in_km: distance,
                    time_in_secs: time,
                    polyline: 'mock_polyline',
                    steps: []
                };
            }
        }
        return null;
    }
};

class CacheIntegrationService {
    constructor() {
        this.localCache = localCacheService;
        this.api = mockApi;
        this.isOnline = true;
        this.fallbackMode = false;
    }

    // ===== CACHE DE ROTAS INTEGRADO =====
    
    // Buscar rota com cache integrado
    async getRouteWithCache(startLoc, destLoc, waypoints) {
        try {
            console.log('🗺️ Cache Integration: Buscando rota...');
            
            // 1. Tentar cache local primeiro
            const localRoute = await this.localCache.getRoute(startLoc, destLoc, waypoints);
            if (localRoute) {
                console.log('🗺️ Cache Integration: Rota encontrada no cache local');
                return {
                    ...localRoute,
                    source: 'local_cache',
                    cacheHit: true
                };
            }

            // 2. Se não encontrou no local, tentar servidor
            if (this.isOnline) {
                console.log('🗺️ Cache Integration: Buscando rota no servidor...');
                const serverResponse = await this.makeDirectionsRequest(startLoc, destLoc, waypoints);
                
                if (serverResponse && serverResponse.distance_in_km) {
                    // Salvar no cache local para uso futuro
                    await this.localCache.setRoute(startLoc, destLoc, waypoints, serverResponse);
                    
                    console.log('🗺️ Cache Integration: Rota obtida do servidor e salva no cache local');
                    return {
                        ...serverResponse,
                        source: 'server_cache',
                        cacheHit: false
                    };
                }
            }

            // 3. Fallback: usar dados mock se tudo falhar
            console.log('🗺️ Cache Integration: Usando fallback para rota');
            return this.getMockRouteData(startLoc, destLoc);
            
        } catch (error) {
            console.error('❌ Erro no getRouteWithCache:', error);
            return this.getMockRouteData(startLoc, destLoc);
        }
    }

    // ===== CACHE DE PREÇOS INTEGRADO =====
    
    // Buscar preço com cache integrado
    async getPriceWithCache(startLoc, destLoc, waypoints, carType = 'standard') {
        try {
            console.log('💰 Cache Integration: Buscando preço...');
            
            // 1. Tentar cache local primeiro
            const localPrice = await this.localCache.getPrice(startLoc, destLoc, waypoints, carType);
            if (localPrice) {
                console.log('💰 Cache Integration: Preço encontrado no cache local');
                return {
                    ...localPrice,
                    source: 'local_cache',
                    cacheHit: true
                };
            }

            // 2. Se não encontrou no local, tentar servidor
            if (this.isOnline) {
                console.log('💰 Cache Integration: Buscando preço no servidor...');
                const serverResponse = await this.makePriceRequest(startLoc, destLoc, waypoints, carType);
                
                if (serverResponse && serverResponse.priceData) {
                    // Salvar no cache local para uso futuro
                    await this.localCache.setPrice(
                        startLoc, destLoc, waypoints, carType,
                        serverResponse.priceData, serverResponse.routeData
                    );
                    
                    console.log('💰 Cache Integration: Preço obtido do servidor e salvo no cache local');
                    return {
                        ...serverResponse,
                        source: 'server_cache',
                        cacheHit: false
                    };
                }
            }

            // 3. Fallback: calcular preço localmente
            console.log('💰 Cache Integration: Calculando preço localmente');
            return this.calculateLocalPrice(startLoc, destLoc, carType);
            
        } catch (error) {
            console.error('❌ Erro no getPriceWithCache:', error);
            return this.calculateLocalPrice(startLoc, destLoc, carType);
        }
    }

    // ===== REQUESTS PARA SERVIDOR =====
    
    // Fazer request de directions para servidor
    async makeDirectionsRequest(startLoc, destLoc, waypoints) {
        try {
            const requestBody = {
                start: startLoc,
                dest: destLoc,
                calltype: 'direction',
                departure_time: 'now'
            };

            if (waypoints) {
                requestBody.waypoints = waypoints;
            }

            const response = await this.api.googleapi(requestBody);
            
            if (response && response.distance_in_km) {
                console.log(`🗺️ Server Request: Rota obtida - ${response.distance_in_km}km`);
                return response;
            }
            
            return null;
        } catch (error) {
            console.error('❌ Erro na request de directions:', error);
            return null;
        }
    }

    // Fazer request de preço para servidor
    async makePriceRequest(startLoc, destLoc, waypoints, carType) {
        try {
            const requestBody = {
                start: startLoc,
                dest: destLoc,
                calltype: 'direction',
                price_estimate: true,
                car_type: carType,
                departure_time: 'now'
            };

            if (waypoints) {
                requestBody.waypoints = waypoints;
            }

            const response = await this.api.googleapi(requestBody);
            
            if (response && response.priceData) {
                console.log(`💰 Server Request: Preço obtido - R$ ${response.priceData.totalFare}`);
                return response;
            }
            
            return null;
        } catch (error) {
            console.error('❌ Erro na request de preço:', error);
            return null;
        }
    }

    // ===== FALLBACKS E MOCKS =====
    
    // Dados mock para rota
    getMockRouteData(startLoc, destLoc) {
        // Calcular distância aproximada baseada nas coordenadas
        const distance = this.calculateDistance(startLoc, destLoc);
        const time = distance * 120; // ~2 minutos por km
        
        return {
            distance_in_km: distance,
            time_in_secs: time,
            polyline: 'mock_polyline',
            steps: [],
            source: 'mock_data',
            cacheHit: false
        };
    }

    // Calcular preço localmente
    calculateLocalPrice(startLoc, destLoc, carType) {
        const distance = this.calculateDistance(startLoc, destLoc);
        const time = distance * 120; // ~2 minutos por km
        
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
            priceData: {
                baseFare: baseFare,
                distanceCost: distanceCost,
                timeCost: timeCost,
                totalFare: finalFare,
                distance: distance,
                time: time,
                carType: carType,
                multiplier: multiplier
            },
            routeData: {
                distance_in_km: distance,
                time_in_secs: time
            },
            source: 'local_calculation',
            cacheHit: false
        };
    }

    // Calcular distância entre duas coordenadas
    calculateDistance(startLoc, destLoc) {
        try {
            const [startLat, startLng] = startLoc.split(',').map(Number);
            const [destLat, destLng] = destLoc.split(',').map(Number);
            
            // Fórmula de Haversine para calcular distância
            const R = 6371; // Raio da Terra em km
            const dLat = (destLat - startLat) * Math.PI / 180;
            const dLng = (destLng - startLng) * Math.PI / 180;
            
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                     Math.cos(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
                     Math.sin(dLng/2) * Math.sin(dLng/2);
            
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;
            
            return Math.max(distance, 0.5); // Mínimo 0.5km
        } catch (error) {
            console.error('❌ Erro ao calcular distância:', error);
            return 5.0; // Distância padrão
        }
    }

    // ===== MONITORAMENTO E ESTATÍSTICAS =====
    
    // Obter estatísticas de cache
    async getCacheStats() {
        try {
            const localStats = await this.localCache.getCacheStats();
            
            return {
                local: localStats,
                online: this.isOnline,
                fallbackMode: this.fallbackMode,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error);
            return null;
        }
    }

    // Verificar conectividade
    async checkConnectivity() {
        try {
            // Teste simples de conectividade
            const testResponse = await this.api.googleapi({
                start: '-23.5505,-46.6333',
                dest: '-23.5506,-46.6334',
                calltype: 'direction'
            });
            
            this.isOnline = !!testResponse;
            console.log(`🌐 Cache Integration: Online = ${this.isOnline}`);
            return this.isOnline;
        } catch (error) {
            console.log('🌐 Cache Integration: Offline detectado');
            this.isOnline = false;
            return false;
        }
    }

    // Limpar todos os caches
    async clearAllCaches() {
        try {
            const localCleared = await this.localCache.clearAllCache();
            console.log(`🧹 Cache Integration: ${localCleared} itens removidos do cache local`);
            return localCleared;
        } catch (error) {
            console.error('❌ Erro ao limpar caches:', error);
            return 0;
        }
    }

    // ===== MÉTODOS DE UTILIDADE =====
    
    // Verificar se cache está disponível
    isCacheAvailable() {
        return this.localCache.isAvailable();
    }

    // Ativar modo fallback
    enableFallbackMode() {
        this.fallbackMode = true;
        console.log('🔄 Cache Integration: Modo fallback ativado');
    }

    // Desativar modo fallback
    disableFallbackMode() {
        this.fallbackMode = false;
        console.log('🔄 Cache Integration: Modo fallback desativado');
    }

    // Obter informações de debug
    getDebugInfo() {
        return {
            isOnline: this.isOnline,
            fallbackMode: this.fallbackMode,
            cacheAvailable: this.isCacheAvailable(),
            timestamp: Date.now()
        };
    }
}

// Instância singleton
const cacheIntegrationService = new CacheIntegrationService();

module.exports = cacheIntegrationService; 
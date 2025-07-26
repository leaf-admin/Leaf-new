// HybridMapsService.js - Serviço híbrido Google Maps + OpenStreetMap para otimização de custos
// Mock para testes Node.js
const { costMonitoringService } = require('./CostMonitoringService.js');

class HybridMapsService {
    constructor() {
        this.costMonitoring = costMonitoringService;
        this.cache = new Map();
        this.cacheTTL = 3600000; // 1 hora em ms
        
        // Configurações dos provedores
        this.providers = {
            google: {
                apiKey: process.env.GOOGLE_MAPS_API_KEY || 'mock-key',
                baseUrl: 'https://maps.googleapis.com/maps/api',
                pricing: {
                    geocoding: 0.025,
                    places: 0.017,
                    directions: 0.025
                }
            },
            osm: {
                baseUrl: 'https://nominatim.openstreetmap.org',
                userAgent: 'LeafApp/1.0',
                pricing: {
                    geocoding: 0,
                    directions: 0,
                    reverse: 0
                }
            }
        };
    }

    // ===== GEOCODING HÍBRIDO =====
    async geocode(address) {
        const cacheKey = `geocode:${address}`;
        
        // Verificar cache primeiro
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                console.log(`🗺️ Geocoding cache hit: ${address}`);
                return cached.data;
            }
        }

        try {
            // Usar Google Maps para geocoding (melhor precisão)
            const result = await this._googleGeocode(address);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            // Monitorar custo
            await this.costMonitoring.trackGoogleMapsCost('geocoding', 1);
            
            console.log(`🗺️ Google Geocoding: ${address} → ${result.lat}, ${result.lng}`);
            return result;
            
        } catch (error) {
            console.warn(`⚠️ Google Geocoding failed, trying OSM: ${error.message}`);
            
            // Fallback para OpenStreetMap
            const result = await this._osmGeocode(address);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            console.log(`🗺️ OSM Geocoding (fallback): ${address} → ${result.lat}, ${result.lng}`);
            return result;
        }
    }

    // ===== DIRECTIONS HÍBRIDO =====
    async getDirections(origin, destination, mode = 'driving') {
        const cacheKey = `directions:${origin.lat},${origin.lng}:${destination.lat},${destination.lng}:${mode}`;
        
        // Verificar cache primeiro
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                console.log(`🗺️ Directions cache hit: ${origin} → ${destination}`);
                return cached.data;
            }
        }

        try {
            // Usar OpenStreetMap para directions (gratuito)
            const result = await this._osmDirections(origin, destination, mode);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            console.log(`🗺️ OSM Directions: ${origin} → ${destination} (${result.distance}km, ${result.duration}min)`);
            return result;
            
        } catch (error) {
            console.warn(`⚠️ OSM Directions failed, trying Google: ${error.message}`);
            
            // Fallback para Google Maps
            const result = await this._googleDirections(origin, destination, mode);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            // Monitorar custo
            await this.costMonitoring.trackGoogleMapsCost('directions', 1);
            
            console.log(`🗺️ Google Directions (fallback): ${origin} → ${destination}`);
            return result;
        }
    }

    // ===== PLACES API (APENAS GOOGLE) =====
    async searchPlaces(query, location, radius = 5000) {
        const cacheKey = `places:${query}:${location.lat},${location.lng}:${radius}`;
        
        // Verificar cache primeiro
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                console.log(`🗺️ Places cache hit: ${query}`);
                return cached.data;
            }
        }

        try {
            // Usar Google Places API (dados ricos)
            const result = await this._googlePlaces(query, location, radius);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            // Monitorar custo
            await this.costMonitoring.trackGoogleMapsCost('places', 1);
            
            console.log(`🗺️ Google Places: ${query} → ${result.length} resultados`);
            return result;
            
        } catch (error) {
            console.error(`❌ Google Places failed: ${error.message}`);
            return [];
        }
    }

    // ===== REVERSE GEOCODING (APENAS OSM) =====
    async reverseGeocode(lat, lng) {
        const cacheKey = `reverse:${lat},${lng}`;
        
        // Verificar cache primeiro
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.data;
            }
        }

        try {
            // Usar OpenStreetMap (gratuito)
            const result = await this._osmReverseGeocode(lat, lng);
            
            // Cache do resultado
            this.cache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            console.log(`🗺️ OSM Reverse Geocoding: ${lat}, ${lng} → ${result.address}`);
            return result;
            
        } catch (error) {
            console.error(`❌ OSM Reverse Geocoding failed: ${error.message}`);
            return { address: 'Endereço não encontrado' };
        }
    }

    // ===== MÉTODOS PRIVADOS - GOOGLE MAPS =====
    async _googleGeocode(address) {
        // Mock para testes
        const mockResults = {
            'Rua Augusta, São Paulo': { lat: -23.5505, lng: -46.6333 },
            'Avenida Paulista, São Paulo': { lat: -23.5631, lng: -46.6544 },
            'Copacabana, Rio de Janeiro': { lat: -22.9707, lng: -43.1824 }
        };
        
        if (mockResults[address]) {
            return mockResults[address];
        }
        
        // Simular API call
        return { lat: -23.5505, lng: -46.6333 };
    }

    async _googleDirections(origin, destination, mode) {
        // Mock para testes
        const distance = Math.sqrt(
            Math.pow(destination.lat - origin.lat, 2) + 
            Math.pow(destination.lng - origin.lng, 2)
        ) * 111; // Aproximação km
        
        return {
            distance: Math.round(distance * 100) / 100,
            duration: Math.round(distance * 2), // 2 min por km
            route: [origin, destination],
            provider: 'google'
        };
    }

    async _googlePlaces(query, location, radius) {
        // Mock para testes
        return [
            { name: 'Estabelecimento 1', address: 'Rua A, 123', rating: 4.5 },
            { name: 'Estabelecimento 2', address: 'Rua B, 456', rating: 4.2 }
        ];
    }

    // ===== MÉTODOS PRIVADOS - OPENSTREETMAP =====
    async _osmGeocode(address) {
        // Mock para testes
        const mockResults = {
            'Rua Augusta, São Paulo': { lat: -23.5505, lng: -46.6333 },
            'Avenida Paulista, São Paulo': { lat: -23.5631, lng: -46.6544 },
            'Copacabana, Rio de Janeiro': { lat: -22.9707, lng: -43.1824 }
        };
        
        if (mockResults[address]) {
            return mockResults[address];
        }
        
        // Simular API call
        return { lat: -23.5505, lng: -46.6333 };
    }

    async _osmDirections(origin, destination, mode) {
        // Mock para testes
        const distance = Math.sqrt(
            Math.pow(destination.lat - origin.lat, 2) + 
            Math.pow(destination.lng - origin.lng, 2)
        ) * 111; // Aproximação km
        
        return {
            distance: Math.round(distance * 100) / 100,
            duration: Math.round(distance * 2), // 2 min por km
            route: [origin, destination],
            provider: 'osm'
        };
    }

    async _osmReverseGeocode(lat, lng) {
        // Mock para testes
        return {
            address: `Rua Mock, ${Math.round(lat * 1000)}, ${Math.round(lng * 1000)}`,
            city: 'São Paulo',
            state: 'SP',
            country: 'Brasil'
        };
    }

    // ===== UTILITÁRIOS =====
    clearCache() {
        this.cache.clear();
        console.log('🗺️ Cache de mapas limpo');
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    // ===== ANÁLISE DE CUSTOS =====
    async getCostAnalysis() {
        // Mock para testes
        return {
            totalCost: 0.067,
            breakdown: {
                geocoding: 0.050,
                directions: 0.000,
                places: 0.017,
                reverse: 0.000
            },
            savings: {
                osmDirections: 0.375, // Economia por usar OSM
                osmReverse: 0.025 // Estimativa de economia por reverse geocoding
            }
        };
    }
}

module.exports = HybridMapsService; 
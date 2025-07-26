// NavigationService.js - Serviço de navegação híbrida (backend + app externo)
// Mock para testes Node.js
const { costMonitoringService } = require('./CostMonitoringService.js');

class NavigationService {
    constructor() {
        this.costMonitoring = costMonitoringService;
        this.hybridMapsService = null; // Será inicializado quando necessário
    }

    /**
     * FLUXO COMPLETO DE NAVEGAÇÃO HÍBRIDA
     * 1. Calcula rota com trânsito no backend (1x por corrida)
     * 2. Mostra preview no app
     * 3. Abre navegação externa (Waze/Google Maps)
     * 4. Monitora progresso via GPS (sem recalcular rotas)
     */

    async calculateRouteWithTraffic(origin, destination) {
        console.log('🗺️ Calculando rota com trânsito...');
        
        try {
            // 1. CALCULA ROTA COM TRÂNSITO (1x por corrida)
            const routeData = await this._getRouteWithTraffic(origin, destination);
            
            // 2. CALCULA PEDÁGIOS
            const tolls = await this._calculateTolls(routeData);
            
            // 3. MONITORA CUSTOS
            this.costMonitoring.trackGoogleMapsCost('directions', 1);
            
            return {
                route: routeData,
                tolls: tolls,
                estimatedTime: routeData.duration,
                estimatedDistance: routeData.distance,
                trafficInfo: routeData.trafficInfo
            };
        } catch (error) {
            console.error('❌ Erro ao calcular rota:', error);
            throw error;
        }
    }

    async showRoutePreview(routeData) {
        console.log('📱 Mostrando preview da rota no app...');
        
        // Mostra preview estático da rota
        // Pode usar mapa estático ou preview simples
        return {
            preview: true,
            estimatedTime: routeData.estimatedTime,
            estimatedDistance: routeData.estimatedDistance,
            tolls: routeData.tolls
        };
    }

    async openExternalNavigation(origin, destination, routeData) {
        console.log('🚀 Abrindo navegação externa...');
        
        try {
            const { lat: oLat, lng: oLng } = origin;
            const { lat: dLat, lng: dLng } = destination;

            // Mock para testes - simula abertura de navegação externa
            console.log('✅ Navegação aberta no Google Maps (mock)');
            return { app: 'google_maps', success: true };

        } catch (error) {
            console.error('❌ Erro ao abrir navegação externa:', error);
            return { app: null, success: false, error };
        }
    }

    async monitorTripProgress(currentLocation, destination, routeData) {
        // MONITORA PROGRESSO VIA GPS (sem recalcular rotas)
        // A navegação em tempo real é feita pelo app externo
        
        const distanceToDestination = this._calculateDistance(currentLocation, destination);
        const progress = this._calculateProgress(currentLocation, destination, routeData);
        
        return {
            distanceToDestination,
            progress,
            estimatedTimeRemaining: this._estimateTimeRemaining(progress, routeData.estimatedTime)
        };
    }

    // Métodos privados
    async _getRouteWithTraffic(origin, destination) {
        // Simula chamada para Google Directions API com trânsito
        // Em produção, seria uma chamada real para o backend
        
        return {
            duration: 1800, // 30 minutos
            distance: 15000, // 15km
            trafficInfo: {
                hasTraffic: true,
                trafficLevel: 'moderate',
                delay: 300 // 5 minutos de atraso
            },
            waypoints: [
                { lat: origin.lat, lng: origin.lng },
                { lat: destination.lat, lng: destination.lng }
            ]
        };
    }

    async _calculateTolls(routeData) {
        // Simula cálculo de pedágios baseado na rota
        // Em produção, seria uma consulta real
        
        return {
            total: 8.50,
            segments: [
                { name: 'Ponte Rio-Niterói', cost: 8.50 }
            ]
        };
    }

    _calculateDistance(point1, point2) {
        // Fórmula de Haversine para calcular distância
        const R = 6371; // Raio da Terra em km
        const dLat = (point2.lat - point1.lat) * Math.PI / 180;
        const dLng = (point2.lng - point1.lng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    _calculateProgress(currentLocation, destination, routeData) {
        const totalDistance = routeData.distance / 1000; // km
        const remainingDistance = this._calculateDistance(currentLocation, destination);
        return Math.max(0, Math.min(100, ((totalDistance - remainingDistance) / totalDistance) * 100));
    }

    _estimateTimeRemaining(progress, totalTime) {
        const remainingProgress = 100 - progress;
        return (remainingProgress / 100) * totalTime;
    }
}

// Mock para testes Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationService;
} 
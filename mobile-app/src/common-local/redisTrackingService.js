import Logger from '../utils/Logger';
import { Platform } from 'react-native';


class RedisTrackingService {
    constructor() {
        this.isAvailable = Platform.OS === 'web';
        this.baseUrl = 'http://147.182.204.181:3001';
    }

    // Inicializar serviço
    async initialize() {
        if (Platform.OS === 'web') {
            try {
                Logger.log('🌐 Web detectado - Redis Tracking Service via API disponível');
                return true;
            } catch (error) {
                Logger.error('❌ Erro ao inicializar Redis Tracking Service:', error);
                return false;
            }
        } else {
            Logger.log('📱 Redis não disponível no React Native - usando Firebase');
            return false;
        }
    }

    // Método genérico para fazer requisições
    async makeRequest(endpoint, method = 'GET', data = null) {
        try {
            const url = `${this.baseUrl}${endpoint}`;
            const options = {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
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
            Logger.error(`❌ Redis Tracking API Error (${endpoint}):`, error);
            throw error;
        }
    }

    // Salvar ponto de tracking
    async saveTrackingPoint(tripId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, pulando salvamento de ponto de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest('/update_trip_location', 'POST', {
                tripId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            Logger.log('📍 Ponto de tracking salvo via Redis API');
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao salvar ponto de tracking via Redis API:', error);
            return null;
        }
    }

    // Atualizar localização da viagem (alias para saveTrackingPoint)
    async updateTripLocation(tripId, lat, lng, timestamp = Date.now()) {
        return this.saveTrackingPoint(tripId, lat, lng, timestamp);
    }

    // Obter último ponto de tracking
    async getLastTrackingPoint(tripId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, não é possível obter último ponto de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest(`/get_trip_data/${tripId}`, 'GET');
            return result.lastPoint || null;
        } catch (error) {
            Logger.error('❌ Erro ao obter último ponto de tracking via Redis API:', error);
            return null;
        }
    }

    // Iniciar tracking de viagem
    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, pulando início de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest('/start_trip_tracking', 'POST', {
                tripId,
                driverId,
                passengerId,
                initialLocation
            });
            
            Logger.log('🚗 Tracking iniciado via Redis API');
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao iniciar tracking via Redis API:', error);
            return null;
        }
    }

    // Finalizar tracking de viagem
    async endTripTracking(tripId, endLocation) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, pulando finalização de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest('/end_trip_tracking', 'POST', {
                tripId,
                endLocation
            });
            
            Logger.log('✅ Tracking finalizado via Redis API');
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao finalizar tracking via Redis API:', error);
            return null;
        }
    }

    // Obter dados da viagem
    async getTripData(tripId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, não é possível obter dados da viagem');
            return null;
        }

        try {
            const result = await this.makeRequest(`/get_trip_data/${tripId}`, 'GET');
            return result.tripData || null;
        } catch (error) {
            Logger.error('❌ Erro ao obter dados da viagem via Redis API:', error);
            return null;
        }
    }

    // Cancelar tracking de viagem
    async cancelTripTracking(tripId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, pulando cancelamento de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest('/cancel_trip_tracking', 'POST', {
                tripId
            });
            
            Logger.log('❌ Tracking cancelado via Redis API');
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao cancelar tracking via Redis API:', error);
            return null;
        }
    }

    // Obter histórico de tracking
    async getTripHistory(tripId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, não é possível obter histórico da viagem');
            return [];
        }

        try {
            const result = await this.makeRequest(`/get_trip_history/${tripId}`, 'GET');
            return result.history || [];
        } catch (error) {
            Logger.error('❌ Erro ao obter histórico da viagem via Redis API:', error);
            return [];
        }
    }

    // Obter viagens ativas
    async getActiveTrips(userId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, não é possível obter viagens ativas');
            return [];
        }

        try {
            const result = await this.makeRequest(`/get_active_trips/${userId}`, 'GET');
            return result.trips || [];
        } catch (error) {
            Logger.error('❌ Erro ao obter viagens ativas via Redis API:', error);
            return [];
        }
    }

    // Desinscrever de tracking (cleanup)
    async unsubscribeFromTracking(tripId) {
        if (!this.isAvailable) {
            Logger.log('⚠️ Redis não disponível, pulando desinscrição de tracking');
            return null;
        }

        try {
            const result = await this.makeRequest('/unsubscribe_tracking', 'POST', {
                tripId
            });
            
            Logger.log('🔌 Desinscrito de tracking via Redis API');
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao desinscrever de tracking via Redis API:', error);
            return null;
        }
    }

    // Obter estatísticas do serviço
    async getServiceStats() {
        if (!this.isAvailable) {
            return { error: 'Redis não disponível' };
        }

        try {
            const result = await this.makeRequest('/get_redis_stats', 'GET');
            return {
                redisConnected: true,
                stats: result.stats || {}
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas do serviço via Redis API:', error);
            return { error: 'Erro ao conectar com Redis API' };
        }
    }

    // Método para verificar se o Redis está disponível
    isRedisAvailable() {
        return this.isAvailable;
    }
}

export const redisTrackingService = new RedisTrackingService(); 
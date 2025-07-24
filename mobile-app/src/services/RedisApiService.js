// RedisApiService.js - Serviço para acessar Redis via webhooks/API
import { Platform } from 'react-native';

// Configuração da API base
const API_BASE_URL = 'http://192.168.0.39:5001/leaf-app-91dfdce0/us-central1'; // Ajuste conforme necessário

class RedisApiService {
    constructor() {
        this.baseUrl = API_BASE_URL;
        this.isAvailable = Platform.OS === 'web'; // Apenas web por enquanto
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
            console.error(`❌ Redis API Error (${endpoint}):`, error);
            throw error;
        }
    }

    // Atualizar localização do usuário
    async updateUserLocation(userId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/update_user_location', 'POST', {
                userId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            console.log('📍 Localização atualizada via Redis API:', userId);
            return result;
        } catch (error) {
            console.error('❌ Erro ao atualizar localização via Redis API:', error);
            return null;
        }
    }

    // Buscar motoristas próximos
    async getNearbyDrivers(lat, lng, radius = 5) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return [];
        }

        try {
            const result = await this.makeRequest('/get_nearby_drivers', 'POST', {
                latitude: lat,
                longitude: lng,
                radius
            });
            
            console.log('📍 Motoristas próximos via Redis API:', result.drivers?.length || 0);
            return result.drivers || [];
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas próximos via Redis API:', error);
            return [];
        }
    }

    // Iniciar tracking de viagem
    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/start_trip_tracking', 'POST', {
                tripId,
                driverId,
                passengerId,
                initialLocation
            });
            
            console.log('🚗 Tracking iniciado via Redis API:', tripId);
            return result;
        } catch (error) {
            console.error('❌ Erro ao iniciar tracking via Redis API:', error);
            return null;
        }
    }

    // Atualizar localização da viagem
    async updateTripLocation(tripId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/update_trip_location', 'POST', {
                tripId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            console.log('📍 Localização da viagem atualizada via Redis API:', tripId);
            return result;
        } catch (error) {
            console.error('❌ Erro ao atualizar localização da viagem via Redis API:', error);
            return null;
        }
    }

    // Finalizar tracking de viagem
    async endTripTracking(tripId, endLocation) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/end_trip_tracking', 'POST', {
                tripId,
                endLocation
            });
            
            console.log('✅ Tracking finalizado via Redis API:', tripId);
            return result;
        } catch (error) {
            console.error('❌ Erro ao finalizar tracking via Redis API:', error);
            return null;
        }
    }

    // Obter dados da viagem
    async getTripData(tripId) {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest(`/get_trip_data/${tripId}`, 'GET');
            
            console.log('📍 Dados da viagem obtidos via Redis API:', tripId);
            return result.tripData || null;
        } catch (error) {
            console.error('❌ Erro ao obter dados da viagem via Redis API:', error);
            return null;
        }
    }

    // Obter estatísticas do Redis
    async getRedisStats() {
        if (!this.isAvailable) {
            console.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/get_redis_stats', 'GET');
            
            console.log('📊 Estatísticas do Redis obtidas via API');
            return result.stats || null;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas do Redis via API:', error);
            return null;
        }
    }

    // Verificar se o serviço está disponível
    isServiceAvailable() {
        return this.isAvailable;
    }

    // Testar conexão com a API
    async testConnection() {
        if (!this.isAvailable) {
            return { available: false, reason: 'React Native não suportado' };
        }

        try {
            const result = await this.makeRequest('/health', 'GET');
            return { available: true, data: result };
        } catch (error) {
            return { available: false, reason: error.message };
        }
    }
}

// Instância singleton
export const redisApiService = new RedisApiService(); 
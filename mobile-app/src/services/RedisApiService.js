import Logger from '../utils/Logger';
// RedisApiService.js - Serviço para acessar Redis via webhooks/API
import { Platform } from 'react-native';
import BACKEND_BASE_URL from '../config/backendBaseUrl';


class RedisApiService {
    constructor() {
        this.baseUrl = BACKEND_BASE_URL;
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
            Logger.error(`❌ Redis API Error (${endpoint}):`, error);
            throw error;
        }
    }

    // Atualizar localização do usuário
    async updateUserLocation(userId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            Logger.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/update_user_location', 'POST', {
                userId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            Logger.log('📍 Localização atualizada via Redis API:', userId);
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao atualizar localização via Redis API:', error);
            return null;
        }
    }

    // Buscar motoristas próximos
    async getNearbyDrivers(lat, lng, radius = 5) {
        if (!this.isAvailable) {
            Logger.log('📱 Redis API não disponível no React Native');
            return [];
        }

        try {
            const result = await this.makeRequest('/get_nearby_drivers', 'POST', {
                latitude: lat,
                longitude: lng,
                radius
            });
            
            Logger.log('📍 Motoristas próximos via Redis API:', result.drivers?.length || 0);
            return result.drivers || [];
        } catch (error) {
            Logger.error('❌ Erro ao buscar motoristas próximos via Redis API:', error);
            return [];
        }
    }

    // Obter estatísticas do Redis
    async getRedisStats() {
        if (!this.isAvailable) {
            Logger.log('📱 Redis API não disponível no React Native');
            return null;
        }

        try {
            const result = await this.makeRequest('/get_redis_stats', 'GET');
            
            Logger.log('📊 Estatísticas do Redis obtidas via API');
            return result.stats || null;
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas do Redis via API:', error);
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

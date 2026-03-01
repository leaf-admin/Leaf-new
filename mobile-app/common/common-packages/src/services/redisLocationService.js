import { Platform } from 'react-native';

class RedisLocationService {
    constructor() {
        this.isAvailable = Platform.OS === 'web';
        this.baseUrl = 'http://192.168.0.39:5001/leaf-app-91dfdce0/us-central1';
    }

    // Inicializar serviço
    async initialize() {
        if (Platform.OS === 'web') {
            try {
                console.log('🌐 Web detectado - Redis Location Service via API disponível');
                return true;
            } catch (error) {
                console.error('❌ Erro ao inicializar Redis Location Service:', error);
                return false;
            }
        } else {
            console.log('📱 Redis não disponível no React Native - usando Firebase');
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
            console.error(`❌ Redis Location API Error (${endpoint}):`, error);
            throw error;
        }
    }

    // Atualizar localização do usuário
    async updateUserLocation(userId, lat, lng, timestamp = Date.now()) {
        if (!this.isAvailable) {
            console.log('⚠️ Redis não disponível, pulando atualização de localização');
            return null;
        }

        try {
            const result = await this.makeRequest('/update_user_location', 'POST', {
                userId,
                latitude: lat,
                longitude: lng,
                timestamp
            });
            
            console.log('📍 Localização salva via Redis API');
            return result;
        } catch (error) {
            console.error('❌ Erro ao salvar localização via Redis API:', error);
            return null;
        }
    }

    // Obter localização do usuário
    async getUserLocation(userId) {
        if (!this.isAvailable) {
            console.log('⚠️ Redis não disponível, não é possível obter localização');
            return null;
        }

        try {
            const result = await this.makeRequest(`/get_user_location/${userId}`, 'GET');
            return result.location || null;
        } catch (error) {
            console.error('❌ Erro ao obter localização via Redis API:', error);
            return null;
        }
    }

    // Buscar usuários próximos
    async findNearbyUsers(lat, lng, radius = 5) {
        if (!this.isAvailable) {
            console.log('⚠️ Redis não disponível, não é possível buscar usuários próximos');
            return [];
        }

        try {
            const result = await this.makeRequest('/get_nearby_drivers', 'POST', {
                latitude: lat,
                longitude: lng,
                radius
            });
            
            return result.drivers || [];
        } catch (error) {
            console.error('❌ Erro ao buscar usuários próximos via Redis API:', error);
            return [];
        }
    }

    // Buscar motoristas próximos (alias para findNearbyUsers)
    async getNearbyDrivers(lat, lng, radius = 5) {
        return this.findNearbyUsers(lat, lng, radius);
    }

    // Método para verificar se o Redis está disponível
    isRedisAvailable() {
        return this.isAvailable;
    }
}

export const redisLocationService = new RedisLocationService(); 
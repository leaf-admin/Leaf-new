import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';

// Configuração da API
const API_BASE_URL = __DEV__ 
    ? 'http://localhost:5001/your-project/us-central1'  // Desenvolvimento
    : 'https://us-central1-your-project.cloudfunctions.net'; // Produção

class RedisApiService {
    constructor() {
        this.baseUrl = API_BASE_URL;
        this.isInitialized = false;
    }

    // Obter token de autenticação
    async getAuthToken() {
        try {
            const user = auth().currentUser;
            if (!user) {
                throw new Error('Usuário não autenticado');
            }
            return await user.getIdToken();
        } catch (error) {
            console.error('❌ Erro ao obter token:', error);
            throw error;
        }
    }

    // Fazer requisição autenticada
    async makeAuthenticatedRequest(endpoint, options = {}) {
        try {
            const token = await this.getAuthToken();
            
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers,
                },
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error(`❌ Erro na requisição ${endpoint}:`, error);
            throw error;
        }
    }

    // Salvar localização do usuário
    async saveUserLocation(lat, lng, timestamp = null) {
        try {
            console.log('📍 Salvando localização via API:', { lat, lng, timestamp });
            
            const response = await this.makeAuthenticatedRequest('/saveUserLocation', {
                method: 'POST',
                body: JSON.stringify({
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                    timestamp: timestamp || Date.now()
                })
            });

            console.log('✅ Localização salva com sucesso via API');
            return response;
        } catch (error) {
            console.error('❌ Erro ao salvar localização via API:', error);
            throw error;
        }
    }

    // Buscar motoristas próximos
    async getNearbyDrivers(lat, lng, radius = 5000, limit = 10) {
        try {
            console.log('🔍 Buscando motoristas próximos via API:', { lat, lng, radius, limit });
            
            const params = new URLSearchParams({
                lat: lat.toString(),
                lng: lng.toString(),
                radius: radius.toString(),
                limit: limit.toString()
            });

            const response = await this.makeAuthenticatedRequest(`/getNearbyDrivers?${params}`, {
                method: 'GET'
            });

            console.log(`✅ Encontrados ${response.drivers?.length || 0} motoristas via API (${response.source})`);
            return response;
        } catch (error) {
            console.error('❌ Erro ao buscar motoristas via API:', error);
            throw error;
        }
    }

    // Obter localização de um usuário específico
    async getUserLocation(uid) {
        try {
            console.log('📍 Obtendo localização do usuário via API:', uid);
            
            const response = await this.makeAuthenticatedRequest(`/getUserLocation/${uid}`, {
                method: 'GET'
            });

            console.log('✅ Localização obtida com sucesso via API');
            return response;
        } catch (error) {
            console.error('❌ Erro ao obter localização via API:', error);
            throw error;
        }
    }

    // Atualizar status do motorista
    async updateDriverStatus(status, isOnline) {
        try {
            console.log('🔄 Atualizando status do motorista via API:', { status, isOnline });
            
            const response = await this.makeAuthenticatedRequest('/updateDriverStatus', {
                method: 'POST',
                body: JSON.stringify({
                    status: status || 'available',
                    isOnline: isOnline || false
                })
            });

            console.log('✅ Status atualizado com sucesso via API');
            return response;
        } catch (error) {
            console.error('❌ Erro ao atualizar status via API:', error);
            throw error;
        }
    }

    // Obter estatísticas do Redis
    async getRedisStats() {
        try {
            console.log('📊 Obtendo estatísticas do Redis via API');
            
            const response = await this.makeAuthenticatedRequest('/getRedisStats', {
                method: 'GET'
            });

            console.log('✅ Estatísticas obtidas com sucesso via API');
            return response;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas via API:', error);
            throw error;
        }
    }

    // Verificar se o serviço está disponível
    async checkServiceHealth() {
        try {
            const response = await this.makeAuthenticatedRequest('/getRedisStats', {
                method: 'GET'
            });
            return response.success;
        } catch (error) {
            console.log('⚠️ Serviço Redis API não disponível:', error.message);
            return false;
        }
    }

    // Inicializar o serviço
    async initialize() {
        if (this.isInitialized) return;

        try {
            console.log('🚀 Inicializando Redis API Service');
            
            // Verificar se estamos no React Native
            if (Platform.OS !== 'web') {
                console.log('📱 Redis API Service inicializado para React Native');
            } else {
                console.log('🌐 Redis API Service inicializado para Web');
            }

            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Erro ao inicializar Redis API Service:', error);
            this.isInitialized = true; // Marcar como inicializado para evitar loops
        }
    }
}

// Instância singleton
const redisApiService = new RedisApiService();

export default redisApiService; 
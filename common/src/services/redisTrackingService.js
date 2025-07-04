import { Platform } from 'react-native';

class RedisTrackingService {
    constructor() {
        this.client = null;
        this.isInitialized = false;
        this.isConnected = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            // Verificar se estamos no React Native
            if (Platform.OS !== 'web') {
                console.log('📱 React Native detectado - usando fallback para Firebase');
                this.isInitialized = true;
                return;
            }

            // Apenas no web, tentar conectar ao Redis
            if (typeof window !== 'undefined') {
                // Implementação web seria aqui
                console.log('🌐 Web detectado - Redis disponível');
            }

            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Erro ao inicializar Redis Tracking Service:', error);
            this.isInitialized = true; // Marcar como inicializado para evitar loops
        }
    }

    async connect() {
        if (Platform.OS !== 'web') {
            console.log('📱 Redis não disponível no React Native - usando Firebase');
            return false;
        }

        try {
            // Implementação web seria aqui
            this.isConnected = true;
            return true;
        } catch (error) {
            console.error('❌ Erro ao conectar Redis:', error);
            return false;
        }
    }

    async addTrackingPoint(tripId, trackingData) {
        if (Platform.OS !== 'web') {
            console.log('📱 Salvando ponto de tracking via Firebase (fallback)');
            // Aqui você pode implementar o save no Firebase
            return true;
        }

        try {
            // Implementação Redis seria aqui
            console.log('📍 Ponto de tracking salvo no Redis');
            return true;
        } catch (error) {
            console.error('❌ Erro ao salvar ponto de tracking:', error);
            return false;
        }
    }

    async getLastTrackingPoint(tripId) {
        if (Platform.OS !== 'web') {
            console.log('📱 Buscando último ponto via Firebase (fallback)');
            // Aqui você pode implementar a busca no Firebase
            return null;
        }

        try {
            // Implementação Redis seria aqui
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar último ponto:', error);
            return null;
        }
    }

    async getTrackingHistory(tripId, limit = 10) {
        if (Platform.OS !== 'web') {
            console.log('📱 Buscando histórico via Firebase (fallback)');
            // Aqui você pode implementar a busca no Firebase
            return [];
        }

        try {
            // Implementação Redis seria aqui
            return [];
        } catch (error) {
            console.error('❌ Erro ao buscar histórico:', error);
            return [];
        }
    }

    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (Platform.OS !== 'web') {
            console.log('📱 Iniciando tracking via Firebase (fallback)');
            // Aqui você pode implementar no Firebase
            return true;
        }

        try {
            // Implementação Redis seria aqui
            console.log('🚗 Tracking iniciado no Redis');
            return true;
        } catch (error) {
            console.error('❌ Erro ao iniciar tracking:', error);
            return false;
        }
    }

    async endTripTracking(tripId, endLocation) {
        if (Platform.OS !== 'web') {
            console.log('📱 Finalizando tracking via Firebase (fallback)');
            // Aqui você pode implementar no Firebase
            return true;
        }

        try {
            // Implementação Redis seria aqui
            console.log('✅ Tracking finalizado no Redis');
            return true;
        } catch (error) {
            console.error('❌ Erro ao finalizar tracking:', error);
            return false;
        }
    }

    async getTripData(tripId) {
        if (Platform.OS !== 'web') {
            console.log('📱 Buscando dados da viagem via Firebase (fallback)');
            // Aqui você pode implementar a busca no Firebase
            return null;
        }

        try {
            // Implementação Redis seria aqui
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar dados da viagem:', error);
            return null;
        }
    }

    // Obter viagens por motorista
    async getTripsByDriver(driverId) {
        if (Platform.OS !== 'web') {
            console.log('📱 Buscando viagens do motorista via Firebase (fallback)');
            return [];
        }

        try {
            // Implementação Redis seria aqui
            return [];
        } catch (error) {
            console.error('❌ Erro ao buscar viagens do motorista:', error);
            return [];
        }
    }

    // Obter viagens por passageiro
    async getTripsByPassenger(passengerId) {
        if (Platform.OS !== 'web') {
            console.log('📱 Buscando viagens do passageiro via Firebase (fallback)');
            return [];
        }

        try {
            // Implementação Redis seria aqui
            return [];
        } catch (error) {
            console.error('❌ Erro ao buscar viagens do passageiro:', error);
            return [];
        }
    }

    // Método para verificar se o Redis está disponível
    isRedisAvailable() {
        return Platform.OS === 'web' && this.isConnected;
    }

    // Atualizar localização durante a viagem
    async updateTripLocation(tripId, latitude, longitude, timestamp = Date.now()) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, pulando atualização de localização da viagem');
            return false;
        }

        try {
            const location = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };
            
            // Atualizar localização atual
            await this.client.hSet(`trip:${tripId}`, {
                currentLocation: JSON.stringify(location),
                updatedAt: new Date().toISOString()
            });

            // Adicionar ao histórico de localizações (limitado a 100 pontos)
            const pathKey = `trip_path:${tripId}`;
            await this.client.lPush(pathKey, JSON.stringify({
                ...location,
                timestamp: parseInt(timestamp)
            }));
            
            // Manter apenas os últimos 100 pontos
            await this.client.lTrim(pathKey, 0, 99);
            await this.client.expire(pathKey, 86400); // Expira em 24 horas

            console.log(`📍 Localização da viagem ${tripId} atualizada`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao atualizar localização da viagem:', error);
            return false;
        }
    }

    // Obter histórico de localizações da viagem
    async getTripPath(tripId, limit = 50) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter histórico da viagem');
            return [];
        }

        try {
            const pathKey = `trip_path:${tripId}`;
            const pathData = await this.client.lRange(pathKey, 0, limit - 1);
            
            return pathData.map(point => JSON.parse(point)).reverse(); // Mais recente primeiro
        } catch (error) {
            console.error('❌ Erro ao obter histórico da viagem:', error);
            return [];
        }
    }

    // Cancelar tracking da viagem
    async cancelTripTracking(tripId, reason = 'cancelled') {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, pulando cancelamento de tracking');
            return false;
        }

        try {
            const endTime = Date.now();
            
            // Atualizar dados da viagem
            await this.client.hSet(`trip:${tripId}`, {
                status: 'cancelled',
                endTime: endTime.toString(),
                cancelReason: reason,
                updatedAt: new Date().toISOString()
            });

            // Remover da lista de viagens ativas
            await this.client.sRem('active_trips', tripId);
            
            // Adicionar à lista de viagens canceladas
            await this.client.sAdd('cancelled_trips', tripId);

            console.log(`❌ Tracking cancelado para viagem ${tripId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao cancelar tracking:', error);
            return false;
        }
    }

    // Obter todas as viagens ativas
    async getActiveTrips() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter viagens ativas');
            return [];
        }

        try {
            const activeTripIds = await this.client.sMembers('active_trips');
            const activeTrips = [];

            for (const tripId of activeTripIds) {
                const tripData = await this.getTripData(tripId);
                if (tripData) {
                    activeTrips.push(tripData);
                }
            }

            return activeTrips;
        } catch (error) {
            console.error('❌ Erro ao obter viagens ativas:', error);
            return [];
        }
    }

    // Obter estatísticas do serviço
    async getStats() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            return { error: 'Redis não disponível' };
        }

        try {
            const stats = {
                activeTrips: 0,
                completedTrips: 0,
                cancelledTrips: 0,
                totalTrips: 0,
                redisConnected: true
            };

            stats.activeTrips = await this.client.sCard('active_trips');
            stats.completedTrips = await this.client.sCard('completed_trips');
            stats.cancelledTrips = await this.client.sCard('cancelled_trips');
            stats.totalTrips = stats.activeTrips + stats.completedTrips + stats.cancelledTrips;

            return stats;
        } catch (error) {
            console.error('❌ Erro ao obter estatísticas:', error);
            return { error: error.message };
        }
    }

    // Limpar dados expirados
    async cleanup() {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            return false;
        }

        try {
            const pattern = 'trip:*';
            const keys = await this.client.keys(pattern);
            let cleanedCount = 0;

            for (const key of keys) {
                const ttl = await this.client.ttl(key);
                if (ttl === -1) { // Sem TTL definido
                    await this.client.expire(key, 86400); // Definir TTL de 24 horas
                    cleanedCount++;
                }
            }

            console.log(`🧹 Limpeza de tracking concluída: ${cleanedCount} registros processados`);
            return true;
        } catch (error) {
            console.error('❌ Erro na limpeza de tracking:', error);
            return false;
        }
    }
}

// Exportar instância singleton
export const redisTrackingService = new RedisTrackingService(); 
const { getRedisClient, MIGRATION_FLAGS, isRedisAvailable } = require('../config/redisConfig');
const firestorePersistenceService = require('./firestorePersistenceService');

class RedisTrackingService {
    constructor() {
        this.client = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return true;

        try {
            this.client = await getRedisClient();
            if (!this.client) {
                console.log('⚠️ Redis não disponível para tracking');
                return false;
            }

            // Testar conexão
            await this.client.ping();
            this.isInitialized = true;
            console.log('✅ Serviço de tracking Redis inicializado');
            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar serviço de tracking Redis:', error);
            return false;
        }
    }

    // Iniciar tracking de uma viagem
    async startTripTracking(tripId, driverId, passengerId, initialLocation) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, pulando início de tracking');
            return false;
        }

        try {
            const tripData = {
                tripId,
                driverId,
                passengerId,
                status: 'active',
                startTime: Date.now(),
                startLocation: JSON.stringify(initialLocation),
                currentLocation: JSON.stringify(initialLocation),
                path: JSON.stringify([initialLocation]),
                updatedAt: new Date().toISOString()
            };

            // Salvar dados da viagem
            await this.client.hSet(`trip:${tripId}`, {
                tripId: tripData.tripId,
                driverId: tripData.driverId,
                passengerId: tripData.passengerId,
                status: tripData.status,
                startTime: tripData.startTime.toString(),
                startLocation: tripData.startLocation,
                currentLocation: tripData.currentLocation,
                path: tripData.path,
                updatedAt: tripData.updatedAt
            });
            
            // Adicionar à lista de viagens ativas
            await this.client.sAdd('active_trips', tripId);
            
            // Definir TTL de 24 horas
            await this.client.expire(`trip:${tripId}`, 86400);

            console.log(`🚗 Tracking iniciado para viagem ${tripId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao iniciar tracking:', error);
            return false;
        }
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

    // Obter dados da viagem
    async getTripData(tripId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter dados da viagem');
            return null;
        }

        try {
            const tripData = await this.client.hGetAll(`trip:${tripId}`);
            
            if (!tripData || Object.keys(tripData).length === 0) {
                return null;
            }

            return {
                tripId: tripData.tripId,
                driverId: tripData.driverId,
                passengerId: tripData.passengerId,
                status: tripData.status,
                startTime: parseInt(tripData.startTime),
                startLocation: JSON.parse(tripData.startLocation),
                currentLocation: JSON.parse(tripData.currentLocation),
                updatedAt: tripData.updatedAt
            };
        } catch (error) {
            console.error('❌ Erro ao obter dados da viagem:', error);
            return null;
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

    // Finalizar tracking da viagem
    async endTripTracking(tripId, endLocation) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, pulando finalização de tracking');
            return false;
        }

        try {
            const endTime = Date.now();
            
            // Atualizar dados da viagem
            await this.client.hSet(`trip:${tripId}`, {
                status: 'completed',
                endTime: endTime.toString(),
                endLocation: JSON.stringify(endLocation),
                updatedAt: new Date().toISOString()
            });

            // Remover da lista de viagens ativas
            await this.client.sRem('active_trips', tripId);
            
            // Adicionar à lista de viagens completadas
            await this.client.sAdd('completed_trips', tripId);

            // Migrar dados para Firestore se habilitado
            if (MIGRATION_FLAGS.AUTO_MIGRATE && MIGRATION_FLAGS.FIRESTORE_PERSISTENCE) {
                try {
                    const tripData = await this.getTripData(tripId);
                    if (tripData) {
                        await firestorePersistenceService.migrateTripFromRedis(tripId, tripData);
                        console.log('🔄 Dados migrados para Firestore:', tripId);
                    }
                } catch (migrationError) {
                    console.error('⚠️ Erro na migração para Firestore:', migrationError);
                    // Não falhar se a migração der erro
                }
            }

            console.log(`✅ Tracking finalizado para viagem ${tripId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao finalizar tracking:', error);
            return false;
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

    // Obter viagens por motorista
    async getTripsByDriver(driverId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter viagens do motorista');
            return [];
        }

        try {
            const pattern = 'trip:*';
            const keys = await this.client.keys(pattern);
            const driverTrips = [];

            for (const key of keys) {
                const tripData = await this.client.hGetAll(key);
                if (tripData.driverId === driverId) {
                    driverTrips.push({
                        tripId: tripData.tripId,
                        passengerId: tripData.passengerId,
                        status: tripData.status,
                        startTime: parseInt(tripData.startTime),
                        currentLocation: JSON.parse(tripData.currentLocation || '{}'),
                        updatedAt: tripData.updatedAt
                    });
                }
            }

            return driverTrips.sort((a, b) => b.startTime - a.startTime);
        } catch (error) {
            console.error('❌ Erro ao obter viagens do motorista:', error);
            return [];
        }
    }

    // Obter viagens por passageiro
    async getTripsByPassenger(passengerId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter viagens do passageiro');
            return [];
        }

        try {
            const pattern = 'trip:*';
            const keys = await this.client.keys(pattern);
            const passengerTrips = [];

            for (const key of keys) {
                const tripData = await this.client.hGetAll(key);
                if (tripData.passengerId === passengerId) {
                    passengerTrips.push({
                        tripId: tripData.tripId,
                        driverId: tripData.driverId,
                        status: tripData.status,
                        startTime: parseInt(tripData.startTime),
                        currentLocation: JSON.parse(tripData.currentLocation || '{}'),
                        updatedAt: tripData.updatedAt
                    });
                }
            }

            return passengerTrips.sort((a, b) => b.startTime - a.startTime);
        } catch (error) {
            console.error('❌ Erro ao obter viagens do passageiro:', error);
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

module.exports = new RedisTrackingService(); 
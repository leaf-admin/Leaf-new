const { getRedisClient, MIGRATION_FLAGS, isRedisAvailable } = require('../config/redisConfig');

class RedisLocationService {
    constructor() {
        this.client = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return true;

        try {
            this.client = await getRedisClient();
            if (!this.client) {
                console.log('⚠️ Redis não disponível para localização');
                return false;
            }

            // Testar conexão
            await this.client.ping();
            this.isInitialized = true;
            console.log('✅ Serviço de localização Redis inicializado');
            return true;
        } catch (error) {
            console.error('❌ Erro ao inicializar serviço de localização Redis:', error);
            return false;
        }
    }

    // Atualizar localização do usuário
    async updateUserLocation(userId, latitude, longitude, timestamp = Date.now()) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, pulando atualização de localização');
            return false;
        }

        try {
            const locationData = {
                userId,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                timestamp: parseInt(timestamp),
                updatedAt: new Date().toISOString()
            };

            // Usar GEOADD se disponível, senão usar HASH
            if (MIGRATION_FLAGS.USE_GEO_COMMANDS) {
                await this.client.geoAdd('user_locations', {
                    longitude: locationData.longitude,
                    latitude: locationData.latitude,
                    member: userId
                });
            }

            // Sempre salvar dados completos em hash
            await this.client.hSet(`user_location:${userId}`, {
                userId: locationData.userId,
                latitude: locationData.latitude.toString(),
                longitude: locationData.longitude.toString(),
                timestamp: locationData.timestamp.toString(),
                updatedAt: locationData.updatedAt
            });
            await this.client.expire(`user_location:${userId}`, 3600); // Expira em 1 hora

            console.log(`📍 Localização atualizada para usuário ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao atualizar localização:', error);
            return false;
        }
    }

    // Obter localização do usuário
    async getUserLocation(userId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível obter localização');
            return null;
        }

        try {
            const locationData = await this.client.hGetAll(`user_location:${userId}`);
            
            if (!locationData || Object.keys(locationData).length === 0) {
                return null;
            }

            return {
                userId: locationData.userId,
                latitude: parseFloat(locationData.latitude),
                longitude: parseFloat(locationData.longitude),
                timestamp: parseInt(locationData.timestamp),
                updatedAt: locationData.updatedAt
            };
        } catch (error) {
            console.error('❌ Erro ao obter localização:', error);
            return null;
        }
    }

    // Buscar usuários próximos (usando GEO se disponível)
    async findNearbyUsers(latitude, longitude, radiusKm = 5) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível buscar usuários próximos');
            return [];
        }

        try {
            if (MIGRATION_FLAGS.USE_GEO_COMMANDS) {
                // Usar GEORADIUS se disponível
                const nearbyUsers = await this.client.geoRadius('user_locations', {
                    longitude: parseFloat(longitude),
                    latitude: parseFloat(latitude)
                }, radiusKm, 'km', {
                    WITHCOORD: true,
                    WITHDIST: true
                });

                return nearbyUsers.map(user => ({
                    userId: user.member,
                    distance: parseFloat(user.distance),
                    coordinates: {
                        longitude: user.coordinates.longitude,
                        latitude: user.coordinates.latitude
                    }
                }));
            } else {
                // Fallback: buscar todos os usuários e calcular distância
                console.log('⚠️ Comandos GEO não disponíveis, usando fallback');
                return await this.findNearbyUsersFallback(latitude, longitude, radiusKm);
            }
        } catch (error) {
            console.error('❌ Erro ao buscar usuários próximos:', error);
            return [];
        }
    }

    // Fallback para buscar usuários próximos sem comandos GEO
    async findNearbyUsersFallback(latitude, longitude, radiusKm) {
        try {
            const pattern = 'user_location:*';
            const keys = await this.client.keys(pattern);
            const nearbyUsers = [];

            for (const key of keys) {
                const locationData = await this.client.hGetAll(key);
                if (locationData && locationData.latitude && locationData.longitude) {
                    const distance = this.calculateDistance(
                        latitude, longitude,
                        parseFloat(locationData.latitude),
                        parseFloat(locationData.longitude)
                    );

                    if (distance <= radiusKm) {
                        nearbyUsers.push({
                            userId: locationData.userId,
                            distance: distance,
                            coordinates: {
                                latitude: parseFloat(locationData.latitude),
                                longitude: parseFloat(locationData.longitude)
                            }
                        });
                    }
                }
            }

            return nearbyUsers.sort((a, b) => a.distance - b.distance);
        } catch (error) {
            console.error('❌ Erro no fallback de busca de usuários próximos:', error);
            return [];
        }
    }

    // Calcular distância entre dois pontos (fórmula de Haversine)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Raio da Terra em km
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Remover localização do usuário
    async removeUserLocation(userId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.client) {
            console.log('⚠️ Redis não disponível, não é possível remover localização');
            return false;
        }

        try {
            if (MIGRATION_FLAGS.USE_GEO_COMMANDS) {
                await this.client.geoRem('user_locations', userId);
            }
            await this.client.del(`user_location:${userId}`);
            
            console.log(`🗑️ Localização removida para usuário ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Erro ao remover localização:', error);
            return false;
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
                totalUsers: 0,
                geoCommandsAvailable: MIGRATION_FLAGS.USE_GEO_COMMANDS,
                redisConnected: true
            };

            if (MIGRATION_FLAGS.USE_GEO_COMMANDS) {
                stats.totalUsers = await this.client.geoLen('user_locations');
            } else {
                const keys = await this.client.keys('user_location:*');
                stats.totalUsers = keys.length;
            }

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
            const pattern = 'user_location:*';
            const keys = await this.client.keys(pattern);
            let cleanedCount = 0;

            for (const key of keys) {
                const ttl = await this.client.ttl(key);
                if (ttl === -1) { // Sem TTL definido
                    await this.client.expire(key, 3600); // Definir TTL de 1 hora
                    cleanedCount++;
                }
            }

            console.log(`🧹 Limpeza concluída: ${cleanedCount} registros processados`);
            return true;
        } catch (error) {
            console.error('❌ Erro na limpeza:', error);
            return false;
        }
    }
}

module.exports = new RedisLocationService(); 
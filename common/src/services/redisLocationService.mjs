import { createClient } from 'redis';

class RedisLocationService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.subscribers = new Map();
    }

    async connect() {
        try {
            this.client = createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            console.error('Redis connection failed after 10 retries');
                            return false;
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            });

            this.client.on('error', (err) => {
                console.error('Redis Client Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('Redis connected successfully');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                console.log('Redis client ready');
            });

            await this.client.connect();
            return true;
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            return false;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            this.isConnected = false;
        }
    }

    /**
     * Salva a localização de um usuário
     * @param {string} uid - ID do usuário
     * @param {Object} location - Objeto com lat, lng, timestamp
     */
    async saveUserLocation(uid, location) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            // Salva no hash de localizações usando argumentos separados
            await this.client.hSet(`locations:${uid}`, 
                'lat', String(location.lat),
                'lng', String(location.lng),
                'updated', String(Date.now()),
                'error', String(location.error || false)
            );
            
            // Define TTL de 5 minutos
            await this.client.expire(`locations:${uid}`, 300);

            // Publica atualização para subscribers
            const locationData = {
                lat: location.lat,
                lng: location.lng,
                updated: Date.now(),
                error: location.error || false
            };
            await this.client.publish(`location:${uid}`, JSON.stringify(locationData));

            // Atualiza set de usuários online
            if (!location.error) {
                await this.client.sAdd('users:online', uid);
                await this.client.sRem('users:offline', uid);
            } else {
                await this.client.sAdd('users:offline', uid);
                await this.client.sRem('users:online', uid);
            }

            return true;
        } catch (error) {
            console.error('Error saving user location:', error);
            throw error;
        }
    }

    /**
     * Obtém a localização de um usuário
     * @param {string} uid - ID do usuário
     */
    async getUserLocation(uid) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const location = await this.client.hGetAll(`locations:${uid}`);
            
            if (!location || Object.keys(location).length === 0) {
                return null;
            }

            return {
                lat: parseFloat(location.lat),
                lng: parseFloat(location.lng),
                updated: parseInt(location.updated),
                error: location.error === 'true'
            };
        } catch (error) {
            console.error('Error getting user location:', error);
            throw error;
        }
    }

    /**
     * Obtém localizações de múltiplos usuários
     * @param {Array} uids - Array de IDs de usuários
     */
    async getMultipleUserLocations(uids) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const pipeline = this.client.multi();
            
            uids.forEach(uid => {
                pipeline.hGetAll(`locations:${uid}`);
            });

            const results = await pipeline.exec();
            const locations = {};

            results.forEach((result, index) => {
                const uid = uids[index];
                const location = result[1]; // result[1] contains the actual data

                if (location && Object.keys(location).length > 0) {
                    locations[uid] = {
                        lat: parseFloat(location.lat),
                        lng: parseFloat(location.lng),
                        updated: parseInt(location.updated),
                        error: location.error === 'true'
                    };
                }
            });

            return locations;
        } catch (error) {
            console.error('Error getting multiple user locations:', error);
            throw error;
        }
    }

    /**
     * Obtém todos os usuários online
     */
    async getOnlineUsers() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const onlineUsers = await this.client.sMembers('users:online');
            return onlineUsers;
        } catch (error) {
            console.error('Error getting online users:', error);
            throw error;
        }
    }

    /**
     * Obtém motoristas próximos a uma localização
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio em km
     */
    async getNearbyDrivers(lat, lng, radius = 5) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const onlineUsers = await this.getOnlineUsers();
            const driverLocations = await this.getMultipleUserLocations(onlineUsers);
            
            const nearbyDrivers = [];

            for (const [uid, location] of Object.entries(driverLocations)) {
                if (!location.error) {
                    const distance = this.calculateDistance(lat, lng, location.lat, location.lng);
                    if (distance <= radius) {
                        nearbyDrivers.push({
                            uid,
                            location,
                            distance
                        });
                    }
                }
            }

            // Ordena por distância
            return nearbyDrivers.sort((a, b) => a.distance - b.distance);
        } catch (error) {
            console.error('Error getting nearby drivers:', error);
            throw error;
        }
    }

    /**
     * Calcula distância entre dois pontos (fórmula de Haversine)
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Raio da Terra em km
        const dLat = this.toRadians(lat2 - lat1);
        const dLng = this.toRadians(lng2 - lng1);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Inscreve para receber atualizações de localização
     * @param {string} uid - ID do usuário
     * @param {Function} callback - Função chamada quando há atualização
     */
    async subscribeToLocation(uid, callback) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const subscriber = this.client.duplicate();
            await subscriber.connect();
            
            await subscriber.subscribe(`location:${uid}`, (message) => {
                try {
                    const location = JSON.parse(message);
                    callback(location);
                } catch (error) {
                    console.error('Error parsing location message:', error);
                }
            });

            this.subscribers.set(uid, subscriber);
            return subscriber;
        } catch (error) {
            console.error('Error subscribing to location:', error);
            throw error;
        }
    }

    /**
     * Cancela inscrição de localização
     * @param {string} uid - ID do usuário
     */
    async unsubscribeFromLocation(uid) {
        const subscriber = this.subscribers.get(uid);
        if (subscriber) {
            await subscriber.unsubscribe(`location:${uid}`);
            await subscriber.disconnect();
            this.subscribers.delete(uid);
        }
    }

    /**
     * Limpa localizações antigas
     */
    async cleanupOldLocations() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const onlineUsers = await this.getOnlineUsers();
            const cutoffTime = Date.now() - (10 * 60 * 1000); // 10 minutos atrás

            for (const uid of onlineUsers) {
                const location = await this.getUserLocation(uid);
                if (location && location.updated < cutoffTime) {
                    await this.client.sRem('users:online', uid);
                    await this.client.sAdd('users:offline', uid);
                }
            }
        } catch (error) {
            console.error('Error cleaning up old locations:', error);
        }
    }
}

// Singleton instance
const redisLocationService = new RedisLocationService();

export default redisLocationService; 
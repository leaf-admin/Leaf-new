import { createClient } from 'redis';
import { FEATURE_FLAGS } from '../config/redisConfig.mjs';

class RedisLocationService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.connectionPromise = null;
    }

    async connect() {
        if (this.isConnected) return;
        
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this._connect();
        return this.connectionPromise;
    }

    async _connect() {
        try {
            this.client = createClient({
                url: 'redis://localhost:6379',
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
                console.error('Redis Location Service Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('Redis Location Service connected');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                console.log('Redis Location Service ready');
            });

            await this.client.connect();
            console.log('Redis Location Service connection established');
        } catch (error) {
            console.error('Failed to connect to Redis Location Service:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
                this.isConnected = false;
                console.log('Redis Location Service disconnected');
            } catch (error) {
                console.error('Error disconnecting Redis Location Service:', error);
            }
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
            const locationData = {
                uid,
                latitude: location.latitude,
                longitude: location.longitude,
                timestamp: Date.now(),
                accuracy: location.accuracy || 0,
                speed: location.speed || 0,
                heading: location.heading || 0
            };

            // Salvar no hash de localizações
            await this.client.hSet(`user_locations`, uid, JSON.stringify(locationData));
            
            // Adicionar ao set de usuários ativos (com TTL de 30 minutos)
            await this.client.sAdd('active_users', uid);
            await this.client.expire('active_users', 1800);

            // Salvar coordenadas para busca geográfica (compatível com Redis Windows)
            const coordinateKey = `coordinates:${uid}`;
            await this.client.hSet(coordinateKey, 
                'latitude', String(location.latitude),
                'longitude', String(location.longitude),
                'timestamp', String(location.timestamp)
            );
            await this.client.expire(coordinateKey, 1800); // 30 minutos

            console.log(`User location saved: ${uid}`);
            return true;
        } catch (error) {
            console.error('Error saving user location to Redis:', error);
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
            const locationData = await this.client.hGet('user_locations', uid);
            if (locationData) {
                return JSON.parse(locationData);
            }
            return null;
        } catch (error) {
            console.error('Error getting user location from Redis:', error);
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
            // Buscar usuários próximos usando GEO commands
            const nearbyUsers = await this.client.geoRadius('user_coordinates', {
                longitude: lng,
                latitude: lat
            }, radius, 'km', {
                WITHCOORD: true,
                WITHDIST: true
            });

            // Filtrar apenas motoristas ativos
            const activeUsers = await this.client.sMembers('active_users');
            const activeUserSet = new Set(activeUsers);

            const nearbyDrivers = nearbyUsers
                .filter(user => activeUserSet.has(user.member))
                .map(user => ({
                    uid: user.member,
                    distance: parseFloat(user.dist),
                    coordinates: {
                        latitude: user.coordinates.latitude,
                        longitude: user.coordinates.longitude
                    }
                }))
                .sort((a, b) => a.distance - b.distance);

            return nearbyDrivers;
        } catch (error) {
            console.error('Error getting nearby drivers from Redis:', error);
            throw error;
        }
    }

    /**
     * Remover usuário da lista de ativos
     * @param {string} uid - ID do usuário
     */
    async removeActiveUser(uid) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            await this.client.sRem('active_users', uid);
            await this.client.hDel('user_locations', uid);
            await this.client.zRem('user_coordinates', uid);
            console.log(`User removed from active list: ${uid}`);
        } catch (error) {
            console.error('Error removing active user from Redis:', error);
            throw error;
        }
    }

    /**
     * Obter todos os usuários ativos
     */
    async getActiveUsers() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const activeUsers = await this.client.sMembers('active_users');
            return activeUsers;
        } catch (error) {
            console.error('Error getting active users from Redis:', error);
            throw error;
        }
    }

    /**
     * Limpar dados antigos (manutenção)
     */
    async cleanupOldData() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const now = Date.now();
            const cutoff = now - (30 * 60 * 1000); // 30 minutos atrás

            const allLocations = await this.client.hGetAll('user_locations');
            const toRemove = [];

            for (const [uid, locationData] of Object.entries(allLocations)) {
                try {
                    const location = JSON.parse(locationData);
                    if (location.timestamp < cutoff) {
                        toRemove.push(uid);
                    }
                } catch (parseError) {
                    console.error('Error parsing location data:', parseError);
                    toRemove.push(uid);
                }
            }

            if (toRemove.length > 0) {
                await this.client.hDel('user_locations', ...toRemove);
                await this.client.sRem('active_users', ...toRemove);
                await this.client.zRem('user_coordinates', ...toRemove);
                console.log(`Cleaned up ${toRemove.length} old location records`);
            }
        } catch (error) {
            console.error('Error cleaning up old data:', error);
            throw error;
        }
    }
}

// Singleton instance
const redisLocationService = new RedisLocationService();

export default redisLocationService; 
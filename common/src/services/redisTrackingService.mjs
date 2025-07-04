import { createClient } from 'redis';
import { FEATURE_FLAGS } from '../config/redisConfig.mjs';

class RedisTrackingService {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.connectionPromise = null;
        this.subscribers = new Map();
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
                console.error('Redis Tracking Service Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('Redis Tracking Service connected');
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                console.log('Redis Tracking Service ready');
            });

            await this.client.connect();
            console.log('Redis Tracking Service connection established');
        } catch (error) {
            console.error('Failed to connect to Redis Tracking Service:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            try {
                await this.client.quit();
                this.isConnected = false;
                console.log('Redis Tracking Service disconnected');
            } catch (error) {
                console.error('Error disconnecting Redis Tracking Service:', error);
            }
        }
    }

    /**
     * Adiciona um ponto de tracking para uma viagem
     * @param {string} bookingId - ID da viagem
     * @param {Object} location - Objeto com lat, lng, status, timestamp
     */
    async addTrackingPoint(bookingId, location) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const trackingPoint = {
                bookingId,
                latitude: location.latitude,
                longitude: location.longitude,
                timestamp: Date.now(),
                accuracy: location.accuracy || 0,
                speed: location.speed || 0,
                heading: location.heading || 0,
                altitude: location.altitude || 0
            };

            // Adicionar à lista de tracking da viagem
            await this.client.lPush(`tracking:${bookingId}`, JSON.stringify(trackingPoint));
            
            // Manter apenas os últimos 100 pontos por viagem
            await this.client.lTrim(`tracking:${bookingId}`, 0, 99);

            // Definir TTL de 24 horas para dados de tracking
            await this.client.expire(`tracking:${bookingId}`, 86400);

            // Salvar último ponto separadamente para acesso rápido
            await this.client.hSet(`last_tracking`, bookingId, JSON.stringify(trackingPoint));
            await this.client.expire(`last_tracking`, 86400);

            // Publicar atualização para subscribers
            await this.client.publish(`tracking:${bookingId}`, JSON.stringify(trackingPoint));

            console.log(`Tracking point added: ${bookingId}`);
            return true;
        } catch (error) {
            console.error('Error adding tracking point to Redis:', error);
            throw error;
        }
    }

    /**
     * Obtém o último ponto de tracking de uma viagem
     * @param {string} bookingId - ID da viagem
     */
    async getLastTrackingPoint(bookingId) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const lastPoint = await this.client.hGet('last_tracking', bookingId);
            if (lastPoint) {
                return JSON.parse(lastPoint);
            }
            return null;
        } catch (error) {
            console.error('Error getting last tracking point from Redis:', error);
            throw error;
        }
    }

    /**
     * Obtém histórico de tracking de uma viagem
     * @param {string} bookingId - ID da viagem
     * @param {number} limit - Número máximo de pontos
     */
    async getTrackingHistory(bookingId, limit = 50) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const trackingData = await this.client.lRange(`tracking:${bookingId}`, 0, limit - 1);
            return trackingData.map(point => JSON.parse(point)).reverse();
        } catch (error) {
            console.error('Error getting tracking history from Redis:', error);
            throw error;
        }
    }

    /**
     * Obtém pontos de tracking em um intervalo de tempo
     * @param {string} bookingId - ID da viagem
     * @param {number} startTime - Timestamp inicial
     * @param {number} endTime - Timestamp final
     */
    async getTrackingInTimeRange(bookingId, startTime, endTime) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const history = await this.getTrackingHistory(bookingId, 1000);
            
            return history.filter(entry => 
                entry.timestamp >= startTime && entry.timestamp <= endTime
            );
        } catch (error) {
            console.error('Error getting tracking in time range:', error);
            throw error;
        }
    }

    /**
     * Calcula distância total de uma viagem
     * @param {string} bookingId - ID da viagem
     */
    async calculateTripDistance(bookingId) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const history = await this.getTrackingHistory(bookingId, 1000);
            
            if (history.length < 2) {
                return { distance: 0, points: history.length };
            }

            let totalDistance = 0;
            const points = [];

            for (let i = 0; i < history.length - 1; i++) {
                const point1 = history[i];
                const point2 = history[i + 1];
                
                const distance = this.calculateDistance(
                    point1.latitude, point1.longitude,
                    point2.latitude, point2.longitude
                );
                
                totalDistance += distance;
                points.push({
                    latitude: point1.latitude,
                    longitude: point1.longitude,
                    timestamp: point1.timestamp
                });
            }

            // Adiciona o último ponto
            points.push({
                latitude: history[history.length - 1].latitude,
                longitude: history[history.length - 1].longitude,
                timestamp: history[history.length - 1].timestamp
            });

            return {
                distance: totalDistance,
                points: points,
                totalPoints: history.length
            };
        } catch (error) {
            console.error('Error calculating trip distance:', error);
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
     * Inscreve para receber atualizações de tracking
     * @param {string} bookingId - ID da viagem
     * @param {Function} callback - Função chamada quando há atualização
     */
    async subscribeToTracking(bookingId, callback) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const subscriber = this.client.duplicate();
            await subscriber.connect();
            
            await subscriber.subscribe(`tracking:${bookingId}`, (message) => {
                try {
                    const trackingPoint = JSON.parse(message);
                    callback(trackingPoint);
                } catch (error) {
                    console.error('Error parsing tracking message:', error);
                }
            });

            this.subscribers.set(bookingId, subscriber);
            console.log(`Subscribed to tracking: ${bookingId}`);
            return subscriber;
        } catch (error) {
            console.error('Error subscribing to tracking:', error);
            throw error;
        }
    }

    /**
     * Cancela inscrição de tracking
     * @param {string} bookingId - ID da viagem
     */
    async unsubscribeFromTracking(bookingId) {
        const subscriber = this.subscribers.get(bookingId);
        if (subscriber) {
            try {
                await subscriber.unsubscribe(`tracking:${bookingId}`);
                await subscriber.quit();
                this.subscribers.delete(bookingId);
                console.log(`Unsubscribed from tracking: ${bookingId}`);
            } catch (error) {
                console.error('Error unsubscribing from tracking:', error);
            }
        }
    }

    /**
     * Obtém viagens ativas (com tracking recente)
     */
    async getActiveBookings() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const activeBookings = await this.client.hKeys('last_tracking');
            return activeBookings;
        } catch (error) {
            console.error('Error getting active bookings from Redis:', error);
            throw error;
        }
    }

    /**
     * Limpa dados de tracking antigos
     * @param {number} maxAge - Idade máxima em horas
     */
    async cleanupOldTracking(maxAge = 24) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const now = Date.now();
            const cutoff = now - (maxAge * 60 * 60 * 1000); // 24 horas atrás

            const allLastTracking = await this.client.hGetAll('last_tracking');
            const toRemove = [];

            for (const [bookingId, trackingData] of Object.entries(allLastTracking)) {
                try {
                    const tracking = JSON.parse(trackingData);
                    if (tracking.timestamp < cutoff) {
                        toRemove.push(bookingId);
                    }
                } catch (parseError) {
                    console.error('Error parsing tracking data:', parseError);
                    toRemove.push(bookingId);
                }
            }

            if (toRemove.length > 0) {
                // Remover dados de tracking antigos
                for (const bookingId of toRemove) {
                    await this.client.del(`tracking:${bookingId}`);
                }
                
                await this.client.hDel('last_tracking', ...toRemove);
                console.log(`Cleaned up ${toRemove.length} old tracking records`);
            }
        } catch (error) {
            console.error('Error cleaning up old tracking data:', error);
            throw error;
        }
    }

    /**
     * Obtém estatísticas de tracking
     */
    async getTrackingStats(bookingId) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const history = await this.getTrackingHistory(bookingId, 100);
            
            if (history.length === 0) {
                return null;
            }

            const totalDistance = this.calculateTotalDistance(history);
            const avgSpeed = this.calculateAverageSpeed(history);
            const duration = history.length > 1 ? 
                history[history.length - 1].timestamp - history[0].timestamp : 0;

            return {
                totalPoints: history.length,
                totalDistance: totalDistance,
                averageSpeed: avgSpeed,
                duration: duration,
                startTime: history[0].timestamp,
                endTime: history[history.length - 1].timestamp
            };
        } catch (error) {
            console.error('Error getting tracking stats from Redis:', error);
            throw error;
        }
    }

    // Calcular distância total
    calculateTotalDistance(trackingPoints) {
        let totalDistance = 0;
        
        for (let i = 1; i < trackingPoints.length; i++) {
            const prev = trackingPoints[i - 1];
            const curr = trackingPoints[i];
            totalDistance += this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            );
        }
        
        return totalDistance;
    }

    // Calcular velocidade média
    calculateAverageSpeed(trackingPoints) {
        if (trackingPoints.length < 2) return 0;
        
        const totalSpeed = trackingPoints.reduce((sum, point) => sum + (point.speed || 0), 0);
        return totalSpeed / trackingPoints.length;
    }
}

// Singleton instance
const redisTrackingService = new RedisTrackingService();

export default redisTrackingService; 
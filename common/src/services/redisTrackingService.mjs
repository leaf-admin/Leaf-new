import { createClient } from 'redis';

class RedisTrackingService {
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
                console.error('Redis Tracking Client Error:', err);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log('Redis Tracking connected successfully');
                this.isConnected = true;
            });

            await this.client.connect();
            return true;
        } catch (error) {
            console.error('Failed to connect to Redis Tracking:', error);
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
     * Adiciona um ponto de tracking para uma viagem
     * @param {string} bookingId - ID da viagem
     * @param {Object} location - Objeto com lat, lng, status, timestamp
     */
    async addTrackingPoint(bookingId, location) {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const trackingData = {
                lat: String(location.lat),
                lng: String(location.lng),
                status: String(location.status),
                timestamp: String(location.at || Date.now()),
                speed: location.speed ? String(location.speed) : '',
                heading: location.heading ? String(location.heading) : ''
            };

            // Usa lista para tracking em tempo real (compatível com Redis Windows)
            const listKey = `tracking:${bookingId}`;
            const trackingEntry = JSON.stringify(trackingData);
            
            // Adiciona à lista
            await this.client.lPush(listKey, trackingEntry);
            
            // Mantém apenas os últimos 100 pontos
            await this.client.lTrim(listKey, 0, 99);

            // Publica atualização para subscribers
            await this.client.publish(`tracking:${bookingId}`, JSON.stringify({
                id: Date.now().toString(),
                data: trackingData
            }));

            // Salva último ponto em hash para acesso rápido
            await this.client.hSet(`tracking:last:${bookingId}`,
                'lat', trackingData.lat,
                'lng', trackingData.lng,
                'status', trackingData.status,
                'timestamp', trackingData.timestamp,
                'speed', trackingData.speed,
                'heading', trackingData.heading
            );
            await this.client.expire(`tracking:last:${bookingId}`, 3600); // 1 hora

            return Date.now().toString();
        } catch (error) {
            console.error('Error adding tracking point:', error);
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
            const lastPoint = await this.client.hGetAll(`tracking:last:${bookingId}`);
            
            if (!lastPoint || Object.keys(lastPoint).length === 0) {
                return null;
            }

            return {
                lat: parseFloat(lastPoint.lat),
                lng: parseFloat(lastPoint.lng),
                status: lastPoint.status,
                timestamp: parseInt(lastPoint.timestamp),
                speed: lastPoint.speed ? parseFloat(lastPoint.speed) : null,
                heading: lastPoint.heading ? parseFloat(lastPoint.heading) : null
            };
        } catch (error) {
            console.error('Error getting last tracking point:', error);
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
            const listKey = `tracking:${bookingId}`;
            const entries = await this.client.lRange(listKey, 0, limit - 1);
            
            return entries.map((entry, index) => {
                const data = JSON.parse(entry);
                return {
                    id: `${bookingId}-${index}`,
                    lat: parseFloat(data.lat),
                    lng: parseFloat(data.lng),
                    status: data.status,
                    timestamp: parseInt(data.timestamp),
                    speed: data.speed ? parseFloat(data.speed) : null,
                    heading: data.heading ? parseFloat(data.heading) : null
                };
            }).reverse(); // Inverte para ordem cronológica
        } catch (error) {
            console.error('Error getting tracking history:', error);
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
                    point1.lat, point1.lng,
                    point2.lat, point2.lng
                );
                
                totalDistance += distance;
                points.push({
                    lat: point1.lat,
                    lng: point1.lng,
                    timestamp: point1.timestamp
                });
            }

            // Adiciona o último ponto
            points.push({
                lat: history[history.length - 1].lat,
                lng: history[history.length - 1].lng,
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
                    const trackingData = JSON.parse(message);
                    callback(trackingData);
                } catch (error) {
                    console.error('Error parsing tracking message:', error);
                }
            });

            this.subscribers.set(bookingId, subscriber);
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
            await subscriber.unsubscribe(`tracking:${bookingId}`);
            await subscriber.disconnect();
            this.subscribers.delete(bookingId);
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
            const keys = await this.client.keys('tracking:last:*');
            const activeBookings = [];

            for (const key of keys) {
                const bookingId = key.replace('tracking:last:', '');
                const lastPoint = await this.getLastTrackingPoint(bookingId);
                
                if (lastPoint && (Date.now() - lastPoint.timestamp) < 300000) { // 5 minutos
                    activeBookings.push({
                        bookingId,
                        lastPoint
                    });
                }
            }

            return activeBookings;
        } catch (error) {
            console.error('Error getting active bookings:', error);
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
            const cutoffTime = Date.now() - (maxAge * 60 * 60 * 1000);
            const keys = await this.client.keys('tracking:*');
            
            for (const key of keys) {
                if (key.includes('tracking:last:')) {
                    const lastPoint = await this.client.hGetAll(key);
                    if (lastPoint.timestamp && parseInt(lastPoint.timestamp) < cutoffTime) {
                        await this.client.del(key);
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning up old tracking:', error);
        }
    }

    /**
     * Obtém estatísticas de tracking
     */
    async getTrackingStats() {
        if (!this.isConnected) {
            throw new Error('Redis not connected');
        }

        try {
            const activeBookings = await this.getActiveBookings();
            const totalStreams = await this.client.keys('tracking:*');
            
            return {
                activeBookings: activeBookings.length,
                totalStreams: totalStreams.length,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('Error getting tracking stats:', error);
            throw error;
        }
    }
}

// Singleton instance
const redisTrackingService = new RedisTrackingService();

export default redisTrackingService; 
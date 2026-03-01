/**
 * Rate Limiter para Conexões WebSocket
 * 
 * Previne:
 * - Múltiplas conexões do mesmo IP
 * - Ataques de conexão em massa
 * - Esgotamento de recursos
 */

const { logger } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');

class WebSocketRateLimiter {
    constructor() {
        this.redis = redisPool.getConnection();
        this.connectionCounts = new Map(); // Cache em memória para acesso rápido
        
        // Configurações
        this.config = {
            maxConnectionsPerIP: 5,        // Máximo 5 conexões por IP
            maxConnectionsPerUser: 1,      // Máximo 1 conexão por usuário (sessão única)
            maxConnectionsPerSecond: 10,   // Máximo 10 conexões por segundo por IP
            windowSeconds: 60,             // Janela de tempo para rate limiting
            cleanupInterval: 60000          // Limpar contadores a cada minuto
        };

        // Limpar contadores periodicamente
        setInterval(() => {
            this.cleanupCounters();
        }, this.config.cleanupInterval);
    }

    /**
     * Verificar se conexão é permitida
     * @param {Socket} socket - Socket do cliente
     * @returns {Promise<{allowed: boolean, reason?: string}>}
     */
    async checkConnection(socket) {
        try {
            const ip = this.getClientIP(socket);
            const userId = socket.userId || null;

            // 1. Verificar limite por IP
            const ipCount = await this.getConnectionCount('ip', ip);
            if (ipCount >= this.config.maxConnectionsPerIP) {
                logger.warn(`⚠️ [WebSocketRateLimiter] Limite de conexões por IP excedido: ${ip} (${ipCount}/${this.config.maxConnectionsPerIP})`);
                return {
                    allowed: false,
                    reason: `Limite de ${this.config.maxConnectionsPerIP} conexões por IP excedido`
                };
            }

            // 2. Verificar limite por usuário (se autenticado)
            if (userId) {
                const userCount = await this.getConnectionCount('user', userId);
                if (userCount >= this.config.maxConnectionsPerUser) {
                    logger.warn(`⚠️ [WebSocketRateLimiter] Limite de conexões por usuário excedido: ${userId} (${userCount}/${this.config.maxConnectionsPerUser})`);
                    return {
                        allowed: false,
                        reason: `Limite de ${this.config.maxConnectionsPerUser} conexão por usuário excedido`
                    };
                }
            }

            // 3. Verificar rate limiting por segundo
            const rateLimitKey = `rate_limit:ip:${ip}`;
            const currentRate = await this.redis.incr(rateLimitKey);
            await this.redis.expire(rateLimitKey, 1); // Expira em 1 segundo

            if (currentRate > this.config.maxConnectionsPerSecond) {
                logger.warn(`⚠️ [WebSocketRateLimiter] Rate limit excedido: ${ip} (${currentRate}/${this.config.maxConnectionsPerSecond} por segundo)`);
                return {
                    allowed: false,
                    reason: `Muitas conexões por segundo (máximo: ${this.config.maxConnectionsPerSecond})`
                };
            }

            // 4. Registrar conexão
            await this.registerConnection(socket, ip, userId);

            return { allowed: true };
        } catch (error) {
            logger.error(`❌ [WebSocketRateLimiter] Erro ao verificar conexão:`, error);
            // Em caso de erro, permitir conexão (fail-open)
            return { allowed: true };
        }
    }

    /**
     * Registrar conexão
     * @param {Socket} socket - Socket do cliente
     * @param {string} ip - IP do cliente
     * @param {string} userId - ID do usuário (se autenticado)
     */
    async registerConnection(socket, ip, userId) {
        try {
            const socketId = socket.id;
            const timestamp = Date.now();

            // Registrar no Redis
            await this.redis.hset(`connection:${socketId}`, {
                ip,
                userId: userId || 'anonymous',
                connectedAt: timestamp,
                workerId: socket.workerId || 'main'
            });

            // Incrementar contadores
            await this.redis.incr(`connections:ip:${ip}`);
            if (userId) {
                await this.redis.incr(`connections:user:${userId}`);
            }

            // Armazenar no cache em memória
            this.connectionCounts.set(`ip:${ip}`, (this.connectionCounts.get(`ip:${ip}`) || 0) + 1);
            if (userId) {
                this.connectionCounts.set(`user:${userId}`, (this.connectionCounts.get(`user:${userId}`) || 0) + 1);
            }

            logger.debug(`✅ [WebSocketRateLimiter] Conexão registrada: ${socketId} (IP: ${ip}, User: ${userId || 'anonymous'})`);
        } catch (error) {
            logger.error(`❌ [WebSocketRateLimiter] Erro ao registrar conexão:`, error);
        }
    }

    /**
     * Remover conexão
     * @param {Socket} socket - Socket do cliente
     */
    async unregisterConnection(socket) {
        try {
            const socketId = socket.id;
            const connectionData = await this.redis.hgetall(`connection:${socketId}`);

            if (connectionData && Object.keys(connectionData).length > 0) {
                const ip = connectionData.ip;
                const userId = connectionData.userId;

                // Decrementar contadores
                const ipCount = await this.redis.decr(`connections:ip:${ip}`);
                if (ipCount <= 0) {
                    await this.redis.del(`connections:ip:${ip}`);
                }

                if (userId && userId !== 'anonymous') {
                    const userCount = await this.redis.decr(`connections:user:${userId}`);
                    if (userCount <= 0) {
                        await this.redis.del(`connections:user:${userId}`);
                    }
                }

                // Remover do cache em memória
                const currentIpCount = this.connectionCounts.get(`ip:${ip}`) || 0;
                if (currentIpCount > 0) {
                    this.connectionCounts.set(`ip:${ip}`, currentIpCount - 1);
                }

                if (userId && userId !== 'anonymous') {
                    const currentUserCount = this.connectionCounts.get(`user:${userId}`) || 0;
                    if (currentUserCount > 0) {
                        this.connectionCounts.set(`user:${userId}`, currentUserCount - 1);
                    }
                }

                // Remover registro da conexão
                await this.redis.del(`connection:${socketId}`);

                logger.debug(`🗑️ [WebSocketRateLimiter] Conexão removida: ${socketId}`);
            }
        } catch (error) {
            logger.error(`❌ [WebSocketRateLimiter] Erro ao remover conexão:`, error);
        }
    }

    /**
     * Obter contagem de conexões
     * @param {string} type - Tipo ('ip' ou 'user')
     * @param {string} identifier - IP ou userId
     * @returns {Promise<number>}
     */
    async getConnectionCount(type, identifier) {
        try {
            // Tentar cache em memória primeiro
            const cacheKey = `${type}:${identifier}`;
            if (this.connectionCounts.has(cacheKey)) {
                return this.connectionCounts.get(cacheKey);
            }

            // Buscar do Redis
            const count = await this.redis.get(`connections:${type}:${identifier}`) || 0;
            const countNum = parseInt(count);

            // Armazenar no cache
            this.connectionCounts.set(cacheKey, countNum);

            return countNum;
        } catch (error) {
            logger.warn(`⚠️ [WebSocketRateLimiter] Erro ao obter contagem:`, error.message);
            return 0;
        }
    }

    /**
     * Obter IP do cliente
     * @param {Socket} socket - Socket do cliente
     * @returns {string}
     */
    getClientIP(socket) {
        const headers = socket.handshake.headers;
        const forwarded = headers['x-forwarded-for'];
        
        if (forwarded) {
            return forwarded.split(',')[0].trim();
        }
        
        return socket.handshake.address || socket.conn.remoteAddress || 'unknown';
    }

    /**
     * Limpar contadores expirados
     */
    cleanupCounters() {
        // Limpar cache em memória (será atualizado na próxima verificação)
        this.connectionCounts.clear();
        logger.debug(`🧹 [WebSocketRateLimiter] Contadores limpos`);
    }

    /**
     * Obter estatísticas
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const RedisScan = require('../utils/redis-scan');
            const connectionKeys = await RedisScan.scanKeys(this.redis, 'connection:*');
            const ipKeys = await RedisScan.scanKeys(this.redis, 'connections:ip:*');
            const userKeys = await RedisScan.scanKeys(this.redis, 'connections:user:*');

            return {
                totalConnections: connectionKeys.length,
                uniqueIPs: ipKeys.length,
                authenticatedUsers: userKeys.length,
                memoryCacheSize: this.connectionCounts.size
            };
        } catch (error) {
            logger.error(`❌ [WebSocketRateLimiter] Erro ao obter estatísticas:`, error);
            return {
                totalConnections: 0,
                uniqueIPs: 0,
                authenticatedUsers: 0,
                memoryCacheSize: 0
            };
        }
    }
}

// Singleton instance
const websocketRateLimiter = new WebSocketRateLimiter();

module.exports = websocketRateLimiter;


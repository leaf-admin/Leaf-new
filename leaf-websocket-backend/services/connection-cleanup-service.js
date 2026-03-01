/**
 * Serviço de Limpeza Automática de Conexões
 * 
 * Remove conexões "fantasma" que não foram desconectadas corretamente:
 * - Conexões sem heartbeat há mais de X minutos
 * - Conexões com TTL expirado
 * - Conexões órfãs no Redis
 */

const { logger } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const connectionMonitor = require('./connection-monitor');
const websocketRateLimiter = require('../middleware/websocket-rate-limiter');

class ConnectionCleanupService {
    constructor(io) {
        this.io = io;
        this.redis = redisPool.getConnection();
        this.intervalId = null;
        this.isRunning = false;
        
        // Configurações
        this.config = {
            cleanupInterval: 60000,        // Limpar a cada 1 minuto
            heartbeatTimeout: 120000,       // 2 minutos sem heartbeat = desconectado
            orphanedConnectionTTL: 300000  // 5 minutos = conexão órfã
        };
    }

    /**
     * Iniciar serviço de limpeza
     */
    start() {
        if (this.isRunning) {
            logger.warn('⚠️ [ConnectionCleanupService] Serviço já está rodando');
            return;
        }

        this.isRunning = true;
        logger.info('🚀 [ConnectionCleanupService] Serviço de limpeza iniciado');

        // Executar limpeza imediatamente
        this.cleanup();

        // Executar limpeza periodicamente
        this.intervalId = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupInterval);
    }

    /**
     * Parar serviço de limpeza
     */
    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        logger.info('🛑 [ConnectionCleanupService] Serviço de limpeza parado');
    }

    /**
     * Executar limpeza de conexões
     */
    async cleanup() {
        try {
            logger.debug('🧹 [ConnectionCleanupService] Iniciando limpeza de conexões...');

            const stats = {
                heartbeatExpired: 0,
                orphanedConnections: 0,
                redisCleanup: 0,
                total: 0
            };

            // 1. Limpar conexões sem heartbeat
            stats.heartbeatExpired = await this.cleanupExpiredHeartbeats();

            // 2. Limpar conexões órfãs no Redis
            stats.orphanedConnections = await this.cleanupOrphanedConnections();

            // 3. Limpar registros órfãos no Redis
            stats.redisCleanup = await this.cleanupRedisOrphans();

            stats.total = stats.heartbeatExpired + stats.orphanedConnections + stats.redisCleanup;

            if (stats.total > 0) {
                logger.info(`✅ [ConnectionCleanupService] Limpeza concluída: ${stats.total} conexões removidas (heartbeat: ${stats.heartbeatExpired}, órfãs: ${stats.orphanedConnections}, Redis: ${stats.redisCleanup})`);
            } else {
                logger.debug(`✅ [ConnectionCleanupService] Nenhuma conexão para limpar`);
            }
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao executar limpeza:`, error);
        }
    }

    /**
     * Limpar conexões sem heartbeat
     * @returns {Promise<number>} Número de conexões removidas
     */
    async cleanupExpiredHeartbeats() {
        try {
            let removed = 0;
            const now = Date.now();
            const timeout = this.config.heartbeatTimeout;

            // Verificar todas as conexões ativas
            const sockets = await this.io.sockets.fetchSockets();
            
            for (const socket of sockets) {
                const lastHeartbeat = socket.lastHeartbeat || socket.handshake.time || now;
                const timeSinceHeartbeat = now - lastHeartbeat;

                if (timeSinceHeartbeat > timeout) {
                    logger.warn(`⚠️ [ConnectionCleanupService] Conexão sem heartbeat há ${Math.round(timeSinceHeartbeat / 1000)}s: ${socket.id}`);
                    
                    // Desconectar socket
                    socket.disconnect(true);
                    removed++;
                }
            }

            return removed;
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao limpar heartbeats expirados:`, error);
            return 0;
        }
    }

    /**
     * Limpar conexões órfãs (registradas mas não conectadas)
     * @returns {Promise<number>} Número de conexões removidas
     */
    async cleanupOrphanedConnections() {
        try {
            let removed = 0;
            const RedisScan = require('../utils/redis-scan');
            const connectionKeys = await RedisScan.scanKeys(this.redis, 'connection:*');

            for (const key of connectionKeys) {
                const connectionData = await this.redis.hgetall(key);
                
                if (connectionData && Object.keys(connectionData).length > 0) {
                    const socketId = key.replace('connection:', '');
                    const connectedAt = parseInt(connectionData.connectedAt || 0);
                    const age = Date.now() - connectedAt;

                    // Verificar se socket ainda existe
                    const socket = this.io.sockets.sockets.get(socketId);
                    
                    if (!socket && age > this.config.orphanedConnectionTTL) {
                        // Conexão órfã - remover
                        await this.redis.del(key);
                        await websocketRateLimiter.unregisterConnection({ id: socketId });
                        removed++;
                        logger.debug(`🗑️ [ConnectionCleanupService] Conexão órfã removida: ${socketId}`);
                    }
                }
            }

            return removed;
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao limpar conexões órfãs:`, error);
            return 0;
        }
    }

    /**
     * Limpar registros órfãos no Redis (contadores sem conexões)
     * @returns {Promise<number>} Número de registros removidos
     */
    async cleanupRedisOrphans() {
        try {
            let removed = 0;
            const RedisScan = require('../utils/redis-scan');
            
            // Limpar contadores de IP sem conexões
            const ipKeys = await RedisScan.scanKeys(this.redis, 'connections:ip:*');
            for (const key of ipKeys) {
                const count = await this.redis.get(key);
                if (count && parseInt(count) <= 0) {
                    await this.redis.del(key);
                    removed++;
                }
            }

            // Limpar contadores de usuário sem conexões
            const userKeys = await RedisScan.scanKeys(this.redis, 'connections:user:*');
            for (const key of userKeys) {
                const count = await this.redis.get(key);
                if (count && parseInt(count) <= 0) {
                    await this.redis.del(key);
                    removed++;
                }
            }

            return removed;
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao limpar registros órfãos:`, error);
            return 0;
        }
    }

    /**
     * Obter estatísticas do serviço
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const RedisScan = require('../utils/redis-scan');
            const connectionKeys = await RedisScan.scanKeys(this.redis, 'connection:*');
            const activeSockets = this.io.sockets.sockets.size;

            return {
                isRunning: this.isRunning,
                activeSockets,
                registeredConnections: connectionKeys.length,
                orphanedConnections: connectionKeys.length - activeSockets,
                lastCleanup: new Date().toISOString()
            };
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao obter estatísticas:`, error);
            return {
                isRunning: this.isRunning,
                activeSockets: 0,
                registeredConnections: 0,
                orphanedConnections: 0,
                lastCleanup: null
            };
        }
    }
}

module.exports = ConnectionCleanupService;


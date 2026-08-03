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
const {
    closeDriverOnlineSessionAt
} = require('./driver-online-time-policy-service');
const {
    commitDriverOnlineProjection
} = require('./driver-online-projection-service');

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
            orphanedConnectionTTL: 300000,  // 5 minutos = conexão órfã
            eligibleGeoStaleMs: Number.parseInt(process.env.ELIGIBLE_GEO_STALE_MS || '180000', 10) // 3 min
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

            // 4. Limpar pool GEO elegível com drivers stale/offline
            stats.eligibleGeoCleanup = await this.cleanupEligibleGeoStaleDrivers();

            stats.total = stats.heartbeatExpired + stats.orphanedConnections + stats.redisCleanup + stats.eligibleGeoCleanup;

            if (stats.total > 0) {
                logger.info(`✅ [ConnectionCleanupService] Limpeza concluída: ${stats.total} registros removidos (heartbeat: ${stats.heartbeatExpired}, órfãs: ${stats.orphanedConnections}, Redis: ${stats.redisCleanup}, geoElegível: ${stats.eligibleGeoCleanup})`);
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

            // Fast-path local: evita varredura cluster-wide em cada ciclo.
            const connectedUsers = this.io?.connectedUsers instanceof Map
                ? Array.from(this.io.connectedUsers.values()).filter(Boolean)
                : [];
            const sockets = connectedUsers.length > 0
                ? connectedUsers
                : await this.io.sockets.fetchSockets();

            for (const socket of sockets) {
                // Aplicar regra apenas para motoristas (passageiro não envia heartbeat de localização)
                if (socket?.userType !== 'driver') {
                    continue;
                }

                const lastHeartbeatRaw = socket.lastHeartbeat || socket.lastDriverHeartbeatAt || socket.lastLocationAt || 0;
                const lastHeartbeat = Number.parseInt(String(lastHeartbeatRaw || '0'), 10);
                if (!Number.isFinite(lastHeartbeat) || lastHeartbeat <= 0) {
                    // Sem heartbeat conhecido: não derrubar conexão por heurística agressiva.
                    continue;
                }

                const timeSinceHeartbeat = now - lastHeartbeat;

                if (timeSinceHeartbeat > timeout) {
                    logger.warn(`⚠️ [ConnectionCleanupService] Conexão sem heartbeat há ${Math.round(timeSinceHeartbeat / 1000)}s: ${socket.id}`);

                    const driverId = socket.userId || socket.driverId;
                    const closedAtMs = lastHeartbeat + timeout;
                    if (driverId) {
                        try {
                            const transition = await closeDriverOnlineSessionAt(this.redis, {
                                driverId,
                                closedAtMs
                            });
                            const checkedAt = new Date(closedAtMs).toISOString();
                            await commitDriverOnlineProjection(this.redis, {
                                driverId,
                                eligibleGeoKey: process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible',
                                isOnline: false,
                                dispatchEligible: false,
                                fields: {
                                    status: 'OFFLINE',
                                    isOnline: 'false',
                                    dispatchEligible: 'false',
                                    dispatchEligibilityCode: 'STALE_HEARTBEAT',
                                    dispatchEligibilityCheckedAt: checkedAt,
                                    updatedAt: checkedAt
                                }
                            });
                            socket.emit?.('driverStatusUpdated', {
                                success: true,
                                driverId,
                                status: 'OFFLINE',
                                isOnline: false,
                                dispatchEligible: false,
                                code: 'STALE_HEARTBEAT',
                                driverOnlineDaily: transition.snapshot,
                                checkedAt: new Date(closedAtMs).toISOString()
                            });
                        } catch (error) {
                            logger.error(`❌ [ConnectionCleanupService] Erro ao fechar tempo online stale do motorista ${driverId}:`, error);
                        }
                    }

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
     * Limpar motoristas stale/offline do pool geo elegível de dispatch.
     * Evita dispatch para drivers órfãos após restart/deploy abrupto.
     * @returns {Promise<number>} Número de drivers removidos do pool elegível.
     */
    async cleanupEligibleGeoStaleDrivers() {
        try {
            const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
            const driverIds = await this.redis.zrange(eligibleDriverGeoKey, 0, -1);
            if (!Array.isArray(driverIds) || driverIds.length === 0) {
                return 0;
            }

            const now = Date.now();
            const staleThresholdMs = Math.max(60000, this.config.eligibleGeoStaleMs);
            const readPipeline = this.redis.pipeline();
            driverIds.forEach((driverId) => {
                readPipeline.hmget(`driver:${driverId}`, 'isOnline', 'dispatchEligible', 'lastUpdate', 'timestamp');
            });

            const snapshots = await readPipeline.exec();
            const cleanupPipeline = this.redis.pipeline();
            let removed = 0;

            for (let i = 0; i < driverIds.length; i += 1) {
                const driverId = driverIds[i];
                const result = snapshots?.[i]?.[1] || [];
                const [isOnlineRaw, dispatchEligibleRaw, lastUpdateRaw, timestampRaw] = result;

                const isOnline = String(isOnlineRaw || '').toLowerCase() === 'true';
                const dispatchEligible = String(dispatchEligibleRaw || '').toLowerCase() === 'true';
                const lastUpdate = Number.parseInt(lastUpdateRaw || timestampRaw || '0', 10);
                const stale = !Number.isFinite(lastUpdate) || lastUpdate <= 0 || (now - lastUpdate > staleThresholdMs);

                const localSocket = this.io?.connectedUsers?.get?.(String(driverId));
                const hasLocalConnectedDriver = Boolean(
                    localSocket &&
                    localSocket.userType === 'driver' &&
                    localSocket.id
                );
                const shouldRemoveForStale = stale && !hasLocalConnectedDriver;
                if (!isOnline || !dispatchEligible || shouldRemoveForStale) {
                    cleanupPipeline.zrem(eligibleDriverGeoKey, driverId);
                    if (!isOnline || shouldRemoveForStale) {
                        cleanupPipeline.srem('online_drivers', driverId);
                    }
                    removed += 1;
                }
            }

            if (removed > 0) {
                await cleanupPipeline.exec();
                logger.warn(`⚠️ [ConnectionCleanupService] Removidos ${removed} motoristas stale/offline do GEO elegível`);
            }

            return removed;
        } catch (error) {
            logger.error(`❌ [ConnectionCleanupService] Erro ao limpar GEO elegível:`, error);
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

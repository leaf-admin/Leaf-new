const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');

class HeartbeatService {
    constructor() {
        this.PREFIX = 'driver_status:';
        this.OFFLINE_THRESHOLD_MS = 65000; // 65 seconds (allows 1 missed 30s ping plus 5s latency)
    }

    /**
     * Processa o ping do motorista para monitorar a conexão e contabilizar tempo offline
     * @param {string} driverId - O ID do motorista
     * @returns {Promise<void>}
     */
    async ping(driverId) {
        if (!driverId) return;

        try {
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const key = `${this.PREFIX}${driverId}`;
            const now = Date.now();

            const status = await redis.hgetall(key);
            let cumulativeOfflineMs = 0;

            if (status && status.lastPingAt) {
                const timeSinceLastPing = now - parseInt(status.lastPingAt);
                cumulativeOfflineMs = parseInt(status.cumulativeOfflineMs || 0);

                // Se passou o limite de tolerância, consideramos que esteve offline
                if (timeSinceLastPing > this.OFFLINE_THRESHOLD_MS) {
                    cumulativeOfflineMs += timeSinceLastPing;
                    logStructured('warn', `Motorista reconectado após período offline`, {
                        service: 'HeartbeatService',
                        driverId,
                        offlineTimeAddedMs: timeSinceLastPing,
                        totalCumulativeOfflineMs: cumulativeOfflineMs
                    });
                }
            }

            // Atualiza o ping atual e o tempo acumulado
            await redis.hmset(key, {
                lastPingAt: now,
                cumulativeOfflineMs: cumulativeOfflineMs
            });

            // Expira em 12 horas para não acumular lixo no Redis se o motorista parar de trabalhar
            await redis.expire(key, 43200);
        } catch (error) {
            logStructured('error', 'Erro ao processar heartbeat', {
                service: 'HeartbeatService',
                driverId,
                error: error.message
            });
        }
    }

    /**
     * Retorna o tempo total que o motorista passou offline durante a corrida atual.
     * Deve ser chamado e resetado ao finalizar uma corrida.
     * @param {string} driverId - O ID do motorista
     * @returns {Promise<number>} - O tempo offline em milissegundos
     */
    async getAndResetOfflineTime(driverId) {
        if (!driverId) return 0;
        try {
            await redisPool.ensureConnection();
            const redis = redisPool.getConnection();
            const key = `${this.PREFIX}${driverId}`;

            const status = await redis.hgetall(key);
            const cumulativeOfflineMs = parseInt(status?.cumulativeOfflineMs || 0);

            // Reseta o contador para a próxima corrida mantendo o lastPingAt
            if (status && status.lastPingAt) {
                await redis.hmset(key, {
                    lastPingAt: status.lastPingAt,
                    cumulativeOfflineMs: 0
                });
            }

            return cumulativeOfflineMs;
        } catch (error) {
            logStructured('error', 'Erro ao buscar offline time', {
                service: 'HeartbeatService',
                driverId,
                error: error.message
            });
            return 0; // Se falhar, assume 0 para não prejudicar a corrida
        }
    }
}

module.exports = new HeartbeatService();

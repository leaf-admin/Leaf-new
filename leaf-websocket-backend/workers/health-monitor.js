/**
 * HEALTH MONITOR
 * 
 * Monitora saúde dos workers e expõe métricas.
 */

const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');

class WorkerHealthMonitor {
    constructor(streamName = 'ride_events', groupName = 'listener-workers') {
        this.streamName = streamName;
        this.groupName = groupName;
        this.redis = null;
    }

    async initialize() {
        try {
            await redisPool.ensureConnection();
            this.redis = redisPool.getConnection();
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Obter informações do Consumer Group
     */
    async getGroupInfo() {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const info = await this.redis.xinfo('GROUPS', this.streamName);
            const groupInfo = info.find(g => g[1] === this.groupName);
            
            if (!groupInfo) {
                return null;
            }

            // Converter array para objeto
            const result = {};
            for (let i = 0; i < groupInfo.length; i += 2) {
                result[groupInfo[i]] = groupInfo[i + 1];
            }

            return result;
        } catch (error) {
            logStructured('error', 'Erro ao obter info do Consumer Group', {
                service: 'worker-health-monitor',
                error: error.message
            });
            return null;
        }
    }

    /**
     * Obter lista de consumers ativos
     */
    async getConsumers() {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const consumers = await this.redis.xinfo('CONSUMERS', this.streamName, this.groupName);
            
            // Converter array de arrays para array de objetos
            const result = [];
            for (const consumer of consumers) {
                const consumerObj = {};
                for (let i = 0; i < consumer.length; i += 2) {
                    consumerObj[consumer[i]] = consumer[i + 1];
                }
                result.push(consumerObj);
            }

            return result;
        } catch (error) {
            logStructured('error', 'Erro ao obter consumers', {
                service: 'worker-health-monitor',
                error: error.message
            });
            return [];
        }
    }

    /**
     * Obter eventos pendentes (não ACK)
     */
    async getPendingEvents(consumerName = null, count = 10) {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const pending = await this.redis.xpending(
                this.streamName,
                this.groupName,
                consumerName || '-',
                '+',
                count
            );

            return pending;
        } catch (error) {
            logStructured('error', 'Erro ao obter eventos pendentes', {
                service: 'worker-health-monitor',
                error: error.message
            });
            return [];
        }
    }

    /**
     * Obter lag do stream (eventos não processados)
     */
    async getStreamLag() {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const groupInfo = await this.getGroupInfo();
            if (!groupInfo) {
                return null;
            }

            // Último ID processado pelo grupo
            const lastDeliveredId = groupInfo['last-delivered-id'] || '0-0';
            
            // Último ID no stream
            const streamInfo = await this.redis.xinfo('STREAM', this.streamName);
            const lastEntryId = streamInfo.find((v, i) => streamInfo[i - 1] === 'last-entry') || '0-0';

            // Calcular lag (simplificado - comparar IDs)
            // Em produção, usar biblioteca para comparar IDs corretamente
            const lag = parseInt(lastEntryId.split('-')[0]) - parseInt(lastDeliveredId.split('-')[0]);

            return {
                lag,
                lastDeliveredId,
                lastEntryId
            };
        } catch (error) {
            logStructured('error', 'Erro ao calcular lag', {
                service: 'worker-health-monitor',
                error: error.message
            });
            return null;
        }
    }

    /**
     * Obter tamanho da DLQ
     */
    async getDLQSize() {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const dlqSize = await this.redis.xlen('ride_events_dlq');
            metrics.setEventBacklog(dlqSize, 'dlq');
            return dlqSize;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Obter saúde geral dos workers
     */
    async getHealth() {
        const groupInfo = await this.getGroupInfo();
        const consumers = await this.getConsumers();
        const lag = await this.getStreamLag();
        const dlqSize = await this.getDLQSize();
        const pending = await this.getPendingEvents();

        const health = {
            status: 'healthy',
            stream: this.streamName,
            group: this.groupName,
            consumers: {
                count: consumers.length,
                list: consumers.map(c => ({
                    name: c.name,
                    pending: c.pending,
                    idle: c.idle
                }))
            },
            lag: lag?.lag || 0,
            pendingEvents: pending.length,
            dlqSize,
            timestamp: new Date().toISOString()
        };

        // Determinar status
        if (consumers.length === 0) {
            health.status = 'unhealthy';
            health.reason = 'Nenhum consumer ativo';
        } else if (lag && lag.lag > 1000) {
            health.status = 'degraded';
            health.reason = `Lag alto: ${lag.lag} eventos`;
        } else if (dlqSize > 100) {
            health.status = 'degraded';
            health.reason = `DLQ grande: ${dlqSize} eventos`;
        } else if (pending.length > 50) {
            health.status = 'degraded';
            health.reason = `Muitos eventos pendentes: ${pending.length}`;
        }

        // Atualizar métricas
        metrics.setActiveWorkers(consumers.length, 'listener');
        if (lag) {
            metrics.setEventBacklog(lag.lag, 'pending');
        }

        return health;
    }

    /**
     * Iniciar monitoramento periódico
     */
    startMonitoring(intervalMs = 30000) {
        setInterval(async () => {
            const health = await this.getHealth();
            logStructured('info', 'Health check dos workers', {
                service: 'worker-health-monitor',
                ...health
            });
        }, intervalMs);
    }
}

module.exports = WorkerHealthMonitor;


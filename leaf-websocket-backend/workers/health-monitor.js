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

    parseStreamFields(fields = []) {
        const eventData = {};
        for (let i = 0; i < fields.length; i += 2) {
            eventData[fields[i]] = fields[i + 1];
        }
        return eventData;
    }

    parseJsonField(value) {
        if (typeof value !== 'string') return value || null;
        const trimmed = value.trim();
        if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
            return null;
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            return null;
        }
    }

    getStreamTimestamp(streamId) {
        const timestampMs = Number.parseInt(String(streamId || '').split('-')[0], 10);
        if (!Number.isFinite(timestampMs)) return null;
        return new Date(timestampMs).toISOString();
    }

    findNestedValue(source, keys, depth = 0) {
        if (!source || typeof source !== 'object' || depth > 4) return null;

        for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }

        for (const value of Object.values(source)) {
            if (value && typeof value === 'object') {
                const found = this.findNestedValue(value, keys, depth + 1);
                if (found !== null && found !== undefined && found !== '') {
                    return found;
                }
            }
        }

        return null;
    }

    normalizeDLQEntry(entry) {
        const [id, fields] = entry;
        const raw = this.parseStreamFields(fields);
        const parsedEventData = this.parseJsonField(raw.eventData);
        const parsedPayload = parsedEventData || raw;
        const failedAt = raw.failedAt || this.getStreamTimestamp(id);
        const failedAtMs = failedAt ? new Date(failedAt).getTime() : NaN;
        const ageSeconds = Number.isFinite(failedAtMs)
            ? Math.max(0, Math.floor((Date.now() - failedAtMs) / 1000))
            : null;
        const contextSource = parsedPayload && typeof parsedPayload === 'object'
            ? parsedPayload
            : raw;

        const context = {
            bookingId: this.findNestedValue(contextSource, ['bookingId', 'booking_id', 'rideId', 'ride_id']),
            tripId: this.findNestedValue(contextSource, ['tripId', 'trip_id']),
            customerId: this.findNestedValue(contextSource, ['customerId', 'customer_id', 'passengerId', 'passenger_id']),
            driverId: this.findNestedValue(contextSource, ['driverId', 'driver_id']),
            traceId: this.findNestedValue(contextSource, ['traceId', 'trace_id', 'correlationId', 'correlation_id'])
        };

        return {
            id,
            streamTimestamp: this.getStreamTimestamp(id),
            failedAt,
            ageSeconds,
            originalEventId: raw.originalEventId || null,
            originalStream: raw.originalStream || null,
            eventType: raw.eventType || raw.type || 'unknown',
            error: raw.error || '',
            retries: Number.parseInt(raw.retries || '0', 10) || 0,
            context,
            raw,
            eventData: parsedEventData,
            eventDataPreview: typeof raw.eventData === 'string'
                ? raw.eventData.slice(0, 600)
                : ''
        };
    }

    /**
     * Listar eventos da DLQ para triagem read-only.
     */
    async getDLQEvents(options = {}) {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            const limit = Math.min(Math.max(Number.parseInt(options.limit || '50', 10) || 50, 1), 200);
            const direction = String(options.direction || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
            const eventType = String(options.eventType || '').trim();
            const errorFilter = String(options.error || '').trim().toLowerCase();
            const readLimit = eventType || errorFilter ? Math.min(limit * 5, 500) : limit;
            const entries = direction === 'asc'
                ? await this.redis.xrange('ride_events_dlq', '-', '+', 'COUNT', readLimit)
                : await this.redis.xrevrange('ride_events_dlq', '+', '-', 'COUNT', readLimit);

            const events = entries
                .map((entry) => this.normalizeDLQEntry(entry))
                .filter((event) => !eventType || event.eventType === eventType)
                .filter((event) => !errorFilter || String(event.error || '').toLowerCase().includes(errorFilter))
                .slice(0, limit);
            const dlqSize = await this.getDLQSize();

            return {
                dlqSize,
                count: events.length,
                limit,
                direction,
                events
            };
        } catch (error) {
            logStructured('error', 'Erro ao listar eventos da DLQ', {
                service: 'worker-health-monitor',
                error: error.message
            });
            return {
                dlqSize: 0,
                count: 0,
                limit: 0,
                direction: 'desc',
                events: [],
                error: error.message
            };
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

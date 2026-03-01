/**
 * WORKER MANAGER
 * 
 * Gerencia workers para processar listeners pesados usando Redis Streams e Consumer Groups.
 * 
 * Arquitetura:
 * - Listeners rápidos: executados inline no server.js (notifyPassenger, notifyDriver, startTripTimer)
 * - Listeners pesados: executados em workers separados (notifyDrivers, sendPush)
 * 
 * Funcionalidades:
 * - Consumer Groups para distribuição de carga
 * - Retry automático com backoff exponencial
 * - Dead Letter Queue (DLQ) para falhas persistentes
 * - Monitoramento de saúde dos workers
 */

const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const traceContext = require('../utils/trace-context');

class WorkerManager {
    constructor(options = {}) {
        this.streamName = options.streamName || 'ride_events';
        this.groupName = options.groupName || 'listener-workers';
        this.consumerName = options.consumerName || `worker-${process.pid}`;
        this.batchSize = options.batchSize || 10;
        this.blockTime = options.blockTime || 1000; // 1 segundo
        this.maxRetries = options.maxRetries || 3;
        this.retryBackoff = options.retryBackoff || [1000, 2000, 5000]; // ms
        this.dlqStreamName = options.dlqStreamName || 'ride_events_dlq';
        this.redis = null;
        this.isRunning = false;
        this.listeners = new Map(); // eventType -> handler function
        this.stats = {
            processed: 0,
            failed: 0,
            retried: 0,
            dlq: 0,
            startTime: Date.now()
        };
    }

    /**
     * Inicializar conexão Redis e criar Consumer Group
     */
    async initialize() {
        try {
            await redisPool.ensureConnection();
            this.redis = redisPool.getConnection();

            // Criar Consumer Group (MKSTREAM cria o stream se não existir)
            try {
                await this.redis.xgroup(
                    'CREATE',
                    this.streamName,
                    this.groupName,
                    '0',
                    'MKSTREAM'
                );
                logStructured('info', 'Consumer Group criado', {
                    service: 'worker-manager',
                    stream: this.streamName,
                    group: this.groupName
                });
            } catch (error) {
                // Consumer Group já existe, continuar
                if (!error.message.includes('BUSYGROUP')) {
                    logStructured('warn', 'Erro ao criar Consumer Group (pode já existir)', {
                        service: 'worker-manager',
                        error: error.message
                    });
                }
            }

            // Criar DLQ stream se não existir
            try {
                await this.redis.xadd(this.dlqStreamName, '*', 'init', 'true');
                await this.redis.del(this.dlqStreamName); // Limpar entrada de teste
            } catch (error) {
                // Ignorar
            }

            logStructured('info', 'WorkerManager inicializado', {
                service: 'worker-manager',
                consumerName: this.consumerName,
                streamName: this.streamName,
                groupName: this.groupName
            });

            return true;
        } catch (error) {
            logError(error, 'Erro ao inicializar WorkerManager', {
                service: 'worker-manager'
            });
            return false;
        }
    }

    /**
     * Registrar listener para um tipo de evento
     */
    registerListener(eventType, handler) {
        this.listeners.set(eventType, handler);
        logStructured('info', 'Listener registrado', {
            service: 'worker-manager',
            eventType,
            consumerName: this.consumerName
        });
    }

    /**
     * Processar um evento
     */
    async processEvent(eventId, eventData) {
        const startTime = Date.now();
        // O tipo do evento vem do campo 'type' no stream
        const eventType = eventData.type || 'unknown';
        const handler = this.listeners.get(eventType);
        
        // Log para debug
        if (!handler) {
            logStructured('debug', 'Evento recebido sem handler', {
                service: 'worker-manager',
                eventType,
                eventDataKeys: Object.keys(eventData),
                registeredListeners: Array.from(this.listeners.keys())
            });
        }

        if (!handler) {
            logStructured('warn', 'Nenhum handler registrado para evento', {
                service: 'worker-manager',
                eventType,
                eventId
            });
            return { success: true, skipped: true };
        }

        // Extrair traceId do evento
        let parsedData = {};
        try {
            parsedData = JSON.parse(eventData.data || '{}');
        } catch (e) {
            parsedData = eventData.data || {};
        }

        const traceId = parsedData.traceId || traceContext.getCurrentTraceId();

        return await traceContext.runWithTraceId(traceId, async () => {
            try {
                // Executar handler
                // Formato do evento deve ser compatível com listeners existentes
                const event = {
                    eventType,
                    data: parsedData,
                    timestamp: eventData.timestamp,
                    bookingId: eventData.bookingId || parsedData.bookingId,
                    driverId: eventData.driverId || parsedData.driverId,
                    customerId: eventData.customerId || parsedData.customerId
                };
                
                await handler(event);

                const duration = (Date.now() - startTime) / 1000;
                metrics.recordListener(eventType, duration, true);
                metrics.recordEventConsumed(eventType, this.consumerName);

                this.stats.processed++;
                logStructured('info', 'Evento processado com sucesso', {
                    service: 'worker-manager',
                    eventType,
                    eventId,
                    duration
                });

                return { success: true };
            } catch (error) {
                const duration = (Date.now() - startTime) / 1000;
                metrics.recordListener(eventType, duration, false);

                logError(error, 'Erro ao processar evento', {
                    service: 'worker-manager',
                    eventType,
                    eventId
                });

                return { success: false, error: error.message };
            }
        });
    }

    /**
     * Processar com retry automático
     */
    async processWithRetry(eventId, eventData, retryCount = 0) {
        const result = await this.processEvent(eventId, eventData);

        if (result.success || result.skipped) {
            return result;
        }

        // Se falhou e ainda tem retries disponíveis
        if (retryCount < this.maxRetries) {
            const backoff = this.retryBackoff[retryCount] || this.retryBackoff[this.retryBackoff.length - 1];
            
            logStructured('warn', 'Retentando processamento de evento', {
                service: 'worker-manager',
                eventId,
                retryCount: retryCount + 1,
                maxRetries: this.maxRetries,
                backoff
            });

            this.stats.retried++;

            // Aguardar backoff
            await new Promise(resolve => setTimeout(resolve, backoff));

            // Retentar
            return await this.processWithRetry(eventId, eventData, retryCount + 1);
        }

        // Máximo de retries atingido - mover para DLQ
        return await this.moveToDLQ(eventId, eventData, result.error);
    }

    /**
     * Mover evento para Dead Letter Queue
     */
    async moveToDLQ(eventId, eventData, error) {
        try {
            const dlqData = {
                originalEventId: eventId,
                originalStream: this.streamName,
                eventType: eventData.type,
                eventData: eventData.data,
                failedAt: new Date().toISOString(),
                error: error,
                retries: this.maxRetries
            };

            await this.redis.xadd(
                this.dlqStreamName,
                '*',
                ...Object.entries(dlqData).flat().map(v => String(v))
            );

            this.stats.dlq++;
            metrics.setEventBacklog(this.stats.dlq, 'dlq');

            logStructured('error', 'Evento movido para DLQ', {
                service: 'worker-manager',
                originalEventId: eventId,
                eventType: eventData.type,
                error
            });

            return { success: false, dlq: true };
        } catch (dlqError) {
            logError(dlqError, 'Erro ao mover evento para DLQ', {
                service: 'worker-manager',
                eventId
            });
            return { success: false, dlq: false };
        }
    }

    /**
     * Consumir eventos do stream
     */
    async consume() {
        if (!this.redis) {
            await this.initialize();
        }

        try {
            // Ler eventos do Consumer Group
            const results = await this.redis.xreadgroup(
                'GROUP', this.groupName, this.consumerName,
                'COUNT', this.batchSize,
                'BLOCK', this.blockTime,
                'STREAMS', this.streamName, '>'
            );

            if (!results || results.length === 0) {
                return; // Nenhum evento disponível
            }

            const [, events] = results[0]; // [streamName, [event1, event2, ...]]

            for (const [eventId, fields] of events) {
                // Converter campos array para objeto
                const eventData = {};
                for (let i = 0; i < fields.length; i += 2) {
                    eventData[fields[i]] = fields[i + 1];
                }

                // Processar com retry
                const result = await this.processWithRetry(eventId, eventData);

                // ACK apenas se processado com sucesso ou pulado
                if (result.success || result.skipped) {
                    await this.redis.xack(this.streamName, this.groupName, eventId);
                } else if (result.dlq) {
                    // Se foi para DLQ, também fazer ACK (já foi movido)
                    await this.redis.xack(this.streamName, this.groupName, eventId);
                }
                // Se falhou mas não foi para DLQ, não fazer ACK (será reprocessado)
            }
        } catch (error) {
            logError(error, 'Erro ao consumir eventos', {
                service: 'worker-manager',
                consumerName: this.consumerName
            });
        }
    }

    /**
     * Iniciar worker (loop de consumo)
     */
    async start() {
        if (this.isRunning) {
            logStructured('warn', 'Worker já está rodando', {
                service: 'worker-manager',
                consumerName: this.consumerName
            });
            return;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            logStructured('error', 'Falha ao inicializar WorkerManager', {
                service: 'worker-manager'
            });
            return;
        }

        this.isRunning = true;
        this.stats.startTime = Date.now();

        logStructured('info', 'Worker iniciado', {
            service: 'worker-manager',
            consumerName: this.consumerName,
            streamName: this.streamName,
            groupName: this.groupName
        });

        metrics.setActiveWorkers(1, 'listener');

        // Loop de consumo
        while (this.isRunning) {
            try {
                await this.consume();
            } catch (error) {
                logError(error, 'Erro no loop de consumo', {
                    service: 'worker-manager'
                });
                // Aguardar antes de retentar
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    /**
     * Parar worker
     */
    async stop() {
        this.isRunning = false;
        metrics.setActiveWorkers(0, 'listener');

        logStructured('info', 'Worker parado', {
            service: 'worker-manager',
            consumerName: this.consumerName,
            stats: this.stats
        });
    }

    /**
     * Obter estatísticas
     */
    getStats() {
        const uptime = (Date.now() - this.stats.startTime) / 1000;
        return {
            ...this.stats,
            uptime,
            isRunning: this.isRunning,
            consumerName: this.consumerName
        };
    }
}

module.exports = WorkerManager;


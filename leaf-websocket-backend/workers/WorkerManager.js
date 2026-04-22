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
        this.blockingRedis = null;
        this.isRunning = false;
        this.listeners = new Map(); // eventType -> handler function
        this.stats = {
            processed: 0,
            failed: 0,
            retried: 0,
            reclaimed: 0,
            dlq: 0,
            startTime: Date.now()
        };
        this.unhandledEventWarnAt = new Map();
        this.unhandledEventWarnCooldownMs = Number.parseInt(process.env.UNHANDLED_EVENT_WARN_COOLDOWN_MS || '60000', 10);
        this.unhandledQuietEvents = new Set(
            String(process.env.WORKER_UNHANDLED_QUIET_EVENTS || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
        );
        this.pendingClaimEnabled = String(process.env.WORKER_PENDING_CLAIM_ENABLED || 'true') !== 'false';
        this.pendingClaimMinIdleMs = Math.max(
            1000,
            Number.parseInt(process.env.WORKER_PENDING_CLAIM_MIN_IDLE_MS || '120000', 10) || 120000
        );
        this.pendingClaimBatchSize = Math.max(
            1,
            Number.parseInt(process.env.WORKER_PENDING_CLAIM_BATCH_SIZE || '20', 10) || 20
        );
        this.pendingClaimIntervalMs = Math.max(
            1000,
            Number.parseInt(process.env.WORKER_PENDING_CLAIM_INTERVAL_MS || '30000', 10) || 30000
        );
        this.pendingClaimLastRunAt = 0;
    }

    /**
     * Inicializar conexão Redis e criar Consumer Group
     */
    async initialize() {
        try {
            await redisPool.ensureConnection();
            this.redis = redisPool.getConnection();
            if (!this.blockingRedis) {
                // Cliente dedicado para comandos bloqueantes (XREADGROUP BLOCK),
                // evitando bloquear o cliente Redis principal do backend.
                this.blockingRedis = this.redis.duplicate();
                this.blockingRedis.on('error', (error) => {
                    logStructured('warn', 'Erro no cliente Redis bloqueante do worker', {
                        service: 'worker-manager',
                        consumerName: this.consumerName,
                        error: error.message
                    });
                });
            }
            await this._ensureBlockingRedisReady();

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

    async _ensureBlockingRedisReady() {
        if (!this.blockingRedis) return;

        const waitUntilReady = async (timeoutMs = 10000) => {
            await new Promise((resolve, reject) => {
                const onReady = () => {
                    cleanup();
                    resolve(true);
                };
                const onError = (err) => {
                    cleanup();
                    reject(err);
                };
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Timeout aguardando conexão do Redis bloqueante'));
                }, timeoutMs);

                const cleanup = () => {
                    clearTimeout(timeout);
                    this.blockingRedis.off('ready', onReady);
                    this.blockingRedis.off('error', onError);
                };

                this.blockingRedis.on('ready', onReady);
                this.blockingRedis.on('error', onError);
            });
        };

        const status = this.blockingRedis.status;
        if (status === 'ready' || status === 'connect') return;

        if (status === 'connecting' || status === 'reconnecting') {
            await waitUntilReady();
            return;
        }

        try {
            await this.blockingRedis.connect();
        } catch (error) {
            const message = error?.message || '';
            if (message.includes('already connecting') || message.includes('already connected')) {
                await waitUntilReady();
                return;
            }
            throw error;
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
        
        // Log para debug (somente para tipos não silenciosos)
        const isQuietUnhandled = this.unhandledQuietEvents.has(eventType);
        if (!handler && !isQuietUnhandled) {
            logStructured('debug', 'Evento recebido sem handler', {
                service: 'worker-manager',
                eventType,
                eventDataKeys: Object.keys(eventData),
                registeredListeners: Array.from(this.listeners.keys())
            });
        }

        if (!handler) {
            if (isQuietUnhandled) {
                return { success: true, skipped: true };
            }

            const now = Date.now();
            const lastWarnAt = this.unhandledEventWarnAt.get(eventType) || 0;
            if ((now - lastWarnAt) >= this.unhandledEventWarnCooldownMs) {
                this.unhandledEventWarnAt.set(eventType, now);
                logStructured('warn', 'Nenhum handler registrado para evento', {
                    service: 'worker-manager',
                    eventType,
                    eventId,
                    cooldownMs: this.unhandledEventWarnCooldownMs
                });
            }
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

    parseStreamFields(fields = []) {
        const eventData = {};
        for (let i = 0; i < fields.length; i += 2) {
            eventData[fields[i]] = fields[i + 1];
        }
        return eventData;
    }

    async reclaimStalePendingMessages() {
        if (!this.pendingClaimEnabled || !this.redis) {
            return;
        }

        const now = Date.now();
        if ((now - this.pendingClaimLastRunAt) < this.pendingClaimIntervalMs) {
            return;
        }
        this.pendingClaimLastRunAt = now;

        let startId = '0-0';
        let totalClaimed = 0;
        let totalAcked = 0;

        try {
            // Evita monopolizar o loop em cenários de backlog muito alto.
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const result = await this.redis.call(
                    'XAUTOCLAIM',
                    this.streamName,
                    this.groupName,
                    this.consumerName,
                    String(this.pendingClaimMinIdleMs),
                    startId,
                    'COUNT',
                    String(this.pendingClaimBatchSize)
                );

                if (!Array.isArray(result) || result.length < 2) {
                    break;
                }

                const nextStartId = typeof result[0] === 'string' ? result[0] : startId;
                const claimedEntries = Array.isArray(result[1]) ? result[1] : [];

                if (claimedEntries.length === 0) {
                    break;
                }

                for (const entry of claimedEntries) {
                    const eventId = entry?.[0];
                    const fields = Array.isArray(entry?.[1]) ? entry[1] : [];
                    if (!eventId || fields.length === 0) {
                        continue;
                    }

                    const eventData = this.parseStreamFields(fields);
                    const processResult = await this.processWithRetry(eventId, eventData);

                    if (processResult.success || processResult.skipped || processResult.dlq) {
                        await this.redis.xack(this.streamName, this.groupName, eventId);
                        totalAcked += 1;
                    }

                    totalClaimed += 1;
                }

                startId = nextStartId;
                if (claimedEntries.length < this.pendingClaimBatchSize) {
                    break;
                }
            }

            if (totalClaimed > 0) {
                this.stats.reclaimed += totalClaimed;
                logStructured('warn', 'Mensagens pendentes órfãs foram recuperadas', {
                    service: 'worker-manager',
                    consumerName: this.consumerName,
                    streamName: this.streamName,
                    groupName: this.groupName,
                    minIdleMs: this.pendingClaimMinIdleMs,
                    claimed: totalClaimed,
                    acked: totalAcked
                });
            }
        } catch (error) {
            logStructured('warn', 'Falha ao recuperar mensagens pendentes órfãs', {
                service: 'worker-manager',
                consumerName: this.consumerName,
                streamName: this.streamName,
                groupName: this.groupName,
                error: error.message
            });
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
            await this.reclaimStalePendingMessages();

            // Ler eventos do Consumer Group
            const readClient = this.blockingRedis || this.redis;
            const results = await readClient.xreadgroup(
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
                const eventData = this.parseStreamFields(fields);

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

        if (this.blockingRedis) {
            try {
                if (this.blockingRedis.status === 'ready' || this.blockingRedis.status === 'connect') {
                    await this.blockingRedis.quit();
                } else {
                    this.blockingRedis.disconnect();
                }
            } catch (_error) {
                // Ignorar erro no shutdown do cliente bloqueante.
            } finally {
                this.blockingRedis = null;
            }
        }

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

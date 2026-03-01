#!/usr/bin/env node
/**
 * Script para reprocessar eventos da Dead Letter Queue (DLQ)
 * 
 * Uso:
 *   node scripts/reprocess-dlq.js [--limit N] [--dry-run]
 */

const redisPool = require('../utils/redis-pool');
const WorkerManager = require('../workers/WorkerManager');
const { logStructured, logError } = require('../utils/logger');

const args = process.argv.slice(2);
const limit = args.includes('--limit') 
    ? parseInt(args[args.indexOf('--limit') + 1]) || 10
    : 10;
const dryRun = args.includes('--dry-run');

async function reprocessDLQ() {
    try {
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();

        logStructured('info', 'Iniciando reprocessamento da DLQ', {
            service: 'reprocess-dlq',
            limit,
            dryRun
        });

        // Ler eventos da DLQ
        const events = await redis.xrange('ride_events_dlq', '-', '+', 'COUNT', limit);

        if (events.length === 0) {
            logStructured('info', 'DLQ está vazia', {
                service: 'reprocess-dlq'
            });
            return;
        }

        logStructured('info', `Encontrados ${events.length} eventos na DLQ`, {
            service: 'reprocess-dlq'
        });

        // Criar WorkerManager para processar
        const workerManager = new WorkerManager({
            streamName: 'ride_events',
            groupName: 'listener-workers',
            consumerName: `dlq-reprocessor-${process.pid}`
        });

        await workerManager.initialize();

        // Registrar listeners (mesmos do listener-worker.js)
        const notifyDrivers = require('../listeners/onRideRequested.notifyDrivers');
        const sendPush = require('../listeners/onRideAccepted.sendPush');
        const { EVENT_TYPES } = require('../events');

        workerManager.registerListener(EVENT_TYPES.RIDE_REQUESTED, async (event) => {
            await notifyDrivers(event, null);
        });

        workerManager.registerListener(EVENT_TYPES.RIDE_ACCEPTED, async (event) => {
            await sendPush(event, null);
        });

        let processed = 0;
        let failed = 0;

        for (const [eventId, fields] of events) {
            // Converter campos para objeto
            const eventData = {};
            for (let i = 0; i < fields.length; i += 2) {
                eventData[fields[i]] = fields[i + 1];
            }

            if (dryRun) {
                logStructured('info', 'DRY RUN - Evento seria reprocessado', {
                    service: 'reprocess-dlq',
                    eventId,
                    eventType: eventData.eventType
                });
                continue;
            }

            try {
                // Reprocessar evento
                const result = await workerManager.processEvent(eventId, eventData);

                if (result.success) {
                    processed++;
                    // Remover da DLQ
                    await redis.xdel('ride_events_dlq', eventId);
                    logStructured('info', 'Evento reprocessado com sucesso', {
                        service: 'reprocess-dlq',
                        eventId
                    });
                } else {
                    failed++;
                    logStructured('warn', 'Falha ao reprocessar evento', {
                        service: 'reprocess-dlq',
                        eventId,
                        error: result.error
                    });
                }
            } catch (error) {
                failed++;
                logError(error, 'Erro ao reprocessar evento', {
                    service: 'reprocess-dlq',
                    eventId
                });
            }
        }

        logStructured('info', 'Reprocessamento da DLQ concluído', {
            service: 'reprocess-dlq',
            processed,
            failed,
            total: events.length
        });

    } catch (error) {
        logError(error, 'Erro fatal ao reprocessar DLQ', {
            service: 'reprocess-dlq'
        });
        process.exit(1);
    }
}

reprocessDLQ().then(() => {
    process.exit(0);
}).catch(error => {
    logError(error, 'Erro fatal', {
        service: 'reprocess-dlq'
    });
    process.exit(1);
});


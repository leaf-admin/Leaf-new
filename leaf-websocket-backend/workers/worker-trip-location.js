#!/usr/bin/env node
/**
 * TRIP LOCATION WORKER
 *
 * Consome eventos de `trip_location_events` e persiste trilha de rota em chunks.
 * Estratégia:
 * - ingest rápido no Redis list (buffer por corrida)
 * - flush periódico para Firestore em lotes
 * - finalização explícita da corrida faz flush completo no comando de negócio
 */

const WorkerManager = require('./WorkerManager');
const { logStructured } = require('../utils/logger');
const tripLocationPersistenceService = require('../services/trip-location-persistence-service');

const WORKER_ENABLED = process.env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER !== 'false';

if (!WORKER_ENABLED) {
    logStructured('warn', 'worker-trip-location desabilitado por feature flag', {
        service: 'trip-location-worker',
        featureFlag: 'ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=false'
    });
    process.exit(0);
}

const workerManager = new WorkerManager({
    streamName: process.env.TRIP_LOCATION_STREAM_NAME || 'trip_location_events',
    groupName: process.env.TRIP_LOCATION_WORKER_GROUP || 'trip-location-workers',
    consumerName: process.env.TRIP_LOCATION_WORKER_CONSUMER || 'trip-location-worker-1',
    dlqStreamName: process.env.TRIP_LOCATION_WORKER_DLQ_STREAM_NAME || 'trip_location_events_dlq',
    batchSize: Number.parseInt(process.env.TRIP_LOCATION_WORKER_BATCH_SIZE || '40', 10),
    blockTime: Number.parseInt(process.env.TRIP_LOCATION_WORKER_BLOCK_TIME || '1000', 10),
    maxRetries: Number.parseInt(process.env.TRIP_LOCATION_WORKER_MAX_RETRIES || '4', 10),
    retryBackoff: [1000, 2000, 5000, 10000]
});

workerManager.registerListener('trip.location.v1', async (event) => {
    const payload = event?.data || {};
    const normalized = {
        tripId: payload.tripId || event.bookingId,
        bookingId: payload.tripId || event.bookingId,
        driverId: payload.driverId || event.driverId,
        customerId: payload.customerId || event.customerId || null,
        seq: payload.seq,
        lat: payload.lat,
        lng: payload.lng,
        capturedAt: payload.capturedAt,
        receivedAt: payload.receivedAt,
        accuracy: payload.accuracy,
        heading: payload.heading,
        speed: payload.speed,
        financialContext: payload.financialContext,
        financialNamespace: payload.financialNamespace,
        financialContextId: payload.financialContextId,
        providerEnvironment:
            payload.paymentProviderEnvironment || payload.providerEnvironment,
        paymentProfileId: payload.paymentProfileId,
        testUserSandbox: payload.testUserSandbox
    };

    return await tripLocationPersistenceService.bufferLocationEvent(normalized);
});

const periodicFlushMs = Number.parseInt(process.env.TRIP_LOCATION_PERIODIC_FLUSH_MS || '15000', 10);
const statsLogMs = Number.parseInt(process.env.TRIP_LOCATION_STATS_LOG_MS || '60000', 10);

const flushTimer = setInterval(async () => {
    try {
        const result = await tripLocationPersistenceService.flushPendingTrips();
        logStructured('info', 'Flush periódico de trip location executado', {
            service: 'trip-location-worker',
            ...result
        });
    } catch (error) {
        logStructured('error', 'Erro no flush periódico de trip location', {
            service: 'trip-location-worker',
            error: error.message
        });
    }
}, periodicFlushMs);

const statsTimer = setInterval(() => {
    const stats = workerManager.getStats();
    logStructured('info', 'Estatísticas do trip-location-worker', {
        service: 'trip-location-worker',
        ...stats
    });
}, statsLogMs);

const gracefulShutdown = async (signal) => {
    logStructured('info', `${signal} recebido, encerrando trip-location-worker`, {
        service: 'trip-location-worker'
    });
    clearInterval(flushTimer);
    clearInterval(statsTimer);
    await workerManager.stop();
    process.exit(0);
};

process.on('SIGTERM', async () => {
    await gracefulShutdown('SIGTERM');
});

process.on('SIGINT', async () => {
    await gracefulShutdown('SIGINT');
});

workerManager.start().catch((error) => {
    logStructured('error', 'Erro fatal ao iniciar trip-location-worker', {
        service: 'trip-location-worker',
        error: error.message
    });
    process.exit(1);
});

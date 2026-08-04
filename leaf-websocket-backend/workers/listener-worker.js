#!/usr/bin/env node
/**
 * LISTENER WORKER
 * 
 * Worker dedicado para processar listeners pesados.
 * 
 * Uso:
 *   node workers/listener-worker.js
 * 
 * Ou via PM2:
 *   pm2 start workers/listener-worker.js --name listener-worker
 */

const WorkerManager = require('./WorkerManager');
const { logStructured } = require('../utils/logger');

// Importar listeners pesados e críticos (migrados de eventos em memória local)
const sendPush = require('../listeners/onRideAccepted.sendPush');
const notifyPassenger = require('../listeners/onRideAccepted.notifyPassenger');
const notifyDriver = require('../listeners/onRideAccepted.notifyDriver');
const startTripTimer = require('../listeners/onRideStarted.startTripTimer');

// Importar eventos
const { EVENT_TYPES } = require('../events');

// Importar Socket.IO e Redis Adapter para comunicação cross-node
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const redisPool = require('../utils/redis-pool');
const { buildWorkerConsumerName } = require('./worker-consumer-identity');

const WORKER_STREAM_NAME = process.env.WORKER_STREAM_NAME || 'ride_events';
const WORKER_GROUP_NAME = process.env.WORKER_GROUP_NAME || 'listener-workers';
const WORKER_CONSUMER_PREFIX = process.env.WORKER_CONSUMER_PREFIX || 'listener-worker';
const WORKER_BATCH_SIZE = Math.max(1, Number.parseInt(process.env.WORKER_BATCH_SIZE || '10', 10));
const WORKER_BLOCK_TIME = Math.max(50, Number.parseInt(process.env.WORKER_BLOCK_TIME || '200', 10));
const WORKER_MAX_RETRIES = Math.max(1, Number.parseInt(process.env.WORKER_MAX_RETRIES || '3', 10));

// Configurar instância dummy do Socket.IO com Redis Adapter
const pubClient = redisPool.getConnection();
const subClient = pubClient.duplicate();
const io = new Server();
io.adapter(createAdapter(pubClient, subClient));
logStructured('info', 'Socket.IO com Redis Adapter inicializado no worker', {
    service: 'listener-worker'
});

// Criar WorkerManager
const workerManager = new WorkerManager({
    streamName: WORKER_STREAM_NAME,
    groupName: WORKER_GROUP_NAME,
    consumerName: buildWorkerConsumerName(WORKER_CONSUMER_PREFIX),
    batchSize: WORKER_BATCH_SIZE,
    blockTime: WORKER_BLOCK_TIME,
    maxRetries: WORKER_MAX_RETRIES,
    retryBackoff: [1000, 2000, 5000]
});

// Registrar listeners pesados e orquestrações
// Passamos a instância `io` configurada com Redis Adapter

// `ride.requested` permanece no gateway (caminho crítico de dispatch).

workerManager.registerListener(EVENT_TYPES.RIDE_ACCEPTED, async (event) => {
    // Executar múltiplas ações de ride.accepted em paralelo sem que a falha de uma quebre a outra
    const results = await Promise.allSettled([
        notifyPassenger(event, io),
        notifyDriver(event, io),
        sendPush(event, io)
    ]);

    // Logar eventuais falhas parciais
    results.forEach((res, index) => {
        if (res.status === 'rejected') {
            logStructured('error', `Falha parcial em listener de RIDE_ACCEPTED (índice ${index})`, { error: res.reason?.message });
        }
    });

    if (results.every(res => res.status === 'rejected')) {
        throw new Error('Todos os listeners de RIDE_ACCEPTED falharam.');
    }
});

workerManager.registerListener(EVENT_TYPES.RIDE_STARTED, async (event) => {
    await startTripTimer(event, io);
});

workerManager.registerListener(EVENT_TYPES.RIDE_CANCELED, async (event) => {
    const { bookingId } = event.data;
    const GradualRadiusExpander = require('../services/gradual-radius-expander');
    const expander = new GradualRadiusExpander(io);
    await expander.stopSearch(bookingId);
});

// Tratamento de sinais para shutdown graceful
process.on('SIGTERM', async () => {
    logStructured('info', 'SIGTERM recebido, parando worker', {
        service: 'listener-worker'
    });
    await workerManager.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logStructured('info', 'SIGINT recebido, parando worker', {
        service: 'listener-worker'
    });
    await workerManager.stop();
    process.exit(0);
});

// Iniciar worker
workerManager.start().catch(error => {
    logStructured('error', 'Erro fatal ao iniciar worker', {
        service: 'listener-worker',
        error: error.message
    });
    process.exit(1);
});

// Log de estatísticas a cada 60 segundos
setInterval(() => {
    const stats = workerManager.getStats();
    logStructured('info', 'Estatísticas do worker', {
        service: 'listener-worker',
        ...stats
    });
}, 60000);

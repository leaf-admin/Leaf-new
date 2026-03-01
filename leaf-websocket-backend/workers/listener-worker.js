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
const notifyDrivers = require('../listeners/onRideRequested.notifyDrivers');
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
    streamName: 'ride_events',
    groupName: 'listener-workers',
    consumerName: `listener-worker-${process.pid}`,
    batchSize: 10,
    blockTime: 1000,
    maxRetries: 3,
    retryBackoff: [1000, 2000, 5000]
});

// Registrar listeners pesados e orquestrações
// Passamos a instância `io` configurada com Redis Adapter

workerManager.registerListener(EVENT_TYPES.RIDE_REQUESTED, async (event) => {
    // Apenas notifyDrivers
    await notifyDrivers(event, io);
});

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


#!/usr/bin/env node

const { Server } = require('socket.io');
const QueueWorker = require('../services/queue-worker');
const redisPool = require('../utils/redis-pool');
const SocketIORedisAdapter = require('../services/socket-io-adapter');
const { logStructured } = require('../utils/logger');

async function main() {
    const enableRedisAdapter = String(process.env.ENABLE_SOCKETIO_REDIS_ADAPTER || 'false').toLowerCase() === 'true';

    await redisPool.ensureConnection();

    const io = new Server();
    global.io = io;

    let socketIoRedisAdapter = null;
    if (enableRedisAdapter) {
        socketIoRedisAdapter = new SocketIORedisAdapter(process.env.REDIS_URL);
        await socketIoRedisAdapter.initialize(io);
    }

    const queueWorker = new QueueWorker(io);
    queueWorker.start();

    logStructured('info', 'Queue worker dedicado iniciado', {
        service: 'queue-worker-process',
        redisAdapter: enableRedisAdapter
    });

    const shutdown = async (signal) => {
        logStructured('info', 'Encerrando queue worker dedicado', {
            service: 'queue-worker-process',
            signal
        });
        try {
            queueWorker.stop();
        } catch (_stopError) {
            // noop
        }

        try {
            await new Promise((resolve) => io.close(() => resolve()));
        } catch (_socketError) {
            // noop
        }

        try {
            if (socketIoRedisAdapter) {
                await socketIoRedisAdapter.disconnect();
            }
        } catch (_adapterError) {
            // noop
        }

        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
    logStructured('error', 'Falha fatal ao iniciar queue worker dedicado', {
        service: 'queue-worker-process',
        error: error.message
    });
    process.exit(1);
});

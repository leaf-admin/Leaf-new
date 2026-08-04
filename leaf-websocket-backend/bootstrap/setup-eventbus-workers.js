function setupEventBusAndWorkers({
    io,
    setupListeners,
    redisPool,
    WorkerManager,
    EVENT_TYPES,
    logStructured,
    logError,
    enableEmbeddedListenerWorkers = false
}) {
    const { buildWorkerConsumerName } = require('../workers/worker-consumer-identity');
    // ✅ REFATORAÇÃO: Configurar EventBus e Listeners
    logStructured('info', 'Configurando EventBus e Listeners', { service: 'server', phase: 'refactoring' });
    const eventBus = setupListeners(io);
    logStructured('info', 'EventBus e Listeners configurados', { service: 'server', phase: 'refactoring' });

    if (!enableEmbeddedListenerWorkers) {
        logStructured('info', 'WorkerManager embutido desabilitado; side effects serão processados pelo worker dedicado', {
            service: 'server',
            phase: 'workers'
        });
        return { eventBus, workerManager: null };
    }

    // ==================== WORKERS E ESCALABILIDADE ====================
    // ✅ NOVO: Inicializar WorkerManager para processar listeners pesados em paralelo
    let workerManager = null;
    const initializeWorkers = async () => {
        try {
            // Garantir que Redis está pronto
            await redisPool.ensureConnection();

            logStructured('info', 'Inicializando WorkerManager', { service: 'server', phase: 'workers' });

            // Criar WorkerManager
            workerManager = new WorkerManager({
                streamName: 'ride_events',
                groupName: 'listener-workers',
                consumerName: buildWorkerConsumerName('server-worker'),
                batchSize: 10,
                blockTime: 1000,
                maxRetries: 3,
                retryBackoff: [1000, 2000, 5000]
            });

            // Importar listeners pesados
            const notifyDrivers = require('../listeners/onRideRequested.notifyDrivers');
            const sendPush = require('../listeners/onRideAccepted.sendPush');
            const notifyPassenger = require('../listeners/onRideAccepted.notifyPassenger');
            const notifyDriver = require('../listeners/onRideAccepted.notifyDriver');
            const startTripTimer = require('../listeners/onRideStarted.startTripTimer');

            // Registrar listeners pesados no WorkerManager
            // Nota: io já está exposto globalmente
            // Nota: io será acessado via global.io nos listeners
            workerManager.registerListener(EVENT_TYPES.RIDE_REQUESTED, async (event) => {
                // notifyDrivers precisa de io, usar global.io
                const ioInstance = global.io || io;
                await notifyDrivers(event, ioInstance);
            });

            workerManager.registerListener(EVENT_TYPES.RIDE_ACCEPTED, async (event) => {
                const ioInstance = global.io || io;
                await notifyPassenger(event, ioInstance);
                await notifyDriver(event, ioInstance);
                await sendPush(event, ioInstance);
            });

            workerManager.registerListener(EVENT_TYPES.RIDE_STARTED, async (event) => {
                const ioInstance = global.io || io;
                await startTripTimer(event, ioInstance);
            });

            workerManager.registerListener(EVENT_TYPES.RIDE_CANCELED, async (event) => {
                const rawPayload = event?.data && typeof event.data === 'object' ? event.data : {};
                const nestedPayload = rawPayload?.data && typeof rawPayload.data === 'object' ? rawPayload.data : null;
                const bookingId = event?.bookingId || rawPayload?.bookingId || nestedPayload?.bookingId;
                if (!bookingId) {
                    logStructured('debug', 'RIDE_CANCELED listener ignorou evento sem bookingId', {
                        listener: 'ride_canceled.stop_search',
                        eventType: event?.eventType || null
                    });
                    return;
                }
                const ioInstance = global.io || io;
                const GradualRadiusExpander = require('../services/gradual-radius-expander');
                const expander = new GradualRadiusExpander(ioInstance);
                await expander.stopSearch(bookingId);
            });

            // Inicializar WorkerManager
            const initialized = await workerManager.initialize();
            if (!initialized) {
                logStructured('warn', 'Falha ao inicializar WorkerManager, continuando sem workers', {
                    service: 'server',
                    phase: 'workers'
                });
                return;
            }

            // Iniciar worker em background (não bloqueia servidor)
            // Nota: start() é um loop infinito, então não podemos usar await aqui
            workerManager.start().catch((error) => {
                logError(error, 'Erro no WorkerManager', { service: 'server', phase: 'workers' });
            });

            logStructured('info', 'WorkerManager inicializado e rodando', {
                service: 'server',
                phase: 'workers',
                consumerName: workerManager.consumerName
            });

        } catch (error) {
            logError(error, 'Erro ao inicializar WorkerManager', {
                service: 'server',
                phase: 'workers'
            });
            // Não lançar erro - servidor deve continuar funcionando sem workers
            logStructured('warn', 'Servidor continuará funcionando sem workers (fallback para processamento síncrono)', {
                service: 'server',
                phase: 'workers'
            });
        }
    };

    // Inicializar workers após Redis estar pronto
    // Executar em background para não bloquear inicialização do servidor
    initializeWorkers().catch((error) => {
        logError(error, 'Erro ao inicializar workers', { service: 'server' });
    });
    // ====================================================================

    return { eventBus, workerManager };
}

module.exports = setupEventBusAndWorkers;

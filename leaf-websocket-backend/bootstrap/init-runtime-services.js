function initializeRuntimeServices({
    io,
    ResponseHandler,
    GradualRadiusExpander,
    RadiusExpansionManager,
    QueueWorker,
    queueMonitoringRoutes,
    redisPool,
    logStructured
}) {
    const boolEnv = (name, fallback = false) => {
        const raw = process.env[name];
        if (raw === undefined || raw === null || raw === '') return fallback;
        const normalized = String(raw).trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'off'].includes(normalized)) return false;
        return fallback;
    };

    const runQueueWorkerInProcess =
        boolEnv('RUNTIME_ENABLE_QUEUE_WORKER', !boolEnv('ENABLE_DEDICATED_QUEUE_WORKER', false));
    const runRadiusExpansionManager = boolEnv('ENABLE_RUNTIME_RADIUS_EXPANSION_MANAGER', true);
    const runDriverPoolMonitor = boolEnv('ENABLE_DRIVER_POOL_MONITOR', true);
    const runAcceptedRideRecoveryMonitor = boolEnv('ENABLE_ACCEPTED_RIDE_RECOVERY_MONITOR', true);
    const runDemandNotificationService = boolEnv('ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE', true);
    const runDashboardWebSocketService = boolEnv('ENABLE_RUNTIME_DASHBOARD_WEBSOCKET', true);

    // ==================== INICIALIZAÇÃO FASE 7: SISTEMA DE FILAS E MATCHING ====================
    // Inicializar instâncias dos serviços
    const responseHandler = new ResponseHandler(io);
    const gradualExpander = new GradualRadiusExpander(io);
    const radiusExpansionManager = runRadiusExpansionManager
        ? new RadiusExpansionManager(io)
        : null;

    // Iniciar monitoramento de expansão para 5km
    if (radiusExpansionManager) {
        radiusExpansionManager.start();
        logStructured('info', 'RadiusExpansionManager iniciado', { service: 'server', phase: 'fase7' });
    } else {
        logStructured('info', 'RadiusExpansionManager desabilitado neste processo', {
            service: 'server',
            phase: 'fase7',
            reason: 'ENABLE_RUNTIME_RADIUS_EXPANSION_MANAGER=false'
        });
    }

    // Variável para armazenar activeBookings (compatibilidade)
    if (!io.activeBookings) {
        io.activeBookings = new Map();
    }
    // =========================================================================================

    // ==================== INICIALIZAÇÃO FASE 8: QUEUE WORKER ====================
    // Inicializar worker para processar filas continuamente
    let queueWorker = null;
    if (runQueueWorkerInProcess) {
        queueWorker = new QueueWorker(io);
        queueWorker.start();
        logStructured('info', 'QueueWorker iniciado (processamento contínuo de filas)', { service: 'server', phase: 'fase8' });
    } else {
        logStructured('info', 'QueueWorker desabilitado neste processo (modo dedicado)', {
            service: 'server',
            phase: 'fase8'
        });
    }

    // FASE 10: Injetar instância do worker nas rotas de monitoramento
    queueMonitoringRoutes.setQueueWorker(queueWorker);
    logStructured('info', 'Rotas de monitoramento configuradas', { service: 'server', phase: 'fase10' });
    // ============================================================================

    // ==================== INICIALIZAÇÃO FASE 9: DRIVER POOL MONITOR ====================
    // Inicializar monitor de motoristas disponíveis
    let driverPoolMonitor = null;

    // Iniciar monitor (verifica motoristas livres a cada 5 segundos)
    if (runDriverPoolMonitor) {
        const DriverPoolMonitor = require('../services/driver-pool-monitor');
        driverPoolMonitor = new DriverPoolMonitor(io);
        driverPoolMonitor.start();
        logStructured('info', 'DriverPoolMonitor iniciado (monitoramento contínuo de motoristas livres)', { service: 'server', phase: 'fase9' });
    } else {
        logStructured('info', 'DriverPoolMonitor desabilitado neste processo', {
            service: 'server',
            phase: 'fase9',
            reason: 'ENABLE_DRIVER_POOL_MONITOR=false'
        });
    }
    // ============================================================================

    // ==================== MONITOR DE RECUPERAÇÃO DE ACCEPTED ÓRFÃO ====================
    let acceptedRideRecoveryMonitor = null;
    if (runAcceptedRideRecoveryMonitor) {
        const AcceptedRideRecoveryMonitor = require('../services/accepted-ride-recovery-monitor');
        acceptedRideRecoveryMonitor = new AcceptedRideRecoveryMonitor(io);
        acceptedRideRecoveryMonitor.start();
        logStructured('info', 'AcceptedRideRecoveryMonitor iniciado (reconciliação de ACCEPTED órfão)', {
            service: 'server'
        });
    } else {
        logStructured('info', 'AcceptedRideRecoveryMonitor desabilitado neste processo', {
            service: 'server',
            reason: 'ENABLE_ACCEPTED_RIDE_RECOVERY_MONITOR=false'
        });
    }
    // ============================================================================

    // ==================== SERVIÇO DE NOTIFICAÇÃO DE DEMANDA ====================
    let demandNotificationService = null;
    if (runDemandNotificationService) {
        const DemandNotificationService = require('../services/demand-notification-service');
        demandNotificationService = new DemandNotificationService(io);
        logStructured('info', 'Serviço de Notificação de Demanda inicializado', { service: 'server' });
    } else {
        logStructured('info', 'Serviço de Notificação de Demanda desabilitado neste processo', {
            service: 'server',
            reason: 'ENABLE_RUNTIME_DEMAND_NOTIFICATION_SERVICE=false'
        });
    }
    // ============================================================================

    // ==================== DASHBOARD WEBSOCKET SERVICE ====================
    let dashboardWebSocketService = null;
    if (runDashboardWebSocketService) {
        const DashboardWebSocketService = require('../services/dashboard-websocket');
        dashboardWebSocketService = new DashboardWebSocketService(io, redisPool.getConnection());
        logStructured('info', 'Dashboard WebSocket Service inicializado', { service: 'server' });
    } else {
        logStructured('info', 'Dashboard WebSocket Service desabilitado neste processo', {
            service: 'server',
            reason: 'ENABLE_RUNTIME_DASHBOARD_WEBSOCKET=false'
        });
    }
    // ======================================================================

    return {
        responseHandler,
        gradualExpander,
        radiusExpansionManager,
        queueWorker,
        driverPoolMonitor,
        acceptedRideRecoveryMonitor,
        demandNotificationService,
        dashboardWebSocketService
    };
}

module.exports = initializeRuntimeServices;

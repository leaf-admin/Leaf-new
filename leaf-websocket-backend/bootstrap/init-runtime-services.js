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
    const runQueueWorkerInProcess =
        String(process.env.RUNTIME_ENABLE_QUEUE_WORKER || (process.env.ENABLE_DEDICATED_QUEUE_WORKER === 'true' ? 'false' : 'true')).toLowerCase() !== 'false';
    // ==================== INICIALIZAÇÃO FASE 7: SISTEMA DE FILAS E MATCHING ====================
    // Inicializar instâncias dos serviços
    const responseHandler = new ResponseHandler(io);
    const gradualExpander = new GradualRadiusExpander(io);
    const radiusExpansionManager = new RadiusExpansionManager(io);

    // Iniciar monitoramento de expansão para 5km
    radiusExpansionManager.start();
    logStructured('info', 'RadiusExpansionManager iniciado', { service: 'server', phase: 'fase7' });

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
    const DriverPoolMonitor = require('../services/driver-pool-monitor');
    const driverPoolMonitor = new DriverPoolMonitor(io);

    // Iniciar monitor (verifica motoristas livres a cada 5 segundos)
    driverPoolMonitor.start();
    logStructured('info', 'DriverPoolMonitor iniciado (monitoramento contínuo de motoristas livres)', { service: 'server', phase: 'fase9' });
    // ============================================================================

    // ==================== MONITOR DE RECUPERAÇÃO DE ACCEPTED ÓRFÃO ====================
    const AcceptedRideRecoveryMonitor = require('../services/accepted-ride-recovery-monitor');
    const acceptedRideRecoveryMonitor = new AcceptedRideRecoveryMonitor(io);
    acceptedRideRecoveryMonitor.start();
    logStructured('info', 'AcceptedRideRecoveryMonitor iniciado (reconciliação de ACCEPTED órfão)', {
        service: 'server'
    });
    // ============================================================================

    // ==================== SERVIÇO DE NOTIFICAÇÃO DE DEMANDA ====================
    const DemandNotificationService = require('../services/demand-notification-service');
    const demandNotificationService = new DemandNotificationService(io);
    logStructured('info', 'Serviço de Notificação de Demanda inicializado', { service: 'server' });
    // ============================================================================

    // ==================== DASHBOARD WEBSOCKET SERVICE ====================
    const DashboardWebSocketService = require('../services/dashboard-websocket');
    const dashboardWebSocketService = new DashboardWebSocketService(io, redisPool.getConnection());
    logStructured('info', 'Dashboard WebSocket Service inicializado', { service: 'server' });
    // ======================================================================

    // ==================== JOB DE LIMPEZA PERIÓDICA ====================
    // Limpar motoristas "fantasma" do GEO (online e offline)
    setInterval(async () => {
        try {
            const redis = redisPool.getConnection();
            const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';

            // Garantir conexão Redis
            if (redis.status !== 'ready' && redis.status !== 'connect') {
                try {
                    await redis.connect();
                } catch (connectError) {
                    if (!connectError.message.includes('already connecting') &&
                        !connectError.message.includes('already connected')) {
                        logStructured('error', 'Erro ao conectar Redis no job de limpeza', {
                            service: 'server',
                            operation: 'cleanupJob',
                            error: connectError.message
                        });
                        return;
                    }
                }
            }

            // ✅ CORREÇÃO: NÃO remover motoristas do GEO ativo se estão conectados
            // A lógica anterior removia motoristas que não tinham `driver:${driverId}` no Redis,
            // mas isso pode expirar por TTL mesmo com motorista online e parado.
            // Agora só removemos se o motorista realmente desconectou do WebSocket.
            const activeDrivers = await redis.zrange('driver_locations', 0, -1);
            let cleanedActive = 0;
            let renewedActive = 0;
            for (const driverId of activeDrivers) {
                // Verificar se motorista está conectado via WebSocket
                let isConnected = false;
                if (io.connectedUsers) {
                    const connectedSocket = io.connectedUsers.get(driverId);
                    isConnected = !!connectedSocket;
                }

                const exists = await redis.exists(`driver:${driverId}`);
                const driverSnapshot = exists ? await redis.hgetall(`driver:${driverId}`) : null;
                const snapshotOnline = driverSnapshot?.isOnline === 'true' || driverSnapshot?.isOnline === true;

                if (isConnected) {
                    // Motorista está conectado - NUNCA remover, apenas renovar se necessário
                    if (!exists) {
                        // TTL expirou mas motorista está conectado - renovar entrada
                        const driverLocation = await redis.geopos('driver_locations', driverId);
                        if (driverLocation && driverLocation.length > 0) {
                            const [lng, lat] = driverLocation[0];
                            await redis.hset(`driver:${driverId}`, {
                                id: driverId,
                                isOnline: 'true',
                                status: 'AVAILABLE',
                                lat: lat.toString(),
                                lng: lng.toString(),
                                lastUpdate: Date.now().toString(),
                                timestamp: Date.now().toString(),
                                lastSeen: new Date().toISOString()
                            });
                            // ✅ Usar configuração centralizada de TTL
                            const { getTTL } = require('../config/redis-ttl-config');
                            await redis.expire(`driver:${driverId}`, getTTL('DRIVER_LOCATION', 'ONLINE'));
                            renewedActive++;
                        }
                    } else {
                        // Existe e está conectado - apenas renovar TTL para manter histórico
                        const { getTTL } = require('../config/redis-ttl-config');
                        await redis.expire(`driver:${driverId}`, getTTL('DRIVER_LOCATION', 'ONLINE'));
                    }
                } else {
                    if (exists && !snapshotOnline) {
                        // Sanitize: não manter motorista OFFLINE no GEO ativo.
                        await redis.zrem('driver_locations', driverId);
                        await redis.zrem(ELIGIBLE_DRIVER_GEO_KEY, driverId);
                        cleanedActive++;
                        continue;
                    }

                    // Motorista NÃO está conectado - pode remover se não existe
                    // Mas manter por um tempo para análise de comportamento (não remover imediatamente)
                    // Só remover se realmente não existe E não está conectado há muito tempo
                    if (!exists) {
                        // Verificar última atualização (se houver)
                        const lastSeen = await redis.hget(`driver:${driverId}`, 'lastSeen');
                        if (!lastSeen) {
                            // Não tem histórico - pode remover (motorista nunca foi salvo corretamente)
                            await redis.zrem('driver_locations', driverId);
                            cleanedActive++;
                        }
                        // Se tem lastSeen, manter para análise de comportamento (não remover)
                    }
                }
            }

            // Limpar GEO offline (motoristas que expiraram)
            const offlineDrivers = await redis.zrange('driver_offline_locations', 0, -1);
            let cleanedOffline = 0;
            for (const driverId of offlineDrivers) {
                const exists = await redis.exists(`driver:${driverId}`);
                if (!exists) {
                    await redis.zrem('driver_offline_locations', driverId);
                    cleanedOffline++;
                }
            }

            if (cleanedActive > 0 || cleanedOffline > 0 || renewedActive > 0) {
                logStructured('info', 'Limpeza periódica de motoristas concluída', {
                    service: 'server',
                    cleanedActive,
                    cleanedOffline,
                    renewedActive
                });
            }

            // Limpar cooldowns antigos
            demandNotificationService.cleanupCooldowns();

        } catch (error) {
            logStructured('error', 'Erro no job de limpeza', {
                service: 'server',
                error: error.message,
                stack: error.stack
            });
        }
    }, 60000); // A cada 1 minuto
    logStructured('info', 'Job de limpeza periódica iniciado (a cada 1 minuto)', { service: 'server' });
    // ============================================================================

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

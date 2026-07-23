function isLegacyGraphqlEnabled() {
    // Produção não possui escape hatch: reativar o legado exige mudança de
    // código revisada, não apenas drift de variável de ambiente.
    return String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production';
}

async function initializeGraphQL({ app, applyMiddleware, logStructured, logError }) {
    if (!isLegacyGraphqlEnabled()) {
        logStructured('info', 'GraphQL legado desabilitado neste runtime', {
            service: 'graphql',
            endpoint: 'disabled',
            reason: 'ENABLE_LEGACY_GRAPHQL=false'
        });
        return false;
    }

    try {
        logStructured('info', 'Inicializando GraphQL', { service: 'graphql' });

        // Aplicar middleware do GraphQL (já inicia o servidor)
        await applyMiddleware(app);

        const playgroundEnabled = process.env.NODE_ENV !== 'production' ? '/graphql' : 'disabled';
        logStructured('info', 'GraphQL integrado com sucesso', {
            service: 'graphql',
            endpoint: '/graphql',
            playground: playgroundEnabled
        });

        return true;

    } catch (error) {
        logError(error, 'Erro ao inicializar GraphQL', { service: 'graphql' });
        // Continuar sem GraphQL se houver erro
        return false;
    }
}

function scheduleDailySubscription({ dailySubscriptionService, logStructured, logError }) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Meia-noite

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    // Agendar primeira execução
    setTimeout(() => {
        logStructured('info', 'Iniciando cobrança diária de assinaturas', { service: 'daily-subscription' });
        dailySubscriptionService.processAllDailyCharges()
            .then(result => {
                logStructured('info', 'Cobrança diária concluída', {
                    service: 'daily-subscription',
                    total: result.total,
                    processed: result.processed,
                    skipped: result.skipped,
                    failed: result.failed
                });
            })
            .catch(error => {
                logError(error, 'Erro na cobrança diária', { service: 'daily-subscription' });
            });

        // Agendar próxima execução (24 horas depois)
        setInterval(() => {
            logStructured('info', 'Iniciando cobrança diária de assinaturas', { service: 'daily-subscription' });
            dailySubscriptionService.processAllDailyCharges()
                .then(result => {
                    logStructured('info', 'Cobrança diária concluída', {
                        service: 'daily-subscription',
                        total: result.total,
                        processed: result.processed,
                        skipped: result.skipped,
                        failed: result.failed
                    });
                })
                .catch(error => {
                    logError(error, 'Erro na cobrança diária', { service: 'daily-subscription' });
                });
        }, 24 * 60 * 60 * 1000); // 24 horas
    }, msUntilMidnight);

    logStructured('info', 'Cobrança diária de assinaturas agendada', { service: 'daily-subscription', scheduledFor: tomorrow.toISOString() });
}

function isDailySubscriptionBillingEnabled() {
    return String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';
}

function boolEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const normalized = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function startHttpServer({
    app,
    server,
    io,
    applyMiddleware,
    cluster,
    VPS_CONFIG,
    ConnectionCleanupService,
    logStructured,
    logError
}) {
    // ✅ Inicializar GraphQL e depois iniciar servidor
    // IMPORTANTE: Este bloco DEVE ser executado para o servidor escutar na porta
    logStructured('info', '🔵 Iniciando processo de inicialização do servidor', { service: 'server' });

    (async () => {
        try {
            logStructured('info', 'Iniciando processo de inicialização do servidor', { service: 'server' });
            const graphqlMounted = await initializeGraphQL({ app, applyMiddleware, logStructured, logError });
            logStructured('info', 'Etapa GraphQL concluída, iniciando servidor HTTP', {
                service: 'server',
                graphqlMounted
            });

            // Iniciar servidor
            const PORT = process.env.PORT || 3001;
            const HOST = process.env.HOST || '0.0.0.0'; // Escutar em todas as interfaces para aceitar conexões da rede local

            logStructured('info', 'Chamando server.listen()', { service: 'server', port: PORT, host: HOST });

            if (!server) {
                logStructured('error', 'Variável server não está definida!', { service: 'server' });
                throw new Error('Variável server não está definida');
            }

            server.listen(PORT, HOST, () => {
                if (process.env.NODE_ENV === 'production') {
                    logStructured('info', 'Ultra Worker rodando', { service: 'server', workerId: cluster.worker?.id || 'N/A', port: PORT, maxConnections: VPS_CONFIG.MAX_CONNECTIONS, workers: VPS_CONFIG.CLUSTER_WORKERS });
                } else {
                    logStructured('info', 'Servidor de desenvolvimento iniciado', {
                        service: 'server',
                        port: PORT
                    });
                    logStructured('info', 'Configurado para conexões', { service: 'server', maxConnections: VPS_CONFIG.MAX_CONNECTIONS });
                }

                logStructured('info', 'Servidor iniciado', {
                    service: 'server',
                    port: PORT,
                    graphqlEndpoint: graphqlMounted ? `http://localhost:${PORT}/graphql` : 'disabled',
                    websocketEndpoint: `ws://localhost:${PORT}`
                });

                // ✅ Injetar Socket.IO no SupportChatService
                const supportChatService = require('../services/support-chat-service');
                supportChatService.setIOInstance(io);
                logStructured('info', 'Support Chat Service conectado ao Socket.IO', { service: 'support-chat' });

                // ✅ Iniciar serviço de limpeza automática de conexões
                if (boolEnv('ENABLE_CONNECTION_CLEANUP_SERVICE', true)) {
                    const connectionCleanupService = new ConnectionCleanupService(io);
                    connectionCleanupService.start();
                    logStructured('info', 'Serviço de limpeza de conexões iniciado', { service: 'connection-cleanup' });
                } else {
                    logStructured('info', 'Serviço de limpeza de conexões desabilitado neste processo', {
                        service: 'connection-cleanup',
                        reason: 'ENABLE_CONNECTION_CLEANUP_SERVICE=false'
                    });
                }

                // ✅ Iniciar serviço de cobrança diária de assinatura somente após estabilização regional
                if (isDailySubscriptionBillingEnabled()) {
                    const dailySubscriptionService = require('../services/daily-subscription-service');
                    scheduleDailySubscription({ dailySubscriptionService, logStructured, logError });
                } else {
                    logStructured('info', 'Cobrança diária de assinatura suspensa por configuração', {
                        service: 'daily-subscription',
                        reason: 'SUBSCRIPTION_DAILY_BILLING_ENABLED=false'
                    });
                }

                // Relatorio diario de earnings/custo por corrida para canal operacional.
                if (boolEnv('DAILY_EARNINGS_REPORT_ENABLED', true)) {
                    try {
                        const dailyEarningsReportService = require('../services/daily-earnings-report-service');
                        dailyEarningsReportService.startScheduler();
                    } catch (dailyEarningsError) {
                        logStructured('warn', 'Falha ao iniciar scheduler de earnings diario', {
                            service: 'daily-earnings-report',
                            error: dailyEarningsError.message
                        });
                    }
                } else {
                    logStructured('info', 'Scheduler de earnings diario desabilitado neste processo', {
                        service: 'daily-earnings-report',
                        reason: 'DAILY_EARNINGS_REPORT_ENABLED=false'
                    });
                }

                // Reprocessa finalizacoes pendentes (outbox) para garantir persistencia no Firestore.
                if (boolEnv('RIDE_FINALIZATION_OUTBOX_ENABLED', true)) {
                    try {
                        const ridePersistenceService = require('../services/ride-persistence-service');
                        const outboxIntervalMs = Number.parseInt(process.env.RIDE_FINALIZATION_OUTBOX_INTERVAL_MS || '10000', 10);
                        setInterval(async () => {
                            const stats = await ridePersistenceService.processFinalizationOutboxBatch(30);
                            if ((stats.processed || 0) > 0 || (stats.retried || 0) > 0 || (stats.failed || 0) > 0) {
                                logStructured('info', 'Outbox de finalizacao processado', {
                                    service: 'ride-persistence',
                                    processed: stats.processed || 0,
                                    retried: stats.retried || 0,
                                    failed: stats.failed || 0
                                });
                            }
                        }, outboxIntervalMs);
                    } catch (outboxInitError) {
                        logStructured('error', 'Falha ao iniciar processador de outbox de finalizacao', {
                            service: 'ride-persistence',
                            error: outboxInitError.message
                        });
                    }
                } else {
                    logStructured('info', 'Processador de outbox de finalizacao desabilitado neste processo', {
                        service: 'ride-persistence',
                        reason: 'RIDE_FINALIZATION_OUTBOX_ENABLED=false'
                    });
                }

                logStructured('info', 'Health endpoint disponível', { service: 'server', healthEndpoint: `http://localhost:${PORT}/health` });
                logStructured('info', 'SERVIDOR ESCUTANDO NA PORTA', { service: 'server', port: PORT, host: HOST });
            }); // Fecha server.listen callback
        } catch (error) {
            logError(error, 'Erro ao inicializar servidor', { service: 'server' });
            process.exit(1);
        }
    })();
}

module.exports = startHttpServer;
module.exports.initializeGraphQL = initializeGraphQL;
module.exports.isLegacyGraphqlEnabled = isLegacyGraphqlEnabled;

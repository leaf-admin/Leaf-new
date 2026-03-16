async function initializeGraphQL({ app, applyMiddleware, logStructured, logError }) {
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

    } catch (error) {
        logError(error, 'Erro ao inicializar GraphQL', { service: 'graphql' });
        // Continuar sem GraphQL se houver erro
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
            await initializeGraphQL({ app, applyMiddleware, logStructured, logError });
            logStructured('info', 'GraphQL inicializado, iniciando servidor HTTP', { service: 'server' });

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
                    graphqlEndpoint: `http://localhost:${PORT}/graphql`,
                    websocketEndpoint: `ws://localhost:${PORT}`
                });

                // ✅ Injetar Socket.IO no SupportChatService
                const supportChatService = require('../services/support-chat-service');
                supportChatService.setIOInstance(io);
                logStructured('info', 'Support Chat Service conectado ao Socket.IO', { service: 'support-chat' });

                // ✅ Iniciar serviço de limpeza automática de conexões
                const connectionCleanupService = new ConnectionCleanupService(io);
                connectionCleanupService.start();
                logStructured('info', 'Serviço de limpeza de conexões iniciado', { service: 'connection-cleanup' });

                // ✅ Iniciar serviço de cobrança diária de assinatura
                const dailySubscriptionService = require('../services/daily-subscription-service');
                scheduleDailySubscription({ dailySubscriptionService, logStructured, logError });

                // Reprocessa finalizacoes pendentes (outbox) para garantir persistencia no Firestore.
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

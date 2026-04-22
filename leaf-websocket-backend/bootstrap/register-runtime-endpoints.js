function registerRuntimeEndpoints({ app, io, VPS_CONFIG, logStructured }) {
    const legacyRuntimeEndpointsEnabled =
        String(process.env.ENABLE_LEGACY_RUNTIME_ENDPOINTS || 'false').toLowerCase() === 'true';
    const runtimeAccessToken = String(
        process.env.RUNTIME_ADMIN_TOKEN || process.env.RESTART_TOKEN || ''
    ).trim();
    const runtimeAccessTokenConfigured = runtimeAccessToken.length > 0;

    const enforceRuntimeAccess = (req, res, next) => {
        if (!runtimeAccessTokenConfigured) {
            if (process.env.NODE_ENV === 'production') {
                return res.status(503).json({
                    error: 'Token de runtime nao configurado',
                    hint: 'Configure RUNTIME_ADMIN_TOKEN no ambiente'
                });
            }
            return next();
        }

        const providedToken =
            req.headers['x-runtime-token'] ||
            req.headers['x-restart-token'] ||
            req.query.token;

        if (providedToken !== runtimeAccessToken) {
            return res.status(403).json({ error: 'Token invalido' });
        }

        return next();
    };

    // ✅ Endpoint de restart (apenas em desenvolvimento ou com token)
    app.post('/restart', enforceRuntimeAccess, async (req, res) => {
        res.json({
            message: 'Reiniciando servidor...',
            timestamp: new Date().toISOString()
        });

        // Fechar servidor graciosamente após 1 segundo
        setTimeout(() => {
            logStructured('info', 'Reiniciando servidor via endpoint', { service: 'server', action: 'restart' });
            process.exit(0); // PM2 ou systemd vai reiniciar automaticamente
        }, 1000);
    });

    // Metrics endpoint ultra-otimizado
    // ✅ FASE 2.1: Endpoint Prometheus (formato padrão)
    app.get('/metrics', enforceRuntimeAccess, async (req, res) => {
        try {
            const { getMetrics } = require('../utils/prometheus-metrics');
            const metrics = await getMetrics();
            res.set('Content-Type', 'text/plain; version=0.0.4');
            res.send(metrics);
        } catch (error) {
            logStructured('error', 'Erro ao obter métricas Prometheus', {
                service: 'server',
                operation: 'getMetricsEndpoint',
                error: error.message
            });
            res.status(500).send('# Erro ao obter métricas\n');
        }
    });

    if (legacyRuntimeEndpointsEnabled) {
        // Endpoint antigo (mantido apenas quando legado estiver explicitamente habilitado).
        app.get('/metrics-old', enforceRuntimeAccess, async (req, res) => {
            try {
                const metrics = {
                    timestamp: new Date().toISOString(),
                    connections: {
                        total: io.engine.clientsCount,
                        max: VPS_CONFIG.MAX_CONNECTIONS,
                        percentage: (io.engine.clientsCount / VPS_CONFIG.MAX_CONNECTIONS * 100).toFixed(2)
                    },
                    performance: {
                        memory: process.memoryUsage(),
                        uptime: process.uptime(),
                        workers: VPS_CONFIG.CLUSTER_WORKERS
                    },
                    graphql: {
                        enabled: true,
                        queries: 26,
                        mutations: 6,
                        subscriptions: 6,
                        features: [
                            'Dashboard Resolver',
                            'User Resolver com DataLoader',
                            'Driver Resolver com Redis GEO',
                            'Booking Resolver',
                            'Cache Inteligente',
                            'Rate Limiting',
                            'Query Complexity Analysis'
                        ]
                    }
                };

                res.json(metrics);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        app.get('/stats', enforceRuntimeAccess, async (req, res) => {
            try {
                const stats = {
                    timestamp: new Date().toISOString(),
                    server: {
                        status: 'running',
                        uptime: process.uptime(),
                        memory: process.memoryUsage(),
                        workers: VPS_CONFIG.CLUSTER_WORKERS
                    },
                    websocket: {
                        connections: io.engine.clientsCount,
                        maxConnections: VPS_CONFIG.MAX_CONNECTIONS
                    },
                    graphql: {
                        status: 'active',
                        endpoint: '/graphql',
                        queries: 26,
                        mutations: 6,
                        subscriptions: 6,
                        features: [
                            'Dashboard Resolver',
                            'User Resolver com DataLoader',
                            'Driver Resolver com Redis GEO',
                            'Booking Resolver',
                            'Cache Inteligente',
                            'Rate Limiting',
                            'Query Complexity Analysis',
                            'Depth Limiting'
                        ]
                    },
                    performance: {
                        requestsPerSecond: VPS_CONFIG.MAX_REQUESTS_PER_SECOND,
                        maxConnections: VPS_CONFIG.MAX_CONNECTIONS,
                        clusterWorkers: VPS_CONFIG.CLUSTER_WORKERS
                    }
                };

                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }
}

module.exports = registerRuntimeEndpoints;

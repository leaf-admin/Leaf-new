function registerHttpRoutes({ app, logStructured, io = null }) {
    // Importar rotas de monitoramento do cache
    const cacheMonitoring = require('../routes/cache-monitoring');

    // Importar rotas de autenticação
    const authRoutes = require('../routes/auth-routes');
    const customOtpRoutes = require('../routes/auth-otp');

    // Importar rotas de autenticação admin (JWT)
    const adminAuthRoutes = require('../routes/admin-auth');

    // Importar rotas KYC
    const kycRoutes = require('../routes/kyc-routes');

    // Importar rotas KYC Proxy
    const kycProxyRoutes = require('../routes/kyc-proxy-routes');

    // Importar rotas KYC Analytics
    const kycAnalyticsRoutes = require('../routes/kyc-analytics-routes');

    // Importar rotas Dashboard
    const dashboardRoutes = require('../routes/dashboard');
    const pricingRoutes = require('../routes/pricing');

    // Importar rotas de Métricas
    const metricsRoutes = require('../routes/metrics');

    // Importar rotas Waitlist
    const waitlistRoutes = require('../routes/waitlist');

    // Importar rotas de verificação de status do driver
    const driverStatusCheckRoutes = require('../routes/driver-status-check');

    // Importar rotas de drivers
    const driversRoutes = require('../routes/drivers');
    const driverActivationRoutes = require('../routes/driver-activation');

    // Importar rotas de Notificações
    const notificationsRoutes = require('../routes/notifications');

    // Importar rotas de Alertas
    const alertsRoutes = require('../routes/alerts');

    // Importar rotas de Health Check
    const healthRoutes = require('../routes/health');

    // Importar rotas de Monitoramento de Filas
    const queueMonitoringRoutes = require('../routes/queue-monitoring');

    // Importar rotas de Places Cache (com feature flag)
    let placesRoutes = null;
    try {
        placesRoutes = require('../routes/places-routes');
        logStructured('info', 'Rotas de Places Cache carregadas', { service: 'server' });
    } catch (error) {
        logStructured('warn', 'Rotas de Places Cache não disponíveis', { service: 'server', error: error.message });
    }

    // Registrar rotas IMEDIATAMENTE após middleware básico
    logStructured('info', 'Registrando rotas...', { service: 'server' });

    // Rotas de monitoramento do cache
    app.use('/cache', cacheMonitoring);
    logStructured('info', 'Rotas de cache registradas', { service: 'server' });

    // Rotas de autenticação
    app.use('/auth', authRoutes);
    // Rotas de autenticação também em /api/auth
    app.use('/api/auth', authRoutes);
    app.use('/api/custom-otp', customOtpRoutes);
    logStructured('info', 'Rotas de Autenticação registradas', { service: 'server' });

    // Rotas de autenticação admin (JWT)
    app.use('/api/admin/auth', adminAuthRoutes);
    logStructured('info', 'Rotas de Autenticação Admin (JWT) registradas', { service: 'server' });

    // Rotas KYC
    app.use('/api/kyc', kycRoutes.getRouter());

    // Rotas KYC Proxy (para microserviço)
    app.use('/api/kyc-proxy', kycProxyRoutes.getRouter());

    // Rotas KYC Analytics
    app.use('/api/kyc-analytics', kycAnalyticsRoutes.getRouter());
    logStructured('info', 'Rotas KYC registradas', { service: 'server' });

    // ✅ Rotas de OCR (CNH e Documento do Veículo) - ANTES das rotas catch-all
    // IMPORTANTE: Registrar ANTES de rotas catch-all como dashboardRoutes
    try {
        const ocrRoutes = require('../routes/ocr-routes');
        app.use('/api/ocr', ocrRoutes);
        logStructured('info', 'Rotas de OCR registradas', { service: 'server' });
    } catch (error) {
        logStructured('warn', 'Rotas de OCR não disponíveis', { service: 'server', error: error.message });
    }

    // Rotas de Support (registrar antes de dashboard para evitar conflito de path /api/support/*).
    const supportFullRoutes = require('../routes/support');
    app.use('/api/support', supportFullRoutes);

    // Rotas de Chat de Suporte (Redis Pub/Sub + Firestore)
    const supportChatRoutes = require('../routes/support-chat');
    app.use('/api/support', supportChatRoutes);

    if (supportFullRoutes.setIOInstance && io) {
        supportFullRoutes.setIOInstance(io);
    }
    logStructured('info', 'Rotas de Support (completo) registradas com WebSocket', { service: 'server' });

    // Rotas de Geofence (registradas antes do dashboard para evitar conflitos de matching)
    const geofenceRoutes = require('../routes/geofence-routes');
    app.use('/api/geofence', geofenceRoutes);
    logStructured('info', 'Rotas de Geofence registradas', { service: 'server' });

    // Rotas de Programas de Convites / Founder
    const referralProgramsRoutes = require('../routes/referral-programs');
    app.use('/api/programs/referrals', referralProgramsRoutes);
    logStructured('info', 'Rotas de Programas de Convites registradas', { service: 'server' });

    // Rotas Dashboard
    app.use('/', dashboardRoutes);
    logStructured('info', 'Rotas Dashboard registradas', { service: 'server' });

    // Rotas de Pricing
    app.use('/api', pricingRoutes);
    logStructured('info', 'Rotas de Pricing registradas', { service: 'server' });

    // Rotas de Métricas
    app.use('/', metricsRoutes);
    logStructured('info', 'Rotas de Métricas registradas', { service: 'server' });

    // Rotas de Worker Health
    const workerHealthRoutes = require('../routes/worker-health');
    app.use('/', workerHealthRoutes);
    logStructured('info', 'Rotas de Worker Health registradas', { service: 'server' });

    // Rotas Waitlist - ANTES do CORS global para evitar conflitos
    // Nota: waitlistRoutes tem seu próprio middleware CORS que sobrescreve o global
    app.use('/', waitlistRoutes);
    logStructured('info', 'Rotas Waitlist registradas', { service: 'server' });

    // Rotas de verificação de status do driver
    app.use('/api/driver-status', driverStatusCheckRoutes);

    // Rotas de drivers (inclui /api/drivers/nearby)
    app.use('/', driversRoutes);
    app.use('/', driverActivationRoutes);
    logStructured('info', 'Rotas de Drivers registradas', { service: 'server' });
    logStructured('info', 'Rotas de Ativação de Motorista registradas', { service: 'server' });
    logStructured('info', 'Rotas de verificação de status do driver registradas', { service: 'server' });

    // Rotas de Conta (Account Management)
    const accountRoutes = require('../routes/account-routes');
    app.use('/', accountRoutes);
    logStructured('info', 'Rotas de Conta (Account) registradas', { service: 'server' });

    // Rotas de Payment (Saldo do motorista e pagamentos)
    const paymentRoutes = require('../routes/payment');
    app.use('/api', paymentRoutes); // As rotas começam com /payment, então /api + /payment = /api/payment
    logStructured('info', 'Rotas de Payment registradas', { service: 'server' });

    // ✅ Rotas de Woovi (Webhooks e integração)
    const wooviRoutes = require('../routes/woovi');
    app.use('/api', wooviRoutes); // As rotas começam com /woovi, então /api + /woovi = /api/woovi
    logStructured('info', 'Rotas de Woovi registradas', { service: 'server' });

    // Rotas de Help
    const helpRoutes = require('../routes/help-routes');
    app.use('/api/help', helpRoutes);
    logStructured('info', 'Rotas de Help registradas', { service: 'server' });

    // ✅ Rotas de KYC Onboarding (CNH + Selfie)
    const kycOnboardingRoutes = require('../routes/kyc-onboarding');
    app.use('/', kycOnboardingRoutes);
    logStructured('info', 'Rotas de KYC Onboarding registradas', { service: 'server' });

    // Rotas de Alertas
    app.use('/api/alerts', alertsRoutes);
    logStructured('info', 'Rotas de Alertas registradas', { service: 'server' });

    // Rotas de Health Check
    app.use('/', healthRoutes);
    logStructured('info', 'Rotas de Health Check registradas', { service: 'server' });

    // Rotas de App Info
    const appRoutes = require('../routes/app-routes');
    app.use('/api/app', appRoutes);
    logStructured('info', 'Rotas de App Info registradas', { service: 'server' });

    // Rotas públicas legais (Privacy Policy, Terms, Account Deletion)
    const legalPagesRoutes = require('../routes/legal-pages');
    app.use('/', legalPagesRoutes);
    logStructured('info', 'Rotas de páginas legais registradas', { service: 'server' });

    // Rotas de Notificações
    app.use('/api/notifications', notificationsRoutes);
    logStructured('info', 'Rotas de Notificações registradas', { service: 'server' });

    // Rotas de Monitoramento de Filas (FASE 10)
    app.use('/', queueMonitoringRoutes);
    logStructured('info', 'Rotas de Monitoramento de Filas registradas', { service: 'server' });

    // Rotas de Places Cache (com feature flag)
    if (process.env.ENABLE_PLACES_CACHE !== 'false' && placesRoutes) {
        try {
            app.use('/', placesRoutes);

            // Inicializar serviço de Places Cache
            const placesCacheService = require('../services/places-cache-service');
            placesCacheService.initialize().catch(error => {
                logStructured('warn', 'Places Cache Service não inicializado', { service: 'server', error: error.message });
            });

            logStructured('info', 'Rotas de Places Cache registradas', { service: 'server' });
        } catch (error) {
            logStructured('warn', 'Erro ao registrar rotas de Places Cache', { service: 'server', error: error.message });
            // Não quebra o servidor se Places Cache falhar
        }
    } else {
        logStructured('info', 'Places Cache desabilitado (ENABLE_PLACES_CACHE=false ou rotas não disponíveis)', { service: 'server' });
    }
}

module.exports = registerHttpRoutes;

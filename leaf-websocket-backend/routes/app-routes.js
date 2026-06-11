const express = require('express');
const { logStructured, logError } = require('../utils/logger');
const paymentRuntimeProfileService = require('../services/payment-runtime-profile-service');
const { getPilotLaunchFlags } = require('../utils/pilot-launch-flags');
const router = express.Router();

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);

function envBool(name, fallback = false) {
    const rawValue = process.env[name];
    if (rawValue == null || rawValue === '') return fallback;
    const normalized = String(rawValue).trim().toLowerCase();
    if (TRUTHY_VALUES.has(normalized)) return true;
    if (FALSY_VALUES.has(normalized)) return false;
    return fallback;
}

function presence(name) {
    return String(process.env[name] || '').trim().length > 0;
}

function classifyWooviBaseUrl(baseUrl) {
    const normalized = String(baseUrl || '').trim().toLowerCase();
    if (!normalized) return 'unknown';
    if (normalized.includes('sandbox')) return 'sandbox';
    if (normalized.includes('api.woovi.com')) return 'production';
    return 'custom';
}

function getOptionalRuntimeContext(req) {
    const header = (name) => String(req.headers[name] || '').trim();
    const query = (name) => String(req.query?.[name] || '').trim();

    return {
        userId:
            header('x-leaf-user-id') ||
            header('x-user-id') ||
            header('x-passenger-id') ||
            query('userId') ||
            query('passengerId') ||
            null,
        passengerId:
            header('x-passenger-id') ||
            header('x-leaf-user-id') ||
            query('passengerId') ||
            query('userId') ||
            null,
        phone:
            header('x-leaf-phone') ||
            header('x-phone') ||
            query('phone') ||
            query('phoneNumber') ||
            null,
        phoneNumber:
            header('x-phone') ||
            header('x-leaf-phone') ||
            query('phoneNumber') ||
            query('phone') ||
            null,
        appReview: envBool('APP_REVIEW', false)
    };
}

function buildMapsRoutingPolicy() {
    const clientDirectGoogleFallback =
        envBool('EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false) ||
        envBool('ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK', false);
    return {
        backendOnly: presence('GOOGLE_MAPS_API_KEY') && !clientDirectGoogleFallback,
        clientDirectGoogleFallback,
        placesCacheEnabled: envBool('ENABLE_PLACES_CACHE', true),
        placesCacheTtlSeconds: Number.parseInt(process.env.PLACES_CACHE_TTL_SECONDS || `${30 * 24 * 60 * 60}`, 10),
        routesCacheEnabled: envBool('ENABLE_ROUTES_CACHE', true),
        routesCacheTtlSeconds: Number.parseInt(process.env.ROUTES_CACHE_TTL_SECONDS || `${5 * 60}`, 10),
        trafficAwareRoutes: envBool('ENABLE_TRAFFIC_AWARE_ROUTES', true),
        alternativeRoutesEnabled: envBool('ENABLE_ALTERNATIVE_ROUTES', false)
    };
}

function buildNotificationPolicy() {
    const firebaseAdminConfigured =
        presence('FIREBASE_SERVICE_ACCOUNT_JSON') ||
        presence('GOOGLE_APPLICATION_CREDENTIALS_JSON') ||
        presence('GOOGLE_APPLICATION_CREDENTIALS');
    return {
        configured: firebaseAdminConfigured || presence('FCM_SERVER_KEY'),
        provider: 'firebase-admin',
        fcmConfigured: firebaseAdminConfigured || presence('FCM_SERVER_KEY'),
        allowPublicDirectFcmSend: envBool('ALLOW_PUBLIC_DIRECT_FCM_SEND', false),
        smartPushMode: envBool('SMART_PUSH_DRY_RUN', false)
            ? 'dryRun'
            : envBool('SMART_PUSH_ENABLED', false)
                ? 'enabled'
                : 'disabled',
        persistentRideNotificationsEnabled: envBool('ENABLE_PERSISTENT_RIDE_NOTIFICATIONS', true),
        defaultTtlSeconds: Number.parseInt(process.env.NOTIFICATION_DEFAULT_TTL_SECONDS || `${60 * 60}`, 10)
    };
}

function buildBiometricRuntime() {
    return {
        strictModeEnabled: envBool('KYC_PRODUCTION_BIOMETRICS_ENABLED', false),
        awsLivenessEnabled: envBool('KYC_AWS_LIVENESS_ENABLED', false) || envBool('AWS_LIVENESS_ENABLED', false),
        faceCompareEnabled: presence('BIOMETRIC_FACE_SERVICE_URL'),
        cnhFaceBiometricsEnabled: envBool('ENABLE_CNH_FACE_BIOMETRICS', false),
        requireTrustedBiometricMatch: envBool('KYC_REQUIRE_TRUSTED_BIOMETRIC_MATCH', false)
    };
}

function buildDriverOnlinePolicy() {
    const geofenceBypass =
        envBool('BYPASS_GEOFENCE', false) ||
        String(process.env.GEOFENCE_RADIUS_KM || '') === '9999';
    return {
        backendGoverned: true,
        geofenceEnforced: envBool('ENABLE_DRIVER_ONLINE_GEOFENCE', false) && !geofenceBypass,
        geofenceBypass,
        requireApprovedDocuments: envBool('DRIVER_ONLINE_REQUIRE_APPROVED_DOCUMENTS', true),
        requireFreshLiveness: envBool('DRIVER_ONLINE_REQUIRE_FRESH_LIVENESS', false),
        minAppVersion: String(process.env.DRIVER_ONLINE_MIN_APP_VERSION || '').trim() || null
    };
}

function buildSupportPolicy() {
    return {
        inAppChatEnabled: envBool('ENABLE_IN_APP_SUPPORT_CHAT', true),
        ticketEscalationEnabled: envBool('ENABLE_SUPPORT_TICKET_ESCALATION', true),
        copilotMode: envBool('SUPPORT_ORCHESTRATOR_AUTOREPLY_ENABLED', false) ? 'unsafe_autoreply' : 'guarded_copilot'
    };
}

/**
 * GET /api/app/info
 * Buscar informações do app
 */
router.get('/info', async (req, res) => {
    try {
        const appInfo = {
            version: '1.0.0',
            buildNumber: '1',
            lastUpdate: new Date().toISOString().split('T')[0],
            features: [
                { icon: 'card-outline', title: 'Pagamento PIX', description: 'Pagamento instantâneo e seguro via PIX' },
                { icon: 'shield-checkmark-outline', title: 'Segurança Total', description: 'Motoristas verificados e viagens monitoradas' },
                { icon: 'location-outline', title: 'Rastreamento em Tempo Real', description: 'Acompanhe sua viagem em tempo real' },
                { icon: 'chatbubbles-outline', title: 'Suporte 24/7', description: 'Suporte ao cliente disponível 24 horas' },
            ],
            team: [],
            changelog: [
                {
                    version: process.env.APP_VERSION || '1.0.3',
                    date: new Date().toISOString().split('T')[0],
                    title: 'Leaf em produção assistida',
                    description: '• Pagamento via Pix\n• Busca de motoristas em tempo real\n• Rastreamento de viagem\n• Chat integrado\n• Ganhos e saque para motoristas'
                }
            ]
        };

        res.json(appInfo);
    } catch (error) {
        logError(error, '❌ Erro ao buscar informações do app:', { service: 'app-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar informações do app' });
    }
});

/**
 * GET /api/app/runtime-config
 * Configuração pública e segura de runtime consumida pelo app.
 * Não expõe credenciais e não chama provedores pagos diretamente.
 */
router.get('/runtime-config', async (req, res) => {
    try {
        const context = getOptionalRuntimeContext(req);
        const [paymentSummary, effectivePaymentProfile] = await Promise.all([
            paymentRuntimeProfileService.getRuntimeSummary(),
            paymentRuntimeProfileService.resolveProfile(context)
        ]);

        const hasRuntimeContext = Boolean(context.userId || context.passengerId || context.phone || context.phoneNumber);

        res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=120');
        return res.json({
            schemaVersion: 1,
            environment: String(process.env.NODE_ENV || 'production').trim().toLowerCase(),
            generatedAt: new Date().toISOString(),
            cacheTtlSeconds: 30,
            staleTtlSeconds: 120,
            paymentRuntime: {
                provider: 'woovi',
                defaultEnvironment: paymentSummary.defaultEnvironment,
                defaultProfile: paymentSummary.defaultProfile,
                canarySandboxEnabled: paymentSummary.canarySandboxEnabled,
                globalSandboxEnabled: paymentSummary.globalSandboxEnabled,
                activeProfileCount: paymentSummary.activeProfileCount,
                effectiveProfile: {
                    profileId: effectivePaymentProfile.profileId,
                    name: effectivePaymentProfile.name,
                    environment: effectivePaymentProfile.environment,
                    scope: effectivePaymentProfile.scope,
                    source: effectivePaymentProfile.source,
                    reason: effectivePaymentProfile.reason,
                    expiresAtIso: effectivePaymentProfile.expiresAtIso || null,
                    contextMatched: hasRuntimeContext
                }
            },
            biometricRuntime: buildBiometricRuntime(),
            featureGates: getPilotLaunchFlags(),
            mapsRoutingPolicy: buildMapsRoutingPolicy(),
            notificationPolicy: buildNotificationPolicy(),
            driverOnlinePolicy: buildDriverOnlinePolicy(),
            campaignSurfaces: {
                passengerHome: envBool('ENABLE_PASSENGER_HOME_CAMPAIGNS', true),
                driverHome: envBool('ENABLE_DRIVER_HOME_CAMPAIGNS', true)
            },
            legalUrls: {
                privacy: 'https://leaf.app.br/privacy',
                terms: 'https://leaf.app.br/terms'
            },
            supportPolicy: buildSupportPolicy()
        });
    } catch (error) {
        logError(error, '❌ Erro ao buscar runtime config do app', { service: 'app-routes' });
        return res.status(503).json({
            error: 'Runtime config indisponível',
            failSafe: {
                paymentRuntime: 'closed',
                biometricRuntime: 'closed',
                mapsRoutingPolicy: 'backend-only',
                campaignSurfaces: 'silent'
            }
        });
    }
});

/**
 * GET /api/app/stats
 * Buscar estatísticas do app
 */
router.get('/stats', async (req, res) => {
    try {
        const stats = {
            activeUsers: '50K+',
            totalTrips: '100K+',
            averageRating: '4.8'
        };

        res.json(stats);
    } catch (error) {
        logError(error, '❌ Erro ao buscar estatísticas:', { service: 'app-routes-routes' });
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

module.exports = router;

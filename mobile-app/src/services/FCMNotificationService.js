import Logger from '../utils/Logger';
import messaging from '@react-native-firebase/messaging';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../state/appStore';
import WebSocketManager from './WebSocketManager';
import {
    getBackgroundNotifications,
    persistBackgroundNotifications,
    saveBackgroundNotification
} from './BackgroundNotificationQueue';
import { registerFCMBackgroundMessageHandler } from './FCMBackgroundMessageHandler';

const SHOULD_DISABLE_SIMULATOR_LOCAL_NOTIFICATIONS =
    Platform.OS === 'ios' && !Device.isDevice;
const POST_NOTIFICATIONS_PERMISSION =
    PermissionsAndroid?.PERMISSIONS?.POST_NOTIFICATIONS || 'android.permission.POST_NOTIFICATIONS';
const ANDROID_13_API_LEVEL = 33;
const ALLOWED_NOTIFICATION_ROUTES = new Set([
    'Notifications',
    'RobotaxiPrototype',
    'RobotaxiPrototypeTrip',
    'RobotaxiPrototypeDriverTrip',
    'RobotaxiPrototypeDriverOffer',
    'RobotaxiPrototypeDriverSearch',
    'RobotaxiPrototypePayment',
    'RobotaxiPrototypePaymentSuccess',
    'RobotaxiPrototypePaymentFailed',
    'RobotaxiPrototypeReceipt',
    'RobotaxiPrototypeRating',
    'RobotaxiPrototypeChat',
    'RobotaxiPrototypeSupport',
    'RobotaxiPrototypeSupportTicket',
    'RobotaxiPrototypeShareTrip',
    'RobotaxiPrototypePublicTracking',
    'RobotaxiPrototypeDriverDocuments',
    'RobotaxiPrototypeDriverWaitlistStatus',
    'RobotaxiPrototypeNoDrivers',
    'RobotaxiPrototypeCancellation',
    'RobotaxiPrototypeComplain',
    'RobotaxiMenuTripHistory',
]);
const NOTIFICATION_SCREEN_ALIASES = {
    home: 'RobotaxiPrototype',
    trip: 'RobotaxiPrototypeTrip',
    ride: 'RobotaxiPrototypeTrip',
    ride_status: 'RobotaxiPrototypeTrip',
    trip_update: 'RobotaxiPrototypeTrip',
    driver_trip: 'RobotaxiPrototype',
    driver_offer: 'RobotaxiPrototypeDriverOffer',
    new_ride_offer: 'RobotaxiPrototypeDriverOffer',
    payment: 'RobotaxiPrototypePayment',
    payment_confirmation: 'RobotaxiPrototypePaymentSuccess',
    payment_success: 'RobotaxiPrototypePaymentSuccess',
    payment_failed: 'RobotaxiPrototypePaymentFailed',
    receipt: 'RobotaxiPrototypeReceipt',
    rating: 'RobotaxiPrototypeRating',
    rating_received: 'RobotaxiPrototypeReceipt',
    chat: 'RobotaxiPrototypeChat',
    support: 'RobotaxiPrototypeSupport',
    support_ticket: 'RobotaxiPrototypeSupportTicket',
    driver_document_request: 'RobotaxiPrototypeDriverDocuments',
    driver_documents: 'RobotaxiPrototypeDriverDocuments',
    documents: 'RobotaxiPrototypeDriverDocuments',
    driverdocuments: 'RobotaxiPrototypeDriverDocuments',
    kyc_reverification_required: 'RobotaxiPrototype',
    identity_reverification: 'RobotaxiPrototype',
    driver_waitlist_update: 'RobotaxiPrototypeDriverWaitlistStatus',
    driver_waitlist_joined: 'RobotaxiPrototypeDriverWaitlistStatus',
    driver_waitlist_approved: 'RobotaxiPrototypeDriverWaitlistStatus',
    driver_waitlist_rejected: 'RobotaxiPrototypeDriverWaitlistStatus',
    driver_waitlist_position_updated: 'RobotaxiPrototypeDriverWaitlistStatus',
    waitlist: 'RobotaxiPrototypeDriverWaitlistStatus',
    share_trip: 'RobotaxiPrototypeShareTrip',
    public_tracking: 'RobotaxiPrototypePublicTracking',
    no_drivers: 'RobotaxiPrototypeNoDrivers',
    cancellation: 'RobotaxiPrototypeCancellation',
    complaint: 'RobotaxiPrototypeComplain',
    complain: 'RobotaxiPrototypeComplain',
    history: 'RobotaxiMenuTripHistory',
};

const getAndroidApiLevel = () => {
    const version = Number(Platform.Version);
    return Number.isFinite(version) ? version : 0;
};

const parseNotificationParams = (params) => {
    if (!params) {
        return {};
    }

    if (typeof params === 'string') {
        try {
            const parsed = JSON.parse(params);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            return {};
        }
    }

    return typeof params === 'object' ? params : {};
};

const normalizeRouteKey = (value) =>
    String(value || '')
        .trim()
        .replace(/[\s-]+/g, '_')
        .toLowerCase();

const getGlobalNavigationRef = () => {
    const navigationContainerRef = globalThis?.navigationRef || global?.navigationRef || null;
    return navigationContainerRef?.current || navigationContainerRef;
};

class FCMNotificationService {
    constructor() {
        this.isInitialized = false;
        this.initializationPromise = null;
        this.fcmToken = null;
        this.notificationHandlers = new Map();
        this.backgroundMessageHandler = null;
        this.pendingTokenRegistration = null; // Token pendente para registrar quando WebSocket conectar
        this.wsConnectListener = null; // Listener para quando WebSocket conectar
        this.tokenRenewalInterval = null;
        this.retryTokenUpdateTimeout = null;
        this.backendTokenRegistrationPromise = null;
        this.lastBackendTokenRegistrationKey = null;
        this.pendingTokenRegistrationAfterInFlight = null;
        this.authUnsubscribe = null;
        this.lastAuthRegistrationIdentity = null;
        this.appStateSubscription = null;
        this.lastAppState = AppState?.currentState || 'active';
        this.pendingNotificationsProcessPromise = null;
        this.pendingNotificationsProcessTimeout = null;
    }

    // Inicializar o serviço FCM
    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = (async () => {
            try {
                Logger.log('🚀 Inicializando FCM Notification Service...');

                // Configurar handlers de notificação
                this.setupNotificationHandlers();

                // Obter token FCM (pode ser null - app funciona sem push)
                await this.getFCMToken();

                // Configurar handlers de background
                this.setupBackgroundHandlers();
                this.setupAuthChangeTokenRegistration();
                this.setupPendingNotificationProcessing();

                this.isInitialized = true;
                Logger.log('✅ FCM Notification Service inicializado com sucesso');

                // Configurar renovação periódica do token (apenas se token disponível)
                if (this.fcmToken) {
                    this.setupTokenRenewal();
                } else {
                    Logger.warn('⚠️ Token FCM não disponível. Renovação periódica não será configurada.');
                }

                return true;
            } catch (error) {
                // ✅ CRÍTICO: Erro ao inicializar FCM não deve quebrar o app
                Logger.error('❌ Erro ao inicializar FCM:', error);
                Logger.warn('⚠️ App continuará funcionando sem notificações push.');
                this.isInitialized = false;
                // Não lançar erro - app deve funcionar sem push
                return false;
            } finally {
                this.initializationPromise = null;
            }
        })();

        return this.initializationPromise;
    }

    // Solicitar permissões de notificação
    async requestUserPermission() {
        try {
            if (Platform.OS === 'ios') {
                const authStatus = await messaging().requestPermission();
                const enabled =
                    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

                if (enabled) {
                    Logger.log('✅ Permissões de notificação concedidas');
                } else {
                    Logger.log('⚠️ Permissões de notificação negadas');
                }

                return enabled;
            }

            if (Platform.OS === 'android') {
                if (getAndroidApiLevel() < ANDROID_13_API_LEVEL) {
                    Logger.log('✅ Permissões Android configuradas');
                    return true;
                }

                const alreadyGranted = await PermissionsAndroid.check(POST_NOTIFICATIONS_PERMISSION);
                if (alreadyGranted) {
                    Logger.log('✅ Permissão POST_NOTIFICATIONS já concedida');
                    return true;
                }

                const result = await PermissionsAndroid.request(POST_NOTIFICATIONS_PERMISSION);
                const granted = result === PermissionsAndroid.RESULTS.GRANTED;
                if (granted) {
                    Logger.log('✅ Permissão POST_NOTIFICATIONS concedida');
                } else {
                    Logger.log('⚠️ Permissão POST_NOTIFICATIONS negada');
                }
                return granted;
            }

            return true;
        } catch (error) {
            Logger.error('❌ Erro ao solicitar permissões:', error);
            return false;
        }
    }

    async hasNotificationPermission() {
        try {
            if (Platform.OS === 'ios') {
                const authStatus = await messaging().hasPermission();
                return (
                    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
                    authStatus === messaging.AuthorizationStatus.PROVISIONAL
                );
            }

            if (Platform.OS === 'android' && getAndroidApiLevel() >= ANDROID_13_API_LEVEL) {
                return PermissionsAndroid.check(POST_NOTIFICATIONS_PERMISSION);
            }

            return true;
        } catch (error) {
            Logger.warn('⚠️ Erro ao verificar permissões de notificação:', error);
            return false;
        }
    }

    async ensureNotificationPermission() {
        try {
            const alreadyGranted = await this.hasNotificationPermission();
            if (alreadyGranted) {
                return true;
            }

            return this.requestUserPermission();
        } catch (error) {
            Logger.error('❌ Erro ao garantir permissões de notificação:', error);
            return false;
        }
    }

    getAuthRegistrationIdentity() {
        try {
            const userState = store.getState().auth;
            const userId = userState?.uid || userState?.profile?.uid || 'anonymous';
            const userType = userState?.userType || userState?.profile?.userType || 'customer';
            return `${userId}:${userType}`;
        } catch (error) {
            return 'anonymous:customer';
        }
    }

    setupAuthChangeTokenRegistration() {
        if (this.authUnsubscribe || typeof store.subscribe !== 'function') {
            return;
        }

        this.lastAuthRegistrationIdentity = this.getAuthRegistrationIdentity();
        this.authUnsubscribe = store.subscribe(() => {
            const nextIdentity = this.getAuthRegistrationIdentity();
            if (nextIdentity === this.lastAuthRegistrationIdentity) {
                return;
            }

            this.lastAuthRegistrationIdentity = nextIdentity;
            if (this.fcmToken) {
                Logger.log('🔄 Usuário mudou; re-registrando token FCM para o contexto atual.');
                this.scheduleTokenBackendUpdate(this.fcmToken);
            }
        });
    }

    async ensurePermissionBeforeDisplay() {
        try {
            const permissionGranted = await this.ensureNotificationPermission();
            if (!permissionGranted) {
                Logger.warn('⚠️ Notificação local não exibida porque a permissão não foi concedida.');
            }
            return permissionGranted;
        } catch (error) {
            Logger.error('❌ Erro ao preparar exibição de notificação:', error);
            return false;
        }
    }

    async ensurePermissionBeforeToken() {
        const permissionGranted = await this.ensureNotificationPermission();
        if (!permissionGranted) {
            Logger.warn('⚠️ Token FCM não será solicitado sem permissão de notificação.');
            this.fcmToken = null;
            return false;
        }

        return true;
    }

    // Obter token FCM
    async getFCMToken() {
        try {
            // iOS Simulator não suporta token APNS/FCM real
            if (!Device.isDevice) {
                Logger.log('ℹ️ [FCM] Simulador detectado. Token push será ignorado neste ambiente.');
                this.fcmToken = null;
                return null;
            }

            const permissionGranted = await this.ensurePermissionBeforeToken();
            if (!permissionGranted) {
                return null;
            }

            // Verificar se já temos um token salvo
            const savedToken = await AsyncStorage.getItem('fcmToken');

            if (savedToken) {
                this.fcmToken = savedToken;
                Logger.log('📱 Token FCM recuperado do cache:', savedToken);
            }

            // Obter novo token
            const token = await messaging().getToken();

            if (token) {
                this.fcmToken = token;
                await AsyncStorage.setItem('fcmToken', token);
                Logger.log('🆕 Novo token FCM obtido:', token);

                // Registrar no backend em background. Push não deve segurar o bootstrap do app.
                this.scheduleTokenBackendUpdate(token);
            } else {
                // ✅ CRÍTICO: Token null é aceitável - app funciona sem push
                Logger.warn('⚠️ Token FCM não disponível. App continuará funcionando normalmente.');
                this.fcmToken = null;
            }

            return token;

        } catch (error) {
            // ✅ CRÍTICO: Erro ao obter token não deve quebrar o app
            Logger.error('❌ Erro ao obter token FCM:', error);
            Logger.warn('⚠️ App continuará funcionando sem notificações push.');
            this.fcmToken = null;
            return null;
        }
    }

    scheduleTokenBackendUpdate(token) {
        if (!token) {
            return null;
        }

        if (this.backendTokenRegistrationPromise) {
            this.pendingTokenRegistrationAfterInFlight = token;
            return this.backendTokenRegistrationPromise;
        }

        this.backendTokenRegistrationPromise = this.updateTokenOnBackend(token)
            .catch((error) => {
                Logger.warn('⚠️ Registro FCM em background falhou:', error?.message || error);
                return false;
            })
            .finally(() => {
                this.backendTokenRegistrationPromise = null;
                const tokenToRegister = this.pendingTokenRegistrationAfterInFlight;
                this.pendingTokenRegistrationAfterInFlight = null;
                if (tokenToRegister && tokenToRegister === this.fcmToken) {
                    this.scheduleTokenBackendUpdate(tokenToRegister);
                }
            });

        return this.backendTokenRegistrationPromise;
    }

    ensureWebSocketConnectListener(wsManager) {
        if (this.wsConnectListener) {
            return;
        }

        this.wsConnectListener = () => {
            if (this.pendingTokenRegistration) {
                Logger.log('🔄 WebSocket conectado, registrando token FCM pendente...');
                this.registerPendingToken();
            }
        };
        wsManager.on('connect', this.wsConnectListener);
    }

    // Atualizar token no backend
    async updateTokenOnBackend(token) {
        try {
            // ✅ CRÍTICO: Se token for null, não tentar registrar
            if (!token) {
                Logger.warn('⚠️ Token FCM é null. Não será registrado no backend. App continuará funcionando normalmente.');
                return;
            }

            Logger.log('📤 Enviando token FCM para backend:', token);

            // Obter userId do Redux store ou TestUserService
            const userState = store.getState().auth;
            let userId = userState?.uid || userState?.profile?.uid;
            let userType = userState?.userType || userState?.profile?.userType || 'customer';

            // Bypass para usuários de teste em desenvolvimento
            if (__DEV__ && (!userId || userId === 'anonymous')) {
                Logger.log('🧪 Modo de desenvolvimento: Usando usuário de teste para FCM');
                userId = 'test-user-dev';
            }

            // ✅ FIX: Allow sending FCM token even without userId (backend supports temporary tokens)
            if (!userId || userId === 'anonymous') {
                Logger.log('ℹ️ Usuário não autenticado, enviando token como temporário...');
                userId = null; // Backend uses temp_<socket.id> when null
            }

            Logger.log('👤 Estado do usuário para FCM:', { userId, userType });

            const registrationKey = `${userId || 'anonymous'}:${userType}:${token}`;
            if (registrationKey === this.lastBackendTokenRegistrationKey) {
                Logger.log('ℹ️ Token FCM já registrado para o usuário atual; pulando duplicidade.');
                return;
            }

            // Registrar token via WebSocket (método correto)
            try {
                const wsManager = WebSocketManager.getInstance();

                // Se não estiver conectado, guardar o token e deixar o orquestrador
                // abrir o realtime quando a sessão já estiver hidratada.
                if (!wsManager.isConnected()) {
                    Logger.log('⏳ WebSocket não conectado, registrando token FCM quando conectar...');
                    this.pendingTokenRegistration = { token, userId, userType };
                    this.ensureWebSocketConnectListener(wsManager);
                    return;
                }

                if (wsManager.isConnected()) {
                    await wsManager.registerFCMToken({
                        userId: userId,
                        userType: userType,
                        fcmToken: token,
                        platform: Platform.OS,
                        timestamp: new Date().toISOString()
                    });

                    Logger.log('✅ Token FCM registrado no backend via WebSocket');
                    this.pendingTokenRegistration = null; // Limpar pendência
                    this.lastBackendTokenRegistrationKey = registrationKey;
                } else {
                    Logger.warn('⚠️ WebSocket não conectado após espera, token FCM será registrado quando a conexão for estabelecida');
                    // Salvar token pendente
                    this.pendingTokenRegistration = { token, userId, userType };
                    this.ensureWebSocketConnectListener(wsManager);
                }
            } catch (wsError) {
                Logger.error('❌ Erro ao registrar token FCM via WebSocket:', wsError);
                // Salvar token pendente apenas se token válido
                if (token) {
                    this.pendingTokenRegistration = { token, userId, userType };
                }
            }

        } catch (error) {
            Logger.error('❌ Erro ao atualizar token no backend:', error.message);
            // ✅ CRÍTICO: Não tentar novamente se token for null
            if (token) {
                // Tentar novamente em 5 segundos apenas se token válido
                if (this.retryTokenUpdateTimeout) {
                    clearTimeout(this.retryTokenUpdateTimeout);
                }
                this.retryTokenUpdateTimeout = setTimeout(() => {
                    this.retryTokenUpdateTimeout = null;
                    this.updateTokenOnBackend(token);
                }, 5000);
            }
        }
    }

    // Configurar handlers de notificação
    setupNotificationHandlers() {
        try {
            this.clearMessagingSubscriptions();

            // Handler para notificações em primeiro plano
            const unsubscribeForeground = messaging().onMessage(async remoteMessage => {
                Logger.log('📱 Notificação recebida em primeiro plano:', remoteMessage);

                // Processar notificação
                await this.handleForegroundNotification(remoteMessage);
            });

            // Handler para notificações quando app é aberto
            const unsubscribeNotificationOpened = messaging().onNotificationOpenedApp(remoteMessage => {
                Logger.log('📱 App aberto via notificação:', remoteMessage);

                // Processar notificação
                this.handleNotificationOpened(remoteMessage);
            });

            // Handler para notificação inicial (app fechado)
            messaging()
                .getInitialNotification()
                .then(remoteMessage => {
                    if (remoteMessage) {
                        Logger.log('📱 App aberto via notificação inicial:', remoteMessage);
                        this.handleNotificationOpened(remoteMessage);
                    }
                });

            // Salvar unsubscribe functions
            this.notificationHandlers.set('foreground', unsubscribeForeground);
            this.notificationHandlers.set('opened', unsubscribeNotificationOpened);

        } catch (error) {
            Logger.error('❌ Erro ao configurar handlers de notificação:', error);
        }
    }

    clearMessagingSubscriptions() {
        for (const type of ['foreground', 'opened']) {
            const unsubscribe = this.notificationHandlers.get(type);
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            this.notificationHandlers.delete(type);
        }
    }

    // Configurar handlers de background
    setupBackgroundHandlers() {
        try {
            registerFCMBackgroundMessageHandler();
        } catch (error) {
            Logger.error('❌ Erro ao configurar handlers de background:', error);
        }
    }

    setupPendingNotificationProcessing() {
        if (this.appStateSubscription || typeof AppState?.addEventListener !== 'function') {
            return;
        }

        this.lastAppState = AppState.currentState || 'active';
        this.appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
            const previousAppState = this.lastAppState;
            this.lastAppState = nextAppState;

            if (
                nextAppState === 'active' &&
                ['background', 'inactive'].includes(previousAppState)
            ) {
                Logger.log('📱 App voltou ao foreground; processando notificações pendentes.');
                this.schedulePendingNotificationsProcessing();
            }
        });
    }

    schedulePendingNotificationsProcessing(delayMs = 0) {
        if (!this.isInitialized) {
            return;
        }

        if (this.pendingNotificationsProcessTimeout) {
            clearTimeout(this.pendingNotificationsProcessTimeout);
        }

        if (delayMs <= 0) {
            this.pendingNotificationsProcessTimeout = null;
            void this.processPendingNotifications();
            return;
        }

        this.pendingNotificationsProcessTimeout = setTimeout(() => {
            this.pendingNotificationsProcessTimeout = null;
            void this.processPendingNotifications();
        }, delayMs);
    }

    // Processar notificação em primeiro plano
    async handleForegroundNotification(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            // Determinar tipo de notificação
            const notificationType = data?.type || 'general';

            // Executar handler específico se existir
            if (this.notificationHandlers.has(notificationType)) {
                await this.notificationHandlers.get(notificationType)(remoteMessage);
            } else {
                // Handler padrão
                await this.handleDefaultNotification(remoteMessage);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar notificação em primeiro plano:', error);
        }
    }

    // Processar notificação quando app é aberto
    handleNotificationOpened(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            // Navegar para tela específica baseada no tipo
            this.navigateToScreen(remoteMessage);

        } catch (error) {
            Logger.error('❌ Erro ao processar notificação aberta:', error);
        }
    }

    // Processar mensagem em background
    async handleBackgroundMessage(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            // Salvar notificação para processamento posterior
            await this.saveBackgroundNotification(remoteMessage);

            // Processar baseado no tipo
            const notificationType = data?.type || 'general';
            if (this.notificationHandlers.has(notificationType)) {
                await this.notificationHandlers.get(notificationType)(remoteMessage);
                return;
            }

            switch (notificationType) {
                case 'trip_update':
                    await this.handleTripUpdate(remoteMessage);
                    break;
                case 'payment_confirmation':
                    await this.handlePaymentConfirmation(remoteMessage);
                    break;
                case 'rating_received':
                    await this.handleRatingReceived(remoteMessage);
                    break;
                default:
                    Logger.log('📱 Notificação de background não processada:', notificationType);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar mensagem em background:', error);
        }
    }

    // Handler padrão para notificações
    async handleDefaultNotification(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            Logger.log('📱 Notificação padrão processada:', notification?.title);

            // Mostrar notificação local usando expo-notifications
            if (notification && !SHOULD_DISABLE_SIMULATOR_LOCAL_NOTIFICATIONS) {
                const permissionGranted = await this.ensurePermissionBeforeDisplay();
                if (!permissionGranted) {
                    return;
                }

                const { scheduleNotificationAsync } = await import('expo-notifications');

                await scheduleNotificationAsync({
                    content: {
                        title: notification.title || 'Leaf App',
                        body: notification.body || 'Nova notificação',
                        data: data || {}
                    },
                    trigger: null // Mostrar imediatamente
                });
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar notificação padrão:', error);
        }
    }

    // Handler para atualizações de viagem
    async handleTripUpdate(remoteMessage) {
        try {
            const { data } = remoteMessage;

            Logger.log('🚗 Atualização de viagem recebida:', data);

            // Atualizar estado da viagem no Redux
            // TODO: Implementar dispatch para Redux

        } catch (error) {
            Logger.error('❌ Erro ao processar atualização de viagem:', error);
        }
    }

    // Handler para confirmação de pagamento
    async handlePaymentConfirmation(remoteMessage) {
        try {
            const { data } = remoteMessage;

            Logger.log('💳 Confirmação de pagamento recebida:', data);

            // Atualizar estado de pagamento
            // TODO: Implementar dispatch para Redux

        } catch (error) {
            Logger.error('❌ Erro ao processar confirmação de pagamento:', error);
        }
    }

    // Handler para avaliação recebida
    async handleRatingReceived(remoteMessage) {
        try {
            const { data } = remoteMessage;

            Logger.log('⭐ Avaliação recebida:', data);

            // Atualizar estado de avaliações
            // TODO: Implementar dispatch para Redux

        } catch (error) {
            Logger.error('❌ Erro ao processar avaliação recebida:', error);
        }
    }

    resolveNotificationNavigationTarget(remoteMessage) {
        const data = remoteMessage?.data || {};
        const explicitScreen = String(data.screen || data.routeName || '').trim();
        const aliasedScreen =
            NOTIFICATION_SCREEN_ALIASES[normalizeRouteKey(explicitScreen)] ||
            NOTIFICATION_SCREEN_ALIASES[normalizeRouteKey(data.type)] ||
            NOTIFICATION_SCREEN_ALIASES[normalizeRouteKey(data.notificationType)];
        const routeName = ALLOWED_NOTIFICATION_ROUTES.has(explicitScreen)
            ? explicitScreen
            : aliasedScreen;
        const hasUntrustedExplicitScreen = Boolean(explicitScreen) && !routeName;

        const userType = String(data.userType || data.role || '').trim().toLowerCase();
        const status = String(data.status || '').trim().toLowerCase();
        const resolvedRouteName =
            routeName ||
            (userType === 'driver' && data.bookingId
                ? 'RobotaxiPrototype'
                : data.bookingId
                    ? 'RobotaxiPrototypeTrip'
                    : 'Notifications');

        if (!ALLOWED_NOTIFICATION_ROUTES.has(resolvedRouteName)) {
            return {
                routeName: 'Notifications',
                params: { source: 'push', originalScreen: explicitScreen || null }
            };
        }

        return {
            routeName: resolvedRouteName,
            params: {
                ...parseNotificationParams(data.params),
                source: 'push',
                bookingId: data.bookingId || data.tripId || data.rideId || null,
                status: status || null,
                notificationType: data.type || data.notificationType || null,
                userType: userType || null,
                challengeId: data.challengeId || null,
                requirement: data.requirement || null,
                reason: data.reason || null,
                documentType: data.documentType || null,
                ...(hasUntrustedExplicitScreen ? { originalScreen: explicitScreen } : {}),
            }
        };
    }

    // Navegar para tela específica
    navigateToScreen(remoteMessage) {
        try {
            const target = this.resolveNotificationNavigationTarget(remoteMessage);

            const attemptNavigation = () => {
                const navigationRef = getGlobalNavigationRef();
                if (!navigationRef?.isReady?.()) {
                    return false;
                }

                navigationRef.navigate(target.routeName, target.params);
                return true;
            };

            Logger.log('🧭 Navegando por push:', target);

            if (!attemptNavigation()) {
                let attempts = 0;
                const retryNavigation = () => {
                    attempts += 1;
                    if (attemptNavigation() || attempts >= 20) {
                        return;
                    }
                    setTimeout(retryNavigation, 300);
                };
                setTimeout(retryNavigation, 300);
            }

            return target;
        } catch (error) {
            Logger.error('❌ Erro ao navegar para tela:', error);
            return null;
        }
    }

    // Salvar notificação de background
    async saveBackgroundNotification(remoteMessage) {
        try {
            const result = await saveBackgroundNotification(remoteMessage, { logger: Logger });
            if (result.saved) {
                Logger.log('💾 Notificação de background salva');
            }

        } catch (error) {
            Logger.error('❌ Erro ao salvar notificação de background:', error);
        }
    }

    // Obter notificações de background
    async getBackgroundNotifications() {
        try {
            return await getBackgroundNotifications();
        } catch (error) {
            Logger.error('❌ Erro ao obter notificações de background:', error);
            return [];
        }
    }

    // Processar notificações de background pendentes
    async processPendingNotifications() {
        if (this.pendingNotificationsProcessPromise) {
            return this.pendingNotificationsProcessPromise;
        }

        this.pendingNotificationsProcessPromise = this.runPendingNotificationsProcessing();
        try {
            return await this.pendingNotificationsProcessPromise;
        } finally {
            this.pendingNotificationsProcessPromise = null;
        }
    }

    async runPendingNotificationsProcessing() {
        try {
            const notifications = await this.getBackgroundNotifications();
            const pendingNotifications = notifications.filter(n => !n.processed);

            Logger.log(`📱 Processando ${pendingNotifications.length} notificações pendentes...`);

            for (const notification of pendingNotifications) {
                try {
                    const notificationType = notification.data?.type || 'general';
                    let handled = false;

                    if (this.notificationHandlers.has(notificationType)) {
                        await this.notificationHandlers.get(notificationType)(notification);
                        notification.processed = true;
                        continue;
                    }

                    switch (notificationType) {
                        case 'trip_update':
                            await this.handleTripUpdate(notification);
                            handled = true;
                            break;
                        case 'payment_confirmation':
                            await this.handlePaymentConfirmation(notification);
                            handled = true;
                            break;
                        case 'rating_received':
                            await this.handleRatingReceived(notification);
                            handled = true;
                            break;
                        default:
                            Logger.log('📱 Notificação pendente não processada:', notificationType);
                    }
                    if (handled) {
                        notification.processed = true;
                    }
                } catch (error) {
                    Logger.error('❌ Erro ao processar notificação pendente:', error);
                }
            }

            // Salvar estado atualizado
            await persistBackgroundNotifications(notifications);

        } catch (error) {
            Logger.error('❌ Erro ao processar notificações pendentes:', error);
        }
    }

    // Registrar handler específico para tipo de notificação
    registerNotificationHandler(type, handler) {
        try {
            this.notificationHandlers.set(type, handler);
            Logger.log(`✅ Handler registrado para tipo: ${type}`);
            if (this.isInitialized && type !== 'foreground' && type !== 'opened') {
                this.schedulePendingNotificationsProcessing(50);
            }
        } catch (error) {
            Logger.error('❌ Erro ao registrar handler:', error);
        }
    }

    // Remover handler específico
    unregisterNotificationHandler(type) {
        try {
            this.notificationHandlers.delete(type);
            Logger.log(`✅ Handler removido para tipo: ${type}`);
        } catch (error) {
            Logger.error('❌ Erro ao remover handler:', error);
        }
    }

    // Limpar todos os handlers
    clearNotificationHandlers() {
        try {
            // Executar unsubscribe functions
            for (const [type, unsubscribe] of this.notificationHandlers) {
                if (typeof unsubscribe === 'function') {
                    unsubscribe();
                }
            }

            this.notificationHandlers.clear();
            Logger.log('✅ Todos os handlers removidos');

        } catch (error) {
            Logger.error('❌ Erro ao limpar handlers:', error);
        }
    }

    // Verificar se o serviço está inicializado
    isServiceInitialized() {
        return this.isInitialized;
    }

    // Obter token FCM atual
    getCurrentToken() {
        return this.fcmToken;
    }

    // Limpar token FCM
    async clearFCMToken() {
        try {
            this.fcmToken = null;
            await AsyncStorage.removeItem('fcmToken');
            Logger.log('✅ Token FCM removido');
        } catch (error) {
            Logger.error('❌ Erro ao remover token FCM:', error);
        }
    }

    // Configurar renovação periódica do token
    setupTokenRenewal() {
        try {
            if (this.tokenRenewalInterval) {
                clearInterval(this.tokenRenewalInterval);
                this.tokenRenewalInterval = null;
            }

            // Renovar token a cada 30 minutos
            this.tokenRenewalInterval = setInterval(async () => {
                try {
                    Logger.log('🔄 Renovando token FCM...');
                    const newToken = await messaging().getToken();

                    if (newToken && newToken !== this.fcmToken) {
                        Logger.log('🆕 Novo token FCM detectado:', newToken);
                        this.fcmToken = newToken;
                        await AsyncStorage.setItem('fcmToken', newToken);
                        await this.scheduleTokenBackendUpdate(newToken);
                    }
                } catch (error) {
                    Logger.error('❌ Erro ao renovar token FCM:', error);
                }
            }, 30 * 60 * 1000); // 30 minutos

            Logger.log('✅ Renovação periódica do token FCM configurada');
        } catch (error) {
            Logger.error('❌ Erro ao configurar renovação do token:', error);
        }
    }

    // Registrar token pendente quando WebSocket conectar
    async registerPendingToken() {
        if (!this.pendingTokenRegistration) {
            return;
        }

        try {
            const { token, userId, userType } = this.pendingTokenRegistration;
            const wsManager = WebSocketManager.getInstance();

            if (wsManager.isConnected()) {
                await wsManager.registerFCMToken({
                    userId: userId,
                    userType: userType,
                    fcmToken: token,
                    platform: Platform.OS,
                    timestamp: new Date().toISOString()
                });

                Logger.log('✅ Token FCM pendente registrado no backend via WebSocket');
                this.pendingTokenRegistration = null;
                this.lastBackendTokenRegistrationKey = `${userId || 'anonymous'}:${userType}:${token}`;
            }
        } catch (error) {
            Logger.error('❌ Erro ao registrar token FCM pendente:', error);
        }
    }

    // Destruir serviço
    destroy() {
        try {
            this.clearNotificationHandlers();

            // Remover listener de WebSocket
            if (this.wsConnectListener) {
                const wsManager = WebSocketManager.getInstance();
                wsManager.off('connect', this.wsConnectListener);
                this.wsConnectListener = null;
            }

            // Limpar intervalo de renovação
            if (this.tokenRenewalInterval) {
                clearInterval(this.tokenRenewalInterval);
                this.tokenRenewalInterval = null;
            }

            if (this.retryTokenUpdateTimeout) {
                clearTimeout(this.retryTokenUpdateTimeout);
                this.retryTokenUpdateTimeout = null;
            }

            if (this.pendingNotificationsProcessTimeout) {
                clearTimeout(this.pendingNotificationsProcessTimeout);
                this.pendingNotificationsProcessTimeout = null;
            }

            if (this.authUnsubscribe) {
                this.authUnsubscribe();
                this.authUnsubscribe = null;
            }

            if (this.appStateSubscription?.remove) {
                this.appStateSubscription.remove();
                this.appStateSubscription = null;
            }

            this.pendingTokenRegistration = null;
            this.pendingTokenRegistrationAfterInFlight = null;
            this.backendTokenRegistrationPromise = null;
            this.lastBackendTokenRegistrationKey = null;
            this.lastAuthRegistrationIdentity = null;
            this.pendingNotificationsProcessPromise = null;
            this.isInitialized = false;
            Logger.log('✅ FCM Notification Service destruído');
        } catch (error) {
            Logger.error('❌ Erro ao destruir serviço:', error);
        }
    }
}

// Exportar instância singleton
export default new FCMNotificationService();

import Logger from '../utils/Logger';
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../common-local/store';
import WebSocketManager from './WebSocketManager';
import TestUserService from './TestUserService';

class FCMNotificationService {
    constructor() {
        this.isInitialized = false;
        this.fcmToken = null;
        this.notificationHandlers = new Map();
        this.backgroundMessageHandler = null;
        this.pendingTokenRegistration = null; // Token pendente para registrar quando WebSocket conectar
        this.wsConnectListener = null; // Listener para quando WebSocket conectar
    }

    // Inicializar o serviço FCM
    async initialize() {
        try {
            Logger.log('🚀 Inicializando FCM Notification Service...');

            // Configurar handlers de notificação
            this.setupNotificationHandlers();

            // Obter token FCM (pode ser null - app funciona sem push)
            await this.getFCMToken();

            // Configurar handlers de background
            this.setupBackgroundHandlers();

            this.isInitialized = true;
            Logger.log('✅ FCM Notification Service inicializado com sucesso');

            // Configurar renovação periódica do token (apenas se token disponível)
            if (this.fcmToken) {
            this.setupTokenRenewal();
            } else {
                Logger.warn('⚠️ Token FCM não disponível. Renovação periódica não será configurada.');
            }

        } catch (error) {
            // ✅ CRÍTICO: Erro ao inicializar FCM não deve quebrar o app
            Logger.error('❌ Erro ao inicializar FCM:', error);
            Logger.warn('⚠️ App continuará funcionando sem notificações push.');
            this.isInitialized = false;
            // Não lançar erro - app deve funcionar sem push
        }
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
            } else {
                // Android não precisa de permissão explícita
                Logger.log('✅ Permissões Android configuradas');
                return true;
            }
        } catch (error) {
            Logger.error('❌ Erro ao solicitar permissões:', error);
            return false;
        }
    }

    // Obter token FCM
    async getFCMToken() {
        try {
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

                // Atualizar token no backend
                await this.updateTokenOnBackend(token);
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

    // Atualizar token no backend
    async updateTokenOnBackend(token) {
        try {
            // ✅ CRÍTICO: Se token for null, não tentar registrar
            if (!token) {
                Logger.warn('⚠️ Token FCM é null. Não será registrado no backend. App continuará funcionando normalmente.');
                return;
            }
            
            Logger.log('📤 Enviando token FCM para backend:', token);
            
            // Aguardar um pouco para o store estar pronto
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Obter userId do Redux store ou TestUserService
            const userState = store.getState().auth;
            let userId = userState?.uid || userState?.profile?.uid;
            let userType = userState?.userType || userState?.profile?.userType || 'customer';
            
            // Bypass para usuários de teste em desenvolvimento
            if (__DEV__ && (!userId || userId === 'anonymous')) {
                Logger.log('🧪 Modo de desenvolvimento: Usando usuário de teste para FCM');
                userId = 'test-user-dev';
            }
            
            // Se ainda não temos userId válido, tentar novamente em 5 segundos
            if (!userId || userId === 'anonymous') {
                Logger.log('⚠️ Usuário não autenticado, tentando novamente em 5 segundos...');
                setTimeout(() => this.updateTokenOnBackend(token), 5000);
                return;
            }
            
            Logger.log('👤 Estado do usuário:', { userId, userType });
            
            // Registrar token via WebSocket (método correto)
            try {
                const wsManager = WebSocketManager.getInstance();
                
                // Se não estiver conectado, tentar conectar
                if (!wsManager.isConnected()) {
                    Logger.log('⏳ WebSocket não conectado, tentando conectar...');
                    try {
                        await wsManager.connect();
                    } catch (connectError) {
                        Logger.warn('⚠️ Erro ao conectar WebSocket:', connectError.message);
                    }
                }
                
                // Aguardar conexão WebSocket se necessário (com timeout maior)
                if (!wsManager.isConnected()) {
                    Logger.log('⏳ Aguardando conexão WebSocket...');
                    // Salvar token pendente para registrar quando conectar
                    this.pendingTokenRegistration = { token, userId, userType };
                    
                    // Configurar listener para quando WebSocket conectar (apenas uma vez)
                    if (!this.wsConnectListener) {
                        this.wsConnectListener = () => {
                            if (this.pendingTokenRegistration) {
                                Logger.log('🔄 WebSocket conectado, registrando token FCM pendente...');
                                this.registerPendingToken();
                            }
                        };
                        wsManager.on('connect', this.wsConnectListener);
                    }
                    
                    // Aguardar até 15 segundos
                    await new Promise((resolve) => {
                        const checkConnection = setInterval(() => {
                            if (wsManager.isConnected()) {
                                clearInterval(checkConnection);
                                resolve();
                            }
                        }, 500);
                        
                        // Timeout de 15 segundos
                        setTimeout(() => {
                            clearInterval(checkConnection);
                            resolve();
                        }, 15000);
                    });
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
                } else {
                    Logger.warn('⚠️ WebSocket não conectado após espera, token FCM será registrado quando a conexão for estabelecida');
                    // Salvar token pendente
                    this.pendingTokenRegistration = { token, userId, userType };
                    
                    // Configurar listener se ainda não foi configurado
                    if (!this.wsConnectListener) {
                        this.wsConnectListener = () => {
                            if (this.pendingTokenRegistration) {
                                Logger.log('🔄 WebSocket conectado, registrando token FCM pendente...');
                                this.registerPendingToken();
                            }
                        };
                        wsManager.on('connect', this.wsConnectListener);
                    }
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
            setTimeout(() => this.updateTokenOnBackend(token), 5000);
            }
        }
    }

    // Configurar handlers de notificação
    setupNotificationHandlers() {
        try {
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

    // Configurar handlers de background
    setupBackgroundHandlers() {
        try {
            // Handler para mensagens em background
            messaging().setBackgroundMessageHandler(async remoteMessage => {
                Logger.log('📱 Mensagem recebida em background:', remoteMessage);
                
                // Processar mensagem em background
                await this.handleBackgroundMessage(remoteMessage);
                
                // Retornar Promise para indicar que foi processada
                return Promise.resolve();
            });

        } catch (error) {
            Logger.error('❌ Erro ao configurar handlers de background:', error);
        }
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
            if (notification) {
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

    // Navegar para tela específica
    navigateToScreen(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const screen = data?.screen || 'home';

            Logger.log('🧭 Navegando para tela:', screen);

            // TODO: Implementar navegação usando React Navigation
            // navigation.navigate(screen, data?.params);
            
        } catch (error) {
            Logger.error('❌ Erro ao navegar para tela:', error);
        }
    }

    // Salvar notificação de background
    async saveBackgroundNotification(remoteMessage) {
        try {
            const notifications = await this.getBackgroundNotifications();
            notifications.push({
                ...remoteMessage,
                timestamp: new Date().toISOString(),
                processed: false
            });

            // Manter apenas as últimas 50 notificações
            if (notifications.length > 50) {
                notifications.splice(0, notifications.length - 50);
            }

            await AsyncStorage.setItem('backgroundNotifications', JSON.stringify(notifications));
            Logger.log('💾 Notificação de background salva');

        } catch (error) {
            Logger.error('❌ Erro ao salvar notificação de background:', error);
        }
    }

    // Obter notificações de background
    async getBackgroundNotifications() {
        try {
            const notifications = await AsyncStorage.getItem('backgroundNotifications');
            return notifications ? JSON.parse(notifications) : [];
        } catch (error) {
            Logger.error('❌ Erro ao obter notificações de background:', error);
            return [];
        }
    }

    // Processar notificações de background pendentes
    async processPendingNotifications() {
        try {
            const notifications = await this.getBackgroundNotifications();
            const pendingNotifications = notifications.filter(n => !n.processed);

            Logger.log(`📱 Processando ${pendingNotifications.length} notificações pendentes...`);

            for (const notification of pendingNotifications) {
                try {
                    await this.handleBackgroundMessage(notification);
                    notification.processed = true;
                } catch (error) {
                    Logger.error('❌ Erro ao processar notificação pendente:', error);
                }
            }

            // Salvar estado atualizado
            await AsyncStorage.setItem('backgroundNotifications', JSON.stringify(notifications));

        } catch (error) {
            Logger.error('❌ Erro ao processar notificações pendentes:', error);
        }
    }

    // Registrar handler específico para tipo de notificação
    registerNotificationHandler(type, handler) {
        try {
            this.notificationHandlers.set(type, handler);
            Logger.log(`✅ Handler registrado para tipo: ${type}`);
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
            // Renovar token a cada 30 minutos
            this.tokenRenewalInterval = setInterval(async () => {
                try {
                    Logger.log('🔄 Renovando token FCM...');
                    const newToken = await messaging().getToken();
                    
                    if (newToken && newToken !== this.fcmToken) {
                        Logger.log('🆕 Novo token FCM detectado:', newToken);
                        this.fcmToken = newToken;
                        await AsyncStorage.setItem('fcmToken', newToken);
                        await this.updateTokenOnBackend(newToken);
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
            
            this.pendingTokenRegistration = null;
            this.isInitialized = false;
            Logger.log('✅ FCM Notification Service destruído');
        } catch (error) {
            Logger.error('❌ Erro ao destruir serviço:', error);
        }
    }
}

// Exportar instância singleton
export default new FCMNotificationService();

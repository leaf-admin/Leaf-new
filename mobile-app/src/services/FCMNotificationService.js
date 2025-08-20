import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../common-local/store';

class FCMNotificationService {
    constructor() {
        this.isInitialized = false;
        this.fcmToken = null;
        this.notificationHandlers = new Map();
        this.backgroundMessageHandler = null;
    }

    // Inicializar o serviço FCM
    async initialize() {
        try {
            console.log('🚀 Inicializando FCM Notification Service...');

            // Configurar handlers de notificação
            this.setupNotificationHandlers();

            // Solicitar permissões
            await this.requestUserPermission();

            // Obter token FCM
            await this.getFCMToken();

            // Configurar handlers de background
            this.setupBackgroundHandlers();

            this.isInitialized = true;
            console.log('✅ FCM Notification Service inicializado com sucesso');

        } catch (error) {
            console.error('❌ Erro ao inicializar FCM:', error);
            throw error;
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
                    console.log('✅ Permissões de notificação concedidas');
                } else {
                    console.log('⚠️ Permissões de notificação negadas');
                }

                return enabled;
            } else {
                // Android não precisa de permissão explícita
                console.log('✅ Permissões Android configuradas');
                return true;
            }
        } catch (error) {
            console.error('❌ Erro ao solicitar permissões:', error);
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
                console.log('📱 Token FCM recuperado do cache:', savedToken);
            }

            // Obter novo token
            const token = await messaging().getToken();
            
            if (token) {
                this.fcmToken = token;
                await AsyncStorage.setItem('fcmToken', token);
                console.log('🆕 Novo token FCM obtido:', token);

                // Atualizar token no backend
                await this.updateTokenOnBackend(token);
            }

            return token;

        } catch (error) {
            console.error('❌ Erro ao obter token FCM:', error);
            return null;
        }
    }

    // Atualizar token no backend
    async updateTokenOnBackend(token) {
        try {
            // Aqui você pode implementar a lógica para enviar o token para seu backend
            // Por exemplo, via WebSocket ou API REST
            console.log('📤 Token FCM enviado para backend:', token);
            
            // TODO: Implementar envio para backend
            // await api.updateFCMToken(token);
            
        } catch (error) {
            console.error('❌ Erro ao atualizar token no backend:', error);
        }
    }

    // Configurar handlers de notificação
    setupNotificationHandlers() {
        try {
            // Handler para notificações em primeiro plano
            const unsubscribeForeground = messaging().onMessage(async remoteMessage => {
                console.log('📱 Notificação recebida em primeiro plano:', remoteMessage);
                
                // Processar notificação
                await this.handleForegroundNotification(remoteMessage);
            });

            // Handler para notificações quando app é aberto
            const unsubscribeNotificationOpened = messaging().onNotificationOpenedApp(remoteMessage => {
                console.log('📱 App aberto via notificação:', remoteMessage);
                
                // Processar notificação
                this.handleNotificationOpened(remoteMessage);
            });

            // Handler para notificação inicial (app fechado)
            messaging()
                .getInitialNotification()
                .then(remoteMessage => {
                    if (remoteMessage) {
                        console.log('📱 App aberto via notificação inicial:', remoteMessage);
                        this.handleNotificationOpened(remoteMessage);
                    }
                });

            // Salvar unsubscribe functions
            this.notificationHandlers.set('foreground', unsubscribeForeground);
            this.notificationHandlers.set('opened', unsubscribeNotificationOpened);

        } catch (error) {
            console.error('❌ Erro ao configurar handlers de notificação:', error);
        }
    }

    // Configurar handlers de background
    setupBackgroundHandlers() {
        try {
            // Handler para mensagens em background
            messaging().setBackgroundMessageHandler(async remoteMessage => {
                console.log('📱 Mensagem recebida em background:', remoteMessage);
                
                // Processar mensagem em background
                await this.handleBackgroundMessage(remoteMessage);
                
                // Retornar Promise para indicar que foi processada
                return Promise.resolve();
            });

        } catch (error) {
            console.error('❌ Erro ao configurar handlers de background:', error);
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
            console.error('❌ Erro ao processar notificação em primeiro plano:', error);
        }
    }

    // Processar notificação quando app é aberto
    handleNotificationOpened(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            // Navegar para tela específica baseada no tipo
            this.navigateToScreen(remoteMessage);

        } catch (error) {
            console.error('❌ Erro ao processar notificação aberta:', error);
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
                    console.log('📱 Notificação de background não processada:', notificationType);
            }

        } catch (error) {
            console.error('❌ Erro ao processar mensagem em background:', error);
        }
    }

    // Handler padrão para notificações
    async handleDefaultNotification(remoteMessage) {
        try {
            const { data, notification } = remoteMessage;

            // Mostrar notificação local
            // TODO: Implementar notificação local usando react-native-push-notification ou similar
            
            console.log('📱 Notificação padrão processada:', notification?.title);

        } catch (error) {
            console.error('❌ Erro ao processar notificação padrão:', error);
        }
    }

    // Handler para atualizações de viagem
    async handleTripUpdate(remoteMessage) {
        try {
            const { data } = remoteMessage;
            
            console.log('🚗 Atualização de viagem recebida:', data);

            // Atualizar estado da viagem no Redux
            // TODO: Implementar dispatch para Redux
            
        } catch (error) {
            console.error('❌ Erro ao processar atualização de viagem:', error);
        }
    }

    // Handler para confirmação de pagamento
    async handlePaymentConfirmation(remoteMessage) {
        try {
            const { data } = remoteMessage;
            
            console.log('💳 Confirmação de pagamento recebida:', data);

            // Atualizar estado de pagamento
            // TODO: Implementar dispatch para Redux
            
        } catch (error) {
            console.error('❌ Erro ao processar confirmação de pagamento:', error);
        }
    }

    // Handler para avaliação recebida
    async handleRatingReceived(remoteMessage) {
        try {
            const { data } = remoteMessage;
            
            console.log('⭐ Avaliação recebida:', data);

            // Atualizar estado de avaliações
            // TODO: Implementar dispatch para Redux
            
        } catch (error) {
            console.error('❌ Erro ao processar avaliação recebida:', error);
        }
    }

    // Navegar para tela específica
    navigateToScreen(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const screen = data?.screen || 'home';

            console.log('🧭 Navegando para tela:', screen);

            // TODO: Implementar navegação usando React Navigation
            // navigation.navigate(screen, data?.params);
            
        } catch (error) {
            console.error('❌ Erro ao navegar para tela:', error);
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
            console.log('💾 Notificação de background salva');

        } catch (error) {
            console.error('❌ Erro ao salvar notificação de background:', error);
        }
    }

    // Obter notificações de background
    async getBackgroundNotifications() {
        try {
            const notifications = await AsyncStorage.getItem('backgroundNotifications');
            return notifications ? JSON.parse(notifications) : [];
        } catch (error) {
            console.error('❌ Erro ao obter notificações de background:', error);
            return [];
        }
    }

    // Processar notificações de background pendentes
    async processPendingNotifications() {
        try {
            const notifications = await this.getBackgroundNotifications();
            const pendingNotifications = notifications.filter(n => !n.processed);

            console.log(`📱 Processando ${pendingNotifications.length} notificações pendentes...`);

            for (const notification of pendingNotifications) {
                try {
                    await this.handleBackgroundMessage(notification);
                    notification.processed = true;
                } catch (error) {
                    console.error('❌ Erro ao processar notificação pendente:', error);
                }
            }

            // Salvar estado atualizado
            await AsyncStorage.setItem('backgroundNotifications', JSON.stringify(notifications));

        } catch (error) {
            console.error('❌ Erro ao processar notificações pendentes:', error);
        }
    }

    // Registrar handler específico para tipo de notificação
    registerNotificationHandler(type, handler) {
        try {
            this.notificationHandlers.set(type, handler);
            console.log(`✅ Handler registrado para tipo: ${type}`);
        } catch (error) {
            console.error('❌ Erro ao registrar handler:', error);
        }
    }

    // Remover handler específico
    unregisterNotificationHandler(type) {
        try {
            this.notificationHandlers.delete(type);
            console.log(`✅ Handler removido para tipo: ${type}`);
        } catch (error) {
            console.error('❌ Erro ao remover handler:', error);
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
            console.log('✅ Todos os handlers removidos');

        } catch (error) {
            console.error('❌ Erro ao limpar handlers:', error);
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
            console.log('✅ Token FCM removido');
        } catch (error) {
            console.error('❌ Erro ao remover token FCM:', error);
        }
    }

    // Destruir serviço
    destroy() {
        try {
            this.clearNotificationHandlers();
            this.isInitialized = false;
            console.log('✅ FCM Notification Service destruído');
        } catch (error) {
            console.error('❌ Erro ao destruir serviço:', error);
        }
    }
}

// Exportar instância singleton
export default new FCMNotificationService();

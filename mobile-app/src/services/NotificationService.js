// NotificationService.js - Serviço completo de notificações push
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { AppConfig } from '../../config/AppConfig';
import { api } from 'common';

class NotificationService {
    constructor() {
        this.isInitialized = false;
        this.pushToken = null;
        this.notificationListener = null;
        this.responseListener = null;
    }

    // Inicializar serviço de notificações
    async initialize() {
        try {
            console.log('🔔 Inicializando serviço de notificações...');

            // 1. Configurar handler de notificações
            this.setupNotificationHandler();

            // 2. Solicitar permissões
            const hasPermission = await this.requestPermissions();
            if (!hasPermission) {
                console.log('❌ Permissões de notificação negadas');
                return false;
            }

            // 3. Obter push token
            this.pushToken = await this.getPushToken();
            if (this.pushToken) {
                console.log('✅ Push token obtido:', this.pushToken);
                
                // 4. Registrar token no backend
                await this.registerPushToken(this.pushToken);
                
                // 5. Configurar listeners
                this.setupNotificationListeners();
                
                this.isInitialized = true;
                return true;
            }

            return false;
        } catch (error) {
            console.error('❌ Erro ao inicializar notificações:', error);
            return false;
        }
    }

    // Configurar handler de notificações
    setupNotificationHandler() {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: false,
            }),
        });
    }

    // Solicitar permissões
    async requestPermissions() {
        try {
            if (!Device.isDevice) {
                console.log('📱 Não é um dispositivo físico');
                return false;
            }

            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }

            if (finalStatus !== 'granted') {
                console.log('❌ Permissões negadas');
                return false;
            }

            console.log('✅ Permissões concedidas');
            return true;
        } catch (error) {
            console.error('❌ Erro ao solicitar permissões:', error);
            return false;
        }
    }

    // Obter push token
    async getPushToken() {
        try {
            if (!Device.isDevice) {
                return null;
            }

            const projectId = AppConfig.expo_project_id;
            const token = (await Notifications.getExpoPushTokenAsync({
                projectId: projectId
            })).data;

            console.log('🔑 Push token gerado:', token);
            return token;
        } catch (error) {
            console.error('❌ Erro ao obter push token:', error);
            return null;
        }
    }

    // Registrar token no backend
    async registerPushToken(token) {
        try {
            const userData = await api.getCurrentUser();
            if (!userData) {
                console.log('❌ Usuário não autenticado');
                return false;
            }

            // Registrar token no Firebase
            await api.updatePushToken(token, Platform.OS.toUpperCase());
            
            console.log('✅ Token registrado no backend');
            return true;
        } catch (error) {
            console.error('❌ Erro ao registrar token:', error);
            return false;
        }
    }

    // Configurar listeners de notificação
    setupNotificationListeners() {
        // Listener para notificações recebidas
        this.notificationListener = Notifications.addNotificationReceivedListener(notification => {
            console.log('📨 Notificação recebida:', notification);
            this.handleNotificationReceived(notification);
        });

        // Listener para resposta às notificações
        this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
            console.log('👆 Usuário respondeu à notificação:', response);
            this.handleNotificationResponse(response);
        });
    }

    // Handler para notificações recebidas
    handleNotificationReceived(notification) {
        const { title, body, data } = notification.request.content;
        
        console.log('📨 Notificação recebida:', { title, body, data });

        // Processar dados da notificação
        if (data) {
            switch (data.type) {
                case 'trip_accepted':
                    this.handleTripAccepted(data);
                    break;
                case 'trip_started':
                    this.handleTripStarted(data);
                    break;
                case 'trip_completed':
                    this.handleTripCompleted(data);
                    break;
                case 'payment_confirmed':
                    this.handlePaymentConfirmed(data);
                    break;
                case 'payment_failed':
                    this.handlePaymentFailed(data);
                    break;
                case 'driver_nearby':
                    this.handleDriverNearby(data);
                    break;
                case 'system_maintenance':
                    this.handleSystemMaintenance(data);
                    break;
                default:
                    console.log('📨 Tipo de notificação não reconhecido:', data.type);
            }
        }
    }

    // Handler para resposta às notificações
    handleNotificationResponse(response) {
        const { data } = response.notification.request.content;
        
        console.log('👆 Resposta à notificação:', data);

        // Navegar para tela específica baseada no tipo
        if (data && data.screen) {
            this.navigateToScreen(data.screen, data.params);
        }
    }

    // Handlers específicos por tipo de notificação
    handleTripAccepted(data) {
        console.log('🚗 Corrida aceita:', data.trip_id);
    }

    handleTripStarted(data) {
        console.log('🚀 Viagem iniciada:', data.trip_id);
    }

    handleTripCompleted(data) {
        console.log('✅ Viagem concluída:', data.trip_id);
    }

    handlePaymentConfirmed(data) {
        console.log('💰 Pagamento confirmado:', data.amount);
    }

    handlePaymentFailed(data) {
        console.log('❌ Pagamento falhou:', data.reason);
    }

    handleDriverNearby(data) {
        console.log('🚗 Motorista próximo:', data.driver_id);
    }

    handleSystemMaintenance(data) {
        console.log('🔧 Manutenção do sistema:', data.message);
    }

    // Navegar para tela específica
    navigateToScreen(screen, params = {}) {
        console.log('🧭 Navegando para:', screen, params);
    }

    // Enviar notificação local
    async sendLocalNotification(title, body, data = {}) {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data,
                    sound: 'default',
                },
                trigger: null,
            });
            
            console.log('📱 Notificação local enviada:', title);
        } catch (error) {
            console.error('❌ Erro ao enviar notificação local:', error);
        }
    }

    // Agendar notificação
    async scheduleNotification(title, body, trigger, data = {}) {
        try {
            await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data,
                    sound: 'default',
                },
                trigger,
            });
            
            console.log('⏰ Notificação agendada:', title);
        } catch (error) {
            console.error('❌ Erro ao agendar notificação:', error);
        }
    }

    // Cancelar notificações
    async cancelAllNotifications() {
        try {
            await Notifications.cancelAllScheduledNotificationsAsync();
            console.log('🗑️ Todas as notificações canceladas');
        } catch (error) {
            console.error('❌ Erro ao cancelar notificações:', error);
        }
    }

    // Obter notificações pendentes
    async getPendingNotifications() {
        try {
            const notifications = await Notifications.getAllScheduledNotificationsAsync();
            console.log('📋 Notificações pendentes:', notifications.length);
            return notifications;
        } catch (error) {
            console.error('❌ Erro ao obter notificações pendentes:', error);
            return [];
        }
    }

    // Limpar listeners
    cleanup() {
        if (this.notificationListener) {
            Notifications.removeNotificationSubscription(this.notificationListener);
        }
        if (this.responseListener) {
            Notifications.removeNotificationSubscription(this.responseListener);
        }
        console.log('🧹 Listeners de notificação limpos');
    }

    // Verificar se está inicializado
    isReady() {
        return this.isInitialized && this.pushToken;
    }

    // Obter push token
    getPushToken() {
        return this.pushToken;
    }
}

// Exportar instância singleton
const notificationService = new NotificationService();
export default notificationService; 
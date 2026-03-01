import Logger from '../utils/Logger';
import FCMNotificationService from './FCMNotificationService';
import database from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import { Alert, Platform } from 'react-native';
import languageManager from '../locales';


class VehicleNotificationService {
    constructor() {
        this.isInitialized = false;
        this.userId = null;
        this.fcmToken = null;
    }

    /**
     * Inicializar o serviço de notificações de veículos
     */
    /**
     * Verificar se é usuário de teste
     */
    isTestUser(userId) {
        return userId && (userId.includes('test-user-dev') || userId.includes('test-customer-dev'));
    }

    async initialize() {
        try {
            Logger.log('🚗 Inicializando Vehicle Notification Service...');

            // Verificar se usuário está autenticado
            const user = auth().currentUser;
            if (!user) {
                Logger.warn('⚠️ [VehicleNotificationService] Usuário não autenticado, pulando inicialização');
                // Não lançar erro, apenas retornar silenciosamente
                // O serviço será inicializado quando o usuário fizer login
                return;
            }

            this.userId = user.uid;

            // Se for usuário de teste, pular inicialização completa mas marcar como inicializado
            if (this.isTestUser(this.userId)) {
                Logger.log('🧪 Usuário de teste detectado - inicializando serviço de veículos em modo simplificado');
                this.isInitialized = true;
                return; // Pular o resto da inicialização para evitar erros de permissão
            }

            // Inicializar FCM se não estiver inicializado
            if (!FCMNotificationService.isServiceInitialized()) {
                await FCMNotificationService.initialize();
            }

            // Obter token FCM
            this.fcmToken = FCMNotificationService.getCurrentToken();
            if (!this.fcmToken) {
                this.fcmToken = await FCMNotificationService.getFCMToken();
            }

            // Registrar handlers específicos para veículos
            this.registerVehicleNotificationHandlers();

            // Salvar token FCM no perfil do usuário
            await this.saveFCMTokenToUserProfile();

            // Configurar listener para mudanças de status de veículos
            this.setupVehicleStatusListener();

            this.isInitialized = true;
            Logger.log('✅ Vehicle Notification Service inicializado com sucesso');

        } catch (error) {
            Logger.error('❌ Erro ao inicializar Vehicle Notification Service:', error);
            throw error;
        }
    }

    /**
     * Registrar handlers específicos para notificações de veículos
     */
    registerVehicleNotificationHandlers() {
        // Handler para aprovação de veículo
        FCMNotificationService.registerNotificationHandler('vehicle_approved', async (remoteMessage) => {
            await this.handleVehicleApproved(remoteMessage);
        });

        // Handler para rejeição de veículo
        FCMNotificationService.registerNotificationHandler('vehicle_rejected', async (remoteMessage) => {
            await this.handleVehicleRejected(remoteMessage);
        });

        // Handler para solicitação de documentos
        FCMNotificationService.registerNotificationHandler('vehicle_documents_requested', async (remoteMessage) => {
            await this.handleDocumentsRequested(remoteMessage);
        });

        // Handler para veículo ativado
        FCMNotificationService.registerNotificationHandler('vehicle_activated', async (remoteMessage) => {
            await this.handleVehicleActivated(remoteMessage);
        });

        Logger.log('✅ Handlers de notificação de veículos registrados');
    }

    /**
     * Salvar token FCM no perfil do usuário
     */
    async saveFCMTokenToUserProfile() {
        try {
            if (!this.fcmToken || !this.userId) {
                Logger.warn('⚠️ Token FCM ou userId não disponível');
                return;
            }

            const userRef = database().ref(`users/${this.userId}`);
            await userRef.update({
                fcmToken: this.fcmToken,
                fcmTokenUpdatedAt: new Date().toISOString()
            });

            Logger.log('✅ Token FCM salvo no perfil do usuário');

        } catch (error) {
            Logger.error('❌ Erro ao salvar token FCM no perfil:', error);
        }
    }

    /**
     * Configurar listener para mudanças de status de veículos
     */
    setupVehicleStatusListener() {
        try {
            if (!this.userId) {
                Logger.warn('⚠️ userId não disponível para configurar listener');
                return;
            }

            const userVehiclesRef = database().ref(`user_vehicles/${this.userId}`);
            
            userVehiclesRef.on('child_changed', async (snapshot) => {
                const userVehicle = snapshot.val();
                const previousData = snapshot.previousSibling?.val();

                // Verificar se houve mudança de status
                if (previousData && userVehicle.status !== previousData.status) {
                    Logger.log('🔄 Status do veículo alterado:', {
                        vehicleId: userVehicle.vehicleId,
                        oldStatus: previousData.status,
                        newStatus: userVehicle.status
                    });

                    // Processar mudança de status
                    await this.processVehicleStatusChange(userVehicle, previousData);
                }
            });

            Logger.log('✅ Listener de status de veículos configurado');

        } catch (error) {
            Logger.error('❌ Erro ao configurar listener de veículos:', error);
        }
    }

    /**
     * Processar mudança de status do veículo
     */
    async processVehicleStatusChange(newUserVehicle, oldUserVehicle) {
        try {
            const { status: newStatus } = newUserVehicle;
            const { status: oldStatus } = oldUserVehicle;

            // Buscar dados do veículo
            const vehicleSnapshot = await database().ref(`vehicles/${newUserVehicle.vehicleId}`).once('value');
            const vehicle = vehicleSnapshot.val();

            if (!vehicle) {
                Logger.warn('⚠️ Veículo não encontrado:', newUserVehicle.vehicleId);
                return;
            }

            // Processar baseado no novo status
            switch (newStatus) {
                case 'active':
                    if (oldStatus === 'pending') {
                        await this.showVehicleApprovedNotification(vehicle, newUserVehicle);
                    }
                    break;
                case 'rejected':
                    if (oldStatus === 'pending') {
                        await this.showVehicleRejectedNotification(vehicle, newUserVehicle);
                    }
                    break;
                case 'pending':
                    if (oldStatus === 'rejected') {
                        await this.showVehicleResubmittedNotification(vehicle, newUserVehicle);
                    }
                    break;
                default:
                    Logger.log('📱 Status não processado:', newStatus);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar mudança de status:', error);
        }
    }

    /**
     * Handler para veículo aprovado
     */
    async handleVehicleApproved(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const { vehicleId, vehiclePlate, vehicleBrand, vehicleModel } = data;

            const message = `🎉 Seu veículo ${vehicleBrand} ${vehicleModel} (${vehiclePlate}) foi aprovado! Agora você pode começar a dirigir.`;

            if (Platform.OS === 'android') {
                // Para Android, usar ToastAndroid ou notificação local
                Logger.log('✅ Veículo aprovado:', message);
            } else {
                // Para iOS, usar Alert
                Alert.alert(languageManager.t('vehicle.approved'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar aprovação de veículo:', error);
        }
    }

    /**
     * Handler para veículo rejeitado
     */
    async handleVehicleRejected(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const { vehicleId, vehiclePlate, vehicleBrand, vehicleModel, rejectionReason } = data;

            const message = `❌ Seu veículo ${vehicleBrand} ${vehicleModel} (${vehiclePlate}) foi rejeitado.${rejectionReason ? `\n\nMotivo: ${rejectionReason}` : ''}`;

            if (Platform.OS === 'android') {
                Logger.log('❌ Veículo rejeitado:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.rejected'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar rejeição de veículo:', error);
        }
    }

    /**
     * Handler para solicitação de documentos
     */
    async handleDocumentsRequested(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const { vehicleId, vehiclePlate, missingDocuments } = data;

            const message = `📋 Seu veículo ${vehiclePlate} precisa de documentos adicionais: ${missingDocuments.join(', ')}`;

            if (Platform.OS === 'android') {
                Logger.log('📋 Documentos solicitados:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.documentsRequired'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar solicitação de documentos:', error);
        }
    }

    /**
     * Handler para veículo ativado
     */
    async handleVehicleActivated(remoteMessage) {
        try {
            const { data } = remoteMessage;
            const { vehicleId, vehiclePlate, vehicleBrand, vehicleModel } = data;

            const message = `🚗 Seu veículo ${vehicleBrand} ${vehicleModel} (${vehiclePlate}) está agora ativo para corridas!`;

            if (Platform.OS === 'android') {
                Logger.log('🚗 Veículo ativado:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.activated'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar ativação de veículo:', error);
        }
    }

    /**
     * Mostrar notificação de veículo aprovado
     */
    async showVehicleApprovedNotification(vehicle, userVehicle) {
        try {
            const message = `🎉 Seu veículo ${vehicle.brand} ${vehicle.model} (${vehicle.plate}) foi aprovado! Agora você pode começar a dirigir.`;

            if (Platform.OS === 'android') {
                Logger.log('✅ Notificação de aprovação:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.approved'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao mostrar notificação de aprovação:', error);
        }
    }

    /**
     * Mostrar notificação de veículo rejeitado
     */
    async showVehicleRejectedNotification(vehicle, userVehicle) {
        try {
            const message = `❌ Seu veículo ${vehicle.brand} ${vehicle.model} (${vehicle.plate}) foi rejeitado.${userVehicle.rejectionReason ? `\n\nMotivo: ${userVehicle.rejectionReason}` : ''}`;

            if (Platform.OS === 'android') {
                Logger.log('❌ Notificação de rejeição:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.rejected'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao mostrar notificação de rejeição:', error);
        }
    }

    /**
     * Mostrar notificação de veículo reenviado
     */
    async showVehicleResubmittedNotification(vehicle, userVehicle) {
        try {
            const message = `📤 Seu veículo ${vehicle.brand} ${vehicle.model} (${vehicle.plate}) foi reenviado para análise.`;

            if (Platform.OS === 'android') {
                Logger.log('📤 Notificação de reenvio:', message);
            } else {
                Alert.alert(languageManager.t('vehicle.resubmitted'), message, [
                    { text: languageManager.t('messages.confirm'), onPress: () => this.navigateToVehicles() }
                ]);
            }

        } catch (error) {
            Logger.error('❌ Erro ao mostrar notificação de reenvio:', error);
        }
    }

    /**
     * Navegar para tela de veículos
     */
    navigateToVehicles() {
        try {
            // TODO: Implementar navegação usando React Navigation
            // navigation.navigate('MyVehiclesScreen');
            Logger.log('🧭 Navegando para tela de veículos');
        } catch (error) {
            Logger.error('❌ Erro ao navegar para veículos:', error);
        }
    }

    /**
     * Enviar notificação de teste
     */
    async sendTestNotification() {
        try {
            if (!this.fcmToken) {
                throw new Error('Token FCM não disponível');
            }

            // Simular notificação de aprovação
            const testMessage = {
                data: {
                    type: 'vehicle_approved',
                    vehicleId: 'test_vehicle_123',
                    vehiclePlate: 'ABC-1234',
                    vehicleBrand: 'Toyota',
                    vehicleModel: 'Corolla'
                },
                notification: {
                    title: 'Veículo Aprovado!',
                    body: 'Seu veículo Toyota Corolla (ABC-1234) foi aprovado!'
                }
            };

            await this.handleVehicleApproved(testMessage);
            Logger.log('✅ Notificação de teste enviada');

        } catch (error) {
            Logger.error('❌ Erro ao enviar notificação de teste:', error);
        }
    }

    /**
     * Verificar se o serviço está inicializado
     */
    isServiceInitialized() {
        return this.isInitialized;
    }

    /**
     * Obter token FCM atual
     */
    getCurrentToken() {
        return this.fcmToken;
    }

    /**
     * Destruir serviço
     */
    destroy() {
        try {
            this.isInitialized = false;
            this.userId = null;
            this.fcmToken = null;
            Logger.log('✅ Vehicle Notification Service destruído');
        } catch (error) {
            Logger.error('❌ Erro ao destruir Vehicle Notification Service:', error);
        }
    }
}

// Exportar instância singleton
export default new VehicleNotificationService();








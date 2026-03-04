import Logger from '../utils/Logger';
/**
 * 🔔 SERVIÇO DE NOTIFICAÇÃO PERSISTENTE DE CORRIDA
 * 
 * Cria e mantém uma notificação persistente (foreground) que fica sempre visível
 * durante a corrida, mostrando o status atual (como iFood e Uber fazem)
 * 
 * Funcionalidades:
 * - Notificação que não pode ser removida pelo usuário
 * - Atualização em tempo real do status da corrida
 * - Funciona mesmo com app em background
 * - Mostra informações relevantes (status, tempo, distância)
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import fcmService from './FCMNotificationService';


class PersistentRideNotificationService {
    constructor() {
        this.currentNotificationId = null;
        this.currentBookingId = null;
        this.updateInterval = null;
        this.isActive = false;
    }

    /**
     * Inicializar o serviço
     */
    async initialize() {
        try {
            Logger.log('🔔 [PersistentRideNotification] Inicializando serviço...');

            // Configurar canal para Android (alta prioridade, persistente)
            if (Platform.OS === 'android') {
                await Notifications.setNotificationChannelAsync('ride_status', {
                    name: 'Status da Corrida',
                    description: 'Notificação persistente mostrando o status atual da corrida',
                    importance: Notifications.AndroidImportance.HIGH,
                    vibrationPattern: [0, 250, 250, 250],
                    lightColor: '#1A330E',
                    sound: 'default',
                    enableVibrate: true,
                    showBadge: true,
                });
            }

            // Register handler for FCM messages
            this.setupFCMHandler();

            Logger.log('✅ [PersistentRideNotification] Serviço inicializado');
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao inicializar:', error);
        }
    }

    /**
     * Solicitar permissões de notificação
     */
    async requestPermissions() {
        try {
            // Verificar se é dispositivo físico
            if (!Device.isDevice) {
                Logger.log('⚠️ [PersistentRideNotification] Não é um dispositivo físico, pulando permissões');
                return true;
            }

            // Verificar permissões existentes
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            // Se não tem permissão, solicitar
            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync({
                    ios: {
                        allowAlert: true,
                        allowBadge: true,
                        allowSound: true,
                        allowAnnouncements: false,
                    },
                });
                finalStatus = status;
            }

            if (finalStatus !== 'granted') {
                Logger.warn('⚠️ [PersistentRideNotification] Permissões de notificação negadas');
                return false;
            }

            Logger.log('✅ [PersistentRideNotification] Permissões concedidas');
            return true;
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao solicitar permissões:', error);
            return false;
        }
    }

    /**
     * Configurar handler para notificações FCM
     */
    setupFCMHandler() {
        const handleRideStatusNotification = async (remoteMessage) => {
            Logger.log('📱 [PersistentRideNotification] Tratando evento FCM para notificação persistente:', remoteMessage);
            const { data } = remoteMessage;

            if (data && data.bookingId && data.status) {
                // Parse potential JSON strings from FCM data payload
                const processedData = { ...data };
                if (typeof processedData.pickup === 'string') {
                    try { processedData.pickup = JSON.parse(processedData.pickup); } catch (e) { }
                }
                if (typeof processedData.destination === 'string') {
                    try { processedData.destination = JSON.parse(processedData.destination); } catch (e) { }
                }

                if (processedData.status === 'completed' || processedData.status === 'cancelled') {
                    await this.dismissRideNotification();
                } else {
                    await this.updateRideNotification(processedData);
                }
            }
        };

        // Escutar por eventos que devam atualizar a notificação persistente
        fcmService.registerNotificationHandler('ride_status_update', handleRideStatusNotification);
    }

    /**
     * Mostrar notificação persistente de corrida
     * @param {Object} rideData - Dados da corrida
     * @param {string} rideData.bookingId - ID da corrida
     * @param {string} rideData.status - Status atual (searching, accepted, arrived, started, completed)
     * @param {string} rideData.userType - Tipo de usuário (driver ou customer)
     * @param {Object} rideData.pickup - Local de embarque
     * @param {Object} rideData.destination - Local de destino
     * @param {string} rideData.driverName - Nome do motorista (para customer)
     * @param {string} rideData.customerName - Nome do passageiro (para driver)
     * @param {number} rideData.estimatedTime - Tempo estimado em minutos
     * @param {number} rideData.distance - Distância em km
     * @param {string} rideData.fare - Valor da corrida
     */
    async showRideNotification(rideData) {
        try {
            const {
                bookingId,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            } = rideData;

            if (!bookingId || !status) {
                Logger.warn('⚠️ [PersistentRideNotification] Dados incompletos para notificação');
                return;
            }

            this.currentBookingId = bookingId;
            this.isActive = true;

            // Gerar conteúdo da notificação baseado no status
            const { title, body } = this.generateNotificationContent({
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            });

            // Cancelar notificação anterior se existir
            if (this.currentNotificationId) {
                await Notifications.cancelScheduledNotificationAsync(this.currentNotificationId);
            }

            // Criar nova notificação persistente
            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data: {
                        type: 'ride_status',
                        bookingId,
                        status,
                        userType,
                        ...rideData
                    },
                    sound: false, // Sem som para atualizações
                    priority: Notifications.AndroidNotificationPriority.HIGH,
                },
                trigger: null, // Mostrar imediatamente
                ...(Platform.OS === 'android' && {
                    android: {
                        channelId: 'ride_status',
                        priority: Notifications.AndroidNotificationPriority.HIGH,
                        sticky: true, // ✅ PERSISTENTE - não pode ser removida
                        ongoing: true, // ✅ ONGOING - sempre visível
                        autoCancel: false, // Não cancela automaticamente
                        onlyAlertOnce: false, // Permite atualizações
                        categoryId: 'RIDE_STATUS',
                    },
                }),
            });

            this.currentNotificationId = notificationId;
            Logger.log(`✅ [PersistentRideNotification] Notificação persistente criada: ${notificationId}`);

            // Iniciar atualização periódica se necessário
            if (status === 'started' || status === 'accepted') {
                this.startPeriodicUpdate(rideData);
            }

        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao mostrar notificação:', error);
        }
    }

    /**
     * Atualizar notificação existente
     */
    async updateRideNotification(rideData) {
        try {
            if (!this.isActive || !this.currentNotificationId) {
                // Se não há notificação ativa, criar uma nova
                await this.showRideNotification(rideData);
                return;
            }

            // Atualizar usando o mesmo ID
            const {
                bookingId,
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            } = rideData;

            const { title, body } = this.generateNotificationContent({
                status,
                userType,
                pickup,
                destination,
                driverName,
                customerName,
                estimatedTime,
                distance,
                fare
            });

            // No expo-notifications, precisamos cancelar e recriar para atualizar
            await Notifications.cancelScheduledNotificationAsync(this.currentNotificationId);

            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data: {
                        type: 'ride_status',
                        bookingId,
                        status,
                        userType,
                        ...rideData
                    },
                    sound: false,
                    priority: Notifications.AndroidNotificationPriority.HIGH,
                },
                trigger: null,
                ...(Platform.OS === 'android' && {
                    android: {
                        channelId: 'ride_status',
                        priority: Notifications.AndroidNotificationPriority.HIGH,
                        sticky: true,
                        ongoing: true,
                        autoCancel: false,
                        onlyAlertOnce: false,
                        notificationId: this.currentNotificationId, // ✅ Usar mesmo ID para atualizar
                    },
                }),
            });

            this.currentNotificationId = notificationId;
            Logger.log(`🔄 [PersistentRideNotification] Notificação atualizada: ${notificationId}`);

        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao atualizar notificação:', error);
        }
    }

    /**
     * Gerar conteúdo da notificação baseado no status
     */
    generateNotificationContent({ status, userType, pickup, destination, driverName, customerName, estimatedTime, distance, fare }) {
        let title = '';
        let body = '';

        if (userType === 'driver') {
            // Notificação para motorista
            switch (status) {
                case 'searching':
                    title = '🔍 Procurando corridas...';
                    body = 'Aguardando solicitações de corrida';
                    break;
                case 'accepted':
                    title = '🚗 Corrida aceita';
                    body = `Navegue até: ${pickup?.address || 'Local de embarque'}`;
                    break;
                case 'arrived':
                    title = '📍 Você chegou ao local';
                    body = `Aguardando ${customerName || 'passageiro'}...`;
                    break;
                case 'started':
                    title = '🚀 Corrida em andamento';
                    body = `A caminho de ${destination?.address || 'destino'}`;
                    if (estimatedTime) {
                        body += ` • ${estimatedTime} min`;
                    }
                    break;
                case 'completed':
                    title = '✅ Corrida finalizada';
                    body = `Ganho: ${fare || 'R$ 0,00'}`;
                    break;
                default:
                    title = '🚗 Corrida ativa';
                    body = 'Acompanhe o status da corrida';
            }
        } else {
            // Notificação para passageiro
            switch (status) {
                case 'searching':
                    title = '🔍 Procurando motorista...';
                    body = 'Aguardando motorista disponível';
                    break;
                case 'accepted':
                    title = '🚗 Motorista encontrado!';
                    body = `${driverName || 'Motorista'} está a caminho`;
                    if (estimatedTime) {
                        body += ` • ${estimatedTime} min`;
                    }
                    break;
                case 'arrived':
                    title = '📍 Motorista chegou!';
                    body = `${driverName || 'Motorista'} está no local de embarque`;
                    break;
                case 'started':
                    title = '🚀 Viagem em andamento';
                    body = `A caminho de ${destination?.address || 'destino'}`;
                    if (estimatedTime) {
                        body += ` • ${estimatedTime} min`;
                    }
                    break;
                case 'completed':
                    title = '✅ Viagem finalizada';
                    body = `Valor: ${fare || 'R$ 0,00'}`;
                    break;
                default:
                    title = '🚗 Corrida ativa';
                    body = 'Acompanhe o status da corrida';
            }
        }

        return { title, body };
    }

    /**
     * Iniciar atualização periódica da notificação
     */
    startPeriodicUpdate(rideData) {
        // Limpar intervalo anterior se existir
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        // Atualizar a cada 10 segundos durante a corrida
        this.updateInterval = setInterval(async () => {
            if (!this.isActive) {
                this.stopPeriodicUpdate();
                return;
            }

            // Atualizar dados dinâmicos (tempo estimado, distância, etc)
            // Isso pode vir de um serviço de localização ou WebSocket
            await this.updateRideNotification(rideData);
        }, 10000); // 10 segundos

        Logger.log('🔄 [PersistentRideNotification] Atualização periódica iniciada');
    }

    /**
     * Parar atualização periódica
     */
    stopPeriodicUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
            Logger.log('⏹️ [PersistentRideNotification] Atualização periódica parada');
        }
    }

    /**
     * Remover notificação persistente
     */
    async dismissRideNotification() {
        try {
            if (this.currentNotificationId) {
                await Notifications.cancelScheduledNotificationAsync(this.currentNotificationId);
                await Notifications.dismissNotificationAsync(this.currentNotificationId);
                this.currentNotificationId = null;
                this.currentBookingId = null;
                this.isActive = false;
                this.stopPeriodicUpdate();
                Logger.log('✅ [PersistentRideNotification] Notificação removida');
            }
        } catch (error) {
            Logger.error('❌ [PersistentRideNotification] Erro ao remover notificação:', error);
        }
    }

    /**
     * Verificar se há notificação ativa
     */
    isNotificationActive() {
        return this.isActive && this.currentNotificationId !== null;
    }

    /**
     * Obter ID da notificação atual
     */
    getCurrentNotificationId() {
        return this.currentNotificationId;
    }

    /**
     * Obter ID da corrida atual
     */
    getCurrentBookingId() {
        return this.currentBookingId;
    }
}

// Exportar instância singleton
const persistentRideNotificationService = new PersistentRideNotificationService();
export default persistentRideNotificationService;


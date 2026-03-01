import Logger from '../utils/Logger';
/**
 * 🔔 SERVIÇO DE NOTIFICAÇÕES INTERATIVAS DO SISTEMA
 * 
 * Converte notificações FCM em notificações do sistema operacional
 * com botões de ação (como a Uber faz)
 * 
 * Funcionalidades:
 * - Recebe notificação FCM do backend
 * - Cria notificação local do sistema com ações
 * - Processa cliques nos botões mesmo em background
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import WebSocketManager from './WebSocketManager';
import fcmService from './FCMNotificationService';


// Configurar comportamento padrão das notificações
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

class InteractiveNotificationService {
    constructor() {
        this.isInitialized = false;
        this.wsManager = WebSocketManager.getInstance();
    }

    /**
     * Inicializar o serviço
     */
    async initialize() {
        try {
            Logger.log('🔔 [InteractiveNotification] Inicializando serviço...');

            // 1. Configurar canais de notificação (Android)
            if (Platform.OS === 'android') {
                await this.setupAndroidChannels();
            }

            // 2. Registrar categorias com ações (iOS)
            if (Platform.OS === 'ios') {
                await this.setupIOSCategories();
            }

            // 3. Registrar como handler no serviço FCM central
            this.setupFCMHandler();

            // 4. Configurar listener para ações de notificação
            this.setupActionListener();

            this.isInitialized = true;
            Logger.log('✅ [InteractiveNotification] Serviço inicializado');

        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao inicializar:', error);
            throw error;
        }
    }

    /**
     * Configurar canais de notificação para Android
     */
    async setupAndroidChannels() {
        try {
            // Canal para notificações de corrida com ações
            await Notifications.setNotificationChannelAsync('driver_actions', {
                name: 'Ações de Corrida',
                description: 'Notificações com botões de ação para motoristas',
                importance: Notifications.AndroidImportance.HIGH,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#1A330E',
                sound: 'default',
                enableVibrate: true,
                showBadge: true,
            });

            Logger.log('✅ [InteractiveNotification] Canais Android configurados');
        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao configurar canais Android:', error);
        }
    }

    /**
     * Configurar categorias de notificação para iOS
     */
    async setupIOSCategories() {
        try {
            // Categoria para corrida aceita com ações
            await Notifications.setNotificationCategoryAsync('RIDE_ACCEPTED', [
                {
                    identifier: 'arrived_at_pickup',
                    buttonTitle: 'Cheguei ao local',
                    options: {
                        opensAppToForeground: false, // Não abre o app, apenas processa ação
                    },
                },
                {
                    identifier: 'cancel_ride',
                    buttonTitle: 'Cancelar',
                    options: {
                        opensAppToForeground: false,
                        isDestructive: true, // Botão vermelho no iOS
                    },
                },
            ], {
                intentIdentifiers: [],
                hiddenPreviewsBodyPlaceholder: '',
                options: [],
            });

            // ✅ NOVA: Categoria para viagem iniciada com ações
            await Notifications.setNotificationCategoryAsync('TRIP_STARTED', [
                {
                    identifier: 'arrived_at_pickup',
                    buttonTitle: 'Cheguei ao local',
                    options: {
                        opensAppToForeground: false,
                    },
                },
                {
                    identifier: 'start_trip',
                    buttonTitle: 'Iniciar corrida',
                    options: {
                        opensAppToForeground: false,
                    },
                },
            ], {
                intentIdentifiers: [],
                hiddenPreviewsBodyPlaceholder: '',
                options: [],
            });

            // ✅ NOVA: Categoria para corrida em andamento com botão "Encerrar corrida"
            await Notifications.setNotificationCategoryAsync('TRIP_IN_PROGRESS', [
                {
                    identifier: 'end_trip',
                    buttonTitle: 'Encerrar corrida',
                    options: {
                        opensAppToForeground: false,
                    },
                },
            ], {
                intentIdentifiers: [],
                hiddenPreviewsBodyPlaceholder: '',
                options: [],
            });

            // Categoria para chegada ao destino (sem ações, apenas informativa)
            await Notifications.setNotificationCategoryAsync('ARRIVED_AT_DESTINATION', [], {
                intentIdentifiers: [],
                hiddenPreviewsBodyPlaceholder: '',
                options: [],
            });

            Logger.log('✅ [InteractiveNotification] Categorias iOS configuradas');
        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao configurar categorias iOS:', error);
        }
    }

    /**
     * Configurar handler para notificações FCM
     * Registra tipos específicos no serviço base para ganhar delegacia
     */
    setupFCMHandler() {
        const handleInteractiveNotification = async (remoteMessage) => {
            Logger.log('📱 [InteractiveNotification] Notificação processada via handler:', remoteMessage);

            const { data, notification } = remoteMessage;

            // Verificar se é notificação interativa de corrida aceita
            if (data?.type === 'ride_accepted' && data?.hasActions === 'true') {
                Logger.log('🔔 [InteractiveNotification] Criando notificação do sistema com ações...');

                await this.createSystemNotification({
                    title: notification?.title || 'Corrida aceita!',
                    body: notification?.body || data.pickupAddress || 'Navegue até o local de embarque',
                    data: {
                        type: 'ride_accepted',
                        bookingId: data.bookingId,
                        driverId: data.driverId,
                        pickupAddress: data.pickupAddress,
                        pickupLat: data.pickupLat,
                        pickupLng: data.pickupLng,
                    },
                    categoryId: 'RIDE_ACCEPTED', // iOS
                    channelId: 'driver_actions', // Android
                });
            }

            // ✅ NOVO: Verificar se é notificação de viagem iniciada (motorista chegou ao local)
            if (data?.type === 'trip_started' && data?.hasActions === 'true') {
                Logger.log('🚀 [InteractiveNotification] Criando notificação de início de viagem...');

                await this.createSystemNotification({
                    title: notification?.title || '✅ Você chegou ao local!',
                    body: notification?.body || data.pickupAddress || 'Aguardando passageiro',
                    data: {
                        type: 'trip_started',
                        bookingId: data.bookingId,
                        driverId: data.driverId,
                        pickupAddress: data.pickupAddress,
                    },
                    categoryId: 'TRIP_STARTED', // iOS - categoria com botão "Iniciar corrida"
                    channelId: 'driver_actions', // Android
                });
            }

            // ✅ NOVO: Verificar se é notificação de corrida em andamento
            if (data?.type === 'trip_in_progress' && data?.hasActions === 'true') {
                Logger.log('🚗 [InteractiveNotification] Criando notificação de corrida em andamento...');

                await this.createSystemNotification({
                    title: notification?.title || '🚗 A caminho do destino',
                    body: notification?.body || `A caminho de ${data.destinationAddress || 'destino'}`,
                    data: {
                        type: 'trip_in_progress',
                        bookingId: data.bookingId,
                        driverId: data.driverId,
                        destinationAddress: data.destinationAddress,
                        estimatedArrival: data.estimatedArrival,
                    },
                    categoryId: 'TRIP_IN_PROGRESS', // iOS - categoria com botão "Encerrar corrida"
                    channelId: 'driver_actions', // Android
                });
            }

            // Verificar se é notificação de chegada ao destino
            if (data?.type === 'arrived_at_destination') {
                Logger.log('🎯 [InteractiveNotification] Criando notificação de chegada ao destino...');

                await this.createSystemNotification({
                    title: 'Você chegou ao destino',
                    body: 'Abra o aplicativo para encerrar a corrida',
                    data: {
                        type: 'arrived_at_destination',
                        bookingId: data.bookingId,
                        driverId: data.driverId,
                    },
                    categoryId: 'ARRIVED_AT_DESTINATION', // iOS
                    channelId: 'driver_actions', // Android
                });
            }
        };

        // Registrar para os tipos específicos desta classe
        fcmService.registerNotificationHandler('ride_accepted', handleInteractiveNotification);
        fcmService.registerNotificationHandler('trip_started', handleInteractiveNotification);
        fcmService.registerNotificationHandler('trip_in_progress', handleInteractiveNotification);
        fcmService.registerNotificationHandler('arrived_at_destination', handleInteractiveNotification);
    }

    /**
     * Cancelar/dismissar todas as notificações relacionadas a uma corrida
     * @param {string} bookingId - ID da corrida
     */
    async dismissTripNotifications(bookingId) {
        try {
            Logger.log(`🔔 [InteractiveNotification] Cancelando notificações da corrida ${bookingId}`);

            // Buscar todas as notificações agendadas
            const allNotifications = await Notifications.getAllScheduledNotificationsAsync();

            // Filtrar notificações relacionadas à corrida
            const tripNotifications = allNotifications.filter(notification => {
                const notificationData = notification.content?.data;
                return notificationData?.bookingId === bookingId ||
                    notificationData?.type === 'ride_accepted' ||
                    notificationData?.type === 'arrived_at_destination';
            });

            // Cancelar cada notificação
            for (const notification of tripNotifications) {
                await Notifications.cancelScheduledNotificationAsync(notification.identifier);
                Logger.log(`✅ [InteractiveNotification] Notificação ${notification.identifier} cancelada`);
            }

            // Também cancelar notificações exibidas (Android)
            if (Platform.OS === 'android') {
                // No Android, podemos cancelar todas as notificações do canal
                // ou usar cancelAllNotificationsAsync() para cancelar todas
                // Por segurança, vamos cancelar todas as notificações do canal driver_actions
                const displayedNotifications = await Notifications.getPresentedNotificationsAsync();
                const tripDisplayedNotifications = displayedNotifications.filter(notification => {
                    const notificationData = notification.request?.content?.data;
                    return notificationData?.bookingId === bookingId ||
                        notificationData?.type === 'ride_accepted' ||
                        notificationData?.type === 'arrived_at_destination';
                });

                for (const notification of tripDisplayedNotifications) {
                    await Notifications.dismissNotificationAsync(notification.identifier);
                    Logger.log(`✅ [InteractiveNotification] Notificação exibida ${notification.identifier} removida`);
                }
            }

            Logger.log(`✅ [InteractiveNotification] Todas as notificações da corrida ${bookingId} foram canceladas`);
            return true;

        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao cancelar notificações:', error);
            return false;
        }
    }

    /**
     * Criar notificação do sistema com ações
     */
    async createSystemNotification({ title, body, data, categoryId, channelId }) {
        try {
            const notificationId = await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    data,
                    sound: 'default',
                    priority: Notifications.AndroidNotificationPriority.HIGH,
                    // iOS: usar categoria para mostrar ações
                    categoryIdentifier: categoryId,
                },
                trigger: null, // Mostrar imediatamente
                // Android: usar canal
                ...(Platform.OS === 'android' && {
                    android: {
                        channelId,
                        priority: Notifications.AndroidNotificationPriority.HIGH,
                        sticky: true, // Notificação persistente (como a Uber)
                        ongoing: true, // Não pode ser removida pelo usuário
                        actions: categoryId === 'TRIP_STARTED' ? [
                            {
                                identifier: 'arrived_at_pickup',
                                buttonTitle: 'Cheguei ao local',
                                icon: 'ic_check',
                            },
                            {
                                identifier: 'start_trip',
                                buttonTitle: 'Iniciar corrida',
                                icon: 'ic_play',
                            },
                        ] : categoryId === 'TRIP_IN_PROGRESS' ? [
                            {
                                identifier: 'end_trip',
                                buttonTitle: 'Encerrar corrida',
                                icon: 'ic_stop',
                            },
                        ] : [
                            {
                                identifier: 'arrived_at_pickup',
                                buttonTitle: 'Cheguei ao local',
                                icon: 'ic_check',
                            },
                            {
                                identifier: 'cancel_ride',
                                buttonTitle: 'Cancelar',
                                icon: 'ic_close',
                            },
                        ],
                    },
                }),
            });

            Logger.log(`✅ [InteractiveNotification] Notificação do sistema criada: ${notificationId}`);
            return notificationId;

        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao criar notificação do sistema:', error);
            throw error;
        }
    }

    /**
     * Configurar listener para ações de notificação
     * Processa quando o usuário clica em um botão
     */
    setupActionListener() {
        // Listener para quando usuário interage com notificação
        Notifications.addNotificationResponseReceivedListener(async (response) => {
            Logger.log('🔔 [InteractiveNotification] Resposta de notificação recebida:', response);

            const { actionIdentifier, notification } = response;
            const data = notification.request.content.data;

            // Verificar se é ação de corrida aceita ou viagem iniciada
            if ((data?.type === 'ride_accepted' || data?.type === 'trip_started') && data?.bookingId) {
                const bookingId = data.bookingId;

                // Processar ação baseada no identifier do botão
                if (actionIdentifier === 'arrived_at_pickup') {
                    Logger.log('📍 [InteractiveNotification] Processando ação: Cheguei ao local');
                    await this.handleNotificationAction('arrived_at_pickup', bookingId);
                } else if (actionIdentifier === 'start_trip') {
                    Logger.log('🚀 [InteractiveNotification] Processando ação: Iniciar corrida');
                    await this.handleNotificationAction('start_trip', bookingId);
                } else if (actionIdentifier === 'cancel_ride') {
                    Logger.log('❌ [InteractiveNotification] Processando ação: Cancelar');
                    await this.handleNotificationAction('cancel_ride', bookingId);
                } else if (actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) {
                    // Usuário tocou na notificação (não em um botão)
                    Logger.log('👆 [InteractiveNotification] Notificação tocada (sem ação)');
                    // Pode abrir o app ou fazer outra ação
                }
            }

            // ✅ NOVO: Também processar notificações do tipo trip_started
            if (data?.type === 'trip_started' && data?.bookingId) {
                const bookingId = data.bookingId;

                if (actionIdentifier === 'start_trip') {
                    Logger.log('🚀 [InteractiveNotification] Processando ação: Iniciar corrida (trip_started)');
                    await this.handleNotificationAction('start_trip', bookingId);
                } else if (actionIdentifier === 'cancel_ride') {
                    Logger.log('❌ [InteractiveNotification] Processando ação: Cancelar (trip_started)');
                    await this.handleNotificationAction('cancel_ride', bookingId);
                }
            }

            // ✅ NOVO: Processar notificações de corrida em andamento
            if (data?.type === 'trip_in_progress' && data?.bookingId) {
                const bookingId = data.bookingId;

                if (actionIdentifier === 'end_trip') {
                    Logger.log('🏁 [InteractiveNotification] Processando ação: Encerrar corrida');
                    await this.handleNotificationAction('end_trip', bookingId);
                }
            }
        });
    }

    /**
     * Processar ação de notificação
     */
    async handleNotificationAction(action, bookingId) {
        try {
            Logger.log(`🔔 [InteractiveNotification] Processando ação ${action} para corrida ${bookingId}`);

            // Enviar ação para backend via WebSocket
            const result = await this.wsManager.sendNotificationAction(action, bookingId);

            Logger.log(`✅ [InteractiveNotification] Ação processada:`, result);

            // Remover notificação após processar ação
            await Notifications.dismissAllNotificationsAsync();

            return result;

        } catch (error) {
            Logger.error(`❌ [InteractiveNotification] Erro ao processar ação:`, error);
            throw error;
        }
    }

    /**
     * Cancelar todas as notificações
     */
    async cancelAllNotifications() {
        try {
            await Notifications.cancelAllScheduledNotificationsAsync();
            await Notifications.dismissAllNotificationsAsync();
            Logger.log('✅ [InteractiveNotification] Todas as notificações canceladas');
        } catch (error) {
            Logger.error('❌ [InteractiveNotification] Erro ao cancelar notificações:', error);
        }
    }
}

// Exportar instância singleton
const interactiveNotificationService = new InteractiveNotificationService();
export default interactiveNotificationService;




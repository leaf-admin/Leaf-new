import Logger from '../utils/Logger';
/**
 * 🔧 EXEMPLO DE INTEGRAÇÃO - COMO USAR OS NOVOS EVENTOS NAS TELAS
 */

// ==================== EXEMPLO 1: DRIVERSEARCHSCREEN.JS ====================

import WebSocketManager from '../services/WebSocketManager';


const DriverSearchScreen = ({ navigation, route }) => {
    const [drivers, setDrivers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const wsManager = WebSocketManager.getInstance();

    useEffect(() => {
        startDriverSearch();
    }, []);

    const startDriverSearch = async () => {
        try {
            setIsLoading(true);
            
            // CONECTAR WEBSOCKET
            await wsManager.connect();
            
            // USAR NOVO EVENTO: searchDrivers
            const result = await wsManager.searchDrivers(
                tripData.pickup,           // pickupLocation
                tripData.destination,      // destinationLocation
                'standard',                // rideType
                tripData.value,           // estimatedFare
                { vehicleType: 'car' }    // preferences
            );
            
            if (result.success) {
                setDrivers(result.drivers);
                Logger.log(`✅ ${result.drivers.length} motoristas encontrados`);
            }
            
        } catch (error) {
            Logger.error('Erro na busca de motoristas:', error);
            Alert.alert('Erro', 'Não foi possível buscar motoristas');
        } finally {
            setIsLoading(false);
        }
    };

    const cancelSearch = async () => {
        try {
            // USAR NOVO EVENTO: cancelDriverSearch
            await wsManager.cancelDriverSearch(tripData.id, 'Cancelado pelo usuário');
            navigation.goBack();
        } catch (error) {
            Logger.error('Erro ao cancelar busca:', error);
        }
    };
};

// ==================== EXEMPLO 2: SUPPORTSCREEN.JS ====================

const SupportScreen = ({ navigation, route }) => {
    const [tickets, setTickets] = useState([]);
    const wsManager = WebSocketManager.getInstance();

    const createTicket = async () => {
        try {
            // USAR NOVO EVENTO: createSupportTicket
            const result = await wsManager.createSupportTicket(
                'technical',              // type
                'N2',                     // priority
                'Problema com pagamento', // description
                []                        // attachments
            );
            
            if (result.success) {
                Alert.alert('Sucesso', `Ticket criado: ${result.ticketId}`);
                Logger.log(`✅ Ticket criado: ${result.ticketId}`);
            }
            
        } catch (error) {
            Logger.error('Erro ao criar ticket:', error);
            Alert.alert('Erro', 'Não foi possível criar ticket');
        }
    };

    const reportIncident = async () => {
        try {
            // USAR NOVO EVENTO: reportIncident
            const result = await wsManager.reportIncident(
                'safety',                 // type
                'Motorista dirigindo perigosamente', // description
                [],                       // evidence
                { lat: -23.5505, lng: -46.6333 } // location
            );
            
            if (result.success) {
                Alert.alert('Sucesso', `Incidente reportado: ${result.reportId}`);
            }
            
        } catch (error) {
            Logger.error('Erro ao reportar incidente:', error);
        }
    };
};

// ==================== EXEMPLO 3: DRIVER DASHBOARD ====================

const DriverDashboard = () => {
    const wsManager = WebSocketManager.getInstance();

    const goOnline = async () => {
        try {
            // USAR NOVO EVENTO: setDriverStatus
            await wsManager.setDriverStatus(
                currentUser.id,    // driverId
                'online',         // status
                true              // isOnline
            );
            
            Logger.log('✅ Driver online');
            
        } catch (error) {
            Logger.error('Erro ao definir status:', error);
        }
    };

    const updateLocation = async (lat, lng) => {
        try {
            // USAR NOVO EVENTO: updateDriverLocation
            await wsManager.updateDriverLocation(
                currentUser.id,    // driverId
                lat,              // lat
                lng,              // lng
                90,               // heading
                50                // speed
            );
            
        } catch (error) {
            Logger.error('Erro ao atualizar localização:', error);
        }
    };
};

// ==================== EXEMPLO 4: CHATSCREEN.JS ====================

const ChatScreen = ({ navigation, route }) => {
    const [messages, setMessages] = useState([]);
    const wsManager = WebSocketManager.getInstance();

    const initializeChat = async () => {
        try {
            // USAR NOVO EVENTO: createChat
            const result = await wsManager.createChat({
                tripId: tripId,
                participants: [driverId, customerId]
            });
            
            if (result.success) {
                setChatId(result.chatId);
                Logger.log(`✅ Chat criado: ${result.chatId}`);
            }
            
        } catch (error) {
            Logger.error('Erro ao criar chat:', error);
        }
    };

    const sendMessage = async (text) => {
        try {
            // USAR NOVO EVENTO: sendMessage
            const result = await wsManager.sendMessage({
                chatId: chatId,
                text: text,
                senderId: currentUser.id,
                timestamp: new Date().toISOString()
            });
            
            if (result.success) {
                Logger.log(`✅ Mensagem enviada: ${result.messageId}`);
            }
            
        } catch (error) {
            Logger.error('Erro ao enviar mensagem:', error);
        }
    };
};

// ==================== EXEMPLO 5: CANCELAMENTO DE CORRIDA ====================

const TripScreen = () => {
    const wsManager = WebSocketManager.getInstance();

    const cancelRide = async () => {
        try {
            // USAR NOVO EVENTO: cancelRide (com reembolso automático PIX)
            const result = await wsManager.cancelRide(
                bookingId,                    // bookingId
                'Mudança de planos',         // reason
                0                            // cancellationFee
            );
            
            if (result.success) {
                Alert.alert(
                    'Corrida Cancelada', 
                    `Reembolso de R$ ${result.data.refundAmount} processado automaticamente via PIX`
                );
                Logger.log('✅ Corrida cancelada e reembolso processado');
            }
            
        } catch (error) {
            Logger.error('Erro ao cancelar corrida:', error);
        }
    };
};

// ==================== EXEMPLO 6: ANALYTICS E FEEDBACK ====================

const AppAnalytics = () => {
    const wsManager = WebSocketManager.getInstance();

    const trackUserAction = async (action, data) => {
        try {
            // USAR NOVO EVENTO: trackUserAction
            await wsManager.trackUserAction(action, data);
            Logger.log(`✅ Ação rastreada: ${action}`);
            
        } catch (error) {
            Logger.error('Erro ao rastrear ação:', error);
        }
    };

    const submitFeedback = async () => {
        try {
            // USAR NOVO EVENTO: submitFeedback
            const result = await wsManager.submitFeedback(
                'app_feedback',           // type
                5,                        // rating
                'App muito bom!',         // comments
                'Melhorar interface'      // suggestions
            );
            
            if (result.success) {
                Alert.alert('Obrigado!', result.thankYouMessage);
            }
            
        } catch (error) {
            Logger.error('Erro ao enviar feedback:', error);
        }
    };
};

// ==================== EXEMPLO 7: NOTIFICAÇÕES ====================

const NotificationSettings = () => {
    const wsManager = WebSocketManager.getInstance();

    const updatePreferences = async (preferences) => {
        try {
            // USAR NOVO EVENTO: updateNotificationPreferences
            await wsManager.updateNotificationPreferences({
                rideUpdates: true,
                promotions: false,
                driverMessages: true,
                systemAlerts: true
            });
            
            Logger.log('✅ Preferências atualizadas');
            
        } catch (error) {
            Logger.error('Erro ao atualizar preferências:', error);
        }
    };
};

// ==================== EXEMPLO 8: EMERGÊNCIA ====================

const EmergencyScreen = () => {
    const wsManager = WebSocketManager.getInstance();

    const callEmergency = async (contactType) => {
        try {
            // USAR NOVO EVENTO: emergencyContact
            const result = await wsManager.emergencyContact(
                contactType,              // 'police', 'ambulance', 'fire'
                currentLocation,          // location
                'Emergência na corrida'   // message
            );
            
            if (result.success) {
                Alert.alert(
                    'Emergência Contatada',
                    `Tempo estimado de resposta: ${result.estimatedResponseTime} minutos`
                );
            }
            
        } catch (error) {
            Logger.error('Erro no contato de emergência:', error);
        }
    };
};

export {
    DriverSearchScreen,
    SupportScreen,
    DriverDashboard,
    ChatScreen,
    TripScreen,
    AppAnalytics,
    NotificationSettings,
    EmergencyScreen
};







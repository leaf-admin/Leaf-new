import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
// import { useTranslation } from 'react-i18next';
import WebSocketManager from '../../services/WebSocketManager';
import RatingModal from '../common/RatingModal';

// Função temporária para Icon (substituir por import real se necessário)
const Icon = ({ name, type, color, size }) => {
    return <Ionicons name={name} color={color} size={size} />;
};

export default function DriverUI(props) {
    // Função de tradução temporária
    const t = (key) => key;
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const { theme, isDarkMode, toggleTheme, currentLocation } = props;

    // Estados
    const [isOnline, setIsOnline] = useState(false);
    const [currentRide, setCurrentRide] = useState(null);
    
    // Estados para gerenciar reservas e viagens
    const [availableBookings, setAvailableBookings] = useState([]);
    const [tripStatus, setTripStatus] = useState('idle'); // idle, searching, accepted, started, completed
    const [currentBooking, setCurrentBooking] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    
    // Estado para modal de avaliação
    const [ratingModalVisible, setRatingModalVisible] = useState(false);

    // WebSocket - Sistema completo de eventos para motorista
    useEffect(() => {
        const webSocketManager = WebSocketManager.getInstance();

        // ===== HANDLERS PARA EVENTOS DE MOTORISTA =====

        // 1. Nova reserva disponível
        const handleNewBookingAvailable = (data) => {
            console.log('📋 Nova reserva disponível:', data);
            
            // Adicionar à lista de reservas disponíveis
            setAvailableBookings(prev => {
                const existing = prev.find(b => b.bookingId === data.bookingId);
                if (!existing) {
                    return [...prev, {
                        ...data,
                        receivedAt: new Date().toISOString()
                    }];
                }
                return prev;
            });
            
            // Mostrar notificação
            Alert.alert(
                'Nova Corrida Disponível!',
                `Origem: ${data.pickup.add}\nDestino: ${data.drop.add}\nValor: R$ ${data.estimate}`,
                [
                    { text: 'Ver Detalhes', onPress: () => showBookingDetails(data) },
                    { text: 'Aceitar', onPress: () => acceptBooking(data.bookingId) },
                    { text: 'Rejeitar', onPress: () => rejectBooking(data.bookingId, 'Não disponível') }
                ]
            );
        };

        // 2. Reserva aceita com sucesso
        const handleRideAccepted = (data) => {
            console.log('✅ Reserva aceita:', data);
            if (data.success) {
                setCurrentBooking(data.booking);
                setTripStatus('accepted');
                
                // Remover da lista de disponíveis
                setAvailableBookings(prev => 
                    prev.filter(b => b.bookingId !== data.bookingId)
                );
                
                Alert.alert(
                    'Corrida Aceita!',
                    'Dirija-se ao local de partida.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 3. Reserva rejeitada com sucesso
        const handleRideRejected = (data) => {
            console.log('❌ Reserva rejeitada:', data);
            if (data.success) {
                // Remover da lista de disponíveis
                setAvailableBookings(prev => 
                    prev.filter(b => b.bookingId !== data.bookingId)
                );
                
                Alert.alert(
                    'Corrida Rejeitada',
                    'A reserva foi rejeitada com sucesso.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 4. Viagem iniciada
        const handleTripStarted = (data) => {
            console.log('🚀 Viagem iniciada:', data);
            setTripStatus('started');
            
            Alert.alert(
                'Viagem Iniciada!',
                'A viagem foi iniciada com sucesso!',
                [{ text: 'OK' }]
            );
        };

        // 5. Viagem finalizada
        const handleTripCompleted = (data) => {
            console.log('🏁 Viagem finalizada:', data);
            setTripStatus('completed');
            
            Alert.alert(
                'Viagem Finalizada!',
                `Distância: ${data.distance}km\nValor: R$ ${data.fare}\n\nAvalie o passageiro para melhorar o serviço.`,
                [
                    { text: 'Avaliar Passageiro', onPress: () => showRatingModal() },
                    { text: 'OK' }
                ]
            );
        };

        // 6. Pagamento confirmado
        const handlePaymentConfirmed = (data) => {
            console.log('💳 Pagamento confirmado:', data);
            setTripStatus('idle');
            setCurrentBooking(null);
            setCurrentRide(null);
            
            Alert.alert(
                'Pagamento Confirmado!',
                'O passageiro confirmou o pagamento. Viagem finalizada!',
                [{ text: 'OK' }]
            );
        };

        // 7. Avaliação recebida
        const handleRatingReceived = (data) => {
            console.log('⭐ Avaliação recebida:', data);
            
            // Mostrar notificação de avaliação
            Alert.alert(
                'Avaliação Recebida!',
                `Você recebeu ${data.rating} estrelas!\n${data.comment || ''}`,
                [
                    { text: 'Ver Detalhes', onPress: () => showRatingModal() },
                    { text: 'OK' }
                ]
            );
        };

        // ===== REGISTRAR TODOS OS EVENTOS =====
        webSocketManager.on('newBookingAvailable', handleNewBookingAvailable);
        webSocketManager.on('rideAccepted', handleRideAccepted);
        webSocketManager.on('rideRejected', handleRideRejected);
        webSocketManager.on('tripStarted', handleTripStarted);
        webSocketManager.on('tripCompleted', handleTripCompleted);
        webSocketManager.on('paymentConfirmed', handlePaymentConfirmed);
        webSocketManager.on('ratingReceived', handleRatingReceived);

        // ===== CLEANUP =====
        return () => {
            webSocketManager.off('newBookingAvailable', handleNewBookingAvailable);
            webSocketManager.off('rideAccepted', handleRideAccepted);
            webSocketManager.off('rideRejected', handleRideRejected);
            webSocketManager.off('tripStarted', handleTripStarted);
            webSocketManager.off('tripCompleted', handleTripCompleted);
            webSocketManager.off('paymentConfirmed', handlePaymentConfirmed);
            webSocketManager.off('ratingReceived', handleRatingReceived);
        };
    }, [auth.profile?.uid]);

    // Atualizar localização em tempo real quando online
    useEffect(() => {
        if (isOnline && currentLocation) {
            // Atualizar localização no WebSocket
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected()) {
                webSocketManager.emit('updateLocation', {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                });
            }
            
            // Atualizar localização durante viagem
            if (tripStatus === 'started') {
                updateDriverLocation();
            }
        }
    }, [isOnline, currentLocation, tripStatus]);

    // ===== FUNÇÕES PARA GERENCIAR RESERVAS =====

    // Mostrar detalhes da reserva
    const showBookingDetails = (booking) => {
        Alert.alert(
            'Detalhes da Reserva',
            `Origem: ${booking.pickup.add}\nDestino: ${booking.drop.add}\nValor: R$ ${booking.estimate}\nDistância: ${Math.round(booking.distance)}m`,
            [
                { text: 'Aceitar', onPress: () => acceptBooking(booking.bookingId) },
                { text: 'Rejeitar', onPress: () => rejectBooking(booking.bookingId, 'Não disponível') },
                { text: 'Cancelar' }
            ]
        );
    };

    // Aceitar reserva
    const acceptBooking = async (bookingId) => {
        try {
            console.log('✅ Aceitando reserva:', bookingId);
            
            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
                
                // Autenticar como motorista
                await new Promise((resolve, reject) => {
                    webSocketManager.socket.emit('authenticate', { 
                        uid: auth.profile?.uid, 
                        userType: 'driver' 
                    });
                    
                    webSocketManager.socket.once('authenticated', (data) => {
                        if (data.success) {
                            resolve(data);
                        } else {
                            reject(new Error('Falha na autenticação'));
                        }
                    });
                    
                    setTimeout(() => reject(new Error('Timeout de autenticação')), 10000);
                });
            }
            
            // Aceitar reserva via WebSocket
            const result = await webSocketManager.driverResponse(bookingId, true);
            
            if (result.success) {
                console.log('✅ Reserva aceita com sucesso');
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao aceitar reserva');
            }
            
        } catch (error) {
            console.error('❌ Erro ao aceitar reserva:', error);
            Alert.alert('Erro', error.message || 'Falha ao aceitar reserva');
        }
    };

    // Rejeitar reserva
    const rejectBooking = async (bookingId, reason) => {
        try {
            console.log('❌ Rejeitando reserva:', bookingId, 'Razão:', reason);
            
            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
                
                // Autenticar como motorista
                await new Promise((resolve, reject) => {
                    webSocketManager.socket.emit('authenticate', { 
                        uid: auth.profile?.uid, 
                        userType: 'driver' 
                    });
                    
                    webSocketManager.socket.once('authenticated', (data) => {
                        if (data.success) {
                            resolve(data);
                        } else {
                            reject(new Error('Falha na autenticação'));
                        }
                    });
                    
                    setTimeout(() => reject(new Error('Timeout de autenticação')), 10000);
                });
            }
            
            // Rejeitar reserva via WebSocket
            const result = await webSocketManager.driverResponse(bookingId, false, reason);
            
            if (result.success) {
                console.log('✅ Reserva rejeitada com sucesso');
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao rejeitar reserva');
            }
            
        } catch (error) {
            console.error('❌ Erro ao rejeitar reserva:', error);
            Alert.alert('Erro', error.message || 'Falha ao rejeitar reserva');
        }
    };

    // Função para alternar status online/offline
    const toggleOnlineStatus = () => {
        const newStatus = !isOnline;
        setIsOnline(newStatus);
        
        if (newStatus) {
            Alert.alert('Online', 'Você está agora disponível para corridas!');
        } else {
            Alert.alert('Offline', 'Você não receberá mais solicitações de corrida.');
        }
    };

    // Função para aceitar corrida (mantida para compatibilidade)
    const acceptRide = (rideData) => {
        try {
            setCurrentRide(rideData);
            Alert.alert('Corrida Aceita', 'Dirija-se ao local de partida.');
        } catch (error) {
            console.error('❌ Erro ao aceitar corrida:', error);
            Alert.alert('Erro', 'Não foi possível aceitar a corrida.');
        }
    };

    // Função para iniciar viagem via WebSocket
    const startTrip = async () => {
        if (!currentBooking) {
            Alert.alert('Erro', 'Nenhuma reserva ativa para iniciar');
            return;
        }

        try {
            console.log('🚀 Iniciando viagem:', currentBooking.id);
            
            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }
            
            // Iniciar viagem via WebSocket
            const startLocation = currentLocation || { lat: 0, lng: 0 };
            const result = await webSocketManager.startTrip(currentBooking.id, startLocation);
            
            if (result.success) {
                console.log('✅ Viagem iniciada com sucesso');
                setTripStatus('started');
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao iniciar viagem');
            }
            
        } catch (error) {
            console.error('❌ Erro ao iniciar viagem:', error);
            Alert.alert('Erro', error.message || 'Falha ao iniciar viagem');
        }
    };

    // Função para finalizar viagem via WebSocket
    const finishTrip = async () => {
        if (!currentBooking) {
            Alert.alert('Erro', 'Nenhuma reserva ativa para finalizar');
            return;
        }

        try {
            console.log('🏁 Finalizando viagem:', currentBooking.id);
            
            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }
            
            // Calcular dados da viagem (simplificado)
            const endLocation = currentLocation || { lat: 0, lng: 0 };
            const distance = currentBooking.estimate ? currentBooking.estimate * 0.1 : 5; // Estimativa
            const fare = currentBooking.estimate || 25;
            
            // Finalizar viagem via WebSocket
            const result = await webSocketManager.completeTrip(
                currentBooking.id, 
                endLocation, 
                distance, 
                fare
            );
            
            if (result.success) {
                console.log('✅ Viagem finalizada com sucesso');
                setTripStatus('completed');
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao finalizar viagem');
            }
            
        } catch (error) {
            console.error('❌ Erro ao finalizar viagem:', error);
            Alert.alert('Erro', error.message || 'Falha ao finalizar viagem');
        }
    };

    // Função para atualizar localização em tempo real
    const updateDriverLocation = async () => {
        if (!currentBooking || tripStatus !== 'started') {
            return;
        }

        try {
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected() && currentLocation) {
                await webSocketManager.updateDriverLocation(
                    currentBooking.id,
                    currentLocation.lat,
                    currentLocation.lng
                );
                
                setDriverLocation(currentLocation);
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar localização:', error);
        }
    };

    // Função para lidar com avaliação da viagem
    const handleRatingSubmit = async (ratingData) => {
        try {
            console.log('⭐ Avaliação submetida:', ratingData);
            
            // Importar RatingService
            const RatingService = require('../../services/RatingService').default;
            
            // Enviar avaliação
            const result = await RatingService.submitRating(ratingData);
            
            if (result.success) {
                console.log('✅ Avaliação enviada com sucesso');
                // A avaliação foi salva localmente e enviada para o backend
            } else {
                throw new Error(result.error || 'Falha ao enviar avaliação');
            }
            
        } catch (error) {
            console.error('❌ Erro ao enviar avaliação:', error);
            Alert.alert('Erro', error.message || 'Falha ao enviar avaliação');
        }
    };

    // Função para mostrar modal de avaliação
    const showRatingModal = () => {
        setRatingModalVisible(true);
    };

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* Header */}
            <View style={styles.headerFloating} pointerEvents="box-none">
                <View style={styles.header}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: theme.card }]}
                        onPress={() => {
                            // TODO: Implementar menu
                            console.log('📱 Menu aberto');
                        }}
                    >
                        <Ionicons name="menu" color={theme.icon} size={24} />
                    </TouchableOpacity>
                    
                    <View style={styles.headerRightContainer}>
                        <TouchableOpacity 
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={() => {
                                // TODO: Implementar notificações
                                console.log('🔔 Notificações');
                            }}
                        >
                            <Ionicons name="notifications" color={theme.icon} size={24} />
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={toggleTheme}
                        >
                            <Icon 
                                name={isDarkMode ? "wb-sunny" : "nightlight-round"} 
                                type="material" 
                                color={theme.icon} 
                                size={24} 
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Status Online/Offline */}
            <View style={styles.statusFloating} pointerEvents="box-none">
                <TouchableOpacity
                    style={[
                        styles.statusButton,
                        { 
                            backgroundColor: isOnline ? '#4CAF50' : '#F44336',
                            shadowColor: '#000',
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.25,
                            shadowRadius: 3.84,
                            elevation: 5
                        }
                    ]}
                    onPress={toggleOnlineStatus}
                    activeOpacity={0.8}
                >
                    <Icon 
                        name={isOnline ? "check-circle" : "cancel"} 
                        type="material" 
                        color="#FFFFFF" 
                        size={24} 
                    />
                    <Text style={styles.statusText}>
                        {isOnline ? 'Online' : 'Offline'}
                    </Text>
                </TouchableOpacity>
                
                {/* Indicador de status da viagem */}
                {currentBooking && (
                    <View style={[styles.tripStatusIndicator, { backgroundColor: theme.card }]}>
                        <Text style={[styles.tripStatusText, { color: theme.text }]}>
                            {tripStatus === 'accepted' ? '🚗 Dirigindo para passageiro' :
                             tripStatus === 'started' ? '🚀 Viagem em andamento' :
                             tripStatus === 'completed' ? '✅ Viagem finalizada' : '⏳ Aguardando'}
                        </Text>
                    </View>
                )}
            </View>

            {/* Lista de reservas disponíveis */}
            {isOnline && availableBookings.length > 0 && (
                <View style={styles.bookingsFloating} pointerEvents="box-none">
                    <View style={[styles.bookingsCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.bookingsTitle, { color: theme.text }]}>
                            Corridas Disponíveis ({availableBookings.length})
                        </Text>
                        
                        <ScrollView style={styles.bookingsList} showsVerticalScrollIndicator={false}>
                            {availableBookings.map((booking, index) => (
                                <View key={booking.bookingId} style={styles.bookingItem}>
                                    <View style={styles.bookingInfo}>
                                        <Text style={[styles.bookingAddress, { color: theme.text }]}>
                                            📍 {booking.pickup.add}
                                        </Text>
                                        <Text style={[styles.bookingAddress, { color: theme.text }]}>
                                            🎯 {booking.drop.add}
                                        </Text>
                                        <Text style={[styles.bookingEstimate, { color: theme.textSecondary }]}>
                                            💰 R$ {booking.estimate}
                                        </Text>
                                        <Text style={[styles.bookingDistance, { color: theme.textSecondary }]}>
                                            📏 {Math.round(booking.distance)}m
                                        </Text>
                                    </View>
                                    
                                    <View style={styles.bookingActions}>
                                        <TouchableOpacity
                                            style={[styles.bookingActionButton, { backgroundColor: '#4CAF50' }]}
                                            onPress={() => acceptBooking(booking.bookingId)}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={styles.bookingActionText}>Aceitar</Text>
                                        </TouchableOpacity>
                                        
                                        <TouchableOpacity
                                            style={[styles.bookingActionButton, { backgroundColor: '#F44336' }]}
                                            onPress={() => rejectBooking(booking.bookingId, 'Não disponível')}
                                            activeOpacity={0.8}
                                        >
                                            <Text style={styles.bookingActionText}>Rejeitar</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            )}

            {/* Informações da corrida atual */}
            {currentBooking && (
                <View style={styles.rideInfoFloating} pointerEvents="box-none">
                    <View style={[styles.rideInfoCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.rideInfoTitle, { color: theme.text }]}>
                            {tripStatus === 'accepted' ? 'Corrida Aceita' : 
                             tripStatus === 'started' ? 'Viagem em Andamento' : 
                             tripStatus === 'completed' ? 'Viagem Finalizada' : 'Corrida Atual'}
                        </Text>
                        
                        <View style={styles.rideDetails}>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                📍 {currentBooking.pickup?.add || 'Local de partida'}
                            </Text>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                🎯 {currentBooking.drop?.add || 'Destino'}
                            </Text>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                💰 R$ {currentBooking.estimate || 'N/A'}
                            </Text>
                            {driverLocation && (
                                <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                    📍 Sua localização: {driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)}
                                </Text>
                            )}
                        </View>

                        <View style={styles.rideActions}>
                            {tripStatus === 'accepted' && (
                                <TouchableOpacity
                                    style={[styles.actionButton, { backgroundColor: '#2196F50' }]}
                                    onPress={startTrip}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.actionButtonText}>Iniciar Viagem</Text>
                                </TouchableOpacity>
                            )}
                            
                            {tripStatus === 'started' && (
                                <TouchableOpacity
                                    style={[styles.actionButton, { backgroundColor: '#4CAF50' }]}
                                    onPress={finishTrip}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.actionButtonText}>Finalizar Viagem</Text>
                                </TouchableOpacity>
                            )}
                            
                            {/* Botão de avaliação será mostrado automaticamente após finalizar viagem */}
                            {/* O modal será aberto via Alert quando tripStatus === 'completed' */}
                        </View>
                    </View>
                </View>
            )}

            {/* Botão de ajuda */}
            <View style={styles.helpFloating} pointerEvents="box-none">
                <TouchableOpacity
                    style={[styles.helpButton, { backgroundColor: theme.card }]}
                    onPress={() => {
                        Alert.alert('Ajuda', 'Entre em contato com o suporte se precisar de ajuda.');
                    }}
                    activeOpacity={0.8}
                >
                                            <Ionicons name="help-circle" color={theme.icon} size={24} />
                </TouchableOpacity>
            </View>

            {/* Modal de avaliação */}
            <RatingModal
                visible={ratingModalVisible}
                onClose={() => setRatingModalVisible(false)}
                userType="driver"
                tripData={currentBooking}
                onSubmit={handleRatingSubmit}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    
    // Header
    headerFloating: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingHorizontal: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
        marginHorizontal: 4,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },

    // Status Online/Offline
    statusFloating: {
        position: 'absolute',
        top: 120,
        left: 20,
        zIndex: 999,
    },
    statusButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 25,
        gap: 8,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    tripStatusIndicator: {
        marginTop: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 2,
    },
    tripStatusText: {
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },

    // Informações da corrida
    rideInfoFloating: {
        position: 'absolute',
        bottom: 120,
        left: 20,
        right: 20,
        zIndex: 996,
    },
    rideInfoCard: {
        padding: 20,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    rideInfoTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 16,
        textAlign: 'center',
    },
    rideDetails: {
        marginBottom: 20,
        gap: 8,
    },
    rideDetailText: {
        fontSize: 14,
        lineHeight: 20,
    },
    rideActions: {
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 'bold',
    },

    // Lista de reservas disponíveis
    bookingsFloating: {
        position: 'absolute',
        top: 200,
        left: 20,
        right: 20,
        zIndex: 998,
        maxHeight: 300,
    },
    bookingsCard: {
        padding: 16,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    bookingsTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 12,
        textAlign: 'center',
    },
    bookingsList: {
        maxHeight: 200,
    },
    bookingItem: {
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.1)',
        paddingVertical: 12,
        marginBottom: 8,
    },
    bookingInfo: {
        marginBottom: 8,
    },
    bookingAddress: {
        fontSize: 12,
        lineHeight: 16,
        marginBottom: 2,
    },
    bookingEstimate: {
        fontSize: 14,
        fontWeight: 'bold',
        marginTop: 4,
    },
    bookingDistance: {
        fontSize: 11,
        marginTop: 2,
    },
    bookingActions: {
        flexDirection: 'row',
        gap: 8,
    },
    bookingActionButton: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: 'center',
    },
    bookingActionText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 'bold',
    },

    // Botão de ajuda
    helpFloating: {
        position: 'absolute',
        bottom: 40,
        right: 20,
        zIndex: 995,
    },
    helpButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
}); 
}); 
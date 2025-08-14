import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert
} from 'react-native';
import { Icon } from 'react-native-elements';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import WebSocketManager from '../../services/WebSocketManager';

export default function DriverUI(props) {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const { theme, isDarkMode, toggleTheme, currentLocation } = props;

    // Estados
    const [isOnline, setIsOnline] = useState(false);
    const [currentRide, setCurrentRide] = useState(null);

    // WebSocket
    useEffect(() => {
        const webSocketManager = WebSocketManager.getInstance();
        
        // Enviar localização em tempo real
        if (isOnline && currentLocation) {
            webSocketManager.emit('driver_location_update', {
                driverId: auth.profile?.uid,
                location: currentLocation,
                timestamp: Date.now()
            });
        }
    }, [isOnline, currentLocation, auth.profile?.uid]);

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

    // Função para aceitar corrida
    const acceptRide = (rideData) => {
        try {
            setCurrentRide(rideData);
            Alert.alert('Corrida Aceita', 'Dirija-se ao local de partida.');
        } catch (error) {
            console.error('❌ Erro ao aceitar corrida:', error);
            Alert.alert('Erro', 'Não foi possível aceitar a corrida.');
        }
    };

    // Função para iniciar viagem
    const startTrip = () => {
        if (currentRide) {
            Alert.alert('Viagem Iniciada', 'A viagem foi iniciada com sucesso!');
            // TODO: Implementar lógica de início de viagem
        }
    };

    // Função para finalizar viagem
    const finishTrip = () => {
        if (currentRide) {
            Alert.alert('Viagem Finalizada', 'A viagem foi finalizada com sucesso!');
            setCurrentRide(null);
            // TODO: Implementar lógica de finalização de viagem
        }
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
                        <Icon name="menu" type="material" color={theme.icon} size={24} />
                    </TouchableOpacity>
                    
                    <View style={styles.headerRightContainer}>
                        <TouchableOpacity 
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={() => {
                                // TODO: Implementar notificações
                                console.log('🔔 Notificações');
                            }}
                        >
                            <Icon name="notifications" type="material" color={theme.icon} size={24} />
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
            </View>

            {/* Informações da corrida atual */}
            {currentRide && (
                <View style={styles.rideInfoFloating} pointerEvents="box-none">
                    <View style={[styles.rideInfoCard, { backgroundColor: theme.card }]}>
                        <Text style={[styles.rideInfoTitle, { color: theme.text }]}>
                            Corrida Atual
                        </Text>
                        
                        <View style={styles.rideDetails}>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                📍 {currentRide.pickup?.address || 'Local de partida'}
                            </Text>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                🎯 {currentRide.drop?.address || 'Destino'}
                            </Text>
                            <Text style={[styles.rideDetailText, { color: theme.textSecondary }]}>
                                💰 R$ {currentRide.estimate?.fare || 'N/A'}
                            </Text>
                        </View>

                        <View style={styles.rideActions}>
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: '#2196F3' }]}
                                onPress={startTrip}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.actionButtonText}>Iniciar Viagem</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: '#4CAF50' }]}
                                onPress={finishTrip}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.actionButtonText}>Finalizar</Text>
                            </TouchableOpacity>
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
                    <Icon name="help" type="material" color={theme.icon} size={24} />
                </TouchableOpacity>
            </View>
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
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ScrollView,
    ActivityIndicator
} from 'react-native';
import { useLocationWithRedis } from '../hooks/useLocationWithRedis';
import { useTripTracking } from '../hooks/useTripTracking';
import { useSelector } from 'react-redux';
import { colors } from '../common/theme';
import { Ionicons } from '@expo/vector-icons';
import redisApiService from '../services/RedisApiService';

export const RedisLocationDemo = () => {
    const auth = useSelector(state => state.authdata);
    const gps = useSelector(state => state.gpsdata);
    
    const {
        location,
        error: locationError,
        loading: locationLoading,
        getCurrentLocation,
        startLocationTracking,
        stopLocationTracking,
        getUserLocationData,
        hasLocationChanged,
        redisAvailable,
        updateLocation,
        fetchNearbyDrivers,
        getUserLocationById,
        updateDriverStatus,
        getStats,
        startAutoTracking,
        stopAutoTracking,
        updateTripStatus
    } = useLocationWithRedis();

    const [demoTripId] = useState('demo-trip-123');
    const {
        tripData,
        isTracking,
        error: trackingError,
        startAutoTracking: useTripTrackingStartAutoTracking,
        stopAutoTracking: useTripTrackingStopAutoTracking,
        updateTripStatus: useTripTrackingUpdateTripStatus
    } = useTripTracking(demoTripId);

    const [userLocationData, setUserLocationData] = useState(null);
    const [nearbyDrivers, setNearbyDrivers] = useState([]);
    const [stats, setStats] = useState(null);
    const [apiLoading, setApiLoading] = useState(false);

    // Carregar localização do usuário ao montar
    useEffect(() => {
        if (auth.profile && auth.profile.uid) {
            loadUserLocation();
        }
    }, [auth.profile]);

    // Inicializar serviço
    useEffect(() => {
        const initService = async () => {
            try {
                await redisApiService.initialize();
                console.log('✅ Redis API Service inicializado');
            } catch (error) {
                console.error('❌ Erro ao inicializar Redis API Service:', error);
            }
        };

        initService();
    }, []);

    const loadUserLocation = async () => {
        if (auth.profile && auth.profile.uid) {
            const data = await getUserLocationData(auth.profile.uid);
            setUserLocationData(data);
        }
    };

    const handleStartLocationTracking = () => {
        startLocationTracking({
            accuracy: 'high',
            timeInterval: 2000, // 2 segundos
            distanceInterval: 5 // 5 metros
        });
    };

    const handleStartTripTracking = () => {
        if (!auth.profile) {
            Alert.alert('Erro', 'Usuário não autenticado');
            return;
        }

        startAutoTracking(
            auth.profile.uid, // driverId
            'demo-passenger-456', // passengerId
            {
                interval: 2000, // 2 segundos
                distanceThreshold: 0.005 // 5 metros
            }
        );
    };

    const handleUpdateTripStatus = (status) => {
        useTripTrackingUpdateTripStatus(status);
    };

    const handleStartTracking = async () => {
        try {
            setIsTracking(true);
            await startLocationTracking();
            Alert.alert('Sucesso', 'Tracking de localização iniciado');
        } catch (error) {
            Alert.alert('Erro', 'Falha ao iniciar tracking: ' + error.message);
            setIsTracking(false);
        }
    };

    const handleStopTracking = () => {
        stopLocationTracking();
        setIsTracking(false);
        Alert.alert('Sucesso', 'Tracking de localização parado');
    };

    const handleFindNearbyDrivers = async () => {
        if (!location) {
            Alert.alert('Erro', 'Localização não disponível');
            return;
        }

        try {
            setApiLoading(true);
            const drivers = await fetchNearbyDrivers(
                location.lat,
                location.lng,
                5000, // 5km
                10
            );
            setNearbyDrivers(drivers);
            Alert.alert('Sucesso', `Encontrados ${drivers.length} motoristas próximos`);
        } catch (error) {
            Alert.alert('Erro', 'Falha ao buscar motoristas: ' + error.message);
        } finally {
            setApiLoading(false);
        }
    };

    const handleGetStats = async () => {
        try {
            setApiLoading(true);
            const statsData = await getStats();
            setStats(statsData);
            Alert.alert('Sucesso', 'Estatísticas obtidas com sucesso');
        } catch (error) {
            Alert.alert('Erro', 'Falha ao obter estatísticas: ' + error.message);
        } finally {
            setApiLoading(false);
        }
    };

    const handleUpdateDriverStatus = async () => {
        try {
            setApiLoading(true);
            await updateDriverStatus('available', true);
            Alert.alert('Sucesso', 'Status do motorista atualizado');
        } catch (error) {
            Alert.alert('Erro', 'Falha ao atualizar status: ' + error.message);
        } finally {
            setApiLoading(false);
        }
    };

    const handleTestApiHealth = async () => {
        try {
            setApiLoading(true);
            const isHealthy = await redisApiService.checkServiceHealth();
            Alert.alert(
                'Status da API',
                isHealthy ? 'API Redis funcionando' : 'API Redis não disponível'
            );
        } catch (error) {
            Alert.alert('Erro', 'Falha ao verificar saúde da API: ' + error.message);
        } finally {
            setApiLoading(false);
        }
    };

    const formatLocation = (loc) => {
        if (!loc) return 'N/A';
        return `${loc.lat?.toFixed(6)}, ${loc.lng?.toFixed(6)}`;
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp).toLocaleTimeString();
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Ionicons name="location" size={24} color={colors.SKY} />
                <Text style={styles.title}>Redis Location Demo</Text>
            </View>

            {/* Status do Redis */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>🔧 Redis Status</Text>
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Redis Habilitado:</Text>
                    <Text style={[styles.value, { color: colors.GREEN }]}>✅ Sim</Text>
                </View>
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Dual Write:</Text>
                    <Text style={[styles.value, { color: colors.GREEN }]}>✅ Ativo</Text>
                </View>
            </View>

            {/* Localização Atual */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>📍 Localização Atual</Text>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>GPS:</Text>
                    <Text style={styles.value}>{formatLocation(gps.location)}</Text>
                </View>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Hook Location:</Text>
                    <Text style={styles.value}>{formatLocation(location)}</Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Última Atualização:</Text>
                    <Text style={styles.value}>{formatTime(location?.at)}</Text>
                </View>

                {locationError && (
                    <Text style={styles.error}>❌ Erro: {locationError.message}</Text>
                )}

                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.button, styles.primaryButton]}
                        onPress={getCurrentLocation}
                        disabled={locationLoading}
                    >
                        <Text style={styles.buttonText}>
                            {locationLoading ? 'Carregando...' : '📍 Obter Localização'}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.button, isTracking ? styles.dangerButton : styles.successButton]}
                        onPress={isTracking ? stopLocationTracking : handleStartLocationTracking}
                    >
                        <Text style={styles.buttonText}>
                            {isTracking ? '🛑 Parar Tracking' : '🚀 Iniciar Tracking'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Localização do Usuário (Redis) */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>👤 Localização do Usuário (Redis)</Text>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Usuário:</Text>
                    <Text style={styles.value}>{auth.profile?.uid || 'Não autenticado'}</Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Localização:</Text>
                    <Text style={styles.value}>{formatLocation(userLocationData)}</Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Timestamp:</Text>
                    <Text style={styles.value}>{formatTime(userLocationData?.at)}</Text>
                </View>

                <TouchableOpacity
                    style={[styles.button, styles.secondaryButton]}
                    onPress={loadUserLocation}
                >
                    <Text style={styles.buttonText}>🔄 Recarregar</Text>
                </TouchableOpacity>
            </View>

            {/* Tracking de Viagem */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>🚗 Tracking de Viagem</Text>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Trip ID:</Text>
                    <Text style={styles.value}>{demoTripId}</Text>
                </View>

                <View style={styles.statusRow}>
                    <Text style={styles.label}>Status:</Text>
                    <Text style={[styles.value, { color: isTracking ? colors.GREEN : colors.GRAY }]}>
                        {isTracking ? '🟢 Ativo' : '🔴 Inativo'}
                    </Text>
                </View>

                {tripData && (
                    <>
                        <View style={styles.statusRow}>
                            <Text style={styles.label}>Driver ID:</Text>
                            <Text style={styles.value}>{tripData.driverId}</Text>
                        </View>
                        <View style={styles.statusRow}>
                            <Text style={styles.label}>Passenger ID:</Text>
                            <Text style={styles.value}>{tripData.passengerId}</Text>
                        </View>
                        <View style={styles.statusRow}>
                            <Text style={styles.label}>Status da Viagem:</Text>
                            <Text style={styles.value}>{tripData.status}</Text>
                        </View>
                    </>
                )}

                {trackingError && (
                    <Text style={styles.error}>❌ Erro: {trackingError.message}</Text>
                )}

                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.button, isTracking ? styles.dangerButton : styles.successButton]}
                        onPress={isTracking ? useTripTrackingStopAutoTracking : handleStartTripTracking}
                    >
                        <Text style={styles.buttonText}>
                            {isTracking ? '🛑 Parar Viagem' : '🚀 Iniciar Viagem'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Botões de Status da Viagem */}
                {isTracking && (
                    <View style={styles.statusButtons}>
                        <TouchableOpacity
                            style={[styles.smallButton, styles.infoButton]}
                            onPress={() => handleUpdateTripStatus('ACCEPTED')}
                        >
                            <Text style={styles.smallButtonText}>✅ Aceito</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                            style={[styles.smallButton, styles.warningButton]}
                            onPress={() => handleUpdateTripStatus('ARRIVED')}
                        >
                            <Text style={styles.smallButtonText}>🚗 Chegou</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                            style={[styles.smallButton, styles.successButton]}
                            onPress={() => handleUpdateTripStatus('STARTED')}
                        >
                            <Text style={styles.smallButtonText}>▶️ Iniciou</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity
                            style={[styles.smallButton, styles.dangerButton]}
                            onPress={() => handleUpdateTripStatus('COMPLETED')}
                        >
                            <Text style={styles.smallButtonText}>🏁 Finalizado</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            {/* Informações de Performance */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>⚡ Performance</Text>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Latência Redis:</Text>
                    <Text style={[styles.value, { color: colors.GREEN }]}>~1ms</Text>
                </View>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Latência Firebase:</Text>
                    <Text style={[styles.value, { color: colors.ORANGE }]}>~50-200ms</Text>
                </View>
                
                <View style={styles.statusRow}>
                    <Text style={styles.label}>Busca por Proximidade:</Text>
                    <Text style={[styles.value, { color: colors.GREEN }]}>~5ms (Redis GEO)</Text>
                </View>
            </View>

            {/* APIs Redis */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>APIs Redis</Text>
                
                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.button, styles.successButton]}
                        onPress={handleFindNearbyDrivers}
                        disabled={apiLoading || !location}
                    >
                        {apiLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.buttonText}>Buscar Motoristas</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.button, styles.infoButton]}
                        onPress={handleGetStats}
                        disabled={apiLoading}
                    >
                        {apiLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.buttonText}>Estatísticas</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.button, styles.warningButton]}
                        onPress={handleUpdateDriverStatus}
                        disabled={apiLoading}
                    >
                        {apiLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.buttonText}>Atualizar Status</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.button, styles.infoButton]}
                        onPress={handleTestApiHealth}
                        disabled={apiLoading}
                    >
                        {apiLoading ? (
                            <ActivityIndicator color="#fff" size="small" />
                        ) : (
                            <Text style={styles.buttonText}>Testar API</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Resultados */}
            {nearbyDrivers.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Motoristas Próximos ({nearbyDrivers.length})</Text>
                    {nearbyDrivers.map((driver, index) => (
                        <View key={index} style={styles.driverItem}>
                            <Text style={styles.driverText}>
                                ID: {driver.uid}
                            </Text>
                            <Text style={styles.driverText}>
                                Distância: {driver.distance}m
                            </Text>
                            <Text style={styles.driverText}>
                                Posição: {driver.lat.toFixed(4)}, {driver.lng.toFixed(4)}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            {stats && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Estatísticas</Text>
                    <View style={styles.statusRow}>
                        <Text style={styles.label}>Usuários Online:</Text>
                        <Text style={styles.value}>{stats.online_users}</Text>
                    </View>
                    <View style={styles.statusRow}>
                        <Text style={styles.label}>Usuários Offline:</Text>
                        <Text style={styles.value}>{stats.offline_users}</Text>
                    </View>
                    <View style={styles.statusRow}>
                        <Text style={styles.label}>Total:</Text>
                        <Text style={styles.value}>{stats.total_users}</Text>
                    </View>
                    <View style={styles.statusRow}>
                        <Text style={styles.label}>Fonte:</Text>
                        <Text style={styles.value}>{stats.source}</Text>
                    </View>
                </View>
            )}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
        padding: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        paddingVertical: 10,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginLeft: 10,
        color: '#333',
    },
    section: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#333',
    },
    statusRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 4,
    },
    label: {
        fontSize: 14,
        color: '#666',
        fontWeight: '500',
    },
    value: {
        fontSize: 14,
        color: '#333',
        fontWeight: '600',
        textAlign: 'right',
        flex: 1,
        marginLeft: 10,
    },
    error: {
        color: colors.RED,
        fontSize: 12,
        marginTop: 8,
        fontStyle: 'italic',
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 12,
        gap: 8,
    },
    button: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButton: {
        backgroundColor: colors.SKY,
    },
    secondaryButton: {
        backgroundColor: colors.GRAY,
    },
    successButton: {
        backgroundColor: colors.GREEN,
    },
    dangerButton: {
        backgroundColor: colors.RED,
    },
    buttonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
    statusButtons: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginTop: 12,
        gap: 8,
    },
    smallButton: {
        flex: 1,
        minWidth: '45%',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: 'center',
    },
    infoButton: {
        backgroundColor: colors.SKY,
    },
    warningButton: {
        backgroundColor: colors.ORANGE,
    },
    smallButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '600',
    },
    driverItem: {
        backgroundColor: '#f8f9fa',
        padding: 12,
        borderRadius: 8,
        marginBottom: 8,
    },
    driverText: {
        fontSize: 12,
        color: '#666',
        marginBottom: 2,
    },
}); 
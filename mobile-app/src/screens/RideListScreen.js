import Logger from '../utils/Logger';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    StatusBar,
    Dimensions,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import moment from 'moment';
import 'moment/locale/pt-br';
import BookingHistoryService from '../services/BookingHistoryService';


const { width, height } = Dimensions.get('window');

export default function RideListScreen({ navigation, route }) {
    const auth = useSelector(state => state.auth);
    const bookings = useSelector(state => state.bookinglistdata.bookings) || [];
    const settings = useSelector(state => state.settingsdata.settings) || {};
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState(0); // 0: Ativas, 1: Concluídas, 2: Canceladas
    const [bookingsFromAPI, setBookingsFromAPI] = useState([]);
    const hasLoadedRef = useRef(false);

    // Determinar tipo de usuário (usando useMemo para estabilizar)
    const userType = useMemo(() => {
        return auth?.profile?.usertype || auth?.profile?.userType;
    }, [auth?.profile?.usertype, auth?.profile?.userType]);
    
    const isDriver = useMemo(() => userType === 'driver', [userType]);
    
    const userId = useMemo(() => {
        return auth?.uid || auth?.profile?.uid;
    }, [auth?.uid, auth?.profile?.uid]);

    // Carregar histórico do backend (apenas uma vez quando userId/userType mudarem)
    useEffect(() => {
        if (!userId || !userType) return;
        
        // Evitar múltiplas chamadas
        if (hasLoadedRef.current) return;
        
        const loadBookingHistory = async () => {
            try {
                setIsLoading(true);
                hasLoadedRef.current = true;
                
                const result = await BookingHistoryService.getBookingHistory(
                    userId,
                    isDriver ? 'DRIVER' : 'CUSTOMER',
                    { first: 100 }
                );

                if (result.success) {
                    setBookingsFromAPI(result.bookings || []);
                }
            } catch (error) {
                Logger.error('❌ Erro ao buscar histórico de corridas:', error);
                hasLoadedRef.current = false; // Permitir retry em caso de erro
            } finally {
                setIsLoading(false);
            }
        };
        
        loadBookingHistory();
    }, [userId, userType, isDriver]);

    // Filtrar corridas baseado na aba ativa (usando useMemo para evitar re-renders)
    const filteredBookings = useMemo(() => {
        // Usar bookings da API se disponível, senão usar do Redux
        const allBookings = bookingsFromAPI.length > 0 ? bookingsFromAPI : bookings;
        let filtered = [];
        
        switch (activeTab) {
            case 0: // Ativas
                filtered = allBookings.filter(item => 
                    item.status !== 'COMPLETE' && 
                    item.status !== 'CANCELLED' && 
                    item.status !== 'PAID'
                );
                break;
            case 1: // Concluídas
                filtered = allBookings.filter(item => 
                    item.status === 'COMPLETE' || 
                    item.status === 'PAID'
                );
                break;
            case 2: // Canceladas
                filtered = allBookings.filter(item => item.status === 'CANCELLED');
                break;
            default:
                filtered = allBookings;
        }
        
        // Ordenar por data (mais recente primeiro)
        filtered.sort((a, b) => {
            const dateA = a.startTime ? new Date(a.startTime) : (a.tripdate ? new Date(a.tripdate) : new Date(0));
            const dateB = b.startTime ? new Date(b.startTime) : (b.tripdate ? new Date(b.tripdate) : new Date(0));
            return dateB - dateA;
        });
        
        return filtered;
    }, [bookings, bookingsFromAPI, activeTab]);

    const onRefresh = async () => {
        if (!userId || !userType) return;
        
        setIsRefreshing(true);
        hasLoadedRef.current = false; // Permitir recarregar
        
        try {
            const result = await BookingHistoryService.getBookingHistory(
                userId,
                isDriver ? 'DRIVER' : 'CUSTOMER',
                { first: 100 }
            );

            if (result.success) {
                setBookingsFromAPI(result.bookings || []);
            }
            hasLoadedRef.current = true;
        } catch (error) {
            Logger.error('❌ Erro ao buscar histórico de corridas:', error);
            hasLoadedRef.current = false;
        } finally {
            setIsRefreshing(false);
        }
    };

    // Header
    const Header = () => (
        <View style={[styles.header, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity 
                style={[
                    styles.headerButton, 
                    { 
                        backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8',
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#404040' : '#d0d0d0',
                    }
                ]}
                onPress={() => navigation.goBack()}
                activeOpacity={0.7}
            >
                <Ionicons 
                    name="arrow-back" 
                    color={isDarkMode ? '#fff' : '#1a1a1a'} 
                    size={22} 
                />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                Histórico de Viagens
            </Text>
            <View style={styles.headerRightContainer} />
        </View>
    );

    // Tabs
    const Tabs = () => (
        <View style={[styles.tabsContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <TouchableOpacity
                style={[
                    styles.tab,
                    activeTab === 0 && styles.tabActive,
                    { backgroundColor: activeTab === 0 ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setActiveTab(0)}
            >
                <Text style={[
                    styles.tabText,
                    { color: activeTab === 0 ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    Ativas
                </Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[
                    styles.tab,
                    activeTab === 1 && styles.tabActive,
                    { backgroundColor: activeTab === 1 ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setActiveTab(1)}
            >
                <Text style={[
                    styles.tabText,
                    { color: activeTab === 1 ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    Concluídas
                </Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[
                    styles.tab,
                    activeTab === 2 && styles.tabActive,
                    { backgroundColor: activeTab === 2 ? MAIN_COLOR : 'transparent' }
                ]}
                onPress={() => setActiveTab(2)}
            >
                <Text style={[
                    styles.tabText,
                    { color: activeTab === 2 ? '#fff' : (isDarkMode ? '#ccc' : colors.GRAY) }
                ]}>
                    Canceladas
                </Text>
            </TouchableOpacity>
        </View>
    );

    // Formatar status
    const formatStatus = (status) => {
        const statusMap = {
            'NEW': 'Nova',
            'ACCEPTED': 'Aceita',
            'ARRIVED': 'Chegou',
            'STARTED': 'Em andamento',
            'COMPLETE': 'Concluída',
            'CANCELLED': 'Cancelada',
            'PAYMENT_PENDING': 'Aguardando pagamento',
            'PAID': 'Paga'
        };
        return statusMap[status] || status;
    };

    // Formatar valor
    const formatPrice = (item) => {
        const symbol = settings.symbol || 'R$';
        const decimal = settings.decimal || 2;
        const value = item.trip_cost || item.estimate || 0;
        return `${symbol} ${parseFloat(value).toFixed(decimal)}`;
    };

    // Formatar data/hora
    const formatDateTime = (dateString) => {
        if (!dateString) return 'Data não disponível';
        const date = moment(dateString);
        return {
            date: date.format('DD/MM/YYYY'),
            time: date.format('HH:mm'),
            full: date.format('DD/MM/YYYY [às] HH:mm')
        };
    };

    // Card de viagem
    const RideCard = ({ item, index }) => {
        const dateTime = formatDateTime(item.startTime);
        const statusColor = item.status === 'COMPLETE' || item.status === 'PAID' 
            ? '#4CAF50' 
            : item.status === 'CANCELLED' 
            ? '#FF3B30' 
            : MAIN_COLOR;

        return (
            <TouchableOpacity
                style={[styles.rideCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}
                onPress={() => {
                    if (item.trip_cost > 0 || item.estimate > 0) {
                        navigation.navigate('RideDetails', { data: item });
                    }
                }}
                activeOpacity={0.7}
            >
                {/* Header do card */}
                <View style={styles.rideCardHeader}>
                    <View style={styles.rideCardHeaderLeft}>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                            <Text style={[styles.statusText, { color: statusColor }]}>
                                {formatStatus(item.status)}
                            </Text>
                        </View>
                    </View>
                    <Text style={[styles.rideDate, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        {dateTime.date}
                    </Text>
                </View>

                {/* Localização */}
                <View style={styles.locationsContainer}>
                    <View style={styles.locationRow}>
                        <View style={[styles.locationDot, { backgroundColor: '#4CAF50' }]} />
                        <Text 
                            style={[styles.locationText, { color: isDarkMode ? '#fff' : colors.BLACK }]}
                            numberOfLines={1}
                        >
                            {item.pickup?.add || item.pickupAddress || 'Origem não informada'}
                        </Text>
                    </View>
                    <View style={styles.locationRow}>
                        <View style={[styles.locationDot, { backgroundColor: '#FF9800' }]} />
                        <Text 
                            style={[styles.locationText, { color: isDarkMode ? '#fff' : colors.BLACK }]}
                            numberOfLines={1}
                        >
                            {item.drop?.add || item.dropAddress || 'Destino não informado'}
                        </Text>
                    </View>
                </View>

                {/* Footer do card */}
                <View style={styles.rideCardFooter}>
                    <View style={styles.rideCardFooterLeft}>
                        <Ionicons name="time-outline" size={16} color={isDarkMode ? '#999' : colors.GRAY} />
                        <Text style={[styles.rideTime, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            {dateTime.time}
                        </Text>
                    </View>
                    {(item.trip_cost || item.estimate) && (
                        <View style={styles.rideCardFooterRight}>
                            <Text style={[styles.ridePrice, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {formatPrice(item)}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Ações */}
                {(item.status === 'PAYMENT_PENDING' || item.status === 'NEW' || item.status === 'ACCEPTED') && (
                    <View style={styles.rideActions}>
                        {item.status === 'PAYMENT_PENDING' && (
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: MAIN_COLOR }]}
                                onPress={() => navigation.navigate('PaymentDetails', { booking: item })}
                            >
                                <Text style={styles.actionButtonText}>Pagar</Text>
                            </TouchableOpacity>
                        )}
                        {(['NEW', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(item.status)) && (
                            <TouchableOpacity
                                style={[styles.actionButton, styles.actionButtonSecondary]}
                                onPress={() => navigation.navigate('BookedCab', { bookingId: item.id })}
                            >
                                <Text style={[styles.actionButtonText, { color: MAIN_COLOR }]}>Ver detalhes</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Botão de Recibo para corridas concluídas */}
                {(item.status === 'COMPLETE' || item.status === 'COMPLETED' || item.status === 'PAID') && (
                    <View style={styles.rideActions}>
                        <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: '#4CAF50' }]}
                            onPress={() => navigation.navigate('Receipt', { rideId: item.id || item.bookingId })}
                        >
                            <Ionicons name="receipt-outline" size={16} color="white" style={{ marginRight: 5 }} />
                            <Text style={styles.actionButtonText}>Ver Recibo</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    // Lista vazia
    const EmptyList = () => (
        <View style={styles.emptyContainer}>
            <Ionicons 
                name="document-text-outline" 
                size={64} 
                color={isDarkMode ? '#666' : colors.GRAY} 
            />
            <Text style={[styles.emptyText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                {activeTab === 0 && 'Nenhuma viagem ativa'}
                {activeTab === 1 && 'Nenhuma viagem concluída'}
                {activeTab === 2 && 'Nenhuma viagem cancelada'}
            </Text>
            <Text style={[styles.emptySubtext, { color: isDarkMode ? '#666' : colors.GRAY }]}>
                Suas viagens aparecerão aqui
            </Text>
        </View>
    );


    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            <Header />
            <Tabs />

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={onRefresh}
                        tintColor={MAIN_COLOR}
                    />
                }
            >
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={MAIN_COLOR} />
                    </View>
                ) : filteredBookings.length === 0 ? (
                    <EmptyList />
                ) : (
                    <View style={styles.ridesList}>
                        {filteredBookings.map((item, index) => (
                            <RideCard key={item.id || index} item={item} index={index} />
                        ))}
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 45,
        paddingBottom: 16,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    headerRightContainer: {
        width: 40,
    },
    tabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: '#f0f0f0',
        gap: 8,
    },
    tab: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tabActive: {
        // backgroundColor já definido inline
    },
    tabText: {
        fontSize: 14,
        fontFamily: fonts.Bold,
    },
    content: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    ridesList: {
        padding: 16,
        gap: 12,
    },
    rideCard: {
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    rideCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    rideCardHeaderLeft: {
        flex: 1,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    statusText: {
        fontSize: 12,
        fontFamily: fonts.Bold,
    },
    rideDate: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    locationsContainer: {
        marginBottom: 12,
        gap: 8,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    locationDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    locationText: {
        flex: 1,
        fontSize: 15,
        fontFamily: fonts.Regular,
    },
    rideCardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTopWidth: 0.5,
        borderTopColor: '#f0f0f0',
    },
    rideCardFooterLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    rideTime: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    rideCardFooterRight: {
        // Alinhado à direita
    },
    ridePrice: {
        fontSize: 18,
        fontFamily: fonts.Bold,
    },
    rideActions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 0.5,
        borderTopColor: '#f0f0f0',
    },
    actionButton: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionButtonSecondary: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: MAIN_COLOR,
    },
    actionButtonText: {
        color: '#fff',
        fontSize: 14,
        fontFamily: fonts.Bold,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 60,
        paddingHorizontal: 40,
    },
    emptyText: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginTop: 16,
        textAlign: 'center',
    },
    emptySubtext: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginTop: 8,
        textAlign: 'center',
    },
});

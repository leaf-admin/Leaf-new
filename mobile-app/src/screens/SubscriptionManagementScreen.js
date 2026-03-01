import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    StatusBar,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import { api } from '../common-local';
import PromotionService from '../services/PromotionService';


export default function SubscriptionManagementScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setIsRefreshing] = useState(false);
    const [activePromotions, setActivePromotions] = useState([]);
    
    const [subscriptionData, setSubscriptionData] = useState({
        planType: null, // 'plus' ou 'elite'
        planName: null, // 'Leaf Plus' ou 'Leaf Elite'
        status: null, // 'active', 'pending', 'overdue', 'suspended'
        weeklyFee: 0,
        daysRemaining: 0,
        nextPayment: null,
        paymentHistory: [],
        promotionFreeUntil: null // Data até quando está grátis por promoção
    });

    useEffect(() => {
        loadSubscriptionData();
        checkPromotions();
    }, []);

    const loadSubscriptionData = async () => {
        try {
            setIsLoading(true);
            const driverId = auth?.uid || auth?.profile?.uid;
            
            if (!driverId) {
                Logger.warn('⚠️ Driver ID não encontrado');
                return;
            }

            // Buscar dados da assinatura
            // Usar dados do perfil do usuário
            const carType = auth?.profile?.carType || '';
            const isElite = carType === 'Leaf Elite' || carType?.toLowerCase().includes('elite');
            const isPlus = carType === 'Leaf Plus' || carType?.toLowerCase().includes('plus');
            
            let planType = null;
            let planName = null;
            let weeklyFee = 0;
            
            if (isElite) {
                planType = 'elite';
                planName = 'Leaf Elite';
                weeklyFee = 99.90;
            } else if (isPlus) {
                planType = 'plus';
                planName = 'Leaf Plus';
                weeklyFee = 49.90;
            }

            // Calcular dias grátis restantes (considerando todos os tipos)
            const freeTrialEnd = auth?.profile?.free_trial_end;
            const freeMonthsEnd = auth?.profile?.free_months_end;
            const promotionFreeEnd = auth?.profile?.promotion_free_end;
            
            const now = new Date();
            let daysRemaining = 0;
            let latestFreeEnd = null;
            
            // Verificar qual período grátis é o mais recente
            const freeEnds = [];
            if (freeTrialEnd) freeEnds.push(new Date(freeTrialEnd));
            if (freeMonthsEnd) freeEnds.push(new Date(freeMonthsEnd));
            if (promotionFreeEnd) freeEnds.push(new Date(promotionFreeEnd));
            
            if (freeEnds.length > 0) {
                // Pegar a data mais distante (maior benefício)
                latestFreeEnd = new Date(Math.max(...freeEnds.map(d => d.getTime())));
                const diffTime = latestFreeEnd - now;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                daysRemaining = Math.max(0, diffDays);
            }

            // Calcular próximo pagamento (2 dias após início da semana)
            const currentDay = now.getDay();
            const daysUntilMonday = currentDay === 0 ? 1 : (8 - currentDay) % 7;
            const nextMonday = new Date(now);
            nextMonday.setDate(now.getDate() + daysUntilMonday);
            nextMonday.setHours(0, 0, 0, 0);
            
            const nextPaymentDate = new Date(nextMonday);
            nextPaymentDate.setDate(nextMonday.getDate() + 2); // Quarta-feira (2 dias após segunda)

            // Status da assinatura
            const status = auth?.profile?.billing_status || 'active';

            setSubscriptionData({
                planType,
                planName,
                status,
                weeklyFee,
                daysRemaining,
                nextPayment: nextPaymentDate,
                paymentHistory: [], // Histórico será carregado quando disponível
                promotionFreeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null
            });

        } catch (error) {
            Logger.error('❌ Erro ao carregar dados da assinatura:', error);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    // Verificar promoções elegíveis
    const checkPromotions = async () => {
        try {
            const driverId = auth?.uid || auth?.profile?.uid;
            if (!driverId) {
                Logger.log('ℹ️ [Promotions] Usuário não autenticado, pulando verificação de promoções');
                return;
            }

            // Verificar e aplicar promoções elegíveis automaticamente
            // ✅ Tratar erro silenciosamente se a rota não existir
            try {
                const result = await PromotionService.checkEligiblePromotions(driverId);
                
                if (result.success && result.results && result.results.length > 0) {
                    Logger.log('✅ Promoções aplicadas:', result.results);
                    // Recarregar dados da assinatura para refletir novos benefícios
                    loadSubscriptionData();
                }
            } catch (promoError) {
                // ✅ Não é crítico se a rota de promoções não existir
                Logger.log('ℹ️ [Promotions] Rota de promoções não disponível:', promoError.message);
            }

            // Listar promoções ativas para exibição
            // ✅ Tratar erro silenciosamente se a rota não existir
            try {
                const promotionsResult = await PromotionService.listActivePromotions();
                if (promotionsResult.success) {
                    setActivePromotions(promotionsResult.promotions || []);
                }
            } catch (listError) {
                // ✅ Não é crítico se a rota de promoções não existir
                Logger.log('ℹ️ [Promotions] Rota de listagem não disponível:', listError.message);
                setActivePromotions([]); // Definir array vazio como fallback
            }

        } catch (error) {
            // ✅ Erro geral também não é crítico
            Logger.log('ℹ️ [Promotions] Erro ao verificar promoções (não crítico):', error.message);
        }
    };

    const onRefresh = () => {
        setIsRefreshing(true);
        loadSubscriptionData();
    };

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
                Gestão do Plano
            </Text>
            <View style={styles.headerRightContainer} />
        </View>
    );

    const formatDate = (date) => {
        if (!date) return 'N/A';
        return new Date(date).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'active':
                return '#003002';
            case 'pending':
                return '#FF9800';
            case 'overdue':
                return '#F44336';
            case 'suspended':
                return '#9E9E9E';
            default:
                return '#9E9E9E';
        }
    };

    const getStatusLabel = (status) => {
        switch (status) {
            case 'active':
                return 'Ativo';
            case 'pending':
                return 'Pendente';
            case 'overdue':
                return 'Em Atraso';
            case 'suspended':
                return 'Suspenso';
            default:
                return 'Desconhecido';
        }
    };

    if (isLoading && !refreshing) {
        return (
            <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                <Header />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={MAIN_COLOR} />
                    <Text style={[styles.loadingText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                        Carregando informações do plano...
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#f5f5f5' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            <Header />
            
            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[MAIN_COLOR]}
                    />
                }
            >
                {/* Card: Plano Assinado e Status */}
                <View style={[styles.card, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                    <View style={styles.cardHeader}>
                        <Ionicons name="card-outline" size={24} color={MAIN_COLOR} />
                        <Text style={[styles.cardTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            Plano Assinado
                        </Text>
                    </View>
                    
                    {subscriptionData.planName ? (
                        <>
                            <View style={styles.planInfoRow}>
                                <Text style={[styles.planLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Plano:
                                </Text>
                                <View style={[
                                    styles.planBadge,
                                    subscriptionData.planType === 'elite' 
                                        ? styles.planBadgeElite 
                                        : styles.planBadgePlus
                                ]}>
                                    <Text style={styles.planBadgeText}>
                                        {subscriptionData.planName}
                                    </Text>
                                </View>
                            </View>
                            
                            <View style={styles.planInfoRow}>
                                <Text style={[styles.planLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Valor Semanal:
                                </Text>
                                <Text style={[styles.planValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                    R$ {subscriptionData.weeklyFee.toFixed(2).replace('.', ',')}
                                </Text>
                            </View>
                            
                            <View style={styles.planInfoRow}>
                                <Text style={[styles.planLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Status:
                                </Text>
                                <View style={[styles.statusBadge, { backgroundColor: getStatusColor(subscriptionData.status) }]}>
                                    <Text style={styles.statusBadgeText}>
                                        {getStatusLabel(subscriptionData.status)}
                                    </Text>
                                </View>
                            </View>
                        </>
                    ) : (
                        <Text style={[styles.noPlanText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                            Nenhum plano ativo
                        </Text>
                    )}
                </View>

                {/* Card: Dias Grátis Restantes */}
                {subscriptionData.daysRemaining > 0 && (
                    <View style={[styles.card, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.cardHeader}>
                            <Ionicons name="gift-outline" size={24} color="#FF9800" />
                            <Text style={[styles.cardTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Dias Grátis Restantes
                            </Text>
                        </View>
                        <View style={styles.daysRemainingContainer}>
                            <Text style={styles.daysRemainingNumber}>
                                {subscriptionData.daysRemaining}
                            </Text>
                            <Text style={[styles.daysRemainingLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                {subscriptionData.daysRemaining === 1 ? 'dia' : 'dias'}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Card: Próximo Pagamento */}
                {subscriptionData.nextPayment && (
                    <View style={[styles.card, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                        <View style={styles.cardHeader}>
                            <Ionicons name="calendar-outline" size={24} color={MAIN_COLOR} />
                            <Text style={[styles.cardTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Próximo Pagamento
                            </Text>
                        </View>
                        <View style={styles.paymentInfoContainer}>
                            <Text style={[styles.paymentDate, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                {formatDate(subscriptionData.nextPayment)}
                            </Text>
                            <Text style={[styles.paymentAmount, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                R$ {subscriptionData.weeklyFee.toFixed(2).replace('.', ',')}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Card: Histórico de Pagamentos */}
                <View style={[styles.card, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                    <View style={styles.cardHeader}>
                        <Ionicons name="receipt-outline" size={24} color={MAIN_COLOR} />
                        <Text style={[styles.cardTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                            Histórico de Pagamentos
                        </Text>
                    </View>
                    
                    {subscriptionData.paymentHistory.length > 0 ? (
                        <View style={styles.paymentHistoryList}>
                            {subscriptionData.paymentHistory.map((payment, index) => (
                                <View 
                                    key={index} 
                                    style={[
                                        styles.paymentHistoryItem,
                                        { borderBottomColor: isDarkMode ? '#333' : '#f5f5f5' }
                                    ]}
                                >
                                    <View style={styles.paymentHistoryLeft}>
                                        <Ionicons
                                            name={payment.status === 'paid' ? 'checkmark-circle' : 'time-outline'}
                                            size={20}
                                            color={payment.status === 'paid' ? '#003002' : '#FF9800'}
                                        />
                                        <View style={styles.paymentHistoryDetails}>
                                            <Text style={[styles.paymentHistoryDate, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                                {formatDate(payment.date)}
                                            </Text>
                                            <Text style={[styles.paymentHistoryStatus, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                                {payment.status === 'paid' ? 'Pago' : 'Pendente'}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={[styles.paymentHistoryAmount, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        R$ {payment.amount.toFixed(2).replace('.', ',')}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <View style={styles.emptyHistory}>
                            <Ionicons name="receipt-outline" size={48} color={isDarkMode ? '#666' : colors.GRAY} />
                            <Text style={[styles.emptyHistoryText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                Nenhum pagamento registrado ainda
                            </Text>
                        </View>
                    )}
                </View>
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
    content: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    card: {
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    cardTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginLeft: 12,
    },
    planInfoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    planLabel: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    planValue: {
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    planBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    planBadgePlus: {
        backgroundColor: '#003002',
    },
    planBadgeElite: {
        backgroundColor: '#000000',
    },
    planBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    statusBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    noPlanText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        paddingVertical: 20,
    },
    daysRemainingContainer: {
        alignItems: 'center',
        paddingVertical: 20,
    },
    daysRemainingNumber: {
        fontSize: 48,
        fontFamily: fonts.Bold,
        color: '#FF9800',
        marginBottom: 8,
    },
    daysRemainingLabel: {
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    paymentInfoContainer: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    paymentDate: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        marginBottom: 8,
    },
    paymentAmount: {
        fontSize: 18,
        fontFamily: fonts.Regular,
    },
    paymentHistoryList: {
        marginTop: 8,
    },
    paymentHistoryItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    paymentHistoryLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    paymentHistoryDetails: {
        marginLeft: 12,
        flex: 1,
    },
    paymentHistoryDate: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginBottom: 4,
    },
    paymentHistoryStatus: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    paymentHistoryAmount: {
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    emptyHistory: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyHistoryText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginTop: 16,
        textAlign: 'center',
    },
});



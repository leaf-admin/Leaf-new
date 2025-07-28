import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    StatusBar,
    Dimensions,
    Image,
    Alert,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common/theme';
import { fonts } from '../common/font';
import ThemeSwitch from '../components/ThemeSwitch';

const MAIN_COLOR = colors.TAXIPRIMARY;
const { width, height } = Dimensions.get('window');

// Dados mockados para demonstração
const MOCK_DATA = {
    balance: 1245.00,
    rating: 4.8,
    tripsToday: 26,
    hoursOnline: 8.5,
    activeCar: {
        brand: 'Hyundai',
        model: 'Solaris',
        year: '2020',
        engine: '1.6'
    },
    dailyEarnings: [
        { day: '09', amount: 850, color: '#4CAF50' },
        { day: '10', amount: 650, color: '#FF5722' },
        { day: '11', amount: 920, color: '#4CAF50' },
        { day: '12', amount: 1100, color: '#4CAF50' },
        { day: '13', amount: 780, color: '#4CAF50' },
        { day: '14', amount: 950, color: '#4CAF50' },
        { day: '15', amount: 1200, color: '#4CAF50' },
        { day: '16', amount: 1050, color: '#4CAF50' },
        { day: '17', amount: 600, color: '#FF5722' },
        { day: '18', amount: 450, color: '#FF5722' },
        { day: '19', amount: 980, color: '#4CAF50' },
        { day: '20', amount: 1150, color: '#4CAF50' },
    ]
};

export default function EarningsReportScreen({ navigation }) {
    const dispatch = useDispatch();
    const isDarkMode = useSelector(state => state.settingsdata.isDarkMode);
    const auth = useSelector(state => state.auth);
    
    const [earningsData, setEarningsData] = useState(MOCK_DATA);
    const [activeCar, setActiveCar] = useState(MOCK_DATA.activeCar);
    const [hasActiveCar, setHasActiveCar] = useState(true);
    const [withdrawModalVisible, setWithdrawModalVisible] = useState(false);
    const [withdrawValue, setWithdrawValue] = useState('');
    const [pixKey, setPixKey] = useState('');
    const [withdrawError, setWithdrawError] = useState('');
    const saldoDisponivel = earningsData.balance || 0;

    // Função para formatar valor monetário com separador de milhares
    function formatCurrency(value) {
        if (typeof value !== 'number') value = parseFloat(value);
        return value.toFixed(2)
            .replace('.', ',')
            .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function handleWithdrawValueChange(val) {
        setWithdrawValue(val);
        if (parseFloat(val.replace(',', '.')) > saldoDisponivel) {
            setWithdrawError('valor excede o limite disponível');
        } else {
            setWithdrawError('');
        }
    }

    function handleConfirmWithdraw() {
        // Aqui você vai chamar a API/backend
        setWithdrawModalVisible(false);
        setWithdrawValue('');
        setPixKey('');
        setWithdrawError('');
        // Feedback de sucesso/erro pode ser adicionado aqui
    }

    // Remover a função ThemeSwitch local e usar o import no Header

    // Header igual ao da tela de perfil
    const Header = () => {
        const from = navigation?.route?.params?.from;
        return (
            <View style={styles.header}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                    onPress={() => {
                        if (from === 'map') {
                            navigation.navigate('DriverTrips');
                        } else {
                            navigation.goBack();
                        }
                    }}
                >
                    <Ionicons name="chevron-back" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Meus ganhos</Text>
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: isDarkMode ? '#333' : '#f8f8f8' }]}
                        onPress={() => navigation.navigate('Notifications')}
                    >
                        <Ionicons name="notifications" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                    </TouchableOpacity>
                    <ThemeSwitch value={isDarkMode} onValueChange={() => dispatch({ type: 'TOGGLE_DARK_MODE' })} />
                </View>
            </View>
        );
    };

    // Topo igual à tela de perfil
    const ProfileTop = () => (
        <View style={styles.profileSection}>
            <View style={styles.profileImageContainer}>
                <Image
                    source={auth?.profile?.profile_image ? { uri: auth.profile.profile_image } : require('../../assets/images/profilePic.png')}
                    style={styles.profileImage}
                />
            </View>
            <View style={styles.profileInfo}>
                <Text style={[styles.greeting, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Olá,</Text>
                <Text style={[styles.userName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{auth?.profile?.firstName || 'Usuário'} {auth?.profile?.lastName || ''}</Text>
            </View>
        </View>
    );

    // Ajustar estilos dos cards para altura e padding iguais ao exemplo
    const CARD_HEIGHT = 110;
    const GRAPH_HEIGHT = 80;
    const CARD_RADIUS = 18;
    const CARD_PADDING = 16;
    const CARD_SPACING = 12;

    // Card de saldo disponível refinado
    const BalanceCard = () => (
        <View style={{ backgroundColor: isDarkMode ? '#232323' : '#F6FFF0', height: CARD_HEIGHT, borderRadius: CARD_RADIUS, padding: CARD_PADDING, flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text style={{ color: isDarkMode ? '#b8e6b8' : '#1A330E', fontWeight: undefined, fontSize: 13, fontWeight: '500', marginBottom: 6 }}>Saldo disponível:</Text>
                <Text style={{ color: isDarkMode ? '#fff' : '#1A330E', fontWeight: 'bold', fontSize: 32, marginTop: 0 }} numberOfLines={1} ellipsizeMode="clip">R$ {formatCurrency(earningsData.balance)}</Text>
            </View>
            <TouchableOpacity style={[styles.cashOutButtonRefined, { height: 38, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' }]} onPress={() => setWithdrawModalVisible(true)}> 
                <Text style={styles.cashOutTextRefined}>sacar</Text>
                <Ionicons name="chevron-forward" size={16} color="#fff" style={{ marginLeft: 2 }} />
            </TouchableOpacity>
        </View>
    );

    // Modal de saque
    const WithdrawModal = () => (
        <Modal
            visible={withdrawModalVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setWithdrawModalVisible(false)}
        >
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>Saque</Text>
                    <Text style={styles.modalLabel}>Saldo disponível:</Text>
                    <Text style={styles.modalSaldo}>R$ {formatCurrency(saldoDisponivel)}</Text>
                    <Text style={styles.modalLabel}>Valor do saque</Text>
                    <TextInput
                        style={styles.modalInput}
                        placeholder="Digite o valor"
                        keyboardType="numeric"
                        value={withdrawValue}
                        onChangeText={handleWithdrawValueChange}
                    />
                    {withdrawError ? <Text style={styles.modalError}>{withdrawError}</Text> : null}
                    <Text style={styles.modalLabel}>Chave Pix</Text>
                    <TextInput
                        style={styles.modalInput}
                        placeholder="Informe sua chave Pix"
                        value={pixKey}
                        onChangeText={setPixKey}
                    />
                    <View style={styles.modalButtonRow}>
                        <TouchableOpacity style={styles.modalCancelButton} onPress={() => setWithdrawModalVisible(false)}>
                            <Text style={styles.modalCancelText}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.modalConfirmButton, { opacity: (!withdrawValue || !pixKey || !!withdrawError) ? 0.5 : 1 }]}
                            disabled={!withdrawValue || !pixKey || !!withdrawError}
                            onPress={handleConfirmWithdraw}
                        >
                            <Text style={styles.modalConfirmText}>Confirmar saque</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );

    // Card de estatística refinado
    const StatCard = ({ title, value, icon, color, subtitle, dark }) => (
        <View style={[
            styles.statCardGrid,
            dark ? styles.statCardDark : styles.statCardLight,
            { height: CARD_HEIGHT, borderRadius: CARD_RADIUS, padding: CARD_PADDING, justifyContent: 'center', marginBottom: 12 }
        ]}> 
            <View style={styles.statCardRow}>
                {icon && <Ionicons name={icon} size={20} color={dark ? '#fff' : '#1A330E'} style={{ marginRight: 8 }} />}
                <Text style={{ color: dark ? '#fff' : '#888', fontSize: 13, fontWeight: '500', marginBottom: 2 }}>{title}</Text>
            </View>
            <Text style={{ color: dark ? '#fff' : '#1A330E', fontSize: 28, fontWeight: 'bold', marginTop: 0 }}>{value}</Text>
            {subtitle && (
                <Text style={{ color: dark ? '#fff' : '#aaa', fontSize: 12 }}>{subtitle}</Text>
            )}
        </View>
    );

    // Card do carro ativo grid
    const CarCard = ({ dark }) => {
        if (!hasActiveCar) {
            return (
                <View style={[
                    styles.statCardGrid,
                    dark ? styles.statCardDark : styles.statCardLight,
                    { height: CARD_HEIGHT, borderRadius: CARD_RADIUS, padding: CARD_PADDING, justifyContent: 'center', marginBottom: 12 }
                ]}> 
                    <View style={styles.statCardRow}>
                        <Ionicons name="car" size={20} color={dark ? '#fff' : '#1A330E'} style={{ marginRight: 8, opacity: 0.3 }} />
                        <Text style={{ color: dark ? '#fff' : '#888', fontSize: 13, fontWeight: '500', marginBottom: 2 }}>Seu carro</Text>
                    </View>
                    <Ionicons name="lock-closed" size={20} color={dark ? '#fff' : '#bbb'} style={{ marginBottom: 4 }} />
                    <Text style={{ color: dark ? '#fff' : '#bbb', fontSize: 12 }}>Nenhum carro ativo</Text>
                </View>
            );
        }
        return (
            <View style={[
                styles.statCardGrid,
                dark ? styles.statCardDark : styles.statCardLight,
                { height: CARD_HEIGHT, borderRadius: CARD_RADIUS, padding: CARD_PADDING, justifyContent: 'center', marginBottom: 12 }
            ]}> 
                <View style={styles.statCardRow}>
                    <Ionicons name="car" size={20} color={dark ? '#fff' : '#1A330E'} style={{ marginRight: 8 }} />
                    <Text style={{ color: dark ? '#fff' : '#888', fontSize: 13, fontWeight: '500', marginBottom: 2 }}>Seu carro</Text>
                </View>
                <Text style={{ color: dark ? '#fff' : '#1A330E', fontSize: 22, fontWeight: 'bold', marginTop: 0 }}>{activeCar.brand} {activeCar.model}</Text>
                <Text style={{ color: dark ? '#fff' : '#aaa', fontSize: 12 }}>{activeCar.engine}, {activeCar.year}</Text>
            </View>
        );
    };

    // Gráfico de ganhos diários: verde claro, barra selecionada verde escuro, valor no topo ao clicar
    const DailyEarningsChart = () => {
        const data = earningsData.dailyEarnings.slice(-7);
        const [selectedIdx, setSelectedIdx] = useState(null);
        const maxPeriod = Math.max(...data.map(item => item.amount), 1);
        const highlightValue = selectedIdx !== null ? data[selectedIdx].amount : null;
        // Cores fixas
        const BAR_COLOR = '#A5D6A7';
        const BAR_COLOR_SELECTED = '#388E3C';
        function formatCurrency(val) {
            return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        const weekDays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
        function getWeekDayInitial(dateStr, idx) {
            return weekDays[(idx + 1) % 7];
        }
        return (
            <View style={[styles.chartCard, { backgroundColor: isDarkMode ? '#181818' : '#fff', marginBottom: 12, marginTop: 0, minHeight: CARD_HEIGHT, maxHeight: CARD_HEIGHT, height: CARD_HEIGHT, borderRadius: CARD_RADIUS, padding: CARD_PADDING, justifyContent: 'center' }]}> 
                {/* Espaço reservado para o valor selecionado */}
                <View style={{ alignItems: 'center', minHeight: 22, marginBottom: 4, justifyContent: 'center' }}>
                    {selectedIdx !== null && (
                        <Text style={{ fontWeight: 'bold', fontSize: 16, color: isDarkMode ? '#fff' : '#222' }}>R$ {formatCurrency(highlightValue)}</Text>
                    )}
                </View>
                <View style={styles.chartContainerGrid}>
                    <View style={[styles.barsContainerGrid, { marginTop: 8, height: 56, alignItems: 'flex-end' }]}> 
                        {data.map((item, index) => {
                            const barHeight = (item.amount / maxPeriod) * 48;
                            const selected = index === selectedIdx;
                            return (
                                <TouchableOpacity
                                    key={index}
                                    style={styles.barColumnGrid}
                                    activeOpacity={0.7}
                                    onPress={() => setSelectedIdx(index)}
                                >
                                    <View style={{ alignItems: 'center' }}>
                                        <View 
                                            style={[
                                                styles.barGrid, 
                                                { 
                                                    height: barHeight,
                                                    backgroundColor: selected ? BAR_COLOR_SELECTED : BAR_COLOR,
                                                    marginBottom: 4,
                                                    borderRadius: 8,
                                                    width: selected ? 22 : 18,
                                                    opacity: selected ? 1 : 0.85,
                                                }
                                            ]} 
                                        />
                                        <Text style={{ fontSize: 12, color: isDarkMode ? '#fff' : '#222', fontFamily: fonts.Medium, marginBottom: 0 }}>{item.day}</Text>
                                        <Text style={{ fontSize: 12, color: isDarkMode ? '#ccc' : '#888', fontFamily: fonts.Medium, marginTop: 0 }}>{getWeekDayInitial(item.day, index)}</Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#000' : '#f5f5f5' }]}> 
            <StatusBar 
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                backgroundColor={isDarkMode ? '#000' : '#fff'}
            />
            <Header />
            <ScrollView 
                style={styles.scrollView}
                showsVerticalScrollIndicator={false}
            >
                {/* Topo igual à tela de perfil */}
                <ProfileTop />
                {/* Card de Saldo */}
                <BalanceCard />
                {/* Gráfico de ganhos por dia */}
                <DailyEarningsChart />
                {/* Grid de Cards Inferiores */}
                <View style={styles.statsGridGrid}>
                    <View style={styles.statsRowGrid}>
                        <StatCard 
                            title="Nota" 
                            value={earningsData.rating} 
                            icon="star"
                            dark={true}
                        />
                        <StatCard 
                            title="Viagens hoje" 
                            value={earningsData.tripsToday} 
                            icon="car-sport"
                            dark={false}
                        />
                    </View>
                    <View style={styles.statsRowGrid}>
                        <CarCard dark={false} />
                        <StatCard 
                            title="Horas online" 
                            value={`${earningsData.hoursOnline}h`} 
                            icon="time"
                            dark={true}
                        />
                    </View>
                </View>
            </ScrollView>
            <WithdrawModal />
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
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: colors.BLACK,
        fontFamily: fonts.Bold,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    themeSwitchTouchable: {
        width: 72,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    themeSwitchTrack: {
        width: 72,
        height: 40,
        borderRadius: 20,
        borderWidth: 1.5,
        flexDirection: 'row',
        alignItems: 'center',
        position: 'relative',
        justifyContent: 'space-between',
        paddingHorizontal: 6,
        backgroundColor: '#fff',
        borderColor: '#ddd',
    },
    themeSwitchIconBubble: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#111',
    },
    scrollView: {
        flex: 1,
        paddingHorizontal: 20,
    },
    profileSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
        paddingTop: 20,
    },
    profileImageContainer: {
        width: 60,
        height: 60,
        borderRadius: 30,
        overflow: 'hidden',
        marginRight: 15,
    },
    profileImage: {
        width: '100%',
        height: '100%',
    },
    profileInfo: {
        flex: 1,
    },
    greeting: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    userName: {
        fontSize: 18,
        fontFamily: fonts.Bold,
    },
    balanceCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderRadius: 16,
        marginTop: 20,
        marginBottom: 20,
    },
    balanceLeft: {
        flex: 1,
    },
    balanceLabel: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    balanceAmount: {
        fontSize: 28,
        fontFamily: fonts.Bold,
    },
    cashOutButton: {
        backgroundColor: '#000',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    cashOutText: {
        color: '#fff',
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    statCard: {
        width: (width - 60) / 2,
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        alignItems: 'center',
    },
    statTitle: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginBottom: 8,
        textAlign: 'center',
    },
    statIcon: {
        marginBottom: 8,
    },
    carIcon: {
        marginBottom: 8,
    },
    statValue: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        marginBottom: 4,
    },
    statSubtitle: {
        fontSize: 11,
        fontFamily: fonts.Regular,
        textAlign: 'center',
    },
    carLockContainer: {
        position: 'relative',
        marginBottom: 8,
    },
    carSilhouette: {
        opacity: 0.3,
    },
    lockOverlay: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(255,255,255,0.8)',
        borderRadius: 12,
        padding: 4,
    },
    chartCard: {
        padding: 20,
        borderRadius: 16,
        marginBottom: 20,
    },
    chartTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 20,
    },
    chartContainer: {
        flexDirection: 'row',
        height: 160,
    },
    yAxis: {
        width: 60,
        justifyContent: 'space-between',
        paddingRight: 10,
    },
    yLabel: {
        fontSize: 15, // aumentado
        fontFamily: fonts.Medium,
    },
    barsContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        paddingBottom: 20,
    },
    barColumn: {
        flex: 1,
        alignItems: 'center',
        marginHorizontal: 2,
    },
    bar: {
        width: 20,
        borderRadius: 10,
        marginBottom: 8,
    },
    xLabel: {
        fontSize: 15, // aumentado
        fontFamily: fonts.Medium,
        marginTop: 2,
    },
    // Novo estilo refinado para o card de saldo
    balanceCardRefined: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 24,
        paddingHorizontal: 20,
        borderRadius: 18,
        marginTop: 20,
        marginBottom: 20,
        minHeight: 90,
        shadowColor: 'transparent',
    },
    balanceLabelRefined: {
        fontSize: 13,
        fontFamily: fonts.Medium,
        marginBottom: 6,
        letterSpacing: 0.2,
    },
    balanceAmountRefined: {
        fontSize: 34,
        fontFamily: fonts.Bold,
        letterSpacing: -1,
    },
    cashOutButtonRefined: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1A330E',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
        marginLeft: 16,
        shadowColor: 'transparent',
    },
    cashOutTextRefined: {
        color: '#fff',
        fontSize: 15,
        fontFamily: fonts.Medium,
        marginRight: 2,
    },
    // Novo estilo refinado para os cards inferiores
    statCardRefined: {
        flex: 1,
        minWidth: (width - 60) / 2,
        margin: 6,
        borderRadius: 16,
        paddingVertical: 22,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
        shadowColor: 'transparent',
    },
    statLabelRefined: {
        fontSize: 13,
        fontFamily: fonts.Medium,
        marginBottom: 6,
        letterSpacing: 0.1,
    },
    statValueRefined: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        marginBottom: 2,
        letterSpacing: -0.5,
    },
    statSubtitleRefined: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 2,
        textAlign: 'center',
    },
    carLockContainerRefined: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
    },
    lockOverlayRefined: {
        position: 'absolute',
        right: -10,
        top: 0,
    },
    // Grid cards estilo referência
    statsGridGrid: {
        marginBottom: 12,
        marginTop: 0,
    },
    statsRowGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    statCardGrid: {
        flex: 1,
        borderRadius: 18,
        paddingVertical: 22,
        paddingHorizontal: 18,
        marginHorizontal: 4,
        alignItems: 'flex-start',
        justifyContent: 'center',
        minHeight: 90,
    },
    statCardDark: {
        backgroundColor: '#181818',
    },
    statCardLight: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#f0f0f0',
    },
    statCardRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    statLabelGrid: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        letterSpacing: 0.1,
    },
    statValueGrid: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        marginBottom: 2,
        letterSpacing: -0.5,
    },
    statSubtitleGrid: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 2,
        textAlign: 'left',
    },
    // Gráfico espaçado para 7 dias
    chartContainerGrid: {
        flexDirection: 'row',
        height: 140,
        alignItems: 'flex-end',
        paddingBottom: 18, // aumentado
    },
    yAxisGrid: {
        width: 60,
        justifyContent: 'space-between',
        paddingRight: 8,
        height: 100,
    },
    yTickRow: {
        flex: 1,
        justifyContent: 'center',
    },
    plotAreaGrid: {
        flex: 1,
        height: 100,
        position: 'relative',
        justifyContent: 'flex-end',
    },
    gridLine: {
        position: 'absolute',
        left: 0,
        right: 0,
        borderTopWidth: 1,
        borderColor: '#e0e0e0',
        zIndex: 0,
    },
    barsContainerGrid: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        paddingBottom: 12, // diminui padding inferior
        paddingLeft: 2,
        paddingRight: 2,
    },
    barColumnGrid: {
        alignItems: 'center',
        marginHorizontal: 8,
    },
    barGrid: {
        width: 18,
        borderRadius: 8,
        marginBottom: 6,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: '90%',
        backgroundColor: '#fff',
        borderRadius: 18,
        padding: 24,
        alignItems: 'stretch',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 16,
        textAlign: 'center',
    },
    modalLabel: {
        fontSize: 13,
        color: '#888',
        marginTop: 10,
        marginBottom: 2,
    },
    modalSaldo: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1A330E',
        marginBottom: 8,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        padding: 10,
        fontSize: 16,
        marginBottom: 4,
        backgroundColor: '#f8f8f8',
    },
    modalError: {
        color: '#D32F2F',
        fontSize: 13,
        marginBottom: 4,
    },
    modalButtonRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 18,
    },
    modalCancelButton: {
        flex: 1,
        marginRight: 8,
        backgroundColor: '#eee',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
    },
    modalCancelText: {
        color: '#333',
        fontWeight: 'bold',
    },
    modalConfirmButton: {
        flex: 2,
        backgroundColor: '#1A330E',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
    },
    modalConfirmText: {
        color: '#fff',
        fontWeight: 'bold',
    },
}); 
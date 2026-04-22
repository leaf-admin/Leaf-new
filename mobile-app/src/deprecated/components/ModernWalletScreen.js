import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Dimensions,
    Platform,
    StatusBar,
    Animated,
    ScrollView,
    FlatList
} from 'react-native';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { fonts } from '../common/font';

const { width, height } = Dimensions.get('window');

const ModernWalletScreen = ({ navigation, route }) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState('week');
    const [balance, setBalance] = useState(1250.75);
    const [loading, setLoading] = useState(false);

    // Animações
    const [fadeAnim] = useState(new Animated.Value(0));
    const [slideAnim] = useState(new Animated.Value(30));
    const [scaleAnim] = useState(new Animated.Value(1));
    const [balanceAnim] = useState(new Animated.Value(0));

    const currentTheme = isDarkMode ? darkTheme : lightTheme;

    // Dados mockados
    const transactions = [
        {
            id: '1',
            type: 'credit',
            amount: 45.50,
            description: 'Viagem - Shopping Center',
            date: 'Hoje, 14:30',
            icon: 'car'
        },
        {
            id: '2',
            type: 'debit',
            amount: 100.00,
            description: 'Adicionado via PIX',
            date: 'Ontem, 16:45',
            icon: 'plus-circle'
        },
        {
            id: '3',
            type: 'credit',
            amount: 32.80,
            description: 'Viagem - Aeroporto',
            date: '23/01, 09:15',
            icon: 'car'
        },
        {
            id: '4',
            type: 'debit',
            amount: 50.00,
            description: 'Adicionado via cartão',
            date: '22/01, 20:30',
            icon: 'credit-card'
        }
    ];

    const periods = [
        { key: 'week', label: '7 dias' },
        { key: 'month', label: '30 dias' },
        { key: 'year', label: '1 ano' }
    ];

    useEffect(() => {
        // Animação de entrada
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.timing(slideAnim, {
                toValue: 0,
                duration: 600,
                useNativeDriver: true,
            }),
            Animated.timing(balanceAnim, {
                toValue: balance,
                duration: 1500,
                useNativeDriver: false,
            })
        ]).start();
    }, []);

    const handlePress = () => {
        Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 0.95,
                duration: 100,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
            })
        ]).start();
    };

    const renderHeader = () => {
        return (
            <Animated.View
                style={[
                    styles.header,
                    {
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateY: fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [-30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                <LinearGradient
                    colors={isDarkMode ? ['#2d2d2d', '#1a1a1a'] : ['#4CAF50', '#2E7D32']}
                    style={styles.headerGradient}
                >
                    <View style={styles.headerTop}>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => navigation.goBack()}
                        >
                            <MaterialCommunityIcons
                                name="arrow-left"
                                size={24}
                                color="#fff"
                            />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Carteira</Text>
                        <TouchableOpacity
                            style={styles.settingsButton}
                            onPress={() => navigation.navigate('Settings')}
                        >
                            <MaterialCommunityIcons
                                name="cog"
                                size={24}
                                color="#fff"
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.balanceContainer}>
                        <Text style={styles.balanceLabel}>Saldo Disponível</Text>
                        <Animated.Text style={styles.balanceAmount}>
                            R$ {balanceAnim.interpolate({
                                inputRange: [0, balance],
                                outputRange: ['0.00', balance.toFixed(2)]
                            })}
                        </Animated.Text>
                    </View>

                    <View style={styles.actionButtons}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => {
                                handlePress();
                                navigation.navigate('AddMoney');
                            }}
                        >
                            <MaterialCommunityIcons
                                name="plus"
                                size={24}
                                color="#fff"
                            />
                            <Text style={styles.actionButtonText}>Adicionar</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => {
                                handlePress();
                                navigation.navigate('WithdrawMoney');
                            }}
                        >
                            <MaterialCommunityIcons
                                name="bank-transfer-out"
                                size={24}
                                color="#fff"
                            />
                            <Text style={styles.actionButtonText}>Sacar</Text>
                        </TouchableOpacity>
                    </View>
                </LinearGradient>
            </Animated.View>
        );
    };

    const renderPeriodSelector = () => {
        return (
            <Animated.View
                style={[
                    styles.periodSelector,
                    {
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateY: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                <Text style={[
                    styles.sectionTitle,
                    { color: currentTheme.text }
                ]}>
                    Histórico
                </Text>
                <View style={[
                    styles.periodButtons,
                    { backgroundColor: currentTheme.card }
                ]}>
                    {periods.map((period) => (
                        <TouchableOpacity
                            key={period.key}
                            style={[
                                styles.periodButton,
                                selectedPeriod === period.key && styles.periodButtonActive
                            ]}
                            onPress={() => setSelectedPeriod(period.key)}
                        >
                            <Text style={[
                                styles.periodButtonText,
                                selectedPeriod === period.key && styles.periodButtonTextActive
                            ]}>
                                {period.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </Animated.View>
        );
    };

    const renderTransaction = ({ item, index }) => {
        const isCredit = item.type === 'credit';
        
        return (
            <Animated.View
                style={[
                    styles.transactionCard,
                    {
                        backgroundColor: currentTheme.card,
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateX: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [50, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                <View style={styles.transactionLeft}>
                    <View style={[
                        styles.transactionIcon,
                        { 
                            backgroundColor: isCredit 
                                ? 'rgba(76, 175, 80, 0.1)' 
                                : 'rgba(33, 150, 243, 0.1)' 
                        }
                    ]}>
                        <MaterialCommunityIcons
                            name={item.icon}
                            size={20}
                            color={isCredit ? '#4CAF50' : '#2196F3'}
                        />
                    </View>
                    <View style={styles.transactionInfo}>
                        <Text style={[
                            styles.transactionDescription,
                            { color: currentTheme.text }
                        ]}>
                            {item.description}
                        </Text>
                        <Text style={[
                            styles.transactionDate,
                            { color: currentTheme.textSecondary }
                        ]}>
                            {item.date}
                        </Text>
                    </View>
                </View>
                <View style={styles.transactionRight}>
                    <Text style={[
                        styles.transactionAmount,
                        { color: isCredit ? '#4CAF50' : '#2196F3' }
                    ]}>
                        {isCredit ? '-' : '+'}R$ {item.amount.toFixed(2)}
                    </Text>
                    <MaterialCommunityIcons
                        name={isCredit ? 'arrow-up' : 'arrow-down'}
                        size={16}
                        color={isCredit ? '#4CAF50' : '#2196F3'}
                    />
                </View>
            </Animated.View>
        );
    };

    const renderStatsCard = () => {
        const stats = [
            { label: 'Gasto Total', value: 'R$ 1.250', icon: 'cash-minus', color: '#F44336' },
            { label: 'Adicionado', value: 'R$ 2.500', icon: 'cash-plus', color: '#4CAF50' },
            { label: 'Viagens', value: '127', icon: 'car', color: '#2196F3' },
        ];

        return (
            <Animated.View
                style={[
                    styles.statsCard,
                    {
                        backgroundColor: currentTheme.card,
                        opacity: fadeAnim,
                        transform: [
                            {
                                translateY: slideAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [30, 0],
                                })
                            }
                        ]
                    }
                ]}
            >
                {stats.map((stat, index) => (
                    <View key={index} style={styles.statItem}>
                        <View style={[
                            styles.statIcon,
                            { backgroundColor: `${stat.color}15` }
                        ]}>
                            <MaterialCommunityIcons
                                name={stat.icon}
                                size={20}
                                color={stat.color}
                            />
                        </View>
                        <Text style={[
                            styles.statValue,
                            { color: currentTheme.text }
                        ]}>
                            {stat.value}
                        </Text>
                        <Text style={[
                            styles.statLabel,
                            { color: currentTheme.textSecondary }
                        ]}>
                            {stat.label}
                        </Text>
                    </View>
                ))}
            </Animated.View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: currentTheme.background }]}>
            <StatusBar 
                barStyle="light-content"
                backgroundColor="transparent"
                translucent
            />

            {renderHeader()}

            <ScrollView 
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {renderStatsCard()}
                {renderPeriodSelector()}

                <View style={styles.transactionsContainer}>
                    <FlatList
                        data={transactions}
                        renderItem={renderTransaction}
                        keyExtractor={(item) => item.id}
                        scrollEnabled={false}
                        showsVerticalScrollIndicator={false}
                    />
                </View>

                {/* Espaço extra no final */}
                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingTop: Platform.OS === 'ios' ? 60 : 40,
    },
    headerGradient: {
        paddingHorizontal: 24,
        paddingBottom: 30,
    },
    headerTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 30,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        color: '#fff',
    },
    settingsButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    balanceContainer: {
        alignItems: 'center',
        marginBottom: 30,
    },
    balanceLabel: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: 'rgba(255, 255, 255, 0.8)',
        marginBottom: 8,
    },
    balanceAmount: {
        fontSize: 36,
        fontFamily: fonts.Bold,
        color: '#fff',
    },
    actionButtons: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 20,
    },
    actionButtonText: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: '#fff',
        marginLeft: 8,
    },
    scrollView: {
        flex: 1,
        marginTop: -20,
    },
    scrollContent: {
        paddingHorizontal: 24,
    },
    statsCard: {
        borderRadius: 20,
        padding: 24,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 6,
    },
    statItem: {
        alignItems: 'center',
        flex: 1,
    },
    statIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    statValue: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    periodSelector: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 12,
        marginLeft: 4,
    },
    periodButtons: {
        flexDirection: 'row',
        borderRadius: 16,
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    periodButton: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderRadius: 12,
    },
    periodButtonActive: {
        backgroundColor: '#4CAF50',
    },
    periodButtonText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: '#666',
    },
    periodButtonTextActive: {
        color: '#fff',
    },
    transactionsContainer: {
        marginBottom: 24,
    },
    transactionCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        marginBottom: 12,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    transactionLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    transactionIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    transactionInfo: {
        flex: 1,
    },
    transactionDescription: {
        fontSize: 16,
        fontFamily: fonts.SemiBold,
        marginBottom: 4,
    },
    transactionDate: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    transactionRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    transactionAmount: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginRight: 8,
    },
});

export default ModernWalletScreen; 
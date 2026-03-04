import Logger from '../utils/Logger';
import React, { useState, useEffect, useCallback } from 'react';
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
    ActivityIndicator,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    Switch,
} from 'react-native';
import { Icon } from 'react-native-elements';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { colors } from '../common-local/theme';
import { fonts } from '../common-local/font';
import { cardTypography } from '../common-local/typography';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SkeletonLoader, LoadingSpinner } from '../components/LoadingStates';
import { useResponsiveLayout } from '../components/ResponsiveLayout';
import { signOff } from '../common-local/actions/authactions';


const { width, height } = Dimensions.get('window');

export default function ProfileScreen({ navigation }) {
    const auth = useSelector(state => state.auth);
    const dispatch = useDispatch();
    const [isDarkMode, setIsDarkMode] = useState(false);
    
    // Loading states
    const [isLoadingProfile, setIsLoadingProfile] = useState(true);
    const [isLoadingStats, setIsLoadingStats] = useState(false);
    const [driverBalance, setDriverBalance] = useState(0);
    const [isLoadingBalance, setIsLoadingBalance] = useState(false);
    const [showBalanceHistory, setShowBalanceHistory] = useState(false);
    const [transactionHistory, setTransactionHistory] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    
    // Estados do modal de saque
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);
    const [showWithdrawConfirmation, setShowWithdrawConfirmation] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [pixKey, setPixKey] = useState('');
    const [appPassword, setAppPassword] = useState('');
    const [isProcessingWithdraw, setIsProcessingWithdraw] = useState(false);
    const [savePixKey, setSavePixKey] = useState(false);
    
    // Responsive layout hook
    const { config: responsiveConfig, isTablet, isMobile } = useResponsiveLayout();
    
    // Importar serviço de saldo
    let DriverBalanceService;
    try {
        DriverBalanceService = require('../services/DriverBalanceService').default;
    } catch (error) {
        Logger.warn('⚠️ DriverBalanceService não disponível:', error);
        DriverBalanceService = {
            getDriverBalance: async () => ({ success: false, error: 'Serviço não disponível' }),
            getTransactionHistory: async () => ({ success: false, error: 'Serviço não disponível' })
        };
    }
    

    // Carregar saldo do motorista
    const loadDriverBalance = async () => {
        try {
            setIsLoadingBalance(true);
            const driverId = auth?.uid;
            
            if (!driverId) {
                return;
            }

            const result = await DriverBalanceService.getDriverBalance(driverId);
            
            if (result.success) {
                setDriverBalance(result.balance || 0);
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar saldo:', error);
        } finally {
            setIsLoadingBalance(false);
        }
    };

    // Carregar histórico de transações
    const loadTransactionHistory = async () => {
        try {
            setIsLoadingHistory(true);
            const driverId = auth?.uid;
            
            if (!driverId) {
                return;
            }

            const result = await DriverBalanceService.getTransactionHistory(driverId, 50);
            
            if (result.success) {
                setTransactionHistory(result.transactions || []);
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar histórico:', error);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Determinar tipo de usuário (ANTES do useEffect)
    const userType = auth?.profile?.usertype || auth?.profile?.userType;
    const isDriver = userType === 'driver';
    const isPassenger = userType === 'customer' || !isDriver;

    // Carregar dados do perfil ao montar componente
    useEffect(() => {
        // Parar loading do perfil quando auth estiver disponível
        if (auth && auth.uid) {
            setIsLoadingProfile(false);
            // Só carregar saldo se for motorista
            if (isDriver) {
                loadDriverBalance();
            }
        } else {
            // Se não tem auth, aguardar um pouco e parar loading
            const timer = setTimeout(() => {
                setIsLoadingProfile(false);
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [auth?.uid, isDriver]);

    // Carregar chave PIX salva
    const loadSavedPixKey = useCallback(async () => {
        try {
            const savedPixKey = await AsyncStorage.getItem('@saved_pix_key');
            if (savedPixKey) {
                setPixKey(savedPixKey);
                setSavePixKey(true);
            } else {
                // Se não houver chave salva, limpar estados
                setPixKey('');
                setSavePixKey(false);
            }
        } catch (error) {
            Logger.error('Erro ao carregar chave PIX salva:', error);
        }
    }, []);

    // Carregar chave PIX quando o modal abrir (apenas uma vez)
    useEffect(() => {
        if (showWithdrawModal) {
            loadSavedPixKey();
        }
    }, [showWithdrawModal, loadSavedPixKey]);


    // Funções do modal de saque
    const handleContinueWithdraw = () => {
        // Validações
        const amount = parseFloat(withdrawAmount.replace(',', '.'));
        
        if (!amount || amount <= 0) {
            Alert.alert('Atenção', 'Informe um valor válido para o saque.');
            return;
        }
        
        if (amount > driverBalance) {
            Alert.alert('Saldo insuficiente', 'O valor solicitado é maior que o saldo disponível em sua conta.');
            return;
        }
        
        if (!pixKey || pixKey.trim().length === 0) {
            Alert.alert('Atenção', 'Informe a chave PIX.');
            return;
        }
        
        if (!appPassword || appPassword.length === 0) {
            Alert.alert('Atenção', 'Informe sua senha do app.');
            return;
        }
        
        // Validação de senha será realizada antes de processar o saque
        
        setShowWithdrawModal(false);
        setShowWithdrawConfirmation(true);
    };

    const handleConfirmWithdraw = async () => {
        setIsProcessingWithdraw(true);
        
        try {
            // Processar saque via API
            // const response = await api.post('/api/payment/withdraw', {
            //     amount: parseFloat(withdrawAmount.replace(',', '.')),
            //     pixKey: pixKey.trim(),
            //     password: appPassword
            // });
            
            // Simulação de processamento
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            Alert.alert(
                'Sucesso',
                'Saque solicitado com sucesso! O valor será creditado em até 1 dia útil.',
                [
                    {
                        text: 'OK',
                        onPress: () => {
                            setShowWithdrawConfirmation(false);
                            setWithdrawAmount('');
                            setPixKey('');
                            setAppPassword('');
                            loadDriverBalance(); // Recarregar saldo
                        }
                    }
                ]
            );
        } catch (error) {
            Logger.error('❌ Erro ao processar saque:', error);
            Alert.alert(
                'Erro',
                error.message || 'Não foi possível processar o saque. Tente novamente.'
            );
        } finally {
            setIsProcessingWithdraw(false);
        }
    };

    // Função para fazer logout
    const handleLogout = () => {
        Alert.alert(
            'Logout',
            'Tem certeza que deseja sair?',
            [
                {
                    text: 'Cancelar',
                    style: 'cancel',
                },
                {
                    text: 'Sair',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await AsyncStorage.removeItem('@user_data');
                            await AsyncStorage.removeItem('@auth_token');
                            await dispatch(signOff());
                            navigation.reset({
                                index: 0,
                                routes: [{ name: 'Splash' }]
                            });
                        } catch (error) {
                            Logger.error('Erro ao fazer logout:', error);
                        }
                    },
                },
            ],
            { cancelable: true }
        );
    };

    // Menu items diferentes para passageiro e motorista
    const menuItems = isDriver ? [
        // Menu para Motorista
        {
            id: 1,
            title: 'Gestão do Plano',
            icon: 'card-outline',
            onPress: () => navigation.navigate('SubscriptionManagement')
        },
        {
            id: 2,
            title: 'Editar perfil',
            icon: 'person-outline',
            onPress: () => navigation.navigate('EditProfile')
        },
        {
            id: 3,
            title: 'Meus veículos',
            icon: 'car-outline',
            onPress: () => navigation.navigate('MyVehicles')
        },
        {
            id: 4,
            title: 'Relatório de ganhos',
            icon: 'bar-chart-outline',
            onPress: () => navigation.navigate('EarningsReport', { from: 'menu' })
        },
        {
            id: 5,
            title: 'Histórico de viagens',
            icon: 'time-outline',
            onPress: () => navigation.navigate('Trips')
        },
        {
            id: 6,
            title: 'Configurações',
            icon: 'settings-outline',
            onPress: () => navigation.navigate('Settings')
        }
    ] : [
        // Menu para Passageiro
        {
            id: 1,
            title: 'Editar perfil',
            icon: 'person-outline',
            onPress: () => navigation.navigate('EditProfileScreen')
        },
        {
            id: 2,
            title: 'Histórico de viagens',
            icon: 'time-outline',
            onPress: () => navigation.navigate('Rides')
        },
        {
            id: 3,
            title: 'Mensagens',
            icon: 'chatbubbles-outline',
            onPress: () => navigation.navigate('Chat')
        },
        {
            id: 4,
            title: 'Configurações',
            icon: 'settings-outline',
            onPress: () => navigation.navigate('Settings')
        },
        {
            id: 5,
            title: 'Ajuda',
            icon: 'help-circle-outline',
            onPress: () => navigation.navigate('Help')
        }
    ];

    // Componente para alternar entre modo claro/escuro
    function ThemeSwitch({ value, onValueChange }) {
        return (
            <TouchableOpacity 
                style={styles.themeSwitchTouchable}
                onPress={() => onValueChange(!value)}
            >
                <View style={styles.themeSwitchTrack}>
                    <View style={styles.themeSwitchIconBubble}>
                        <Ionicons 
                            name={value ? 'moon' : 'sunny'} 
                            size={16} 
                            color={value ? '#fff' : '#FFD700'} 
                        />
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    // Header com botão voltar e título
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
            <Text style={[styles.headerTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>Perfil</Text>
            <View style={styles.headerRightContainer}>
                <TouchableOpacity 
                    style={[
                        styles.headerButton, 
                        { 
                            backgroundColor: isDarkMode ? '#2d2d2d' : '#e8e8e8',
                            borderWidth: 1,
                            borderColor: isDarkMode ? '#404040' : '#d0d0d0',
                        }
                    ]}
                    onPress={() => navigation.navigate('Notifications')}
                    activeOpacity={0.7}
                >
                    <Ionicons name="notifications-outline" size={22} color={isDarkMode ? '#fff' : '#1a1a1a'} />
                </TouchableOpacity>
                <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
            </View>
        </View>
    );


    // Item do menu
    const MenuItem = ({ item }) => (
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: isDarkMode ? '#333' : '#e8e8e8' }]} onPress={item.onPress}>
            <View style={styles.menuItemLeft}>
                <Ionicons name={item.icon} size={22} color={isDarkMode ? '#fff' : colors.BLACK} style={styles.menuIcon} />
                <Text style={[cardTypography.title, styles.menuItemText, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{item.title}</Text>
            </View>
            <Icon name="chevron-right" type="material" color={isDarkMode ? '#666' : colors.GRAY} size={22} />
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={isDarkMode ? '#1a1a1a' : '#fff'} />
            
            {/* Header */}
            <Header />
            
            {isLoadingProfile ? (
                <View style={styles.skeletonContainer}>
                    <LoadingSpinner 
                        message="Carregando perfil..." 
                        color={MAIN_COLOR} 
                    />
                    <SkeletonLoader width="100%" height={120} style={styles.skeletonProfile} />
                    <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
                    <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
                    <SkeletonLoader width="100%" height={80} style={styles.skeletonCard} />
                </View>
            ) : (
                <ScrollView style={[styles.content, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]} showsVerticalScrollIndicator={false}>
                    {/* Seção do perfil */}
                    <View style={styles.profileSection}>
                        <View style={styles.profileImageContainer}>
                            <Image
                                source={auth?.profile?.profile_image ? { uri: auth.profile.profile_image } : require('../../assets/images/profilePic.png')}
                                style={styles.profileImage}
                            />
                        </View>
                        <View style={styles.profileInfo}>
                            <Text style={[cardTypography.subtitle, styles.greeting, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>Olá,</Text>
                            <Text style={[styles.userName, { color: isDarkMode ? '#fff' : colors.BLACK }]}>{auth?.profile?.firstName || 'Usuário'} {auth?.profile?.lastName || ''}</Text>
                            <View style={styles.partnerInfoRow}>
                                <Text style={[cardTypography.subtitle, styles.partnerSince, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    {isDriver ? `Parceira Leaf desde ${new Date().getFullYear()}` : `Usuária Leaf desde ${new Date().getFullYear()}`}
                                </Text>
                                {/* Badge do Plano (apenas para motoristas) */}
                                {isDriver && auth?.profile?.carType && (
                                    (() => {
                                        const carType = auth.profile.carType;
                                        const isElite = carType === 'Leaf Elite' || carType?.toLowerCase().includes('elite');
                                        const isPlus = carType === 'Leaf Plus' || carType?.toLowerCase().includes('plus');
                                        
                                        if (isElite) {
                                            return (
                                                <View style={styles.planBadgeElite}>
                                                    <Text style={styles.planBadgeText}>Elite</Text>
                                                </View>
                                            );
                                        } else if (isPlus) {
                                            return (
                                                <View style={styles.planBadgePlus}>
                                                    <Text style={styles.planBadgeText}>Plus</Text>
                                                </View>
                                            );
                                        }
                                        return null;
                                    })()
                                )}
                            </View>
                        </View>
                    </View>

                {/* Cards de estatísticas - Removidos (disponíveis no Relatório de Ganhos) */}

                {/* Card de Saldo (apenas para motoristas) */}
                {isDriver && (
                    <TouchableOpacity 
                        style={[styles.balanceCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#F0F8F0' }]}
                        onPress={() => navigation.navigate('EarningsReport', { from: 'menu' })}
                        activeOpacity={0.8}
                    >
                        <View style={styles.balanceCardHeader}>
                            <Ionicons name="wallet-outline" size={24} color="#1A330E" />
                            <Text style={[cardTypography.title, styles.balanceCardTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Saldo Disponível
                            </Text>
                        </View>
                        {isLoadingBalance ? (
                            <ActivityIndicator size="small" color="#1A330E" style={{ marginVertical: 12 }} />
                        ) : (
                            <Text style={styles.balanceCardAmount}>
                                R$ {driverBalance.toFixed(2).replace('.', ',')}
                            </Text>
                        )}
                        <TouchableOpacity
                            onPress={() => setShowWithdrawModal(true)}
                            style={styles.withdrawButton}
                            activeOpacity={0.8}
                        >
                            <Text style={[cardTypography.title, styles.withdrawButtonText]}>
                                Realizar saque
                            </Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                )}

                {/* Lista de opções */}
                <View style={[styles.menuContainer, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                    {menuItems.map((item) => (
                        <MenuItem key={item.id} item={item} />
                    ))}
                </View>

                {/* Botão de Logout */}
                <View style={styles.logoutContainer}>
                    <TouchableOpacity style={[styles.logoutButton, { 
                        backgroundColor: isDarkMode ? '#2a1a1a' : '#FFF5F5',
                        borderColor: isDarkMode ? '#4a2a2a' : '#FFE5E5'
                    }]} onPress={handleLogout}>
                        <Ionicons name="log-out-outline" size={20} color="#FF3B30" style={styles.logoutIcon} />
                        <Text style={styles.logoutText}>Logout</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
            )}

            {/* Modal de Histórico de Saldo */}
            <Modal
                visible={showBalanceHistory}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowBalanceHistory(false)}
            >
                <View style={styles.balanceModalOverlay}>
                    <View style={[styles.balanceModalContent, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                        {/* Header do Modal */}
                        <View style={styles.balanceModalHeader}>
                            <Text style={[cardTypography.title, styles.balanceModalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Histórico de Movimentações
                            </Text>
                            <TouchableOpacity
                                onPress={() => setShowBalanceHistory(false)}
                                style={styles.balanceModalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        {/* Saldo Atual */}
                        <View style={[styles.balanceCardModal, { backgroundColor: isDarkMode ? '#2a2a2a' : '#F0F8F0' }]}>
                            <Text style={[cardTypography.subtitle, styles.balanceLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                Saldo Disponível
                            </Text>
                            {isLoadingBalance ? (
                                <ActivityIndicator size="small" color="#1A330E" style={{ marginVertical: 12 }} />
                            ) : (
                                <Text style={styles.balanceAmountModal}>
                                    R$ {driverBalance.toFixed(2).replace('.', ',')}
                                </Text>
                            )}
                        </View>

                        {/* Histórico de Transações */}
                        <ScrollView style={styles.historySection}>
                            {isLoadingHistory ? (
                                <View style={styles.loadingContainer}>
                                    <ActivityIndicator size="small" color="#1A330E" />
                                    <Text style={[cardTypography.subtitle, styles.loadingText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Carregando histórico...
                                    </Text>
                                </View>
                            ) : transactionHistory.length === 0 ? (
                                <View style={styles.emptyHistory}>
                                    <Ionicons name="receipt-outline" size={48} color={colors.GRAY} />
                                    <Text style={[cardTypography.subtitle, styles.emptyHistoryText, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Nenhuma transação ainda
                                    </Text>
                                </View>
                            ) : (
                                transactionHistory.map((transaction) => (
                                    <View 
                                        key={transaction.id} 
                                        style={[
                                            styles.transactionItem,
                                            { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }
                                        ]}
                                    >
                                        <View style={styles.transactionIcon}>
                                            <Ionicons
                                                name={transaction.type === 'credit' ? 'arrow-down-circle' : 'arrow-up-circle'}
                                                size={24}
                                                color={transaction.type === 'credit' ? '#1A330E' : '#FF3B30'}
                                            />
                                        </View>
                                        <View style={styles.transactionDetails}>
                                            <Text style={[cardTypography.title, styles.transactionDescription, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                                {transaction.description || 
                                                 (transaction.type === 'credit' ? 'Crédito de corrida' : 'Débito')}
                                            </Text>
                                            <Text style={[cardTypography.subtitle, styles.transactionDate, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                                {transaction.createdAt 
                                                    ? new Date(transaction.createdAt).toLocaleString('pt-BR')
                                                    : 'Data não disponível'}
                                            </Text>
                                        </View>
                                        <View style={styles.transactionAmount}>
                                            <Text style={[
                                                cardTypography.title,
                                                styles.transactionAmountText,
                                                { color: transaction.type === 'credit' ? '#1A330E' : '#FF3B30' }
                                            ]}>
                                                {transaction.type === 'credit' ? '+' : '-'}
                                                R$ {transaction.amount.toFixed(2).replace('.', ',')}
                                            </Text>
                                        </View>
                                    </View>
                                ))
                            )}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            {/* Modal de Saque */}
            <Modal
                visible={showWithdrawModal}
                animationType="slide"
                transparent={true}
                onRequestClose={() => {
                    setShowWithdrawModal(false);
                    setWithdrawAmount('');
                    setAppPassword('');
                    // Não limpar pixKey se estiver salva
                    if (!savePixKey) {
                        setPixKey('');
                    }
                }}
            >
                <KeyboardAvoidingView 
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.withdrawModalOverlay}
                >
                    <View style={[styles.withdrawModalContent, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                        {/* Header */}
                        <View style={styles.withdrawModalHeader}>
                            <Text style={[cardTypography.title, styles.withdrawModalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Solicitar Saque
                            </Text>
                            <TouchableOpacity
                                onPress={() => {
                                    setShowWithdrawModal(false);
                                    setWithdrawAmount('');
                                    setAppPassword('');
                                    // Não limpar pixKey se estiver salva
                                    if (!savePixKey) {
                                        setPixKey('');
                                    }
                                }}
                                style={styles.withdrawModalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.withdrawModalBody} showsVerticalScrollIndicator={false}>
                            {/* Saldo Disponível */}
                            <View style={[styles.withdrawBalanceCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#F0F8F0' }]}>
                                <Text style={[cardTypography.subtitle, styles.withdrawBalanceLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                    Saldo Disponível
                                </Text>
                                <Text style={styles.withdrawBalanceAmount}>
                                    R$ {driverBalance.toFixed(2).replace('.', ',')}
                                </Text>
                            </View>

                            {/* Campo: Valor do Saque */}
                            <View style={styles.withdrawInputContainer}>
                                <Text style={[cardTypography.title, styles.withdrawInputLabel, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                    Valor do Saque
                                </Text>
                                <View style={[styles.withdrawInputWrapper, { 
                                    borderColor: isDarkMode ? '#444' : '#ddd',
                                    backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9'
                                }]}>
                                    <Text style={[cardTypography.title, styles.withdrawInputPrefix, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        R$
                                    </Text>
                                    <TextInput
                                        style={[styles.withdrawInput, { color: isDarkMode ? '#fff' : colors.BLACK }]}
                                        placeholder="0,00"
                                        placeholderTextColor={isDarkMode ? '#666' : '#999'}
                                        value={withdrawAmount}
                                        onChangeText={(text) => {
                                            // Permitir apenas números e vírgula/ponto
                                            const cleaned = text.replace(/[^0-9,.]/g, '');
                                            // Substituir vírgula por ponto para cálculo
                                            const normalized = cleaned.replace(',', '.');
                                            setWithdrawAmount(cleaned);
                                        }}
                                        keyboardType="decimal-pad"
                                        maxLength={10}
                                    />
                                </View>
                                {/* Mensagem de saldo insuficiente */}
                                {(() => {
                                    const amount = parseFloat(withdrawAmount.replace(',', '.')) || 0;
                                    if (amount > driverBalance && withdrawAmount.length > 0) {
                                        return (
                                            <View style={styles.withdrawErrorContainer}>
                                                <Ionicons name="alert-circle-outline" size={16} color="#F44336" />
                                                <Text style={[cardTypography.subtitle, styles.withdrawErrorText]}>
                                                    Saldo insuficiente
                                                </Text>
                                            </View>
                                        );
                                    }
                                    return null;
                                })()}
                                {/* Mensagem de taxa para valores abaixo de R$ 500 */}
                                {(() => {
                                    const amount = parseFloat(withdrawAmount.replace(',', '.')) || 0;
                                    if (amount > 0 && amount < 500 && amount <= driverBalance) {
                                        return (
                                            <View style={styles.withdrawTaxWarningContainer}>
                                                <Ionicons name="information-circle-outline" size={16} color="#FF9800" />
                                                <Text style={[cardTypography.subtitle, styles.withdrawTaxWarningText]}>
                                                    Taxa de R$ 1,00 será aplicada
                                                </Text>
                                            </View>
                                        );
                                    }
                                    return null;
                                })()}
                            </View>

                            {/* Campo: Chave PIX */}
                            <View style={styles.withdrawInputContainer}>
                                <Text style={[cardTypography.title, styles.withdrawInputLabel, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                    Chave PIX
                                </Text>
                                <TextInput
                                    style={[
                                        styles.withdrawInputFull,
                                        { 
                                            borderColor: isDarkMode ? '#444' : '#ddd',
                                            backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9',
                                            color: isDarkMode ? '#fff' : colors.BLACK
                                        }
                                    ]}
                                    placeholder="CPF, e-mail, telefone ou chave aleatória"
                                    placeholderTextColor={isDarkMode ? '#666' : '#999'}
                                    value={pixKey}
                                    onChangeText={setPixKey}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                                {/* Checkbox para salvar chave PIX */}
                                <View style={styles.savePixKeyContainer}>
                                    <Switch
                                        value={savePixKey}
                                        onValueChange={setSavePixKey}
                                        trackColor={{ false: '#767577', true: MAIN_COLOR }}
                                        thumbColor={savePixKey ? '#fff' : '#f4f3f4'}
                                        ios_backgroundColor="#3e3e3e"
                                    />
                                    <Text style={[cardTypography.subtitle, styles.savePixKeyLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Salvar chave PIX
                                    </Text>
                                </View>
                            </View>

                            {/* Campo: Senha do App */}
                            <View style={styles.withdrawInputContainer}>
                                <Text style={[cardTypography.title, styles.withdrawInputLabel, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                    Senha do App
                                </Text>
                                <TextInput
                                    style={[
                                        styles.withdrawInputFull,
                                        { 
                                            borderColor: isDarkMode ? '#444' : '#ddd',
                                            backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9',
                                            color: isDarkMode ? '#fff' : colors.BLACK
                                        }
                                    ]}
                                    placeholder="Digite sua senha"
                                    placeholderTextColor={isDarkMode ? '#666' : '#999'}
                                    value={appPassword}
                                    onChangeText={setAppPassword}
                                    secureTextEntry
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>

                            {/* Informação sobre Taxa */}
                            <View style={[styles.withdrawTaxInfo, { backgroundColor: isDarkMode ? '#2a2a2a' : '#FFF8E1' }]}>
                                <Ionicons name="information-circle-outline" size={18} color="#FF9800" />
                                <Text style={[cardTypography.helper, styles.withdrawTaxText, { color: isDarkMode ? '#ccc' : '#E65100' }]}>
                                    *Saques abaixo de R$ 500,00 possuem taxa de R$ 1,00
                                </Text>
                            </View>

                            {/* Botão Continuar */}
                            <TouchableOpacity
                                style={[
                                    styles.withdrawContinueButton,
                                    (!withdrawAmount || !pixKey || !appPassword || isProcessingWithdraw) && styles.withdrawContinueButtonDisabled
                                ]}
                                onPress={handleContinueWithdraw}
                                disabled={!withdrawAmount || !pixKey || !appPassword || isProcessingWithdraw}
                                activeOpacity={0.8}
                            >
                                {isProcessingWithdraw ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={[cardTypography.title, styles.withdrawContinueButtonText]}>
                                        Continuar
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Modal de Confirmação de Saque */}
            <Modal
                visible={showWithdrawConfirmation}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setShowWithdrawConfirmation(false)}
            >
                <View style={styles.withdrawModalOverlay}>
                    <View style={[styles.withdrawModalContent, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
                        <View style={styles.withdrawModalHeader}>
                            <Text style={[cardTypography.title, styles.withdrawModalTitle, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                Confirmar Saque
                            </Text>
                            <TouchableOpacity
                                onPress={() => setShowWithdrawConfirmation(false)}
                                style={styles.withdrawModalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={isDarkMode ? '#fff' : colors.BLACK} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.withdrawModalBody}>
                            <Text style={[cardTypography.subtitle, styles.confirmLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                Confirme os dados do saque:
                            </Text>

                            {/* Resumo do Saque */}
                            <View style={[styles.confirmCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#F0F8F0' }]}>
                                <View style={styles.confirmRow}>
                                    <Text style={[cardTypography.subtitle, styles.confirmRowLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Valor:
                                    </Text>
                                    <Text style={[cardTypography.title, styles.confirmRowValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        R$ {parseFloat(withdrawAmount.replace(',', '.')) || 0}.toFixed(2).replace('.', ',')}
                                    </Text>
                                </View>
                                
                                {parseFloat(withdrawAmount.replace(',', '.')) < 500 && (
                                    <View style={styles.confirmRow}>
                                        <Text style={[cardTypography.subtitle, styles.confirmRowLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                            Taxa:
                                        </Text>
                                        <Text style={[cardTypography.title, styles.confirmRowValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                            R$ 1,00
                                        </Text>
                                    </View>
                                )}
                                
                                <View style={[styles.confirmRow, styles.confirmRowTotal]}>
                                    <Text style={[cardTypography.subtitle, styles.confirmRowLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Total a receber:
                                    </Text>
                                    <Text style={[styles.confirmRowValueTotal, { color: MAIN_COLOR }]}>
                                        R$ {(() => {
                                            const amount = parseFloat(withdrawAmount.replace(',', '.')) || 0;
                                            const fee = amount < 500 ? 1 : 0;
                                            const total = amount - fee;
                                            return total.toFixed(2).replace('.', ',');
                                        })()}
                                    </Text>
                                </View>
                            </View>

                            <View style={[styles.confirmCard, { backgroundColor: isDarkMode ? '#2a2a2a' : '#fff' }]}>
                                <View style={styles.confirmRow}>
                                    <Text style={[cardTypography.subtitle, styles.confirmRowLabel, { color: isDarkMode ? '#ccc' : colors.GRAY }]}>
                                        Chave PIX:
                                    </Text>
                                    <Text style={[cardTypography.title, styles.confirmRowValue, { color: isDarkMode ? '#fff' : colors.BLACK }]}>
                                        {pixKey}
                                    </Text>
                                </View>
                            </View>

                            <TouchableOpacity
                                style={[
                                    styles.withdrawConfirmButton,
                                    isProcessingWithdraw && styles.withdrawContinueButtonDisabled
                                ]}
                                onPress={handleConfirmWithdraw}
                                disabled={isProcessingWithdraw}
                                activeOpacity={0.8}
                            >
                                {isProcessingWithdraw ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={[cardTypography.title, styles.withdrawConfirmButtonText]}>
                                        Confirmar Saque
                                    </Text>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.withdrawCancelButton}
                                onPress={() => setShowWithdrawConfirmation(false)}
                                activeOpacity={0.8}
                            >
                                <Text style={[cardTypography.subtitle, styles.withdrawCancelButtonText, { color: isDarkMode ? '#999' : colors.GRAY }]}>
                                    Cancelar
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
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
    content: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    profileSection: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 25,
        marginBottom: 20,
    },
    profileImageContainer: {
        marginRight: 16,
    },
    profileImage: {
        width: 60,
        height: 60,
        borderRadius: 30,
    },
    profileInfo: {
        flex: 1,
    },
    greeting: {
        // Usa cardTypography.subtitle via style prop
    },
    userName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.BLACK,
        fontFamily: fonts.Bold,
        marginBottom: 2,
    },
    partnerInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: 2,
    },
    partnerSince: {
        // Usa cardTypography.subtitle via style prop
        marginRight: 8,
    },
    planBadgePlus: {
        backgroundColor: '#003002',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginLeft: 4,
    },
    planBadgeElite: {
        backgroundColor: '#000000',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        marginLeft: 4,
    },
    planBadgeText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    menuContainer: {
        marginBottom: 15,
    },
    menuItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 0,
        borderBottomWidth: 1,
        borderBottomColor: '#e8e8e8',
    },
    menuItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    menuIcon: {
        marginRight: 12,
    },
    menuItemText: {
        // Usa cardTypography.title via style prop
        marginLeft: 4,
    },
    logoutContainer: {
        alignItems: 'center',
        marginTop: 20,
        marginBottom: 40,
    },
    skeletonContainer: {
        flex: 1,
        padding: 16,
    },
    skeletonProfile: {
        marginBottom: 16,
        borderRadius: 12,
    },
    skeletonCard: {
        marginBottom: 12,
        borderRadius: 8,
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF5F5',
        borderWidth: 1,
        borderColor: '#FFE5E5',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
        minWidth: 140,
    },
    logoutIcon: {
        marginRight: 8,
    },
    logoutText: {
        fontSize: 16,
        color: '#FF3B30',
        fontFamily: fonts.Bold,
        fontWeight: '600',
    },
    // Card de Saldo
    balanceCard: {
        marginHorizontal: 20,
        marginTop: 20,
        marginBottom: 10,
        padding: 20,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    balanceCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    balanceCardTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginLeft: 12,
    },
    balanceCardAmount: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        color: '#1A330E',
        marginBottom: 8,
    },
    balanceCardSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Medium,
    },
    // Modal de Histórico
    balanceModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    balanceModalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '90%',
        paddingBottom: 40,
    },
    balanceModalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f5f5f5',
    },
    balanceModalTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
    },
    balanceModalCloseButton: {
        padding: 4,
    },
    balanceCardModal: {
        margin: 20,
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    balanceAmountModal: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        color: '#1A330E',
        marginBottom: 12,
    },
    historySection: {
        flex: 1,
        padding: 20,
        maxHeight: 500,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginTop: 12,
    },
    emptyHistory: {
        alignItems: 'center',
        padding: 40,
    },
    emptyHistoryText: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginTop: 16,
    },
    transactionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        marginBottom: 8,
        borderRadius: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f5f5f5',
    },
    transactionIcon: {
        marginRight: 12,
    },
    transactionDetails: {
        flex: 1,
    },
    transactionDescription: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginBottom: 4,
    },
    transactionDate: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    transactionAmount: {
        alignItems: 'flex-end',
    },
    transactionAmountText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    // Estilos do Modal de Saque
    withdrawButton: {
        backgroundColor: '#003002',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginTop: 12,
        alignItems: 'center',
    },
    withdrawButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    withdrawButtonUnderline: {
        width: '100%',
        height: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        marginTop: 4,
    },
    withdrawModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    withdrawModalContent: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        maxHeight: '90%',
        paddingBottom: 40,
    },
    withdrawModalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f5f5f5',
    },
    withdrawModalTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
    },
    withdrawModalCloseButton: {
        padding: 4,
    },
    withdrawModalBody: {
        padding: 20,
    },
    withdrawBalanceCard: {
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 24,
    },
    withdrawBalanceLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    withdrawBalanceAmount: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        color: MAIN_COLOR,
    },
    withdrawInputContainer: {
        marginBottom: 20,
    },
    withdrawInputLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    withdrawInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 50,
    },
    withdrawInputPrefix: {
        fontSize: 16,
        fontFamily: fonts.Regular,
        marginRight: 8,
    },
    withdrawInput: {
        flex: 1,
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    withdrawInputFull: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        height: 50,
        fontSize: 16,
        fontFamily: fonts.Regular,
    },
    withdrawTaxInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        marginBottom: 24,
    },
    withdrawTaxText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginLeft: 8,
        flex: 1,
    },
    withdrawContinueButton: {
        backgroundColor: MAIN_COLOR,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    withdrawContinueButtonDisabled: {
        backgroundColor: '#ccc',
        opacity: 0.6,
    },
    withdrawContinueButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: '600',
    },
    // Estilos do Modal de Confirmação
    confirmLabel: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginBottom: 16,
    },
    confirmCard: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 16,
    },
    confirmRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    confirmRowTotal: {
        borderTopWidth: 1,
        borderTopColor: '#e0e0e0',
        paddingTop: 12,
        marginTop: 8,
        marginBottom: 0,
    },
    confirmRowLabel: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    confirmRowValue: {
        fontSize: 16,
        fontFamily: fonts.Medium,
    },
    confirmRowValueTotal: {
        fontSize: 20,
        fontFamily: fonts.Bold,
    },
    withdrawConfirmButton: {
        backgroundColor: MAIN_COLOR,
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    withdrawConfirmButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: '600',
    },
    withdrawCancelButton: {
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 12,
    },
    withdrawCancelButtonText: {
        fontSize: 16,
        fontFamily: fonts.Medium,
    },
    withdrawErrorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    withdrawErrorText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        color: '#F44336',
        marginLeft: 6,
    },
    withdrawTaxWarningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    withdrawTaxWarningText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        color: '#FF9800',
        marginLeft: 6,
    },
    savePixKeyContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    savePixKeyLabel: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginLeft: 8,
    },
});
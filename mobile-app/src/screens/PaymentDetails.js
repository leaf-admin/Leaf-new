import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
    Platform,
    StatusBar,
    Dimensions
} from 'react-native';
import { Icon } from 'react-native-elements';
import { colors } from '../common-local/theme';
import i18n from '../i18n';
import { useSelector, useDispatch } from 'react-redux';
import { api } from '../common-local';
import { MAIN_COLOR } from '../common-local/sharedFunctions';
import { fonts } from '../common-local/font';
import { PromoComp } from "../components";
import { SkeletonLoader, LoadingSpinner } from '../components/LoadingStates';
import { useResponsiveLayout } from '../components/ResponsiveLayout';
import WebSocketManager from '../services/WebSocketManager';
import useWebSocketListeners from '../hooks/useWebSocketListeners';


export default function PaymentDetails(props) {
    const { t } = i18n;
    const { getPaymentMethods, addPaymentMethod, removePaymentMethod } = api;
  const dispatch = useDispatch();
  const auth = useSelector(state => state.auth);
    const [loading, setLoading] = useState(true);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [isDarkMode, setIsDarkMode] = useState(false);
    
    // Responsive layout hook
    const { config: responsiveConfig, isTablet, isMobile } = useResponsiveLayout();

    // ===== INTEGRAÇÃO WEBSOCKET =====
    const wsManager = WebSocketManager.getInstance();
    const currentUser = auth.profile;
    const userType = currentUser?.userType || currentUser?.usertype;

    // Configurar listeners WebSocket para pagamentos
    useWebSocketListeners('PaymentDetails', {
        onPaymentConfirmed: (data) => {
            Logger.log('💳 PaymentDetails - Pagamento confirmado:', data);
            // Atualizar estado de pagamento
            // Navegar para próxima tela se necessário
        },
        onBookingCreated: (data) => {
            Logger.log('💳 PaymentDetails - Booking criado:', data);
            // Atualizar estado da reserva
        },
        onConnect: () => {
            Logger.log('💳 PaymentDetails - WebSocket conectado');
        },
        onDisconnect: (reason) => {
            Logger.log('💳 PaymentDetails - WebSocket desconectado:', reason);
        },
        onConnectError: (error) => {
            Logger.error('💳 PaymentDetails - Erro de conexão WebSocket:', error);
        }
    });

    // Tema dinâmico baseado no modo escuro/claro
    const theme = {
        background: isDarkMode ? '#1A1A1A' : '#FFFFFF',
        card: isDarkMode ? '#2A2A2A' : '#FFFFFF',
        text: isDarkMode ? '#FFFFFF' : '#000000',
        textSecondary: isDarkMode ? '#AAAAAA' : '#666666',
        border: isDarkMode ? '#333333' : '#E0E0E0',
        icon: isDarkMode ? '#FFFFFF' : '#000000',
    };

  useEffect(() => {
        loadPaymentMethods();
    }, []);

    const loadPaymentMethods = async () => {
        try {
            setLoading(true);
            const response = await getPaymentMethods(auth.profile.uid);
            if (response && response.length > 0) {
                setPaymentMethods(response);
            }
        } catch (error) {
            Logger.error('Erro ao carregar métodos de pagamento:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddPaymentMethod = () => {
        props.navigation.navigate('AddPaymentMethod');
    };

    const handleRemovePaymentMethod = async (methodId) => {
        try {
            setLoading(true);
            await removePaymentMethod(methodId);
            await loadPaymentMethods();
        } catch (error) {
            Logger.error('Erro ao remover método de pagamento:', error);
        } finally {
            setLoading(false);
        }
    };

    const renderPaymentMethod = (method) => (
        <View style={[styles.paymentMethodCard, { backgroundColor: theme.card }]}>
            <View style={[styles.iconContainer, { backgroundColor: isDarkMode ? '#333333' : '#F5F5F5' }]}>
                <Icon
                    name={method.type === 'credit_card' ? 'credit-card' : 'account-balance-wallet'}
                    type="material"
                    color={theme.icon}
                    size={24}
                />
            </View>
            <View style={styles.paymentMethodContent}>
                <Text style={[styles.paymentMethodTitle, { color: theme.text }]}>
                    {method.type === 'credit_card' ? 'Cartão de Crédito' : 'Carteira Digital'}
                </Text>
                <Text style={[styles.paymentMethodDetails, { color: theme.textSecondary }]}>
                    {method.type === 'credit_card' 
                        ? `**** **** **** ${method.last4}`
                        : `Saldo: R$ ${method.balance.toFixed(2)}`}
                </Text>
            </View>
            <TouchableOpacity
                style={styles.removeButton}
                onPress={() => handleRemovePaymentMethod(method.id)}
            >
                <Icon name="delete" type="material" color={theme.textSecondary} size={24} />
            </TouchableOpacity>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <StatusBar hidden={true} />
            
            {/* Header */}
            <View style={[styles.header, { backgroundColor: theme.card }]}>
            <TouchableOpacity
                    style={[styles.headerButton, { backgroundColor: theme.card }]}
                    onPress={() => props.navigation.goBack()}
            >
                    <Icon name="arrow-back" type="material" color={theme.icon} size={24} />
            </TouchableOpacity>
                
                <Text style={[styles.headerTitle, { color: theme.text }]}>Métodos de Pagamento</Text>
                
                <View style={styles.headerRightContainer}>
            <TouchableOpacity
                        style={[styles.headerButton, { backgroundColor: theme.card }]}
                        onPress={() => setIsDarkMode(!isDarkMode)}
                    >
                        <Icon 
                            name={isDarkMode ? "light-mode" : "dark-mode"} 
                            type="material" 
                            color={theme.icon} 
                            size={24} 
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView style={styles.scrollView}>
                {loading ? (
                    <View style={styles.loadingContainer}>
                        <LoadingSpinner 
                            message="Carregando métodos de pagamento..." 
                            color={MAIN_COLOR} 
                        />
                        <View style={styles.skeletonContainer}>
                            <SkeletonLoader width="100%" height={60} style={styles.skeletonMethod} />
                            <SkeletonLoader width="100%" height={60} style={styles.skeletonMethod} />
                            <SkeletonLoader width="100%" height={60} style={styles.skeletonMethod} />
                        </View>
                    </View>
                ) : (
                    <View style={styles.contentContainer}>
                        {paymentMethods.length > 0 ? (
                            paymentMethods.map((method) => renderPaymentMethod(method))
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Icon
                                    name="payment"
                                    type="material"
                                    color={theme.textSecondary}
                                    size={64}
                                />
                                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                                    Nenhum método de pagamento cadastrado
                </Text>
              </View>
                        )}

            <TouchableOpacity
                            style={[styles.addButton, { backgroundColor: MAIN_COLOR }]}
                            onPress={handleAddPaymentMethod}
            >
                            <Icon name="add" type="material" color="#FFFFFF" size={24} />
                            <Text style={styles.addButtonText}>Adicionar Método de Pagamento</Text>
                        </TouchableOpacity>
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
    alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: Platform.OS === 'ios' ? 50 : 40,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
  },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    headerRightContainer: {
        flexDirection: 'row',
    alignItems: 'center',
  },
    scrollView: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
    },
    paymentMethodCard: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
        marginRight: 12,
    },
    paymentMethodContent: {
        flex: 1,
    },
    paymentMethodTitle: {
    fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    paymentMethodDetails: {
        fontSize: 14,
    },
    removeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    addButton: {
    flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        borderRadius: 12,
        marginTop: 16,
  },
    addButtonText: {
        color: '#FFFFFF',
    fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    skeletonContainer: {
        width: '100%',
        marginTop: 20,
    },
    skeletonMethod: {
        marginBottom: 12,
        borderRadius: 8,
    },
    emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
        padding: 32,
    },
    emptyText: {
        marginTop: 16,
        fontSize: 16,
        textAlign: 'center',
  },
});
import Logger from '../../utils/Logger';
import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ScrollView,
    Linking,
    Platform,
    Modal,
    ActivityIndicator,
    TextInput,
    Animated,
    AppState
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
// import { useTranslation } from 'react-i18next';
import WebSocketManager from '../../services/WebSocketManager';
import RatingModal from '../common/RatingModal';
import TripDataService from '../../services/TripDataService';
import PersistentRideNotificationService from '../../services/PersistentRideNotificationService';
import RideLocationManager from '../../services/RideLocationManager';
import ReceiptService from '../../services/ReceiptService';
import database from '@react-native-firebase/database';
import firestore from '@react-native-firebase/firestore';
import storage from '@react-native-firebase/storage';
import messaging from '@react-native-firebase/messaging';
// import DocumentPicker from 'react-native-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { fonts } from '../../common-local/font';
import { useTheme } from '../../common-local/theme';
import Typography from '../design-system/Typography';
import AnimatedButton from '../design-system/AnimatedButton';
import RideRequestModal from './RideRequestModal'; // Adicionado import para RideRequestModal
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GetDistance } from '../../common-local/other/GeoFunctions';
import { isKYCEnabled } from '../../config/kycConfig';
import VehicleService from '../../services/VehicleService';
import PermissionExplanationModal from '../PermissionExplanationModal';
import LocationPermissionBanner from '../LocationPermissionBanner';
import NetworkStatusBanner from '../NetworkStatusBanner';
import ProfileToggle from '../ProfileToggle';

// Cores padronizadas do onboarding
const colors = {
    black: '#000000',
    grey80: '#333333',
    greyPlaceholder: '#BDBDBD',
    leafGreen: '#003002',
    white: '#FFFFFF',
    lightGrey: '#F5F5F5',
    error: '#FF3B30'
};

// Função temporária para Icon (substituir por import real se necessário)
const Icon = ({ name, type, color, size }) => {
    return <Ionicons name={name} color={color} size={size} />;
};

// ✅ Componente de Loading Screen
const DriverLoadingScreen = ({ userName }) => {
    const theme = useTheme();
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.8)).current;

    useEffect(() => {
        // Fade in do texto
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.spring(scaleAnim, {
                toValue: 1,
                tension: 50,
                friction: 7,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    return (
        <View style={[loadingStyles.container, { backgroundColor: theme.primary || '#003002' }]}>
            <Animated.View
                style={[
                    loadingStyles.content,
                    {
                        opacity: fadeAnim,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}
            >
                <Typography variant="h1" color="#FFFFFF" align="center">
                    Bem vindo, {userName}
                </Typography>

                <View style={loadingStyles.loadingContainer}>
                    <ActivityIndicator size="large" color="#FFFFFF" />
                </View>
            </Animated.View>
        </View>
    );
};

function DriverUI(props) {
    // Função de tradução temporária
    const t = (key) => key;
    const theme = useTheme();
    const dispatch = useDispatch();
    // ✅ OTIMIZAÇÃO: Usar shallowEqual para evitar re-renders quando objetos são iguais
    const auth = useSelector(state => state.auth, shallowEqual);
    const driverId = auth?.profile?.uid || auth?.uid || auth?.user?.uid;

    const { isDarkMode, toggleTheme, currentLocation, onBottomSheetStateChange, navigation, locationDenied } = props;

    // Refs para BottomSheets
    const documentsBottomSheetRef = useRef(null);
    const vehicleBottomSheetRef = useRef(null);
    const rideHistoryBottomSheetRef = useRef(null);

    // Snap points para os BottomSheets
    const documentsSnapPoints = ['85%'];
    const vehicleSnapPoints = ['70%'];
    const rideHistorySnapPoints = ['85%'];

    // Backdrop para fechar os BottomSheets
    const renderDocumentsBackdrop = useCallback(
        (props) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
                onPress={closeDocumentsBottomSheet}
            />
        ),
        []
    );

    const renderVehicleBackdrop = useCallback(
        (props) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
                onPress={closeVehicleBottomSheet}
            />
        ),
        []
    );


    const renderRideHistoryBackdrop = useCallback(
        (props) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
                onPress={() => rideHistoryBottomSheetRef.current?.close()}
            />
        ),
        []
    );

    // ✅ Função para buscar histórico de corridas do motorista
    const fetchRideHistory = useCallback(async () => {
        if (!auth.profile?.uid) {
            Logger.warn('⚠️ [DriverUI] Não é possível buscar histórico: usuário não autenticado');
            return;
        }

        setIsLoadingRideHistory(true);
        try {
            const driverId = auth.profile.uid;
            Logger.log('📊 [DriverUI] Buscando histórico de corridas para motorista:', driverId);

            // Tentar buscar do Firestore primeiro (mais eficiente)
            try {
                const ridesSnapshot = await firestore()
                    .collection('rides')
                    .where('driverId', '==', driverId)
                    .where('status', '==', 'completed')
                    .orderBy('completedAt', 'desc')
                    .limit(50)
                    .get();

                if (!ridesSnapshot.empty) {
                    const rides = ridesSnapshot.docs.map(doc => {
                        const data = doc.data();
                        return {
                            id: doc.id,
                            bookingId: data.bookingId || data.rideId || doc.id,
                            pickup: data.pickupLocation || data.pickup,
                            drop: data.destinationLocation || data.drop || data.endLocation,
                            fare: data.finalPrice || data.fare || data.estimatedFare || 0,
                            distance: data.distance || null,
                            duration: data.duration || null,
                            completedAt: data.completedAt?.toDate?.() || new Date(data.completedAt || data.createdAt?.toDate?.() || Date.now()),
                            status: data.status || 'completed',
                            passengerName: data.passengerName || data.passenger?.name || 'Passageiro',
                            carType: data.carType || 'standard'
                        };
                    });

                    setRideHistory(rides);
                    Logger.log(`✅ [DriverUI] ${rides.length} corridas encontradas no Firestore`);
                    setIsLoadingRideHistory(false);
                    return;
                }
            } catch (firestoreError) {
                Logger.warn('⚠️ [DriverUI] Erro ao buscar do Firestore, tentando API Node fallback:', firestoreError);
            }

            // Fallback: Buscar da API do Node.js (que lê do Redis ou DB seguro)
            try {
                const { api } = require('../../common-local/api');
                const response = await api.get(`/driver/history/${driverId}?limit=50`);

                if (response.data && response.data.success && response.data.trips) {
                    const trips = response.data.trips.map(tripData => ({
                        id: tripData.id || tripData.bookingId,
                        bookingId: tripData.bookingId || tripData.id,
                        pickup: tripData.pickup || {},
                        drop: tripData.drop || {},
                        fare: tripData.payment?.finalFare || tripData.payment?.estimatedFare || 0,
                        distance: tripData.payment?.distance || null,
                        duration: tripData.payment?.duration || null,
                        completedAt: tripData.timestamps?.completedAt ? new Date(tripData.timestamps.completedAt) : new Date(tripData.updatedAt || Date.now()),
                        status: tripData.status || 'completed',
                        passengerName: tripData.passenger?.name || 'Passageiro',
                        carType: tripData.carType || 'standard'
                    }));

                    setRideHistory(trips);
                    Logger.log(`✅ [DriverUI] ${trips.length} corridas encontradas via Node API`);
                } else {
                    Logger.log('ℹ️ [DriverUI] Nenhuma corrida encontrada no API Fallback');
                    setRideHistory([]);
                }
            } catch (apiError) {
                Logger.error('❌ [DriverUI] Erro ao buscar da API Node:', apiError);
                setRideHistory([]);
            }

        } catch (error) {
            Logger.error('❌ [DriverUI] Erro ao buscar histórico de corridas:', error);
            setRideHistory([]);
        } finally {
            setIsLoadingRideHistory(false);
        }
    }, [auth.profile?.uid]);

    // Funções para histórico de corridas
    const openRideHistoryBottomSheet = useCallback(() => {
        if (rideHistoryBottomSheetRef.current) {
            rideHistoryBottomSheetRef.current.expand();
            // Buscar histórico quando abrir o BottomSheet
            fetchRideHistory();
        }
    }, [fetchRideHistory]);


    const closeRideHistoryBottomSheet = useCallback(() => {
        if (rideHistoryBottomSheetRef.current) {
            rideHistoryBottomSheetRef.current.close();
        }
    }, []);

    // Estados
    const [isOnline, setIsOnline] = useState(false); // Estado inicial: offline (será carregado do AsyncStorage)
    const [currentRide, setCurrentRide] = useState(null);
    const [isApproved, setIsApproved] = useState(false); // Status de aprovação do driver
    const [isLoading, setIsLoading] = useState(true); // ✅ Estado de loading inicial
    const [showBackgroundLocationModal, setShowBackgroundLocationModal] = useState(false); // ✅ Modal de background location
    const [showBackgroundLocationBanner, setShowBackgroundLocationBanner] = useState(false); // ✅ Banner quando background location negada

    // ✅ Estado para status da conexão WebSocket (VISÍVEL)
    const [connectionStatus, setConnectionStatus] = useState({
        connected: false,
        authenticated: false,
        canReceiveRequests: false,
        socketId: null
    });

    // Refs para autenticação (evitar múltiplas tentativas simultâneas)
    const isAuthenticatingRef = useRef(false);
    const retryTimeoutRef = useRef(null);

    // Refs para throttling de localização
    const lastLocationRef = useRef(null);
    const lastUpdateTimeRef = useRef(0);

    // Estados para gerenciar reservas e viagens
    const [availableBookings, setAvailableBookings] = useState([]);
    const [tripStatus, setTripStatus] = useState('idle'); // idle, searching, accepted, started, completed
    const [currentBooking, setCurrentBooking] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);

    // Estado para modal de avaliação
    const [ratingModalVisible, setRatingModalVisible] = useState(false);

    // ✅ NOVO: Estados para chat
    const [messageText, setMessageText] = useState('');
    const [chatMessages, setChatMessages] = useState([]);

    // Estados para documentos e veículos
    const [documentStatus, setDocumentStatus] = useState({
        cnh: 'pending', // pending, uploaded, analyzing
        residence: 'pending', // pending, uploaded, analyzing
        vehicle: 'pending' // pending, uploaded, analyzing
    });

    // ✅ Estado para histórico de corridas
    const [rideHistory, setRideHistory] = useState([]);
    const [isLoadingRideHistory, setIsLoadingRideHistory] = useState(false);
    const [timer, setTimer] = useState(15); // Timer de 15 segundos
    const [isTimerActive, setIsTimerActive] = useState(true); // Controla se o timer está ativo
    const [currentRideRequest, setCurrentRideRequest] = useState(null); // Solicitação de viagem atual
    const [rideStatus, setRideStatus] = useState('idle'); // idle, accepted, enRoute, atPickup, inProgress, completed
    const [pickupTimer, setPickupTimer] = useState(120); // 2 minutos para embarque
    const [isPickupTimerActive, setIsPickupTimerActive] = useState(false);
    const [driverCurrentLocation, setDriverCurrentLocation] = useState(null); // Localização atual do motorista

    // Estado para mock de notificação do sistema (preview)
    const [showSystemNotificationMock, setShowSystemNotificationMock] = useState(false);
    const [isNotificationExpanded, setIsNotificationExpanded] = useState(false);
    const [mockBookingId] = useState('mock_booking_' + Date.now());
    const [mockArrivedAtPickup, setMockArrivedAtPickup] = useState(false);
    const [mockTripStarted, setMockTripStarted] = useState(false);
    const [mockEstimatedArrival, setMockEstimatedArrival] = useState(null);
    const [mockArrivedAtDestination, setMockArrivedAtDestination] = useState(false);

    // Estado para modal de escolha de navegação
    const [navigationModalVisible, setNavigationModalVisible] = useState(false); // false por padrão
    const [navigationDestination, setNavigationDestination] = useState(null);
    const [navigationPassengerName, setNavigationPassengerName] = useState('');
    const [navigationType, setNavigationType] = useState('pickup'); // 'pickup' ou 'destination'

    // Estados para controlar z-index dinâmico
    const [isDocumentsBottomSheetOpen, setIsDocumentsBottomSheetOpen] = useState(false);
    const [isVehicleBottomSheetOpen, setIsVehicleBottomSheetOpen] = useState(false);

    // Estado para ganhos do motorista
    const [driverEarnings, setDriverEarnings] = useState(0.00);
    const [isLoadingBalance, setIsLoadingBalance] = useState(true);
    const [balanceModalVisible, setBalanceModalVisible] = useState(false);
    const [transactionHistory, setTransactionHistory] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Importar serviço de saldo (usando require para evitar problemas de importação)
    let DriverBalanceService;
    try {
        DriverBalanceService = require('../../services/DriverBalanceService').default;
    } catch (error) {
        Logger.warn('⚠️ DriverBalanceService não disponível:', error);
        DriverBalanceService = {
            getDriverBalance: async () => ({ success: false, error: 'Serviço não disponível' }),
            getTransactionHistory: async () => ({ success: false, error: 'Serviço não disponível' })
        };
    }

    // Função para calcular o valor líquido do motorista
    const calculateDriverNetValue = (totalFare) => {
        Logger.log('💰 DriverUI - Calculando valor líquido para motorista:', totalFare);

        // Taxa operacional baseada no valor da corrida (3 faixas)
        let operationalCost;
        if (totalFare <= 10.00) {
            // Até R$ 10,00
            operationalCost = 0.79;
        } else if (totalFare <= 25.00) {
            // Acima de R$ 10,00 e abaixo de R$ 25,00
            operationalCost = 0.99;
        } else {
            // Acima de R$ 25,00
            operationalCost = 1.49;
        }

        // Taxa Woovi: 0,8% com mínimo de R$ 0,50
        const wooviTax = Math.max(totalFare * 0.008, 0.50);

        // Valor líquido para o motorista
        const driverNetValue = totalFare - operationalCost - wooviTax;

        Logger.log('💰 DriverUI - Detalhamento do cálculo:', {
            totalFare: `R$ ${totalFare.toFixed(2)}`,
            operationalCost: `R$ ${operationalCost.toFixed(2)}`,
            wooviTax: `R$ ${wooviTax.toFixed(2)}`,
            driverNetValue: `R$ ${driverNetValue.toFixed(2)}`
        });

        return {
            totalFare,
            operationalCost,
            wooviTax,
            driverNetValue
        };
    };

    // Função para carregar ganhos do motorista (agora usa API real)
    const loadDriverEarnings = async () => {
        try {
            setIsLoadingBalance(true);
            // ✅ CORREÇÃO: Usar auth.profile?.uid ao invés de auth?.uid
            const driverId = auth?.profile?.uid || auth?.uid;

            if (!driverId) {
                Logger.warn('⚠️ DriverUI - driverId não disponível', {
                    auth: auth ? { hasProfile: !!auth.profile, hasUid: !!auth.uid } : 'null'
                });
                setDriverEarnings(0.00);
                return;
            }

            Logger.log('💰 DriverUI - Buscando saldo para driverId:', driverId);
            const result = await DriverBalanceService.getDriverBalance(driverId);

            if (result.success) {
                setDriverEarnings(result.balance || 0.00);
                Logger.log('✅ DriverUI - Saldo carregado:', result.balance);
            } else {
                Logger.error('❌ Erro ao carregar saldo:', result.error);
                // ✅ Não definir como 0.00 se for erro de rede, manter valor anterior
                if (result.error && !result.error.includes('Network request failed')) {
                    setDriverEarnings(0.00);
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar ganhos:', error);
            // ✅ Não definir como 0.00 se for erro de rede, manter valor anterior
            if (error.message && !error.message.includes('Network request failed')) {
                setDriverEarnings(0.00);
            }
        } finally {
            setIsLoadingBalance(false);
        }
    };

    // Função para carregar histórico de transações
    const loadTransactionHistory = async () => {
        try {
            setIsLoadingHistory(true);
            // ✅ CORREÇÃO: Usar auth.profile?.uid ao invés de auth?.uid
            const driverId = auth?.profile?.uid || auth?.uid;

            if (!driverId) {
                Logger.warn('⚠️ DriverUI - driverId não disponível para histórico');
                return;
            }

            const result = await DriverBalanceService.getTransactionHistory(driverId, 50);

            if (result.success) {
                setTransactionHistory(result.transactions || []);
            } else {
                Logger.error('❌ Erro ao carregar histórico:', result.error);
            }
        } catch (error) {
            Logger.error('❌ Erro ao carregar histórico:', error);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Abrir modal de saldo e carregar histórico
    const openBalanceModal = async () => {
        setBalanceModalVisible(true);
        await loadTransactionHistory();
    };

    // Carregar ganhos do motorista ao montar componente
    useEffect(() => {
        // ✅ CORREÇÃO: Usar auth.profile?.uid ao invés de auth?.uid
        const driverId = auth?.profile?.uid || auth?.uid;
        if (driverId) {
            loadDriverEarnings();

            // Recarregar saldo a cada 30 segundos
            const interval = setInterval(() => {
                loadDriverEarnings();
            }, 30000);

            return () => clearInterval(interval);
        }
    }, [auth?.profile?.uid, auth?.uid]);


    // ===== FUNÇÃO HELPER: Normalizar dados do servidor para formato do componente =====
    // Normaliza diferentes formatos de dados do servidor para o formato esperado pelo componente
    // Isso garante compatibilidade mesmo se o formato do servidor mudar
    const normalizeBookingData = useCallback((data) => {
        // Se já está no formato normalizado (pickup.add existe), retorna como está
        if (data.pickup?.add && data.drop?.add && data.estimate !== undefined) {
            return { ...data };
        }

        // Normalizar: formato do servidor → formato do componente
        return {
            ...data,
            // ✅ NORMALIZAR bookingId (servidor pode enviar bookingId ou rideId)
            bookingId: data.bookingId || data.rideId || data.id,
            // ✅ PRESERVAR customerId e customer (importante para chat)
            customerId: data.customerId || data.customer || data.passengerId,
            customer: data.customer || data.customerId || data.passengerId,
            // Normalizar pickup (servidor envia pickupLocation com add, lat, lng)
            pickup: {
                add: data.pickupLocation?.add || data.pickupLocation?.address || data.pickup?.add || 'Endereço não disponível',
                lat: data.pickupLocation?.lat || data.pickup?.lat,
                lng: data.pickupLocation?.lng || data.pickup?.lng
            },
            // Normalizar drop (servidor envia destinationLocation com add, lat, lng)
            drop: {
                add: data.destinationLocation?.add || data.destinationLocation?.address || data.drop?.add || 'Endereço não disponível',
                lat: data.destinationLocation?.lat || data.drop?.lat,
                lng: data.destinationLocation?.lng || data.drop?.lng
            },
            // Normalizar estimate (servidor envia estimatedFare)
            estimate: data.estimatedFare ?? data.estimate ?? 0,
            // Garantir que distance existe
            distance: data.distance ?? 0
        };
    }, []);

    // WebSocket - Sistema completo de eventos para motorista
    useEffect(() => {
        const webSocketManager = WebSocketManager.getInstance();

        // ===== HANDLERS PARA EVENTOS DE MOTORISTA =====

        // 1. Nova reserva disponível
        const handleNewBookingAvailable = (data) => {
            try {
                // ✅ LOG CRÍTICO: Rastrear recebimento de evento
                Logger.log('📨 [DriverUI] EVENTO RECEBIDO: newRideRequest/newBookingAvailable', {
                    timestamp: new Date().toISOString(),
                    rawData: data,
                    hasBookingId: !!data?.bookingId || !!data?.rideId,
                    bookingId: data?.bookingId || data?.rideId,
                    connectionStatus: webSocketManager.getConnectionStatus()
                });

                // ✅ NORMALIZAR primeiro (para garantir que bookingId existe, mesmo se vier como rideId)
                const normalizedBooking = normalizeBookingData(data);

                // ✅ VALIDAÇÃO: Verificar bookingId obrigatório (após normalização)
                if (!normalizedBooking.bookingId) {
                    Logger.error('❌ [DriverUI] Booking sem ID (mesmo após normalização), ignorando:', {
                        originalData: data,
                        normalizedBooking: normalizedBooking
                    });
                    return;
                }

                Logger.log('✅ [DriverUI] Booking normalizado com sucesso:', {
                    bookingId: normalizedBooking.bookingId,
                    pickup: normalizedBooking.pickup,
                    drop: normalizedBooking.drop,
                    estimate: normalizedBooking.estimate
                });

                // Calcular valor líquido para o motorista (já normalizado)
                const driverValues = calculateDriverNetValue(normalizedBooking.estimate);

                // Calcular distância e tempo até embarque usando posição atual do motorista
                let pickupDistance = '0.5'; // Default
                let pickupTime = '3'; // Default

                // Se temos posição atual do motorista e coordenadas de pickup, calcular distância real
                if (currentLocation && normalizedBooking.pickup?.lat && normalizedBooking.pickup?.lng) {
                    // Calcular distância do motorista até o ponto de pickup usando função existente
                    const distanceKm = GetDistance(
                        currentLocation.lat,
                        currentLocation.lng,
                        normalizedBooking.pickup.lat,
                        normalizedBooking.pickup.lng
                    );

                    pickupDistance = distanceKm.toFixed(1);

                    // Calcular tempo estimado (considerando velocidade média de 35 km/h em tráfego urbano)
                    // Velocidade média: 35 km/h = ~0.583 km/min
                    const speedKmPerMin = 0.583;
                    const estimatedMinutes = Math.max(1, Math.round(distanceKm / speedKmPerMin));
                    pickupTime = estimatedMinutes.toString();

                    Logger.log('📍 Cálculo de distância até pickup:', {
                        driverLocation: { lat: currentLocation.lat, lng: currentLocation.lng },
                        pickupLocation: { lat: normalizedBooking.pickup.lat, lng: normalizedBooking.pickup.lng },
                        distanceKm: pickupDistance,
                        estimatedMinutes: pickupTime
                    });
                } else {
                    // Fallback: usar distância total da corrida se disponível (menos preciso)
                    if (normalizedBooking.distance) {
                        pickupDistance = (normalizedBooking.distance / 1000).toFixed(1);
                        pickupTime = Math.max(1, Math.round(normalizedBooking.distance / 200)).toString(); // 200m/min
                    }
                    Logger.warn('⚠️ Sem coordenadas precisas, usando cálculo aproximado:', {
                        hasCurrentLocation: !!currentLocation,
                        hasPickupCoords: !!(normalizedBooking.pickup?.lat && normalizedBooking.pickup?.lng)
                    });
                }

                // Obter categoria do tipo de corrida ou padrão
                const category = normalizedBooking.rideType || normalizedBooking.carType || 'Leaf Plus';

                // Calcular horário estimado de chegada (simulado - em produção viria do cálculo de rota)
                const now = new Date();
                const estimatedArrivalMinutes = parseInt(pickupTime) + 15; // 15 min de viagem estimada
                now.setMinutes(now.getMinutes() + estimatedArrivalMinutes);
                const estimatedArrival = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                // Converter para formato do card completo
                const rideRequestData = {
                    value: driverValues.driverNetValue.toFixed(2),
                    category: category,
                    passengerRating: '4.8', // Default - em produção viria do backend
                    pickupTime: pickupTime.toString(),
                    pickupDistance: pickupDistance,
                    pickupAddress: normalizedBooking.pickup.add,
                    destinationAddress: normalizedBooking.drop.add,
                    bookingId: normalizedBooking.bookingId, // Guardar ID para usar ao aceitar
                    estimatedArrival: estimatedArrival,
                    // Salvar coordenadas para uso em navegação e cálculo de distância
                    pickup: normalizedBooking.pickup,
                    drop: normalizedBooking.drop,
                    distance: normalizedBooking.distance,
                    estimate: normalizedBooking.estimate
                };

                // ✅ CRÍTICO: Limpar lista ANTES de setar currentRideRequest (evitar race condition)
                // Usar callback para garantir ordem de execução
                setAvailableBookings([]);

                // Pequeno delay para garantir que a lista foi limpa antes de mostrar card completo
                setTimeout(() => {
                    setCurrentRideRequest(rideRequestData);
                    setRideStatus('idle');
                    setTimer(15);
                    setIsTimerActive(true);
                }, 0);

            } catch (error) {
                Logger.error('❌ Erro ao processar nova reserva:', error, data);
                Alert.alert(
                    'Não foi possível processar a solicitação',
                    'Por favor, verifique sua conexão e tente novamente. Se o problema persistir, entre em contato com o suporte.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 2. Reserva aceita com sucesso
        const handleRideAccepted = (data) => {
            try {
                if (data.success) {
                    // ✅ VALIDAÇÃO: Verificar se booking existe
                    if (!data.booking || !data.booking.bookingId) {
                        Logger.error('❌ Booking inválido em rideAccepted:', data);
                        return;
                    }

                    // ✅ NORMALIZAR: Normalizar booking antes de salvar no estado
                    const normalizedBooking = normalizeBookingData(data.booking);

                    setCurrentBooking(normalizedBooking);
                    setTripStatus('accepted');

                    // ✅ LIMPAR CARD: Esconder card de viagem após aceitar
                    setCurrentRideRequest(null);
                    setIsTimerActive(false);
                    setTimer(0);

                    // ✅ Iniciar tracking completo da corrida
                    if (data.booking?.bookingId) {
                        TripDataService.startTripTracking(data.booking.bookingId, {
                            driverId: auth.profile?.uid,
                            driverName: auth.profile?.name || auth.profile?.displayName,
                            driverPhone: auth.profile?.phone,
                            driverPhoto: auth.profile?.photoURL,
                            vehicleBrand: normalizedBooking.vehicleBrand,
                            vehicleModel: normalizedBooking.vehicleModel,
                            vehicleColor: normalizedBooking.vehicleColor,
                            vehiclePlate: normalizedBooking.vehiclePlate,
                            passengerId: normalizedBooking.customer || normalizedBooking.passengerId,
                            passengerName: normalizedBooking.customerName || normalizedBooking.passengerName,
                            pickup: normalizedBooking.pickup,
                            drop: normalizedBooking.drop,
                            estimatedFare: normalizedBooking.estimate,
                            status: 'accepted',
                            acceptedAt: new Date().toISOString(),
                            platform: Platform.OS
                        }).catch(err => {
                            Logger.warn('⚠️ [DriverUI] Erro ao iniciar tracking:', err);
                        });
                    }

                    // Remover da lista de disponíveis
                    setAvailableBookings(prev =>
                        prev.filter(b => b.bookingId !== data.bookingId)
                    );

                    // Calcular valor líquido para o motorista (já normalizado)
                    const driverValues = calculateDriverNetValue(normalizedBooking.estimate);

                    Alert.alert(
                        '🚗 CORRIDA ACEITA!',
                        'Dirija-se ao local de partida.\n\n' +
                        `💰 DETALHES FINANCEIROS:\n` +
                        `• Valor da corrida: R$ ${driverValues.totalFare.toFixed(2)}\n` +
                        `• Custo operacional: R$ ${driverValues.operationalCost.toFixed(2)}\n` +
                        `• Taxa PIX: R$ ${driverValues.wooviTax.toFixed(2)}\n` +
                        `🚗 VOCÊ RECEBERÁ: R$ ${driverValues.driverNetValue.toFixed(2)}`,
                        [{ text: 'OK' }]
                    );
                }
            } catch (error) {
                Logger.error('❌ Erro ao processar reserva aceita:', error, data);
                Alert.alert(
                    'Erro',
                    'Não foi possível processar a aceitação da corrida.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 3. Reserva rejeitada com sucesso
        const handleRideRejected = (data) => {
            Logger.log('❌ Reserva rejeitada:', data);
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
            Logger.log('🚀 Viagem iniciada:', data);
            setTripStatus('started');

            // ✅ ENVIAR NOTIFICAÇÃO INTERATIVA: Quando viagem inicia, enviar notificação com ações
            if (currentBooking?.bookingId) {
                try {
                    const InteractiveNotificationService = require('../../services/InteractiveNotificationService').default;
                    InteractiveNotificationService.createSystemNotification({
                        title: '🚗 Corrida iniciada',
                        body: 'Você pode notificar chegada ao local ou iniciar a corrida',
                        data: {
                            type: 'trip_started',
                            bookingId: currentBooking.bookingId,
                            driverId: auth.profile?.uid,
                        },
                        categoryId: 'TRIP_STARTED',
                        channelId: 'driver_actions',
                    }).catch(error => {
                        Logger.warn('⚠️ [DriverUI] Erro ao criar notificação interativa:', error);
                    });
                } catch (error) {
                    Logger.warn('⚠️ [DriverUI] Erro ao criar notificação interativa:', error);
                }
            }

            Alert.alert(
                'Viagem Iniciada!',
                'A viagem foi iniciada com sucesso!',
                [{ text: 'OK' }]
            );
        };

        // 5. Viagem finalizada
        const handleTripCompleted = (data) => {
            try {
                Logger.log('🏁 Viagem finalizada (raw):', data);
                setTripStatus('completed');

                // ✅ CRÍTICO: Normalizar fare (servidor pode enviar fare, actualFare, totalFare, estimate)
                // Usar setCurrentBooking com callback para acessar estado atual
                setCurrentBooking(prev => {
                    const actualFare = data.fare ?? data.actualFare ?? data.totalFare ?? data.estimate ??
                        prev?.estimate ?? 0;
                    Logger.log('🏁 Viagem finalizada - fare normalizado:', actualFare);

                    // Calcular valor líquido para o motorista (já normalizado)
                    const driverValues = calculateDriverNetValue(actualFare);

                    // Salvar fare final no currentBooking
                    const updatedBooking = prev ? { ...prev, finalFare: actualFare } : null;

                    const distanceText = data.distance ? `${data.distance}km` : 'Distância não disponível';

                    Alert.alert(
                        '🏁 VIAGEM FINALIZADA!',
                        `📏 Distância: ${distanceText}\n` +
                        `💰 Valor da corrida: R$ ${driverValues.totalFare.toFixed(2)}\n\n` +
                        `💸 DETALHES FINANCEIROS:\n` +
                        `• Custo operacional: R$ ${driverValues.operationalCost.toFixed(2)}\n` +
                        `• Taxa PIX: R$ ${driverValues.wooviTax.toFixed(2)}\n` +
                        `🚗 VOCÊ RECEBERÁ: R$ ${driverValues.driverNetValue.toFixed(2)}\n\n` +
                        `Avalie o passageiro para melhorar o serviço.`,
                        [
                            {
                                text: 'Ver Recibo', onPress: () => {
                                    if (navigation && navigation.navigate && data.bookingId) {
                                        navigation.navigate('Receipt', { rideId: data.bookingId });
                                    }
                                }
                            },
                            { text: 'Avaliar Passageiro', onPress: () => showRatingModal() },
                            { text: 'OK' }
                        ]
                    );

                    return updatedBooking;
                });
            } catch (error) {
                Logger.error('❌ Erro ao processar viagem finalizada:', error, data);
                Alert.alert(
                    'Erro',
                    'Não foi possível processar a finalização da viagem.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 6. Pagamento confirmado
        const handlePaymentConfirmed = (data) => {
            try {
                Logger.log('💳 Pagamento confirmado (raw):', data);

                // ✅ CRÍTICO: Salvar fare ANTES de limpar estado (usa callback para acessar estado atual)
                setCurrentBooking(prev => {
                    const finalFare = data.fare ?? data.actualFare ?? data.totalFare ?? data.amount ??
                        prev?.finalFare ?? prev?.estimate ?? 0;
                    Logger.log('💳 Pagamento confirmado - fare:', finalFare);

                    // Calcular valor líquido para o motorista ANTES de limpar estado
                    let paymentInfo = '';
                    if (finalFare > 0) {
                        const driverValues = calculateDriverNetValue(finalFare);
                        paymentInfo = `\n\n💰 DETALHES DO PAGAMENTO:\n` +
                            `• Valor da corrida: R$ ${driverValues.totalFare.toFixed(2)}\n` +
                            `• Custo operacional: R$ ${driverValues.operationalCost.toFixed(2)}\n` +
                            `• Taxa PIX: R$ ${driverValues.wooviTax.toFixed(2)}\n` +
                            `🚗 VOCÊ RECEBERÁ: R$ ${driverValues.driverNetValue.toFixed(2)}`;
                    }

                    // Mostrar alerta ANTES de limpar (dentro do callback)
                    setTimeout(() => {
                        Alert.alert(
                            '💳 PAGAMENTO CONFIRMADO!',
                            `O passageiro confirmou o pagamento. Viagem finalizada!${paymentInfo}`,
                            [{ text: 'OK' }]
                        );
                    }, 100);

                    // Retornar null para limpar estado
                    return null;
                });

                // Limpar outros estados
                setTripStatus('idle');
                setCurrentRide(null);
            } catch (error) {
                Logger.error('❌ Erro ao processar pagamento confirmado:', error, data);
                Alert.alert(
                    'Erro',
                    'Não foi possível processar a confirmação de pagamento.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 7. Avaliação recebida
        const handleRatingReceived = (data) => {
            Logger.log('⭐ Avaliação recebida:', data);

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

        // ✅ NOVO: Handler para receber mensagens do chat (apenas durante corrida ativa)
        const handleNewMessage = (data) => {
            Logger.log('💬 [DriverUI] Nova mensagem recebida:', data);
            const bookingId = currentRideRequest?.bookingId || currentBooking?.bookingId;
            const isRideActive = rideStatus === 'enRoute' || rideStatus === 'atPickup' || rideStatus === 'inProgress' ||
                tripStatus === 'accepted' || tripStatus === 'started';

            // ✅ IMPORTANTE: Só processar mensagens se a corrida estiver ativa
            if (data.success && data.message && data.bookingId === bookingId && isRideActive) {
                const newMessage = {
                    id: data.messageId || `msg_${Date.now()}`,
                    text: data.message,
                    senderId: data.senderId,
                    senderType: data.senderType || (data.senderId === auth.profile?.uid ? 'driver' : 'passenger'),
                    timestamp: data.timestamp || new Date().toISOString(),
                    isOwn: data.senderId === auth.profile?.uid
                };

                setChatMessages(prev => [...prev, newMessage]);

                // ✅ IMPORTANTE: Salvar mensagem no banco para registro e auditoria
                if (bookingId) {
                    const TripDataService = require('../../services/TripDataService').default;
                    TripDataService.addChatMessage(bookingId, {
                        senderId: data.senderId,
                        senderType: newMessage.senderType,
                        message: data.message,
                        timestamp: newMessage.timestamp
                    }).catch(err => {
                        Logger.warn('⚠️ [DriverUI] Erro ao salvar mensagem recebida:', err);
                    });
                }
            } else if (rideStatus === 'completed' || tripStatus === 'completed' || tripStatus === 'idle') {
                // ✅ Ignorar mensagens se a corrida já terminou (mas já foram salvas no banco)
                Logger.log('ℹ️ [DriverUI] Mensagem recebida após corrida finalizada, ignorando da UI (já salva no banco)');
            }
        };

        // ===== REGISTRAR TODOS OS EVENTOS =====
        webSocketManager.on('rideRequest', handleNewBookingAvailable); // Evento recebido do backend
        webSocketManager.on('newBookingAvailable', handleNewBookingAvailable);
        webSocketManager.on('newRideRequest', handleNewBookingAvailable); // ✅ Evento do DriverNotificationDispatcher
        webSocketManager.on('rideAccepted', handleRideAccepted);
        webSocketManager.on('rideRejected', handleRideRejected);
        webSocketManager.on('tripStarted', handleTripStarted);
        webSocketManager.on('tripCompleted', handleTripCompleted);
        webSocketManager.on('paymentConfirmed', handlePaymentConfirmed);
        webSocketManager.on('ratingReceived', handleRatingReceived);
        webSocketManager.on('newMessage', handleNewMessage); // ✅ NOVO: Listener para mensagens do chat

        // ===== REGISTRAR EVENTOS DO WEBSOCKET =====
        // Nota: A autenticação agora é feita no useEffect separado baseado em isOnline

        // ===== CLEANUP =====
        return () => {
            webSocketManager.off('rideRequest', handleNewBookingAvailable);
            webSocketManager.off('newBookingAvailable', handleNewBookingAvailable);
            webSocketManager.off('newRideRequest', handleNewBookingAvailable); // ✅ Cleanup
            webSocketManager.off('rideAccepted', handleRideAccepted);
            webSocketManager.off('rideRejected', handleRideRejected);
            webSocketManager.off('newMessage', handleNewMessage); // ✅ NOVO: Cleanup do listener de mensagens
            webSocketManager.off('tripStarted', handleTripStarted);
            webSocketManager.off('tripCompleted', handleTripCompleted);
            webSocketManager.off('paymentConfirmed', handlePaymentConfirmed);
            webSocketManager.off('ratingReceived', handleRatingReceived);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.profile?.uid, normalizeBookingData]);

    // ✅ Verificar status da permissão de background quando motorista fica online
    useEffect(() => {
        if (!isOnline) {
            setShowBackgroundLocationBanner(false);
            return;
        }

        const checkBackgroundPermission = async () => {
            try {
                const BackgroundLocationService = require('../../services/BackgroundLocationService').default;
                const instance = BackgroundLocationService.getInstance();
                const permissions = await instance.checkPermissions();

                if (!permissions.background) {
                    // Mostrar banner se permissão de background não foi concedida
                    setShowBackgroundLocationBanner(true);
                } else {
                    // Esconder banner se permissão foi concedida
                    setShowBackgroundLocationBanner(false);
                }
            } catch (error) {
                Logger.error('❌ [STATUS] Erro ao verificar permissão de background:', error);
            }
        };

        checkBackgroundPermission();

        // Verificar novamente quando app volta do foreground (usuário pode ter ativado nas configurações)
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'active') {
                checkBackgroundPermission();
            }
        });

        return () => {
            subscription?.remove();
        };
    }, [isOnline]);

    // ✅ ATUALIZAR STATUS DA CONEXÃO VISÍVEL (a cada 2 segundos)
    useEffect(() => {
        const updateConnectionStatus = () => {
            const webSocketManager = WebSocketManager.getInstance();
            const status = webSocketManager.getConnectionStatus();
            const canReceive = webSocketManager.canReceiveRideRequests();

            setConnectionStatus({
                connected: status.connected,
                authenticated: status.authenticated,
                canReceiveRequests: canReceive,
                socketId: status.socketId
            });

            // ✅ LOG CLARO DO STATUS COM DETALHES (só logar quando mudar ou quando houver problema)
            const isReady = status.connected && status.authenticated && canReceive;

            if (isReady) {
                // ✅ Só logar uma vez quando ficar pronto (não repetir)
                if (!connectionStatus.canReceiveRequests) {
                    Logger.log('✅ [STATUS] Driver PRONTO: Conectado + Autenticado + Pode receber solicitações');
                }
            } else {
                const details = {
                    connected: status.connected,
                    authenticated: status.authenticated,
                    canReceive: canReceive,
                    userId: status.userId,
                    userType: status.userType,
                    socketId: status.socketId
                };
                Logger.log('⚠️ [STATUS] Driver NÃO PRONTO:', details);

                // ✅ SE ESTÁ CONECTADO MAS NÃO AUTENTICADO, TENTAR AUTENTICAR
                if (status.connected && !status.authenticated && auth.profile?.uid && isOnline) {
                    Logger.log('🔄 [STATUS] Tentando autenticar automaticamente...');
                    webSocketManager.authenticate(auth.profile.uid, 'driver');
                }
            }
        };

        updateConnectionStatus();
        const interval = setInterval(updateConnectionStatus, 2000);
        return () => clearInterval(interval);
    }, [isOnline, auth.profile?.uid]);

    // ✅ AUTENTICAR SEMPRE QUE FICAR ONLINE (com retry, fallback e boas práticas)
    useEffect(() => {
        // Só autenticar se estiver online E tiver UID
        if (!isOnline || !auth.profile?.uid) {
            return;
        }

        // Limpar timeout anterior se existir
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }

        const maxRetries = 3;
        const baseDelay = 1000; // 1 segundo
        let retryCount = 0;

        const authenticateDriver = async (attempt = 1) => {
            // Evitar múltiplas tentativas simultâneas
            if (isAuthenticatingRef.current) {
                return;
            }

            // Verificar se ainda está online
            if (!isOnline) {
                isAuthenticatingRef.current = false;
                return;
            }

            isAuthenticatingRef.current = true;

            try {
                const webSocketManager = WebSocketManager.getInstance();

                // 1. Conectar se não estiver conectado (com retry)
                if (!webSocketManager.isConnected()) {
                    await webSocketManager.connect();

                    // Aguardar conexão estabelecida (com timeout)
                    const connectionEstablished = await new Promise((resolve) => {
                        if (webSocketManager.isConnected()) {
                            resolve(true);
                            return;
                        }

                        const checkConnection = setInterval(() => {
                            if (webSocketManager.isConnected()) {
                                clearInterval(checkConnection);
                                resolve(true);
                            }
                        }, 100);

                        // Timeout de 10 segundos
                        setTimeout(() => {
                            clearInterval(checkConnection);
                            resolve(false);
                        }, 10000);
                    });

                    if (!connectionEstablished) {
                        throw new Error('Timeout ao aguardar conexão WebSocket');
                    }
                }

                // 2. Autenticar (com retry)
                if (webSocketManager.isConnected()) {
                    if (!webSocketManager.socket) {
                        throw new Error('Socket não disponível');
                    }

                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Timeout de autenticação (10s)'));
                        }, 10000);

                        // ✅ Verificar conexão antes de autenticar
                        if (!webSocketManager.isConnected()) {
                            Logger.error('❌ WebSocket não conectado - não é possível autenticar');
                            reject(new Error('WebSocket não conectado'));
                            return;
                        }

                        Logger.log('🔐 Autenticando motorista:', auth.profile?.uid);

                        // ✅ Definir userType no WebSocketManager ANTES de autenticar
                        // Isso garante que canReceiveRideRequests() funcione corretamente
                        webSocketManager.authenticatedUserType = 'driver';
                        webSocketManager.authenticatedUserId = auth.profile.uid;

                        webSocketManager.socket.emit('authenticate', {
                            uid: auth.profile.uid,
                            userType: 'driver'
                        });

                        webSocketManager.socket.once('authenticated', (data) => {
                            clearTimeout(timeout);
                            if (data.success) {
                                Logger.log('✅ Motorista autenticado:', auth.profile?.uid);
                                // ✅ Garantir que o userType está definido após autenticação
                                if (!webSocketManager.authenticatedUserType) {
                                    webSocketManager.authenticatedUserType = 'driver';
                                }
                                retryCount = 0; // Reset contador em caso de sucesso
                                resolve(data);
                            } else {
                                reject(new Error(data.error || 'Falha na autenticação'));
                            }
                        });

                        webSocketManager.socket.once('error', (error) => {
                            clearTimeout(timeout);
                            reject(new Error(error.message || 'Erro na autenticação'));
                        });
                    });

                    // ✅ Sucesso - resetar flag
                    isAuthenticatingRef.current = false;
                    retryCount = 0;

                } else {
                    throw new Error('WebSocket não conectado após tentativa de conexão');
                }

            } catch (error) {
                Logger.error(`❌ Erro na tentativa ${attempt}/${maxRetries}:`, error.message);
                isAuthenticatingRef.current = false;

                // Retry com backoff exponencial
                if (attempt < maxRetries && isOnline) {
                    retryCount++;
                    const delay = baseDelay * Math.pow(2, retryCount - 1); // 1s, 2s, 4s

                    retryTimeoutRef.current = setTimeout(() => {
                        authenticateDriver(attempt + 1);
                    }, delay);
                } else {
                    Logger.error('❌ Máximo de tentativas de autenticação atingido');
                    retryCount = 0;
                    isAuthenticatingRef.current = false;
                }
            }
        };

        // Executar autenticação inicial
        authenticateDriver(1);

        // Cleanup: cancelar retry se componente desmontar ou dependências mudarem
        return () => {
            if (retryTimeoutRef.current) {
                clearTimeout(retryTimeoutRef.current);
                retryTimeoutRef.current = null;
            }
            isAuthenticatingRef.current = false;
        };
    }, [isOnline, auth.profile?.uid]);

    // ✅ REAUTENTICAR EM CASO DE RECONEXÃO DO WEBSOCKET
    useEffect(() => {
        if (!isOnline || !auth.profile?.uid) {
            return;
        }

        const webSocketManager = WebSocketManager.getInstance();

        // Listener para reconexão
        const handleReconnect = () => {
            // Aguardar um pouco para garantir que a conexão está estável
            setTimeout(async () => {
                if (webSocketManager.isConnected() && webSocketManager.socket) {
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                reject(new Error('Timeout de reautenticação (10s)'));
                            }, 10000);

                            webSocketManager.socket.emit('authenticate', {
                                uid: auth.profile.uid,
                                userType: 'driver'
                            });

                            webSocketManager.socket.once('authenticated', (data) => {
                                clearTimeout(timeout);
                                if (data.success) {
                                    Logger.log('✅ Motorista reautenticado após reconexão');
                                    resolve(data);
                                } else {
                                    reject(new Error(data.error || 'Falha na reautenticação'));
                                }
                            });
                        });
                    } catch (error) {
                        Logger.error('❌ Erro ao reautenticar após reconexão:', error);
                    }
                }
            }, 500);
        };

        // Registrar listener de reconexão
        webSocketManager.on('reconnect', handleReconnect);
        webSocketManager.on('connect', handleReconnect); // Também em nova conexão

        return () => {
            webSocketManager.off('reconnect', handleReconnect);
            webSocketManager.off('connect', handleReconnect);
        };
    }, [isOnline, auth.profile?.uid]);


    // Atualizar localização em tempo real quando online
    useEffect(() => {
        if (isOnline && currentLocation && driverId) {
            const webSocketManager = WebSocketManager.getInstance();

            if (!webSocketManager.isConnected()) {
                Logger.warn('⚠️ [DriverUI] WebSocket não conectado, tentando conectar...');
                webSocketManager.connect().catch(err => {
                    Logger.error('❌ [DriverUI] Erro ao conectar WebSocket para enviar localização:', err);
                });
                return; // Sair se não estiver conectado
            }

            // Verificar se está autenticado
            const status = webSocketManager.getConnectionStatus();
            if (!status.authenticated) {
                Logger.warn('⚠️ [DriverUI] WebSocket não autenticado, autenticando...');
                webSocketManager.authenticate(driverId, 'driver');
                return; // Sair se não estiver autenticado
            }

            const isInTrip = tripStatus === 'started' || tripStatus === 'accepted';

            Logger.log('📍 [DriverUI] Enviando updateLocation:', {
                driverId,
                lat: currentLocation.lat,
                lng: currentLocation.lng,
                isOnline,
                isInTrip,
                authenticated: status.authenticated
            });

            webSocketManager.emitToServer('updateLocation', {
                driverId,
                uid: driverId,
                lat: currentLocation.lat,
                lng: currentLocation.lng,
                tripStatus,
                isInTrip,
                timestamp: Date.now()
            });

            if (tripStatus === 'started') {
                updateDriverLocation();
            }
        }
    }, [isOnline, currentLocation, tripStatus, driverId]);

    // ==================== NOTIFICAÇÕES INTERATIVAS ====================
    // Handler para processar ações de notificação (botões)
    const handleNotificationAction = useCallback(async (action, bookingId) => {
        try {
            Logger.log(`🔔 [DriverUI] Processando ação de notificação: ${action} para corrida ${bookingId}`);

            // ✅ Validar bookingId antes de enviar
            if (!bookingId || bookingId.startsWith('mock_')) {
                Logger.warn('⚠️ [DriverUI] BookingId inválido ou mock, processando localmente apenas');
                // Para mocks, apenas atualizar estado local
                if (action === 'arrived_at_pickup') {
                    setRideStatus('atPickup');
                    setIsPickupTimerActive(true);
                    setPickupTimer(120);
                    setMockArrivedAtPickup(true);
                    Alert.alert(
                        '✅ Chegada confirmada',
                        'Você informou que chegou ao local de embarque. O passageiro foi notificado.',
                        [{ text: 'OK' }]
                    );
                } else if (action === 'start_trip') {
                    // Iniciar corrida
                    if (currentBooking?.bookingId) {
                        startTrip(currentBooking.bookingId).catch(err => {
                            Logger.error('❌ [DriverUI] Erro ao iniciar corrida via notificação:', err);
                        });
                    }
                    Alert.alert(
                        '🚀 Corrida iniciada',
                        'A corrida foi iniciada com sucesso!',
                        [{ text: 'OK' }]
                    );
                } else if (action === 'cancel_ride') {
                    setRideStatus('idle');
                    setCurrentRideRequest(null);
                    setCurrentBooking(null);

                    // ✅ Finalizar corrida cancelada
                    RideLocationManager.endRide().catch(error => {
                        Logger.warn('⚠️ [DriverUI] Erro ao finalizar corrida cancelada:', error);
                    });

                    Alert.alert(
                        '❌ Corrida cancelada',
                        'A corrida foi cancelada. Você pode receber novas solicitações.',
                        [{ text: 'OK' }]
                    );
                }
                return;
            }

            const webSocketManager = WebSocketManager.getInstance();

            // Verificar se está conectado
            if (!webSocketManager.isConnected()) {
                Logger.warn('⚠️ [DriverUI] WebSocket não conectado, tentando conectar...');
                try {
                    await webSocketManager.connect();
                } catch (connectError) {
                    Logger.error('❌ [DriverUI] Erro ao conectar WebSocket:', connectError);
                    Alert.alert('Erro', 'Não foi possível conectar ao servidor. Tente novamente.');
                    return;
                }
            }

            // Enviar ação para o backend
            const result = await webSocketManager.sendNotificationAction(action, bookingId);

            Logger.log(`✅ [DriverUI] Ação processada com sucesso:`, result);

            // Atualizar estado local baseado na ação
            if (action === 'arrived_at_pickup') {
                // Motorista chegou ao local
                setRideStatus('atPickup');
                setIsPickupTimerActive(true);
                setPickupTimer(120); // Iniciar timer de 2 minutos
                setMockArrivedAtPickup(true);
                Alert.alert(
                    '✅ Chegada confirmada',
                    'Você informou que chegou ao local de embarque. O passageiro foi notificado.',
                    [{ text: 'OK' }]
                );
            } else if (action === 'start_trip') {
                // ✅ Iniciar corrida via notificação
                if (currentBooking?.bookingId) {
                    const startLocation = currentLocation ? {
                        lat: currentLocation.lat,
                        lng: currentLocation.lng
                    } : null;

                    webSocketManager.startTrip(currentBooking.bookingId, startLocation)
                        .then(async (result) => {
                            if (result.success) {
                                setRideStatus('inProgress');
                                setIsPickupTimerActive(false);
                                setTripStatus('started');

                                // ✅ Atualizar status da corrida
                                try {
                                    await RideLocationManager.updateRideStatus({
                                        status: 'started',
                                        destination: {
                                            address: currentBooking?.drop?.add || currentBooking?.drop?.address || 'Destino'
                                        },
                                        estimatedTime: 15
                                    });
                                } catch (error) {
                                    Logger.warn('⚠️ [DriverUI] Erro ao atualizar corrida:', error);
                                }

                                navigateToDestination();
                                Alert.alert(
                                    '🚀 Corrida iniciada',
                                    'A corrida foi iniciada com sucesso!',
                                    [{ text: 'OK' }]
                                );
                            }
                        })
                        .catch(err => {
                            Logger.error('❌ [DriverUI] Erro ao iniciar corrida via notificação:', err);
                            Alert.alert('Erro', 'Não foi possível iniciar a corrida.');
                        });
                }
            } else if (action === 'end_trip') {
                // ✅ NOVO: Encerrar corrida via notificação
                if (currentRideRequest?.bookingId || currentBooking?.bookingId) {
                    handleEndRide().catch(err => {
                        Logger.error('❌ [DriverUI] Erro ao encerrar corrida via notificação:', err);
                        Alert.alert('Erro', 'Não foi possível encerrar a corrida.');
                    });
                } else {
                    Alert.alert('Erro', 'Nenhuma corrida em andamento para encerrar.');
                }
            } else if (action === 'cancel_ride') {
                // Motorista cancelou
                setRideStatus('idle');
                setCurrentRideRequest(null);
                setCurrentBooking(null);

                // ✅ Finalizar corrida cancelada
                RideLocationManager.endRide().catch(error => {
                    Logger.warn('⚠️ [DriverUI] Erro ao finalizar corrida cancelada:', error);
                });

                Alert.alert(
                    '❌ Corrida cancelada',
                    'A corrida foi cancelada. Você pode receber novas solicitações.',
                    [{ text: 'OK' }]
                );
            }

        } catch (error) {
            Logger.error(`❌ [DriverUI] Erro ao processar ação de notificação:`, error);
            Alert.alert(
                'Erro',
                `Não foi possível processar a ação: ${error.message}`,
                [{ text: 'OK' }]
            );
        }
    }, []);

    // Configurar handlers de notificação interativa
    useEffect(() => {
        if (!auth.profile?.uid || auth.profile?.userType !== 'driver') {
            return; // Apenas para motoristas
        }

        Logger.log('🔔 [DriverUI] Configurando handlers de notificação interativa...');

        // Handler para notificações em primeiro plano
        const unsubscribeForeground = messaging().onMessage(async (remoteMessage) => {
            Logger.log('📱 [DriverUI] Notificação recebida em primeiro plano:', remoteMessage);

            const { data } = remoteMessage;

            // Verificar se é notificação interativa de corrida aceita
            if (data?.type === 'ride_accepted' && data?.hasActions === 'true') {
                Logger.log('🔔 [DriverUI] Notificação interativa recebida (primeiro plano)');
                // Notificações interativas em primeiro plano não mostram botões automaticamente
                // Mas podemos processar se o usuário interagir
            }
        });

        // Handler para quando app é aberto via notificação
        const unsubscribeNotificationOpened = messaging().onNotificationOpenedApp((remoteMessage) => {
            Logger.log('📱 [DriverUI] App aberto via notificação:', remoteMessage);

            const { data } = remoteMessage;

            // Verificar se há ação nos dados (quando botão foi clicado)
            if (data?.type === 'ride_accepted') {
                const action = data.action; // Pode vir do clique no botão
                const bookingId = data.bookingId;

                if (action && bookingId) {
                    // Processar ação se foi clicado em um botão
                    if (action === 'arrived_at_pickup' || action === 'cancel_ride') {
                        handleNotificationAction(action, bookingId);
                    }
                }
            }
        });

        // Handler para notificação inicial (app fechado)
        messaging()
            .getInitialNotification()
            .then((remoteMessage) => {
                if (remoteMessage) {
                    Logger.log('📱 [DriverUI] App aberto via notificação inicial:', remoteMessage);

                    const { data } = remoteMessage;

                    if (data?.type === 'ride_accepted') {
                        const action = data.action;
                        const bookingId = data.bookingId;

                        if (action && bookingId) {
                            if (action === 'arrived_at_pickup' || action === 'cancel_ride') {
                                handleNotificationAction(action, bookingId);
                            }
                        }
                    }
                }
            });

        // NOTA: setBackgroundMessageHandler deve ser configurado no App.js/index.js
        // Não pode ser chamado dentro de um componente React
        // A configuração está sendo feita no FCMNotificationService

        // Cleanup
        return () => {
            unsubscribeForeground();
            unsubscribeNotificationOpened();
        };
    }, [auth.profile?.uid, auth.profile?.userType, handleNotificationAction]);

    // Handler adicional para Expo Notifications (se estiver usando)
    useEffect(() => {
        if (Platform.OS === 'ios' || Platform.OS === 'android') {
            // Para Expo Notifications, precisamos registrar categoria com ações
            // Isso é feito automaticamente pelo FCM, mas podemos adicionar suporte adicional aqui
            try {
                const Notifications = require('expo-notifications');

                // Registrar categoria de notificação com ações (iOS)
                Notifications.setNotificationCategoryAsync('RIDE_ACCEPTED', [
                    {
                        identifier: 'arrived_at_pickup',
                        buttonTitle: 'Cheguei ao local',
                        options: { opensAppToForeground: false }
                    },
                    {
                        identifier: 'cancel_ride',
                        buttonTitle: 'Cancelar',
                        options: { opensAppToForeground: false }
                    }
                ]).catch(error => {
                    Logger.warn('⚠️ [DriverUI] Erro ao registrar categoria de notificação:', error);
                });

                // Handler para resposta de notificação (quando botão é clicado)
                const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
                    Logger.log('🔔 [DriverUI] Resposta de notificação recebida:', response);

                    const { actionIdentifier, notification } = response;
                    const data = notification.request.content.data;

                    if (data?.type === 'ride_accepted' && data?.bookingId) {
                        // Processar ação baseada no identifier do botão
                        if (actionIdentifier === 'arrived_at_pickup' || actionIdentifier === 'cancel_ride') {
                            handleNotificationAction(actionIdentifier, data.bookingId);
                        }
                    }
                });

                return () => {
                    responseSubscription.remove();
                };
            } catch (error) {
                // Expo Notifications pode não estar disponível, isso é OK
                Logger.log('ℹ️ [DriverUI] Expo Notifications não disponível, usando apenas FCM');
            }
        }
    }, [handleNotificationAction]);

    // ✅ ENVIAR LOCALIZAÇÃO PERIODICAMENTE quando online (com throttling e diferenciação por estado)
    useEffect(() => {
        if (!isOnline || !currentLocation) {
            return;
        }

        const webSocketManager = WebSocketManager.getInstance();
        if (!webSocketManager.isConnected()) {
            return;
        }

        // Importar função de cálculo de distância
        const GetDistance = require('../../common-local/other/GeoFunctions').GetDistance;

        // Verificar se é viagem
        const isInTrip = tripStatus === 'started' || rideStatus === 'inProgress' || rideStatus === 'started';

        // ✅ DETECTAR CHEGADA AO DESTINO (se estiver em viagem)
        if (isInTrip && currentRideRequest?.drop?.lat && currentRideRequest?.drop?.lng) {
            const distanceToDestination = GetDistance(
                currentLocation.lat,
                currentLocation.lng,
                currentRideRequest.drop.lat,
                currentRideRequest.drop.lng
            ) * 1000; // Converter para metros

            // Se chegou ao destino (20 metros de tolerância)
            if (distanceToDestination <= 20 && !mockArrivedAtDestination && (rideStatus === 'inProgress' || tripStatus === 'started')) {
                Logger.log(`🎯 [DriverUI] Chegou ao destino! Distância: ${distanceToDestination.toFixed(1)}m`);
                setMockArrivedAtDestination(true);

                // Atualizar notificação para mostrar chegada (se estiver visível)
                if (showSystemNotificationMock) {
                    setIsNotificationExpanded(true);
                }

                // Criar notificação do sistema informando chegada
                try {
                    const InteractiveNotificationService = require('../../services/InteractiveNotificationService').default;
                    InteractiveNotificationService.createSystemNotification({
                        title: 'Você chegou ao destino',
                        body: 'Abra o aplicativo para encerrar a corrida',
                        data: {
                            type: 'arrived_at_destination',
                            bookingId: currentRideRequest?.bookingId,
                            driverId: auth.profile?.uid,
                        },
                        categoryId: 'ARRIVED_AT_DESTINATION',
                        channelId: 'driver_actions',
                    }).catch(error => {
                        Logger.warn('⚠️ [DriverUI] Erro ao criar notificação de chegada:', error);
                    });
                } catch (error) {
                    Logger.warn('⚠️ [DriverUI] Erro ao criar notificação de chegada:', error);
                }
            }
        }

        // Inicializar refs na primeira vez
        if (!lastLocationRef.current) {
            lastLocationRef.current = currentLocation;
            lastUpdateTimeRef.current = Date.now();
        }

        // ✅ OTIMIZAÇÃO 1: Frequência diferenciada por estado
        // - Em viagem: 2 segundos (mais frequente para passageiro ver em tempo real)
        // - Online disponível: 5 segundos (economiza recursos)
        const updateInterval = isInTrip ? 2000 : 5000;

        // ✅ OTIMIZAÇÃO 2: Throttling por tempo mínimo
        const MIN_TIME_BETWEEN_UPDATES = isInTrip ? 1000 : 3000; // 1s em viagem, 3s disponível

        // ✅ OTIMIZAÇÃO 3: Throttling por distância (só atualiza se moveu >10 metros)
        const MIN_DISTANCE_METERS = 10; // 10 metros

        // ✅ NOVA LÓGICA: Enviar localização apenas quando há mudança significativa
        const sendLocationUpdate = () => {
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateTimeRef.current;

            // Verificar throttling por tempo mínimo
            if (timeSinceLastUpdate < MIN_TIME_BETWEEN_UPDATES) {
                return; // Muito cedo, não atualiza
            }

            // Calcular distância desde última atualização
            const distanceKm = GetDistance(
                lastLocationRef.current.lat,
                lastLocationRef.current.lng,
                currentLocation.lat,
                currentLocation.lng
            );
            const distanceMeters = distanceKm * 1000;

            // Verificar throttling por distância (só se não estiver em viagem)
            // Em viagem, sempre atualiza para passageiro ver em tempo real
            if (!isInTrip && distanceMeters < MIN_DISTANCE_METERS) {
                return; // Não moveu o suficiente, não atualiza
            }

            // Atualizar localização
            webSocketManager.emitToServer('updateLocation', {
                lat: currentLocation.lat,
                lng: currentLocation.lng,
                uid: auth.profile?.uid,
                tripStatus: tripStatus, // ✅ Enviar estado da viagem para TTL diferenciado
                isInTrip: isInTrip
            });

            // ✅ Salvar localização do motorista no TripDataService (se estiver em corrida)
            if (isInTrip && currentRideRequest?.bookingId) {
                TripDataService.updateDriverLocation(currentRideRequest.bookingId, {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng,
                    heading: currentLocation.heading || null,
                    speed: currentLocation.speed || null,
                    accuracy: currentLocation.accuracy || null
                }).catch(err => {
                    Logger.warn('⚠️ [DriverUI] Erro ao salvar localização no TripDataService:', err);
                });
            }

            // ✅ Atualizar localização no mapa em tempo real (para mostrar rota)
            // O NewMapScreen já recebe atualizações via WebSocket e atualiza o mapa automaticamente
            // A localização é enviada via emitToServer acima e o mapa é atualizado via onDriverLocationUpdated

            // Atualizar refs
            lastLocationRef.current = currentLocation;
            lastUpdateTimeRef.current = now;
        };

        // ✅ NOVO: Heartbeat separado - apenas renova TTL sem enviar localização
        const sendHeartbeat = () => {
            if (!isOnline || !webSocketManager.isConnected()) {
                return;
            }

            // Buscar última localização conhecida (pode ser a atual ou a última enviada)
            const locationToUse = lastLocationRef.current || currentLocation;

            if (!locationToUse || !locationToUse.lat || !locationToUse.lng) {
                return; // Sem localização conhecida, não envia heartbeat
            }

            // ✅ Heartbeat leve: apenas renova TTL usando última localização conhecida
            webSocketManager.emitToServer('driverHeartbeat', {
                uid: auth.profile?.uid,
                lat: locationToUse.lat,
                lng: locationToUse.lng,
                tripStatus: tripStatus,
                isInTrip: isInTrip
            });
        };

        // Enviar localização imediatamente na primeira vez
        sendLocationUpdate();

        // ✅ Configurar intervalo para verificar mudanças de localização (mais frequente)
        const locationCheckInterval = setInterval(() => {
            if (isOnline && currentLocation && webSocketManager.isConnected()) {
                sendLocationUpdate(); // Só envia se houver mudança significativa
            }
        }, updateInterval);

        // ✅ NOVO: Heartbeat separado - a cada 30 segundos para manter motorista "vivo"
        // Isso garante que mesmo parado, o motorista permanece online
        const heartbeatInterval = setInterval(() => {
            if (isOnline && webSocketManager.isConnected()) {
                sendHeartbeat();
            }
        }, 30000); // 30 segundos

        return () => {
            clearInterval(locationCheckInterval);
            clearInterval(heartbeatInterval);
        };
    }, [isOnline, currentLocation, tripStatus, rideStatus, currentRideRequest, auth.profile?.uid, showSystemNotificationMock, mockArrivedAtDestination]);

    // Carregar status de aprovação do driver do banco de dados
    useEffect(() => {
        const loadDriverApprovalStatus = async () => {
            try {
                if (!auth.profile?.uid) {
                    setIsLoading(true);
                    return;
                }

                // 🚀 BYPASS PARA USUÁRIO DE TESTE - Simular aprovação
                if (auth.profile.uid && auth.profile.uid.includes('test-user-dev')) {
                    setIsApproved(true);
                    // ✅ Aguardar um pouco antes de esconder loading (para mostrar a tela)
                    setTimeout(() => setIsLoading(false), 1500);
                    return;
                }

                // Ler diretamente do Firebase Realtime Database
                const driverRef = database().ref(`users/${auth.profile.uid}`);

                const snapshot = await driverRef.once('value');
                const driverData = snapshot.val();

                if (driverData && driverData.isApproved !== undefined) {
                    setIsApproved(driverData.isApproved);
                } else {
                    setIsApproved(false);
                }

                // ✅ Aguardar um pouco antes de esconder loading (para mostrar a tela)
                setTimeout(() => setIsLoading(false), 1500);

            } catch (error) {
                Logger.error('❌ Erro ao carregar status de aprovação do driver:', error);

                // 🚀 BYPASS: Se der erro de permissão, simular aprovação para usuários de teste/review
                const isTestUser = auth.profile?.uid && (
                    auth.profile.uid.includes('test-user-dev') ||
                    auth.profile.uid.includes('review-') ||
                    auth.profile.isReviewAccount ||
                    auth.profile.isTestUser
                );

                if (isTestUser) {
                    Logger.log('🧪 BYPASS: Simulando aprovação de motorista para usuário de teste/review');
                    setIsApproved(true);
                } else {
                    // Em caso de erro, definir como não aprovado por segurança
                    setIsApproved(false);
                }

                // ✅ Esconder loading mesmo em caso de erro
                setTimeout(() => setIsLoading(false), 1500);
            }
        };

        loadDriverApprovalStatus();
    }, [auth.profile?.uid]);

    // Carregar status dos documentos do driver
    useEffect(() => {
        const loadDocumentStatus = async () => {
            try {
                if (!auth.profile?.uid) {
                    return;
                }

                // 🚀 BYPASS PARA USUÁRIO DE TESTE - Simular documentos aprovados
                if (auth.profile.uid && auth.profile.uid.includes('test-user-dev')) {
                    const mockDocumentStatus = {
                        cnh: 'approved',
                        residence: 'approved',
                        vehicle: 'approved'
                    };

                    setDocumentStatus(mockDocumentStatus);
                    return;
                }

                // Carregar status dos documentos
                const documentsRef = database().ref(`users/${auth.profile.uid}/documents`);
                const documentsSnapshot = await documentsRef.once('value');
                const documentsData = documentsSnapshot.val();

                if (documentsData) {
                    const newStatus = { ...documentStatus };

                    if (documentsData.cnh) {
                        newStatus.cnh = documentsData.cnh.status;
                    }
                    if (documentsData.residence) {
                        newStatus.residence = documentsData.residence.status;
                    }

                    setDocumentStatus(newStatus);
                }

                // Carregar status do veículo
                const vehicleRef = database().ref(`users/${auth.profile.uid}/vehicles/current`);
                const vehicleSnapshot = await vehicleRef.once('value');
                const vehicleData = vehicleSnapshot.val();

                if (vehicleData) {
                    setDocumentStatus(prev => ({
                        ...prev,
                        vehicle: vehicleData.status
                    }));
                }

            } catch (error) {
                Logger.error('❌ Erro ao carregar status dos documentos:', error);

                // 🚀 BYPASS: Se der erro de permissão, simular documentos aprovados para usuários de teste/review
                const isTestUser = auth.profile?.uid && (
                    auth.profile.uid.includes('test-user-dev') ||
                    auth.profile.uid.includes('review-') ||
                    auth.profile.isReviewAccount ||
                    auth.profile.isTestUser
                );

                if (isTestUser) {
                    Logger.log('🧪 BYPASS: Simulando documentos aprovados para usuário de teste/review');
                    const mockDocumentStatus = {
                        cnh: 'approved',
                        residence: 'approved',
                        vehicle: 'approved'
                    };

                    setDocumentStatus(mockDocumentStatus);
                }
            }
        };

        loadDocumentStatus();
    }, [auth.profile?.uid]);

    // ✅ CRÍTICO: Se há currentRideRequest, SEMPRE limpar lista disponível (evitar sobreposição)
    useEffect(() => {
        if (currentRideRequest) {
            // Forçar limpeza imediata da lista
            setAvailableBookings([]);
        }
    }, [currentRideRequest]);

    // ✅ EXTRA SEGURANÇA: Limpar lista também no próximo frame para garantir
    useEffect(() => {
        if (currentRideRequest) {
            const timeout = setTimeout(() => {
                setAvailableBookings([]);
            }, 100);
            return () => clearTimeout(timeout);
        }
    }, [currentRideRequest]);

    // useEffect para o timer de contagem regressiva
    useEffect(() => {
        let interval;

        if (isTimerActive && timer > 0 && currentRideRequest) {
            interval = setInterval(() => {
                setTimer(prev => {
                    if (prev <= 1) {
                        setIsTimerActive(false);
                        // Remover solicitação quando timer expirar
                        setTimeout(() => {
                            setCurrentRideRequest(null);
                        }, 2000); // Aguardar 2s para mostrar "Corrida Expirada"
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isTimerActive, timer, currentRideRequest]);

    // useEffect para o timer de embarque (2 minutos)
    useEffect(() => {
        let interval;

        if (isPickupTimerActive && pickupTimer > 0) {
            interval = setInterval(() => {
                setPickupTimer(prev => {
                    if (prev <= 1) {
                        setIsPickupTimerActive(false);
                        // Timer de embarque expirou
                        Alert.alert(
                            '⏰ Tempo de Embarque Expirado',
                            'O passageiro não embarcou no tempo limite. Deseja cancelar a corrida?',
                            [
                                {
                                    text: '❌ Cancelar Corrida',
                                    style: 'destructive',
                                    onPress: () => {
                                        setCurrentRideRequest(null);
                                        setRideStatus('idle');
                                        setPickupTimer(120);
                                    }
                                },
                                {
                                    text: '⏰ Dar Mais Tempo',
                                    onPress: () => {
                                        setPickupTimer(120);
                                        setIsPickupTimerActive(true);
                                    }
                                }
                            ]
                        );
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isPickupTimerActive, pickupTimer]);

    // useEffect para WebSocket de notificações de aprovação
    useEffect(() => {
        if (!auth.profile?.uid) return;

        // Conectar ao WebSocket para notificações de aprovação
        const webSocketManager = WebSocketManager.getInstance();

        if (!webSocketManager.isConnected()) {
            webSocketManager.connect().catch(err => {
                Logger.error('❌ Erro ao conectar WebSocket:', err);
            });
        }

        // Listener para atualizações de status do motorista
        const handleDriverStatusUpdate = (data) => {
            Logger.log('📱 Notificação de status recebida:', data);

            if (data.uid === auth.profile.uid) {
                if (data.status === 'approved') {
                    // Motorista aprovado
                    Alert.alert(
                        '✅ Documentos Aprovados!',
                        data.message || 'Seus documentos foram aprovados! Você já pode começar a dirigir.',
                        [
                            {
                                text: '🎉 Ótimo!',
                                onPress: () => {
                                    // Atualizar estado local
                                    setIsApproved(true);
                                    // Recarregar status dos documentos
                                    loadDocumentStatus();
                                }
                            }
                        ]
                    );
                } else if (data.status === 'rejected') {
                    // Motorista rejeitado
                    Alert.alert(
                        '❌ Documentos Rejeitados',
                        data.message || 'Seus documentos foram rejeitados. Verifique os motivos e reenvie.',
                        [
                            {
                                text: '📋 Ver Motivos',
                                onPress: () => {
                                    // Recarregar status dos documentos
                                    loadDocumentStatus();
                                }
                            },
                            {
                                text: '📝 Reenviar',
                                onPress: () => {
                                    // Abrir BottomSheet para reenvio
                                    setIsDocumentsBottomSheetOpen(true);
                                    documentsBottomSheetRef.current?.expand();
                                }
                            }
                        ]
                    );
                }
            }
        };

        // Registrar listener
        webSocketManager.socket.on('driver_status_updated', handleDriverStatusUpdate);

        // Cleanup
        return () => {
            if (webSocketManager.socket) {
                webSocketManager.socket.off('driver_status_updated', handleDriverStatusUpdate);
            }
        };
    }, [auth.profile?.uid]);

    // Função para calcular z-index dinâmico dos botões
    const getButtonZIndex = () => {
        const zIndex = (isDocumentsBottomSheetOpen || isVehicleBottomSheetOpen) ? -100 : 100;
        return zIndex;
    };

    // Funções para fechar BottomSheets
    const closeDocumentsBottomSheet = () => {
        setIsDocumentsBottomSheetOpen(false);
        // Fechar completamente a BottomSheet
        documentsBottomSheetRef.current?.close();
        // Notificar mudança de estado
        if (onBottomSheetStateChange) {
            const newState = {
                isDocumentsBottomSheetOpen: false,
                isVehicleBottomSheetOpen
            };
            onBottomSheetStateChange(newState);
        }
    };

    const closeVehicleBottomSheet = () => {
        setIsVehicleBottomSheetOpen(false);
        // Fechar completamente a BottomSheet
        vehicleBottomSheetRef.current?.close();
        // Notificar mudança de estado
        if (onBottomSheetStateChange) {
            const newState = {
                isDocumentsBottomSheetOpen,
                isVehicleBottomSheetOpen: false
            };
            onBottomSheetStateChange(newState);
        }
    };

    // ===== FUNÇÕES PARA GERENCIAR RESERVAS =====

    // Mostrar detalhes da reserva
    const showBookingDetails = (booking) => {
        // Calcular valor líquido para o motorista
        const driverValues = calculateDriverNetValue(booking.estimate);

        Alert.alert(
            '📋 DETALHES DA RESERVA',
            `📍 Origem: ${booking.pickup.add}\n` +
            `🎯 Destino: ${booking.drop.add}\n` +
            `💰 Valor da corrida: R$ ${driverValues.totalFare.toFixed(2)}\n` +
            `📏 Distância: ${Math.round(booking.distance)}m\n\n` +
            `💸 DETALHES FINANCEIROS:\n` +
            `• Custo operacional: R$ ${driverValues.operationalCost.toFixed(2)}\n` +
            `• Taxa PIX: R$ ${driverValues.wooviTax.toFixed(2)}\n` +
            `🚗 VOCÊ RECEBERÁ: R$ ${driverValues.driverNetValue.toFixed(2)}`,
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

                    setTimeout(() => {
                        reject(new Error('Timeout de autenticação'));
                    }, 10000);
                });
            }

            // ✅ Tentar usar acceptRide primeiro (novo método), fallback para driverResponse
            let result;
            if (webSocketManager.acceptRide) {
                result = await webSocketManager.acceptRide(bookingId);
            } else {
                result = await webSocketManager.driverResponse(bookingId, true);
            }

            if (result.success) {
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao aceitar reserva');
            }

        } catch (error) {
            Logger.error('❌ [DriverUI] Erro ao aceitar reserva:', {
                error: error.message,
                stack: error.stack,
                bookingId: bookingId,
                timestamp: new Date().toISOString()
            });
            Alert.alert(
                'Não foi possível aceitar a reserva',
                'Por favor, verifique sua conexão e tente novamente.',
                [{ text: 'OK' }]
            );
            throw error; // Re-throw para que acceptRideAndStart possa tratar
        }
    };

    // Rejeitar reserva
    const rejectBooking = async (bookingId, reason) => {
        // ✅ Animação de rejeição
        animateRejectButton('press');

        try {
            Logger.log('❌ Rejeitando reserva:', bookingId, 'Razão:', reason);

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
                // O handler WebSocket vai processar o resultado
            } else {
                throw new Error(result.error || 'Falha ao rejeitar reserva');
            }

        } catch (error) {
            Logger.error('❌ Erro ao rejeitar reserva:', error);
            Alert.alert('Erro', error.message || 'Falha ao rejeitar reserva');
        }
    };

    // Alternar status online/offline
    // Função auxiliar para verificar se motorista tem veículo cadastrado e ativo
    const checkDriverHasVehicle = async (userId) => {
        try {
            Logger.log('🚗 [VALIDAÇÃO] Verificando se motorista tem veículo cadastrado...');

            // 1. Verificar se tem veículos na tabela user_vehicles
            const vehicleService = new VehicleService();
            const userVehicles = await vehicleService.getUserVehicles(userId);

            if (userVehicles && userVehicles.length > 0) {
                // Verificar se tem pelo menos um veículo APROVADO E ATIVO
                const activeApprovedVehicle = userVehicles.find(vehicle =>
                    (vehicle.status === 'approved' || vehicle.approved === true || vehicle.carApproved === true) &&
                    vehicle.isActive === true
                );

                if (activeApprovedVehicle) {
                    Logger.log('✅ [VALIDAÇÃO] Motorista tem veículo aprovado e ativo');
                    return true;
                }

                // Se não tem ativo, verificar se tem aprovado para auto-ativar
                const approvedVehicle = userVehicles.find(vehicle =>
                    vehicle.status === 'approved' || vehicle.approved === true || vehicle.carApproved === true
                );

                if (approvedVehicle) {
                    Logger.log('⚠️ [VALIDAÇÃO] Motorista tem veículo aprovado mas não está ativo. Auto-ativando...');
                    try {
                        // Auto-ativar o primeiro veículo aprovado
                        const vehicleId = approvedVehicle.vehicleId || approvedVehicle.id;
                        await vehicleService.setActiveVehicle(userId, vehicleId);
                        Logger.log('✅ [VALIDAÇÃO] Veículo auto-ativado com sucesso');
                        return true;
                    } catch (error) {
                        Logger.error('❌ [VALIDAÇÃO] Erro ao auto-ativar veículo:', error);
                        // Continuar para fallback
                    }
                }
            }

            // 2. Fallback: Verificar se tem dados de carro no perfil do usuário
            const userProfile = auth.profile;
            if (userProfile) {
                const hasCarInProfile = (
                    (userProfile.carType || userProfile.vehicleType) &&
                    (userProfile.carPlate || userProfile.vehicleNumber || userProfile.vehiclePlate) &&
                    (userProfile.carApproved !== false)
                );

                if (hasCarInProfile) {
                    Logger.log('✅ [VALIDAÇÃO] Motorista tem dados de carro no perfil');
                    return true;
                }
            }

            // 3. Verificar no Firebase Realtime Database diretamente
            try {
                const userRef = database().ref(`users/${userId}`);
                const userSnapshot = await userRef.once('value');
                const userData = userSnapshot.val();

                if (userData) {
                    const hasCarInDatabase = (
                        (userData.carType || userData.vehicleType) &&
                        (userData.carPlate || userData.vehicleNumber || userData.vehiclePlate) &&
                        (userData.carApproved !== false)
                    );

                    if (hasCarInDatabase) {
                        Logger.log('✅ [VALIDAÇÃO] Motorista tem dados de carro no database');
                        return true;
                    }
                }
            } catch (dbError) {
                Logger.warn('⚠️ [VALIDAÇÃO] Erro ao verificar database:', dbError.message);
            }

            Logger.log('❌ [VALIDAÇÃO] Motorista NÃO tem veículo cadastrado');
            return false;

        } catch (error) {
            Logger.error('❌ [VALIDAÇÃO] Erro ao verificar veículo:', error);

            // 🚀 BYPASS: Para usuários de teste/review, simular que tem veículo
            const isTestUser = auth.profile?.uid && (
                auth.profile.uid.includes('test-user-dev') ||
                auth.profile.uid.includes('review-') ||
                auth.profile.isReviewAccount ||
                auth.profile.isTestUser
            );

            if (isTestUser) {
                Logger.log('🧪 BYPASS: Simulando veículo aprovado para usuário de teste/review');
                return true;
            }

            // Em caso de erro, não bloquear (pode ser problema de conexão)
            // Mas logar o erro para debug
            return false;
        }
    };

    // ✅ Função para solicitar permissão de background location após modal
    const requestBackgroundLocationPermission = async () => {
        try {
            const BackgroundLocationService = require('../../services/BackgroundLocationService').default;
            const permissions = await BackgroundLocationService.requestPermissions();

            if (permissions.background) {
                await BackgroundLocationService.startBackgroundTracking();
                Logger.log('✅ [STATUS] Tracking em background iniciado');
                setShowBackgroundLocationBanner(false); // Esconder banner se permissão foi concedida
            } else {
                Logger.warn('⚠️ [STATUS] Permissão de background não concedida');
                // Mostrar banner apenas se motorista estiver online
                if (isOnline) {
                    setShowBackgroundLocationBanner(true);
                }
            }
        } catch (error) {
            Logger.error('❌ [STATUS] Erro ao configurar tracking em background:', error);
        }
    };

    // ✅ Handler para quando usuário aceita no modal de background location
    const handleBackgroundLocationAccept = async () => {
        setShowBackgroundLocationModal(false);
        await AsyncStorage.setItem('has_shown_background_location_modal', 'true');
        await requestBackgroundLocationPermission();
    };

    // ✅ Handler para quando usuário cancela no modal de background location
    const handleBackgroundLocationCancel = async () => {
        setShowBackgroundLocationModal(false);
        await AsyncStorage.setItem('has_shown_background_location_modal', 'true');
        // Continuar mesmo sem permissão de background (motorista pode ficar online)
        Logger.warn('⚠️ [STATUS] Motorista ficou online sem permissão de background');
    };

    // Função auxiliar para ativar online (usada tanto no bypass quanto no KYC)
    const activateOnlineStatus = async () => {
        Logger.log('🔄 [STATUS] Motorista ficando ONLINE...');
        const webSocketManager = WebSocketManager.getInstance();
        const uid = auth.profile?.uid || 'test-user-dev';

        // ✅ VALIDAÇÃO CRÍTICA: Verificar se localização foi negada
        if (locationDenied) {
            Alert.alert(
                'Localização Necessária',
                'Para ficar online e receber corridas, é necessário permitir o acesso à localização. Por favor, ative a localização nas configurações do dispositivo.',
                [
                    {
                        text: 'OK',
                        style: 'default'
                    }
                ]
            );
            Logger.warn('❌ [STATUS] Motorista não pode ficar online: localização negada');
            return;
        }

        // ✅ VALIDAÇÃO CRÍTICA: Verificar se motorista está aprovado ANTES de qualquer outra ação
        // 🔒 BLOQUEIO TOTAL: Motorista não aprovado não pode executar fluxo de motorista
        if (!isApproved) {
            Alert.alert(
                'Aprovação Necessária',
                'Você precisa ser aprovado como motorista antes de ficar online. Por favor, aguarde a aprovação dos seus documentos.',
                [
                    {
                        text: 'OK',
                        style: 'default'
                    }
                ]
            );
            Logger.warn('❌ [STATUS] Motorista não pode ficar online: não aprovado');
            return;
        }

        // ✅ VALIDAÇÃO: Verificar se motorista tem veículo cadastrado e ativo
        const hasVehicle = await checkDriverHasVehicle(uid);
        if (!hasVehicle) {
            // Verificar qual é o problema específico
            const vehicleService = new VehicleService();
            const userVehicles = await vehicleService.getUserVehicles(uid);

            let message = 'Você precisa cadastrar um veículo antes de ficar online como motorista.';

            if (userVehicles && userVehicles.length > 0) {
                const hasPending = userVehicles.some(v => v.status === 'pending');
                const hasApproved = userVehicles.some(v => v.status === 'approved' || v.approved === true);

                if (hasPending) {
                    message = 'Você tem veículo(s) cadastrado(s) aguardando aprovação.\n\nPor favor, aguarde a aprovação dos seus documentos antes de ficar online.';
                } else if (hasApproved) {
                    message = 'Você tem veículo(s) aprovado(s), mas nenhum está ativo.\n\nPor favor, ative um veículo em "Meus Veículos" antes de ficar online.';
                }
            } else {
                message = 'Você precisa cadastrar um veículo antes de ficar online como motorista.\n\nPor favor, cadastre um veículo no seu perfil primeiro.';
            }

            Alert.alert(
                'Veículo Necessário',
                message,
                [
                    {
                        text: 'OK',
                        style: 'default'
                    }
                ]
            );
            Logger.log('❌ [STATUS] Motorista não pode ficar online: sem veículo cadastrado/ativo');
            return;
        }

        // ✅ CONECTAR WEBSOCKET PRIMEIRO
        if (!webSocketManager.isConnected()) {
            Logger.log('🔌 [STATUS] Conectando WebSocket antes de ficar online...');
            try {
                await webSocketManager.connect();
                Logger.log('✅ [STATUS] WebSocket conectado');
            } catch (error) {
                Logger.error('❌ [STATUS] Erro ao conectar WebSocket:', error);
                Alert.alert('Erro', 'Não foi possível conectar ao servidor. Tente novamente.');
                return;
            }
        } else {
            Logger.log('✅ [STATUS] WebSocket já conectado');
        }

        setIsOnline(true);
        Logger.log('✅ [STATUS] Motorista ONLINE');

        // ✅ Mostrar modal explicativo antes de solicitar permissão de background
        const hasShownModal = await AsyncStorage.getItem('has_shown_background_location_modal');
        if (!hasShownModal) {
            setShowBackgroundLocationModal(true);
            return; // Aguardar usuário aceitar no modal
        }

        // Se já mostrou o modal, solicitar permissões diretamente
        await requestBackgroundLocationPermission();

        // 🔥 CORREÇÃO CRÍTICA: Autenticar em background (não bloqueia UI)
        Logger.log(`🔐 [STATUS] Autenticando motorista em background: ${uid}`);

        // ✅ Autenticar em background (não await)
        const authenticateInBackground = async () => {
            try {
                // Conectar se não estiver conectado
                if (!webSocketManager.isConnected()) {
                    Logger.log('🔄 [STATUS] Conectando WebSocket em background...');
                    webSocketManager.connect().catch(err => {
                        Logger.error('❌ [STATUS] Erro ao conectar:', err);
                    });
                }

                // Autenticar (não await - fire-and-forget)
                webSocketManager.authenticate(uid, 'driver');

                // ✅ Listener para quando autenticação for confirmada
                const onAuthenticated = (data) => {
                    if (data.success) {
                        Logger.log('✅ [STATUS] Autenticação confirmada - driver pronto');

                        // ✅ ENVIAR LOCALIZAÇÃO quando autenticado
                        if (currentLocation) {
                            Logger.log('📍 [STATUS] Enviando localização inicial:', {
                                lat: currentLocation.lat,
                                lng: currentLocation.lng
                            });

                            webSocketManager.emitToServer('updateLocation', {
                                lat: currentLocation.lat,
                                lng: currentLocation.lng,
                                uid: uid,
                                tripStatus: tripStatus || 'idle',
                                isInTrip: false
                            });

                            Logger.log('✅ [STATUS] Localização enviada via updateLocation');
                        }

                        // Remover listener após sucesso
                        webSocketManager.socket.off('authenticated', onAuthenticated);
                    }
                };

                // Registrar listener temporário
                if (webSocketManager.socket) {
                    webSocketManager.socket.once('authenticated', onAuthenticated);
                }

            } catch (error) {
                Logger.error('❌ [STATUS] Erro ao autenticar em background:', error);
            }
        };

        // Executar em background (não bloqueia UI)
        authenticateInBackground();
    };

    const toggleOnlineStatus = async () => {
        // Se está online, ficar offline
        if (isOnline) {
            Logger.log('🔄 [STATUS] Motorista ficando OFFLINE...');
            const webSocketManager = WebSocketManager.getInstance();
            const isConnected = webSocketManager.isConnected();
            Logger.log('🔄 [STATUS] WebSocket conectado?', isConnected);

            setIsOnline(false);
            Logger.log('✅ [STATUS] Motorista OFFLINE');

            // ✅ Parar tracking em background quando ficar offline
            try {
                const BackgroundLocationService = require('../../services/BackgroundLocationService').default;
                await BackgroundLocationService.stopBackgroundTracking();
                Logger.log('✅ [STATUS] Tracking em background parado');
            } catch (error) {
                Logger.error('❌ [STATUS] Erro ao parar tracking em background:', error);
            }

            // Notificar WebSocket sobre mudança de status
            try {
                if (isConnected) {
                    Logger.log('📤 [STATUS] Enviando status OFFLINE para servidor...');
                    webSocketManager.setDriverStatus(
                        auth.profile?.uid || 'test-user-dev',
                        'offline',
                        false
                    );
                    Logger.log('✅ [STATUS] Status OFFLINE enviado ao servidor');
                } else {
                    Logger.warn('⚠️ [STATUS] WebSocket não conectado - não foi possível notificar servidor');
                }
            } catch (error) {
                Logger.error('❌ [STATUS] Erro ao notificar WebSocket sobre status offline:', error);
            }
        } else {
            // 🔐 Verificar se KYC está habilitado (usando Feature Flag)
            const kycEnabled = await isKYCEnabled();

            if (kycEnabled) {
                // 🟢 KYC HABILITADO: validação será aplicada no backend no primeiro online do dia
                Logger.log('🔐 [KYC] KYC habilitado - validação diária será exigida no backend');
                await activateOnlineStatus();
            } else {
                // 🔴 KYC DESABILITADO: Ficar online direto (bypass)
                Logger.log('🚀 [KYC] KYC desabilitado - bypass ativado, ficando online direto...');
                await activateOnlineStatus();
            }
        }
    };

    // Funções para upload de documentos
    const uploadDocument = async (documentType) => {
        try {
            Logger.log(`📄 Iniciando upload de ${documentType}...`);

            // Mostrar opções de upload
            Alert.alert(
                `Enviar ${documentType.toUpperCase()}`,
                'Escolha como deseja enviar o documento:',
                [
                    {
                        text: '📷 Foto da Galeria',
                        onPress: () => pickImageFromGallery(documentType)
                    },
                    {
                        text: '📄 PDF',
                        onPress: () => pickPDFDocument(documentType)
                    },
                    {
                        text: 'Cancelar',
                        style: 'cancel'
                    }
                ]
            );

        } catch (error) {
            Logger.error(`❌ Erro ao iniciar upload de ${documentType}:`, error);
            Alert.alert('Erro', 'Não foi possível iniciar o upload. Tente novamente.');
        }
    };

    const pickImageFromGallery = async (documentType) => {
        try {
            // Solicitar permissão
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão Negada', 'É necessário permitir acesso à galeria para enviar fotos.');
                return;
            }

            // Abrir galeria
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                Logger.log(`📷 Imagem selecionada para ${documentType}:`, result.assets[0].uri);

                // Upload real para Firebase Storage
                await uploadDocumentToStorage(documentType, 'image', result.assets[0].uri);
            }

        } catch (error) {
            Logger.error(`❌ Erro ao selecionar imagem para ${documentType}:`, error);
            Alert.alert('Erro', 'Não foi possível selecionar a imagem. Tente novamente.');
        }
    };

    const pickPDFDocument = async (documentType) => {
        try {
            // Usar expo-image-picker para selecionar imagens
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                const file = result.assets[0];
                Logger.log(`📄 Documento selecionado para ${documentType}:`, file.uri);

                // Upload real para Firebase Storage
                await uploadDocumentToStorage(documentType, 'image/jpeg', file.uri);
            }

        } catch (error) {
            Logger.error(`❌ Erro ao selecionar documento para ${documentType}:`, error);
            Alert.alert('Erro', 'Não foi possível selecionar o documento. Tente novamente.');
        }
    };

    const uploadDocumentToStorage = async (documentType, fileType, fileUri) => {
        try {
            // Mostrar loading
            Alert.alert('Enviando...', `Fazendo upload do ${documentType.toUpperCase()}...`);

            // Upload real para Firebase Storage
            const fileName = `${documentType}_${Date.now()}.${fileType === 'image' ? 'jpg' : 'pdf'}`;
            const storageRef = storage().ref(`documents/${auth.profile.uid}/${documentType}/${fileName}`);

            Logger.log(`📤 Iniciando upload para Storage: ${fileName}`);

            // Upload do arquivo
            const uploadTask = await storageRef.putFile(fileUri);
            const downloadURL = await uploadTask.ref.getDownloadURL();

            Logger.log(`✅ Upload concluído. URL: ${downloadURL}`);

            // Atualizar status do documento
            setDocumentStatus(prev => ({
                ...prev,
                [documentType]: 'analyzing'
            }));

            // Salvar no Firebase Database com URL do Storage
            await saveDocumentStatusToFirebase(documentType, fileType, downloadURL);

            Alert.alert(
                '✅ Sucesso!',
                `${documentType.toUpperCase()} enviado com sucesso!\n\nStatus: Em análise\n\nSeus documentos serão revisados pela nossa equipe.`
            );

        } catch (error) {
            Logger.error(`❌ Erro no upload de ${documentType}:`, error);
            Alert.alert('Erro', 'Não foi possível anexar o documento. Tente novamente.');
        }
    };

    const saveDocumentStatusToFirebase = async (documentType, fileType, fileUrl) => {
        try {
            if (!auth.profile?.uid) {
                Logger.error('❌ UID não disponível para salvar status');
                return;
            }

            const documentData = {
                type: documentType,
                fileType: fileType,
                fileUrl: fileUrl, // URL do Storage
                status: 'analyzing',
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Salvar no Firebase Database
            const documentRef = database().ref(`users/${auth.profile.uid}/documents/${documentType}`);
            await documentRef.set(documentData);


        } catch (error) {
            Logger.error(`❌ Erro ao salvar status do documento ${documentType}:`, error);
            throw error;
        }
    };

    const uploadVehicleDocument = async () => {
        try {
            Logger.log('🚗 Iniciando upload do CRLV...');

            // Mostrar opções de upload
            Alert.alert(
                'Enviar CRLV',
                'Escolha como deseja enviar o CRLV:',
                [
                    {
                        text: '📷 Foto da Galeria',
                        onPress: () => pickVehicleImage()
                    },
                    {
                        text: '📄 PDF',
                        onPress: () => pickVehiclePDF()
                    },
                    {
                        text: 'Cancelar',
                        style: 'cancel'
                    }
                ]
            );

        } catch (error) {
            Logger.error('❌ Erro ao iniciar upload do CRLV:', error);
            Alert.alert('Erro', 'Não foi possível iniciar o upload. Tente novamente.');
        }
    };

    const pickVehicleImage = async () => {
        try {
            // Solicitar permissão
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão Negada', 'É necessário permitir acesso à galeria para enviar fotos.');
                return;
            }

            // Abrir galeria
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                Logger.log('📷 Imagem do CRLV selecionada:', result.assets[0].uri);
                await uploadVehicleToStorage('image', result.assets[0].uri);
            }

        } catch (error) {
            Logger.error('❌ Erro ao selecionar imagem do CRLV:', error);
            Alert.alert('Erro', 'Não foi possível selecionar a imagem. Tente novamente.');
        }
    };

    const pickVehiclePDF = async () => {
        try {
            // Usar expo-image-picker para selecionar imagens
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: true,
                aspect: [4, 3],
                quality: 0.8,
            });

            if (!result.canceled && result.assets[0]) {
                const file = result.assets[0];
                Logger.log('📄 CRLV selecionado:', file.uri);
                await uploadVehicleToStorage('image/jpeg', file.uri);
            }

        } catch (error) {
            Logger.error('❌ Erro ao selecionar CRLV:', error);
            Alert.alert('Erro', 'Não foi possível selecionar o CRLV. Tente novamente.');
        }
    };

    const uploadVehicleToStorage = async (fileType, fileUri) => {
        try {
            // Mostrar loading
            Alert.alert('Enviando...', 'Fazendo upload do CRLV...');

            // Upload real para Firebase Storage
            const fileName = `crlv_${Date.now()}.${fileType === 'image' ? 'jpg' : 'pdf'}`;
            const storageRef = storage().ref(`vehicles/${auth.profile.uid}/${fileName}`);

            Logger.log(`📤 Iniciando upload do CRLV para Storage: ${fileName}`);

            // Upload do arquivo
            const uploadTask = await storageRef.putFile(fileUri);
            const downloadURL = await uploadTask.ref.getDownloadURL();

            Logger.log(`✅ Upload do CRLV concluído. URL: ${downloadURL}`);

            // Atualizar status do veículo
            setDocumentStatus(prev => ({
                ...prev,
                vehicle: 'analyzing'
            }));

            // Salvar no Firebase Database com URL do Storage
            await saveVehicleStatusToFirebase(fileType, downloadURL);

            Alert.alert(
                '✅ Sucesso!',
                'CRLV enviado com sucesso!\n\nStatus: Em análise\n\nSeu veículo será revisado pela nossa equipe.'
            );

        } catch (error) {
            Logger.error('❌ Erro no upload do CRLV:', error);
            Alert.alert('Erro', 'Não foi possível anexar o documento. Tente novamente.');
        }
    };

    const saveVehicleStatusToFirebase = async (fileType, fileUrl) => {
        try {
            if (!auth.profile?.uid) {
                Logger.error('❌ UID não disponível para salvar status do veículo');
                return;
            }

            const vehicleData = {
                type: 'crlv',
                fileType: fileType,
                fileUrl: fileUrl, // URL do Storage
                status: 'analyzing',
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            // Salvar no Firebase Database
            const vehicleRef = database().ref(`users/${auth.profile.uid}/vehicles/current`);
            await vehicleRef.set(vehicleData);


        } catch (error) {
            Logger.error('❌ Erro ao salvar status do veículo:', error);
            throw error;
        }
    };

    // 🚀 CORREÇÃO: Carregar estado persistido do isOnline
    useEffect(() => {
        const loadPersistedOnlineStatus = async () => {
            try {
                const savedStatus = await AsyncStorage.getItem('@driver_online_status');
                if (savedStatus !== null) {
                    const isOnlineStatus = JSON.parse(savedStatus);
                    setIsOnline(isOnlineStatus);
                    Logger.log('🔄 Estado online carregado do AsyncStorage:', isOnlineStatus);
                }
            } catch (error) {
                Logger.error('❌ Erro ao carregar estado online:', error);
            }
        };

        loadPersistedOnlineStatus();
    }, []);

    // 🚀 CORREÇÃO: Persistir estado do isOnline sempre que mudar
    useEffect(() => {
        const saveOnlineStatus = async () => {
            try {
                await AsyncStorage.setItem('@driver_online_status', JSON.stringify(isOnline));
                Logger.log('💾 Estado online salvo no AsyncStorage:', isOnline);
            } catch (error) {
                Logger.error('❌ Erro ao salvar estado online:', error);
            }
        };

        saveOnlineStatus();
    }, [isOnline]);

    // Determinar quando o botão deve estar desabilitado
    // 🚀 CORREÇÃO: Botão só desabilitado durante corridas, NÃO por status online/offline
    // ✅ Desabilitar botão se localização foi negada ou outras condições
    const isButtonDisabled = locationDenied || currentBooking || tripStatus !== 'idle';

    // Determinar se deve mostrar "Cadastrar Veículo" (quando documentos estão em análise)
    const shouldShowVehicleButton = !isApproved &&
        documentStatus.cnh === 'analyzing' &&
        documentStatus.residence === 'analyzing';

    // Debug: mostrar estados atuais (removido para reduzir poluição de logs)

    // ✅ Animação para botão de aceitar corrida
    const acceptButtonScale = useRef(new Animated.Value(1)).current;
    const acceptButtonOpacity = useRef(new Animated.Value(1)).current;

    const animateAcceptButton = useCallback((type = 'press') => {
        if (type === 'press') {
            Animated.sequence([
                Animated.parallel([
                    Animated.spring(acceptButtonScale, {
                        toValue: 0.95,
                        useNativeDriver: true,
                    }),
                    Animated.timing(acceptButtonOpacity, {
                        toValue: 0.8,
                        duration: 100,
                        useNativeDriver: true,
                    }),
                ]),
                Animated.parallel([
                    Animated.spring(acceptButtonScale, {
                        toValue: 1,
                        useNativeDriver: true,
                    }),
                    Animated.timing(acceptButtonOpacity, {
                        toValue: 1,
                        duration: 100,
                        useNativeDriver: true,
                    }),
                ]),
            ]).start();
        } else if (type === 'success') {
            Animated.sequence([
                Animated.parallel([
                    Animated.spring(acceptButtonScale, {
                        toValue: 1.1,
                        useNativeDriver: true,
                    }),
                    Animated.timing(acceptButtonOpacity, {
                        toValue: 0.9,
                        duration: 150,
                        useNativeDriver: true,
                    }),
                ]),
                Animated.parallel([
                    Animated.spring(acceptButtonScale, {
                        toValue: 1,
                        useNativeDriver: true,
                    }),
                    Animated.timing(acceptButtonOpacity, {
                        toValue: 1,
                        duration: 150,
                        useNativeDriver: true,
                    }),
                ]),
            ]).start();
        }
    }, [acceptButtonScale, acceptButtonOpacity]);

    // ✅ Animação para botão de rejeitar corrida
    const rejectButtonScale = useRef(new Animated.Value(1)).current;
    const rejectButtonOpacity = useRef(new Animated.Value(1)).current;

    const animateRejectButton = useCallback((type = 'press') => {
        if (type === 'press') {
            Animated.sequence([
                Animated.parallel([
                    Animated.spring(rejectButtonScale, {
                        toValue: 0.95,
                        useNativeDriver: true,
                    }),
                    Animated.timing(rejectButtonOpacity, {
                        toValue: 0.8,
                        duration: 100,
                        useNativeDriver: true,
                    }),
                ]),
                Animated.parallel([
                    Animated.spring(rejectButtonScale, {
                        toValue: 1,
                        useNativeDriver: true,
                    }),
                    Animated.timing(rejectButtonOpacity, {
                        toValue: 1,
                        duration: 100,
                        useNativeDriver: true,
                    }),
                ]),
            ]).start();
        }
    }, [rejectButtonScale, rejectButtonOpacity]);

    // Função para aceitar corrida e iniciar fluxo
    const acceptRideAndStart = async () => {
        if (!isTimerActive || timer === 0 || !currentRideRequest) {
            Logger.warn('⚠️ [DriverUI] Tentativa de aceitar corrida bloqueada:', {
                isTimerActive,
                timer,
                hasCurrentRideRequest: !!currentRideRequest
            });
            return;
        }

        // ✅ NOVO: Validar conexão antes de aceitar corrida
        const ConnectionValidator = require('../../utils/ConnectionValidator').default;
        const connectionValidation = await ConnectionValidator.validateBeforeAcceptRide();

        if (!connectionValidation.valid) {
            // Conexão não disponível - não aceitar
            return;
        }

        // ✅ Animação de sucesso
        animateAcceptButton('success');

        setIsTimerActive(false);
        setRideStatus('accepted');

        // Aceitar booking via WebSocket
        if (currentRideRequest.bookingId) {
            try {
                Logger.log('📤 [DriverUI] Enviando acceptRide para servidor:', {
                    bookingId: currentRideRequest.bookingId,
                    timestamp: new Date().toISOString()
                });

                await acceptBooking(currentRideRequest.bookingId);

            } catch (error) {
                Logger.error('❌ [DriverUI] Erro ao aceitar booking:', {
                    error: error.message,
                    stack: error.stack,
                    bookingId: currentRideRequest.bookingId,
                    timestamp: new Date().toISOString()
                });
                Alert.alert('Erro', 'Não foi possível aceitar a corrida. Tente novamente.');
                setCurrentRideRequest(null);
                setRideStatus('idle');
                return;
            }
        }

        // Notificar passageiro (em produção seria via WebSocket/API)
        notifyPassenger('rideAccepted', {
            driverId: auth.profile?.uid,
            estimatedArrival: currentRideRequest.estimatedArrival
        });

        // ✅ Iniciar corrida com notificação e localização (Google Play Store compliant)
        try {
            await RideLocationManager.startRide({
                bookingId: currentRideRequest.bookingId,
                status: 'accepted',
                userType: 'driver',
                pickup: {
                    address: currentRideRequest.pickupAddress || 'Local de embarque',
                    lat: currentRideRequest.pickupLat,
                    lng: currentRideRequest.pickupLng
                },
                customerName: currentRideRequest.customerName || 'Passageiro'
            });
        } catch (error) {
            Logger.warn('⚠️ [DriverUI] Erro ao iniciar corrida:', error);
        }

        // Abrir Waze para local de embarque
        navigateToPickup();

        // Atualizar status para "a caminho do embarque"
        setRideStatus('enRoute');
    };

    // Função para notificar passageiro
    const notifyPassenger = (action, data) => {
        Logger.log(`📱 Notificando passageiro: ${action}`, data);
        // Em produção: enviar via WebSocket/API para o app do passageiro
    };

    // Função para chegar ao local de embarque
    const arriveAtPickup = async () => {
        Logger.log('📍 Cheguei ao local de embarque');
        setRideStatus('atPickup');
        setIsPickupTimerActive(true);

        // Notificar passageiro que motorista chegou
        notifyPassenger('driverArrived', {
            driverId: auth.profile?.uid,
            location: currentRideRequest.pickupAddress
        });

        // ✅ Atualizar status da corrida
        try {
            await RideLocationManager.updateRideStatus({
                status: 'arrived',
                pickup: {
                    address: currentRideRequest.pickupAddress || 'Local de embarque'
                },
                customerName: currentRideRequest.customerName || 'Passageiro'
            });
        } catch (error) {
            Logger.warn('⚠️ [DriverUI] Erro ao atualizar corrida:', error);
        }

        // Mostrar card com timer de embarque
        Alert.alert(
            '📍 Cheguei ao Local de Embarque',
            'Aguardando passageiro embarcar...\n\nTempo limite: 2 minutos',
            [
                {
                    text: '⏰ Ver Timer',
                    onPress: () => Logger.log('⏰ Timer de embarque ativo')
                }
            ]
        );
    };

    // Função para iniciar corrida (após embarque)
    const startRide = async () => {
        // ✅ CORREÇÃO: Usar currentBooking se aceito, senão currentRideRequest
        const booking = currentBooking || currentRideRequest;
        const bookingId = booking?.bookingId;

        if (!bookingId) {
            Alert.alert('Erro', 'ID da corrida não encontrado');
            return;
        }

        try {
            Logger.log('🚗 Iniciando corrida...');

            // ✅ NOVO: Validar conexão antes de iniciar viagem
            const ConnectionValidator = require('../../utils/ConnectionValidator').default;
            const connectionValidation = await ConnectionValidator.validateBeforeStartTrip();

            if (!connectionValidation.valid) {
                // Conexão não disponível - não iniciar
                return;
            }

            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            // Obter localização atual para início da viagem
            const startLocation = currentLocation ? {
                lat: currentLocation.lat,
                lng: currentLocation.lng
            } : null;

            // Iniciar viagem via WebSocket
            const result = await webSocketManager.startTrip(
                bookingId,
                startLocation
            );

            if (result && result.success) {
                setRideStatus('inProgress');
                setIsPickupTimerActive(false);

                // ✅ Atualizar status da corrida no TripDataService
                if (currentRideRequest?.bookingId) {
                    TripDataService.updateTripStatus(currentRideRequest.bookingId, 'started', {
                        startedLocation: startLocation
                    }).catch(err => {
                        Logger.warn('⚠️ [DriverUI] Erro ao atualizar status:', err);
                    });
                }

                // ✅ Atualizar status da corrida
                try {
                    const booking = currentBooking || currentRideRequest;
                    await RideLocationManager.updateRideStatus({
                        status: 'started',
                        destination: {
                            address: booking?.drop?.add || booking?.destinationAddress || 'Destino'
                        },
                        estimatedTime: booking?.estimatedTime || 15
                    });
                } catch (error) {
                    Logger.warn('⚠️ [DriverUI] Erro ao atualizar corrida:', error);
                }

                // Abrir modal de navegação para destino
                navigateToDestination();

                // Mostrar card de corrida em andamento
                Alert.alert(
                    '🚗 Corrida Iniciada',
                    'Navegando para o destino...',
                    [
                        {
                            text: '🗺️ Ver Navegação',
                            onPress: () => Logger.log('🗺️ Navegação ativa')
                        }
                    ]
                );
            } else {
                throw new Error(result.error || 'Falha ao iniciar viagem');
            }

        } catch (error) {
            Logger.error('❌ Erro ao iniciar corrida:', error);

            // ✅ Mensagem de erro mais clara para pagamento não confirmado
            let errorMessage = error.message || 'Não foi possível iniciar a viagem. Tente novamente.';
            let errorTitle = 'Erro ao Iniciar Corrida';

            if (error.message && error.message.includes('Pagamento não confirmado')) {
                errorTitle = '💳 Pagamento Não Confirmado';
                errorMessage = 'O pagamento do passageiro ainda não foi confirmado. Aguarde a confirmação antes de iniciar a corrida.';
            } else if (error.message && error.message.includes('payment')) {
                errorTitle = '💳 Erro de Pagamento';
                errorMessage = 'Não foi possível verificar o status do pagamento. A corrida não pode ser iniciada por segurança.';
            }

            Alert.alert(errorTitle, errorMessage);
        }
    };

    // Função para chegar ao destino
    const arriveAtDestination = () => {
        Logger.log('🎯 Cheguei ao destino');
        setRideStatus('completed');

        // Notificar passageiro que chegou ao destino
        notifyPassenger('rideCompleted', {
            driverId: auth.profile?.uid,
            endTime: new Date().toISOString()
        });

        // Mostrar opção de encerrar corrida
        Alert.alert(
            '🎯 Cheguei ao Destino',
            'Corrida concluída! Deseja encerrar?',
            [
                {
                    text: '✅ Encerrar Corrida',
                    onPress: () => endRide()
                },
                {
                    text: '📱 Ver Detalhes',
                    onPress: () => Logger.log('📱 Detalhes da corrida')
                }
            ]
        );
    };

    // Função para encerrar corrida (chamada pelo botão)
    const handleEndRide = async () => {
        // ✅ Cancelar notificações interativas da corrida
        if (currentRideRequest?.bookingId) {
            try {
                const InteractiveNotificationService = require('../../services/InteractiveNotificationService').default;
                await InteractiveNotificationService.dismissTripNotifications(currentRideRequest.bookingId);
                Logger.log('✅ [DriverUI] Notificações interativas canceladas');
            } catch (error) {
                Logger.warn('⚠️ [DriverUI] Erro ao cancelar notificações:', error);
            }
        }

        // ✅ Fechar notificação mock se estiver aberta
        setShowSystemNotificationMock(false);
        setIsNotificationExpanded(false);
        setMockArrivedAtPickup(false);
        setMockTripStarted(false);
        setMockArrivedAtDestination(false);

        // ✅ IMPORTANTE: Limpar chat da UI (mensagens já estão salvas no banco)
        setChatMessages([]);
        setMessageText('');
        Logger.log('🧹 [DriverUI] Chat limpo da UI (mensagens permanecem no banco para auditoria)');

        // Abrir modal de avaliação (sem obrigatoriedade)
        setRatingModalVisible(true);

        // Encerrar corrida em background
        await endRide();
    };

    // Função para encerrar corrida
    const endRide = async () => {
        if (!currentRideRequest?.bookingId) {
            Alert.alert('Erro', 'ID da corrida não encontrado');
            return;
        }

        try {
            Logger.log('🏁 Encerrando corrida...');

            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            // Obter localização final (destino)
            const endLocation = currentLocation ? {
                lat: currentLocation.lat,
                lng: currentLocation.lng
            } : null;

            // Calcular distância total da viagem (pickup até destino)
            // Tentar usar coordenadas do booking original ou do rideRequest
            let distance = 5.0; // Default em km
            const booking = currentBooking || currentRideRequest;

            if (booking?.pickup?.lat && booking?.drop?.lat) {
                distance = GetDistance(
                    booking.pickup.lat,
                    booking.pickup.lng,
                    booking.drop.lat,
                    booking.drop.lng
                );
            } else if (booking?.distance) {
                distance = typeof booking.distance === 'number'
                    ? (booking.distance > 100 ? booking.distance / 1000 : booking.distance) // Se > 100, assume metros
                    : parseFloat(booking.distance) || 5.0;
            } else if (currentRideRequest?.pickupDistance) {
                // Usar pickupDistance do card como fallback (já em km)
                distance = parseFloat(currentRideRequest.pickupDistance) || 5.0;
            }

            // Usar fare do booking original ou valor do card
            const fare = parseFloat(
                currentBooking?.estimate ||
                currentBooking?.finalFare ||
                currentRideRequest?.value ||
                0
            );

            // ✅ NOVO: Validar conexão antes de finalizar viagem
            const ConnectionValidator = require('../../utils/ConnectionValidator').default;
            const connectionValidation = await ConnectionValidator.validateBeforeCompleteTrip();

            if (!connectionValidation.valid) {
                // Conexão não disponível - não finalizar
                Alert.alert(
                    'Sem Conexão',
                    'Você precisa de conexão com a internet para finalizar a viagem. Verifique sua conexão e tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            // Finalizar viagem via WebSocket
            const result = await webSocketManager.completeTrip(
                currentRideRequest.bookingId,
                endLocation,
                distance,
                fare
            );

            if (result.success) {

                // ✅ Finalizar e salvar todos os dados da corrida
                if (currentRideRequest?.bookingId) {
                    const finalData = {
                        finalFare: fare,
                        distance: distance,
                        duration: null, // Pode ser calculado depois
                        drop: endLocation ? {
                            lat: endLocation.lat,
                            lng: endLocation.lng,
                            address: currentRideRequest.drop?.address || currentRideRequest.dropAddress
                        } : null
                    };

                    TripDataService.completeTrip(currentRideRequest.bookingId, finalData).catch(err => {
                        Logger.warn('⚠️ [DriverUI] Erro ao finalizar tracking:', err);
                    });
                }

                // ✅ Finalizar corrida (remove notificação e para localização)
                try {
                    await RideLocationManager.endRide();
                } catch (error) {
                    Logger.warn('⚠️ [DriverUI] Erro ao finalizar corrida:', error);
                }

                // Limpar estados
                setCurrentRideRequest(null);
                setRideStatus('idle');
                setTimer(15);
                setIsTimerActive(true);
                setPickupTimer(120);
                setIsPickupTimerActive(false);

                // Modal de avaliação já foi aberto em handleEndRide
                // Não precisa chamar startRatingFlow aqui
            } else {
                throw new Error(result.error || 'Falha ao finalizar viagem');
            }

        } catch (error) {
            Logger.error('❌ Erro ao encerrar corrida:', error);
            Alert.alert('Erro', error.message || 'Não foi possível finalizar a viagem. Tente novamente.');
        }
    };

    // Função para iniciar fluxo de avaliação
    const startRatingFlow = () => {
        Logger.log('⭐ Iniciando fluxo de avaliação...');

        // Mostrar modal de avaliação
        setRatingModalVisible(true);

        // Em produção: enviar dados da corrida para o sistema de avaliação
        notifyPassenger('ratingRequested', {
            driverId: auth.profile?.uid,
            rideId: 'ride_123', // ID da corrida
            requestTime: new Date().toISOString()
        });
    };

    // Função para atualizar localização em tempo real
    const updateDriverLocation = async () => {
        if (!currentBooking || tripStatus !== 'started') {
            return;
        }

        try {
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected() && currentLocation && driverId) {
                await webSocketManager.updateDriverLocation(
                    driverId,
                    currentLocation.lat,
                    currentLocation.lng,
                    currentLocation.heading || 0,
                    currentLocation.speed || 0
                );

                setDriverLocation(currentLocation);
            }
        } catch (error) {
            Logger.error('❌ Erro ao atualizar localização:', error);
        }
    };

    // Função para lidar com avaliação da viagem
    const handleRatingSubmit = async (ratingData) => {
        try {
            Logger.log('⭐ Avaliação submetida:', ratingData);

            // Importar RatingService
            const RatingService = require('../../services/RatingService').default;

            // Enviar avaliação
            const result = await RatingService.submitRating(ratingData);

            if (result.success) {
                Logger.log('✅ Avaliação enviada com sucesso');

                // ✅ Salvar avaliação no TripDataService
                const bookingId = ratingData.tripId || currentBooking?.bookingId || currentRideRequest?.bookingId;
                if (bookingId) {
                    TripDataService.saveRating(bookingId, {
                        driverRating: null, // Motorista avalia passageiro
                        passengerRating: ratingData.rating,
                        passengerComment: ratingData.comment,
                        passengerOptions: ratingData.selectedOptions || []
                    }).catch(err => {
                        Logger.warn('⚠️ [DriverUI] Erro ao salvar avaliação:', err);
                    });
                }

                // 🚀 CORREÇÃO: Resetar apenas estados de corrida, NÃO o status online/offline
                setTripStatus('idle');
                setCurrentBooking(null);
                setCurrentRide(null);
                setCurrentRideRequest(null);
                setRideStatus('idle');
                setMessageText(''); // ✅ NOVO: Limpar campo de mensagem
                setChatMessages([]); // ✅ NOVO: Limpar mensagens do chat
                setRatingModalVisible(false);
                setMockArrivedAtPickup(false);
                setMockArrivedAtDestination(false);
                setMockTripStarted(false);
                setShowSystemNotificationMock(false);

                // ✅ NOVO: Notificação final
                Alert.alert(
                    '✅ Obrigado por dirigir com a Leaf!',
                    'Sua avaliação foi registrada. Continue oferecendo ótimos serviços!',
                    [{ text: 'OK' }]
                );

                Logger.log('🔄 Estados de corrida resetados - motorista continua online/offline conforme configurado');

            } else {
                throw new Error(result.error || 'Falha ao enviar avaliação');
            }

        } catch (error) {
            Logger.error('❌ Erro ao enviar avaliação:', error);
            Alert.alert('Erro', error.message || 'Falha ao enviar avaliação');
        }
    };

    // Função para mostrar modal de avaliação
    const showRatingModal = () => {
        setRatingModalVisible(true);
    };

    // Funções de navegação externa
    const openNavigationApp = async (destination, navigationType = 'pickup') => {
        try {
            const { latitude, longitude, address } = destination;

            // Verificar se Google Maps está instalado
            const isGoogleMapsInstalled = await Linking.canOpenURL('comgooglemaps://');

            // Verificar se Waze está instalado
            const isWazeInstalled = await Linking.canOpenURL('waze://');

            if (!isGoogleMapsInstalled && !isWazeInstalled) {
                // Nenhum app de navegação instalado, abrir no navegador
                const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
                await Linking.openURL(url);
                return;
            }

            // Mostrar opções de navegação
            const navigationOptions = [];

            if (isGoogleMapsInstalled) {
                navigationOptions.push({
                    text: '🗺️ Google Maps',
                    onPress: () => openGoogleMaps(latitude, longitude, address, navigationType)
                });
            }

            if (isWazeInstalled) {
                navigationOptions.push({
                    text: '🧭 Waze',
                    onPress: () => openWaze(latitude, longitude, address, navigationType)
                });
            }

            // Adicionar opção de navegador web
            navigationOptions.push({
                text: '🌐 Navegador Web',
                onPress: () => {
                    const url = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
                    Linking.openURL(url);
                }
            });

            // Adicionar opção de cancelar
            navigationOptions.push({
                text: 'Cancelar',
                style: 'cancel'
            });

            Alert.alert(
                `Navegar para ${navigationType === 'pickup' ? 'Embarque' : 'Destino'}`,
                'Escolha seu app de navegação:',
                navigationOptions
            );

        } catch (error) {
            Logger.error('❌ Erro ao abrir navegação:', error);
            Alert.alert('Erro', 'Não foi possível abrir a navegação.');
        }
    };

    const openGoogleMaps = async (latitude, longitude, address, navigationType) => {
        try {
            const destination = `${latitude},${longitude}`;
            const label = navigationType === 'pickup' ? 'Local de Embarque' : 'Destino';

            // URL para Google Maps
            const url = Platform.OS === 'ios'
                ? `comgooglemaps://?daddr=${destination}&q=${encodeURIComponent(address)}`
                : `google.navigation:q=${destination}`;

            await Linking.openURL(url);

            Logger.log(`✅ Google Maps aberto para ${label}: ${address}`);

        } catch (error) {
            Logger.error('❌ Erro ao abrir Google Maps:', error);
            // Fallback para navegador web
            const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
            await Linking.openURL(webUrl);
        }
    };

    const openWaze = async (latitude, longitude, address, navigationType) => {
        try {
            const label = navigationType === 'pickup' ? 'Local de Embarque' : 'Destino';

            // ✅ CORREÇÃO: URL do Waze deve usar formato correto
            // Formato: waze://?ll=LATITUDE,LONGITUDE&navigate=yes
            // Se tiver endereço, usar: waze://?q=ADDRESS ou waze://?ll=LAT,LNG&navigate=yes
            let url;
            if (address && address !== 'Local de embarque' && address !== 'Destino') {
                // Tentar com endereço primeiro (mais preciso)
                url = `waze://?q=${encodeURIComponent(address)}&navigate=yes`;
            } else {
                // Usar coordenadas
                url = `waze://?ll=${latitude},${longitude}&navigate=yes`;
            }

            Logger.log(`🧭 [DRIVER] Abrindo Waze com URL: ${url}`);
            Logger.log(`🧭 [DRIVER] Coordenadas: ${latitude}, ${longitude}`);
            Logger.log(`🧭 [DRIVER] Endereço: ${address}`);

            await Linking.openURL(url);

            Logger.log(`✅ Waze aberto para ${label}: ${address || `${latitude}, ${longitude}`}`);

        } catch (error) {
            Logger.error('❌ Erro ao abrir Waze:', error);
            // Fallback para navegador web
            const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
            await Linking.openURL(webUrl);
        }
    };

    // Função para abrir modal de navegação
    const openNavigationModal = (destination, type = 'pickup', passengerName = null, destinationAddress = null) => {
        if (!destination || !destination.latitude || !destination.longitude) {
            Logger.error('❌ Destino inválido para navegação:', destination);
            Alert.alert('Erro', 'Dados de navegação inválidos.');
            return;
        }

        setNavigationDestination({
            latitude: destination.latitude,
            longitude: destination.longitude,
            address: destination.address || ''
        });
        setNavigationType(type);

        // Definir nome do passageiro ou endereço do destino
        if (type === 'pickup') {
            setNavigationPassengerName(passengerName || 'Passageiro');
        } else if (type === 'destination') {
            setNavigationPassengerName(destinationAddress || destination.address || 'Destino');
        }

        setNavigationModalVisible(true);
    };

    // Função para navegar até o local de embarque
    const navigateToPickup = () => {
        // ✅ CORREÇÃO: Usar currentBooking se aceito, senão currentRideRequest
        const booking = currentBooking || currentRideRequest;

        if (!booking) {
            Logger.error('❌ Nenhum booking disponível para navegação');
            Alert.alert('Erro', 'Dados da corrida não disponíveis');
            return;
        }

        Logger.log('🔍 [DRIVER] Booking completo para navegação:', JSON.stringify(booking, null, 2));

        // ✅ CORREÇÃO: Usar coordenadas reais do pickup
        // Verificar múltiplas possibilidades de onde as coordenadas podem estar
        let pickupLat = null;
        let pickupLng = null;
        let pickupAddress = null;

        // Tentar currentBooking primeiro (quando aceito)
        if (booking.pickup?.lat && booking.pickup?.lng) {
            pickupLat = booking.pickup.lat;
            pickupLng = booking.pickup.lng;
            pickupAddress = booking.pickup.add || booking.pickupAddress;
        } else if (booking.pickupLocation?.lat && booking.pickupLocation?.lng) {
            pickupLat = booking.pickupLocation.lat;
            pickupLng = booking.pickupLocation.lng;
            pickupAddress = booking.pickupLocation.add || booking.pickupAddress;
        }
        // Tentar currentRideRequest (quando ainda não aceito)
        else if (currentRideRequest?.pickup?.lat && currentRideRequest?.pickup?.lng) {
            pickupLat = currentRideRequest.pickup.lat;
            pickupLng = currentRideRequest.pickup.lng;
            pickupAddress = currentRideRequest.pickup.add || currentRideRequest.pickupAddress;
        } else if (currentRideRequest?.pickupLocation?.lat && currentRideRequest?.pickupLocation?.lng) {
            pickupLat = currentRideRequest.pickupLocation.lat;
            pickupLng = currentRideRequest.pickupLocation.lng;
            pickupAddress = currentRideRequest.pickupLocation.add || currentRideRequest.pickupAddress;
        }

        if (!pickupLat || !pickupLng) {
            Logger.error('❌ Coordenadas de pickup não disponíveis. Booking:', booking);
            Alert.alert('Erro', 'Coordenadas de embarque não disponíveis');
            return;
        }

        const pickupLocation = {
            latitude: parseFloat(pickupLat),
            longitude: parseFloat(pickupLng),
            address: pickupAddress || 'Local de embarque'
        };

        // Obter nome do passageiro
        const passengerName = booking?.customerName || booking?.passengerName || currentRideRequest?.customerName || currentRideRequest?.passengerName || 'Passageiro';

        Logger.log('🧭 [DRIVER] Abrindo modal de navegação para pickup:', pickupLocation);
        if (pickupLocation && pickupLocation.latitude && pickupLocation.longitude) {
            openNavigationModal(pickupLocation, 'pickup', passengerName);
        } else {
            Alert.alert('Erro', 'Coordenadas de embarque inválidas.');
        }
    };

    // Função para navegar até o destino
    const navigateToDestination = () => {
        // ✅ CORREÇÃO: Usar currentBooking se aceito, senão currentRideRequest
        const booking = currentBooking || currentRideRequest;

        if (!booking) {
            Logger.error('❌ Nenhum booking disponível para navegação');
            Alert.alert('Erro', 'Dados da corrida não disponíveis');
            return;
        }

        // ✅ CORREÇÃO: Usar coordenadas reais do destino
        let dropLat = null;
        let dropLng = null;
        let dropAddress = null;

        // Tentar currentBooking primeiro (quando aceito)
        if (booking.drop?.lat && booking.drop?.lng) {
            dropLat = booking.drop.lat;
            dropLng = booking.drop.lng;
            dropAddress = booking.drop.add || booking.destinationAddress;
        } else if (booking.destinationLocation?.lat && booking.destinationLocation?.lng) {
            dropLat = booking.destinationLocation.lat;
            dropLng = booking.destinationLocation.lng;
            dropAddress = booking.destinationLocation.add || booking.destinationAddress;
        }
        // Tentar currentRideRequest (quando ainda não aceito)
        else if (currentRideRequest?.drop?.lat && currentRideRequest?.drop?.lng) {
            dropLat = currentRideRequest.drop.lat;
            dropLng = currentRideRequest.drop.lng;
            dropAddress = currentRideRequest.destinationAddress || currentRideRequest.drop.add;
        }

        if (!dropLat || !dropLng) {
            Logger.error('❌ Coordenadas de destino não disponíveis. Booking:', booking);
            Alert.alert('Erro', 'Coordenadas de destino não disponíveis');
            return;
        }

        const destinationLocation = {
            latitude: parseFloat(dropLat),
            longitude: parseFloat(dropLng),
            address: dropAddress || 'Destino'
        };

        Logger.log('🧭 [DRIVER] Abrindo modal de navegação para destino:', destinationLocation);
        if (destinationLocation && destinationLocation.latitude && destinationLocation.longitude) {
            openNavigationModal(destinationLocation, 'destination', null, dropAddress || destinationLocation.address || 'Destino');
        } else {
            Alert.alert('Erro', 'Coordenadas de destino inválidas.');
        }
    };


    // ✅ Tela de loading durante inicialização
    if (isLoading || !auth?.profile?.name) {
        return <DriverLoadingScreen userName={auth?.profile?.name || auth?.profile?.displayName || 'Motorista'} />;
    }

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* ✅ Banner de status de conexão (não bloqueante) */}
            <NetworkStatusBanner />

            {/* ✅ Modal explicativo antes de solicitar permissão de background location */}
            <PermissionExplanationModal
                visible={showBackgroundLocationModal}
                onClose={handleBackgroundLocationCancel}
                onAccept={handleBackgroundLocationAccept}
                permissionType="location"
                userType="driver"
                locationType="background"
            />

            {/* ✅ Banner quando background location está negada e motorista está online */}
            <LocationPermissionBanner
                visible={showBackgroundLocationBanner && isOnline}
                onDismiss={() => setShowBackgroundLocationBanner(false)}
                onEnable={() => {
                    // Abrir configurações para ativar background location
                    if (Platform.OS === 'ios') {
                        Linking.openURL('app-settings:');
                    } else {
                        Linking.openSettings();
                    }
                }}
                userType="driver"
                locationType="background"
            />

            {/* Header com informações do driver */}
            <View style={[styles.headerFloating, { zIndex: getButtonZIndex() }]}>
                <View style={styles.header}>
                    <TouchableOpacity
                        style={[styles.headerButton, { backgroundColor: theme.card }]}
                        onPress={() => {
                            if (navigation && navigation.navigate) {
                                navigation.navigate('Profile');
                            }
                        }}
                    >
                        <Ionicons name="menu" color={theme.text} size={24} />
                    </TouchableOpacity>

                    <View style={{ marginLeft: 6 }}>
                        <ProfileToggle userId={auth?.profile?.uid} style="prominent" size="small" />
                    </View>

                    <View style={styles.headerRightContainer}>
                        {/* Botão de ajuda */}
                        <TouchableOpacity
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={() => {
                                if (navigation && navigation.navigate) {
                                    navigation.navigate('Help');
                                } else {
                                    Logger.log('Ajuda: Navegação não disponível');
                                }
                            }}
                        >
                            <Ionicons name="help-circle-outline" color={theme.text} size={24} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={() => {
                                if (navigation && navigation.navigate) {
                                    navigation.navigate('Notifications');
                                } else {
                                    Logger.log('Notificações: Navegação não disponível');
                                }
                            }}
                        >
                            <Ionicons name="notifications-outline" color={theme.text} size={24} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.headerButton, { backgroundColor: theme.card }]}
                            onPress={toggleTheme}
                        >
                            <Icon
                                name={isDarkMode ? "sunny" : "moon"}
                                type="ionicon"
                                color={theme.text}
                                size={24}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Modal de Ganhos do Motorista - Clicável */}
            <TouchableOpacity
                style={[styles.earningsFloating, { zIndex: getButtonZIndex(), backgroundColor: theme.leafGreen || '#003002' }]}
                onPress={openBalanceModal}
                activeOpacity={0.8}
            >
                <View style={styles.earningsValueContainer}>
                    {isLoadingBalance ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                        <Typography variant="body" weight="bold" color="#FFFFFF">
                            R$ {driverEarnings.toFixed(2).replace('.', ',')}
                        </Typography>
                    )}
                </View>
            </TouchableOpacity>

            {/* Modal de Saldo e Histórico */}
            <Modal
                visible={balanceModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setBalanceModalVisible(false)}
            >
                <View style={styles.balanceModalOverlay}>
                    <View style={[styles.balanceModalContent, { backgroundColor: theme.card }]}>
                        {/* Header do Modal */}
                        <View style={[styles.balanceModalHeader, { borderBottomColor: theme.border }]}>
                            <Typography variant="h2" color={theme.text}>Saldo e Histórico</Typography>
                            <TouchableOpacity
                                onPress={() => setBalanceModalVisible(false)}
                                style={styles.balanceModalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={theme.text} />
                            </TouchableOpacity>
                        </View>

                        {/* Saldo Atual */}
                        <View style={[styles.balanceCard, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F5F5F5' }]}>
                            <Typography variant="label" color={theme.textSecondary}>Saldo Disponível</Typography>
                            <Typography variant="h1" color={theme.text} style={{ marginVertical: 8 }}>
                                R$ {driverEarnings.toFixed(2).replace('.', ',')}
                            </Typography>
                            <TouchableOpacity
                                onPress={loadDriverEarnings}
                                style={styles.refreshButton}
                            >
                                <Ionicons name="refresh" size={16} color={theme.leafGreen || '#003002'} />
                                <Typography variant="caption" weight="bold" color={theme.leafGreen || '#003002'} style={{ marginLeft: 4 }}>Atualizar</Typography>
                            </TouchableOpacity>
                        </View>

                        {/* Histórico de Transações */}
                        <View style={styles.historySection}>
                            <Typography variant="label" weight="bold" color={theme.text} style={{ marginBottom: 15 }}>Histórico de Movimentações</Typography>

                            {isLoadingHistory ? (
                                <View style={styles.loadingContainer}>
                                    <ActivityIndicator size="small" color={theme.leafGreen || '#003002'} />
                                    <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 8 }}>Carregando histórico...</Typography>
                                </View>
                            ) : transactionHistory.length === 0 ? (
                                <View style={styles.emptyHistory}>
                                    <Ionicons name="receipt-outline" size={48} color={theme.border} />
                                    <Typography variant="body" color={theme.textSecondary} align="center" style={{ marginTop: 10 }}>
                                        Nenhuma transação ainda
                                    </Typography>
                                </View>
                            ) : (
                                <ScrollView style={styles.transactionsList}>
                                    {transactionHistory.map((transaction) => (
                                        <View key={transaction.id} style={[styles.transactionItem, { borderBottomColor: theme.border }]}>
                                            <View style={styles.transactionIcon}>
                                                <Ionicons
                                                    name={transaction.type === 'credit' ? 'arrow-down-circle' : 'arrow-up-circle'}
                                                    size={24}
                                                    color={transaction.type === 'credit' ? theme.leafGreen || '#4CAF50' : '#FF3B30'}
                                                />
                                            </View>
                                            <View style={styles.transactionDetails}>
                                                <Typography variant="body" weight="medium" color={theme.text}>
                                                    {transaction.description ||
                                                        (transaction.type === 'credit' ? 'Crédito de corrida' : 'Débito')}
                                                </Typography>
                                                <Typography variant="caption" color={theme.textSecondary}>
                                                    {transaction.createdAt
                                                        ? new Date(transaction.createdAt).toLocaleString('pt-BR')
                                                        : 'Data não disponível'}
                                                </Typography>
                                            </View>
                                            <View style={styles.transactionAmount}>
                                                <Typography variant="body" weight="bold" color={transaction.type === 'credit' ? theme.leafGreen || '#4CAF50' : '#FF3B30'}>
                                                    {transaction.type === 'credit' ? '+' : '-'}
                                                    R$ {transaction.amount.toFixed(2).replace('.', ',')}
                                                </Typography>
                                            </View>
                                        </View>
                                    ))}
                                </ScrollView>
                            )}
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Card de Solicitação de Corrida - Renderizado quando há solicitação */}
            {/* FORÇA: Renderizar APENAS se não há lista de disponíveis */}
            {currentRideRequest && availableBookings.length === 0 && (
                <View style={[styles.mockRideCardFloating, { zIndex: 300 }]}>
                    <View style={[styles.mockRideCard, { backgroundColor: theme.card }]}>
                        {/* Valor Principal - Centralizado no Topo */}
                        <View style={styles.mockRideValueContainer}>
                            <Typography variant="h1" color={theme.text}>R$ {currentRideRequest.value}</Typography>
                        </View>

                        {/* Categoria */}
                        <View style={styles.mockRideCategoryContainer}>
                            <View style={[styles.mockRideCategory, { backgroundColor: theme.leafGreen || '#003002' }]}>
                                <Typography variant="caption" weight="bold" color="#FFFFFF">{currentRideRequest.category}</Typography>
                            </View>
                        </View>

                        {/* Nota do Passageiro e Verificação */}
                        <View style={styles.mockRidePassenger}>
                            <View style={styles.mockRideRating}>
                                <Ionicons name="star" color="#FFD700" size={16} />
                                <Typography variant="caption" color={theme.text} style={{ marginLeft: 4 }}>{currentRideRequest.passengerRating}</Typography>
                            </View>
                            <Typography variant="caption" color={theme.border} style={{ marginHorizontal: 8 }}>|</Typography>
                            <View style={styles.mockRideVerification}>
                                <Typography variant="caption" color={theme.leafGreen || '#2E7D32'}>Passageiro verificado</Typography>
                            </View>
                        </View>

                        {/* Status da Corrida */}
                        <View style={styles.rideStatusContainer}>
                            <Typography variant="body" weight="bold" color={theme.leafGreen || '#4CAF50'} align="center">
                                {rideStatus === 'accepted' && '✅ Corrida aceita!'}
                                {rideStatus === 'enRoute' && '🚗 A caminho do embarque...'}
                                {rideStatus === 'atPickup' && '📍 Cheguei ao local de embarque'}
                                {rideStatus === 'inProgress' && '🚗 Corrida em andamento...'}
                                {rideStatus === 'completed' && '🎯 Cheguei ao destino!'}
                            </Typography>
                        </View>

                        {/* Tempo até Local de Partida + Distância */}
                        <View style={styles.mockRideLocation}>
                            <View style={styles.mockRideLocationHeader}>
                                <Typography variant="caption" color={theme.textSecondary}>
                                    Embarque em {currentRideRequest.pickupTime} min ({currentRideRequest.pickupDistance} km)
                                </Typography>
                            </View>
                        </View>

                        {/* Endereço de Partida */}
                        <View style={styles.mockRideLocation}>
                            <View style={styles.mockRideLocationHeader}>
                                <Ionicons name="location" color={theme.leafGreen || '#41D274'} size={16} />
                                <Typography variant="body" color={theme.text} style={{ marginLeft: 8 }}>
                                    {currentRideRequest.pickupAddress}
                                </Typography>
                            </View>
                        </View>

                        {/* Endereço de Destino */}
                        <View style={styles.mockRideLocation}>
                            <View style={styles.mockRideLocationHeader}>
                                <Ionicons name="flag" color="#FF6B6B" size={16} />
                                <Typography variant="body" color={theme.text} style={{ marginLeft: 8 }}>
                                    {currentRideRequest.destinationAddress}
                                </Typography>
                            </View>
                        </View>

                        {/* Chegada Estimada */}
                        <View style={styles.mockRideTripInfo}>
                            <Typography variant="caption" color={theme.textSecondary}>
                                Chegada estimada às {currentRideRequest.estimatedArrival}
                            </Typography>
                        </View>

                        {/* Timer de Embarque (quando chegou ao local) */}
                        {rideStatus === 'atPickup' && isPickupTimerActive && (
                            <View style={styles.pickupTimerContainer}>
                                <Typography variant="body" weight="bold" color="#FF3B30">
                                    ⏰ Tempo para embarque: {Math.floor(pickupTimer / 60)}:{(pickupTimer % 60).toString().padStart(2, '0')}
                                </Typography>
                            </View>
                        )}

                        {/* ✅ NOVO: Lista de mensagens do chat */}
                        {(rideStatus === 'enRoute' || rideStatus === 'atPickup' || rideStatus === 'inProgress') && chatMessages.length > 0 && (
                            <View style={[styles.chatMessagesContainer, { backgroundColor: '#F5F5F5', marginTop: 12, marginBottom: 8, marginHorizontal: 16 }]}>
                                <ScrollView
                                    style={styles.chatMessagesScroll}
                                    nestedScrollEnabled={true}
                                    showsVerticalScrollIndicator={false}
                                >
                                    {chatMessages.map((msg) => (
                                        <View
                                            key={msg.id}
                                            style={[
                                                styles.chatMessageBubble,
                                                msg.isOwn ? styles.chatMessageOwn : styles.chatMessageOther,
                                                {
                                                    backgroundColor: msg.isOwn
                                                        ? colors.leafGreen
                                                        : '#FFFFFF',
                                                    alignSelf: msg.isOwn ? 'flex-end' : 'flex-start'
                                                }
                                            ]}
                                        >
                                            <Typography variant="body" color={msg.isOwn ? '#FFFFFF' : theme.text}>
                                                {msg.text}
                                            </Typography>
                                            <Typography variant="small" color={msg.isOwn ? 'rgba(255,255,255,0.7)' : theme.textSecondary} style={{ marginTop: 2 }}>
                                                {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            </Typography>
                                        </View>
                                    ))}
                                </ScrollView>
                            </View>
                        )}

                        {/* ✅ NOVO: Campo de mensagem (apenas durante corrida) */}
                        {(rideStatus === 'enRoute' || rideStatus === 'atPickup' || rideStatus === 'inProgress') && (
                            <View style={styles.messageInputContainer}>
                                <TextInput
                                    style={[styles.messageInput, {
                                        backgroundColor: '#F5F5F5',
                                        color: '#000000',
                                        borderColor: '#DDD'
                                    }]}
                                    placeholder="Enviar mensagem"
                                    placeholderTextColor="#999"
                                    value={messageText}
                                    onChangeText={setMessageText}
                                    multiline={false}
                                />
                                <TouchableOpacity
                                    style={styles.sendMessageButton}
                                    onPress={async () => {
                                        // ✅ Buscar bookingId de múltiplas fontes (currentRideRequest ou currentBooking)
                                        const bookingId = currentRideRequest?.bookingId || currentBooking?.bookingId;

                                        if (!messageText.trim() || !bookingId) {
                                            Alert.alert('Erro', 'Digite uma mensagem para enviar');
                                            return;
                                        }

                                        try {
                                            const webSocketManager = WebSocketManager.getInstance();

                                            if (!webSocketManager.isConnected()) {
                                                Alert.alert('Erro', 'Não conectado ao servidor. Tente novamente.');
                                                return;
                                            }

                                            // ✅ Buscar customerId de múltiplas fontes
                                            const customerId =
                                                currentRideRequest?.customerId ||
                                                currentRideRequest?.customer ||
                                                currentBooking?.customerId ||
                                                currentBooking?.customer ||
                                                currentBooking?.passengerId;

                                            if (!customerId) {
                                                Logger.error('❌ [DriverUI] customerId não encontrado:', {
                                                    currentRideRequest: currentRideRequest ? {
                                                        bookingId: currentRideRequest.bookingId,
                                                        customerId: currentRideRequest.customerId,
                                                        customer: currentRideRequest.customer
                                                    } : null,
                                                    currentBooking: currentBooking ? {
                                                        bookingId: currentBooking.bookingId,
                                                        customerId: currentBooking.customerId,
                                                        customer: currentBooking.customer,
                                                        passengerId: currentBooking.passengerId
                                                    } : null
                                                });
                                                Alert.alert('Erro', 'Não foi possível identificar o passageiro. Tente novamente.');
                                                return;
                                            }

                                            Logger.log('✅ [DriverUI] Enviando mensagem:', {
                                                bookingId,
                                                customerId,
                                                message: messageText.trim().substring(0, 50) + '...'
                                            });

                                            // Enviar mensagem via WebSocket
                                            webSocketManager.emitToServer('sendMessage', {
                                                bookingId: bookingId,
                                                message: messageText.trim(),
                                                senderId: auth.profile?.uid,
                                                receiverId: customerId,
                                                senderType: 'driver'
                                            });

                                            // Adicionar mensagem localmente (otimista)
                                            const newMessage = {
                                                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                                text: messageText.trim(),
                                                senderId: auth.profile?.uid,
                                                senderType: 'driver',
                                                timestamp: new Date().toISOString(),
                                                isOwn: true
                                            };

                                            setChatMessages(prev => [...prev, newMessage]);
                                            const messageToSave = messageText.trim();
                                            setMessageText('');

                                            // Salvar no TripDataService
                                            const TripDataService = require('../../services/TripDataService').default;
                                            TripDataService.addChatMessage(bookingId, {
                                                senderId: auth.profile?.uid,
                                                senderType: 'driver',
                                                message: messageToSave,
                                                timestamp: newMessage.timestamp
                                            }).catch(err => {
                                                Logger.warn('⚠️ [DriverUI] Erro ao salvar mensagem:', err);
                                            });
                                        } catch (error) {
                                            Logger.error('❌ Erro ao enviar mensagem:', error);
                                            Alert.alert('Erro', 'Não foi possível enviar a mensagem');
                                        }
                                    }}
                                    disabled={!messageText.trim()}
                                >
                                    <Ionicons
                                        name="send"
                                        size={20}
                                        color={messageText.trim() ? colors.leafGreen : '#CCC'}
                                    />
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Botões de Ação */}
                        <View style={styles.mockRideActions}>
                            {/* Botão de Aceitar Corrida (estado inicial) - COM ANIMAÇÃO */}
                            {rideStatus === 'idle' && (
                                <Animated.View
                                    style={[
                                        {
                                            transform: [{ scale: acceptButtonScale }],
                                            opacity: acceptButtonOpacity,
                                        },
                                    ]}
                                >
                                    <AnimatedButton
                                        title={isTimerActive && timer > 0
                                            ? `Aceitar Corrida (${timer}s)`
                                            : 'Corrida Expirada'
                                        }
                                        onPress={() => {
                                            animateAcceptButton('press');
                                            acceptRideAndStart();
                                        }}
                                        disabled={!isTimerActive || timer === 0}
                                        variant={(!isTimerActive || timer === 0) ? 'secondary' : 'primary'}
                                    />
                                </Animated.View>
                            )}

                            {/* Botão para chegar ao local de embarque (estado enRoute) */}
                            {rideStatus === 'enRoute' && (
                                <AnimatedButton
                                    title="📍 Cheguei ao Local de Embarque"
                                    onPress={arriveAtPickup}
                                />
                            )}

                            {/* Botão para iniciar corrida (estado atPickup) */}
                            {rideStatus === 'atPickup' && (
                                <>
                                    {/* Tempo estimado de chegada */}
                                    <View style={styles.estimatedArrivalContainer}>
                                        <Ionicons name="time-outline" size={16} color={theme.leafGreen || '#003002'} />
                                        <Typography variant="caption" color={theme.textSecondary} style={{ marginLeft: 6 }}>
                                            Chegada estimada: {currentRideRequest?.estimatedArrivalTime || '15 min'}
                                        </Typography>
                                    </View>
                                    <AnimatedButton
                                        title="🚗 Iniciar Corrida"
                                        onPress={startRide}
                                    />
                                </>
                            )}

                            {/* Botão para chegar ao destino (estado inProgress) */}
                            {rideStatus === 'inProgress' && (
                                <AnimatedButton
                                    title="🎯 Cheguei ao Destino"
                                    onPress={arriveAtDestination}
                                />
                            )}

                            {/* Botão para encerrar corrida (estado completed) */}
                            {rideStatus === 'completed' && (
                                <AnimatedButton
                                    title="✅ Encerrar Corrida"
                                    onPress={endRide}
                                />
                            )}
                        </View>
                    </View>
                </View>
            )}

            {/* Status Online/Offline */}
            <View style={[styles.statusFloating, { zIndex: getButtonZIndex() }]}>
                <TouchableOpacity
                    style={[
                        styles.statusButton,
                        {
                            backgroundColor: isButtonDisabled
                                ? theme.border
                                : (!isApproved
                                    ? '#FF9800' // Laranja para "Concluir Cadastro" e "Cadastrar Veículo"
                                    : (isOnline ? (theme.leafGreen || '#4CAF50') : '#FF3B30') // Verde/vermelho para online/offline
                                ),
                        }
                    ]}
                    onPress={() => {
                        // Se estiver em corrida, encerrar corrida
                        if (rideStatus === 'inProgress' || rideStatus === 'started' || tripStatus === 'started') {
                            handleEndRide();
                        } else {
                            toggleOnlineStatus();
                        }
                    }}
                    activeOpacity={0.8}
                    disabled={isButtonDisabled}
                >
                    <Ionicons
                        name={isOnline ? "checkmark-circle" : "close-circle"}
                        color="#FFFFFF"
                        size={24}
                    />
                    <Typography variant="body" weight="bold" color="#FFFFFF" style={{ marginLeft: 8 }}>
                        {locationDenied
                            ? 'Ative a localização'
                            : !isApproved
                                ? (shouldShowVehicleButton ? 'Cadastrar Veículo' : 'Concluir Cadastro')
                                : (rideStatus === 'inProgress' || rideStatus === 'started' || tripStatus === 'started')
                                    ? 'Encerrar corrida'
                                    : (isOnline ? 'Online' : 'Ficar Online')
                        }
                    </Typography>
                </TouchableOpacity>

                {/* Indicador de status da viagem */}
                {currentBooking && (
                    <View style={[styles.tripStatusIndicator, { backgroundColor: theme.card }]}>
                        <Typography variant="caption" weight="medium" color={theme.text}>
                            {tripStatus === 'accepted' ? '🚗 Dirigindo para passageiro' :
                                tripStatus === 'started' ? '🚀 Viagem em andamento' :
                                    tripStatus === 'completed' ? '✅ Viagem finalizada' : '⏳ Aguardando'}
                        </Typography>
                    </View>
                )}
            </View>

            {/* LISTA DE RESERVAS COMPLETAMENTE REMOVIDA - USAR APENAS CARD COMPLETO */}

            {/* Informações da corrida atual */}
            {currentBooking && (() => {
                const estimate = parseFloat(currentBooking.estimate || 0);
                const driverNetValue = estimate > 0
                    ? calculateDriverNetValue(estimate).driverNetValue.toFixed(2)
                    : 'N/A';

                return (
                    <View style={[styles.rideInfoFloating, { zIndex: getButtonZIndex() }]}>
                        <View style={[styles.rideInfoCard, { backgroundColor: theme.card }]}>
                            <Typography variant="h2" weight="bold" color={theme.text} style={{ marginBottom: 16 }}>
                                {tripStatus === 'accepted' ? 'Corrida Aceita' :
                                    tripStatus === 'started' ? 'Viagem em Andamento' :
                                        tripStatus === 'completed' ? 'Viagem Finalizada' : 'Corrida Atual'}
                            </Typography>

                            <View style={styles.rideDetails}>
                                <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 8 }}>
                                    📍 {currentBooking.pickup?.add || 'Local de partida'}
                                </Typography>
                                <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 8 }}>
                                    🎯 {currentBooking.drop?.add || 'Destino'}
                                </Typography>
                                <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 8 }}>
                                    💰 R$ {driverNetValue}
                                </Typography>
                                {driverLocation && (
                                    <Typography variant="caption" color={theme.textSecondary}>
                                        📍 Sua localização: {driverLocation.lat.toFixed(4)}, {driverLocation.lng.toFixed(4)}
                                    </Typography>
                                )}
                            </View>

                            <View style={styles.rideActions}>
                                {tripStatus === 'accepted' && (
                                    <AnimatedButton
                                        onPress={startTrip}
                                        title="Iniciar Viagem"
                                        variant="primary"
                                        style={{ flex: 1 }}
                                    />
                                )}

                                {tripStatus === 'started' && (
                                    <AnimatedButton
                                        onPress={finishTrip}
                                        title="Finalizar Viagem"
                                        variant="primary"
                                        style={{ flex: 1, backgroundColor: '#4CAF50' }}
                                    />
                                )}

                                {/* Botão de avaliação será mostrado automaticamente após finalizar viagem */}
                                {/* O modal será aberto via Alert quando tripStatus === 'completed' */}
                            </View>
                        </View>
                    </View>
                );
            })()}

            {/* Botão de ajuda removido - agora está no header */}

            {/* Modal de avaliação */}
            <RatingModal
                visible={ratingModalVisible}
                onClose={() => {
                    setRatingModalVisible(false);
                    // 🚀 CORREÇÃO: Resetar apenas estados de corrida, NÃO o status online/offline
                    setTripStatus('idle');
                    setCurrentBooking(null);
                    setCurrentRide(null);
                    setRideStatus('idle');
                    setCurrentRideRequest(null);
                    setMockArrivedAtDestination(false);
                    setMockArrivedAtPickup(false);
                    setMockTripStarted(false);
                    setShowSystemNotificationMock(false);

                    // ✅ NOVO: Notificação final se fechou sem avaliar
                    Alert.alert(
                        '✅ Obrigado por dirigir com a Leaf!',
                        'Continue oferecendo ótimos serviços!',
                        [{ text: 'OK' }]
                    );

                    Logger.log('🔄 Modal fechado - estados de corrida resetados, status online/offline mantido');
                }}
                userType="driver"
                tripData={currentBooking || currentRideRequest}
                onSubmit={handleRatingSubmit}
            />

            {/* BottomSheet de documentos */}
            <BottomSheet
                ref={documentsBottomSheetRef}
                index={-1}
                snapPoints={documentsSnapPoints}
                backdropComponent={renderDocumentsBackdrop}
                enablePanDownToClose={true}
                backgroundStyle={{ backgroundColor: theme.card }}
                handleIndicatorStyle={{ backgroundColor: theme.border }}
            >
                <BottomSheetView>
                    <View style={styles.documentsContent}>
                        <Typography variant="h1" color={theme.text} style={{ marginBottom: 20 }}>
                            Concluir Cadastro
                        </Typography>

                        {/* CNH */}
                        <View style={[styles.documentItem, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F9F9F9', borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 15 }]}>
                            <Typography variant="body" weight="bold" color={theme.text} style={{ marginBottom: 4 }}>
                                Enviar CNH
                            </Typography>
                            <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 12 }}>
                                Enviar foto da CNH aberta (frente e verso) ou anexar em PDF para CNH digital
                            </Typography>
                            <AnimatedButton
                                title={documentStatus.cnh === 'pending' ? 'Enviar CNH' :
                                    documentStatus.cnh === 'uploaded' ? 'CNH Enviada' : 'Em Análise'}
                                onPress={() => uploadDocument('cnh')}
                                size="small"
                                variant={documentStatus.cnh === 'pending' ? 'primary' : 'secondary'}
                            />
                        </View>

                        {/* Comprovante de Residência */}
                        <View style={[styles.documentItem, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F9F9F9', borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 20 }]}>
                            <Typography variant="body" weight="bold" color={theme.text} style={{ marginBottom: 4 }}>
                                Enviar Comprovante de Residência
                            </Typography>
                            <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 12 }}>
                                Conta de água, luz, telefone, fatura de cartão ou outro comprovante em seu nome
                            </Typography>
                            <AnimatedButton
                                title={documentStatus.residence === 'pending' ? 'Enviar Comprovante' :
                                    documentStatus.residence === 'uploaded' ? 'Comprovante Enviado' : 'Em Análise'}
                                onPress={() => uploadDocument('residence')}
                                size="small"
                                variant={documentStatus.residence === 'pending' ? 'primary' : 'secondary'}
                            />
                        </View>

                        {/* Botão fechar */}
                        <AnimatedButton
                            title="Fechar"
                            onPress={closeDocumentsBottomSheet}
                            variant="secondary"
                        />
                    </View>
                </BottomSheetView>
            </BottomSheet>

            {/* BottomSheet para cadastrar veículo */}
            <BottomSheet
                ref={vehicleBottomSheetRef}
                index={-1}
                snapPoints={vehicleSnapPoints}
                backdropComponent={renderVehicleBackdrop}
                enablePanDownToClose={true}
                backgroundStyle={{ backgroundColor: theme.card }}
                handleIndicatorStyle={{ backgroundColor: theme.border }}
            >
                <BottomSheetView>
                    <View style={styles.vehicleContent}>
                        <Typography variant="h1" color={theme.text} style={{ marginBottom: 12 }}>
                            Cadastrar Veículo
                        </Typography>

                        <Typography variant="body" color={theme.textSecondary} style={{ marginBottom: 20 }}>
                            Envie o CRLV do seu veículo em PDF ou foto da galeria
                        </Typography>

                        <AnimatedButton
                            title={documentStatus.vehicle === 'pending' ? 'Enviar CRLV' :
                                documentStatus.vehicle === 'uploaded' ? 'CRLV Enviado' : 'Em Análise'}
                            onPress={uploadVehicleDocument}
                            style={{ marginBottom: 15 }}
                            variant={documentStatus.vehicle === 'pending' ? 'primary' : 'secondary'}
                        />

                        <AnimatedButton
                            title="Fechar"
                            onPress={closeVehicleBottomSheet}
                            variant="secondary"
                        />
                    </View>
                </BottomSheetView>
            </BottomSheet>

            {/* Botão de centralizar removido - já existe no NewMapScreen */}


            {/* ==================== HISTÓRICO DE CORRIDAS ==================== */}
            <BottomSheet
                ref={rideHistoryBottomSheetRef}
                index={-1}
                snapPoints={rideHistorySnapPoints}
                backdropComponent={renderRideHistoryBackdrop}
                enablePanDownToClose={true}
                backgroundStyle={{ backgroundColor: theme.card }}
                handleIndicatorStyle={{ backgroundColor: theme.border }}
            >
                <BottomSheetView>
                    <View style={styles.rideHistoryContent}>
                        <Typography variant="h1" color={theme.text} style={{ marginBottom: 20 }}>
                            Histórico de Corridas
                        </Typography>

                        <ScrollView style={styles.rideHistoryList}>
                            {isLoadingRideHistory ? (
                                <View style={styles.rideHistoryLoadingContainer}>
                                    <ActivityIndicator size="large" color={theme.leafGreen || '#41D274'} />
                                    <Typography variant="body" color={theme.textSecondary} style={{ marginTop: 12 }}>
                                        Carregando histórico...
                                    </Typography>
                                </View>
                            ) : rideHistory.length === 0 ? (
                                <View style={styles.rideHistoryEmptyContainer}>
                                    <Ionicons name="time-outline" size={48} color={theme.border} />
                                    <Typography variant="body" color={theme.textSecondary} align="center" style={{ marginTop: 16 }}>
                                        Nenhuma corrida encontrada
                                    </Typography>
                                    <Typography variant="caption" color={theme.textSecondary} align="center">
                                        Suas corridas concluídas aparecerão aqui
                                    </Typography>
                                </View>
                            ) : (
                                rideHistory.map((ride) => {
                                    // Formatar data
                                    const completedDate = ride.completedAt;
                                    const now = new Date();
                                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                                    const rideDate = new Date(completedDate.getFullYear(), completedDate.getMonth(), completedDate.getDate());

                                    let dateText = '';
                                    if (rideDate.getTime() === today.getTime()) {
                                        dateText = `Hoje, ${completedDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                                    } else if (rideDate.getTime() === today.getTime() - 86400000) {
                                        dateText = `Ontem, ${completedDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
                                    } else {
                                        dateText = completedDate.toLocaleDateString('pt-BR', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        });
                                    }

                                    // Formatar rota
                                    const pickupAddress = ride.pickup?.address || ride.pickup?.add || 'Local de partida';
                                    const dropAddress = ride.drop?.address || ride.drop?.add || 'Destino';
                                    const routeText = `${pickupAddress} → ${dropAddress}`;

                                    // Formatar valor
                                    const fareText = `R$ ${parseFloat(ride.fare || 0).toFixed(2).replace('.', ',')}`;

                                    return (
                                        <View key={ride.id || ride.bookingId} style={[styles.rideHistoryItem, { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.05)' : '#F9F9F9', borderColor: theme.border, borderWidth: 1 }]}>
                                            <View style={styles.rideHistoryItemHeader}>
                                                <Typography variant="caption" weight="medium" color={theme.text}>
                                                    {dateText}
                                                </Typography>
                                                <Typography variant="label" weight="bold" color={theme.leafGreen || '#41D274'}>
                                                    CONCLUÍDA
                                                </Typography>
                                            </View>
                                            <Typography
                                                variant="body"
                                                color={theme.text}
                                                numberOfLines={2}
                                                style={{ marginBottom: 8 }}
                                            >
                                                {routeText}
                                            </Typography>
                                            {ride.distance && (
                                                <Typography variant="caption" color={theme.textSecondary} style={{ marginBottom: 12 }}>
                                                    📏 {ride.distance.toFixed(1)} km
                                                    {ride.duration && ` • ⏱️ ${Math.round(ride.duration)} min`}
                                                </Typography>
                                            )}
                                            <View style={styles.rideHistoryItemFooter}>
                                                <Typography variant="h2" color={theme.text}>
                                                    {fareText}
                                                </Typography>
                                                <TouchableOpacity
                                                    style={[styles.rideHistoryReceiptButton, { backgroundColor: theme.leafGreen || '#41D274' }]}
                                                    onPress={() => {
                                                        if (navigation && navigation.navigate) {
                                                            navigation.navigate('Receipt', {
                                                                rideId: ride.bookingId || ride.id
                                                            });
                                                        } else {
                                                            Alert.alert(
                                                                'Recibo',
                                                                'Navegação não disponível. Use o menu principal para acessar os recibos.'
                                                            );
                                                        }
                                                    }}
                                                    activeOpacity={0.7}
                                                >
                                                    <Ionicons name="receipt-outline" size={16} color="#FFFFFF" />
                                                    <Typography variant="caption" weight="bold" color="#FFFFFF" style={{ marginLeft: 6 }}>
                                                        Recibo
                                                    </Typography>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    );
                                })
                            )}
                        </ScrollView>

                        <AnimatedButton
                            title="Fechar"
                            onPress={closeRideHistoryBottomSheet}
                            variant="secondary"
                        />
                    </View>
                </BottomSheetView>
            </BottomSheet>

            {/* ==================== MOCK DE NOTIFICAÇÃO DO SISTEMA (PREVIEW) ==================== */}
            {showSystemNotificationMock && (
                <View style={styles.systemNotificationMockContainer}>
                    <TouchableOpacity
                        style={[styles.systemNotificationMock, { backgroundColor: isDarkMode ? '#1A1A1A' : '#FFFFFF', borderColor: theme.border, borderWidth: 1 }]}
                        activeOpacity={0.9}
                        onPress={() => setIsNotificationExpanded(!isNotificationExpanded)}
                    >
                        {/* Cabeçalho da notificação (sempre visível) */}
                        <View style={[styles.systemNotificationHeader, { marginBottom: isNotificationExpanded ? 12 : 0 }]}>
                            <View style={styles.systemNotificationHeaderLeft}>
                                <View style={styles.systemNotificationHeaderText}>
                                    {!mockTripStarted ? (
                                        <>
                                            <Typography variant="body" weight="bold" color={theme.text}>
                                                {mockArrivedAtPickup ? 'Aguardando embarque' : 'Corrida aceita!'}
                                            </Typography>
                                            {!mockArrivedAtPickup ? (
                                                <>
                                                    <Typography variant="caption" color={theme.textSecondary}>
                                                        Vá até o local de embarque em:
                                                    </Typography>
                                                    <Typography variant="body" color={theme.text} numberOfLines={2}>
                                                        Praça Mauá, Rio de Janeiro
                                                    </Typography>
                                                </>
                                            ) : (
                                                <Typography variant="body" weight="bold" color={theme.leafGreen || '#41D274'}>
                                                    Timer: {Math.floor(pickupTimer / 60)}:{(pickupTimer % 60).toString().padStart(2, '0')}
                                                </Typography>
                                            )}
                                        </>
                                    ) : mockArrivedAtDestination ? (
                                        <>
                                            <Typography variant="body" weight="bold" color={theme.text}>
                                                Você chegou ao destino
                                            </Typography>
                                            <Typography variant="caption" color={theme.textSecondary}>
                                                Abra o aplicativo para encerrar a corrida
                                            </Typography>
                                        </>
                                    ) : (
                                        <>
                                            <Typography variant="body" weight="bold" color={theme.text}>
                                                A Caminho de Copacabana, Rio de Janeiro
                                            </Typography>
                                            <Typography variant="caption" color={theme.textSecondary}>
                                                Chegada estimada {mockEstimatedArrival || '15:30'}
                                            </Typography>
                                        </>
                                    )}
                                </View>
                            </View>
                            <TouchableOpacity
                                onPress={() => setShowSystemNotificationMock(false)}
                                style={styles.systemNotificationClose}
                            >
                                <Ionicons name="close" size={18} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {/* Botões de ação (aparecem quando expandida) */}
                        {isNotificationExpanded && !mockTripStarted && (
                            <View style={styles.systemNotificationActions}>
                                <TouchableOpacity
                                    style={[styles.systemNotificationActionButton, { backgroundColor: theme.leafGreen || '#41D274' }]}
                                    onPress={() => {
                                        if (mockArrivedAtPickup) {
                                            // Iniciar corrida
                                            Logger.log('🔔 [MOCK] Botão "Iniciar corrida" clicado');
                                            setMockTripStarted(true);
                                            setIsPickupTimerActive(false);
                                            setRideStatus('inProgress');
                                            // Calcular chegada estimada (exemplo: 15 minutos)
                                            const now = new Date();
                                            now.setMinutes(now.getMinutes() + 15);
                                            setMockEstimatedArrival(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
                                        } else {
                                            // Cheguei ao local
                                            Logger.log('🔔 [MOCK] Botão "Cheguei ao local" clicado');
                                            handleNotificationAction('arrived_at_pickup', mockBookingId);
                                        }
                                    }}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name={mockArrivedAtPickup ? "play-circle" : "checkmark-circle"} size={18} color="#FFF" />
                                    <Typography variant="caption" weight="bold" color="#FFFFFF" style={{ marginLeft: 6 }}>
                                        {mockArrivedAtPickup ? 'Iniciar corrida' : 'Cheguei ao local'}
                                    </Typography>
                                </TouchableOpacity>

                                {!mockArrivedAtPickup && (
                                    <TouchableOpacity
                                        style={[styles.systemNotificationActionButton, { backgroundColor: '#FF3B30' }]}
                                        onPress={() => {
                                            Logger.log('🔔 [MOCK] Botão "Cancelar" clicado');
                                            handleNotificationAction('cancel_ride', mockBookingId);
                                            setShowSystemNotificationMock(false);
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <Ionicons name="close-circle" size={18} color="#FFF" />
                                        <Typography variant="caption" weight="bold" color="#FFFFFF" style={{ marginLeft: 6 }}>Cancelar</Typography>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        {/* Indicador de expansão */}
                        <View style={styles.systemNotificationExpandIndicator}>
                            <Ionicons
                                name={isNotificationExpanded ? "chevron-up" : "chevron-down"}
                                size={16}
                                color={theme.textSecondary}
                            />
                        </View>

                        {/* Badge de preview */}
                        <View style={[styles.systemNotificationPreviewBadge, { backgroundColor: theme.leafGreen || '#003002' }]}>
                            <Typography variant="caption" weight="bold" color="#FFFFFF">PREVIEW</Typography>
                        </View>
                    </TouchableOpacity>
                </View>
            )}

            {/* Botão de preview (apenas em desenvolvimento) - COMENTADO */}
            {/* {__DEV__ && (
                <TouchableOpacity
                    style={styles.previewSystemNotificationButton}
                    onPress={() => {
                        setShowSystemNotificationMock(true);
                        setIsNotificationExpanded(false);
                        setMockArrivedAtPickup(false);
                        setMockTripStarted(false);
                        setMockEstimatedArrival(null);
                        setMockArrivedAtDestination(false);
                    }}
                    activeOpacity={0.8}
                >
                    <Ionicons name="notifications-outline" size={20} color="#FFF" />
                    <Text style={styles.previewSystemNotificationButtonText}>Preview Notificação Sistema</Text>
                </TouchableOpacity>
            )} */}


            {/* Modal de Escolha de Navegação */}
            <Modal
                visible={navigationModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setNavigationModalVisible(false)}
            >
                <View style={styles.navigationModalOverlay}>
                    <View style={[styles.navigationModalContent, { backgroundColor: theme.card }]}>
                        {/* Header do Modal */}
                        <View style={styles.navigationModalHeader}>
                            <View style={styles.navigationModalTitleContainer}>
                                <Typography variant="h2" color={theme.text}>
                                    {navigationType === 'pickup'
                                        ? `Navegar para Embarque de ${navigationPassengerName || 'Passageiro'}`
                                        : `Navegar para ${navigationPassengerName || 'Destino'}`
                                    }
                                </Typography>
                            </View>
                            <TouchableOpacity
                                onPress={() => setNavigationModalVisible(false)}
                                style={styles.navigationModalCloseButton}
                            >
                                <Ionicons name="close" size={24} color={theme.text} />
                            </TouchableOpacity>
                        </View>

                        {/* Opções de Navegação */}
                        {navigationDestination && navigationDestination.latitude && navigationDestination.longitude && (
                            <View style={styles.navigationOptionsContainer}>
                                {/* Google Maps */}
                                <TouchableOpacity
                                    style={[styles.navigationOption, { borderBottomColor: theme.border }]}
                                    onPress={async () => {
                                        if (navigationDestination && navigationDestination.latitude && navigationDestination.longitude) {
                                            setNavigationModalVisible(false);
                                            try {
                                                await openGoogleMaps(
                                                    navigationDestination.latitude,
                                                    navigationDestination.longitude,
                                                    navigationDestination.address || '',
                                                    navigationType
                                                );
                                            } catch (error) {
                                                Logger.error('Erro ao abrir Google Maps:', error);
                                                Alert.alert('Erro', 'Não foi possível abrir o Google Maps.');
                                            }
                                        }
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="navigate-circle" size={24} color="#4285F4" />
                                    <Typography variant="body" weight="medium" color={theme.text} style={{ marginLeft: 12 }}>
                                        Abrir com Google Maps
                                    </Typography>
                                </TouchableOpacity>

                                {/* Waze */}
                                <TouchableOpacity
                                    style={[styles.navigationOption, { borderBottomColor: theme.border }]}
                                    onPress={async () => {
                                        if (navigationDestination && navigationDestination.latitude && navigationDestination.longitude) {
                                            setNavigationModalVisible(false);
                                            try {
                                                await openWaze(
                                                    navigationDestination.latitude,
                                                    navigationDestination.longitude,
                                                    navigationDestination.address || '',
                                                    navigationType
                                                );
                                            } catch (error) {
                                                Logger.error('Erro ao abrir Waze:', error);
                                                Alert.alert('Erro', 'Não foi possível abrir o Waze.');
                                            }
                                        }
                                    }}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="navigate-circle" size={24} color="#33CCFF" />
                                    <Typography variant="body" weight="medium" color={theme.text} style={{ marginLeft: 12 }}>
                                        Abrir com Waze
                                    </Typography>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Botão Cancelar */}
                        <AnimatedButton
                            title="Cancelar"
                            onPress={() => setNavigationModalVisible(false)}
                            variant="secondary"
                            style={{ marginTop: 20 }}
                        />
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const loadingStyles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#003002',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        alignItems: 'center',
    },
    welcomeText: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        color: '#FFFFFF',
        marginBottom: 40,
        textAlign: 'center',
    },
    loadingContainer: {
        marginTop: 20,
    },
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },

    // ✅ Barra de status da conexão (SEMPRE VISÍVEL)
    connectionStatusBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        flexDirection: 'row',
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: 'rgba(0,0,0,0.7)',
        gap: 6,
    },
    connectionStatusItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        gap: 4,
    },
    connectionStatusText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '600',
    },

    // Header
    headerFloating: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        zIndex: 100,
        paddingHorizontal: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    headerButton: {
        width: 43, // Aumentado de 40 para 43 (+3px)
        height: 43, // Aumentado de 40 para 43 (+3px)
        borderRadius: 21.5, // Ajustado para metade da largura (43/2)
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
        gap: 3, // Reduzido de 12 para 3 (1/4 do valor anterior)
    },

    // Status Online/Offline
    statusFloating: {
        position: 'absolute',
        bottom: 50,
        left: 0,
        right: 0,
        zIndex: 100,
        alignItems: 'center',
    },
    statusButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 30,
        gap: 12,
        minWidth: 200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
    },
    statusButtonDisabled: {
        opacity: 0.7,
        backgroundColor: '#CCCCCC',
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    statusTextDisabled: {
        color: '#999999',
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
        zIndex: 100,
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
        zIndex: 100,
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



    // BottomSheet de documentos
    documentsContent: {
        padding: 20,
        borderRadius: 20,
        backgroundColor: colors.white,
    },
    documentsTitle: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        marginBottom: 16,
    },
    documentItem: {
        marginBottom: 20,
    },
    documentLabel: {
        fontSize: 16,
        color: colors.black,
        fontFamily: fonts.Medium,
        marginBottom: 8,
    },
    documentSubtext: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 16,
        lineHeight: 22,
    },
    uploadButton: {
        backgroundColor: colors.leafGreen,
        borderRadius: 16,
        paddingVertical: 18,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        minHeight: 56,
    },
    uploadButtonText: {
        color: colors.white,
        fontSize: 18,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },
    closeButton: {
        backgroundColor: colors.grey80,
        borderRadius: 16,
        paddingVertical: 18,
        alignItems: 'center',
        marginTop: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
        minHeight: 56,
    },
    closeButtonText: {
        color: colors.white,
        fontSize: 18,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },

    // BottomSheet para cadastrar veículo
    vehicleContent: {
        padding: 20,
        borderRadius: 20,
        backgroundColor: colors.white,
    },
    vehicleTitle: {
        fontSize: 24,
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'center',
        marginBottom: 16,
    },
    vehicleSubtext: {
        fontSize: 17,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        marginBottom: 32,
        lineHeight: 22,
        textAlign: 'center',
    },

    // Modal de Ganhos - posicionado abaixo dos botões do header
    earningsFloating: {
        position: 'absolute',
        top: 115, // Reduzido de 120 para 115 (subiu mais 5px)
        left: 0,
        right: 0,
        zIndex: 100,
        alignItems: 'center',
    },
    earningsValueContainer: {
        backgroundColor: 'rgba(128, 128, 128, 0.8)', // Cinza 80% transparente
        borderRadius: 30, // Mesmo raio dos botões
        paddingVertical: 16,
        paddingHorizontal: 32,
        minWidth: 120,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
    },
    earningsValue: {
        color: '#FFFFFF',
        fontSize: 18,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },



    // Mock do Card de Nova Corrida - Estila Leaf
    mockRideCardFloating: {
        position: 'absolute',
        bottom: 140, // Posicionado acima do botão de status
        left: 16,
        right: 16,
        zIndex: 300, // Z-index alto para aparecer acima de tudo
    },
    mockRideCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20, // Mais arredondado
        padding: 20,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8, // Mesmo sombreamento do botão
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.1)',
    },
    mockRideValueContainer: {
        alignItems: 'center',
        marginBottom: 8, // Reduzido de 16 para 8 (valor fica no topo)
    },
    mockRideValue: {
        fontSize: 30, // Aumentado de 28 para 30 (+2pt)
        fontWeight: 'bold',
        color: colors.leafGreen,
    },
    mockRideValueDetail: {
        fontSize: 12,
        color: colors.grey80,
        marginTop: 4,
        textAlign: 'center',
    },
    mockRideCategoryContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16, // Mantido para espaçamento com próximo elemento
    },
    mockRideCategory: {
        backgroundColor: '#003002', // Verde da Leaf
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
    },
    mockRideCategoryText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 'bold',
        fontFamily: fonts.Medium,
    },
    mockRidePassenger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4, // Reduzido de 16 para 4px
    },
    mockRideRating: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    mockRideRatingText: {
        fontSize: 14, // Reduzido de 16 para 14 (-2pt)
        color: '#000000',
        fontFamily: fonts.Medium,
        marginLeft: 4,
    },
    mockRideSeparator: {
        fontSize: 14, // Reduzido de 16 para 14 (-2pt)
        color: colors.grey80,
        marginHorizontal: 8,
    },
    mockRideVerification: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    mockRideVerificationText: {
        fontSize: 12, // Reduzido de 14 para 12 (-2pt)
        color: colors.grey80,
        fontFamily: fonts.Medium,
        textAlign: 'center',
    },
    mockRideLocation: {
        marginBottom: 12,
    },
    mockRideLocationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    mockRideLocationTime: {
        fontSize: 14, // Reduzido de 16 para 14 (-2pt)
        color: '#000000',
        fontFamily: fonts.Medium,
    },
    mockRideLocationAddress: {
        fontSize: 15, // Aumentado de 13 para 15 (+2px)
        color: colors.grey80,
        marginLeft: 14, // Alinhado com o texto do tempo
    },
    mockRideTripInfo: {
        alignItems: 'center',
        marginBottom: 20,
    },
    mockRideTripText: {
        fontSize: 20, // Aumentado de 16 para 20 (+4px)
        color: '#000000', // Mudado para preto para destacar
        fontFamily: fonts.Bold, // Mudado para Bold para negrito
        fontWeight: 'bold',
    },
    mockRideActions: {
        marginTop: 8,
        gap: 12, // Espaçamento entre botões
    },
    mockRideAcceptButton: {
        backgroundColor: colors.leafGreen,
        paddingVertical: 18, // Mesmo padding do botão "Concluir cadastro"
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
        minHeight: 56, // Mesma altura do botão "Concluir cadastro"
    },
    mockRideAcceptButtonExpired: {
        backgroundColor: '#CCCCCC',
        opacity: 0.7,
    },
    mockRideAcceptText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: fonts.Medium,
    },
    mockRideAcceptTextExpired: {
        color: '#999999',
    },

    // Mock do Card de Nova Corrida - Estila Leaf
    mockRideDestinationButton: {
        backgroundColor: colors.leafGreen,
        paddingVertical: 18, // Mesmo padding do botão "Concluir cadastro"
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
        minHeight: 56, // Mesma altura do botão "Concluir cadastro"
    },
    mockRideDestinationButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
    },

    // ==================== ESTILOS DO MOCK DE NOTIFICAÇÃO DO SISTEMA ====================
    systemNotificationMockContainer: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 20, // Status bar height
        left: 0,
        right: 0,
        zIndex: 10000,
        paddingHorizontal: 12,
    },
    systemNotificationMock: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#003002',
    },
    systemNotificationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    systemNotificationHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    systemNotificationHeaderText: {
        marginLeft: 10,
        flex: 1,
    },
    systemNotificationTitle: {
        fontSize: 17, // Aumentado de 15 para 17 (+2pt)
        fontWeight: '600',
        color: '#003002',
        marginBottom: 4,
    },
    systemNotificationSubtitle: {
        fontSize: 12,
        color: '#999',
        marginBottom: 2,
        marginTop: 2,
    },
    systemNotificationBody: {
        fontSize: 13,
        color: '#666',
        lineHeight: 18,
        fontWeight: '500',
    },
    systemNotificationClose: {
        padding: 4,
        marginLeft: 8,
    },
    systemNotificationActions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
        marginBottom: 8,
    },
    systemNotificationActionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    systemNotificationActionButtonPrimary: {
        backgroundColor: '#003002',
    },
    systemNotificationActionButtonSecondary: {
        backgroundColor: '#F44336',
    },
    systemNotificationActionButtonText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },
    systemNotificationExpandIndicator: {
        alignItems: 'center',
        marginTop: 4,
    },
    systemNotificationPreviewBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: '#FF9800',
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 4,
    },
    systemNotificationPreviewText: {
        color: '#FFFFFF',
        fontSize: 8,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    previewSystemNotificationButton: {
        position: 'absolute',
        bottom: 100,
        right: 20,
        backgroundColor: '#003002',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
        zIndex: 1000,
    },
    previewSystemNotificationButtonText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },

    testCardButtonFloating: {
        position: 'absolute',
        top: 100, // Posicionado no topo da tela para não interferir com o card
        left: 20,
        right: 20,
        zIndex: 400, // Z-index alto para aparecer acima de tudo
    },
    testCardButton: {
        backgroundColor: colors.leafGreen,
        paddingVertical: 18, // Mesmo padding do botão "Concluir cadastro"
        paddingHorizontal: 24,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
        minHeight: 56, // Mesma altura do botão "Concluir cadastro"
    },
    testCardButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
        fontFamily: fonts.Medium,
    },

    // Ride Status Container
    rideStatusContainer: {
        marginBottom: 16,
    },
    rideStatusText: {
        fontSize: 14,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        textAlign: 'center',
    },

    // Pickup Timer Container
    pickupTimerContainer: {
        marginBottom: 16,
    },
    pickupTimerText: {
        fontSize: 14,
        color: colors.grey80,
        fontFamily: fonts.Medium,
        textAlign: 'center',
    },

    // Modal de Saldo
    balanceModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    balanceModalContent: {
        backgroundColor: colors.white,
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
        borderBottomColor: colors.lightGrey,
    },
    // Modal de Escolha de Navegação
    navigationModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    navigationModalContent: {
        backgroundColor: colors.white,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 40,
        maxHeight: '80%',
    },
    navigationModalHeader: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: colors.lightGrey,
        position: 'relative',
    },
    navigationModalTitleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    navigationModalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.black,
        fontFamily: fonts.Bold,
        textAlign: 'center',
    },
    navigationModalCloseButton: {
        padding: 4,
        position: 'absolute',
        right: 20,
    },
    navigationLocationsContainer: {
        padding: 20,
        paddingBottom: 16,
    },
    navigationLocationItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
        gap: 12,
    },
    navigationLocationTextContainer: {
        flex: 1,
    },
    navigationLocationLabel: {
        fontSize: 12,
        color: colors.grey80,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    navigationLocationAddress: {
        fontSize: 14,
        color: colors.black,
        fontFamily: fonts.Medium,
    },
    navigationEstimatedTimeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        paddingLeft: 32,
    },
    navigationEstimatedTime: {
        fontSize: 14,
        color: colors.leafGreen,
        fontFamily: fonts.Medium,
        fontWeight: '600',
    },
    navigationOptionsContainer: {
        paddingHorizontal: 20,
        paddingTop: 24,
        gap: 12,
    },
    navigationOption: {
        padding: 18,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.lightGrey,
        backgroundColor: colors.white,
        alignItems: 'center',
        justifyContent: 'center',
    },
    navigationOptionText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.black,
        fontFamily: fonts.Medium,
    },
    navigationCancelButton: {
        marginTop: 20,
        marginHorizontal: 20,
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        backgroundColor: colors.lightGrey,
    },
    navigationCancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.black,
        fontFamily: fonts.Medium,
    },
    // Tempo estimado de chegada no card de iniciar corrida
    estimatedArrivalContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: colors.lightGrey,
        borderRadius: 12,
        marginBottom: 12,
        gap: 8,
    },
    estimatedArrivalText: {
        fontSize: 14,
        color: colors.leafGreen,
        fontFamily: fonts.Medium,
        fontWeight: '600',
    },

    balanceModalTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        color: colors.black,
    },
    balanceModalCloseButton: {
        padding: 4,
    },
    balanceCard: {
        backgroundColor: colors.lightGrey,
        margin: 20,
        padding: 20,
        borderRadius: 16,
        alignItems: 'center',
    },
    balanceLabel: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: colors.grey80,
        marginBottom: 8,
    },
    balanceAmount: {
        fontSize: 32,
        fontFamily: fonts.Bold,
        color: colors.leafGreen,
        marginBottom: 12,
    },
    refreshButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: colors.white,
        borderRadius: 8,
    },
    refreshButtonText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: colors.leafGreen,
        marginLeft: 6,
    },
    historySection: {
        flex: 1,
        padding: 20,
    },
    historyTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: colors.black,
        marginBottom: 16,
    },
    loadingContainer: {
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: colors.grey80,
        marginTop: 12,
    },
    emptyHistory: {
        alignItems: 'center',
        padding: 40,
    },
    emptyHistoryText: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        color: colors.greyPlaceholder,
        marginTop: 16,
    },
    transactionsList: {
        maxHeight: 400,
    },
    transactionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.lightGrey,
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
        color: colors.black,
        marginBottom: 4,
    },
    transactionDate: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        color: colors.greyPlaceholder,
    },
    transactionAmount: {
        alignItems: 'flex-end',
    },
    transactionAmountText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    // ✅ NOVO: Estilos do chat
    chatMessagesContainer: {
        maxHeight: 150,
        borderRadius: 8,
        padding: 8,
        marginHorizontal: 4,
    },
    chatMessagesScroll: {
        maxHeight: 150,
    },
    chatMessageBubble: {
        maxWidth: '75%',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 16,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    chatMessageOwn: {
        borderBottomRightRadius: 4,
    },
    chatMessageOther: {
        borderBottomLeftRadius: 4,
    },
    chatMessageText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    chatMessageTime: {
        fontSize: 10,
        fontFamily: fonts.Regular,
        alignSelf: 'flex-end',
    },
    // ✅ Estilos do BottomSheet (mesma estética do PassengerUI)
    bottomSheetBackground: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 10,
    },
    bottomSheetIndicator: {
        backgroundColor: '#E0E0E0',
        width: 40,
        height: 4,
    },
    bottomSheetContent: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 4,
    },
    // ✅ Estilos do menu do motorista - mesma estética do ProfileScreen
    menuContent: {
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: 4,
    },
    menuTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        marginBottom: 20,
        color: colors.black,
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
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginLeft: 4,
        color: colors.black,
    },
    // ✅ NOVO: Estilos do histórico de corridas
    rideHistoryContent: {
        padding: 20,
        flex: 1,
    },
    rideHistoryTitle: {
        fontSize: 24,
        fontFamily: fonts.Bold,
        marginBottom: 20,
        color: colors.black,
    },
    rideHistoryList: {
        flex: 1,
    },
    rideHistoryItem: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    rideHistoryItemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    rideHistoryItemDate: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: colors.grey80,
    },
    rideHistoryItemStatus: {
        fontSize: 12,
        fontFamily: fonts.Bold,
        color: colors.leafGreen,
        textTransform: 'uppercase',
    },
    rideHistoryItemRoute: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        marginBottom: 8,
        color: colors.grey80,
    },
    rideHistoryItemFare: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: colors.leafGreen,
    },
    rideHistoryItemFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
    },
    rideHistoryReceiptButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    rideHistoryReceiptButtonText: {
        fontSize: 14,
        fontFamily: fonts.Medium,
        color: colors.white,
    },
    messageInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 4,
        marginHorizontal: 16,
        gap: 6,
    },
    messageInput: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    sendMessageButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#F5F5F5',
    },
});

// ✅ OTIMIZAÇÃO: Memoizar componente para evitar re-renders desnecessários
export default memo(DriverUI, (prevProps, nextProps) => {
    // Comparar props críticas
    const criticalPropsEqual = (
        prevProps.currentLocation?.lat === nextProps.currentLocation?.lat &&
        prevProps.currentLocation?.lng === nextProps.currentLocation?.lng &&
        prevProps.theme === nextProps.theme
    );

    return criticalPropsEqual;
}); 

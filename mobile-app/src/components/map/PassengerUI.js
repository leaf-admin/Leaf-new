import Logger from '../../utils/Logger';
import React, { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
import {
    StyleSheet,
    View,
    Image,
    Text,
    Platform,
    Alert,
    ScrollView,
    ActivityIndicator,
    TextInput,
    TouchableOpacity,
    Dimensions,
    Keyboard,
    Linking,
    Animated,
    InteractionManager,
    AppState,
    Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import { api } from '../../common-local';
import { fonts } from "../../common-local/font";
// import { useTranslation } from 'react-i18next';
import polyline from '@mapbox/polyline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    prepareEstimateObject,
} from '../../common/sharedFunctions';
import { tollData } from '../../common-local/actions/estimateactions';
import { calcularPedagiosPorPolyline } from '../../common-local/other/TollUtils';
import { fetchPlacesAutocomplete, fetchCoordsfromPlace, getDirectionsApi, detectInputType, fetchGeocodeAddress } from '../../common-local/other/GoogleAPIFunctions';
import TripDataService from '../../services/TripDataService';
import { GetDistance } from '../../common-local/other/GeoFunctions';
import { fetchNearbyDrivers } from '../../common-local/usersactions';
import { updateTripPickup, updateTripDrop, updateTripCar } from '../../common-local/actions/tripactions';
import { MAIN_COLOR } from '../../common/sharedFunctions';
import WebSocketManager from '../../services/WebSocketManager';
import PersistentRideNotificationService from '../../services/PersistentRideNotificationService';
import RideLocationManager from '../../services/RideLocationManager';
import PriceCard from './PriceCard';
import WooviPaymentModal from '../payment/WooviPaymentModal';
import { getEstimate, clearEstimate, setEstimate } from '../../common-local/actions/estimateactions';
import { addBooking } from '../../common-local/actions/bookingactions';
// import { useLocationIntelligence } from '../../hooks/useLocationIntelligence';
import PaymentBypassService from '../../services/PaymentBypassService';
import RatingModal from '../common/RatingModal';
import DriverAvailabilityService from '../../services/DriverAvailabilityService';
import ProfileToggle from '../ProfileToggle';
import { AnimatedButton } from '../design-system/AnimatedButton';
import { Typography } from '../design-system/Typography';
import { colors as semanticColors } from '../../common-local/theme';

function getStreetAndNumber(address) {
    if (!address) return '';
    const match = address.match(/^([^,\-]*\d+)[,\-]?/);
    if (match) return match[1].trim();
    return address.split(',')[0].trim();
}

// ✅ Componente COMPLETAMENTE INDEPENDENTE para o timer - gerencia seu próprio estado
const SearchingTimer = ({ tripStatus, style }) => {
    const [time, setTime] = useState(0);
    const intervalRef = useRef(null);
    const startTimeRef = useRef(null);

    useEffect(() => {
        if (tripStatus === 'searching') {
            // Iniciar timer
            if (!startTimeRef.current) {
                startTimeRef.current = Date.now();
                setTime(0);
            }

            const update = () => {
                if (startTimeRef.current) {
                    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                    setTime(elapsed);
                }
            };

            // Atualizar imediatamente
            update();

            // Atualizar a cada segundo
            intervalRef.current = setInterval(update, 1000);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            };
        } else {
            // Parar timer
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
            setTime(0);
        }
    }, [tripStatus]);

    const formatted = `${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, '0')}`;
    return (
        <Typography variant="h2" style={style}>
            {formatted}
        </Typography>
    );
};

// ✅ Componente para mensagens rotativas - usa o mesmo timer interno
const SearchingMessage = ({ tripStatus, messages, style }) => {
    const [time, setTime] = useState(0);
    const intervalRef = useRef(null);
    const startTimeRef = useRef(null);

    useEffect(() => {
        if (tripStatus === 'searching') {
            if (!startTimeRef.current) {
                startTimeRef.current = Date.now();
                setTime(0);
            }

            const update = () => {
                if (startTimeRef.current) {
                    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
                    setTime(elapsed);
                }
            };

            update();
            intervalRef.current = setInterval(update, 1000);

            return () => {
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
            };
        } else {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            startTimeRef.current = null;
            setTime(0);
        }
    }, [tripStatus]);

    if (tripStatus !== 'searching' || !messages || messages.length === 0) {
        return <Typography variant="body" style={style}>{messages?.[0] || ''}</Typography>;
    }

    const messagesLen = messages.length;
    const index = Math.floor(time / 5) % messagesLen;
    return <Typography variant="body" style={style} align="center">{messages[index]}</Typography>;
};

function PassengerUI(props) {
    // ✅ Hooks devem ser chamados sempre na mesma ordem (regras dos hooks)
    const dispatch = useDispatch();
    // ✅ OTIMIZAÇÃO: Usar shallowEqual para evitar re-renders quando objetos são iguais
    const auth = useSelector(state => state?.auth, shallowEqual);
    const tripdata = useSelector(state => state?.tripdata, shallowEqual);
    const settings = useSelector(state => state?.settingsdata?.settings, shallowEqual);
    const cars = useSelector(state => state?.cartypes?.cars, shallowEqual);
    const estimatedata = useSelector(state => state?.estimatedata, shallowEqual);

    // ✅ Verificar se auth está pronto antes de continuar
    // Se não estiver pronto, retornar componente vazio para evitar erros
    if (!auth || !auth.profile) {
        Logger.log('⏳ [PassengerUI] Aguardando Redux auth estar pronto...');
        return <View style={styles.loadingScreen} />;
    }

    // Função de tradução temporária
    const t = (key) => key;
    const DEV_MODE = __DEV__;

    const { theme, navigation, pickupAddress, currentLocation, setRoutePolyline, mapRef, onDriverLocationUpdate, onNearbyDriversUpdate, onResetManualPickup, onPickupManuallySelectedChange, locationDenied, onRequestLocationPermission } = props; // ✅ Callback para atualizar localização do motorista no mapa e motoristas próximos

    // ✅ Garantir que theme sempre tenha valores válidos
    const safeTheme = theme || {
        card: props.isDarkMode ? '#2A2A2A' : '#FFFFFF',
        icon: props.isDarkMode ? '#FFFFFF' : '#000000',
        text: props.isDarkMode ? '#FFFFFF' : '#000000',
        background: props.isDarkMode ? '#1A1A1A' : '#FFFFFF',
    };

    // ✅ Expor função para resetar seleção manual (usado pelo botão recentralizar)
    useEffect(() => {
        if (onResetManualPickup) {
            // Passar função para resetar seleção manual
            onResetManualPickup.current = () => {
                setPickupManuallySelected(false);
                setIsManuallyEditingPickup(false);
                // ✅ Notificar NewMapScreen para reabilitar showsUserLocation
                if (onPickupManuallySelectedChange) {
                    onPickupManuallySelectedChange(false);
                }
                Logger.log('📍 [PassengerUI] Flag de seleção manual resetada pelo botão recentralizar');
            };
        }
    }, [onResetManualPickup]);

    // DEBUG: Verificar se as props estão chegando
    // Debug: props (removido para reduzir poluição de logs)

    // 🚀 LOCATION INTELLIGENCE DESATIVADO TEMPORARIAMENTE
    // 
    // ✅ CONFIGURAÇÃO ATUAL: Google Places API Direto
    // 💰 CUSTOS: $0.017 por 1000 requisições (Text Search)
    // 📱 FUNCIONALIDADE: Busca de endereços funcionando 100%
    // 🔄 PLANO FUTURO: Reativar cache inteligente para reduzir custos
    // 
    // const locationIntelligence = useLocationIntelligence();

    // Usar allCarTypes que vem como prop do NewMapScreen
    const { allCarTypes = [] } = props;
    const [localAllCarTypes, setLocalAllCarTypes] = useState(allCarTypes);
    const [searchState, setSearchState] = useState({ visible: false, type: 'pickup' });
    const [addressHistory, setAddressHistory] = useState([]);
    const [confirmedDestinations, setConfirmedDestinations] = useState([]); // ✅ Últimos 3 destinos confirmados
    const [bookModelLoading, setBookModelLoading] = useState(false);
    const [isManuallyEditingPickup, setIsManuallyEditingPickup] = useState(false); // ✅ Controla se usuário está editando manualmente
    const [manualPickupText, setManualPickupText] = useState(''); // ✅ Texto manual do endereço de embarque
    const [isPaymentModalVisible, setPaymentModalVisible] = useState(false);
    const [isAddressDetailsModalVisible, setIsAddressDetailsModalVisible] = useState(false); // ✅ Modal para adicionar detalhes ao endereço
    const [addressDetails, setAddressDetails] = useState(''); // ✅ Detalhes adicionais do endereço (ex: "Casa 15, Bloco A")
    const [addressDetailsType, setAddressDetailsType] = useState('pickup'); // ✅ Tipo de endereço (pickup ou drop)
    const [pickupManuallySelected, setPickupManuallySelected] = useState(false); // ✅ Flag para indicar que pickup foi selecionado manualmente (não deve ser sobrescrito pelo GPS)
    const [carEstimates, setCarEstimates] = useState({});
    const [selectedCarType, setSelectedCarType] = useState(null);
    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
    const [localRoutePolyline, setLocalRoutePolyline] = useState([]);
    const [driverToPickupPolyline, setDriverToPickupPolyline] = useState([]); // ✅ Polyline do motorista até o pickup
    const [routeToDestinationPolyline, setRouteToDestinationPolyline] = useState([]); // ✅ NOVO: Polyline da rota até o destino
    const [completeRouteFareData, setCompleteRouteFareData] = useState(null); // ✅ Dados de tarifa da rota completa (para evitar 2ª chamada à API)
    const driverPolylineUpdateIntervalRef = useRef(null); // ✅ Ref para intervalo de atualização da polyline
    const destinationPolylineUpdateIntervalRef = useRef(null); // ✅ NOVO: Ref para intervalo de atualização da rota até destino
    const [nearbyDrivers, setNearbyDrivers] = useState([]); // ✅ Motoristas próximos para cálculo de pickup time
    const [connectionStatus, setConnectionStatus] = useState({
        connected: false,
        authenticated: false,
        socketId: null
    }); // ✅ Status da conexão WebSocket

    // Refs para os containers que devem permanecer fixos
    const carOptionsContainerRef = useRef(null);
    const bookButtonContainerRef = useRef(null);

    // Ref para BottomSheet
    const bottomSheetRef = useRef(null);

    // Ref para prevenir duplo clique
    const isBookingInProgressRef = useRef(false);

    // Snap points para o BottomSheet - ajustado para caber tudo
    const screenHeight = Dimensions.get('window').height;

    // ✅ SnapPoints específico para "searching" - ajustado para ficar acima do menu Android (22% + 15% = 25.3% + 20px)
    const searchingSnapPoints = useMemo(() => {
        // ✅ Aumentado em 30% + 90px para garantir que o botão de cancelar apareça na tela
        // Base: 25.3% -> 25.3% * 1.30 = 32.89% ≈ 33% + 90px
        return [screenHeight * 0.33 + 90];
    }, [screenHeight]);

    // ✅ SnapPoints padrão para outros estados (35% da tela + 15% = 40.25%)
    const defaultSnapPoints = useMemo(() => {
        return [screenHeight * 0.4025]; // ✅ Aumentado em 15% (35% * 1.15 = 40.25%)
    }, [screenHeight]);

    // ✅ SnapPoints para "motorista chegou" - maior para caber todos os itens (55% + 15% = 63.25%)
    const driverArrivedSnapPoints = useMemo(() => {
        return [screenHeight * 0.6325]; // ✅ Aumentado em 15% (55% * 1.15 = 63.25%)
    }, [screenHeight]);

    // ✅ Usar snapPoints apropriado baseado no status
    // IMPORTANTE: BottomSheet precisa de snapPoints fixos, então criamos separados
    // ✅ SnapPoints dinâmico baseado no estado
    const snapPoints = useMemo(() => {
        if (tripStatus === 'searching') {
            return searchingSnapPoints;
        } else if (tripStatus === 'accepted' && driverArrived) {
            return driverArrivedSnapPoints; // ✅ Usar snapPoints maior quando motorista chegou
        }
        return defaultSnapPoints;
    }, [tripStatus, driverArrived, searchingSnapPoints, driverArrivedSnapPoints, defaultSnapPoints]);

    // ✅ Prevenir que elementos absolutos se movam quando teclado abre
    useEffect(() => {
        if (Platform.OS !== 'android') return;

        const keyboardWillShowListener = Keyboard.addListener('keyboardDidShow', () => {
            // Forçar que os elementos absolutos não se movam
            if (carOptionsContainerRef.current) {
                carOptionsContainerRef.current.setNativeProps({
                    style: { bottom: 93, transform: [] }
                });
            }
            if (bookButtonContainerRef.current) {
                bookButtonContainerRef.current.setNativeProps({
                    style: { bottom: 5, transform: [] }
                });
            }
        });

        const keyboardWillHideListener = Keyboard.addListener('keyboardDidHide', () => {
            // Garantir que voltem à posição original
            if (carOptionsContainerRef.current) {
                carOptionsContainerRef.current.setNativeProps({
                    style: { bottom: 93, transform: [] }
                });
            }
            if (bookButtonContainerRef.current) {
                bookButtonContainerRef.current.setNativeProps({
                    style: { bottom: 5, transform: [] }
                });
            }
        });

        return () => {
            keyboardWillShowListener.remove();
            keyboardWillHideListener.remove();
        };
    }, []);

    // Estados para gerenciar a viagem
    const [currentBooking, setCurrentBooking] = useState(null);
    // 🔥 Versionamento simples: rastrear versão do estado atual da corrida
    // 🔥 Versionamento simples: rastrear versão do estado atual
    const bookingVersionRef = useRef(0);
    const [tripStatus, setTripStatus] = useState('idle'); // idle, searching, accepted, started, completed
    const tripStatusRef = useRef('idle'); // ✅ Ref para acessar tripStatus atualizado no intervalo
    const SEARCH_STATUS_MESSAGES = [
        'Buscando os melhores parceiros',
        'Encontrando sua viagem',
        'Ampliando o raio de busca',
        'Notificando os motoristas na região',
        'Sua viagem começará em breve'
    ];
    const [driverInfo, setDriverInfo] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    const driverLocationRef = useRef(null); // ✅ Ref para acessar driverLocation atualizado no intervalo
    const [driverArrived, setDriverArrived] = useState(false); // ✅ Estado para rastrear se motorista chegou
    const driverArrivedRef = useRef(false); // ✅ Ref para acessar driverArrived atualizado no intervalo
    const [estimatedPickupTime, setEstimatedPickupTime] = useState(null); // ✅ Tempo estimado até motorista chegar
    const [searchingTime, setSearchingTime] = useState(0); // ✅ Tempo em segundos procurando motoristas
    const searchingTimeIntervalRef = useRef(null); // ✅ Ref para o temporizador (timeout) do contador
    const searchingStartTimeRef = useRef(null); // ✅ Ref para timestamp de início da busca
    const maxSearchTimeoutRef = useRef(null); // ✅ Ref para timeout máximo (5 minutos)
    const MAX_SEARCH_TIME = 5 * 60; // ✅ 5 minutos em segundos
    const [isCancelModalVisible, setIsCancelModalVisible] = useState(false); // ✅ Modal de confirmação de cancelamento
    const zoomAnimationIntervalRef = useRef(null); // ✅ Ref para intervalo de animação de zoom
    const isZoomedInRef = useRef(false); // ✅ Ref para controlar estado do zoom (in/out)
    const loadingRotation = useRef(new Animated.Value(0)).current; // ✅ Animação de loading

    // ✅ Sincronizar refs com estados
    useEffect(() => {
        tripStatusRef.current = tripStatus;
    }, [tripStatus]);

    useEffect(() => {
        driverArrivedRef.current = driverArrived;
    }, [driverArrived]);

    // ✅ Timer crescente usando timestamp (mais confiável no React Native)
    useEffect(() => {
        Logger.log('⏱️ [TimerEffect] status:', tripStatus, '| intervalo atual:', searchingTimeIntervalRef.current);

        // Sempre limpar timeout anterior antes de configurar um novo
        if (searchingTimeIntervalRef.current) {
            Logger.log('🧹 [TimerEffect] Limpando timeout anterior:', searchingTimeIntervalRef.current);
            clearTimeout(searchingTimeIntervalRef.current);
            searchingTimeIntervalRef.current = null;
        }

        if (tripStatus !== 'searching') {
            searchingStartTimeRef.current = null;
            maxSearchTimeoutRef.current = false; // Resetar timeout máximo
            if (searchingTime !== 0) {
                Logger.log('↩️ [TimerEffect] Status saiu de searching, resetando contador');
                setSearchingTime(0);
            }
            return;
        }

        Logger.log('▶️ [TimerEffect] Iniciando timer de busca...');

        // ✅ Salvar timestamp de início quando entrar em searching
        if (!searchingStartTimeRef.current) {
            searchingStartTimeRef.current = Date.now();
            maxSearchTimeoutRef.current = false; // Resetar timeout máximo
            Logger.log('⏱️ [TimerEffect] Timestamp de início salvo:', searchingStartTimeRef.current);
            setSearchingTime(0);
        }

        // ✅ Função recursiva usando setTimeout (mais confiável no React Native)
        const updateTimer = () => {
            Logger.log('🔄 [TimerEffect] updateTimer chamado');
            Logger.log('🔍 [TimerEffect] searchingStartTimeRef:', searchingStartTimeRef.current);
            Logger.log('🔍 [TimerEffect] tripStatusRef.current:', tripStatusRef.current);

            if (!searchingStartTimeRef.current || tripStatusRef.current !== 'searching') {
                Logger.log('🛑 [TimerEffect] Parando timer - status mudou ou timestamp não existe');
                searchingTimeIntervalRef.current = null;
                return;
            }

            const elapsed = Math.floor((Date.now() - searchingStartTimeRef.current) / 1000);
            const formatted = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;

            Logger.log(`⏰ [Timer] ${formatted} (${elapsed}s) - Timestamp: ${searchingStartTimeRef.current}`);

            setSearchingTime(elapsed);

            // ✅ Timeout máximo de 5 minutos - mostrar opção de cancelar
            if (elapsed >= MAX_SEARCH_TIME && !maxSearchTimeoutRef.current) {
                Logger.warn(`⏱️ [Timer] Timeout máximo atingido (${MAX_SEARCH_TIME}s)`);
                maxSearchTimeoutRef.current = true;

                Alert.alert(
                    'Busca Demorando',
                    `A busca está demorando mais do que o esperado (${Math.floor(MAX_SEARCH_TIME / 60)} minutos). Deseja cancelar e tentar novamente?`,
                    [
                        {
                            text: 'Continuar Buscando',
                            style: 'cancel',
                            onPress: () => {
                                maxSearchTimeoutRef.current = false; // Permitir mostrar novamente se necessário
                            }
                        },
                        {
                            text: 'Cancelar',
                            style: 'destructive',
                            onPress: () => {
                                // Cancelar busca
                                handleCancelSearch();
                            }
                        }
                    ]
                );
            }

            // ✅ Agendar próxima atualização usando setTimeout recursivo
            searchingTimeIntervalRef.current = setTimeout(updateTimer, 1000);
        };

        // ✅ Atualizar imediatamente e depois a cada segundo
        updateTimer();

        Logger.log('✅ [TimerEffect] Timer iniciado');

        return () => {
            if (searchingTimeIntervalRef.current) {
                Logger.log('🧼 [TimerEffect] Cleanup, limpando timeout:', searchingTimeIntervalRef.current);
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            // Limpar timeout máximo também
            maxSearchTimeoutRef.current = false;
        };
    }, [tripStatus, handleCancelSearch]);

    // ✅ useEffect para logar mudanças no searchingTime (debug)
    useEffect(() => {
        if (tripStatus === 'searching') {
            Logger.log('🖥️ [UI] searchingTime mudou para:', searchingTime, '| Formato:', `${Math.floor(searchingTime / 60)}:${(searchingTime % 60).toString().padStart(2, '0')}`);
        }
    }, [searchingTime, tripStatus]);

    // ✅ Animação de zoom in/out no mapa a cada 10 segundos durante busca
    useEffect(() => {
        // Limpar intervalo anterior se existir
        if (zoomAnimationIntervalRef.current) {
            clearInterval(zoomAnimationIntervalRef.current);
            zoomAnimationIntervalRef.current = null;
        }

        if (tripStatus === 'searching' && mapRef?.current && currentLocation) {
            // Resetar estado do zoom
            isZoomedInRef.current = false;

            // Função para alternar zoom
            const toggleZoom = () => {
                if (!mapRef?.current || !currentLocation) return;

                isZoomedInRef.current = !isZoomedInRef.current;

                if (isZoomedInRef.current) {
                    // ✅ Zoom in: manter zoom atual (não fazer nada)
                    Logger.log('🔍 [Zoom] Mantendo zoom atual (zoom in)');
                    return;
                } else {
                    // ✅ Zoom out: mostrar rota completa (pickup + destination)
                    Logger.log('🔍 [Zoom] Ajustando para mostrar rota completa (zoom out)');

                    if (tripdata?.pickup && tripdata?.drop && tripdata?.drop?.lat && tripdata?.drop?.lng) {
                        // Usar fitToCoordinates para mostrar pickup e destination
                        const coordinates = [
                            {
                                latitude: tripdata.pickup.lat,
                                longitude: tripdata.pickup.lng,
                            },
                            {
                                latitude: tripdata.drop.lat,
                                longitude: tripdata.drop.lng,
                            }
                        ];

                        mapRef.current.fitToCoordinates(coordinates, {
                            edgePadding: { top: 100, right: 50, bottom: 300, left: 50 },
                            animated: true,
                        });
                    } else {
                        // Fallback: zoom out simples se não tiver destino
                        mapRef.current.animateToRegion({
                            latitude: currentLocation.lat,
                            longitude: currentLocation.lng,
                            latitudeDelta: 0.05,
                            longitudeDelta: 0.05,
                        }, 1000);
                    }
                }
            };

            // Executar imediatamente e depois a cada 10 segundos
            toggleZoom();
            zoomAnimationIntervalRef.current = setInterval(toggleZoom, 10000);

            return () => {
                if (zoomAnimationIntervalRef.current) {
                    clearInterval(zoomAnimationIntervalRef.current);
                    zoomAnimationIntervalRef.current = null;
                }
            };
        } else {
            // Parar animação quando sair de searching
            isZoomedInRef.current = false;
        }
    }, [tripStatus, currentLocation, mapRef, tripdata]);

    const [isDevPreviewActive, setIsDevPreviewActive] = useState(false); // ✅ Preview visual em modo desenvolvimento
    const [driverAcceptedAt, setDriverAcceptedAt] = useState(null); // ✅ Timestamp quando motorista aceitou (para cálculo de taxa)
    const [embarkTimer, setEmbarkTimer] = useState(120); // ✅ Timer decrescente quando motorista chegou (02:00 = 120 segundos)
    const embarkTimerIntervalRef = useRef(null); // ✅ Ref para o intervalo do timer de embarque
    const [messageText, setMessageText] = useState(''); // ✅ Texto da mensagem para enviar ao motorista

    const hasValidTripEndpoints = useMemo(() => {
        const pickupLat = Number(tripdata?.pickup?.lat);
        const pickupLng = Number(tripdata?.pickup?.lng);
        const dropLat = Number(tripdata?.drop?.lat);
        const dropLng = Number(tripdata?.drop?.lng);

        const pickupAddressText = typeof tripdata?.pickup?.add === 'string' ? tripdata.pickup.add.trim() : '';
        const dropAddressText = typeof tripdata?.drop?.add === 'string' ? tripdata.drop.add.trim() : '';

        const hasPickupAddress = pickupAddressText.length >= 5;
        const hasDropAddress = dropAddressText.length >= 5;
        const hasPickupCoords = Number.isFinite(pickupLat) && Number.isFinite(pickupLng);
        const hasDropCoords = Number.isFinite(dropLat) && Number.isFinite(dropLng);

        return hasPickupAddress && hasDropAddress && hasPickupCoords && hasDropCoords;
    }, [tripdata?.pickup?.add, tripdata?.pickup?.lat, tripdata?.pickup?.lng, tripdata?.drop?.add, tripdata?.drop?.lat, tripdata?.drop?.lng]);

    const currentSearchMessage = useMemo(() => {
        if (tripStatus !== 'searching') {
            return SEARCH_STATUS_MESSAGES[0];
        }
        const messagesLen = SEARCH_STATUS_MESSAGES.length || 1;
        const index = Math.floor(searchingTime / 5) % messagesLen;
        return SEARCH_STATUS_MESSAGES[index];
    }, [tripStatus, searchingTime]);
    const [devPreviewPhase, setDevPreviewPhase] = useState(null); // ✅ Controle de fase no modo preview
    const [rating, setRating] = useState(0); // ✅ Avaliação (1-5 estrelas)
    const [ratingComment, setRatingComment] = useState(''); // ✅ Comentário da avaliação
    const [ratingOptions, setRatingOptions] = useState([]); // ✅ Opções selecionadas na avaliação
    const [isSubmittingRating, setIsSubmittingRating] = useState(false); // ✅ Estado de submissão da avaliação
    const [chatMessages, setChatMessages] = useState([]); // ✅ NOVO: Mensagens do chat
    const activateDevPreview = useCallback(() => {
        if (!DEV_MODE) {
            return;
        }

        const mockDriver = {
            id: 'dev-driver-preview',
            name: 'Pedro Silva',
            vehicle: {
                plate: 'XYZ1A23',
                brand: 'Toyota',
                model: 'Corolla',
                color: 'Prata'
            },
            rating: 4.9,
            location: tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng
                ? {
                    lat: parseFloat(tripdata.pickup.lat) + 0.002,
                    lng: parseFloat(tripdata.pickup.lng) + 0.002
                }
                : null
        };

        const mockBooking = {
            bookingId: 'dev-preview-booking',
            pickup: tripdata.pickup || {
                add: 'Rua das Flores, 123 - Centro',
                lat: -22.9129,
                lng: -43.2003
            },
            drop: tripdata.drop || {
                add: 'Av. Atlântica, 456 - Copacabana',
                lat: -22.9711,
                lng: -43.1822
            }
        };

        setIsDevPreviewActive(true);
        setCurrentBooking(mockBooking);
        setDriverInfo(mockDriver);
        setTripStatus('accepted');
        setDevPreviewPhase('accepted');
        setDriverArrived(false);
        setEstimatedPickupTime(4);
        setDriverAcceptedAt(Date.now());
        setEmbarkTimer(120);
        setMessageText('');

        if (searchingTimeIntervalRef.current) {
            clearTimeout(searchingTimeIntervalRef.current);
            searchingTimeIntervalRef.current = null;
        }
        searchingStartTimeRef.current = null;
        // ✅ Parar animação de loading
        loadingRotation.stopAnimation();
        if (embarkTimerIntervalRef.current) {
            clearInterval(embarkTimerIntervalRef.current);
            embarkTimerIntervalRef.current = null;
        }
    }, [DEV_MODE, tripdata.pickup, tripdata.drop]);

    const deactivateDevPreview = useCallback(() => {
        setIsDevPreviewActive(false);
        setTripStatus('idle');
        setDriverInfo(null);
        setCurrentBooking(null);
        setDriverLocation(null);
        setDriverArrived(false);
        setEstimatedPickupTime(null);
        setDriverAcceptedAt(null);
        setEmbarkTimer(120);
        setMessageText('');
        setDevPreviewPhase(null);

        if (searchingTimeIntervalRef.current) {
            clearTimeout(searchingTimeIntervalRef.current);
            searchingTimeIntervalRef.current = null;
        }
        searchingStartTimeRef.current = null;
        // ✅ Parar animação de loading
        loadingRotation.stopAnimation();
        if (embarkTimerIntervalRef.current) {
            clearInterval(embarkTimerIntervalRef.current);
            embarkTimerIntervalRef.current = null;
        }
    }, []);

    const applyDevPreviewPhase = useCallback((phase) => {
        if (!isDevPreviewActive) return;

        setDevPreviewPhase(phase);

        if (phase === 'idle') {
            // ✅ Fase idle: Mostrar cards de escolha de veículo
            setTripStatus('idle');
            setDriverInfo(null);
            setCurrentBooking(null);
            setDriverLocation(null);
            setDriverArrived(false);
            setEstimatedPickupTime(null);
            setDriverAcceptedAt(null);
            setEmbarkTimer(120);
            setMessageText('');
            setRating(0);
            setRatingComment('');
            setRatingOptions([]);
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }
            if (searchingTimeIntervalRef.current) {
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            searchingStartTimeRef.current = null;
            loadingRotation.stopAnimation();
        } else if (phase === 'accepted') {
            setTripStatus('accepted');
            setDriverArrived(false);
            setDriverAcceptedAt(Date.now());
            setEstimatedPickupTime(4);
            setEmbarkTimer(120);
            setRating(0);
            setRatingComment('');
            setRatingOptions([]);
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }
        } else if (phase === 'arrived') {
            setTripStatus('accepted');
            setDriverArrived(true);
            setDriverAcceptedAt(Date.now() - (3 * 60 * 1000)); // ✅ Simula tempo superior a 2 min
            setEstimatedPickupTime(0);
            setEmbarkTimer(120);
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
            }
            embarkTimerIntervalRef.current = setInterval(() => {
                setEmbarkTimer((prev) => {
                    if (prev <= 1) {
                        clearInterval(embarkTimerIntervalRef.current);
                        embarkTimerIntervalRef.current = null;
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } else if (phase === 'started') {
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }
            setTripStatus('started');
            setDriverArrived(false);
            setEstimatedPickupTime(null);
            setEmbarkTimer(0);
            setRating(0);
            setRatingComment('');
            setRatingOptions([]);
        } else if (phase === 'completed') {
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }
            setTripStatus('completed');
            setDriverArrived(false);
            setEstimatedPickupTime(null);
            setEmbarkTimer(0);
            setRating(0);
            setRatingComment('');
            setRatingOptions([]);
        }
    }, [isDevPreviewActive]);


    // Estado para modal de avaliação
    const [ratingModalVisible, setRatingModalVisible] = useState(false);

    // Função para selecionar tipo de carro
    const handleCarSelection = useCallback((car) => {
        setSelectedCarType(car);

        // Atualizar Redux com carro selecionado
        dispatch(updateTripCar(car));
    }, [dispatch]);

    // Ref para o timer de debounce
    const searchTimeoutRef = useRef(null);

    // Preencher endereço de embarque automaticamente (apenas se não estiver editando manualmente E não foi selecionado manualmente)
    useEffect(() => {
        // ✅ NÃO atualizar se o usuário estiver editando manualmente
        if (isManuallyEditingPickup) {
            return;
        }

        // ✅ NÃO atualizar se o usuário selecionou manualmente um endereço (não deve ser sobrescrito pelo GPS)
        if (pickupManuallySelected) {
            Logger.log('📍 [PassengerUI] Pickup foi selecionado manualmente, ignorando atualização automática do GPS');
            return;
        }

        if (pickupAddress && currentLocation) {
            // ✅ Verificar se já está atualizado para evitar loop infinito
            const currentPickup = tripdata.pickup;
            const needsUpdate = !currentPickup?.add ||
                currentPickup.add !== pickupAddress ||
                currentPickup.lat !== currentLocation.lat ||
                currentPickup.lng !== currentLocation.lng;

            if (needsUpdate) {
                dispatch(updateTripPickup({
                    add: pickupAddress,
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                }));
            }
        }
    }, [pickupAddress, currentLocation, dispatch, tripdata.pickup?.add, tripdata.pickup?.lat, tripdata.pickup?.lng, isManuallyEditingPickup, pickupManuallySelected]);

    // ✅ Sincronizar manualPickupText com tripdata.pickup quando não estiver editando
    useEffect(() => {
        Logger.log('🔄 [PassengerUI] useEffect sincronização - tripdata.pickup mudou:', {
            hasPickup: !!tripdata.pickup?.add,
            pickupAdd: tripdata.pickup?.add,
            isManuallyEditing: isManuallyEditingPickup,
            searchVisible: searchState.visible,
            currentManualText: manualPickupText
        });

        // ✅ Se o campo não estiver visível (não está sendo editado), SEMPRE sincronizar quando tripdata.pickup mudar
        // Isso garante que quando o botão de recentralizar atualizar o pickup, o campo será atualizado
        if (!searchState.visible && tripdata.pickup?.add) {
            const formattedAddress = formatAddressForDisplay(tripdata.pickup.add);
            if (manualPickupText !== formattedAddress) {
                Logger.log('✅ [PassengerUI] Atualizando manualPickupText após mudança externa (ex: botão recentralizar):', formattedAddress);
                setManualPickupText(formattedAddress);
                // ✅ Resetar flag para permitir sincronização futura quando vier de atualização externa
                setIsManuallyEditingPickup(false);
            }
        }
        // ✅ Se estiver editando mas o campo não estiver visível, também atualizar (caso de atualização externa durante edição)
        else if (!searchState.visible && tripdata.pickup?.add && isManuallyEditingPickup) {
            // Verificar se a mudança veio de uma atualização externa (coordenadas mudaram significativamente)
            const formattedAddress = formatAddressForDisplay(tripdata.pickup.add);
            if (manualPickupText !== formattedAddress) {
                Logger.log('✅ [PassengerUI] Forçando atualização manualPickupText (atualização externa durante edição):', formattedAddress);
                setManualPickupText(formattedAddress);
                setIsManuallyEditingPickup(false);
            }
        }
    }, [tripdata.pickup?.add, tripdata.pickup?.lat, tripdata.pickup?.lng, searchState.visible]);

    // ✅ REF para evitar múltiplas execuções simultâneas
    const isCalculatingRef = useRef(false);
    const lastCalculationRef = useRef({ pickup: null, drop: null });

    // ✅ DEFINIR fixedCarTypes ANTES de usar nos useEffects
    const fixedCarTypes = useMemo(() => [
        {
            name: 'Leaf Plus',
            image: 'https://cdn.pixabay.com/photo/2017/06/03/08/11/car-2368193_640.png',
            min_fare: 8.50,
            base_fare: 3.13,
            rate_per_hour: 16.20,
            rate_per_unit_distance: 1.42,
            convenience_fee_type: 'flat',
            convenience_fees: 0,
            extra_info: 'Capacity: 3, Type: Taxi',
            fleet_admin_fee: 1.55,
            pos: 5,
            id: 'type1'
        },
        {
            name: 'Leaf Elite',
            image: 'https://cdn.pixabay.com/photo/2022/01/23/18/20/car-6961567_640.png',
            min_fare: 11.50,
            base_fare: 5.59,
            rate_per_hour: 18.00,
            rate_per_unit_distance: 2.29,
            convenience_fee_type: 'flat',
            convenience_fees: 0,
            extra_info: 'Capacity: 4, Type: Sedan',
            fleet_admin_fee: 3.2,
            pos: 10,
            id: 'type3'
        }
    ], []);

    // useEffect EXATO do MapScreen antigo para calcular rota quando destino muda
    useEffect(() => {
        // ✅ Verificar se já está calculando para evitar loops
        if (isCalculatingRef.current) {
            return;
        }

        // ✅ Verificar se fixedCarTypes existe
        if (!fixedCarTypes || !Array.isArray(fixedCarTypes)) {
            return;
        }

        // ✅ Sempre recalcular quando endereços mudarem (removida verificação de dados não mudaram)
        // Isso garante que a rota seja recalculada sempre que o usuário digitar um novo endereço

        const fetchEstimates = async () => {
            // ✅ Marcar como calculando
            isCalculatingRef.current = true;

            try {
                // Testar biblioteca polyline primeiro
                testPolylineLibrary();

                Logger.log('📍 tripdata.pickup:', tripdata.pickup);
                Logger.log('📍 tripdata.drop:', tripdata.drop);
                Logger.log('🚗 allCarTypes:', allCarTypes);
                Logger.log('🚗 fixedCarTypes:', fixedCarTypes);

                if (tripdata.pickup && tripdata.drop) {
                    let estimates = {};
                    let firstPolyline = null;

                    // Usar tipos fixos (Leaf Plus e Leaf Elite) - EXATAMENTE COMO NO MAPSCREEN
                    const carTypesToUse = fixedCarTypes || [];

                    for (const car of carTypesToUse) {
                        const tripdataForCar = {
                            pickup: tripdata.pickup,
                            drop: tripdata.drop,
                            carType: { ...car }
                        };

                        // ✅ OTIMIZAÇÃO: Se temos fareData da rota completa, usar ele (evita 2ª chamada à API)
                        if (completeRouteFareData && tripStatus === 'accepted') {
                            Logger.log('✅ [Fare] Usando fareData da rota completa (1 única chamada à API)');
                            const distance = completeRouteFareData.distance_km || 0;
                            const time = completeRouteFareData.time_secs || 0;

                            // ✅ Calcular pedágio usando polyline do leg2
                            let tollFee = 0;
                            if (completeRouteFareData.polyline) {
                                try {
                                    const { pedagiosCruzados, valorTotal } = calcularPedagiosPorPolyline(
                                        completeRouteFareData.polyline,
                                        tollData,
                                        2
                                    );
                                    tollFee = valorTotal || 0;
                                } catch (error) {
                                    Logger.error(`❌ Erro ao calcular pedágios para ${car.name}:`, error);
                                    tollFee = 0;
                                }
                            }

                            // ✅ Calcular tarifa usando FareCalculator
                            try {
                                const { FareCalculator } = require('../../common/sharedFunctions');
                                const fareResult = FareCalculator(
                                    distance,
                                    time,
                                    car,
                                    {},
                                    2,
                                    null,
                                    'car',
                                    tollFee > 0 ? tollFee : null
                                );

                                estimates[car.name] = {
                                    pickup: { coords: { lat: tripdata.pickup.lat, lng: tripdata.pickup.lng }, description: tripdata.pickup.add },
                                    drop: { coords: { lat: tripdata.drop.lat, lng: tripdata.drop.lng }, description: tripdata.drop.add },
                                    carDetails: car.name,
                                    routeDetails: {
                                        distance_in_km: distance,
                                        time_in_secs: time,
                                        polylinePoints: completeRouteFareData.polyline
                                    },
                                    estimateFare: fareResult.grandTotal,
                                    estimateTime: time,
                                    estimateDistance: distance
                                };

                                Logger.log(`💰 [Fare] Preço calculado usando rota completa para ${car.name}: R$ ${fareResult.grandTotal.toFixed(2)} (${Math.round(time / 60)} min, ${distance.toFixed(2)} km)`);
                                continue; // Pular para próximo carro (não precisa chamar prepareEstimateObject)
                            } catch (error) {
                                Logger.error(`❌ Erro ao calcular tarifa usando fareData para ${car.name}:`, error);
                                // Fallback para prepareEstimateObject
                            }
                        }

                        try {
                            const estimateObj = await prepareEstimateObject(tripdataForCar, {});

                            if (!estimateObj.error && estimateObj.estimateObject && estimateObj.estimateObject.carDetails) {
                                // Calcular tarifa usando FareCalculator
                                let estimateFare = null;
                                let estimateTime = null;

                                // TESTE: Se não temos routeDetails, criar dados de teste para verificar o cálculo
                                if (!estimateObj.estimateObject.routeDetails) {
                                    // Dados de teste: 10km, 20 minutos
                                    const testDistance = 10;
                                    const testTime = 20 * 60; // 20 minutos em segundos

                                    // Calcular tarifa de teste
                                    try {
                                        const { FareCalculator } = require('../../common/sharedFunctions');
                                        const testFareResult = FareCalculator(
                                            testDistance,
                                            testTime,
                                            car,
                                            {}, // instructionData
                                            2, // decimal
                                            null, // routePoints
                                            'car', // vehicleType
                                            0 // sem pedágio para teste
                                        );

                                        // Usar dados de teste
                                        estimateFare = testFareResult.grandTotal;
                                        estimateTime = testTime;

                                    } catch (error) {
                                        Logger.error(`❌ Erro no cálculo de teste para ${car.name}:`, error);
                                    }
                                } else if (estimateObj.estimateObject.routeDetails) {
                                    const routeDetails = estimateObj.estimateObject.routeDetails;
                                    const distance = routeDetails.distance_in_km || 0;
                                    const time = routeDetails.time_in_secs || 0;

                                    // CÁLCULO REAL DE PEDÁGIO USANDO A FUNÇÃO QUE JÁ FUNCIONAVA!
                                    let tollFee = 0;
                                    if (routeDetails.polylinePoints) {
                                        try {
                                            const { pedagiosCruzados, valorTotal } = calcularPedagiosPorPolyline(
                                                routeDetails.polylinePoints,
                                                tollData,
                                                2 // tolerância 2km
                                            );
                                            tollFee = valorTotal || 0;
                                        } catch (error) {
                                            Logger.error(`❌ Erro ao calcular pedágios para ${car.name}:`, error);
                                            tollFee = 0;
                                        }
                                    }

                                    // CÁLCULO REAL DE TARIFA USANDO FARE CALCULATOR!
                                    try {
                                        Logger.log(`💰 INICIANDO CÁLCULO REAL DE TARIFA para ${car.name}`);
                                        Logger.log(`📊 Dados para cálculo:`, {
                                            distance: distance,
                                            time: time,
                                            carBaseFare: car.base_fare,
                                            carRatePerKm: car.rate_per_unit_distance,
                                            carRatePerHour: car.rate_per_hour,
                                            tollFee: tollFee
                                        });
                                        // DEBUG: Verificar dados do carro
                                        Logger.log(`🔍 Dados do carro ${car.name}:`, {
                                            base_fare: car.base_fare,
                                            rate_per_unit_distance: car.rate_per_unit_distance,
                                            rate_per_hour: car.rate_per_hour,
                                            convenience_fees: car.convenience_fees,
                                            convenience_fee_type: car.convenience_fee_type
                                        });

                                        const { FareCalculator } = require('../../common/sharedFunctions');
                                        const fareResult = FareCalculator(
                                            distance,
                                            time,
                                            car,
                                            {}, // instructionData
                                            2, // decimal
                                            null, // routePoints
                                            'car', // vehicleType
                                            tollFee > 0 ? tollFee : null // externalTollFee
                                        );

                                        estimateFare = fareResult.grandTotal;
                                        estimateTime = time;

                                    } catch (error) {
                                        Logger.error(`❌ Erro ao calcular tarifa para ${car.name}:`, error);
                                        // Fallback para cálculo básico
                                        estimateFare = (distance * (car.rate_per_unit_distance || 0)) + (car.base_fare || 0) + tollFee;
                                        estimateTime = time;
                                    }
                                }

                                estimates[car.name] = {
                                    ...estimateObj.estimateObject,
                                    estimateFare: estimateFare,
                                    estimateTime: estimateTime
                                };

                                // Pega a primeira polyline válida (EXATO DO MAPSCREEN)
                                if (!firstPolyline && estimateObj.estimateObject.routeDetails && estimateObj.estimateObject.routeDetails.polylinePoints) {
                                    try {
                                        const points = polyline.decode(estimateObj.estimateObject.routeDetails.polylinePoints);

                                        if (points && Array.isArray(points) && points.length > 0) {
                                            const coordsArr = points.map(point => ({ latitude: point[0], longitude: point[1] }));
                                            firstPolyline = coordsArr;
                                        } else {
                                            Logger.error(`❌ Pontos inválidos após decodificação:`, points);
                                        }
                                    } catch (polylineError) {
                                        Logger.error(`❌ Erro ao decodificar polyline para ${car.name}:`, polylineError);
                                        Logger.error(`❌ polylinePoints que causou erro:`, estimateObj.estimateObject.routeDetails.polylinePoints);
                                        Logger.error(`❌ Stack trace:`, polylineError.stack);
                                    }
                                }
                            } else {
                                Logger.log(`❌ Erro no estimateObj para ${car.name}:`, estimateObj);
                                estimates[car.name] = null;
                            }
                        } catch (error) {
                            Logger.error(`💥 Erro ao processar ${car.name}:`, error);

                            // Se houve erro, tentar cálculo básico

                            try {
                                // Dados básicos de teste: 5km, 15 minutos
                                const basicDistance = 5;
                                const basicTime = 15 * 60; // 15 minutos em segundos

                                const { FareCalculator } = require('../../common/sharedFunctions');
                                const basicFareResult = FareCalculator(
                                    basicDistance,
                                    basicTime,
                                    car,
                                    {}, // instructionData
                                    2, // decimal
                                    null, // routePoints
                                    'car', // vehicleType
                                    0 // sem pedágio
                                );


                                estimates[car.name] = {
                                    estimateFare: basicFareResult.grandTotal,
                                    estimateTime: basicTime,
                                    isBasicCalculation: true
                                };

                            } catch (basicError) {
                                Logger.error(`❌ Erro também no cálculo básico para ${car.name}:`, basicError);
                                estimates[car.name] = null;
                            }
                        }
                    }

                    setCarEstimates(estimates);

                    // ✅ Atualizar polyline APENAS se não estiver em uma corrida ativa
                    // Durante corrida (accepted, started, searching), manter a polyline existente
                    if (firstPolyline) {
                        // ✅ Só atualizar se não estiver em corrida ativa
                        if (tripStatus !== 'accepted' && tripStatus !== 'started' && tripStatus !== 'searching') {
                            setLocalRoutePolyline(firstPolyline);

                            // Atualizar polyline no componente pai se a função existir
                            if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                                Logger.log('📤 Enviando polyline para componente pai...');
                                props.setRoutePolyline(firstPolyline);
                                Logger.log('✅ Polyline enviada para componente pai');
                            } else {
                                Logger.log('⚠️ props.setRoutePolyline não disponível ou não é função');
                                Logger.log('🔍 Tipo de props.setRoutePolyline:', typeof props.setRoutePolyline);
                            }
                        } else {
                            Logger.log('🔒 [Polyline] Mantendo polyline existente durante corrida ativa');
                        }
                    } else {
                        // ✅ Só limpar se não estiver em corrida ativa
                        if (tripStatus !== 'accepted' && tripStatus !== 'started' && tripStatus !== 'searching') {
                            setLocalRoutePolyline([]);
                        }
                    }
                } else {
                    // tripdata.pickup ou tripdata.drop não disponível
                    // ✅ Se o destino foi limpo (null), limpar a polyline imediatamente
                    if (!tripdata.drop && tripStatus === 'idle') {
                        Logger.log('🧹 [Polyline] Destino limpo, limpando polyline');
                        setLocalRoutePolyline([]);
                        setDriverToPickupPolyline([]);
                        if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                            props.setRoutePolyline([]);
                        }
                    }
                }
            } finally {
                // ✅ Sempre marcar como não calculando ao final
                isCalculatingRef.current = false;
                // ✅ Atualizar referência dos últimos dados calculados para permitir recálculo quando endereços mudarem
                lastCalculationRef.current = {
                    pickup: tripdata.pickup?.add || tripdata.pickup?.lat,
                    drop: tripdata.drop?.add || tripdata.drop?.lat
                };
            }
        };

        // Usar tipos fixos (Leaf Plus e Leaf Elite) - EXATAMENTE COMO NO MAPSCREEN
        const carTypesToUse = fixedCarTypes || [];

        // ✅ Se o destino foi limpo (null), limpar polyline imediatamente
        if (!tripdata.drop && tripStatus === 'idle') {
            Logger.log('🧹 [Polyline] Destino limpo (idle), limpando polyline');
            setLocalRoutePolyline([]);
            setDriverToPickupPolyline([]);
            if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                props.setRoutePolyline([]);
            }
        }

        // ✅ Só calcular se tiver origem e destino E não estiver em uma corrida ativa
        // Durante corrida (accepted, started), manter a polyline existente
        if (tripdata.pickup && tripdata.drop && carTypesToUse.length > 0 &&
            tripStatus !== 'accepted' && tripStatus !== 'started' && tripStatus !== 'searching') {
            fetchEstimates();
        }
    }, [tripdata.pickup?.add, tripdata.pickup?.lat, tripdata.drop?.add, tripdata.drop?.lat, fixedCarTypes, tripStatus]);

    // ✅ ATUALIZAR PREÇO A CADA MINUTO enquanto o card estiver aberto
    // Isso garante que o preço sempre reflita as condições de trânsito atuais
    useEffect(() => {
        // Só atualizar se:
        // 1. Está em estado idle (card de seleção de veículo aberto)
        // 2. Tem origem e destino definidos
        // 3. Não está calculando no momento
        const shouldUpdate = tripStatus === 'idle' &&
            tripdata.pickup &&
            tripdata.drop &&
            tripdata.drop.add &&
            !isCalculatingRef.current;

        if (!shouldUpdate) {
            return;
        }

        Logger.log('⏰ [PriceUpdate] Iniciando atualização automática de preço a cada 1 minuto');

        // Atualizar a cada 1 minuto (60000ms)
        const updateInterval = setInterval(() => {
            // Verificar novamente se ainda deve atualizar
            if (tripStatus === 'idle' &&
                tripdata.pickup &&
                tripdata.drop &&
                tripdata.drop.add &&
                !isCalculatingRef.current) {

                Logger.log('🔄 [PriceUpdate] Atualizando preço automaticamente (condições de trânsito podem ter mudado)');

                // Recalcular estimativas usando a mesma lógica do useEffect principal
                const fetchEstimates = async () => {
                    if (isCalculatingRef.current) {
                        return;
                    }

                    isCalculatingRef.current = true;
                    setIsCalculatingRoute(true);

                    try {
                        // ✅ USAR OS MESMOS fixedCarTypes DO useEffect PRINCIPAL (com dados corretos)
                        const carTypesToUse = fixedCarTypes || [];
                        let firstPolyline = null;

                        if (tripdata.pickup && tripdata.drop) {
                            let estimates = {};

                            for (const car of carTypesToUse) {
                                const tripdataForCar = {
                                    pickup: tripdata.pickup,
                                    drop: tripdata.drop,
                                    carType: { ...car }
                                };

                                // ✅ OTIMIZAÇÃO: Se temos fareData da rota completa, usar ele (evita 2ª chamada à API)
                                if (completeRouteFareData && tripStatus === 'accepted') {
                                    Logger.log('✅ [Fare] Usando fareData da rota completa (1 única chamada à API)');
                                    const distance = completeRouteFareData.distance_km || 0;
                                    const time = completeRouteFareData.time_secs || 0;

                                    // ✅ Calcular pedágio usando polyline do leg2
                                    let tollFee = 0;
                                    if (completeRouteFareData.polyline) {
                                        try {
                                            const { pedagiosCruzados, valorTotal } = calcularPedagiosPorPolyline(
                                                completeRouteFareData.polyline,
                                                tollData,
                                                2
                                            );
                                            tollFee = valorTotal || 0;
                                        } catch (error) {
                                            Logger.error(`❌ Erro ao calcular pedágios para ${car.name}:`, error);
                                            tollFee = 0;
                                        }
                                    }

                                    // ✅ Calcular tarifa usando FareCalculator
                                    try {
                                        const { FareCalculator } = require('../../common/sharedFunctions');
                                        const fareResult = FareCalculator(
                                            distance,
                                            time,
                                            car,
                                            {},
                                            2,
                                            null,
                                            'car',
                                            tollFee > 0 ? tollFee : null
                                        );

                                        estimates[car.name] = {
                                            pickup: { coords: { lat: tripdata.pickup.lat, lng: tripdata.pickup.lng }, description: tripdata.pickup.add },
                                            drop: { coords: { lat: tripdata.drop.lat, lng: tripdata.drop.lng }, description: tripdata.drop.add },
                                            carDetails: car.name,
                                            routeDetails: {
                                                distance_in_km: distance,
                                                time_in_secs: time,
                                                polylinePoints: completeRouteFareData.polyline
                                            },
                                            estimateFare: fareResult.grandTotal,
                                            estimateTime: time,
                                            estimateDistance: distance
                                        };

                                        Logger.log(`💰 [Fare] Preço atualizado usando rota completa para ${car.name}: R$ ${fareResult.grandTotal.toFixed(2)} (${Math.round(time / 60)} min, ${distance.toFixed(2)} km)`);
                                        continue; // Pular para próximo carro (não precisa chamar prepareEstimateObject)
                                    } catch (error) {
                                        Logger.error(`❌ Erro ao calcular tarifa usando fareData para ${car.name}:`, error);
                                        // Fallback para prepareEstimateObject
                                    }
                                }

                                try {
                                    const estimateObj = await prepareEstimateObject(tripdataForCar, {});

                                    if (!estimateObj.error && estimateObj.estimateObject && estimateObj.estimateObject.carDetails) {
                                        const routeDetails = estimateObj.estimateObject.routeDetails;

                                        if (routeDetails) {
                                            const distance = routeDetails.distance_in_km || 0;
                                            const time = routeDetails.time_in_secs || 0;

                                            // ✅ Calcular pedágio
                                            let tollFee = 0;
                                            if (routeDetails.polylinePoints) {
                                                try {
                                                    const { pedagiosCruzados, valorTotal } = calcularPedagiosPorPolyline(
                                                        routeDetails.polylinePoints,
                                                        tollData,
                                                        2
                                                    );
                                                    tollFee = valorTotal || 0;
                                                } catch (error) {
                                                    Logger.error(`❌ Erro ao calcular pedágios para ${car.name}:`, error);
                                                    tollFee = 0;
                                                }
                                            }

                                            // ✅ Calcular tarifa usando FareCalculator com dados corretos do carro
                                            try {
                                                const { FareCalculator } = require('../../common/sharedFunctions');
                                                const fareResult = FareCalculator(
                                                    distance,
                                                    time,
                                                    car, // ✅ Usar dados corretos do carro (base_fare, rate_per_unit_distance, etc.)
                                                    {},
                                                    2,
                                                    null,
                                                    'car',
                                                    tollFee > 0 ? tollFee : null
                                                );

                                                estimates[car.name] = {
                                                    ...estimateObj.estimateObject,
                                                    estimateFare: fareResult.grandTotal,
                                                    estimateTime: time,
                                                    estimateDistance: distance
                                                };

                                                Logger.log(`💰 [PriceUpdate] Preço atualizado para ${car.name}: R$ ${fareResult.grandTotal.toFixed(2)} (${Math.round(time / 60)} min, ${distance.toFixed(2)} km)`);

                                                // ✅ DECODIFICAR E ATUALIZAR POLYLINE (igual ao useEffect principal)
                                                if (!firstPolyline && routeDetails.polylinePoints) {
                                                    try {
                                                        const points = polyline.decode(routeDetails.polylinePoints);
                                                        if (points && Array.isArray(points) && points.length > 0) {
                                                            const coordsArr = points.map(point => ({
                                                                latitude: point[0],
                                                                longitude: point[1]
                                                            }));
                                                            firstPolyline = coordsArr;
                                                            Logger.log(`🗺️ [PriceUpdate] Polyline decodificada: ${coordsArr.length} pontos`);
                                                        }
                                                    } catch (polylineError) {
                                                        Logger.error(`❌ [PriceUpdate] Erro ao decodificar polyline para ${car.name}:`, polylineError);
                                                    }
                                                }
                                            } catch (error) {
                                                Logger.error(`❌ [PriceUpdate] Erro ao calcular tarifa para ${car.name}:`, error);
                                            }
                                        }
                                    }
                                } catch (error) {
                                    Logger.error(`❌ [PriceUpdate] Erro ao atualizar preço para ${car.name}:`, error);
                                }
                            }

                            if (Object.keys(estimates).length > 0) {
                                setCarEstimates(prev => ({ ...prev, ...estimates }));
                                Logger.log('✅ [PriceUpdate] Preços atualizados com sucesso');
                            }

                            // ✅ ATUALIZAR POLYLINE NO MAPA (igual ao useEffect principal)
                            if (firstPolyline) {
                                setLocalRoutePolyline(firstPolyline);
                                if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                                    props.setRoutePolyline(firstPolyline);
                                    Logger.log('✅ [PriceUpdate] Polyline atualizada no mapa');
                                }
                            }
                        }
                    } catch (error) {
                        Logger.error('❌ [PriceUpdate] Erro ao atualizar preços:', error);
                    } finally {
                        isCalculatingRef.current = false;
                        setIsCalculatingRoute(false);
                    }
                };

                fetchEstimates();
            } else {
                Logger.log('⏸️ [PriceUpdate] Condições não atendidas, parando atualização automática');
            }
        }, 60000); // 1 minuto = 60000ms

        return () => {
            Logger.log('🛑 [PriceUpdate] Parando atualização automática de preço');
            clearInterval(updateInterval);
        };
    }, [tripStatus, tripdata.pickup, tripdata.drop, fixedCarTypes]);

    // ✅ Serviço de disponibilidade de motoristas em tempo real
    useEffect(() => {
        if (!tripdata.pickup || !tripdata.pickup.lat || !tripdata.pickup.lng) {
            DriverAvailabilityService.stopMonitoring();
            setNearbyDrivers([]);
            return;
        }

        const radius = (settings && settings.driverRadius) ? settings.driverRadius : 10;

        // Iniciar monitoramento em tempo real
        DriverAvailabilityService.startMonitoring(
            { lat: tripdata.pickup.lat, lng: tripdata.pickup.lng },
            radius,
            10000 // Atualizar a cada 10 segundos
        );

        // Inscrever-se para receber atualizações
        const unsubscribe = DriverAvailabilityService.subscribe((drivers) => {
            Logger.log(`🔄 [PassengerUI] Motoristas atualizados em tempo real: ${drivers.length} disponíveis`);
            Logger.log(`   📋 [PassengerUI] Lista de motoristas recebida:`, drivers.map(d => ({
                id: d.id?.substring(0, 8),
                carType: d.carType,
                distance: d.distance,
                hasLocation: !!(d.location?.lat && d.location?.lng)
            })));
            setNearbyDrivers(drivers);
        });

        return () => {
            unsubscribe();
            DriverAvailabilityService.stopMonitoring();
        };
    }, [tripdata.pickup?.lat, tripdata.pickup?.lng, settings?.driverRadius]);

    // ✅ Durante a busca, aumentar frequência de atualização e notificar NewMapScreen
    useEffect(() => {
        if (tripStatus === 'searching' && tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng) {
            // Aumentar frequência de atualização durante a busca (5 segundos)
            const radius = 5; // Raio de 5km durante a busca
            DriverAvailabilityService.startMonitoring(
                { lat: tripdata.pickup.lat, lng: tripdata.pickup.lng },
                radius,
                5000 // Atualizar a cada 5 segundos durante a busca
            );

            // Notificar o NewMapScreen sobre os motoristas encontrados
            const unsubscribe = DriverAvailabilityService.subscribe((drivers) => {
                if (onNearbyDriversUpdate) {
                    onNearbyDriversUpdate(drivers);
                }
            });

            return () => {
                unsubscribe();
            };
        }
    }, [tripStatus, tripdata.pickup?.lat, tripdata.pickup?.lng, onNearbyDriversUpdate]);

    // ✅ CONECTAR E AUTENTICAR WEBSOCKET AUTOMATICAMENTE
    useEffect(() => {
        const connectAndAuthenticate = async () => {
            if (!auth.uid) {
                Logger.log('⚠️ [PASSENGER] Sem UID, pulando conexão WebSocket');
                return;
            }

            try {
                const webSocketManager = WebSocketManager.getInstance();

                // Conectar se não estiver conectado
                if (!webSocketManager.isConnected()) {
                    Logger.log('🔌 [PASSENGER] Conectando ao WebSocket...');
                    await webSocketManager.connect();
                }

                // Autenticar se não estiver autenticado
                const status = webSocketManager.getConnectionStatus();
                if (status.connected && !status.authenticated) {
                    Logger.log('🔐 [PASSENGER] Autenticando...');
                    await webSocketManager.authenticate(auth.uid, 'customer');
                }
            } catch (error) {
                Logger.error('❌ [PASSENGER] Erro ao conectar/autenticar:', error);
            }
        };

        connectAndAuthenticate();
    }, [auth.uid]);

    // ✅ ATUALIZAR STATUS DA CONEXÃO (a cada 5 segundos - reduzido para evitar spam)
    useEffect(() => {
        let authenticationAttempts = 0;
        const MAX_AUTH_ATTEMPTS = 3; // Máximo de 3 tentativas

        const updateConnectionStatus = () => {
            const webSocketManager = WebSocketManager.getInstance();
            const status = webSocketManager.getConnectionStatus();

            setConnectionStatus({
                connected: status.connected,
                authenticated: status.authenticated,
                socketId: status.socketId
            });

            // ✅ SE ESTÁ CONECTADO MAS NÃO AUTENTICADO, TENTAR AUTENTICAR (com limite)
            if (status.connected && !status.authenticated && auth.uid && authenticationAttempts < MAX_AUTH_ATTEMPTS) {
                authenticationAttempts++;
                Logger.log(`🔄 [PASSENGER] Tentando autenticar automaticamente... (tentativa ${authenticationAttempts}/${MAX_AUTH_ATTEMPTS})`);
                webSocketManager.authenticate(auth.uid, 'customer');
            } else if (status.authenticated) {
                // Resetar contador se autenticado
                authenticationAttempts = 0;
            }
        };

        updateConnectionStatus();
        const interval = setInterval(updateConnectionStatus, 5000); // Aumentado para 5 segundos
        return () => clearInterval(interval);
    }, [auth.uid]);

    useEffect(() => {
        const webSocketManager = WebSocketManager.getInstance();

        // ===== HANDLERS PARA EVENTOS DE VIAGEM =====

        // 1. Reserva criada com sucesso
        const handleBookingCreated = async (data) => {
            Logger.log('📋 [PASSENGER] Reserva criada:', data);
            if (data.success) {
                // ✅ IMPORTANTE: Usar bookingId do servidor ou do data
                const bookingId = data.bookingId || data.data?.bookingId || data.booking?.bookingId;

                // 🔥 Versionamento simples: atualizar versão se vier do servidor
                const serverVersion = data.version || data.data?.version || data.booking?.version || 0;
                if (serverVersion > bookingVersionRef.current) {
                    bookingVersionRef.current = serverVersion;
                    Logger.log(`✅ [PASSENGER] Versão atualizada: ${serverVersion}`);
                } else if (serverVersion > 0 && serverVersion < bookingVersionRef.current) {
                    Logger.warn(`⚠️ [PASSENGER] Ignorando update com versão antiga: ${serverVersion} < ${bookingVersionRef.current}`);
                    return; // Ignorar update antigo
                }

                setCurrentBooking({
                    bookingId: bookingId,
                    version: serverVersion, // 🔥 Incluir versão no estado
                    ...data.data,
                    ...data.booking
                });

                // ✅ Mudar status para 'searching' apenas se ainda não estiver em 'searching'
                // Isso evita múltiplas execuções do useEffect
                if (tripStatus !== 'searching') {
                    Logger.log('🔄 [PASSENGER] Mudando status para "searching" após reserva criada');
                    setTripStatus('searching');

                    // ✅ Iniciar busca de corrida
                    try {
                        await RideLocationManager.startRide({
                            bookingId: bookingId,
                            status: 'searching',
                            userType: 'customer',
                            pickup: {
                                address: tripdata.pickup?.add || tripdata.pickup?.address || 'Local de embarque'
                            }
                        });
                    } catch (error) {
                        Logger.warn('⚠️ [PassengerUI] Erro ao iniciar corrida:', error);
                    }
                } else {
                    Logger.log('ℹ️ [PASSENGER] Status já é "searching", mantendo estado atual');
                }
                // ✅ Limpar loading quando receber confirmação
                setBookModelLoading(false);
                isBookingInProgressRef.current = false;

                // ✅ NÃO limpar o timer aqui - deixar o useEffect fazer isso
                // O useEffect já vai criar o timer quando tripStatus mudar para 'searching'
                // Limpar aqui causa race condition e impede o timer de funcionar
                Logger.log('⏱️ [Timer] Status mudado para "searching", timer será iniciado pelo useEffect');

                // ✅ Iniciar tracking completo da corrida
                if (bookingId) {
                    TripDataService.startTripTracking(bookingId, {
                        passengerId: auth.uid,
                        passengerName: auth.profile?.name || auth.profile?.displayName,
                        passengerPhone: auth.profile?.phone,
                        passengerPhoto: auth.profile?.photoURL,
                        pickup: tripdata.pickup,
                        drop: tripdata.drop,
                        estimatedFare: tripdata.estimate || tripdata.fare,
                        status: 'searching',
                        platform: Platform.OS
                    }).catch(err => {
                        Logger.warn('⚠️ [PassengerUI] Erro ao iniciar tracking:', err);
                    });
                }

                // ✅ Timer será iniciado automaticamente pelo useEffect quando tripStatus mudar para 'searching'
                // Mas garantimos que o estado está correto acima

                // ✅ Reduzir zoom do mapa durante busca (mostrar área maior)
                if (mapRef?.current && currentLocation) {
                    setTimeout(() => {
                        mapRef.current.animateToRegion({
                            latitude: currentLocation.lat,
                            longitude: currentLocation.lng,
                            latitudeDelta: 0.05, // Zoom reduzido (área maior)
                            longitudeDelta: 0.05,
                        }, 500);
                    }, 300);
                }

                Logger.log('🔍 [PASSENGER] Status mudado para SEARCHING, aguardando motoristas...');

                // Não mostrar alerta para não interromper o fluxo
                // O status 'searching' já indica visualmente que está procurando
            } else {
                // ✅ Em caso de erro, voltar para 'idle'
                setTripStatus('idle');
                setBookModelLoading(false);
                isBookingInProgressRef.current = false;
                Alert.alert(
                    'Não foi possível criar a reserva',
                    'Por favor, verifique sua conexão e tente novamente. Se o problema persistir, entre em contato com o suporte.',
                    [{ text: 'OK' }]
                );
            }
        };

        // 🔥 Handler de erro de booking (fire-and-forget)
        const handleBookingError = (error) => {
            Logger.error('❌ [PASSENGER] Erro ao criar booking:', error);
            setTripStatus('idle');
            setBookModelLoading(false);
            isBookingInProgressRef.current = false;

            // ✅ Mensagem de erro específica e humana
            let errorMessage = 'Não foi possível criar a reserva. Por favor, verifique sua conexão e tente novamente.';

            if (error?.message) {
                if (error.message.includes('network') || error.message.includes('conexão') || error.message.includes('connection')) {
                    errorMessage = 'Erro de conexão. Verifique sua internet e tente novamente.';
                } else if (error.message.includes('timeout')) {
                    errorMessage = 'Tempo de espera esgotado. Tente novamente.';
                } else if (error.message.includes('invalid') || error.message.includes('inválido')) {
                    errorMessage = 'Dados inválidos. Verifique origem e destino e tente novamente.';
                } else if (error.message.includes('payment') || error.message.includes('pagamento')) {
                    errorMessage = 'Erro no processamento do pagamento. Verifique seus dados e tente novamente.';
                }
            }

            Alert.alert(
                'Erro ao Criar Reserva',
                errorMessage + ' Se o problema persistir, entre em contato com o suporte.',
                [{ text: 'OK' }]
            );
        };

        // 2. Motoristas encontrados
        const handleDriversFound = (data) => {
            Logger.log('🚗 [PASSENGER] Motoristas encontrados:', data);
            if (data.success) {
                setTripStatus('searching');
                Logger.log(`✅ [PASSENGER] ${data.drivers?.length || 0} motoristas notificados`);
                // Não mostrar alerta - o status 'searching' já indica visualmente
            }
        };

        // 3. Nenhum motorista disponível
        const handleNoDriversFound = (data) => {
            Logger.log('❌ Nenhum motorista disponível:', data);

            // ✅ Calcular tempo de busca ANTES de limpar o timestamp
            let searchTimeSeconds = 0;
            if (searchingStartTimeRef.current) {
                searchTimeSeconds = Math.floor((Date.now() - searchingStartTimeRef.current) / 1000);
                Logger.log(`⏱️ [PASSENGER] Tempo de busca (sem motorista): ${searchTimeSeconds} segundos (${(searchTimeSeconds / 60).toFixed(2)} minutos)`);
            }

            // ✅ Registrar tempo de busca no banco (marcado como "no_driver_found")
            if (currentBooking?.bookingId && searchTimeSeconds > 0) {
                const metadata = {
                    passengerId: auth.uid,
                    pickupLocation: tripdata.pickup ? {
                        lat: tripdata.pickup.lat,
                        lng: tripdata.pickup.lng,
                        address: tripdata.pickup.add
                    } : null,
                    destinationLocation: tripdata.drop ? {
                        lat: tripdata.drop.lat,
                        lng: tripdata.drop.lng,
                        address: tripdata.drop.add
                    } : null,
                    carType: currentBooking.carType || tripdata.carType,
                    estimatedFare: currentBooking.estimate || tripdata.estimate,
                    result: 'no_driver_found' // Marcar como sem motorista encontrado
                };

                TripDataService.recordDriverSearchTime(currentBooking.bookingId, searchTimeSeconds, metadata)
                    .catch(err => {
                        Logger.warn('⚠️ [PassengerUI] Erro ao registrar tempo de busca (sem motorista):', err);
                    });
            }

            setTripStatus('idle');
            setBookModelLoading(false); // ✅ Garantir que loading seja desativado
            isBookingInProgressRef.current = false; // ✅ Liberar flag de duplo clique

            // ✅ Parar temporizador
            if (searchingTimeIntervalRef.current) {
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            searchingStartTimeRef.current = null;
            // ✅ Parar animação de loading
            loadingRotation.stopAnimation();
            setSearchingTime(0);

            Alert.alert(
                'Buscando Motorista',
                'No momento, não há motoristas disponíveis nesta região. Você pode tentar novamente em alguns instantes ou verificar outras áreas próximas.',
                [{ text: 'OK', style: 'default' }]
            );
        };

        // 4. Motorista aceitou a corrida
        const handleDriverAccepted = async (data) => {
            Logger.log('✅ [PASSENGER] Motorista aceitou - dados recebidos:', JSON.stringify(data, null, 2));

            // 🔥 Versionamento simples: verificar versão antes de atualizar
            const serverVersion = data.version || data.booking?.version || data.data?.version || 0;
            if (serverVersion > 0 && serverVersion < bookingVersionRef.current) {
                Logger.warn(`⚠️ [PASSENGER] Ignorando update antigo (rideAccepted): ${serverVersion} < ${bookingVersionRef.current}`);
                return; // Ignorar update antigo
            }
            if (serverVersion > bookingVersionRef.current) {
                bookingVersionRef.current = serverVersion;
            }

            // ✅ Calcular tempo de busca ANTES de limpar o timestamp
            let searchTimeSeconds = 0;
            if (searchingStartTimeRef.current) {
                searchTimeSeconds = Math.floor((Date.now() - searchingStartTimeRef.current) / 1000);
                Logger.log(`⏱️ [PASSENGER] Tempo de busca calculado: ${searchTimeSeconds} segundos (${(searchTimeSeconds / 60).toFixed(2)} minutos)`);
            }

            // ✅ Registrar tempo de busca no banco de dados (métricas)
            if (currentBooking?.bookingId && searchTimeSeconds > 0) {
                const metadata = {
                    passengerId: auth.uid,
                    driverId: data.driverId || data.driver?.id,
                    pickupLocation: tripdata.pickup ? {
                        lat: tripdata.pickup.lat,
                        lng: tripdata.pickup.lng,
                        address: tripdata.pickup.add
                    } : null,
                    destinationLocation: tripdata.drop ? {
                        lat: tripdata.drop.lat,
                        lng: tripdata.drop.lng,
                        address: tripdata.drop.add
                    } : null,
                    carType: currentBooking.carType || tripdata.carType,
                    estimatedFare: currentBooking.estimate || tripdata.estimate
                };

                TripDataService.recordDriverSearchTime(currentBooking.bookingId, searchTimeSeconds, metadata)
                    .catch(err => {
                        Logger.warn('⚠️ [PassengerUI] Erro ao registrar tempo de busca:', err);
                    });
            }

            // ✅ CRÍTICO: Atualizar status IMEDIATAMENTE para sair de "procurando motoristas"
            setTripStatus('accepted');
            setDriverArrived(false); // Resetar estado de chegada
            setDriverAcceptedAt(Date.now()); // ✅ Salvar timestamp quando motorista aceitou (para cálculo de taxa)

            // ✅ Parar temporizador de busca
            if (searchingTimeIntervalRef.current) {
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            searchingStartTimeRef.current = null;
            setSearchingTime(0);

            // ✅ CORREÇÃO: Servidor já envia data.driver completo (busca do Redis/GraphQL)
            // NÃO buscar no Firebase (sem permissão e dados já vêm do servidor)
            let driverInfoData = data.driver || null;

            // Se não veio do servidor, criar estrutura mínima (não buscar Firebase)
            if (!driverInfoData && data.driverId) {
                Logger.warn('⚠️ [PASSENGER] Dados do motorista não vieram do servidor, usando estrutura mínima');
                driverInfoData = {
                    id: data.driverId,
                    name: data.driverName || 'Motorista',
                    location: data.location || null,
                    vehicle: data.vehicle || {},
                    rating: data.rating || 5.0
                };
            }

            // ✅ CRÍTICO: Garantir que driverInfo seja setado mesmo se dados incompletos
            if (driverInfoData) {
                setDriverInfo(driverInfoData);
                Logger.log('✅ [PASSENGER] driverInfo atualizado:', driverInfoData);
            } else {
                // Se não conseguiu buscar dados, criar estrutura mínima
                const minimalDriverInfo = {
                    id: data.driverId || 'unknown',
                    name: 'Motorista',
                    location: data.location || null,
                    vehicle: data.vehicle || {},
                    rating: data.rating || 5.0
                };
                setDriverInfo(minimalDriverInfo);
                Logger.log('⚠️ [PASSENGER] Usando dados mínimos do motorista:', minimalDriverInfo);
            }

            // ✅ Atualizar dados do motorista no TripDataService
            if (currentBooking?.bookingId) {
                TripDataService.updateTripStatus(currentBooking.bookingId, 'accepted', {
                    driverId: data.driverId,
                    driverName: driverInfoData?.name,
                    driverPhone: driverInfoData?.phone,
                    driverPhoto: driverInfoData?.photo,
                    vehicleBrand: driverInfoData?.vehicle?.brand,
                    vehicleModel: driverInfoData?.vehicle?.model,
                    vehicleColor: driverInfoData?.vehicle?.color,
                    vehiclePlate: driverInfoData?.vehicle?.plate
                }).catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao atualizar status:', err);
                });
            }

            // ✅ Calcular tempo estimado até motorista chegar (SEMPRE calcular, não usar padrão)
            const driverLocation = driverInfoData?.location || data.location || data.driver?.location;

            if (driverLocation && driverLocation.lat && driverLocation.lng && tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng) {
                const GetDistance = require('../../common-local/other/GeoFunctions').GetDistance;
                const distanceKm = GetDistance(
                    driverLocation.lat,
                    driverLocation.lng,
                    tripdata.pickup.lat,
                    tripdata.pickup.lng
                );
                Logger.log('📍 [PASSENGER] Calculando distância real:', {
                    driverLocation,
                    pickupLocation: tripdata.pickup,
                    distanceKm
                });
                // Velocidade média: 35 km/h = ~0.583 km/min
                const speedKmPerMin = 0.583;
                const estimatedMinutes = Math.max(1, Math.round(distanceKm / speedKmPerMin));
                setEstimatedPickupTime(estimatedMinutes);
                Logger.log(`⏱️ [PASSENGER] Tempo estimado REAL calculado: ${estimatedMinutes} minutos`);
            } else if (data.estimatedPickupTime && typeof data.estimatedPickupTime === 'number') {
                // Se servidor enviou tempo estimado, usar ele
                setEstimatedPickupTime(data.estimatedPickupTime);
                Logger.log(`⏱️ [PASSENGER] Usando tempo estimado do servidor: ${data.estimatedPickupTime} minutos`);
            } else {
                // ✅ Se não conseguiu calcular, tentar buscar localização do motorista do Redis via servidor
                // Mas não usar tempo padrão - deixar null e calcular quando receber localização
                Logger.warn('⚠️ [PASSENGER] Não foi possível calcular tempo estimado - aguardando localização do motorista');
                setEstimatedPickupTime(null); // Não usar padrão, calcular quando receber localização
            }

            // ✅ Atualizar status da corrida
            try {
                await RideLocationManager.updateRideStatus({
                    status: 'accepted',
                    driverName: driverInfoData?.name || data.driverName || 'Motorista',
                    estimatedTime: estimatedPickupTime || data.estimatedPickupTime
                });
            } catch (error) {
                Logger.warn('⚠️ [PassengerUI] Erro ao atualizar corrida:', error);
            }
        };

        // ✅ Handler para quando motorista chega ao local de embarque
        const handleDriverArrived = async (data) => {
            Logger.log('🚗 Motorista chegou ao local:', data);
            setDriverArrived(true);
            setEstimatedPickupTime(0);
            setEmbarkTimer(120); // ✅ Resetar timer para 02:00 (120 segundos)

            // ✅ Iniciar timer decrescente
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
            }
            embarkTimerIntervalRef.current = setInterval(() => {
                setEmbarkTimer((prev) => {
                    if (prev <= 1) {
                        clearInterval(embarkTimerIntervalRef.current);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            // ✅ Centralizar mapa na localização exata do motorista quando ele chegar
            if (driverLocation && mapRef?.current) {
                setTimeout(() => {
                    if (mapRef.current && driverLocation.lat && driverLocation.lng) {
                        Logger.log('📍 Centralizando mapa no motorista que chegou');
                        mapRef.current.animateToRegion({
                            latitude: driverLocation.lat,
                            longitude: driverLocation.lng,
                            latitudeDelta: 0.005, // Zoom bem próximo
                            longitudeDelta: 0.005,
                        }, 1000);
                    }
                }, 500); // Pequeno delay para garantir que o estado foi atualizado
            }

            // ✅ Atualizar status da corrida
            try {
                await RideLocationManager.updateRideStatus({
                    status: 'arrived',
                    driverName: driverInfo?.name || 'Motorista'
                });
            } catch (error) {
                Logger.warn('⚠️ [PassengerUI] Erro ao atualizar corrida:', error);
            }

            Alert.alert(
                'Motorista Chegou!',
                `${driverInfo?.name || 'Motorista'} chegou ao local de embarque`,
                [{ text: 'OK' }]
            );
        };

        // 5. Viagem iniciada
        const handleTripStarted = async (data) => {
            Logger.log('🚀 Viagem iniciada:', data);

            // 🔥 Versionamento simples: verificar versão antes de atualizar
            const serverVersion = data.version || data.booking?.version || data.data?.version || 0;
            if (serverVersion > 0 && serverVersion < bookingVersionRef.current) {
                Logger.warn(`⚠️ [PASSENGER] Ignorando update antigo (tripStarted): ${serverVersion} < ${bookingVersionRef.current}`);
                return; // Ignorar update antigo
            }
            if (serverVersion > bookingVersionRef.current) {
                bookingVersionRef.current = serverVersion;
            }

            setTripStatus('started');

            // ✅ Parar timer de embarque quando viagem iniciar
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }

            // ✅ Limpar polyline do motorista até pickup (não é mais necessário)
            setDriverToPickupPolyline([]);

            // ✅ Calcular rota até o destino imediatamente
            if (tripdata.pickup && tripdata.drop && driverLocation) {
                updateRouteToDestination(driverLocation, tripdata.drop);
            }

            // ✅ Atualizar status da corrida no TripDataService
            if (currentBooking?.bookingId) {
                TripDataService.updateTripStatus(currentBooking.bookingId, 'started', {
                    startedLocation: data.startLocation || null
                }).catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao atualizar status:', err);
                });
            }

            // ✅ Atualizar status da corrida
            try {
                await RideLocationManager.updateRideStatus({
                    status: 'started',
                    destination: {
                        address: tripdata.drop?.add || tripdata.drop?.address || 'Destino'
                    },
                    estimatedTime: data.estimatedTime || 20
                });
            } catch (error) {
                Logger.warn('⚠️ [PassengerUI] Erro ao atualizar corrida:', error);
            }

            Alert.alert(
                'Viagem Iniciada!',
                'Sua viagem começou! Acompanhe em tempo real.',
                [{ text: 'OK' }]
            );
        };

        // 6. Localização do motorista atualizada
        const handleDriverLocation = (data) => {
            Logger.log('📍 Localização do motorista:', data);
            setDriverLocation(data.location);
            driverLocationRef.current = data.location; // ✅ Atualizar ref também

            // ✅ Atualizar localização do motorista no mapa (NewMapScreen)
            if (onDriverLocationUpdate && data.location) {
                onDriverLocationUpdate({
                    lat: data.location.lat,
                    lng: data.location.lng,
                    heading: data.location.heading,
                    speed: data.location.speed
                });
            }

            // ✅ Recalcular tempo estimado se motorista ainda não chegou e temos localização
            if (!driverArrived && data.location && data.location.lat && data.location.lng && tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng && tripStatus === 'accepted') {
                const GetDistance = require('../../common-local/other/GeoFunctions').GetDistance;
                const distanceKm = GetDistance(
                    data.location.lat,
                    data.location.lng,
                    tripdata.pickup.lat,
                    tripdata.pickup.lng
                );
                // Velocidade média: 35 km/h = ~0.583 km/min
                const speedKmPerMin = 0.583;
                const estimatedMinutes = Math.max(0, Math.round(distanceKm / speedKmPerMin));
                setEstimatedPickupTime(estimatedMinutes);
                Logger.log(`⏱️ [PASSENGER] Tempo estimado atualizado: ${estimatedMinutes} minutos (distância: ${distanceKm.toFixed(2)}km)`);

                // ✅ ATUALIZAR POLYLINE: Calcular rota do motorista até o pickup
                updateDriverToPickupPolyline(data.location, tripdata.pickup);

                // Se motorista está muito próximo (menos de 100m), considerar que chegou
                if (distanceKm < 0.1 && !driverArrived) {
                    setDriverArrived(true);
                    setEstimatedPickupTime(0);
                }
            }

            // ✅ NOVO: Se corrida iniciou, atualizar rota até destino em tempo real
            if (tripStatus === 'started' && data.location && data.location.lat && data.location.lng && tripdata.drop && tripdata.drop.lat && tripdata.drop.lng) {
                updateRouteToDestination(data.location, tripdata.drop);
            }
        };

        // 7. Viagem finalizada
        const handleTripCompleted = async (data) => {
            // ✅ Limpar campo de mensagem quando viagem terminar
            setMessageText('');
            Logger.log('🏁 Viagem finalizada:', data);
            setTripStatus('completed');

            // ✅ Usar preço inicial (estimatedFare) ao invés do preço final
            // O preço final deve ser igual ao inicial (exceto casos especiais)
            const finalFare = parseFloat(currentBooking?.estimatedFare ||
                currentBooking?.estimate ||
                data.fare ||
                data.actualFare ||
                data.totalFare || 0);

            // ✅ Finalizar e salvar todos os dados da corrida
            if (currentBooking?.bookingId) {
                const finalData = {
                    finalFare: finalFare, // ✅ Usar preço inicial
                    distance: data.distance,
                    duration: data.duration || null,
                    drop: data.drop || currentBooking.drop || null
                };

                TripDataService.completeTrip(currentBooking.bookingId, finalData).catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao finalizar tracking:', err);
                });
            }

            // ✅ Atualizar notificação persistente para "finalizada"
            try {
                await RideLocationManager.endRide();
            } catch (error) {
                Logger.warn('⚠️ [PassengerUI] Erro ao finalizar corrida:', error);
            }

            // ✅ NOVO: Abrir modal de avaliação após 2 segundos
            setTimeout(() => {
                setRatingModalVisible(true);
            }, 2000);

            Alert.alert(
                'Viagem Finalizada!',
                `Distância: ${data.distance || 'N/A'}km\nValor: R$ ${finalFare.toFixed(2)}\n\nAvalie sua experiência!`,
                [
                    { text: 'Avaliar', onPress: () => setRatingModalVisible(true) },
                    { text: 'OK' }
                ]
            );
        };

        // 8. Pagamento confirmado
        const handlePaymentConfirmed = (data) => {
            Logger.log('💳 [WebSocket] Pagamento confirmado recebido:', data);

            // ✅ NÃO mostrar alert se o modal de pagamento ainda estiver aberto
            // O modal já mostra a confirmação, não precisa duplicar
            if (isPaymentModalVisible) {
                Logger.log('ℹ️ [WebSocket] Modal de pagamento ainda aberto, não mostrando alert duplicado');
                return;
            }

            // ✅ Verificar se já processamos este pagamento (evitar spam)
            if (currentBooking?.paymentStatus === 'paid' || currentBooking?.paymentStatus === 'confirmed') {
                Logger.log('ℹ️ [WebSocket] Pagamento já foi processado, ignorando evento duplicado');
                return;
            }

            if (currentBooking?.bookingId) {
                const finalFare = parseFloat(currentBooking?.estimatedFare ||
                    currentBooking?.estimate ||
                    data.fare ||
                    data.amount || 0);

                TripDataService.updatePayment(currentBooking.bookingId, {
                    finalFare,
                    paymentStatus: 'paid',
                    paymentId: data.paymentId || data.chargeId || null,
                    paidAt: new Date().toISOString()
                }).catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao atualizar pagamento:', err);
                });
            }

            // ✅ Só mostrar alert se o modal não estiver aberto
            // O modal já fecha automaticamente após confirmação
            Logger.log('✅ [WebSocket] Pagamento confirmado processado');
        };

        const handlePaymentRefunded = (data) => {
            Logger.log('💸 Pagamento reembolsado:', data);
            const refundAmount =
                typeof data?.refundAmount === 'number'
                    ? data.refundAmount
                    : parseFloat(data?.refundAmountInReais || '0');
            const feeAmount =
                typeof data?.cancellationFee === 'number'
                    ? data.cancellationFee
                    : parseFloat(data?.cancellationFeeInReais || '0');

            Alert.alert(
                'Pagamento Reembolsado',
                `Valor reembolsado: R$ ${refundAmount?.toFixed ? refundAmount.toFixed(2) : refundAmount}\n` +
                `Taxa de cancelamento: R$ ${feeAmount?.toFixed ? feeAmount.toFixed(2) : feeAmount}\n\n` +
                (data?.reason || 'O valor retornará para sua conta em instantes.'),
                [{ text: 'OK' }]
            );
        };

        // ✅ NOVO: Handler para cancelamento de corrida pelo motorista
        const handleRideCancelled = async (data) => {
            Logger.log('❌ [PASSENGER] Corrida cancelada pelo motorista:', data);

            // ✅ Verificar se é a corrida atual
            const bookingId = data.bookingId || data.data?.bookingId || currentBooking?.bookingId;
            if (bookingId !== currentBooking?.bookingId) {
                Logger.log('ℹ️ [PASSENGER] Cancelamento não é da corrida atual, ignorando');
                return;
            }

            // ✅ Verificar se foi cancelado pelo motorista (não pelo passageiro)
            const initiatedBy = data.initiatedBy || data.data?.initiatedBy;
            if (initiatedBy === 'customer') {
                Logger.log('ℹ️ [PASSENGER] Cancelamento foi feito pelo passageiro, não reiniciando busca');
                return;
            }

            // ✅ Limpar dados da corrida atual
            setDriverInfo(null);
            setDriverLocation(null);
            setDriverArrived(false);
            setDriverToPickupPolyline([]);
            setLocalRoutePolyline([]);

            // ✅ Parar timers
            if (searchingTimeIntervalRef.current) {
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            if (driverPolylineUpdateIntervalRef.current) {
                clearInterval(driverPolylineUpdateIntervalRef.current);
                driverPolylineUpdateIntervalRef.current = null;
            }
            searchingStartTimeRef.current = null;
            setSearchingTime(0);

            // ✅ Finalizar corrida cancelada
            try {
                await RideLocationManager.endRide();
            } catch (error) {
                Logger.warn('⚠️ [PassengerUI] Erro ao finalizar corrida:', error);
            }

            // ✅ Mostrar alerta informando que motorista cancelou
            Alert.alert(
                'Motorista Cancelou',
                'O motorista cancelou a corrida. Buscando um novo motorista...',
                [{ text: 'OK' }]
            );

            // ✅ Reiniciar busca automaticamente
            // Limpar booking atual primeiro
            setCurrentBooking(null);

            // ✅ Aguardar um momento e reiniciar busca
            setTimeout(() => {
                Logger.log('🔄 [PASSENGER] Reiniciando busca após cancelamento do motorista');

                // ✅ Mudar status para 'searching' para reiniciar busca
                setTripStatus('searching');

                // ✅ Criar nova solicitação de corrida
                if (tripdata.pickup && tripdata.drop) {
                    const createNewBooking = async () => {
                        try {
                            const webSocketManager = WebSocketManager.getInstance();

                            if (!webSocketManager.isConnected()) {
                                await webSocketManager.connect();
                            }

                            const bookingData = {
                                pickup: {
                                    lat: tripdata.pickup.lat,
                                    lng: tripdata.pickup.lng,
                                    address: tripdata.pickup.add || pickupAddress
                                },
                                destination: {
                                    lat: tripdata.drop.lat,
                                    lng: tripdata.drop.lng,
                                    address: tripdata.drop.add || tripdata.drop.address || ''
                                },
                                carType: tripdata.carType || 'standard',
                                estimatedFare: tripdata.estimate || 0
                            };

                            Logger.log('📋 [PASSENGER] Criando nova solicitação após cancelamento:', bookingData);
                            await webSocketManager.createBooking(bookingData);
                        } catch (error) {
                            Logger.error('❌ [PASSENGER] Erro ao criar nova solicitação:', error);
                            Alert.alert(
                                'Não foi possível buscar novo motorista',
                                'Por favor, verifique sua conexão e tente novamente.',
                                [{ text: 'OK' }]
                            );
                        }
                    };

                    createNewBooking();
                }
            }, 1000); // Aguardar 1 segundo antes de reiniciar
        };

        // ✅ NOVO: Handler para receber mensagens do chat (apenas durante corrida ativa)
        const handleNewMessage = (data) => {
            Logger.log('💬 Nova mensagem recebida:', data);
            // ✅ IMPORTANTE: Só processar mensagens se a corrida estiver aceita ou iniciada
            if (data.success && data.message && data.bookingId === currentBooking?.bookingId &&
                (tripStatus === 'accepted' || tripStatus === 'started')) {
                const newMessage = {
                    id: data.messageId || `msg_${Date.now()}`,
                    text: data.message,
                    senderId: data.senderId,
                    senderType: data.senderType || (data.senderId === driverInfo?.id ? 'driver' : 'passenger'),
                    timestamp: data.timestamp || new Date().toISOString(),
                    isOwn: data.senderId === auth.uid
                };

                setChatMessages(prev => [...prev, newMessage]);

                // ✅ IMPORTANTE: Salvar mensagem no banco para registro e auditoria
                if (currentBooking?.bookingId) {
                    TripDataService.addChatMessage(currentBooking.bookingId, {
                        senderId: data.senderId,
                        senderType: newMessage.senderType,
                        message: data.message,
                        timestamp: newMessage.timestamp
                    }).catch(err => {
                        Logger.warn('⚠️ [PassengerUI] Erro ao salvar mensagem recebida:', err);
                    });
                }
            } else if (tripStatus === 'completed' || tripStatus === 'idle') {
                // ✅ Ignorar mensagens se a corrida já terminou (mas já foram salvas no banco)
                Logger.log('ℹ️ [PassengerUI] Mensagem recebida após corrida finalizada, ignorando da UI (já salva no banco)');
            }
        };

        // ===== REGISTRAR TODOS OS EVENTOS =====
        webSocketManager.on('bookingCreated', handleBookingCreated);
        webSocketManager.on('bookingError', handleBookingError); // 🔥 Handler de erro
        webSocketManager.on('driversFound', handleDriversFound);
        webSocketManager.on('noDriversFound', handleNoDriversFound);
        // ✅ CORREÇÃO: Servidor envia 'rideAccepted', não 'driverAccepted'
        webSocketManager.on('rideAccepted', handleDriverAccepted);
        webSocketManager.on('driverAccepted', handleDriverAccepted); // Mantém compatibilidade
        webSocketManager.on('tripStarted', handleTripStarted);
        webSocketManager.on('driverLocation', handleDriverLocation);
        webSocketManager.on('driverArrived', handleDriverArrived); // ✅ Evento quando motorista chega
        webSocketManager.on('arrivedAtPickup', handleDriverArrived); // ✅ Evento alternativo
        webSocketManager.on('tripCompleted', handleTripCompleted);
        webSocketManager.on('paymentConfirmed', handlePaymentConfirmed);
        webSocketManager.on('paymentRefunded', handlePaymentRefunded);
        webSocketManager.on('newMessage', handleNewMessage); // ✅ NOVO: Listener para mensagens do chat
        webSocketManager.on('rideCancelled', handleRideCancelled); // ✅ NOVO: Handler para cancelamento pelo motorista

        // ===== CLEANUP =====
        return () => {
            webSocketManager.off('bookingCreated', handleBookingCreated);
            webSocketManager.off('bookingError', handleBookingError); // 🔥 Remover handler de erro
            webSocketManager.off('driversFound', handleDriversFound); // ✅ CORRIGIDO: era .on() agora é .off()
            webSocketManager.off('noDriversFound', handleNoDriversFound);
            webSocketManager.off('rideAccepted', handleDriverAccepted);
            webSocketManager.off('driverAccepted', handleDriverAccepted); // Mantém compatibilidade
            webSocketManager.off('tripStarted', handleTripStarted);
            webSocketManager.off('driverLocation', handleDriverLocation);
            webSocketManager.off('driverArrived', handleDriverArrived); // ✅ Cleanup
            webSocketManager.off('arrivedAtPickup', handleDriverArrived); // ✅ Cleanup
            webSocketManager.off('rideCancelled', handleRideCancelled); // ✅ Cleanup
            webSocketManager.off('tripCompleted', handleTripCompleted);
            webSocketManager.off('paymentConfirmed', handlePaymentConfirmed);
            webSocketManager.off('paymentRefunded', handlePaymentRefunded);
            webSocketManager.off('newMessage', handleNewMessage); // ✅ NOVO: Cleanup do listener de mensagens

            // ✅ Limpar temporizador de busca
            if (searchingTimeIntervalRef.current) {
                clearTimeout(searchingTimeIntervalRef.current);
                searchingTimeIntervalRef.current = null;
            }
            searchingStartTimeRef.current = null;

            // ✅ Limpar timer de embarque
            if (embarkTimerIntervalRef.current) {
                clearInterval(embarkTimerIntervalRef.current);
                embarkTimerIntervalRef.current = null;
            }
        };
    }, [navigation, t, dispatch]); // ✅ CORRIGIDO: Removido tripdata.pickup das dependências para evitar loop

    // ✅ OTIMIZAÇÃO: Atualizar localização do passageiro com throttling
    // MOVIDO PARA FORA DO useEffect ANTERIOR - hooks não podem ser chamados dentro de outros hooks
    // ✅ CORREÇÃO: Enviar via WebSocket para Redis GEO (não Firebase)
    const lastLocationUpdateRef = useRef(null);
    const lastLocationSentRef = useRef(null);

    useEffect(() => {
        if ((tripStatus === 'started' || tripStatus === 'accepted') && currentBooking?.bookingId && currentLocation) {
            const MIN_UPDATE_INTERVAL = 5000; // 5 segundos mínimo
            const MIN_DISTANCE_CHANGE = 0.0001; // ~11 metros

            const sendLocationIfNeeded = () => {
                const now = Date.now();

                // Verificar se passou tempo suficiente desde última atualização
                if (lastLocationUpdateRef.current && (now - lastLocationUpdateRef.current) < MIN_UPDATE_INTERVAL) {
                    return; // Muito cedo, não atualiza
                }

                // Verificar se localização mudou significativamente
                if (lastLocationSentRef.current) {
                    const distance = Math.sqrt(
                        Math.pow(lastLocationSentRef.current.lat - currentLocation.lat, 2) +
                        Math.pow(lastLocationSentRef.current.lng - currentLocation.lng, 2)
                    );
                    if (distance < MIN_DISTANCE_CHANGE) {
                        return; // Não moveu o suficiente
                    }
                }

                // Atualizar referências
                lastLocationUpdateRef.current = now;
                lastLocationSentRef.current = {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                };

                // ✅ Enviar localização via WebSocket para Redis GEO (tempo real)
                const webSocketManager = WebSocketManager.getInstance();
                if (webSocketManager.isConnected()) {
                    webSocketManager.emitToServer('updateLocation', {
                        lat: currentLocation.lat,
                        lng: currentLocation.lng,
                        uid: auth.profile?.uid,
                        bookingId: currentBooking.bookingId,
                        userType: 'customer'
                    });
                }

                // ✅ Manter histórico local (opcional, para snapshot final)
                TripDataService.updatePassengerLocation(currentBooking.bookingId, {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng,
                    accuracy: currentLocation.accuracy || null
                }).catch(err => {
                    // Não é crítico - apenas histórico local
                });
            };

            // Enviar imediatamente se necessário
            sendLocationIfNeeded();

            // Configurar intervalo
            const interval = setInterval(sendLocationIfNeeded, MIN_UPDATE_INTERVAL);

            return () => clearInterval(interval);
        }
    }, [tripStatus, currentBooking?.bookingId, currentLocation?.lat, currentLocation?.lng, auth.profile?.uid]);

    // ✅ NOVO: Função para calcular rota completa com waypoints (motorista → embarque → destino)
    const calculateCompleteRouteWithWaypoints = useCallback(async (driverLoc, pickupLoc, dropLoc) => {
        if (!driverLoc || !driverLoc.lat || !driverLoc.lng ||
            !pickupLoc || !pickupLoc.lat || !pickupLoc.lng ||
            !dropLoc || !dropLoc.lat || !dropLoc.lng) {
            Logger.warn('⚠️ [Route] Dados insuficientes para calcular rota completa');
            return null;
        }

        try {
            const origin = `${driverLoc.lat},${driverLoc.lng}`;
            const waypoint = `${pickupLoc.lat},${pickupLoc.lng}`;
            const destination = `${dropLoc.lat},${dropLoc.lng}`;

            Logger.log('🗺️ [Route] Calculando rota completa com waypoints:', { origin, waypoint, destination });

            // ✅ Chamar API com waypoint (1 única chamada)
            const routeDetails = await getDirectionsApi(origin, destination, waypoint);

            if (routeDetails && routeDetails.hasWaypoints && routeDetails.legs && routeDetails.legs.length >= 2) {
                // ✅ Extrair legs separadamente
                const leg1 = routeDetails.legs[0]; // Motorista → Embarque
                const leg2 = routeDetails.legs[1]; // Embarque → Destino

                // ✅ Decodificar polylines de cada leg
                let leg1Coords = [];
                let leg2Coords = [];

                if (leg1.polylinePoints) {
                    const leg1Points = polyline.decode(leg1.polylinePoints);
                    leg1Coords = leg1Points.map(point => ({
                        latitude: point[0],
                        longitude: point[1]
                    }));
                }

                if (leg2.polylinePoints) {
                    const leg2Points = polyline.decode(leg2.polylinePoints);
                    leg2Coords = leg2Points.map(point => ({
                        latitude: point[0],
                        longitude: point[1]
                    }));
                }

                Logger.log(`✅ [Route] Rota completa calculada: Leg1=${leg1Coords.length} pontos, Leg2=${leg2Coords.length} pontos`);

                const result = {
                    leg1: {
                        coords: leg1Coords,
                        distance_km: leg1.distance_in_km,
                        time_secs: leg1.time_in_secs,
                        polyline: leg1.polylinePoints
                    },
                    leg2: {
                        coords: leg2Coords,
                        distance_km: leg2.distance_in_km,
                        time_secs: leg2.time_in_secs,
                        polyline: leg2.polylinePoints
                    },
                    fullRoute: {
                        polyline: routeDetails.polylinePoints,
                        totalDistance_km: routeDetails.legs.reduce((sum, leg) => sum + leg.distance_in_km, 0),
                        totalTime_secs: routeDetails.legs.reduce((sum, leg) => sum + leg.time_in_secs, 0)
                    },
                    // ✅ IMPORTANTE: Dados para tarifa (apenas leg2 - embarque → destino)
                    fareData: {
                        distance_km: leg2.distance_in_km, // ✅ Apenas distância do leg2
                        time_secs: leg2.time_in_secs,     // ✅ Apenas tempo do leg2
                        polyline: leg2.polylinePoints      // ✅ Polyline do leg2 para cálculo de pedágio
                    }
                };

                Logger.log('✅ [Route] Dados de tarifa (apenas leg2):', {
                    distance_km: result.fareData.distance_km,
                    time_min: Math.round(result.fareData.time_secs / 60)
                });

                return result;
            } else {
                Logger.warn('⚠️ [Route] Rota não tem waypoints ou legs insuficientes');
                return null;
            }
        } catch (error) {
            Logger.error('❌ [Route] Erro ao calcular rota completa:', error);
            return null;
        }
    }, []);

    // ✅ Função para atualizar polyline do motorista até o pickup (AGORA USA ROTA COMPLETA)
    const updateDriverToPickupPolyline = useCallback(async (driverLoc, pickupLoc) => {
        if (!driverLoc || !driverLoc.lat || !driverLoc.lng || !pickupLoc || !pickupLoc.lat || !pickupLoc.lng) {
            Logger.warn('⚠️ [Polyline] Dados insuficientes para calcular rota do motorista');
            return;
        }

        // ✅ Se temos destino, calcular rota completa com waypoints
        const dropLoc = tripdata?.drop;
        if (dropLoc && dropLoc.lat && dropLoc.lng) {
            const completeRoute = await calculateCompleteRouteWithWaypoints(driverLoc, pickupLoc, dropLoc);

            if (completeRoute && completeRoute.leg1) {
                // ✅ Usar apenas leg1 (motorista → embarque) para visualização quando status = ACCEPTED
                setDriverToPickupPolyline(completeRoute.leg1.coords);

                // ✅ Armazenar leg2 para uso futuro (quando status = STARTED)
                if (completeRoute.leg2) {
                    setRouteToDestinationPolyline(completeRoute.leg2.coords);

                    // ✅ IMPORTANTE: Armazenar fareData para evitar 2ª chamada à API
                    if (completeRoute.fareData) {
                        setCompleteRouteFareData(completeRoute.fareData);
                        Logger.log('✅ [Route] fareData armazenado para reuso:', {
                            distance_km: completeRoute.fareData.distance_km,
                            time_secs: completeRoute.fareData.time_secs
                        });
                    }

                    if (setRoutePolyline) {
                        // Por enquanto, mostrar apenas leg1
                        setRoutePolyline(completeRoute.leg1.coords);
                    }
                }

                Logger.log(`✅ [Polyline] Rota completa calculada e leg1 atualizado: ${completeRoute.leg1.coords.length} pontos`);
                return;
            }
        }

        // ✅ Fallback: calcular apenas rota motorista → pickup (sem destino ainda)
        try {
            const origin = `${driverLoc.lat},${driverLoc.lng}`;
            const destination = `${pickupLoc.lat},${pickupLoc.lng}`;

            Logger.log('🗺️ [Polyline] Calculando rota do motorista até pickup (fallback):', { origin, destination });

            const routeDetails = await getDirectionsApi(origin, destination);

            if (routeDetails && routeDetails.polylinePoints) {
                try {
                    const points = polyline.decode(routeDetails.polylinePoints);
                    const coordsArr = points.map(point => ({
                        latitude: point[0],
                        longitude: point[1]
                    }));

                    setDriverToPickupPolyline(coordsArr);
                    Logger.log(`✅ [Polyline] Rota do motorista atualizada: ${coordsArr.length} pontos`);

                    // ✅ Atualizar polyline no mapa (NewMapScreen)
                    if (setRoutePolyline) {
                        setRoutePolyline(coordsArr);
                    }
                } catch (decodeError) {
                    Logger.error('❌ [Polyline] Erro ao decodificar polyline:', decodeError);
                }
            }
        } catch (error) {
            Logger.error('❌ [Polyline] Erro ao calcular rota do motorista:', error);
        }
    }, [setRoutePolyline, calculateCompleteRouteWithWaypoints, tripdata?.drop]);

    // ✅ NOVO: Função para atualizar rota até o destino quando corrida inicia
    const updateRouteToDestination = useCallback(async (driverLoc, destinationLoc) => {
        if (!driverLoc || !driverLoc.lat || !driverLoc.lng || !destinationLoc || !destinationLoc.lat || !destinationLoc.lng) {
            Logger.warn('⚠️ [Polyline] Dados insuficientes para calcular rota até destino');
            return;
        }

        try {
            const origin = `${driverLoc.lat},${driverLoc.lng}`;
            const destination = `${destinationLoc.lat},${destinationLoc.lng}`;

            Logger.log('🗺️ [Polyline] Calculando rota até destino:', { origin, destination });

            const routeDetails = await getDirectionsApi(origin, destination);

            if (routeDetails && routeDetails.polylinePoints) {
                try {
                    const points = polyline.decode(routeDetails.polylinePoints);
                    const coordsArr = points.map(point => ({
                        latitude: point[0],
                        longitude: point[1]
                    }));

                    setRouteToDestinationPolyline(coordsArr);
                    Logger.log(`✅ [Polyline] Rota até destino atualizada: ${coordsArr.length} pontos`);

                    // ✅ Atualizar polyline no mapa (NewMapScreen)
                    if (setRoutePolyline) {
                        setRoutePolyline(coordsArr);
                    }
                } catch (decodeError) {
                    Logger.error('❌ [Polyline] Erro ao decodificar polyline do destino:', decodeError);
                }
            }
        } catch (error) {
            Logger.error('❌ [Polyline] Erro ao calcular rota até destino:', error);
        }
    }, [setRoutePolyline]);

    // ✅ useEffect para atualizar polyline do motorista a cada segundo quando aceito
    useEffect(() => {
        if (tripStatus === 'accepted' && driverLocation && tripdata.pickup && !driverArrived) {
            // ✅ Atualizar imediatamente
            updateDriverToPickupPolyline(driverLocation, tripdata.pickup);

            // ✅ Configurar intervalo para atualizar a cada segundo
            if (driverPolylineUpdateIntervalRef.current) {
                clearInterval(driverPolylineUpdateIntervalRef.current);
            }

            // ✅ Usar ref para pickup (não muda durante a corrida)
            const pickupRef = { current: tripdata.pickup };

            driverPolylineUpdateIntervalRef.current = setInterval(() => {
                // ✅ Verificar se ainda está em 'accepted' e tem dados
                // Refs são atualizados automaticamente quando estados mudam
                if (driverLocationRef.current && pickupRef.current && tripStatusRef.current === 'accepted' && !driverArrivedRef.current) {
                    updateDriverToPickupPolyline(driverLocationRef.current, pickupRef.current);
                }
            }, 1000); // Atualizar a cada 1 segundo

            return () => {
                if (driverPolylineUpdateIntervalRef.current) {
                    clearInterval(driverPolylineUpdateIntervalRef.current);
                    driverPolylineUpdateIntervalRef.current = null;
                }
            };
        } else {
            // ✅ Limpar polyline APENAS se a corrida foi cancelada ou finalizada
            // NÃO limpar se apenas mudou de status (ex: de 'accepted' para 'started')
            if (driverPolylineUpdateIntervalRef.current) {
                clearInterval(driverPolylineUpdateIntervalRef.current);
                driverPolylineUpdateIntervalRef.current = null;
            }
            // ✅ Só limpar se a corrida foi cancelada ou finalizada (não apenas mudou de status)
            if (tripStatus === 'idle' || tripStatus === 'completed' || tripStatus === 'canceled') {
                setDriverToPickupPolyline([]);
                if (setRoutePolyline) {
                    setRoutePolyline([]);
                }
            }
        }
    }, [tripStatus, driverLocation, tripdata.pickup, driverArrived, updateDriverToPickupPolyline]);

    // ✅ NOVO: useEffect para atualizar rota até destino quando corrida inicia
    useEffect(() => {
        if (tripStatus === 'started' && driverLocation && tripdata.drop) {
            // ✅ Atualizar imediatamente
            updateRouteToDestination(driverLocation, tripdata.drop);

            // ✅ Configurar intervalo para atualizar a cada 5 segundos (menos frequente que pickup)
            if (destinationPolylineUpdateIntervalRef.current) {
                clearInterval(destinationPolylineUpdateIntervalRef.current);
            }

            const dropRef = { current: tripdata.drop };

            destinationPolylineUpdateIntervalRef.current = setInterval(() => {
                if (driverLocationRef.current && dropRef.current && tripStatusRef.current === 'started') {
                    updateRouteToDestination(driverLocationRef.current, dropRef.current);
                }
            }, 5000); // Atualizar a cada 5 segundos

            return () => {
                if (destinationPolylineUpdateIntervalRef.current) {
                    clearInterval(destinationPolylineUpdateIntervalRef.current);
                    destinationPolylineUpdateIntervalRef.current = null;
                }
            };
        } else {
            // ✅ Limpar intervalo se corrida não está mais em andamento
            if (destinationPolylineUpdateIntervalRef.current) {
                clearInterval(destinationPolylineUpdateIntervalRef.current);
                destinationPolylineUpdateIntervalRef.current = null;
            }
            // ✅ Limpar polyline se corrida foi finalizada
            if (tripStatus === 'idle' || tripStatus === 'completed' || tripStatus === 'canceled') {
                setRouteToDestinationPolyline([]);
                if (setRoutePolyline) {
                    setRoutePolyline([]);
                }
            }
        }
    }, [tripStatus, driverLocation, tripdata.drop, updateRouteToDestination]);

    // useEffect removido - allCarTypes agora vem como prop do NewMapScreen

    // Função removida - agora integrada diretamente no useEffect

    // Função para obter estimativa de um carro específico
    const getEstimateForCar = useCallback((car) => {
        // Logger.log(`🔍 getEstimateForCar chamado para ${car.name}:`, carEstimates[car.name]);

        if (!car || !carEstimates[car.name]) {
            // ✅ NÃO retornar min_fare - retornar null para indicar que não foi calculado
            // Logger.log(`⚠️ Sem estimativa para ${car.name}, retornando null (não usar min_fare)`);
            return {
                fare: null, // ✅ null em vez de min_fare
                time: 0
            };
        }

        const estimate = carEstimates[car.name];
        // Logger.log(`✅ Estimativa encontrada para ${car.name}:`, estimate);

        // ✅ Só retornar preço se for estimateFare calculado (não min_fare)
        const calculatedFare = estimate.estimateFare || estimate.fare;
        const isMinFare = calculatedFare === car?.min_fare;

        return {
            fare: (calculatedFare && !isMinFare) ? calculatedFare : null, // ✅ null se for min_fare
            time: estimate.estimateTime || estimate.time || 0
        };
    }, [carEstimates]);

    const filteredCarTypes = useMemo(() => {
        if (!allCarTypes) return [];
        return allCarTypes.slice(0, 5);
    }, [allCarTypes]);

    // ✅ Função para detectar se um endereço é aproximado (ex: apenas rua e número, sem detalhes específicos)
    const isApproximateAddress = useCallback((address) => {
        if (!address) return false;

        // Endereços aproximados geralmente contêm apenas:
        // - Rua/Avenida + número
        // - Sem referências específicas como "Casa", "Bloco", "Apto", "Condomínio", etc.
        const addressLower = address.toLowerCase();

        // Se contém apenas coordenadas, é aproximado
        if (address.includes('Localização (') && address.includes(')')) {
            return true;
        }

        // Se não contém palavras-chave de localização específica, pode ser aproximado
        const specificKeywords = ['casa', 'bloco', 'apto', 'apartamento', 'condomínio', 'condominio', 'torre', 'edifício', 'edificio', 'lote', 'quadra', 'rua interna', 'via interna'];
        const hasSpecificKeyword = specificKeywords.some(keyword => addressLower.includes(keyword));

        // Se tem apenas rua/número básico sem detalhes, é aproximado
        const basicPattern = /^(rua|avenida|av\.|estrada|rod\.|rodovia|alameda|praça|pça\.|travessa|tv\.|via)\s+[^,]+,\s*\d+/i;
        const matchesBasicPattern = basicPattern.test(address);

        // Se corresponde ao padrão básico mas não tem palavras-chave específicas, é aproximado
        return matchesBasicPattern && !hasSpecificKeyword;
    }, []);

    // ✅ Função para adicionar detalhes ao endereço aproximado
    const handleAddAddressDetails = useCallback((type) => {
        const currentAddress = type === 'pickup' ? tripdata.pickup?.add : tripdata.drop?.add;
        if (!currentAddress) return;

        setAddressDetailsType(type);
        setAddressDetails('');
        setIsAddressDetailsModalVisible(true);
    }, [tripdata.pickup?.add, tripdata.drop?.add]);

    // ✅ Função para salvar endereço com detalhes
    const handleSaveAddressWithDetails = useCallback(async () => {
        if (!addressDetails.trim()) {
            Alert.alert('Atenção', 'Por favor, adicione os detalhes do endereço (ex: Casa 15, Bloco A)');
            return;
        }

        const currentAddress = addressDetailsType === 'pickup' ? tripdata.pickup : tripdata.drop;
        if (!currentAddress) return;

        // Combinar endereço base com detalhes
        const fullAddress = `${currentAddress.add} - ${addressDetails.trim()}`;

        // Atualizar no Redux
        if (addressDetailsType === 'pickup') {
            dispatch(updateTripPickup({
                ...currentAddress,
                add: fullAddress
            }));
            setManualPickupText(fullAddress);
        } else {
            dispatch(updateTripDrop({
                ...currentAddress,
                add: fullAddress
            }));
        }

        setIsAddressDetailsModalVisible(false);
        setAddressDetails('');

        // ✅ Opcional: Salvar como endereço favorito
        Alert.alert(
            'Endereço Atualizado',
            'Deseja salvar este endereço como favorito?',
            [
                { text: 'Não', style: 'cancel' },
                {
                    text: 'Sim, salvar',
                    onPress: async () => {
                        try {
                            const { saveAddresses } = require('../../common-local/actions/authactions');
                            await saveAddresses(auth.uid, {
                                add: fullAddress,
                                lat: currentAddress.lat,
                                lng: currentAddress.lng
                            }, 'Endereço Personalizado');
                            Alert.alert('Sucesso', 'Endereço salvo como favorito!');
                        } catch (error) {
                            Logger.error('Erro ao salvar endereço favorito:', error);
                        }
                    }
                }
            ]
        );
    }, [addressDetails, addressDetailsType, tripdata.pickup, tripdata.drop, dispatch, auth.uid]);

    // ✅ Função para formatar endereço simplificado (apenas rua+número ou nome do local)
    const formatAddressSimplified = useCallback((address) => {
        if (!address) return '';

        const description = address.description || address.formatted_address || '';

        // Se tem structured_formatting, usar para extrair rua+número ou nome do local
        if (address.structured_formatting) {
            const mainText = address.structured_formatting.main_text || '';
            const secondaryText = address.structured_formatting.secondary_text || '';

            // Verificar se main_text é um nome de lugar (não começa com número ou tipo de rua)
            const isPlaceName = !/^\d+/.test(mainText) && !/^(Rua|Avenida|Av\.|R\.|Alameda|Praça|Pça\.|Travessa|Tv\.|Via|Estrada|Rod\.|Rodovia)/i.test(mainText);

            if (isPlaceName) {
                // É um lugar com nome (ex: "Shopping Center")
                return mainText.trim();
            } else if (secondaryText) {
                // É um endereço - combinar main_text + primeira parte do secondary_text para ter rua+número
                const secondaryParts = secondaryText.split(', ');
                const streetAndNumber = secondaryParts[0] || '';
                // ✅ CORREÇÃO CRÍTICA: Se main_text é apenas número OU muito curto, SEMPRE combinar com secondary_text
                const isOnlyNumber = /^\d+$/.test(mainText.trim());
                const isVeryShort = mainText.trim().length < 15;

                if (isOnlyNumber || (isVeryShort && streetAndNumber)) {
                    // ✅ FORÇAR combinação: rua (secondary) + número (main) com vírgula
                    const result = `${streetAndNumber.trim()}, ${mainText.trim()}`.trim();
                    Logger.log('✅ [formatAddressSimplified] FORÇANDO combinação rua + número:', {
                        mainText: mainText,
                        streetAndNumber: streetAndNumber,
                        result: result,
                        isOnlyNumber: isOnlyNumber,
                        isVeryShort: isVeryShort
                    });
                    return result;
                } else {
                    // main_text já tem rua+número completo
                    Logger.log('✅ [formatAddressSimplified] Main text já tem rua+número completo:', mainText);
                    return mainText.trim();
                }
            } else {
                Logger.log('✅ [formatAddressSimplified] Apenas main text:', mainText);
                return mainText.trim();
            }
        }

        // Fallback: extrair rua+número do description completo
        const parts = description.split(', ');
        if (parts.length >= 2) {
            // Retornar primeira parte (rua + número) ou nome do local
            return parts[0].trim();
        }

        return description.trim();
    }, []);

    // Função para formatar endereço de forma inteligente
    const formatAddressForDropdown = (item) => {
        // ✅ Priorizar structured_formatting do Google Places API quando disponível
        if (item.structured_formatting) {
            const mainText = item.structured_formatting.main_text || '';
            const secondaryText = item.structured_formatting.secondary_text || '';
            const fullDescription = item.description || '';

            Logger.log('🔍 [formatAddressForDropdown] Processando:', {
                mainText: mainText,
                secondaryText: secondaryText,
                fullDescription: fullDescription
            });

            // ✅ CORREÇÃO PRIORITÁRIA ABSOLUTA: Se main_text é apenas um número, SEMPRE usar description completo
            // O Google Places pode retornar main_text="28" e secondary_text vazio ou incorreto
            // Por isso, se main_text é número, SEMPRE usar description completo que tem o endereço completo
            const isOnlyNumber = /^\d+$/.test(mainText.trim());

            if (isOnlyNumber && fullDescription) {
                // ✅ Se main_text é apenas número, usar description completo que tem "Rua dos Geólogos, 28, Bairro, Cidade"
                Logger.log('✅ [formatAddressForDropdown] PRIORIDADE ABSOLUTA: main_text é número, usando description completo:', fullDescription);
                const parts = fullDescription.split(', ');
                if (parts.length >= 2) {
                    // Combinar primeira e segunda parte para ter rua + número
                    const topLine = `${parts[0].trim()}, ${parts[1].trim()}`.trim();
                    const bottomLine = parts.length > 2 ? parts.slice(2, 4).join(', ').trim() : '';
                    return {
                        topLine: topLine, // ✅ PRIMEIRA LINHA: "Rua dos Geólogos, 28"
                        bottomLine: bottomLine, // ✅ SEGUNDA LINHA: Bairro + cidade
                        hasPlaceName: false
                    };
                } else {
                    return {
                        topLine: fullDescription.trim(),
                        bottomLine: '',
                        hasPlaceName: false
                    };
                }
            }

            // ✅ Se main_text é muito curto E temos secondary_text, combinar
            const isVeryShort = mainText.trim().length < 15;
            if (isVeryShort && secondaryText) {
                const secondaryParts = secondaryText.split(', ');
                const streetName = secondaryParts[0] || '';
                const topLine = `${streetName.trim()}, ${mainText.trim()}`.trim();
                const bottomLine = secondaryParts.length > 1 ? secondaryParts.slice(1, 3).join(', ').trim() : '';
                Logger.log('✅ [formatAddressForDropdown] Combinando texto curto com secondary:', topLine);
                return {
                    topLine: topLine,
                    bottomLine: bottomLine,
                    hasPlaceName: false
                };
            }

            // ✅ Se main_text é muito curto e NÃO temos secondary_text, usar description completo
            if (isVeryShort && !secondaryText && fullDescription && fullDescription.length > mainText.length) {
                Logger.log('✅ [formatAddressForDropdown] Usando description completo (main_text muito curto)');
                const parts = fullDescription.split(', ');
                if (parts.length >= 3) {
                    // Formato: "Estrada do Rio Grande, 4057, Bairro, Cidade"
                    const topLine = `${parts[0].trim()}, ${parts[1].trim()}`.trim();
                    const bottomLine = parts.slice(2, 4).join(', ').trim();
                    return {
                        topLine: topLine,
                        bottomLine: bottomLine,
                        hasPlaceName: false
                    };
                } else if (parts.length >= 2) {
                    const topLine = `${parts[0].trim()}, ${parts[1].trim()}`.trim();
                    const bottomLine = parts.length > 2 ? parts[2].trim() : '';
                    return {
                        topLine: topLine,
                        bottomLine: bottomLine,
                        hasPlaceName: false
                    };
                } else {
                    // Se description tem apenas uma parte, usar ela
                    return {
                        topLine: fullDescription.trim(),
                        bottomLine: '',
                        hasPlaceName: false
                    };
                }
            }

            // Verificar se main_text parece ser um nome de lugar (não começa com número ou tipo de rua)
            const isPlaceName = !/^\d+/.test(mainText) && !/^(Rua|Avenida|Av\.|R\.|Alameda|Praça|Pça\.|Travessa|Tv\.|Via|Estrada|Rod\.|Rodovia)/i.test(mainText);

            if (isPlaceName && secondaryText) {
                // É um lugar com nome (Places API) - ex: "Shopping Center"
                // topLine = nome do lugar
                // bottomLine = rua + número + bairro (extrair do secondary_text)
                const secondaryParts = secondaryText.split(', ');
                let streetAndNumber = secondaryParts[0] || '';
                let neighborhood = secondaryParts[1] || '';

                Logger.log('✅ [formatAddressForDropdown] É lugar com nome:', {
                    placeName: mainText,
                    streetAndNumber: streetAndNumber
                });

                return {
                    topLine: mainText.trim(), // Nome do lugar
                    bottomLine: streetAndNumber + (neighborhood ? `, ${neighborhood}` : ''), // Rua + número + bairro
                    hasPlaceName: true
                };
            } else if (secondaryText) {
                // É um endereço (rua + número) - Geocoding API ou Places sem nome
                const secondaryParts = secondaryText.split(', ');
                const streetName = secondaryParts[0] || '';

                // ✅ CORREÇÃO CRÍTICA: Sempre mostrar rua + número na primeira linha
                // Se main_text é apenas número OU muito curto, combinar com secondary_text (rua)
                // Se main_text já tem rua+número completo, usar main_text
                let topLine;
                const isOnlyNumber = /^\d+$/.test(mainText.trim());
                const isVeryShort = mainText.trim().length < 15; // Aumentado para 15 caracteres

                if (isOnlyNumber || (isVeryShort && streetName)) {
                    // main_text é apenas número (ex: "28") ou muito curto, combinar com rua do secondary_text (ex: "Rua dos Geólogos")
                    topLine = `${streetName.trim()}, ${mainText.trim()}`.trim();
                    Logger.log('✅ [formatAddressForDropdown] FORÇANDO combinação número com rua:', {
                        mainText: mainText,
                        streetName: streetName,
                        result: topLine,
                        isOnlyNumber: isOnlyNumber,
                        isVeryShort: isVeryShort
                    });
                } else {
                    // main_text já tem rua+número completo (ex: "Estrada dos Bandeirantes, 2000")
                    topLine = mainText.trim();
                    Logger.log('✅ [formatAddressForDropdown] Main text já tem rua+número completo:', topLine);
                }

                let bottomLine = '';
                if (secondaryParts.length >= 2) {
                    // Pegar bairro e cidade (geralmente os dois primeiros elementos após rua+número)
                    bottomLine = secondaryParts.slice(1, 3).join(', ').trim();
                } else if (secondaryParts.length === 1) {
                    bottomLine = secondaryParts[0].trim();
                }

                return {
                    topLine: topLine, // ✅ Sempre mostrar endereço completo (rua + número) na primeira linha
                    bottomLine: bottomLine,
                    hasPlaceName: false
                };
            } else {
                // Só tem main_text - verificar se description tem mais informações
                // ✅ CORREÇÃO CRÍTICA: Se main_text é apenas número, SEMPRE usar description completo
                const isOnlyNumber = /^\d+$/.test(mainText.trim());
                if (isOnlyNumber && fullDescription) {
                    Logger.log('✅ [formatAddressForDropdown] Main é número sem secondary, usando description completo:', fullDescription);
                    const parts = fullDescription.split(', ');
                    if (parts.length >= 2) {
                        // Combinar primeira e segunda parte para ter rua + número
                        const topLine = `${parts[0].trim()}, ${parts[1].trim()}`.trim();
                        const bottomLine = parts.length > 2 ? parts.slice(2, 4).join(', ').trim() : '';
                        return {
                            topLine: topLine,
                            bottomLine: bottomLine,
                            hasPlaceName: false
                        };
                    } else {
                        return {
                            topLine: fullDescription.trim(),
                            bottomLine: '',
                            hasPlaceName: false
                        };
                    }
                }

                if (fullDescription && fullDescription.length > mainText.length) {
                    const parts = fullDescription.split(', ');
                    if (parts.length >= 2) {
                        return {
                            topLine: parts[0].trim(),
                            bottomLine: parts.slice(1, 3).join(', ').trim(),
                            hasPlaceName: false
                        };
                    }
                }

                return {
                    topLine: mainText.trim(),
                    bottomLine: '',
                    hasPlaceName: false
                };
            }
        }

        // ✅ Fallback: parsear description manualmente se não tiver structured_formatting
        const description = item.description || '';

        // ✅ CORREÇÃO: Se description tem formato "Estrada dos Bandeirantes, 2000, Bairro, Cidade"
        // Sempre combinar primeira e segunda parte para ter rua + número completo
        if (description) {
            const parts = description.split(', ');
            if (parts.length >= 2) {
                // ✅ Combinar primeira e segunda parte para ter rua + número completo
                const topLine = `${parts[0].trim()}, ${parts[1].trim()}`.trim();
                const bottomLine = parts.length > 2 ? parts.slice(2, 4).join(', ').trim() : '';
                Logger.log('✅ [formatAddressForDropdown] Fallback - combinando partes do description:', topLine);
                return {
                    topLine: topLine,
                    bottomLine: bottomLine,
                    hasPlaceName: false
                };
            }
        }

        // Verificar se é um lugar com nome (shopping, restaurante, etc.)
        // Padrão: "Nome do Lugar - Endereço" ou "Nome do Lugar, Endereço"
        const hasPlaceName = description.includes(' - ') || (description.includes(', ') && !/^\d+/.test(description) && !/^(Rua|Avenida|Av\.|R\.)/i.test(description));

        if (hasPlaceName) {
            // Dividir em nome do lugar e endereço
            let placeName, address;

            if (description.includes(' - ')) {
                [placeName, address] = description.split(' - ');
            } else {
                const firstComma = description.indexOf(', ');
                placeName = description.substring(0, firstComma);
                address = description.substring(firstComma + 2);
            }

            // Para lugares com nome (Places):
            // topLine = nome do lugar
            // bottomLine = rua + número + bairro
            const addressParts = address.split(', ');
            let streetAndNumber = addressParts[0] || '';
            let neighborhood = addressParts[1] || '';

            return {
                topLine: placeName.trim(),
                bottomLine: streetAndNumber + (neighborhood ? `, ${neighborhood}` : ''),
                hasPlaceName: true
            };
        } else {
            // É um endereço simples (rua, número) - Geocoding API
            // topLine = rua + número
            // bottomLine = bairro + cidade
            const parts = description.split(', ');

            if (parts.length >= 3) {
                // Rua + número, Bairro, Cidade
                const topLine = parts[0].trim(); // Rua + número
                const bottomLine = parts.slice(1, 3).join(', ').trim(); // Bairro + cidade

                return {
                    topLine: topLine,
                    bottomLine: bottomLine,
                    hasPlaceName: false
                };
            } else if (parts.length >= 2) {
                // Rua + número, Bairro (ou Cidade)
                const topLine = parts[0].trim();
                const bottomLine = parts[1].trim();

                return {
                    topLine: topLine,
                    bottomLine: bottomLine,
                    hasPlaceName: false
                };
            } else {
                // Fallback: usar descrição completa
                return {
                    topLine: description.trim(),
                    bottomLine: '',
                    hasPlaceName: false
                };
            }
        }
    };

    // Função para calcular o valor líquido do motorista - REMOVIDA
    // Esta lógica agora está no DriverUI onde faz sentido

    // Função de teste para verificar se a biblioteca polyline está funcionando
    const testPolylineLibrary = () => {
        Logger.log('🧪 TESTE: Verificando biblioteca polyline...');
        Logger.log('🧪 polyline importado:', polyline);
        Logger.log('🧪 typeof polyline:', typeof polyline);
        Logger.log('🧪 polyline.decode existe?', typeof polyline?.decode);

        try {
            // Teste com uma polyline simples
            const testPolyline = 'gfo}EtohhU';
            const testResult = polyline.decode(testPolyline);
            Logger.log('🧪 TESTE: Decodificação de teste:', testResult);
            return true;
        } catch (error) {
            Logger.error('🧪 TESTE: Erro na decodificação de teste:', error);
            return false;
        }
    };

    // Função para calcular rota básica mesmo sem carros disponíveis
    const calculateBasicRoute = useCallback(() => {
        Logger.log('🗺️ calculateBasicRoute - Calculando rota básica...');

        if (tripdata.pickup?.lat && tripdata.pickup?.lng && tripdata.drop?.lat && tripdata.drop?.lng) {
            // Criar polyline básica entre os dois pontos
            const basicPolyline = [
                { latitude: tripdata.pickup.lat, longitude: tripdata.pickup.lng },
                { latitude: tripdata.drop.lat, longitude: tripdata.drop.lng }
            ];

            Logger.log('✅ Rota básica calculada:', basicPolyline.length, 'pontos');

            // Definir polyline local
            setLocalRoutePolyline(basicPolyline);

            // Enviar para componente pai
            if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                props.setRoutePolyline(basicPolyline);
                Logger.log('✅ Polyline básica enviada para componente pai');
            }

            // Definir estimativas vazias para mostrar card
            setCarEstimates({});

        } else {
            Logger.log('⚠️ Coordenadas insuficientes para calcular rota básica');
        }
    }, [tripdata.pickup, tripdata.drop, props.setRoutePolyline]);

    // ❌ REMOVIDO: Este useEffect estava duplicado e causando loops
    // A lógica já está no useEffect principal acima (linha 150)

    // Função removida - agora integrada no useEffect principal


    const hasValidEstimate = useMemo(() => (
        carEstimates && Object.keys(carEstimates).length > 0 &&
        tripdata.pickup?.add && tripdata.drop?.add
    ), [carEstimates, tripdata.pickup, tripdata.drop]);

    // ✅ Função para criar booking APÓS pagamento confirmado
    // 🔥 CORREÇÃO CRÍTICA: Fire-and-forget - não bloqueia UI
    const createBookingAfterPayment = useCallback(async (paymentData) => {
        try {
            Logger.log('✅ [PASSENGER] Pagamento confirmado, criando reserva (fire-and-forget)...', paymentData);

            if (!selectedCarType) {
                Alert.alert(
                    'Selecione um tipo de veículo',
                    'Por favor, selecione um tipo de veículo antes de continuar.',
                    [{ text: 'OK' }]
                );
                return;
            }

            if (!carEstimates[selectedCarType.name]?.estimateFare) {
                Alert.alert(
                    'Estimativa não disponível',
                    'Não foi possível calcular a estimativa. Por favor, verifique se origem e destino estão corretos e tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            if (!tripdata.pickup?.add || !tripdata.drop?.add) {
                Alert.alert(
                    'Origem e destino necessários',
                    'Por favor, selecione a origem e o destino da sua viagem antes de continuar.',
                    [{ text: 'OK' }]
                );
                return;
            }

            // ✅ Mudar UI imediatamente para "Procurando motorista..."
            isBookingInProgressRef.current = true;
            setBookModelLoading(true);
            setTripStatus('searching'); // UI muda instantaneamente

            const estimate = carEstimates[selectedCarType.name];

            // ✅ Validar coordenadas
            if (!tripdata.pickup?.lat || !tripdata.pickup?.lng) {
                throw new Error('Localização de origem inválida');
            }

            if (!tripdata.drop?.lat || !tripdata.drop?.lng) {
                throw new Error('Localização de destino inválida');
            }

            // Preparar dados da reserva com informações de pagamento
            const bookingData = {
                customerId: auth.uid,
                pickupLocation: {
                    lat: parseFloat(tripdata.pickup.lat),
                    lng: parseFloat(tripdata.pickup.lng),
                    add: tripdata.pickup.add
                },
                destinationLocation: {
                    lat: parseFloat(tripdata.drop.lat),
                    lng: parseFloat(tripdata.drop.lng),
                    add: tripdata.drop.add
                },
                estimatedFare: parseFloat(estimate.estimateFare || 0),
                carType: selectedCarType.name,
                paymentMethod: 'pix',
                paymentStatus: 'confirmed', // ✅ Pagamento já confirmado
                paymentData: {
                    chargeId: paymentData.chargeId,
                    rideId: paymentData.rideId,
                    amount: paymentData.amount,
                    amountInCents: paymentData.amountInCents
                }
            };

            // ✅ FECHAR MODAL DE PAGAMENTO imediatamente
            setPaymentModalVisible(false);

            // ✅ Atualizar Redux com estimativa selecionada
            dispatch(setEstimate({
                grandTotal: estimate.estimateFare,
                distance: estimate.routeDetails?.distance_in_km || 0,
                time: estimate.routeDetails?.time_in_secs || 0
            }));

            // ✅ SALVAR DESTINO CONFIRMADO
            if (tripdata.drop && tripdata.drop.add) {
                saveConfirmedDestination(tripdata.drop);
            }

            // 🔥 FIRE-AND-FORGET: Conectar/autenticar em background (não bloqueia)
            const webSocketManager = WebSocketManager.getInstance();

            // Conectar em background (não await)
            const ensureConnection = async () => {
                try {
                    const status = webSocketManager.getConnectionStatus();

                    if (!status.connected) {
                        Logger.log('🔄 [PASSENGER] Conectando WebSocket em background...');
                        webSocketManager.connect().catch(err => {
                            Logger.error('❌ [PASSENGER] Erro ao conectar:', err);
                            // Erro será tratado pelo handler de erro
                        });
                    }

                    // Autenticar em background (não await)
                    if (status.connected && !status.authenticated) {
                        Logger.log('🔄 [PASSENGER] Autenticando em background...');
                        webSocketManager.authenticate(auth.uid, 'customer');
                    }
                } catch (error) {
                    Logger.error('❌ [PASSENGER] Erro ao garantir conexão:', error);
                }
            };

            // Executar em background
            ensureConnection();

            // ✅ NOVO: Validar conexão antes de criar booking
            const ConnectionValidator = require('../../utils/ConnectionValidator').default;
            const connectionValidation = await ConnectionValidator.validateBeforeCreateBooking();

            if (!connectionValidation.valid) {
                // Conexão não disponível - reverter estado
                isBookingInProgressRef.current = false;
                setBookModelLoading(false);
                setTripStatus('idle');
                return;
            }

            // 🔥 FIRE-AND-FORGET: Enviar booking imediatamente (não await)
            // O evento 'bookingCreated' tratará a resposta
            const sendBooking = async () => {
                try {
                    // Aguardar conexão estar pronta (com timeout)
                    let attempts = 0;
                    const maxAttempts = 30; // 3 segundos máximo

                    while (attempts < maxAttempts) {
                        const status = webSocketManager.getConnectionStatus();
                        if (status.connected && status.authenticated) {
                            Logger.log('📤 [PASSENGER] Enviando booking (fire-and-forget)...');
                            // ✅ Fire-and-forget: não await, apenas emite
                            // O handler handleBookingCreated tratará a resposta
                            webSocketManager.createBooking(bookingData).catch(err => {
                                Logger.error('❌ [PASSENGER] Erro ao enviar booking:', err);
                                // Tratar erro: resetar estado
                                setTripStatus('idle');
                                setBookModelLoading(false);
                                isBookingInProgressRef.current = false;
                                Alert.alert(
                                    'Não foi possível criar a reserva',
                                    'Por favor, verifique sua conexão e tente novamente. Se o problema persistir, entre em contato com o suporte.',
                                    [{ text: 'OK' }]
                                );
                            });
                            // ✅ Não await - fire-and-forget
                            return; // Sucesso, sair do loop
                        }

                        // Aguardar 100ms antes de tentar novamente
                        await new Promise(resolve => setTimeout(resolve, 100));
                        attempts++;
                    }

                    // Timeout - não conseguiu conectar
                    Logger.error('❌ [PASSENGER] Timeout ao aguardar conexão');
                    setTripStatus('idle');
                    setBookModelLoading(false);
                    isBookingInProgressRef.current = false;
                    Alert.alert(
                        'Erro de Conexão',
                        'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.',
                        [{ text: 'OK' }]
                    );
                } catch (error) {
                    Logger.error('❌ [PASSENGER] Erro ao enviar booking:', error);
                    setTripStatus('idle');
                    setBookModelLoading(false);
                    isBookingInProgressRef.current = false;
                    Alert.alert(
                        'Erro ao Criar Reserva',
                        error.message || 'Falha ao criar reserva. Tente novamente.',
                        [{ text: 'OK' }]
                    );
                }
            };

            // Executar em background (não bloqueia UI)
            sendBooking();

            Logger.log('⏳ [PASSENGER] Booking enviado (fire-and-forget). Aguardando resposta via evento...');

        } catch (error) {
            Logger.error('❌ Erro ao criar reserva após pagamento:', error);

            // ✅ Garantir que o estado volte para 'idle' em caso de erro
            setTripStatus('idle');
            setBookModelLoading(false);
            isBookingInProgressRef.current = false;

            Alert.alert(
                'Erro ao Criar Reserva',
                error.message || 'Falha ao criar reserva após pagamento. Entre em contato com o suporte.',
                [{ text: 'OK' }]
            );
        }
    }, [selectedCarType, carEstimates, tripdata, auth.uid, dispatch]);

    // ✅ Callback quando pagamento é confirmado
    const onPaymentConfirmed = useCallback((paymentData) => {
        Logger.log('✅ [PASSENGER] Pagamento confirmado, iniciando criação de reserva...', paymentData);

        // Criar reserva após pagamento confirmado
        createBookingAfterPayment(paymentData);
    }, [createBookingAfterPayment]);

    // ✅ NOVO FLUXO: Abrir modal de pagamento ao invés de criar booking diretamente
    // O booking só será criado APÓS confirmação do pagamento
    const initiateBooking = () => {
        // ✅ Prevenir duplo clique
        if (isBookingInProgressRef.current) {
            Logger.log('⏸️ Reserva já em andamento, ignorando clique duplo');
            return;
        }

        if (!selectedCarType) {
            Alert.alert(
                'Selecione um tipo de veículo',
                'Por favor, selecione um tipo de veículo antes de solicitar a corrida.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (!carEstimates[selectedCarType.name]?.estimateFare) {
            Alert.alert(
                'Estimativa não disponível',
                'Não foi possível calcular a estimativa para este tipo de veículo. Por favor, tente novamente ou selecione outro tipo.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (!tripdata.pickup?.add || !tripdata.drop?.add) {
            Alert.alert(
                'Origem e destino necessários',
                'Por favor, selecione a origem e o destino da sua viagem antes de continuar.',
                [{ text: 'OK' }]
            );
            return;
        }

        // ✅ VALIDAÇÃO: Verificar se está autenticado antes de abrir modal
        const webSocketManager = WebSocketManager.getInstance();
        const connectionStatus = webSocketManager.getConnectionStatus();

        if (!connectionStatus.connected) {
            Alert.alert(
                'Conectando ao servidor',
                'Aguarde alguns instantes enquanto conectamos ao servidor. Tente novamente em breve.',
                [{ text: 'OK' }]
            );
            return;
        }

        // ✅ NOVO FLUXO: Abrir modal de pagamento (booking será criado APÓS pagamento confirmado)
        Logger.log('💳 [PASSENGER] Abrindo modal de pagamento antes de criar reserva...');
        setPaymentModalVisible(true);
    };

    // ✅ Calcular taxa de cancelamento baseado nas regras
    const calculateCancellationFee = useCallback(() => {
        if (!driverAcceptedAt || !currentBooking) {
            return { feeAmount: 0, hasFee: false, message: 'Sem taxa de cancelamento' };
        }

        const now = Date.now();
        const elapsedSeconds = (now - driverAcceptedAt) / 1000;
        const elapsedMinutes = elapsedSeconds / 60;

        // Regra: Até 2 minutos após driver aceitar = SEM TAXA
        if (elapsedMinutes <= 2) {
            return { feeAmount: 0, hasFee: false, message: 'Sem taxa de cancelamento' };
        }

        // Após 2 minutos: Calcular taxa baseada em distância + tempo percorrido
        // Por enquanto, usar uma taxa fixa simplificada (R$ 0,80 + valor baseado no tempo)
        // Cálculo de estimativa baseado em distância e tarifas do veículo
        const baseFee = 0.80;
        const timeFee = Math.max(0, (elapsedMinutes - 2) * 0.10); // R$ 0,10 por minuto após 2min
        const feeAmount = baseFee + timeFee;

        return {
            feeAmount: Math.round(feeAmount * 100) / 100,
            hasFee: true,
            message: `Taxa de cancelamento: R$ ${feeAmount.toFixed(2)}`
        };
    }, [driverAcceptedAt, currentBooking]);

    // ✅ Função para calcular taxa de cancelamento durante busca
    const calculateCancellationFeeDuringSearch = useCallback(() => {
        // Por enquanto, durante a busca não há taxa de cancelamento
        // Mas a estrutura está pronta para quando implementarmos
        return {
            feeAmount: 0,
            hasFee: false
        };
    }, []);

    // ✅ Função para cancelar busca (usada no timeout máximo)
    const handleCancelSearch = useCallback(() => {
        // Limpar timeout máximo
        if (maxSearchTimeoutRef.current) {
            maxSearchTimeoutRef.current = false;
        }

        // Se estiver em searching, chamar confirmCancelBooking
        if (tripStatus === 'searching') {
            confirmCancelBooking();
        } else {
            // Se não estiver em searching, apenas resetar estado
            setTripStatus('idle');
            setBookModelLoading(false);
            isBookingInProgressRef.current = false;
        }
    }, [tripStatus]);

    // ✅ Função para confirmar cancelamento (chamada quando usuário clica em "Sim, cancelar")
    const confirmCancelBooking = useCallback(async () => {
        setIsCancelModalVisible(false);

        // Calcular taxa de cancelamento
        const cancellationFee = calculateCancellationFeeDuringSearch();
        // Buscar valor pago (pode estar em diferentes campos dependendo do status do pagamento)
        const totalPaid = parseFloat(
            currentBooking?.customer_paid ||
            currentBooking?.totalAmount ||
            currentBooking?.finalPrice ||
            currentBooking?.estimate ||
            tripdata?.estimate ||
            0
        );
        const refundAmount = Math.max(0, totalPaid - cancellationFee.feeAmount);

        // ✅ Calcular e registrar tempo de busca ANTES de limpar o timestamp
        let searchTimeSeconds = 0;
        if (searchingStartTimeRef.current) {
            searchTimeSeconds = Math.floor((Date.now() - searchingStartTimeRef.current) / 1000);
            Logger.log(`⏱️ [PASSENGER] Tempo de busca (cancelado): ${searchTimeSeconds} segundos (${(searchTimeSeconds / 60).toFixed(2)} minutos)`);
        }

        // ✅ Registrar tempo de busca no banco (marcado como "cancelled")
        if (currentBooking?.bookingId && searchTimeSeconds > 0) {
            const metadata = {
                passengerId: auth.uid,
                pickupLocation: tripdata.pickup ? {
                    lat: tripdata.pickup.lat,
                    lng: tripdata.pickup.lng,
                    address: tripdata.pickup.add
                } : null,
                destinationLocation: tripdata.drop ? {
                    lat: tripdata.drop.lat,
                    lng: tripdata.drop.lng,
                    address: tripdata.drop.add
                } : null,
                carType: currentBooking.carType || tripdata.carType,
                estimatedFare: currentBooking.estimate || tripdata.estimate,
                result: 'cancelled' // Marcar como cancelado pelo usuário
            };

            TripDataService.recordDriverSearchTime(currentBooking.bookingId, searchTimeSeconds, metadata)
                .catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao registrar tempo de busca (cancelado):', err);
                });
        }

        // ✅ Parar todos os timers imediatamente
        if (searchingTimeIntervalRef.current) {
            clearTimeout(searchingTimeIntervalRef.current);
            searchingTimeIntervalRef.current = null;
        }
        searchingStartTimeRef.current = null;
        if (driverPolylineUpdateIntervalRef.current) {
            clearInterval(driverPolylineUpdateIntervalRef.current);
            driverPolylineUpdateIntervalRef.current = null;
        }
        loadingRotation.stopAnimation();
        setSearchingTime(0);

        // ✅ Limpar polyline do mapa PRIMEIRO (antes de mudar estados)
        setLocalRoutePolyline([]);
        setDriverToPickupPolyline([]);
        if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
            props.setRoutePolyline([]);
        }

        // ✅ Limpar campo de destino ANTES de mudar o status
        dispatch(updateTripDrop(null));

        // ✅ Limpar estados imediatamente (não bloquear)
        setTripStatus('idle');
        setCurrentBooking(null);
        setDriverInfo(null);
        setDriverLocation(null);
        setDriverArrived(false);
        setEstimatedPickupTime(null);
        setDriverAcceptedAt(null);
        setMessageText('');

        // ✅ Atualizar campo de partida com a localização atual
        if (currentLocation && pickupAddress) {
            dispatch(updateTripPickup({
                add: pickupAddress,
                lat: currentLocation.lat,
                lng: currentLocation.lng
            }));
        } else if (currentLocation) {
            dispatch(updateTripPickup({
                add: `Localização (${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)})`,
                lat: currentLocation.lat,
                lng: currentLocation.lng
            }));
        }

        // ✅ Tentar cancelar no servidor de forma não-bloqueante
        if (currentBooking?.bookingId) {
            const webSocketManager = WebSocketManager.getInstance();
            if (webSocketManager.isConnected()) {
                webSocketManager.cancelRide(
                    currentBooking.bookingId,
                    'Cancelado pelo passageiro (durante busca)',
                    cancellationFee.feeAmount
                ).catch(error => {
                    if (!error.message.includes('timeout')) {
                        Logger.warn('⚠️ Erro ao cancelar no servidor (não crítico):', error.message);
                    }
                });
            } else {
                try {
                    await webSocketManager.connect();
                    webSocketManager.cancelRide(
                        currentBooking.bookingId,
                        'Cancelado pelo passageiro (durante busca)',
                        cancellationFee.feeAmount
                    ).catch(() => { });
                } catch (error) {
                    Logger.warn('⚠️ Não foi possível conectar para cancelar (não crítico)');
                }
            }
        }

        // ✅ Recentralizar mapa na localização atual do usuário
        if (mapRef?.current && currentLocation) {
            setTimeout(() => {
                mapRef.current?.animateToRegion({
                    latitude: currentLocation.lat,
                    longitude: currentLocation.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }, 1000);
            }, 300);
        }

        // ✅ Mostrar mensagem de reembolso
        Alert.alert(
            'Busca cancelada',
            `O valor de R$ ${refundAmount.toFixed(2).replace('.', ',')} será devolvido para sua conta em breve.`,
            [{ text: 'OK' }]
        );
    }, [currentBooking, tripdata, auth.uid, currentLocation, pickupAddress, calculateCancellationFeeDuringSearch, dispatch, props]);

    // ✅ Função para cancelar corrida (com cálculo de taxa)
    const handleCancelBooking = async () => {
        // ✅ Se estiver em 'searching', mostrar modal de confirmação
        if (tripStatus === 'searching') {
            setIsCancelModalVisible(true);
            return;
        }

        if (!currentBooking?.bookingId && tripStatus !== 'accepted' && tripStatus !== 'started') {
            Alert.alert(
                'Nenhuma corrida em andamento',
                'Não há corrida em andamento para cancelar no momento.',
                [{ text: 'OK' }]
            );
            return;
        }

        // Calcular taxa de cancelamento (só se motorista já aceitou)
        const feeInfo = calculateCancellationFee();
        const feeMessage = feeInfo.hasFee
            ? `\n\n⚠️ Você pode ser cobrado uma taxa de R$ ${feeInfo.feeAmount.toFixed(2)} pelo deslocamento do motorista.`
            : '\n\n✅ Sem taxa de cancelamento.';

        Alert.alert(
            'Cancelar Corrida',
            `Tem certeza que deseja cancelar esta corrida?${feeMessage}`,
            [
                { text: 'Não', style: 'cancel' },
                {
                    text: 'Sim, cancelar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            // ✅ Parar todos os timers
                            if (searchingTimeIntervalRef.current) {
                                clearTimeout(searchingTimeIntervalRef.current);
                                searchingTimeIntervalRef.current = null;
                            }
                            searchingStartTimeRef.current = null;
                            if (embarkTimerIntervalRef.current) {
                                clearInterval(embarkTimerIntervalRef.current);
                                embarkTimerIntervalRef.current = null;
                            }
                            if (driverPolylineUpdateIntervalRef.current) {
                                clearInterval(driverPolylineUpdateIntervalRef.current);
                                driverPolylineUpdateIntervalRef.current = null;
                            }
                            loadingRotation.stopAnimation();
                            setSearchingTime(0);
                            setEmbarkTimer(120);

                            const webSocketManager = WebSocketManager.getInstance();
                            if (!webSocketManager.isConnected()) {
                                await webSocketManager.connect();
                            }

                            // ✅ Enviar cancelamento com informação de taxa
                            const result = await webSocketManager.cancelRide(
                                currentBooking.bookingId,
                                'Cancelado pelo passageiro',
                                feeInfo.hasFee ? feeInfo.feeAmount : 0
                            );

                            if (result.success) {
                                // ✅ Limpar todos os estados
                                setTripStatus('idle');
                                setCurrentBooking(null);
                                setDriverInfo(null);
                                setDriverLocation(null);
                                setDriverArrived(false);
                                setEstimatedPickupTime(null);
                                setDriverAcceptedAt(null);
                                setEmbarkTimer(120);
                                setMessageText(''); // ✅ Limpar campo de mensagem ao cancelar

                                // ✅ Limpar polyline do mapa (rota principal e rota do motorista)
                                setLocalRoutePolyline([]);
                                setDriverToPickupPolyline([]);
                                if (props.setRoutePolyline && typeof props.setRoutePolyline === 'function') {
                                    props.setRoutePolyline([]);
                                }

                                // ✅ Atualizar campo de partida com a localização atual
                                if (currentLocation && pickupAddress) {
                                    dispatch(updateTripPickup({
                                        add: pickupAddress,
                                        lat: currentLocation.lat,
                                        lng: currentLocation.lng
                                    }));
                                } else if (currentLocation) {
                                    // Se não tiver endereço, usar coordenadas
                                    dispatch(updateTripPickup({
                                        add: `Localização (${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)})`,
                                        lat: currentLocation.lat,
                                        lng: currentLocation.lng
                                    }));
                                }

                                // ✅ Limpar campo de destino
                                dispatch(updateTripDrop(null));

                                // ✅ Recentralizar mapa na localização atual do usuário
                                if (mapRef?.current && currentLocation) {
                                    setTimeout(() => {
                                        mapRef.current?.animateToRegion({
                                            latitude: currentLocation.lat,
                                            longitude: currentLocation.lng,
                                            latitudeDelta: 0.01,
                                            longitudeDelta: 0.01,
                                        }, 1000);
                                        Logger.log('🗺️ [PassengerUI] Mapa recentralizado após cancelamento');
                                    }, 300); // Pequeno delay para garantir que o estado foi atualizado
                                }

                                // ✅ Se havia taxa, buscar novo motorista instantaneamente
                                if (feeInfo.hasFee) {
                                    Alert.alert(
                                        'Corrida Cancelada',
                                        `Taxa de R$ ${feeInfo.feeAmount.toFixed(2)} será cobrada. Buscando novo motorista...`,
                                        [{ text: 'OK' }]
                                    );
                                    // Busca automática de novo motorista será iniciada automaticamente
                                } else {
                                    Alert.alert('Sucesso', 'Corrida cancelada com sucesso');
                                }
                            } else {
                                throw new Error(result.error || 'Falha ao cancelar corrida');
                            }
                        } catch (error) {
                            Logger.error('❌ Erro ao cancelar corrida:', error);
                            Alert.alert(
                                'Não foi possível cancelar a corrida',
                                'Por favor, verifique sua conexão e tente novamente. Se o problema persistir, entre em contato com o suporte.',
                                [{ text: 'OK' }]
                            );
                        }
                    }
                }
            ]
        );
    };

    // ✅ Função para enviar mensagem ao motorista (apenas durante corrida ativa) - ATUALIZADO PARA WEBSOCKET
    const handleSendMessage = useCallback(async () => {
        // ✅ Verificar se está em uma fase válida da corrida (accepted ou started)
        if (tripStatus !== 'accepted' && tripStatus !== 'started') {
            Alert.alert(
                'Chat não disponível',
                'O chat está disponível apenas durante uma corrida em andamento.',
                [{ text: 'OK' }]
            );
            return;
        }

        if (!messageText.trim() || !currentBooking?.bookingId || !driverInfo?.id) {
            Alert.alert(
                'Mensagem vazia',
                'Por favor, digite uma mensagem antes de enviar.',
                [{ text: 'OK' }]
            );
            return;
        }

        try {
            const webSocketManager = WebSocketManager.getInstance();

            if (!webSocketManager.isConnected()) {
                Alert.alert(
                    'Não conectado ao servidor',
                    'Por favor, verifique sua conexão com a internet e tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            // ✅ Enviar mensagem via WebSocket
            webSocketManager.emitToServer('sendMessage', {
                bookingId: currentBooking.bookingId,
                message: messageText.trim(),
                senderId: auth.uid,
                receiverId: driverInfo.id,
                senderType: 'passenger'
            });

            // ✅ Adicionar mensagem localmente imediatamente (otimista)
            const newMessage = {
                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                text: messageText.trim(),
                senderId: auth.uid,
                senderType: 'passenger',
                timestamp: new Date().toISOString(),
                isOwn: true
            };

            setChatMessages(prev => [...prev, newMessage]);

            // ✅ Salvar mensagem no TripDataService
            if (currentBooking?.bookingId) {
                TripDataService.addChatMessage(currentBooking.bookingId, {
                    senderId: auth.uid,
                    senderType: 'passenger',
                    message: messageText.trim(),
                    timestamp: newMessage.timestamp
                }).catch(err => {
                    Logger.warn('⚠️ [PassengerUI] Erro ao salvar mensagem:', err);
                });
            }

            // ✅ Limpar campo após envio
            setMessageText('');

            Logger.log('✅ Mensagem enviada ao motorista via WebSocket e salva no banco para auditoria');
        } catch (error) {
            Logger.error('❌ Erro ao enviar mensagem:', error);
            Alert.alert(
                'Não foi possível enviar a mensagem',
                'Por favor, verifique sua conexão e tente novamente.',
                [{ text: 'OK' }]
            );
        }
    }, [messageText, currentBooking, driverInfo, auth, tripStatus]);

    // ✅ Calcular pagamento parcial ao motorista (metade do valor percorrido - taxas)
    const calculatePartialDriverPayment = useCallback(async () => {
        if (!currentBooking?.bookingId) {
            return 0;
        }

        try {
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            const result = await webSocketManager.calculatePartialPayment(currentBooking.bookingId);
            return parseFloat(result.driverPayment || 0);
        } catch (error) {
            Logger.error('Erro ao calcular pagamento parcial:', error);
            // Fallback: cálculo local usando taxas padronizadas
            const currentFare = carEstimates[selectedCarType?.name]?.estimateFare || 0;
            const partialValue = currentFare / 2;

            // Taxa operacional baseada no valor (3 faixas)
            let operationalFee;
            if (partialValue <= 10.00) {
                operationalFee = 0.79; // Até R$ 10,00
            } else if (partialValue <= 25.00) {
                operationalFee = 0.99; // Acima de R$ 10,00 e abaixo de R$ 25,00
            } else {
                operationalFee = 1.49; // Acima de R$ 25,00
            }

            // Taxa Woovi: 0,8% com mínimo de R$ 0,50
            const wooviFee = Math.max(partialValue * 0.008, 0.50);

            return Math.max(0, partialValue - operationalFee - wooviFee);
        }
    }, [currentBooking, carEstimates, selectedCarType]);

    // ✅ Função quando passageiro escolhe não procurar novo motorista
    const handleNoNewDriver = useCallback(async (problemType) => {
        try {
            if (!currentBooking?.bookingId) {
                Alert.alert(
                    'Corrida não encontrada',
                    'Não foi possível encontrar informações sobre esta corrida. Por favor, tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            // Reportar problema
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            await webSocketManager.reportProblem(
                currentBooking.bookingId,
                problemType,
                `Problema reportado: ${problemType}`
            );

            // Calcular pagamento parcial
            const partialPayment = await calculatePartialDriverPayment();

            Alert.alert(
                'Problema Registrado',
                `O motorista receberá uma taxa de R$ ${partialPayment.toFixed(2)} correspondente à metade do valor percorrido.`,
                [{ text: 'OK' }]
            );
        } catch (error) {
            Logger.error('Erro ao processar problema:', error);
            Alert.alert(
                'Não foi possível processar',
                'Por favor, verifique sua conexão e tente novamente. Se o problema persistir, entre em contato com o suporte.',
                [{ text: 'OK' }]
            );
        }
    }, [calculatePartialDriverPayment, currentBooking]);

    // ✅ Função quando passageiro escolhe procurar novo motorista
    const handleFindNewDriver = useCallback(async (problemType) => {
        try {
            if (!currentBooking?.bookingId) {
                Alert.alert(
                    'Corrida não encontrada',
                    'Não foi possível encontrar informações sobre esta corrida. Por favor, tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            // Calcular pagamento parcial
            const partialPayment = await calculatePartialDriverPayment();

            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            // Reportar problema
            await webSocketManager.reportProblem(
                currentBooking.bookingId,
                problemType,
                `Problema reportado: ${problemType}`
            );

            // Procurar novo motorista
            await webSocketManager.findNewDriver(
                currentBooking.bookingId,
                problemType,
                partialPayment
            );

            Alert.alert(
                'Buscando Novo Motorista',
                `O motorista anterior receberá R$ ${partialPayment.toFixed(2)}. Buscando novo motorista...`,
                [{ text: 'OK' }]
            );

            // Resetar estado para nova busca
            setTripStatus('searching');
            setDriverInfo(null);
            setDriverArrived(false);
        } catch (error) {
            Logger.error('Erro ao procurar novo motorista:', error);
            Alert.alert(
                'Não foi possível procurar um novo motorista',
                'Por favor, verifique sua conexão e tente novamente.',
                [{ text: 'OK' }]
            );
        }
    }, [calculatePartialDriverPayment, currentBooking]);

    // ✅ Função para lidar com a opção de problema selecionada
    const handleProblemOption = useCallback(async (problemType) => {
        const isSafetyIssue = problemType === 'unsafe' || problemType === 'danger';

        if (isSafetyIssue) {
            // Para problemas de segurança, sugerir chamar a polícia
            Alert.alert(
                'Situação de Segurança',
                'Recomendamos ligar para a polícia imediatamente.\n\nDeseja ligar para 190?',
                [
                    { text: 'Não', style: 'cancel' },
                    {
                        text: 'Sim, ligar para 190',
                        onPress: () => {
                            Linking.openURL('tel:190');
                        }
                    }
                ]
            );
        } else {
            // Para acidente ou defeito, oferecer opção de procurar novo motorista
            Alert.alert(
                'Procurar Novo Motorista?',
                'Deseja procurar um novo motorista? O motorista atual receberá uma taxa correspondente à metade do valor já percorrido.',
                [
                    { text: 'Não', style: 'cancel', onPress: () => handleNoNewDriver(problemType) },
                    {
                        text: 'Sim, procurar novo motorista',
                        onPress: () => handleFindNewDriver(problemType)
                    }
                ]
            );
        }
    }, [handleNoNewDriver, handleFindNewDriver]);

    // ✅ Função para reportar problema durante corrida em andamento
    const handleReportProblem = useCallback(() => {
        Alert.alert(
            'Reportar Problema',
            'Selecione o tipo de problema:',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Me envolvi em um acidente',
                    onPress: () => handleProblemOption('accident')
                },
                {
                    text: 'Veículo apresentou defeito',
                    onPress: () => handleProblemOption('vehicle_defect')
                },
                {
                    text: 'Me sinto inseguro(a)',
                    onPress: () => handleProblemOption('unsafe')
                },
                {
                    text: 'Estou em perigo',
                    onPress: () => handleProblemOption('danger')
                }
            ]
        );
    }, [handleProblemOption]);

    // ✅ Estado para rastrear se estamos alterando destino durante corrida
    const [isChangingDestination, setIsChangingDestination] = useState(false);

    // ✅ Função para alterar destino durante corrida
    const handleChangeDestination = useCallback(async () => {
        Alert.alert(
            'Alterar Destino',
            'Deseja alterar o destino da corrida? A corrida será recalculada do local atual até o novo destino.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Sim, alterar',
                    onPress: async () => {
                        try {
                            // Marcar que estamos alterando destino
                            setIsChangingDestination(true);

                            // Abrir busca de endereço para novo destino
                            setSearchState({
                                visible: true,
                                type: 'drop',
                                inputText: '',
                                results: [],
                                loading: false
                            });
                        } catch (error) {
                            Logger.error('Erro ao alterar destino:', error);
                            Alert.alert('Erro', 'Não foi possível alterar o destino');
                            setIsChangingDestination(false);
                        }
                    }
                }
            ]
        );
    }, []);

    // ✅ Função para recalcular corrida com novo destino
    const recalculateRideWithNewDestination = useCallback(async (newDestination) => {
        try {
            if (!currentBooking?.bookingId) {
                Alert.alert(
                    'Corrida não encontrada',
                    'Não foi possível encontrar informações sobre esta corrida. Por favor, tente novamente.',
                    [{ text: 'OK' }]
                );
                return;
            }

            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            // Chamar endpoint do backend para alterar destino
            const result = await webSocketManager.changeDestination(
                currentBooking.bookingId,
                newDestination
            );

            const fareDifference = parseFloat(result.fareDifference || 0);

            if (result.requiresPayment && fareDifference > 0) {
                // Valor maior: mostrar modal de pagamento da diferença
                Alert.alert(
                    'Pagamento Adicional Necessário',
                    `O novo destino aumenta o valor da corrida em R$ ${fareDifference.toFixed(2)}.\n\nDeseja continuar?`,
                    [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                            text: 'Pagar diferença',
                            onPress: async () => {
                                // Pagamento da diferença será processado automaticamente via Woovi
                                // await processAdditionalPayment(fareDifference);

                                // Atualizar destino no Redux
                                dispatch(updateTripDrop(newDestination));

                                Alert.alert('Sucesso', 'Destino alterado com sucesso!');
                            }
                        }
                    ]
                );
            } else if (result.requiresRefund && fareDifference < 0) {
                // Valor menor: reembolso ao final
                Alert.alert(
                    'Destino Alterado',
                    `O novo destino reduz o valor da corrida em R$ ${Math.abs(fareDifference).toFixed(2)}.\n\nVocê receberá um reembolso de R$ ${Math.abs(fareDifference).toFixed(2)} ao final da corrida.`,
                    [
                        {
                            text: 'OK',
                            onPress: async () => {
                                // Atualizar destino no Redux
                                dispatch(updateTripDrop(newDestination));

                                Alert.alert('Sucesso', 'Destino alterado com sucesso!');
                            }
                        }
                    ]
                );
            } else {
                // Mesmo valor ou sem diferença significativa
                dispatch(updateTripDrop(newDestination));
                Alert.alert('Sucesso', 'Destino alterado com sucesso!');
            }
        } catch (error) {
            Logger.error('Erro ao recalcular corrida:', error);
            Alert.alert('Erro', error.message || 'Não foi possível recalcular a corrida');
        }
    }, [currentBooking, dispatch]);

    const handleSelectAddress = useCallback(async (address, type) => {
        // ✅ FECHAR dropdown imediatamente ao selecionar
        setSearchState({ visible: false, type: type || 'pickup', inputText: '', results: [], loading: false });
        try {
            let coords;

            // ✅ Se o endereço tem coordenadas (destino confirmado ou cache)
            if (address.location && address.location.lat && address.location.lng) {
                coords = {
                    lat: address.location.lat,
                    lng: address.location.lng
                };
                Logger.log('✅ Usando coordenadas do destino confirmado/cache:', coords);
            } else if ((address.source === 'redis_cache' || address.source === 'firebase_cache') && address.location) {
                coords = {
                    lat: address.location.lat,
                    lng: address.location.lng
                };
                Logger.log(`✅ Usando coordenadas do cache (${address.source}):`, coords);
            } else if (address.place_id) {
                // Fallback para Google Places (mais caro, mas necessário)
                coords = await fetchCoordsfromPlace(address.place_id);
                Logger.log('🔄 Usando coordenadas do Google Places:', coords);
            } else {
                throw new Error('Coordenadas não disponíveis');
            }

            if (coords) {
                // ✅ Formatar endereço simplificado (apenas rua+número ou nome do local)
                const simplifiedAddress = formatAddressSimplified(address);
                Logger.log('📍 Endereço simplificado:', simplifiedAddress);

                const newAddress = {
                    lat: coords.lat,
                    lng: coords.lng,
                    add: simplifiedAddress, // ✅ Usar endereço simplificado
                    placeName: simplifiedAddress,
                    placeId: address.place_id,
                    source: address.source || 'search'
                };

                if (type === 'pickup') {
                    // ✅ Marcar que pickup foi selecionado manualmente (não deve ser sobrescrito pelo GPS)
                    setPickupManuallySelected(true);

                    // ✅ Notificar NewMapScreen para desabilitar showsUserLocation
                    if (onPickupManuallySelectedChange) {
                        onPickupManuallySelectedChange(true);
                    }

                    // ✅ Atualizar Redux com endereço de partida
                    dispatch(updateTripPickup(newAddress));

                    // ✅ Atualizar manualPickupText com endereço simplificado
                    setManualPickupText(simplifiedAddress);
                    setIsManuallyEditingPickup(false); // ✅ Marcar como não editando manualmente

                    // ✅ Mover marcador azul (localização do usuário) para nova coordenada
                    if (mapRef?.current && coords.lat && coords.lng) {
                        Logger.log('📍 Movendo marcador azul para nova coordenada:', coords);
                        mapRef.current.animateToRegion({
                            latitude: coords.lat,
                            longitude: coords.lng,
                            latitudeDelta: 0.01,
                            longitudeDelta: 0.01,
                        }, 1000);
                    }

                    // ✅ Limpar lastCalculationRef para forçar recálculo da rota
                    lastCalculationRef.current = { pickup: null, drop: null };
                } else {
                    dispatch(updateTripDrop(newAddress));
                    // ✅ Limpar lastCalculationRef para forçar recálculo da rota
                    lastCalculationRef.current = { pickup: null, drop: null };

                    // ✅ Se estamos alterando destino durante corrida, recalcular
                    if (isChangingDestination && tripStatus === 'started') {
                        setIsChangingDestination(false);
                        await recalculateRideWithNewDestination(newAddress);
                    }
                }

                // ✅ Salvar no histórico apenas se não for do cache (já está salvo)
                if (!address.source || !address.source.includes('cache')) {
                    saveToHistory(address);
                }

                Logger.log('✅ Endereço selecionado e salvo:', {
                    type: type,
                    address: simplifiedAddress,
                    coords: coords
                });
            }
        } catch (error) {
            Logger.error('❌ Erro ao selecionar endereço:', error);
            // ✅ Não mostrar alerta - apenas logar o erro para não interromper o fluxo
            Logger.warn('⚠️ [PassengerUI] Erro ao processar endereço selecionado');
        }
    }, [dispatch, formatAddressSimplified, mapRef, saveToHistory, isChangingDestination, tripStatus, recalculateRideWithNewDestination]);

    const saveToHistory = async (address) => {
        try {
            const newHistory = [address, ...addressHistory.filter(a => a.place_id !== address.place_id)].slice(0, 5);
            setAddressHistory(newHistory);
            await AsyncStorage.setItem('addressHistory', JSON.stringify(newHistory));
        } catch (error) {
            Logger.error('Error saving to history:', error);
        }
    };

    // ✅ Salvar destino confirmado (quando usuário clica para buscar corrida)
    const saveConfirmedDestination = async (dropAddress) => {
        try {
            const destinationData = {
                add: dropAddress.add,
                lat: dropAddress.lat,
                lng: dropAddress.lng,
                placeName: dropAddress.placeName || dropAddress.add,
                placeId: dropAddress.placeId,
                confirmedAt: new Date().toISOString()
            };

            // Carregar destinos existentes
            const stored = await AsyncStorage.getItem('confirmedDestinations');
            let destinations = stored ? JSON.parse(stored) : [];

            // Remover duplicados (comparar por endereço normalizado)
            const normalizedAdd = dropAddress.add?.toLowerCase().trim();
            destinations = destinations.filter(d => d.add?.toLowerCase().trim() !== normalizedAdd);

            // Adicionar novo destino no início e manter apenas os 3 últimos
            destinations = [destinationData, ...destinations].slice(0, 3);

            setConfirmedDestinations(destinations);
            await AsyncStorage.setItem('confirmedDestinations', JSON.stringify(destinations));
            Logger.log('✅ [Destinos] Destino confirmado salvo:', destinationData.add);
        } catch (error) {
            Logger.error('❌ Erro ao salvar destino confirmado:', error);
        }
    };

    // ✅ Carregar últimos destinos confirmados
    useEffect(() => {
        const loadConfirmedDestinations = async () => {
            try {
                const stored = await AsyncStorage.getItem('confirmedDestinations');
                if (stored) {
                    const destinations = JSON.parse(stored);
                    setConfirmedDestinations(destinations);
                    Logger.log('✅ [Destinos] Últimos destinos carregados:', destinations.length);
                }
            } catch (error) {
                Logger.error('❌ Erro ao carregar destinos confirmados:', error);
            }
        };
        loadConfirmedDestinations();
    }, []);

    // Função removida - duplicada

    useEffect(() => {
        const loadHistory = async () => {
            const history = await AsyncStorage.getItem('addressHistory');
            if (history) setAddressHistory(JSON.parse(history));
        };
        loadHistory();

        // Cleanup do timer quando componente for desmontado
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    // Função para formatar endereço para exibição (destacar rua e número)
    const formatAddressForDisplay = (address) => {
        if (!address) return '';

        // Limpar vírgulas extras no início
        let cleanAddress = address.replace(/^[,.\s]+/, '').trim();

        // Verificar se é um lugar com nome (shopping, restaurante, etc.)
        // Padrão: "Nome do Lugar - Endereço" ou "Nome do Lugar, Endereço"
        const hasPlaceName = cleanAddress.includes(' - ') || cleanAddress.includes(', ');

        if (hasPlaceName) {
            // Dividir em nome do lugar e endereço
            let placeName, addressPart;

            if (cleanAddress.includes(' - ')) {
                [placeName, addressPart] = cleanAddress.split(' - ');
            } else {
                [placeName, addressPart] = cleanAddress.split(', ');
            }

            // Para lugares com nome, retornar o NOME DO LUGAR na linha superior
            return placeName.trim();
        } else {
            // É um endereço simples (rua, número)
            // Tentar extrair rua e número do endereço formatado
            // Padrão: "Rua das Pastorinhas N*195 TAQUARA - Jacarepaguá, Rio de Janeiro - RJ"
            const streetNumberMatch = cleanAddress.match(/^([^0-9]+?)\s*([0-9]+(?:\*[0-9]+)?)\s*(.+?)(?:\s*-\s*|,)/);

            if (streetNumberMatch) {
                const [, street, number, area] = streetNumberMatch;
                // Limpar e formatar
                const cleanStreet = street.trim();
                const cleanNumber = number.replace('*', ', '); // N*195 -> N, 195
                const cleanArea = area.trim();

                return `${cleanStreet}, ${cleanNumber}`;
            }

            // Fallback: se o endereço começa com número simples
            const simpleNumberMatch = cleanAddress.match(/^(\d+)\s+(.+)/);
            if (simpleNumberMatch) {
                const [, number, street] = simpleNumberMatch;
                return `${number} ${street}`;
            }

            // Se não tem número, mostrar como está
            return cleanAddress;
        }
    };

    // Função para obter texto secundário do endereço (bairro, cidade)
    const getAddressSubtext = (address) => {
        if (!address) return '';

        // Limpar vírgulas extras no início
        let cleanAddress = address.replace(/^[,.\s]+/, '').trim();

        // Verificar se é um lugar com nome (shopping, restaurante, etc.)
        // Padrão: "Nome do Lugar - Endereço" ou "Nome do Lugar, Endereço"
        const hasPlaceName = cleanAddress.includes(' - ') || cleanAddress.includes(', ');

        if (hasPlaceName) {
            // Dividir em nome do lugar e endereço
            let placeName, addressPart;

            if (cleanAddress.includes(' - ')) {
                [placeName, addressPart] = cleanAddress.split(' - ');
            } else {
                [placeName, addressPart] = cleanAddress.split(', ');
            }

            // Para lugares com nome, retornar RUA + NÚMERO + BAIRRO na linha inferior
            const addressParts = addressPart.split(', ');
            let streetAndNumber = addressParts[0].trim();
            let neighborhood = addressParts.length >= 2 ? addressParts[1].trim() : '';

            return streetAndNumber + (neighborhood ? `, ${neighborhood}` : '');
        } else {
            // É um endereço simples (rua, número)
            // Tentar extrair bairro e cidade do endereço formatado
            // Padrão: "Rua das Pastorinhas N*195 TAQUARA - Jacarepaguá, Rio de Janeiro - RJ"
            const areaMatch = cleanAddress.match(/(?:-\s*|,\s*)([^,]+?)(?:,\s*([^,]+?))?(?:,\s*([^,]+?))?$/);

            if (areaMatch) {
                const [, area1, area2, area3] = areaMatch;

                // Se temos área (TAQUARA) e cidade (Jacarepaguá, Rio de Janeiro)
                if (area1 && area2) {
                    // Filtrar áreas vazias e limpar
                    const areas = [area1, area2, area3].filter(Boolean).map(a => a.trim());

                    // Retornar as duas últimas áreas (geralmente bairro e cidade)
                    if (areas.length >= 2) {
                        return areas.slice(-2).join(', ');
                    } else if (areas.length === 1) {
                        return areas[0];
                    }
                }
            }

            // Fallback: extrair bairro e cidade do endereço completo
            const parts = cleanAddress.split(',');

            if (parts.length >= 3) {
                // Se temos pelo menos 3 partes, retornar as últimas 2 (bairro, cidade)
                return parts.slice(-2).join(', ').trim();
            } else if (parts.length === 2) {
                // Se temos apenas 2 partes, retornar a segunda (cidade)
                return parts[1].trim();
            }

            return '';
        }
    };

    // Função para determinar se deve mostrar o subtexto
    const shouldShowSubtext = (address) => {
        if (!address) return false;

        const cleanAddress = address.replace(/^[,.\s]+/, '').trim();
        const parts = cleanAddress.split(',');

        // Só mostrar subtexto se tivermos informações suficientes para não duplicar
        return parts.length >= 3 && parts[0].trim() !== parts.slice(-2).join(', ').trim();
    };

    const AddressFields = useMemo(() => {
        // ✅ Remover log excessivo - só logar quando realmente necessário
        // Logger.log('🔍 Renderizando AddressFields, searchState:', searchState);

        // ✅ Renderizar dropdown integrado ao campo ativo
        const renderDropdown = () => {
            if (!searchState.visible) return null;

            // ✅ Mostrar últimos destinos confirmados quando campo está vazio ou tem menos de 3 caracteres
            const showConfirmedDestinations = searchState.type === 'drop' &&
                (!searchState.inputText || searchState.inputText.length < 3) &&
                confirmedDestinations.length > 0;

            // ✅ Mostrar resultados de busca quando há texto suficiente
            const showSearchResults = searchState.inputText && searchState.inputText.length >= 3;

            if (!showConfirmedDestinations && !showSearchResults) return null;

            return (
                <View style={[styles.dropdownIntegrated, { backgroundColor: safeTheme.card }]}>
                    {searchState.loading && (
                        <View style={styles.dropdownLoadingContainer}>
                            <ActivityIndicator size="small" color={MAIN_COLOR} />
                        </View>
                    )}

                    {!searchState.loading && (
                        <ScrollView
                            keyboardShouldPersistTaps='handled'
                            style={styles.dropdownScrollView}
                            nestedScrollEnabled={true}
                            showsVerticalScrollIndicator={true}
                            bounces={false}
                        >
                            {/* ✅ Últimos destinos confirmados */}
                            {showConfirmedDestinations && (
                                <>
                                    {confirmedDestinations.map((destination, index) => {
                                        const formattedAddress = formatAddressForDropdown({
                                            description: destination.add,
                                            place_id: destination.placeId || `confirmed_${index}`
                                        });
                                        return (
                                            <TouchableOpacity
                                                key={`confirmed_${index}_${destination.add}`}
                                                style={[styles.dropdownResultItem, styles.dropdownResultItemWithIcon]}
                                                onPress={() => {
                                                    handleSelectAddress({
                                                        description: destination.add,
                                                        place_id: destination.placeId,
                                                        location: { lat: destination.lat, lng: destination.lng }
                                                    }, searchState.type);
                                                }}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons name="time-outline" color={safeTheme.primary} size={22} style={styles.addressIcon} />
                                                <View style={styles.addressTextContainer}>
                                                    <Typography variant="label" color={theme.text} numberOfLines={1}>
                                                        {formattedAddress.topLine}
                                                    </Typography>
                                                    {formattedAddress.bottomLine && (
                                                        <Typography variant="caption" color={theme.textSecondary} numberOfLines={1}>
                                                            {formattedAddress.bottomLine}
                                                        </Typography>
                                                    )}
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </>
                            )}

                            {/* ✅ Resultados de busca */}
                            {showSearchResults && searchState.results.length > 0 && (
                                <>
                                    {showConfirmedDestinations && (
                                        <View style={styles.searchResultsDivider} />
                                    )}
                                    {searchState.results.map((item) => {
                                        const formattedAddress = formatAddressForDropdown(item);

                                        // ✅ Debug: Logar o que está sendo exibido no dropdown
                                        Logger.log('🔍 [Dropdown] Exibindo endereço:', {
                                            place_id: item.place_id,
                                            topLine: formattedAddress.topLine,
                                            bottomLine: formattedAddress.bottomLine,
                                            hasPlaceName: formattedAddress.hasPlaceName
                                        });

                                        return (
                                            <TouchableOpacity
                                                key={item.place_id}
                                                style={styles.dropdownResultItem}
                                                onPress={() => handleSelectAddress(item, searchState.type)}
                                                activeOpacity={0.7}
                                            >
                                                <View style={styles.dropdownResultTextContainer}>
                                                    <Typography variant="label" color={theme.text} numberOfLines={1}>
                                                        {formattedAddress.topLine}
                                                    </Typography>
                                                    {formattedAddress.bottomLine && (
                                                        <Typography variant="caption" color={theme.textSecondary} numberOfLines={1}>
                                                            {formattedAddress.bottomLine}
                                                        </Typography>
                                                    )}
                                                </View>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </>
                            )}

                            {/* ✅ Sem resultados */}
                            {showSearchResults && searchState.results.length === 0 && !searchState.loading && (
                                <View style={styles.dropdownNoResults}>
                                    <Typography variant="body" color={theme.textSecondary} align="center">
                                        {t('no_results_found')}
                                    </Typography>
                                </View>
                            )}
                        </ScrollView>
                    )}
                </View>
            );
        };

        // ✅ Ocultar card de partida/destino quando motorista chegou
        if (tripStatus === 'accepted' && driverArrived) {
            return null;
        }

        return (
            <View style={styles.addressContainer}>
                <View style={[styles.addressCardGroup, { backgroundColor: safeTheme.card }]}>
                    <View style={styles.addressCardRow}>
                        <Ionicons name="location" color={safeTheme.icon} size={22} style={styles.addressIcon} />
                        <View style={[styles.addressTextContainer, { flex: 1 }]}>
                            {/* ✅ Botão para adicionar detalhes se o endereço for aproximado */}
                            {!searchState.visible && tripdata.pickup?.add && isApproximateAddress(tripdata.pickup.add) && (
                                <TouchableOpacity
                                    style={styles.addDetailsButton}
                                    onPress={() => handleAddAddressDetails('pickup')}
                                >
                                    <Ionicons name="add-circle-outline" size={16} color={theme.leafGreen || '#41D274'} />
                                    <Typography variant="caption" weight="medium" color={theme.leafGreen || '#41D274'} style={styles.addDetailsButtonText}>
                                        Adicionar detalhes
                                    </Typography>
                                </TouchableOpacity>
                            )}
                            {searchState.visible && searchState.type === 'pickup' ? (
                                // Campo de busca ativo
                                <TextInput
                                    style={[styles.searchInputInline, { color: theme.text }]}
                                    placeholder="Digite local de embarque..."
                                    placeholderTextColor={theme.placeholder}
                                    value={searchState.inputText}
                                    onChangeText={(text) => {
                                        Logger.log('✏️ [PassengerUI] Editando campo de busca pickup:', text);
                                        setIsManuallyEditingPickup(true); // ✅ Marcar como edição manual
                                        setManualPickupText(text); // ✅ Salvar texto manual
                                        setSearchState(prev => ({ ...prev, inputText: text }));
                                        // ✅ Só buscar se tiver pelo menos 3 caracteres
                                        if (text.length >= 3) {
                                            debouncedSearch(text);
                                        } else {
                                            // Limpar resultados se tiver menos de 3 caracteres
                                            setSearchState(prev => ({ ...prev, results: [] }));
                                        }
                                    }}
                                    autoFocus={true}
                                    onBlur={async () => {
                                        // ✅ Delay para permitir clique no resultado antes de processar
                                        setTimeout(async () => {
                                            // ✅ Se o usuário digitou algo, tentar geocodificar e salvar o endereço completo
                                            if (searchState.inputText && searchState.inputText.trim().length > 0) {
                                                try {
                                                    const fullAddress = searchState.inputText.trim();
                                                    Logger.log('🔍 [PassengerUI] Processando endereço completo ao perder foco:', fullAddress);

                                                    // ✅ Buscar coordenadas do endereço completo (pode incluir número)
                                                    const results = await Promise.race([
                                                        fetchGeocodeAddress(fullAddress, currentLocation ? { lat: currentLocation.lat, lng: currentLocation.lng } : null),
                                                        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
                                                    ]);

                                                    if (results && results.length > 0) {
                                                        Logger.log('✅ [PassengerUI] Endereço completo geocodificado com sucesso');
                                                        // ✅ Usar o primeiro resultado e obter coordenadas
                                                        const selectedResult = results[0];
                                                        let coords;

                                                        if (selectedResult.place_id) {
                                                            coords = await fetchCoordsfromPlace(selectedResult.place_id);
                                                        } else if (selectedResult.location) {
                                                            coords = {
                                                                lat: selectedResult.location.lat,
                                                                lng: selectedResult.location.lng
                                                            };
                                                        }

                                                        if (coords) {
                                                            // ✅ Salvar o endereço COMPLETO (com número) no Redux
                                                            dispatch(updateTripPickup({
                                                                lat: coords.lat,
                                                                lng: coords.lng,
                                                                add: fullAddress, // ✅ Usar o texto completo digitado (ex: "Estrada do rio grande 4057")
                                                                placeId: selectedResult.place_id,
                                                                source: 'search'
                                                            }));
                                                            setManualPickupText(fullAddress);
                                                            Logger.log('✅ [PassengerUI] Endereço completo salvo:', fullAddress);
                                                        } else {
                                                            // Se não conseguiu coordenadas, salvar como texto mesmo assim
                                                            dispatch(updateTripPickup({
                                                                add: fullAddress,
                                                                lat: tripdata.pickup?.lat || currentLocation?.lat,
                                                                lng: tripdata.pickup?.lng || currentLocation?.lng
                                                            }));
                                                            setManualPickupText(fullAddress);
                                                        }
                                                    } else {
                                                        Logger.log('⚠️ [PassengerUI] Nenhum resultado encontrado, salvando como texto manual');
                                                        // Se não encontrou, salvar como texto manual
                                                        dispatch(updateTripPickup({
                                                            add: fullAddress,
                                                            lat: tripdata.pickup?.lat || currentLocation?.lat,
                                                            lng: tripdata.pickup?.lng || currentLocation?.lng
                                                        }));
                                                        setManualPickupText(fullAddress);
                                                    }
                                                } catch (error) {
                                                    Logger.warn('⚠️ [PassengerUI] Erro ao geocodificar endereço manual:', error.message);
                                                    // Salvar como texto mesmo assim (usuário pode ter digitado um endereço válido)
                                                    const fullAddress = searchState.inputText.trim();
                                                    if (fullAddress.length > 0) {
                                                        dispatch(updateTripPickup({
                                                            add: fullAddress,
                                                            lat: tripdata.pickup?.lat || currentLocation?.lat,
                                                            lng: tripdata.pickup?.lng || currentLocation?.lng
                                                        }));
                                                        setManualPickupText(fullAddress);
                                                    }
                                                }
                                            } else {
                                                // Se o campo estiver vazio, restaurar o valor anterior
                                                if (tripdata.pickup?.add) {
                                                    const formatted = formatAddressForDisplay(tripdata.pickup.add);
                                                    setManualPickupText(formatted);
                                                }
                                            }

                                            // ✅ Fechar campo de busca após processar
                                            setSearchState({ visible: false, type: 'pickup', inputText: '', results: [], loading: false });
                                        }, 300); // ✅ Aumentado para 300ms para garantir que clique no resultado seja processado
                                    }}
                                    keyboardShouldPersistTaps="handled"
                                    blurOnSubmit={false}
                                />
                            ) : (
                                // ✅ Campo de embarque sempre editável
                                <TextInput
                                    style={[styles.addressTextInput, { color: theme.text }]}
                                    placeholder="Local de partida"
                                    placeholderTextColor={theme.placeholder}
                                    value={manualPickupText || (tripdata.pickup?.add ? formatAddressForDisplay(tripdata.pickup.add) : '') || ''}
                                    key={`pickup-input-${tripdata.pickup?.lat}-${tripdata.pickup?.lng}`} // ✅ Forçar re-render quando coordenadas mudarem
                                    onChangeText={(text) => {
                                        Logger.log('✏️ [PassengerUI] Editando campo de partida:', text);
                                        setIsManuallyEditingPickup(true); // ✅ Marcar como edição manual
                                        setManualPickupText(text); // ✅ Salvar texto manual

                                        // ✅ Abrir modo de busca quando começar a digitar
                                        if (text.length > 0 && !searchState.visible) {
                                            Logger.log('🔍 [PassengerUI] Abrindo modo de busca para pickup');
                                            setSearchState({ visible: true, type: 'pickup', inputText: text, results: [], loading: false });
                                            debouncedSearch(text);
                                        } else if (searchState.visible && searchState.type === 'pickup') {
                                            setSearchState(prev => ({ ...prev, inputText: text }));
                                            debouncedSearch(text);
                                        }
                                    }}
                                    onFocus={() => {
                                        Logger.log('🎯 [PassengerUI] Campo de partida focado - LIMPANDO campo para edição');
                                        // ✅ LIMPAR o campo completamente quando focar para permitir nova digitação
                                        setManualPickupText('');
                                        setIsManuallyEditingPickup(true);
                                        // ✅ Abrir modo de busca com campo vazio
                                        setSearchState({ visible: true, type: 'pickup', inputText: '', results: [], loading: false });
                                    }}
                                    multiline={false}
                                    numberOfLines={1}
                                />
                            )}
                            {/* ✅ Botão para adicionar detalhes se o endereço for aproximado */}
                            {!searchState.visible && tripdata.pickup?.add && isApproximateAddress(tripdata.pickup.add) && (
                                <TouchableOpacity
                                    style={styles.addDetailsButton}
                                    onPress={() => handleAddAddressDetails('pickup')}
                                >
                                    <Ionicons name="add-circle-outline" size={16} color={theme.leafGreen || '#41D274'} />
                                    <Text style={[styles.addDetailsButtonText, { color: theme.leafGreen || '#41D274' }]}>
                                        Adicionar detalhes
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {/* ✅ Dropdown integrado para pickup */}
                    {searchState.visible && searchState.type === 'pickup' && renderDropdown()}

                    <View style={styles.addressDivider} />

                    <View style={styles.addressCardRow}>
                        <Ionicons name="flag" color={safeTheme.icon} size={22} style={styles.addressIcon} />
                        <View style={styles.addressTextContainer}>
                            {searchState.visible && searchState.type === 'drop' ? (
                                // Campo de busca ativo
                                <TextInput
                                    style={[styles.searchInputInline, { color: theme.text }]}
                                    placeholder="Digite seu destino..."
                                    placeholderTextColor={theme.placeholder}
                                    value={searchState.inputText}
                                    onChangeText={(text) => {
                                        setSearchState(prev => ({ ...prev, inputText: text }));
                                        debouncedSearch(text);
                                    }}
                                    autoFocus={true}
                                    onBlur={() => {
                                        // Delay para permitir clique no resultado
                                        setTimeout(() => {
                                            setSearchState({ visible: false, type: 'drop', inputText: '', results: [], loading: false });
                                        }, 200);
                                    }}
                                    keyboardShouldPersistTaps="handled"
                                    blurOnSubmit={false}
                                />
                            ) : (
                                // Campo de destino normal
                                <TouchableOpacity onPress={() => {
                                    Logger.log('🔍 Clicando no campo de destino');
                                    // ✅ Abrir campo e mostrar últimos destinos confirmados
                                    setSearchState({ visible: true, type: 'drop', inputText: '', results: [], loading: false });
                                }}>
                                    <Typography variant="label" color={tripdata.drop?.add ? theme.text : theme.placeholder} numberOfLines={2}>
                                        {tripdata.drop && tripdata.drop.add ? tripdata.drop.add : t('where_to_placeholder')}
                                    </Typography>
                                    {tripdata.drop?.add && shouldShowSubtext(tripdata.drop.add) && (
                                        <Text style={[styles.addressSubtext, { color: theme.textSecondary }]} numberOfLines={1}>
                                            {getAddressSubtext(tripdata.drop.add)}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {/* ✅ Dropdown integrado para drop */}
                    {searchState.visible && searchState.type === 'drop' && renderDropdown()}
                </View>
            </View>
        );
    }, [tripdata.pickup, tripdata.drop, theme, t, searchState.visible, searchState.type, searchState.inputText, searchState.results, searchState.loading, debouncedSearch, handleSelectAddress, formatAddressForDropdown]);

    const performSearch = useCallback(async (text) => {
        Logger.log('🔍 Iniciando busca hierárquica para:', text);

        if (text.length < 3) {
            setSearchState(prev => ({ ...prev, results: [], loading: false }));
            return;
        }

        try {
            setSearchState(prev => ({ ...prev, loading: true }));

            // 🎯 LÓGICA HIERÁRQUICA: Detectar tipo de input
            const inputType = detectInputType(text);
            Logger.log(`📍 Tipo detectado: ${inputType} para "${text}"`);

            let results = [];

            // ✅ Obter localização atual para aplicar location bias
            const userLocation = currentLocation || pickupAddress;
            const locationForBias = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null;

            if (locationForBias) {
                Logger.log('📍 Usando location bias baseado em:', locationForBias);
            } else {
                Logger.log('⚠️ Localização não disponível, buscando em todo o Brasil');
            }

            if (inputType === 'address') {
                // 📍 ENDEREÇO: Usar Geocoding API (Forward)
                Logger.log('📍 Buscando como ENDEREÇO usando Geocoding API...');
                try {
                    results = await fetchGeocodeAddress(text, locationForBias);
                    Logger.log('✅ Geocoding API retornou:', results?.length || 0, 'resultados');
                } catch (geocodeError) {
                    Logger.error('❌ Erro no Geocoding API:', geocodeError);
                    // Fallback: tentar Places API se Geocoding falhar
                    Logger.log('🔄 Tentando fallback para Places API...');
                    try {
                        results = await fetchPlacesAutocomplete(text, null, locationForBias);
                        Logger.log('✅ Fallback Places API retornou:', results?.length || 0, 'resultados');
                    } catch (placesError) {
                        Logger.error('❌ Erro no fallback Places API:', placesError);
                        throw geocodeError; // Lançar erro original
                    }
                }
            } else {
                // 🏛️ NOME DE LUGAR: Usar Places API
                Logger.log('🏛️ Buscando como NOME DE LUGAR usando Places API...');
                try {
                    results = await fetchPlacesAutocomplete(text, null, locationForBias);
                    Logger.log('✅ Places API retornou:', results?.length || 0, 'resultados');
                } catch (placesError) {
                    Logger.error('❌ Erro no Places API:', placesError);
                    // Fallback: tentar Geocoding API se Places falhar
                    Logger.log('🔄 Tentando fallback para Geocoding API...');
                    try {
                        results = await fetchGeocodeAddress(text, locationForBias);
                        Logger.log('✅ Fallback Geocoding API retornou:', results?.length || 0, 'resultados');
                    } catch (geocodeError) {
                        Logger.error('❌ Erro no fallback Geocoding API:', geocodeError);
                        throw placesError; // Lançar erro original
                    }
                }
            }

            // Converter resultados para formato padrão
            if (results && results.length > 0) {
                const convertedResults = results.map(item => ({
                    place_id: item.place_id || `search_${Date.now()}_${Math.random()}`,
                    description: item.description || item.formatted_address || 'Endereço não disponível',
                    location: item.location || null,
                    source: item.source || 'unknown',
                    structured_formatting: item.structured_formatting || null
                }));

                setSearchState(prev => ({ ...prev, results: convertedResults, loading: false }));
                Logger.log('✅ Resultados convertidos e exibidos:', convertedResults.length);
            } else {
                Logger.log('⚠️ Nenhum resultado encontrado');
                setSearchState(prev => ({ ...prev, results: [], loading: false }));
            }

        } catch (error) {
            Logger.error('❌ Erro geral na busca hierárquica:', error);
            setSearchState(prev => ({ ...prev, results: [], loading: false }));

            // Alertar o usuário sobre o problema
            Alert.alert(
                'Erro de Busca',
                'Não foi possível buscar endereços no momento. Verifique sua conexão e tente novamente.',
                [{ text: 'OK' }]
            );
        }
    }, [currentLocation, pickupAddress]);

    // Função de debounce para busca - mais responsiva
    const debouncedSearch = useCallback((text) => {
        // Limpar timer anterior se existir
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        // Se o texto for menor que 3 caracteres, limpar resultados imediatamente
        if (text.length < 3) {
            setSearchState(prev => ({ ...prev, results: [], loading: false }));
            return;
        }

        // Mostrar loading imediatamente para feedback visual
        setSearchState(prev => ({ ...prev, loading: true }));

        // Configurar novo timer para 1 segundo (otimizado para hierarquia de cache)
        searchTimeoutRef.current = setTimeout(() => {
            Logger.log('⏰ Timer expirado, executando busca hierárquica para:', text);
            performSearch(text);
        }, 1000);

        Logger.log('⏰ Timer configurado para 1 segundo para:', text);
    }, [performSearch]);

    // ✅ AddressDropdown removido - agora está integrado dentro do AddressFields

    // ✅ fixedCarTypes já foi movido para antes dos useEffects (linha 151)



    // Função para calcular tempo de partida (pickup time em minutos)
    // Baseado no tempo médio dos 3-5 motoristas mais próximos até o local de embarque
    const getPickupTime = useCallback((car) => {
        // Se não temos ponto de embarque, retornar null
        if (!tripdata.pickup || !tripdata.pickup.lat || !tripdata.pickup.lng) {
            return null;
        }

        // Filtrar motoristas que têm o mesmo tipo de carro (comparação flexível)
        const driversWithSameCarType = nearbyDrivers.filter(driver => {
            // Verificar se o motorista tem localização
            if (!driver.location || !driver.location.lat || !driver.location.lng) {
                return false;
            }

            // ✅ Comparação flexível de carType (case-insensitive, remove espaços)
            const normalizeCarType = (str) => {
                if (!str) return '';
                return str.toString().toLowerCase().trim().replace(/\s+/g, ' ');
            };

            const driverCarType = normalizeCarType(driver.carType);
            const carName = normalizeCarType(car.name);

            // ✅ Aceitar se corresponder exatamente OU se driver não tem carType definido (mostrar todos os motoristas)
            // Isso permite que motoristas sem carType específico apareçam em todos os tipos
            if (!driverCarType) {
                return true; // Motorista sem carType - mostrar em todos os tipos
            }
            return driverCarType === carName;
        });

        // Se não há motoristas com o mesmo tipo de carro, retornar null
        if (driversWithSameCarType.length === 0) {
            // Logger.log(`⚠️ Nenhum motorista encontrado para ${car.name}`, {
            //     totalDrivers: nearbyDrivers.length,
            //     driversCarTypes: nearbyDrivers.map(d => d.carType),
            //     carName: car.name
            // });
            return null;
        }

        // Logger.log(`✅ ${driversWithSameCarType.length} motoristas encontrados para ${car.name}`);

        // Calcular distância e tempo de cada motorista até o ponto de embarque
        const driverTimes = driversWithSameCarType.map(driver => {
            const distanceKm = GetDistance(
                tripdata.pickup.lat,
                tripdata.pickup.lng,
                driver.location.lat,
                driver.location.lng
            );

            // Velocidade média: 35 km/h = ~0.583 km/min (mesma lógica usada em DriverUI)
            const speedKmPerMin = 0.583;
            const estimatedMinutes = Math.max(1, Math.round(distanceKm / speedKmPerMin));

            return {
                driverId: driver.id,
                distance: distanceKm,
                time: estimatedMinutes
            };
        });

        // Ordenar por tempo (menor primeiro)
        driverTimes.sort((a, b) => a.time - b.time);

        // Pegar os 3-5 mais próximos (priorizar 5, mas usar 3 se houver menos)
        const topDrivers = driverTimes.slice(0, Math.min(5, driverTimes.length));

        // Calcular média dos tempos
        const averageTime = Math.round(
            topDrivers.reduce((sum, driver) => sum + driver.time, 0) / topDrivers.length
        );

        // ✅ Garantir que o tempo mínimo seja pelo menos 1 minuto
        const finalTime = Math.max(1, averageTime);

        Logger.log(`📍 Pickup time calculado para ${car.name}:`, {
            totalDrivers: driversWithSameCarType.length,
            topDrivers: topDrivers.length,
            times: topDrivers.map(d => d.time),
            averageTime,
            finalTime
        });

        return finalTime;
    }, [nearbyDrivers, tripdata.pickup]);

    // Backdrop para o BottomSheet - não deve interferir com interações do mapa
    const renderBackdrop = useCallback(
        (props) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.1} // ✅ Reduzido de 0.5 para 0.1 para não escurecer o mapa
                enableTouchThrough={true} // ✅ Permitir que toques passem através do backdrop para o mapa
            />
        ),
        []
    );

    // Abrir BottomSheet quando há rota - NUNCA FECHAR
    useEffect(() => {
        if (tripdata.pickup && tripdata.drop && tripdata.drop.add) {
            bottomSheetRef.current?.snapToIndex(0);
        }
        // ✅ Removido o close() - BottomSheet nunca deve fechar
    }, [tripdata.pickup, tripdata.drop]);

    // ✅ Obter opções de avaliação baseadas na nota (definida antes do useMemo)
    const getRatingOptionsForRating = useCallback(() => {
        if (rating >= 5) {
            return ['Veículo limpo', 'Ótimo trajeto', 'Ambiente agradável', 'Direção segura'];
        } else if (rating >= 3) {
            return ['Limpeza do carro', 'Trajeto', 'Ambiente (música e temperatura)', 'Segurança'];
        }
        return [];
    }, [rating]);

    const renderCarOptionsCard = () => {
        // Usar tipos fixos (Leaf Plus e Leaf Elite) - EXATAMENTE COMO NO MAPSCREEN
        const carTypesToUse = fixedCarTypes || [];

        // Mostrar BottomSheet quando há rota OU quando há status de viagem ativo
        if ((!tripdata.pickup || !tripdata.drop || !tripdata.drop.add) && tripStatus === 'idle') return null;

        // ✅ Verificar se pelo menos um preço foi calculado (não usar min_fare)
        const hasCalculatedPrices = carTypesToUse.some(car => {
            const estimate = getEstimateForCar(car);
            // Preço válido = tem fare calculado E não é null E não está calculando
            return estimate &&
                estimate.fare !== null &&
                estimate.fare !== undefined &&
                estimate.fare !== '0' &&
                !isCalculatingRoute;
        });

        // ✅ Se está calculando OU não tem preços calculados, mostrar loading
        if (tripStatus === 'idle' && (isCalculatingRoute || !hasCalculatedPrices)) {
            return (
                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={snapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="large" color="#41D274" />
                            <Typography variant="h2" color={theme.text}>
                                {t('calculating_route_price')}
                            </Typography>
                            <Typography variant="body" color={theme.textSecondary || '#666'} align="center">
                                {t('wait_calculating_route')}
                            </Typography>
                        </View>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ ESTADO 1: Procurando motoristas
        // ✅ NÃO mostrar bottom sheet se modal de pagamento estiver aberto
        if (tripStatus === 'searching' && !isPaymentModalVisible) {
            // ✅ Calcular tempo formatado para garantir re-renderização
            const timerFormatted = `${Math.floor(searchingTime / 60)}:${(searchingTime % 60).toString().padStart(2, '0')}`;

            return (
                <BottomSheet
                    key="searching-bottom-sheet"
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={searchingSnapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        {/* ✅ Título da viagem */}
                        <View style={styles.tripTitleContainer}>
                            <Typography variant="h2" color={theme.text} numberOfLines={1}>
                                Sua viagem para {tripdata.drop?.add || tripdata.drop?.name || 'destino'}
                            </Typography>
                            <View style={[styles.tripTitleSeparator, { backgroundColor: safeTheme.border || '#E0E0E0' }]} />
                        </View>

                        <View style={[styles.bottomSheetHeader, { alignItems: 'center', marginBottom: 0, paddingBottom: 0, marginTop: 5, paddingTop: 5 }]}>
                            <Typography variant="h2" color={theme.text} align="center">
                                Procurando motoristas
                            </Typography>
                        </View>

                        <View style={styles.searchingContainer}>
                            {/* ✅ Timer COMPLETAMENTE INDEPENDENTE - gerencia seu próprio estado */}
                            <SearchingTimer tripStatus={tripStatus} style={styles.searchingTimer} />
                            {/* ✅ Mensagens rotativas COMPLETAMENTE INDEPENDENTES */}
                            <SearchingMessage
                                tripStatus={tripStatus}
                                messages={SEARCH_STATUS_MESSAGES}
                                style={[styles.searchingMessage, { color: theme.textSecondary }]}
                            />
                        </View>

                        {/* ✅ Botão de cancelar - sempre visível */}
                        <View style={styles.searchingCancelButtonContainer}>
                            <AnimatedButton
                                title="Cancelar"
                                variant="danger"
                                onPress={handleCancelBooking}
                                fullWidth
                            />
                        </View>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ FASE 1: Motorista a caminho do local de embarque
        if (tripStatus === 'accepted' && driverInfo && !driverArrived) {
            const formatTime = (minutes) => {
                if (!minutes || minutes <= 0) return '--:--';
                const mins = Math.floor(minutes);
                const secs = Math.round((minutes - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            };

            return (
                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={snapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* Header: Foto do perfil + Nome do motorista está a caminho */}
                            <View style={[styles.bottomSheetHeader, { zIndex: 10, position: 'relative' }]}>
                                <View style={styles.headerTitleRow}>
                                    <View style={styles.driverPhotoContainerHeader}>
                                        {driverInfo.photo ? (
                                            <Image
                                                source={{ uri: driverInfo.photo }}
                                                style={styles.driverPhotoHeader}
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View style={[styles.driverPhotoHeader, styles.driverPhotoPlaceholder]}>
                                                <Ionicons name="person" size={28} color="#666" />
                                            </View>
                                        )}
                                    </View>
                                    <View style={styles.driverNameContainerHeader}>
                                        <Typography variant="h2" color={theme.text || '#000000'}>
                                            {driverInfo.name || 'Motorista'} está a caminho
                                        </Typography>
                                        {/* ✅ "Embarque em x minutos" com estimativa REAL */}
                                        {estimatedPickupTime !== null && estimatedPickupTime > 0 && (
                                            <Text style={[styles.embarkTimeText, { color: theme.textSecondary || '#666' }]}>
                                                Embarque em {Math.ceil(estimatedPickupTime)} {Math.ceil(estimatedPickupTime) === 1 ? 'minuto' : 'minutos'}
                                            </Text>
                                        )}
                                        {/* ✅ Linha suave abaixo do "Embarque em x minutos" */}
                                        <View style={styles.dividerLine} />
                                    </View>
                                </View>
                            </View>

                            {/* ✅ Seção do Veículo - Mesma estrutura do card "motorista chegou" */}
                            {driverInfo.vehicle && (
                                <View style={[styles.driverCardMainCompact, { backgroundColor: safeTheme.card, marginTop: -25, zIndex: 1, position: 'relative' }]}>
                                    <View style={styles.vehicleSection}>
                                        <View style={styles.vehicleInfoLeft}>
                                            <View style={styles.vehicleTextContainer}>
                                                {/* Placa no topo */}
                                                {driverInfo.vehicle?.plate && (
                                                    <Typography variant="h3" weight="bold" color={theme.text}>
                                                        {driverInfo.vehicle.plate}
                                                    </Typography>
                                                )}
                                                {/* Marca/Modelo/Cor abaixo da placa */}
                                                <Typography variant="body" color={theme.text}>
                                                    {[
                                                        driverInfo.vehicle.brand,
                                                        driverInfo.vehicle.model,
                                                        driverInfo.vehicle.color
                                                    ].filter(Boolean).join(' • ')}
                                                </Typography>
                                            </View>
                                        </View>

                                        {/* Foto do carro (direita) */}
                                        <View style={styles.carPhotoContainerSide}>
                                            {driverInfo.vehicle.model?.toLowerCase().includes('corolla') &&
                                                (driverInfo.vehicle.color?.toLowerCase().includes('prata') ||
                                                    driverInfo.vehicle.color?.toLowerCase().includes('branco')) ? (
                                                <Image
                                                    source={
                                                        driverInfo.vehicle.color?.toLowerCase().includes('prata')
                                                            ? require('../../../assets/cars/toyota/Corolla/prata.png')
                                                            : require('../../../assets/cars/toyota/Corolla/branco.png')
                                                    }
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : driverInfo.vehicle.photo ? (
                                                <Image
                                                    source={{ uri: driverInfo.vehicle.photo }}
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : null}
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* ✅ NOVO: Lista de mensagens do chat (apenas quando corrida aceita) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && chatMessages.length > 0 && (
                                <View style={[styles.chatMessagesContainer, { backgroundColor: safeTheme.background, marginTop: 12, marginBottom: 8 }]}>
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
                                                            ? (theme.primary || '#41D274')
                                                            : safeTheme.card,
                                                        alignSelf: msg.isOwn ? 'flex-end' : 'flex-start'
                                                    }
                                                ]}
                                            >
                                                <Typography variant="body" color={msg.isOwn ? '#FFFFFF' : theme.text}>
                                                    {msg.text}
                                                </Typography>
                                                <Typography variant="caption" color={msg.isOwn ? 'rgba(255,255,255,0.7)' : theme.textSecondary || '#666'} style={{ fontSize: 10, marginTop: 2 }}>
                                                    {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* ✅ Campo "Enviar mensagem" (apenas quando corrida aceita) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && (
                                <View style={styles.messageInputContainer}>
                                    <TextInput
                                        style={[styles.messageInput, {
                                            backgroundColor: safeTheme.background,
                                            color: theme.text,
                                            borderColor: theme.border || '#DDD'
                                        }]}
                                        placeholder="Enviar mensagem"
                                        placeholderTextColor={theme.textSecondary || '#999'}
                                        value={messageText}
                                        onChangeText={setMessageText}
                                        multiline={false}
                                    />
                                    <TouchableOpacity
                                        style={styles.sendMessageButton}
                                        onPress={handleSendMessage}
                                        disabled={!messageText.trim()}
                                    >
                                        <Ionicons
                                            name="send"
                                            size={20}
                                            color={messageText.trim() ? '#41D274' : '#CCC'}
                                        />
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Botão Cancelar */}
                            <AnimatedButton
                                title="Cancelar"
                                variant="danger"
                                onPress={handleCancelBooking}
                                fullWidth
                            />
                        </ScrollView>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ FASE 2: Motorista chegou ao local de embarque
        if (tripStatus === 'accepted' && driverInfo && driverArrived) {
            const formatEmbarkTimer = (seconds) => {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            };

            return (
                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={snapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* ✅ 1. Título "Seu motorista chegou" centralizado */}
                            <View style={styles.bottomSheetHeader}>
                                <Typography variant="h2" weight="bold" color={theme.text} align="center">
                                    Seu motorista chegou
                                </Typography>

                                {/* ✅ 2. Timer "Embarque em xx:xx" centralizado */}
                                <View style={styles.embarkTimerContainer}>
                                    <Typography variant="caption" color={theme.textSecondary || '#666'} align="center">
                                        Embarque em {formatEmbarkTimer(embarkTimer)}
                                    </Typography>
                                </View>
                            </View>

                            {/* ✅ 3. Card Principal: Dados do carro e motorista */}
                            <View style={[styles.driverCardMain, { backgroundColor: safeTheme.card }]}>
                                {/* Seção do Veículo */}
                                {driverInfo.vehicle && (
                                    <View style={styles.vehicleSection}>
                                        <View style={styles.vehicleInfoLeft}>
                                            <View style={styles.vehicleTextContainer}>
                                                {/* Placa no topo */}
                                                {driverInfo.vehicle?.plate && (
                                                    <Typography variant="h3" weight="bold" color={theme.text}>
                                                        {driverInfo.vehicle.plate}
                                                    </Typography>
                                                )}
                                                {/* Marca/Modelo/Cor abaixo da placa */}
                                                <Typography variant="body" color={theme.text}>
                                                    {[
                                                        driverInfo.vehicle.brand,
                                                        driverInfo.vehicle.model,
                                                        driverInfo.vehicle.color
                                                    ].filter(Boolean).join(' • ')}
                                                </Typography>
                                            </View>
                                        </View>

                                        {/* Foto do carro (direita) */}
                                        <View style={styles.carPhotoContainerSide}>
                                            {driverInfo.vehicle.model?.toLowerCase().includes('corolla') &&
                                                (driverInfo.vehicle.color?.toLowerCase().includes('prata') ||
                                                    driverInfo.vehicle.color?.toLowerCase().includes('branco')) ? (
                                                <Image
                                                    source={
                                                        driverInfo.vehicle.color?.toLowerCase().includes('prata')
                                                            ? require('../../../assets/cars/toyota/Corolla/prata.png')
                                                            : require('../../../assets/cars/toyota/Corolla/branco.png')
                                                    }
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : driverInfo.vehicle.photo ? (
                                                <Image
                                                    source={{ uri: driverInfo.vehicle.photo }}
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : null}
                                        </View>
                                    </View>
                                )}

                                {/* Seção do Motorista */}
                                <View style={styles.driverSection}>
                                    {/* Foto e nome lado a lado */}
                                    <View style={styles.driverInfoRow}>
                                        {driverInfo.photo ? (
                                            <Image
                                                source={{ uri: driverInfo.photo }}
                                                style={styles.driverPhoto}
                                            />
                                        ) : (
                                            <View style={[styles.driverPhoto, styles.driverPhotoPlaceholder]}>
                                                <Ionicons name="person" size={32} color="#666" />
                                            </View>
                                        )}
                                        <View style={styles.driverNameContainer}>
                                            <Typography variant="h3" weight="bold" color={theme.text}>
                                                {driverInfo.name || 'Motorista'}
                                            </Typography>
                                            {/* Rating e Top Rated */}
                                            <View style={styles.driverRatingRow}>
                                                {driverInfo.rating && (
                                                    <View style={styles.ratingContainer}>
                                                        <Ionicons name="star" size={14} color="#FFD700" />
                                                        <Typography variant="caption" weight="medium" color={theme.text} style={{ marginLeft: 4 }}>
                                                            {driverInfo.rating.toFixed(1)}
                                                        </Typography>
                                                    </View>
                                                )}
                                                <Typography variant="caption" color={theme.textSecondary || '#666'} style={{ marginLeft: 8 }}>
                                                    Top Rated Driver
                                                </Typography>
                                                <Ionicons name="trophy" size={14} color="#FFD700" style={{ marginLeft: 4 }} />
                                            </View>
                                        </View>
                                    </View>

                                    {/* Ícones de comunicação (direita) */}
                                    <View style={styles.communicationIcons}>
                                        <TouchableOpacity
                                            style={styles.communicationIcon}
                                            onPress={() => {
                                                if (driverInfo.phone) {
                                                    Linking.openURL(`tel:${driverInfo.phone}`);
                                                }
                                            }}
                                        >
                                            <Ionicons name="call" size={20} color={theme.text || '#000'} />
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={styles.communicationIcon}
                                            onPress={() => {
                                                // Abrir chat/mensagem
                                                Logger.log('Abrir chat com motorista');
                                            }}
                                        >
                                            <Ionicons name="chatbubble" size={20} color={theme.text || '#000'} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>

                            {/* ✅ 4. Card de Endereços (separado) */}
                            <View style={[styles.addressCard, { backgroundColor: safeTheme.card }]}>
                                {/* Endereço de partida */}
                                {tripdata.pickup && tripdata.pickup.add && (
                                    <View style={styles.addressRowWithLine}>
                                        <View style={styles.addressLineContainer}>
                                            <View style={[styles.addressDot, { backgroundColor: '#41D274' }]} />
                                            <View style={styles.addressLine} />
                                        </View>
                                        <View style={styles.addressTextContainer}>
                                            <Typography variant="caption" color={theme.textSecondary || '#666'}>
                                                Start Location
                                            </Typography>
                                            <Typography variant="body" weight="medium" color={theme.text}>
                                                {tripdata.pickup.add}
                                            </Typography>
                                        </View>
                                    </View>
                                )}

                                {/* Endereço de destino */}
                                {tripdata.drop && tripdata.drop.add && (
                                    <View style={styles.addressRowWithLine}>
                                        <View style={styles.addressLineContainer}>
                                            <View style={[styles.addressDot, { backgroundColor: '#000' }]} />
                                        </View>
                                        <View style={styles.addressTextContainer}>
                                            <Typography variant="caption" color={theme.textSecondary || '#666'}>
                                                Your Destination
                                            </Typography>
                                            <Typography variant="body" weight="medium" color={theme.text}>
                                                {tripdata.drop.add}
                                            </Typography>
                                        </View>
                                    </View>
                                )}
                            </View>

                            {/* ✅ NOVO: Lista de mensagens do chat (apenas quando corrida aceita) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && chatMessages.length > 0 && (
                                <View style={[styles.chatMessagesContainer, { backgroundColor: safeTheme.background, marginTop: 12, marginBottom: 8 }]}>
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
                                                            ? (theme.primary || '#41D274')
                                                            : safeTheme.card,
                                                        alignSelf: msg.isOwn ? 'flex-end' : 'flex-start'
                                                    }
                                                ]}
                                            >
                                                <Typography variant="body" color={msg.isOwn ? '#FFFFFF' : theme.text}>
                                                    {msg.text}
                                                </Typography>
                                                <Typography variant="caption" color={msg.isOwn ? 'rgba(255,255,255,0.7)' : theme.textSecondary || '#666'} style={{ fontSize: 10, marginTop: 2 }}>
                                                    {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* ✅ Campo "Enviar mensagem" (apenas quando corrida aceita) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && (
                                <View style={styles.messageInputContainer}>
                                    <TextInput
                                        style={[styles.messageInput, {
                                            backgroundColor: safeTheme.background,
                                            color: theme.text,
                                            borderColor: theme.border || '#DDD'
                                        }]}
                                        placeholder="Enviar mensagem"
                                        placeholderTextColor={theme.textSecondary || '#999'}
                                        value={messageText}
                                        onChangeText={setMessageText}
                                        multiline={false}
                                    />
                                    <TouchableOpacity
                                        style={styles.sendMessageButton}
                                        onPress={handleSendMessage}
                                        disabled={!messageText.trim()}
                                    >
                                        <Ionicons
                                            name="send"
                                            size={20}
                                            color={messageText.trim() ? '#41D274' : '#CCC'}
                                        />
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* ✅ 7. Botão de cancelar */}
                            <AnimatedButton
                                title="Cancelar"
                                variant="danger"
                                onPress={handleCancelBooking}
                                fullWidth
                            />
                        </ScrollView>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ FASE 3: Corrida em andamento (a caminho do destino)
        if (tripStatus === 'started') {
            // Calcular estimativa de chegada (usar tempo estimado da rota ou calcular)
            let estimatedArrivalTime = '--:--';
            if (carEstimates[selectedCarType?.name]?.time) {
                const arrivalTimestamp = Date.now() + (carEstimates[selectedCarType?.name].time * 1000);
                estimatedArrivalTime = new Date(arrivalTimestamp).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            }

            return (
                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={snapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* Header: Foto do perfil + A caminho de [destino] */}
                            <View style={styles.bottomSheetHeader}>
                                <View style={styles.headerTitleRow}>
                                    <View style={styles.driverPhotoContainerHeader}>
                                        {driverInfo?.photo ? (
                                            <Image
                                                source={{ uri: driverInfo.photo }}
                                                style={styles.driverPhotoHeader}
                                            />
                                        ) : (
                                            <View style={[styles.driverPhotoHeader, styles.driverPhotoPlaceholder]}>
                                                <Ionicons name="person" size={24} color="#666" />
                                            </View>
                                        )}
                                    </View>
                                    <Typography variant="h2" weight="bold" color={theme.text} style={{ marginLeft: 12 }}>
                                        A caminho de {tripdata.drop?.add || 'destino'}
                                    </Typography>
                                </View>
                                {/* Estimativa de chegada centralizada abaixo do título */}
                                <View style={styles.estimatedTimeContainer}>
                                    <Typography variant="caption" color={theme.textSecondary || '#666'} align="center">
                                        Estimativa de chegada às {estimatedArrivalTime}
                                    </Typography>
                                </View>
                            </View>

                            {/* Layout compacto: Marca/Modelo/Cor + Foto do carro lado a lado, Placa abaixo */}
                            {driverInfo?.vehicle && (
                                <View style={styles.driverCompactContainer}>
                                    {/* Linha 1: Marca Modelo Cor (esquerda) - Foto do carro (direita) */}
                                    <View style={styles.vehicleInfoPhotoRow}>
                                        {/* Informações do veículo (esquerda) */}
                                        <View style={styles.vehicleInfoContainer}>
                                            <Typography variant="body" weight="bold" color={theme.text}>
                                                {[
                                                    driverInfo.vehicle.brand,
                                                    driverInfo.vehicle.model,
                                                    driverInfo.vehicle.color
                                                ].filter(Boolean).join(' ')}
                                            </Typography>
                                            {/* Placa exatamente abaixo */}
                                            {driverInfo.vehicle?.plate && (
                                                <Typography variant="h3" weight="bold" color={theme.text} style={styles.vehiclePlate}>
                                                    {driverInfo.vehicle.plate}
                                                </Typography>
                                            )}
                                        </View>

                                        {/* Foto do carro (direita) */}
                                        <View style={styles.carPhotoContainerSide}>
                                            {driverInfo.vehicle.model?.toLowerCase().includes('corolla') &&
                                                (driverInfo.vehicle.color?.toLowerCase().includes('prata') ||
                                                    driverInfo.vehicle.color?.toLowerCase().includes('branco')) ? (
                                                <Image
                                                    source={
                                                        driverInfo.vehicle.color?.toLowerCase().includes('prata')
                                                            ? require('../../../assets/cars/toyota/Corolla/prata.png')
                                                            : require('../../../assets/cars/toyota/Corolla/branco.png')
                                                    }
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : driverInfo.vehicle.photo ? (
                                                <Image
                                                    source={{ uri: driverInfo.vehicle.photo }}
                                                    style={styles.carPhotoSide}
                                                    resizeMode="contain"
                                                />
                                            ) : null}
                                        </View>
                                    </View>
                                </View>
                            )}

                            {/* ✅ NOVO: Lista de mensagens do chat (apenas quando corrida aceita/iniciada) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && chatMessages.length > 0 && (
                                <View style={[styles.chatMessagesContainer, { backgroundColor: safeTheme.background, marginTop: 12, marginBottom: 8 }]}>
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
                                                            ? (theme.primary || '#41D274')
                                                            : safeTheme.card,
                                                        alignSelf: msg.isOwn ? 'flex-end' : 'flex-start'
                                                    }
                                                ]}
                                            >
                                                <Typography variant="body" color={msg.isOwn ? '#FFFFFF' : theme.text}>
                                                    {msg.text}
                                                </Typography>
                                                <Typography variant="caption" color={msg.isOwn ? 'rgba(255,255,255,0.7)' : theme.textSecondary || '#666'} style={{ fontSize: 10, marginTop: 2 }}>
                                                    {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </Typography>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* ✅ Campo "Enviar mensagem" (apenas quando corrida aceita/iniciada) */}
                            {(tripStatus === 'accepted' || tripStatus === 'started') && (
                                <View style={styles.messageInputContainer}>
                                    <TextInput
                                        style={[styles.messageInput, {
                                            backgroundColor: safeTheme.background,
                                            color: theme.text,
                                            borderColor: theme.border || '#DDD'
                                        }]}
                                        placeholder="Enviar mensagem"
                                        placeholderTextColor={theme.textSecondary || '#999'}
                                        value={messageText}
                                        onChangeText={setMessageText}
                                        multiline={false}
                                    />
                                    <TouchableOpacity
                                        style={styles.sendMessageButton}
                                        onPress={handleSendMessage}
                                        disabled={!messageText.trim()}
                                    >
                                        <Ionicons
                                            name="send"
                                            size={20}
                                            color={messageText.trim() ? '#41D274' : '#CCC'}
                                        />
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Botões de ação */}
                            <View style={styles.actionButtonsContainer}>
                                <TouchableOpacity
                                    style={styles.actionButton}
                                    onPress={handleReportProblem}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="alert-circle-outline" size={20} color="#FFFFFF" />
                                    <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>
                                        Reportar um problema
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.actionButton}
                                    onPress={handleChangeDestination}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons name="location-outline" size={20} color="#FFFFFF" />
                                    <Text style={[styles.actionButtonText, { color: '#FFFFFF' }]}>
                                        Alterar destino
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* ✅ Botão de cancelar - sempre disponível */}
                            <AnimatedButton
                                title="Cancelar"
                                variant="danger"
                                onPress={handleCancelBooking}
                                fullWidth
                            />
                        </ScrollView>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ FASE 4: Corrida concluída - Avaliação
        if (tripStatus === 'completed') {
            const availableOptions = getRatingOptionsForRating();

            return (
                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={snapPoints}
                    enablePanDownToClose={false}
                    enableDismissOnClose={false}
                    enableContentPanningGesture={false}
                    enableHandlePanningGesture={false}
                    enableOverDrag={false}
                    activeOffsetY={[-9999]}
                    failOffsetY={[-9999]}
                    backdropComponent={renderBackdrop}
                    backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: '#FFFFFF' }]} // ✅ Fundo branco
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <BottomSheetView style={styles.bottomSheetContent}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            {/* Header */}
                            <View style={[styles.bottomSheetHeader, { alignItems: 'center' }]}>
                                <Text style={[styles.bottomSheetTitle, { color: theme.text, textAlign: 'center' }]}>
                                    Como foi sua viagem?
                                </Text>
                                <Text style={[styles.bottomSheetSubtitle, { color: theme.textSecondary || '#666', textAlign: 'center' }]}>
                                    Avalie sua experiência com {driverInfo?.name || 'o motorista'}
                                </Text>
                            </View>

                            {/* Estrelas de avaliação */}
                            <View style={styles.ratingStarsContainer}>
                                {[1, 2, 3, 4, 5].map((star) => (
                                    <TouchableOpacity
                                        key={star}
                                        style={styles.ratingStarButton}
                                        onPress={() => setRating(star)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons
                                            name={star <= rating ? 'star' : 'star-outline'}
                                            size={32}
                                            color={star <= rating ? '#FFD700' : '#CCCCCC'}
                                        />
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Texto da avaliação */}
                            {rating > 0 && (
                                <View style={styles.ratingTextContainer}>
                                    <Text style={styles.ratingText}>
                                        {rating >= 5 ? 'Excelente!' : rating >= 4 ? 'Muito bom!' : rating >= 3 ? 'Bom' : rating >= 2 ? 'Regular' : 'Ruim'}
                                    </Text>
                                </View>
                            )}

                            {/* Opções de avaliação (apenas se rating >= 3) */}
                            {rating >= 3 && availableOptions.length > 0 && (
                                <View style={styles.ratingOptionsContainer}>
                                    <Text style={[styles.ratingOptionsTitle, { color: theme.text }]}>
                                        {rating >= 5 ? 'O que você mais gostou?' : 'O que poderia ser melhor?'}
                                    </Text>
                                    <View style={styles.ratingOptionsGrid}>
                                        {availableOptions.map((option) => (
                                            <TouchableOpacity
                                                key={option}
                                                style={[
                                                    styles.ratingOptionButton,
                                                    ratingOptions.includes(option) && styles.ratingOptionButtonSelected
                                                ]}
                                                onPress={() => toggleRatingOption(option)}
                                                activeOpacity={0.7}
                                            >
                                                <Text style={[
                                                    styles.ratingOptionText,
                                                    ratingOptions.includes(option) && styles.ratingOptionTextSelected
                                                ]}>
                                                    {option}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            )}

                            {/* Campo de comentário */}
                            {rating > 0 && (
                                <View style={styles.ratingCommentContainer}>
                                    <Text style={[styles.ratingCommentLabel, { color: theme.text }]}>
                                        {rating <= 2 ? 'O que aconteceu?' : 'Comentários adicionais (opcional)'}
                                    </Text>
                                    <TextInput
                                        style={[styles.ratingCommentInput, {
                                            backgroundColor: safeTheme.background,
                                            color: theme.text,
                                            borderColor: theme.border || '#DDD'
                                        }]}
                                        placeholder={rating <= 2 ? 'Descreva o problema...' : 'Deixe um comentário...'}
                                        placeholderTextColor={theme.textSecondary || '#999'}
                                        value={ratingComment}
                                        onChangeText={setRatingComment}
                                        multiline
                                        numberOfLines={4}
                                        maxLength={500}
                                    />
                                    <Text style={[styles.ratingCommentCounter, { color: theme.textSecondary || '#999' }]}>
                                        {ratingComment.length}/500 caracteres
                                    </Text>
                                </View>
                            )}

                            {/* Botões de ação */}
                            <View style={styles.ratingActionsContainer}>
                                <TouchableOpacity
                                    style={[styles.ratingSubmitButton, (!rating || isSubmittingRating) && styles.ratingSubmitButtonDisabled]}
                                    onPress={handleRatingSubmit}
                                    disabled={!rating || isSubmittingRating}
                                    activeOpacity={0.8}
                                >
                                    {isSubmittingRating ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <Text style={styles.ratingSubmitButtonText}>
                                            Enviar Avaliação
                                        </Text>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.ratingSkipButton}
                                    onPress={handleSkipRating}
                                    activeOpacity={0.8}
                                >
                                    <Text style={[styles.ratingSkipButtonText, { color: theme.textSecondary || '#666' }]}>
                                        Pular
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </ScrollView>
                    </BottomSheetView>
                </BottomSheet>
            );
        }

        // ✅ ESTADO PADRÃO: Escolher veículo (idle)
        return (
            <BottomSheet
                ref={bottomSheetRef}
                index={0}
                snapPoints={snapPoints}
                enablePanDownToClose={false}
                enableDismissOnClose={false}
                enableContentPanningGesture={false}
                backdropComponent={renderBackdrop}
                backgroundStyle={[styles.bottomSheetBackground, { backgroundColor: safeTheme.card }]}
                handleIndicatorStyle={styles.bottomSheetIndicator}
                keyboardBehavior="fillParent"
                keyboardBlurBehavior="restore"
            >
                <BottomSheetView style={styles.bottomSheetContent}>
                    <View style={[styles.bottomSheetHeader, { alignItems: 'center', marginTop: -8 }]}>
                        <Text style={[styles.bottomSheetTitle, { color: theme.text, textAlign: 'center' }]}>
                            Selecione a opção abaixo
                        </Text>
                    </View>

                    <View style={styles.marginTopSmall}>
                        {carTypesToUse.map((car, index) => {
                            const estimate = getEstimateForCar(car);
                            const pickupTime = getPickupTime(car);

                            // ✅ Verificar se não há motoristas disponíveis
                            // Verificar primeiro se há motoristas em geral, depois se há motoristas do tipo específico
                            const hasAnyDrivers = nearbyDrivers && nearbyDrivers.length > 0;
                            const hasDriversForThisCarType = pickupTime !== null && pickupTime !== undefined;
                            const noDriversAvailable = !hasAnyDrivers; // Só mostrar "não há motoristas" se não houver nenhum

                            // ✅ Log para debug (habilitado temporariamente)
                            Logger.log(`🔍 [Card ${car.name}] Debug:`, {
                                hasAnyDrivers,
                                hasDriversForThisCarType,
                                noDriversAvailable,
                                nearbyDriversCount: nearbyDrivers?.length || 0,
                                pickupTime,
                                nearbyDrivers: nearbyDrivers?.map(d => ({
                                    id: d.id?.substring(0, 8),
                                    carType: d.carType,
                                    distance: d.distance
                                })) || []
                            });

                            // ✅ CORREÇÃO: arrivalTime deve ser a estimativa de CHEGADA AO DESTINO
                            // Usar o tempo da rota (estimate.time) que vem da Google Directions API
                            // Este é o tempo estimado da viagem completa (embarque -> destino)
                            let arrivalTime = null;
                            const routeTimeInSeconds = estimate.time || 0; // Tempo da rota em segundos

                            if (routeTimeInSeconds > 0) {
                                // Calcular: horário atual + tempo até motorista chegar + tempo da viagem
                                const now = Date.now();
                                const pickupTimeMs = (pickupTime && pickupTime > 0 ? pickupTime : 0) * 60 * 1000; // Tempo até motorista chegar (minutos -> ms)
                                const routeTimeMs = routeTimeInSeconds * 1000; // Tempo da viagem (segundos -> ms)
                                const totalTimeMs = pickupTimeMs + routeTimeMs; // Tempo total até chegar ao destino

                                if (totalTimeMs > 60000) { // Pelo menos 1 minuto no futuro
                                    const arrivalTimestamp = now + totalTimeMs;
                                    const arrivalDate = new Date(arrivalTimestamp);

                                    arrivalTime = arrivalDate.toLocaleTimeString('pt-BR', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        hour12: false
                                    });

                                    // Logger.log(`⏰ [Card] Calculando horário de chegada ao DESTINO:`, {
                                    //     pickupTime,
                                    //     routeTimeSeconds: routeTimeInSeconds,
                                    //     routeTimeMinutes: Math.round(routeTimeInSeconds / 60),
                                    //     totalTimeMinutes: Math.round(totalTimeMs / 60000),
                                    //     now: new Date(now).toLocaleTimeString('pt-BR'),
                                    //     arrivalTime
                                    // });
                                } else {
                                    // Logger.warn(`⚠️ [Card] Tempo total muito pequeno: ${Math.round(totalTimeMs / 60000)} minutos`);
                                }
                            } else {
                                // Logger.warn(`⚠️ [Card] Tempo da rota não disponível (estimate.time = ${routeTimeInSeconds})`);
                            }

                            // ✅ CORREÇÃO: Só renderizar card se o preço estiver calculado (não null, não min_fare)
                            const hasValidPrice = estimate.fare !== null &&
                                estimate.fare !== undefined &&
                                estimate.fare !== '0' &&
                                !isCalculatingRoute;
                            if (!hasValidPrice) {
                                return null; // Não renderizar card até o preço estar calculado
                            }

                            const isLast = index === carTypesToUse.length - 1;
                            const isSelected = selectedCarType?.name === car.name;

                            return (
                                <React.Fragment key={car.id || index}>
                                    <TouchableOpacity
                                        style={[
                                            styles.bottomSheetCarOption,
                                            { backgroundColor: safeTheme.card },
                                            isSelected && styles.bottomSheetCarOptionSelected
                                        ]}
                                        onPress={() => handleCarSelection(car)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.bottomSheetCarRow}>
                                            {car.name === 'Leaf Plus' ? (
                                                <Image
                                                    source={require('../../../assets/images/LEAF PLUS - ICON.png')}
                                                    style={styles.bottomSheetCarImage}
                                                />
                                            ) : car.name === 'Leaf Elite' ? (
                                                <Image
                                                    source={require('../../../assets/images/LEAF ELITE - ICON.png')}
                                                    style={styles.bottomSheetCarImage}
                                                />
                                            ) : (
                                                <Image
                                                    source={{ uri: car.image }}
                                                    style={styles.bottomSheetCarImage}
                                                />
                                            )}
                                            <View style={styles.bottomSheetCarInfo}>
                                                <View style={styles.bottomSheetCarHeader}>
                                                    <Text style={[styles.bottomSheetCarName, { color: theme.text }]}>
                                                        {car.name}
                                                    </Text>
                                                    <Text style={[styles.bottomSheetCarPrice, { color: theme.text }]}>
                                                        {estimate.fare !== null && estimate.fare !== undefined && estimate.fare !== '0' ?
                                                            `${settings?.symbol || 'R$'}${estimate.fare}` :
                                                            '--'
                                                        }
                                                    </Text>
                                                </View>

                                                <View style={styles.bottomSheetCarDetails}>
                                                    {noDriversAvailable ? (
                                                        <View style={styles.bottomSheetCarDetailItem}>
                                                            <Ionicons name="alert-circle-outline" size={16} color={safeTheme.icon} style={styles.iconMarginRight} />
                                                            <Text style={[styles.bottomSheetCarDetailText, { color: theme.textSecondary }]}>
                                                                Não há motoristas disponíveis
                                                            </Text>
                                                        </View>
                                                    ) : !hasDriversForThisCarType ? (
                                                        // ✅ Há motoristas disponíveis, mas não do tipo específico deste carro
                                                        <View style={styles.bottomSheetCarDetailItem}>
                                                            <Ionicons name="information-circle-outline" size={16} color={safeTheme.icon} style={styles.iconMarginRight} />
                                                            <Text style={[styles.bottomSheetCarDetailText, { color: theme.textSecondary }]}>
                                                                {nearbyDrivers.length} motorista{nearbyDrivers.length > 1 ? 's' : ''} disponível{nearbyDrivers.length > 1 ? 'eis' : ''} (sem {car.name})
                                                            </Text>
                                                        </View>
                                                    ) : (
                                                        <>
                                                            {/* ✅ Só mostrar "Chegada às" se houver motoristas e tempo calculado */}
                                                            {arrivalTime && (
                                                                <View style={styles.bottomSheetCarDetailItem}>
                                                                    <Ionicons name="time-outline" size={16} color={safeTheme.icon} style={styles.iconMarginRight} />
                                                                    <Text style={[styles.bottomSheetCarDetailText, { color: theme.textSecondary }]}>
                                                                        Chegada às {arrivalTime}
                                                                    </Text>
                                                                </View>
                                                            )}
                                                            {/* ✅ Só mostrar "Embarque em" se houver motoristas e tempo calculado */}
                                                            {pickupTime !== null && pickupTime !== undefined && (
                                                                <View style={[styles.bottomSheetCarDetailItem, styles.bottomSheetCarDetailItemRight]}>
                                                                    <Ionicons name="car-outline" size={16} color={safeTheme.icon} style={styles.iconMarginRight} />
                                                                    <Text style={[styles.bottomSheetCarDetailText, { color: theme.textSecondary }]}>
                                                                        {pickupTime < 3 ? 'Embarque rápido' : `Partida em ${pickupTime} min`}
                                                                    </Text>
                                                                </View>
                                                            )}
                                                        </>
                                                    )}
                                                </View>
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                    {!isLast && <View style={styles.bottomSheetCarDivider} />}
                                </React.Fragment>
                            );
                        })}
                    </View>

                    <AnimatedButton
                        title={tripStatus === 'idle' ? 'Pedir agora' : tripStatus === 'completed' ? 'Confirmar pagamento' : 'Solicitar'}
                        variant="primary"
                        onPress={tripStatus === 'completed' ? handlePaymentConfirmation : initiateBooking}
                        disabled={!hasValidTripEndpoints || !selectedCarType || !carEstimates[selectedCarType?.name]?.estimateFare || tripStatus === 'accepted' || tripStatus === 'started'}
                        loading={bookModelLoading}
                    />
                </BottomSheetView>
            </BottomSheet>
        );
    };

    const BookButton = useMemo(() => {
        // Usar tipos fixos (Leaf Plus e Leaf Elite) - EXATAMENTE COMO NO MAPSCREEN
        const carTypesToUse = fixedCarTypes || [];

        // SEMPRE mostrar botão quando há rota (CORREÇÃO IMPLEMENTADA)
        if (!hasValidTripEndpoints) return null;

        const canBook = selectedCarType && carEstimates[selectedCarType.name]?.estimateFare;

        // Determinar texto e estado do botão baseado no status da viagem
        const getButtonText = () => {
            // ✅ Se localização foi negada, mostrar mensagem específica
            if (locationDenied) {
                return 'Ative a localização para solicitar uma corrida';
            }

            // Se não há carros disponíveis, mostrar mensagem específica
            if (carTypesToUse.length === 0) {
                return 'Nenhum carro disponível na região';
            }

            switch (tripStatus) {
                case 'idle':
                    return `Solicitar ${selectedCarType?.name || 'Carro'} - ${settings?.symbol || 'R$'}${(carEstimates[selectedCarType?.name]?.estimateFare || 0).toFixed(2)}`;
                case 'searching':
                    return 'Procurando motoristas...';
                case 'accepted':
                    return 'Motorista a caminho!';
                case 'started':
                    return 'Viagem em andamento';
                case 'completed':
                    return 'Confirmar pagamento';
                default:
                    return 'Solicitar';
            }
        };

        const getButtonStyle = () => {
            const baseStyle = [styles.bookButton];

            if (carTypesToUse.length === 0) {
                baseStyle.push(styles.bookButtonNoCars);
            } else if (!canBook || bookModelLoading) {
                baseStyle.push(styles.bookButtonDisabled);
            } else if (tripStatus === 'searching') {
                baseStyle.push(styles.bookButtonSearching);
            } else if (tripStatus === 'accepted') {
                baseStyle.push(styles.bookButtonAccepted);
            } else if (tripStatus === 'started') {
                baseStyle.push(styles.bookButtonStarted);
            } else if (tripStatus === 'completed') {
                baseStyle.push(styles.bookButtonCompleted);
            }

            return baseStyle;
        };

        // ✅ Desabilitar botão se localização foi negada ou outras condições
        const isDisabled = locationDenied || carTypesToUse.length === 0 || !canBook || bookModelLoading || tripStatus === 'accepted' || tripStatus === 'started';

        return (
            <View
                ref={bookButtonContainerRef}
                style={styles.bookButtonContainer}
            >
                <TouchableOpacity
                    style={getButtonStyle()}
                    onPress={tripStatus === 'completed' ? handlePaymentConfirmation : initiateBooking}
                    disabled={isDisabled}
                >
                    <Text style={styles.bookButtonText}>
                        {bookModelLoading ? t('loading') : getButtonText()}
                    </Text>
                    {carTypesToUse.length > 0 && selectedCarType && tripStatus === 'idle' && (
                        <Text style={styles.bookButtonSubtext}>
                            {carEstimates[selectedCarType.name]?.estimateTime ?
                                `Partida em ${Math.max(5, Math.min(15, Math.ceil(carEstimates[selectedCarType.name].estimateTime / 120)))} minutos` :
                                'Tempo sob consulta'
                            }
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        );
    }, [selectedCarType, carEstimates, bookModelLoading, tripStatus, t, initiateBooking, settings?.symbol, locationDenied, hasValidTripEndpoints]);

    // Função para confirmar pagamento
    // Funções auxiliares para status da viagem
    const getTripStatusIcon = () => {
        switch (tripStatus) {
            case 'searching': return 'search';
            case 'accepted': return 'car';
            case 'started': return 'play';
            case 'completed': return 'checkmark-circle';
            default: return 'information-circle';
        }
    };

    const getTripStatusColor = () => {
        switch (tripStatus) {
            case 'searching': return '#FFA500'; // Laranja
            case 'accepted': return '#4CAF50'; // Verde
            case 'started': return '#2196F3'; // Azul
            case 'completed': return '#9C27B0'; // Roxo
            default: return '#757575'; // Cinza
        }
    };

    const getTripStatusTitle = () => {
        switch (tripStatus) {
            case 'searching': return 'Procurando Motoristas';
            case 'accepted': return 'Motorista Confirmado';
            case 'started': return 'Viagem em Andamento';
            case 'completed': return 'Viagem Finalizada';
            default: return 'Status da Viagem';
        }
    };

    const getTripStatusMessage = () => {
        switch (tripStatus) {
            case 'searching': return 'Estamos procurando motoristas próximos para você...';
            case 'accepted': return 'Seu motorista está a caminho!';
            case 'started': return 'Acompanhe sua viagem em tempo real';
            case 'completed': return 'Confirme o pagamento para finalizar';
            default: return 'Aguardando ação';
        }
    };

    const handlePaymentConfirmation = async () => {
        if (!currentBooking) {
            Alert.alert('Erro', 'Nenhuma reserva encontrada');
            return;
        }

        try {
            setBookModelLoading(true);

            // 🚀 VERIFICAR SE DEVE USAR BYPASS DE PAGAMENTO
            const shouldUseBypass = await PaymentBypassService.shouldUseBypass();

            if (shouldUseBypass) {
                Logger.log('🧪 BYPASS: Usando bypass de pagamento para customer de teste');

                const paymentData = {
                    bookingId: currentBooking.id,
                    amount: currentBooking.estimate,
                    method: 'credit_card',
                    passengerId: 'test-customer-dev',
                    passengerName: 'Customer de Teste'
                };

                const result = await PaymentBypassService.simulatePaymentSuccess(paymentData);

                if (result.success) {
                    Logger.log('✅ Pagamento simulado com sucesso:', result);

                    // Atualizar status da viagem
                    setTripStatus('idle');
                    setCurrentBooking(null);
                    setDriverInfo(null);
                    setDriverLocation(null);

                    Alert.alert(
                        'Pagamento Confirmado!',
                        `Pagamento simulado com sucesso!\nValor: R$ ${result.amount}\n\nObrigado por usar a Leaf!`,
                        [{ text: 'OK' }]
                    );
                } else {
                    throw new Error('Falha no pagamento simulado');
                }

                setBookModelLoading(false);
                return;
            }

            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }

            // NOVO SISTEMA: Processar pagamento antecipado via WebSocket
            const passengerId = auth.uid
                || auth.profile?.uid
                || auth.profile?.id
                || auth.user?.uid;
            if (!passengerId) {
                throw new Error('Não foi possível identificar o usuário para processar o pagamento.');
            }
            const passengerName = auth.profile?.name
                || auth.profile?.displayName
                || auth.profile?.profile?.name
                || auth.user?.name
                || 'Passageira Leaf';
            const passengerEmail = auth.profile?.email
                || auth.profile?.profile?.email
                || auth.user?.email
                || 'passageiro@leaf.app.br';

            const paymentData = {
                bookingId: currentBooking.id,
                amount: currentBooking.estimate,
                passengerId,
                passengerName,
                passengerEmail,
                rideDetails: {
                    origin: currentBooking.pickup?.address
                        || currentBooking.pickup?.add
                        || tripdata.pickup?.add
                        || 'Origem não informada',
                    destination: currentBooking.destination?.address
                        || currentBooking.drop?.add
                        || tripdata.drop?.add
                        || 'Destino não informado'
                }
            };

            const result = await webSocketManager.processPayment(paymentData);

            if (result.success) {
                Logger.log('✅ Pagamento antecipado processado:', result);

                // Confirmar pagamento após processamento
                const confirmResult = await webSocketManager.confirmPayment({
                    bookingId: currentBooking.id,
                    chargeId: result.paymentId
                });

                if (confirmResult.success) {
                    Logger.log('✅ Pagamento confirmado e em holding:', confirmResult);

                    // Após confirmação de pagamento, mostrar modal de avaliação
                    // (mas apenas se a viagem foi realmente finalizada)
                    if (tripStatus === 'completed') {
                        // Aguardar um pouco para o usuário processar a confirmação
                        setTimeout(() => {
                            showRatingModal();
                        }, 2000);
                    }
                } else {
                    throw new Error(confirmResult.error || 'Falha ao confirmar pagamento');
                }
            } else {
                throw new Error(result.error || 'Falha ao processar pagamento antecipado');
            }

        } catch (error) {
            Logger.error('❌ Erro ao processar pagamento:', error);
            Alert.alert('Erro', error.message || 'Falha ao processar pagamento');
        } finally {
            setBookModelLoading(false);
        }
    };

    // ✅ Função para lidar com avaliação da viagem (integrada na bottom sheet)
    const handleRatingSubmit = useCallback(async () => {
        // ✅ Salvar avaliação no TripDataService (será salvo após sucesso)
        if (rating === 0) {
            Alert.alert('Atenção', 'Por favor, selecione uma avaliação');
            return;
        }

        setIsSubmittingRating(true);

        try {
            const ratingData = {
                tripId: currentBooking?.bookingId || currentBooking?.id,
                userId: auth.profile?.uid || auth.profile?.id || auth.user?.uid,
                rating,
                selectedOptions: ratingOptions,
                comment: ratingComment.trim(),
                userType: 'customer',
                timestamp: new Date().toISOString(),
                tripData: currentBooking
            };

            // Importar RatingService
            const RatingService = require('../../services/RatingService').default;

            // Enviar avaliação
            const result = await RatingService.submitRating(ratingData);

            if (result.success) {
                Logger.log('✅ Avaliação enviada com sucesso');

                // ✅ Salvar avaliação no TripDataService
                if (currentBooking?.bookingId) {
                    TripDataService.saveRating(currentBooking.bookingId, {
                        driverRating: rating,
                        passengerRating: null, // Passageiro avalia motorista
                        driverComment: ratingComment,
                        passengerComment: null,
                        driverOptions: ratingOptions,
                        passengerOptions: []
                    }).catch(err => {
                        Logger.warn('⚠️ [PassengerUI] Erro ao salvar avaliação:', err);
                    });
                }

                // Limpar todos os estados e voltar para idle
                setTripStatus('idle');
                setCurrentBooking(null);
                setDriverInfo(null);
                setDriverLocation(null);
                setDriverArrived(false);
                setEstimatedPickupTime(null);
                setDriverAcceptedAt(null);
                setEmbarkTimer(120);
                setMessageText('');
                setChatMessages([]); // ✅ NOVO: Limpar mensagens do chat
                setRating(0);
                setRatingComment('');
                setRatingOptions([]);
                setRatingModalVisible(false);

                // ✅ NOVO: Limpar polyline
                setRouteToDestinationPolyline([]);
                setDriverToPickupPolyline([]);
                if (setRoutePolyline) {
                    setRoutePolyline([]);
                }

                // ✅ Finalizar corrida
                try {
                    await RideLocationManager.endRide();
                } catch (error) {
                    Logger.warn('⚠️ [PassengerUI] Erro ao finalizar corrida:', error);
                }

                // ✅ NOVO: Notificação final
                Alert.alert(
                    '✅ Obrigado por viajar com a Leaf!',
                    'Sua avaliação foi registrada. Esperamos vê-lo novamente em breve!',
                    [{ text: 'OK' }]
                );
            } else {
                throw new Error(result.error || 'Falha ao enviar avaliação');
            }

        } catch (error) {
            Logger.error('❌ Erro ao enviar avaliação:', error);
            Alert.alert('Erro', error.message || 'Falha ao enviar avaliação');
        } finally {
            setIsSubmittingRating(false);
        }
    }, [rating, ratingComment, ratingOptions, currentBooking]);

    // ✅ Função para pular avaliação
    const handleSkipRating = useCallback(async () => {
        Alert.alert(
            'Pular Avaliação',
            'Deseja realmente pular a avaliação?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Pular',
                    style: 'destructive',
                    onPress: () => {
                        // Limpar todos os estados e voltar para idle
                        setTripStatus('idle');
                        setCurrentBooking(null);
                        setDriverInfo(null);
                        setDriverLocation(null);
                        setDriverArrived(false);
                        setEstimatedPickupTime(null);
                        setDriverAcceptedAt(null);
                        setEmbarkTimer(120);
                        setMessageText('');
                        setChatMessages([]); // ✅ NOVO: Limpar mensagens do chat
                        setRating(0);
                        setRatingComment('');
                        setRatingOptions([]);
                        setRatingModalVisible(false);

                        // ✅ NOVO: Limpar polyline
                        setRouteToDestinationPolyline([]);
                        setDriverToPickupPolyline([]);
                        if (setRoutePolyline) {
                            setRoutePolyline([]);
                        }

                        // ✅ Finalizar corrida
                        RideLocationManager.endRide().catch(error => {
                            Logger.warn('⚠️ [PassengerUI] Erro ao finalizar corrida:', error);
                        });

                        // ✅ NOVO: Notificação final
                        Alert.alert(
                            '✅ Obrigado por viajar com a Leaf!',
                            'Esperamos vê-lo novamente em breve!',
                            [{ text: 'OK' }]
                        );
                    }
                }
            ]
        );
    }, []);

    // ✅ Toggle opção de avaliação
    const toggleRatingOption = useCallback((option) => {
        setRatingOptions(prev =>
            prev.includes(option)
                ? prev.filter(item => item !== option)
                : [...prev, option]
        );
    }, []);

    // Função para mostrar modal de avaliação
    const showRatingModal = () => {
        setRatingModalVisible(true);
    };

    const handleBooking = () => {
        // Lógica de pagamento virá aqui
        Logger.log("Iniciando fluxo de pagamento e depois a reserva...");
        // bookNow(); // Chamada para a função de booking existente
    };

    return (
        <View
            style={styles.container}
            pointerEvents="box-none"
            // ✅ Prevenir ajuste automático quando teclado abre
            onLayout={(e) => {
                // Forçar que o container não se ajuste ao teclado
            }}
        >
            {/* Indicador de cálculo de rota */}
            {isCalculatingRoute && (
                <View style={styles.routeCalculationIndicator}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.routeCalculationText}>
                        Calculando rota e preços...
                    </Text>
                </View>
            )}

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={[styles.headerButton, { backgroundColor: safeTheme.card }]} onPress={() => {
                    if (navigation && navigation.navigate) {
                        navigation.navigate('Profile');
                    } else {
                        Logger.log('Menu: Navegação não disponível');
                    }
                }}>
                    <Ionicons name="menu" color={safeTheme.icon} size={24} />
                </TouchableOpacity>
                <View style={{ marginLeft: 6 }}>
                    <ProfileToggle userId={auth?.profile?.uid} style="discrete" size="small" />
                </View>
                <View style={styles.flexOne} />
                <TouchableOpacity style={[styles.headerButton, { backgroundColor: safeTheme.card, marginRight: 5 }]} onPress={props.toggleTheme}>
                    <Ionicons name={props.isDarkMode ? 'sunny' : 'moon'} color={safeTheme.icon} size={24} />
                </TouchableOpacity>


                <TouchableOpacity style={[styles.headerButton, { backgroundColor: safeTheme.card }]} onPress={() => navigation.navigate('Notifications')}>
                    <Ionicons name="notifications" color={safeTheme.icon} size={24} />
                </TouchableOpacity>
            </View>


            {AddressFields}
            {/* ✅ Dropdown agora está integrado dentro do AddressFields */}

            {/* ✅ REMOVIDO: Card flutuante sobre o mapa - todas as informações estão no bottomsheet */}



            {/* Botão temporário para mockar motoristas (REMOVER EM PRODUÇÃO) */}


            {/* Cards de estimativa de preço */}
            {renderCarOptionsCard()}

            {isPaymentModalVisible && selectedCarType && carEstimates[selectedCarType.name] && (
                <WooviPaymentModal
                    visible={isPaymentModalVisible}
                    onClose={() => {
                        setPaymentModalVisible(false);
                        // ✅ Se fechar sem pagar, não criar booking
                    }}
                    onPaymentConfirmed={onPaymentConfirmed}
                    tripData={{
                        pickup: tripdata.pickup,
                        drop: tripdata.drop,
                        carType: selectedCarType.name,
                        estimatedFare: carEstimates[selectedCarType.name]?.estimateFare || 0
                    }}
                    estimates={carEstimates[selectedCarType.name]}
                    passengerId={auth.uid}
                    passengerName={
                        auth.profile?.name
                        || auth.profile?.displayName
                        || auth.profile?.profile?.name
                        || auth.user?.name
                        || 'Passageira Leaf'
                    }
                    passengerEmail={
                        auth.profile?.email
                        || auth.profile?.profile?.email
                        || auth.user?.email
                        || 'passageiro@leaf.app.br'
                    }
                />
            )}

            {/* Modal de avaliação */}
            <RatingModal
                visible={ratingModalVisible}
                onClose={() => setRatingModalVisible(false)}
                userType="passenger"
                tripData={currentBooking}
                onSubmit={handleRatingSubmit}
            />

            {/* Modal de confirmação de cancelamento durante busca */}
            <Modal
                visible={isCancelModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setIsCancelModalVisible(false)}
            >
                <View style={styles.cancelModalOverlay}>
                    <View style={[styles.cancelModalContent, { backgroundColor: theme.card || '#FFFFFF' }]}>
                        <Text style={[styles.cancelModalTitle, { color: theme.text || '#000000' }]}>
                            Tem certeza que deseja cancelar?
                        </Text>
                        <Text style={[styles.cancelModalSubtitle, { color: theme.textSecondary || '#666666' }]}>
                            Taxas poderão ser aplicadas
                        </Text>

                        <View style={styles.cancelModalButtons}>
                            <TouchableOpacity
                                style={[styles.cancelModalButton, styles.cancelModalButtonWait, { backgroundColor: '#000000' }]}
                                onPress={() => setIsCancelModalVisible(false)}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.cancelModalButtonText, { color: '#FFFFFF' }]}>
                                    Desejo aguardar
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.cancelModalButton, styles.cancelModalButtonCancel, { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#000000' }]}
                                onPress={confirmCancelBooking}
                                activeOpacity={0.8}
                            >
                                <Text style={[styles.cancelModalButtonText, { color: '#000000' }]}>
                                    Sim, cancelar
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ✅ Modal para adicionar detalhes ao endereço aproximado */}
            {isAddressDetailsModalVisible && (
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { color: theme.text }]}>
                                Adicionar Detalhes ao Endereço
                            </Text>
                            <TouchableOpacity
                                onPress={() => {
                                    setIsAddressDetailsModalVisible(false);
                                    setAddressDetails('');
                                }}
                            >
                                <Ionicons name="close" size={24} color={theme.text} />
                            </TouchableOpacity>
                        </View>

                        <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                            {addressDetailsType === 'pickup' ? 'Endereço de partida:' : 'Endereço de destino:'}
                        </Text>
                        <Text style={[styles.modalAddress, { color: theme.text }]}>
                            {addressDetailsType === 'pickup' ? tripdata.pickup?.add : tripdata.drop?.add}
                        </Text>

                        <Text style={[styles.modalLabel, { color: theme.text }]}>
                            Adicione detalhes específicos (ex: Casa 15, Bloco A, Apto 201):
                        </Text>
                        <TextInput
                            style={[styles.modalInput, {
                                color: theme.text,
                                borderColor: theme.border || '#E0E0E0',
                                backgroundColor: theme.background || '#FFFFFF'
                            }]}
                            placeholder="Ex: Casa 15, Bloco A"
                            placeholderTextColor={theme.placeholder}
                            value={addressDetails}
                            onChangeText={setAddressDetails}
                            autoFocus={true}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonCancel, { backgroundColor: theme.surface || '#F5F5F5' }]}
                                onPress={() => {
                                    setIsAddressDetailsModalVisible(false);
                                    setAddressDetails('');
                                }}
                            >
                                <Text style={[styles.modalButtonText, { color: theme.text }]}>Cancelar</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalButton, styles.modalButtonSave, { backgroundColor: theme.leafGreen || '#41D274' }]}
                                onPress={handleSaveAddressWithDetails}
                            >
                                <Text style={[styles.modalButtonText, { color: '#FFFFFF' }]}>Salvar</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            {/* ✅ Banner de localização negada na parte inferior */}
            {locationDenied && (
                <View style={styles.locationDeniedBanner}>
                    <View style={styles.locationDeniedBannerContent}>
                        <Ionicons name="location-outline" size={20} color="#003002" style={styles.locationDeniedIcon} />
                        <Text style={styles.locationDeniedText}>
                            Ative a localização para habilitar a solicitação de corridas
                        </Text>
                        <TouchableOpacity
                            style={styles.locationDeniedButton}
                            onPress={() => {
                                if (onRequestLocationPermission) {
                                    onRequestLocationPermission();
                                }
                            }}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.locationDeniedButtonText}>Ativar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        // ✅ Container não ajusta quando teclado abre (teclado sobrepõe)
    },
    header: { position: 'absolute', top: 15, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 1000 },
    headerButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
    addressContainer: { position: 'absolute', top: 75, left: 0, right: 0, zIndex: 900, alignItems: 'center' },
    addressCardGroup: {
        borderRadius: 20,
        width: '94%',
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 8,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.03)'
    },
    addressCardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 20 },
    addressDivider: {
        height: 1,
        marginHorizontal: 18,
        backgroundColor: 'rgba(0,0,0,0.08)', // Linha suave e visível
    },
    addressIcon: { marginRight: 14 },
    addressTextContainer: {
        flex: 1,
    },
    addressText: { flex: 1, fontFamily: fonts.Bold, fontSize: 14, fontWeight: 'bold', letterSpacing: 0.1 }, // ✅ Reduzido de 16 para 14pt e adicionado fontWeight bold
    addressTextInput: {
        flex: 1,
        fontFamily: fonts.Bold,
        fontSize: 14,
        fontWeight: 'bold',
        paddingVertical: 0,
        paddingHorizontal: 0,
        height: 20,
        lineHeight: 20,
    },
    addressSubtext: { fontFamily: fonts.Regular, fontSize: 12 },
    addressPlaceholder: { flex: 1, fontFamily: fonts.Bold, fontSize: 14, fontWeight: 'bold' }, // ✅ Mesma fonte do campo de texto digitado
    // Estilos para campo de busca inline
    searchInputInline: {
        flex: 1,
        fontFamily: fonts.Bold,
        fontSize: 14, // ✅ Mesmo tamanho do campo de partida
        fontWeight: 'bold', // ✅ Negrito como o campo de partida
        paddingVertical: 0,
        minHeight: 20
    },

    // ✅ Estilos para dropdown integrado (dentro do card)
    dropdownIntegrated: {
        maxHeight: 280, // ✅ 5 resultados completos = ~280px
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.1)',
        marginHorizontal: -18, // Compensar padding do card para alinhar com bordas
        marginTop: 0,
    },
    dropdownLoadingContainer: {
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dropdownScrollView: {
        maxHeight: 280, // ✅ 5 resultados completos 280px
    },
    dropdownResultItem: {
        flexDirection: 'row',
        alignItems: 'center', // ✅ Centralizar verticalmente
        paddingVertical: 8, // ✅ Reduzido de 14 para 8 (redução de 6px em cada lado = 12px total, próximo de 10px)
        paddingHorizontal: 18, // ✅ Padding horizontal igual ao campo de endereço (addressCardRow)
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
        minHeight: 46, // ✅ Reduzido de 56 para 46 (redução de 10px)
    },
    // ✅ Estilo especial para itens com ícone (destinos recentes) - alinhar com addressCardRow
    // O dropdownIntegrated tem marginHorizontal: -18, então precisa compensar + 18px do addressCardRow
    dropdownResultItemWithIcon: {
        paddingLeft: 36, // ✅ 18px (compensação do marginHorizontal do dropdownIntegrated) + 18px (padding do addressCardRow) = 36px total
        paddingRight: 18, // ✅ Manter padding direito padrão
    },
    dropdownResultTextContainer: {
        flex: 1,
        justifyContent: 'center', // ✅ Centralizar conteúdo verticalmente
        paddingLeft: 36, // ✅ Alinhar com o texto do campo (ícone 22px + marginRight 14px = 36px)
        // ✅ Alinhar com o texto do campo de endereço (sem ícone, mas mesmo padding)
    },
    dropdownResultTopLine: {
        fontFamily: fonts.Bold,
        fontSize: 14, // ✅ Mesmo tamanho do campo de partida
        fontWeight: 'bold', // ✅ Negrito como o campo de partida
        marginBottom: 3, // ✅ Aumentar espaçamento entre linhas
        lineHeight: 18, // ✅ Altura de linha para melhor legibilidade
    },
    dropdownResultBottomLine: {
        fontFamily: fonts.Regular,
        fontSize: 12, // ✅ Mesmo tamanho da linha inferior do campo de partida
        opacity: 0.7,
        lineHeight: 16, // ✅ Altura de linha para melhor legibilidade
    },
    dropdownNoResults: {
        paddingVertical: 20,
        paddingHorizontal: 18,
        alignItems: 'center',
    },
    dropdownNoResultsText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    searchResultsDivider: {
        height: 1,
        backgroundColor: 'rgba(0,0,0,0.1)',
        marginVertical: 4,
    },
    // Estilos removidos - não são mais necessários
    loading: { marginVertical: 20 },

    // Estilos para indicador de cálculo de rota
    routeCalculationIndicator: {
        position: 'absolute',
        top: 150,
        left: 20,
        right: 20,
        zIndex: 700,
        backgroundColor: 'rgba(0,0,0,0.8)',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        flexDirection: 'row'
    },
    routeCalculationText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontFamily: fonts.Medium,
        marginLeft: 12
    },

    carOptionsContainer: {
        position: 'absolute',
        bottom: 93,
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        zIndex: 2500,
        // ✅ Card permanece fixo quando teclado abre (teclado fica por cima)
        elevation: Platform.OS === 'android' ? 5 : 0,
        // ✅ Forçar que não seja afetado por ajustes de teclado
        transform: [] // Array vazio previne transformações automáticas
    },
    // Estilos do BottomSheet
    bottomSheetBackground: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 15,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.02)',
    },
    bottomSheetIndicator: {
        backgroundColor: '#E5E5EA',
        width: 36,
        height: 5,
        borderRadius: 2.5,
    },
    bottomSheetContent: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 16,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
        paddingHorizontal: 20,
    },
    loadingText: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginTop: 20,
        textAlign: 'center',
    },
    loadingSubtext: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginTop: 8,
        textAlign: 'center',
    },
    bottomSheetHeader: {
        marginBottom: 4, // ✅ Reduzido
        paddingBottom: 4, // ✅ Reduzido
        borderBottomWidth: 0, // Remover borda para reduzir espaço
        zIndex: 10, // ✅ Garantir que fique na frente do card do veículo
        position: 'relative',
        backgroundColor: 'transparent', // ✅ Fundo transparente para não cobrir
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    driverPhotoContainerHeader: {
        marginRight: 10,
        width: 48, // ✅ Aumentado para 48
        height: 48, // ✅ Aumentado para 48
    },
    driverPhotoHeader: {
        width: 48, // ✅ Aumentado para 48
        height: 48, // ✅ Aumentado para 48
        borderRadius: 24, // ✅ Metade do tamanho para ficar redondo (48/2 = 24)
        backgroundColor: '#E0E0E0',
        overflow: 'hidden', // ✅ Garantir que a imagem fique redonda
    },
    headerTitleTextContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    driverNameContainerHeader: {
        flex: 1,
        marginLeft: 0,
    },
    driverNameOnWay: {
        fontSize: 16, // ✅ 16px conforme solicitado
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        color: '#000000', // ✅ Preto
    },
    embarkTimeText: {
        fontSize: 14, // ✅ 14px conforme solicitado
        fontFamily: fonts.Regular,
        marginTop: 2,
        color: '#666666', // ✅ Cinza
    },
    dividerLine: {
        height: 1,
        backgroundColor: 'rgba(0,0,0,0.1)', // ✅ Linha suave
        marginTop: 8,
        marginBottom: 0,
    },
    estimatedTimeContainer: {
        alignItems: 'center',
        marginTop: 2,
    },
    bottomSheetTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    bottomSheetCarOption: {
        // ✅ Estilo simples sem card - apenas padding
        paddingVertical: 12,
        paddingHorizontal: 0,
    },
    bottomSheetCarOptionSelected: {
        // ✅ Destaque quando selecionado - fundo mais visível
        backgroundColor: 'rgba(0, 48, 2, 0.1)', // Verde claro mais visível
    },
    bottomSheetCarDivider: {
        height: 1,
        backgroundColor: 'rgba(0,0,0,0.08)', // ✅ Linha tênue como no partida/destino
        marginVertical: 0,
    },
    bottomSheetCarRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bottomSheetCarImage: {
        width: 52, // ✅ Aumentado 15% (45 * 1.15 = 51.75 ≈ 52)
        height: 35, // ✅ Aumentado 15% (30 * 1.15 = 34.5 ≈ 35)
        resizeMode: 'contain',
        marginRight: 12,
        borderRadius: 6,
        backgroundColor: 'transparent', // ✅ Transparente para permitir fundo transparente do PNG
    },
    bottomSheetCarInfo: {
        flex: 1,
    },
    bottomSheetCarHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2, // ✅ Reduzido de 4 para 2
    },
    bottomSheetCarName: {
        fontSize: 14, // ✅ Reduzido de 16 para 14 (mesmo do addressText)
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    bottomSheetCarPrice: {
        fontSize: 14, // ✅ Reduzido de 16 para 14 (mesmo do addressText)
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
        paddingRight: 5, // ✅ 5px de distância da margem direita
    },
    bottomSheetCarDetails: {
        flexDirection: 'row',
        justifyContent: 'space-between', // ✅ Alinhar itens nas extremidades
        alignItems: 'center',
        marginTop: 0,
    },
    bottomSheetCarDetailItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 0,
        flex: 1, // ✅ Permitir que os itens ocupem espaço igual
    },
    bottomSheetCarDetailItemRight: {
        justifyContent: 'flex-end', // ✅ Alinhar o segundo item à direita
        paddingRight: 5, // ✅ 5px de distância da margem direita
    },
    bottomSheetCarDetailText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    bottomSheetBookButton: {
        // ✅ Mesmo tamanho e design do botão "Online" do DriverUI, mas com cor #003002
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#003002',
        borderRadius: 30,
        paddingVertical: 12, // ✅ Reduzido de 16 para 12
        paddingHorizontal: 24, // ✅ Reduzido de 32 para 24
        gap: 8, // ✅ Reduzido de 12 para 8
        minWidth: 160, // ✅ Reduzido de 200 para 160
        marginTop: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 8,
        alignSelf: 'center', // ✅ Centralizar o botão (não ocupar 100% da largura)
    },
    bottomSheetBookButtonDisabled: {
        backgroundColor: '#CCCCCC',
        opacity: 0.7,
        shadowOpacity: 0,
        elevation: 0,
    },
    bottomSheetBookButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
        textAlign: 'center',
        fontFamily: fonts.Bold,
    },
    // ✅ Estilos para estado "Procurando motoristas"
    tripTitleContainer: {
        marginBottom: 12,
        paddingBottom: 12,
    },
    tripTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        marginBottom: 8,
        paddingHorizontal: 20,
    },
    tripTitleSeparator: {
        height: 1,
        marginHorizontal: 20,
        opacity: 0.3,
    },
    searchingContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        marginTop: -10,
    },
    searchingTimer: {
        fontSize: 28,
        fontFamily: fonts.Bold,
        color: '#000000',
        fontWeight: 'bold',
        marginBottom: 8,
    },
    searchingText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
    },
    searchingMessage: {
        fontSize: 16,
        fontFamily: fonts.Medium,
        textAlign: 'center',
        marginTop: 4,
    },
    searchingCancelButtonContainer: {
        width: '100%',
        paddingTop: 8,
        paddingBottom: 8,
        marginTop: -5,
    },
    searchingTimerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderRadius: 20,
    },
    searchingTimerText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        marginLeft: 8,
    },
    bottomSheetCancelButton: {
        backgroundColor: '#000000',
        borderRadius: 12,
        paddingVertical: 16,
        paddingHorizontal: 24,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
        width: '100%',
        minHeight: 50,
    },
    bottomSheetCancelButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    // ✅ Estilos para informações do motorista
    driverInfoContainer: {
        flexDirection: 'row', // ✅ CRÍTICO: Deve ser 'row' para foto e nome ficarem lado a lado
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingVertical: 4,
        marginTop: 2,
        width: '100%',
    },
    driverPhotoContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
        width: '100%',
    },
    driverPhoto: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#F5F5F5',
        marginRight: 12,
    },
    driverName: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        flex: 1,
        marginTop: 0,
    },
    // ✅ Estilos para card principal de motorista chegou
    driverCardMain: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 12, // ✅ Reduzido de 16 para 12
        marginBottom: 8, // ✅ Reduzido de 12 para 8
        shadowColor: 'transparent', // ✅ Removida sombra
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0, // ✅ Removida elevação
    },
    // ✅ Estilos para card compacto (motorista a caminho - só veículo)
    driverCardMainCompact: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 8, // ✅ Reduzido padding
        paddingBottom: 8,
        marginBottom: 8,
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
        alignSelf: 'stretch', // ✅ Não expandir além do necessário
    },
    vehicleSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end', // ✅ Alinhar pela base
        marginBottom: 0, // ✅ Removido marginBottom
        paddingBottom: 0, // ✅ Removido padding
        borderBottomWidth: 0, // ✅ Removida borda
        borderBottomColor: 'transparent',
    },
    vehicleInfoLeft: {
        flex: 1,
        paddingBottom: 0, // ✅ Sem padding extra
    },
    vehicleTextContainer: {
        // Container para os textos, garantindo alinhamento vertical
    },
    vehiclePlateTop: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        marginBottom: 2, // ✅ Reduzido de 4 para 2
    },
    vehicleBrandModel: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    driverSection: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    driverInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    driverNameContainer: {
        flex: 1,
        marginLeft: 12,
    },
    driverRatingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2, // ✅ Reduzido de 4 para 2
        gap: 6,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    ratingText: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    topRatedText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginLeft: 4,
    },
    communicationIcons: {
        flexDirection: 'row',
        gap: 12,
        marginLeft: 12,
    },
    communicationIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.05)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    // ✅ Estilos para card de endereços
    addressCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 12, // ✅ Reduzido de 16 para 12
        marginBottom: 8, // ✅ Reduzido de 12 para 8
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    addressRowWithLine: {
        flexDirection: 'row',
        marginBottom: 10, // ✅ Reduzido de 16 para 10
    },
    addressLineContainer: {
        width: 24,
        alignItems: 'center',
        marginRight: 12,
    },
    addressDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    addressLine: {
        width: 2,
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.2)',
        marginTop: 4,
    },
    addressTextContainer: {
        flex: 1,
    },
    addressLabel: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginBottom: 4,
    },
    addressValue: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
    },
    // ✅ Estilos antigos mantidos para compatibilidade
    addressRowContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
        marginTop: 4,
    },
    addressRowIcon: {
        marginRight: 8,
    },
    addressRowText: {
        flex: 1,
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    driverInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    estimatedTimeRow: {
        marginTop: 4,
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.08)',
    },
    driverInfoText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginLeft: 12,
        flex: 1,
    },
    arrivedContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        marginTop: 6,
    },
    arrivedText: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        marginTop: 4,
        textAlign: 'center',
    },
    carOptionsMainCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5
    },
    carCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        minHeight: 80
    },
    selectedCarCard: {
        borderColor: '#41D274',
        backgroundColor: '#FFFFFF'
    },
    carImage: {
        width: 54,
        height: 38,
        resizeMode: 'contain',
        marginRight: 18,
        borderRadius: 10,
        backgroundColor: '#F5F5F5'
    },
    carInfo: {
        flex: 1,
        marginLeft: 8
    },
    carNameValue: {
        color: '#000000',
        fontSize: 16,
        fontWeight: '600',
        flex: 1
    },
    priceNameValue: {
        color: '#000000',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8
    },
    carDetailsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        width: '100%'
    },
    carSubInfo: {
        color: '#666666',
        fontSize: 14,
        flex: 1
    },
    bookButtonContainer: {
        position: 'absolute',
        bottom: 5,
        left: 0,
        right: 0,
        paddingHorizontal: 20,
        zIndex: 3000,
        // ✅ Botão permanece fixo quando teclado abre (teclado fica por cima)
        elevation: Platform.OS === 'android' ? 5 : 0,
        // ✅ Forçar que não seja afetado por ajustes de teclado
        transform: [] // Array vazio previne transformações automáticas
    },
    bookButton: {
        backgroundColor: '#41D274',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5
    },
    bookButtonDisabled: {
        backgroundColor: '#666666',
        opacity: 0.7
    },
    bookButtonNoCars: {
        backgroundColor: '#ff6b6b'
    },
    bookButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fonts.Bold
    },
    bookButtonSubtext: {
        color: '#FFFFFF',
        fontSize: 14,
        marginTop: 4,
        opacity: 0.9
    },

    // Estilos para botões de status
    bookButtonSearching: { backgroundColor: '#FFA500' },
    bookButtonAccepted: { backgroundColor: '#4CAF50' },
    bookButtonStarted: { backgroundColor: '#2196F3' },
    bookButtonCompleted: { backgroundColor: '#9C27B0' },

    // Estilos para indicador de status da viagem
    tripStatusContainer: {
        position: 'absolute',
        top: 200,
        left: 20,
        right: 20,
        zIndex: 700
    },
    tripStatusCard: {
        borderRadius: 16,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 8
    },
    tripStatusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8
    },
    tripStatusTitle: {
        fontFamily: fonts.Bold,
        fontSize: 16,
        marginLeft: 8
    },
    tripStatusMessage: {
        fontFamily: fonts.Regular,
        fontSize: 14,
        marginBottom: 12
    },
    // ✅ REMOVIDO: driverInfoContainer duplicado estava sobrescrevendo o estilo correto com flexDirection: 'row'
    // Se precisar deste estilo em outro lugar, renomeie para driverInfoContainerAlt ou similar
    driverInfoContainerAlt: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.1)',
        paddingTop: 12
    },
    driverInfoText: {
        fontFamily: fonts.Regular,
        fontSize: 12,
        marginBottom: 4
    },

    // Estilos para botão de avaliação
    ratingButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFF9C4',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#FFD700',
    },
    ratingButtonText: {
        fontFamily: fonts.Bold,
        fontSize: 14,
        color: '#FF8F00',
        marginLeft: 8,
    },

    bottomContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },





    // Estilos para mensagem de nenhum carro disponível
    noCarsMessage: {
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center'
    },
    noCarsTitle: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        marginBottom: 10,
        textAlign: 'center'
    },
    noCarsSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlign: 'center',
        marginBottom: 5,
        lineHeight: 20
    },

    // ✅ Estilos da barra de status da conexão WebSocket
    connectionStatusBar: {
        position: 'absolute',
        top: 70,
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
    devPreviewContainer: {
        position: 'absolute',
        top: 125,
        right: 16,
        zIndex: 1200,
    },
    devPreviewButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(0,48,2,0.25)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
        gap: 6,
    },
    devPreviewButtonActive: {
        backgroundColor: '#003002',
        borderColor: '#003002',
    },

    // ✅ Estilos para avaliação (Fase 4: Corrida concluída)
    bottomSheetSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        marginTop: 4,
        textAlign: 'center',
    },
    ratingStarsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 24,
        gap: 8,
    },
    ratingStarButton: {
        padding: 4,
    },
    ratingTextContainer: {
        alignItems: 'center',
        marginBottom: 16,
    },
    ratingText: {
        fontSize: 18,
        fontFamily: fonts.Bold,
        color: '#333',
    },
    ratingOptionsContainer: {
        marginTop: 8,
        marginBottom: 16,
    },
    ratingOptionsTitle: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        marginBottom: 12,
    },
    ratingOptionsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    ratingOptionButton: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: '#F5F5F5',
        borderWidth: 1,
        borderColor: '#DDD',
    },
    ratingOptionButtonSelected: {
        backgroundColor: '#41D274',
        borderColor: '#41D274',
    },
    ratingOptionText: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        color: '#333',
    },
    ratingOptionTextSelected: {
        color: '#FFFFFF',
        fontFamily: fonts.Bold,
    },
    ratingCommentContainer: {
        marginTop: 16,
        marginBottom: 24,
    },
    ratingCommentLabel: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        marginBottom: 8,
    },
    ratingCommentInput: {
        minHeight: 100,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        fontSize: 14,
        fontFamily: fonts.Regular,
        textAlignVertical: 'top',
    },
    ratingCommentCounter: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginTop: 4,
        textAlign: 'right',
    },
    ratingActionsContainer: {
        gap: 12,
        marginTop: 8,
        marginBottom: 16,
    },
    ratingSubmitButton: {
        backgroundColor: '#003002',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 50,
    },
    ratingSubmitButtonDisabled: {
        backgroundColor: '#CCCCCC',
        opacity: 0.6,
    },
    ratingSubmitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: fonts.Bold,
    },
    ratingSkipButton: {
        padding: 12,
        alignItems: 'center',
    },
    ratingSkipButtonText: {
        fontSize: 14,
        fontFamily: fonts.Regular,
    },
    devPreviewText: {
        fontFamily: fonts.Bold,
        fontSize: 12,
        color: '#003002',
    },
    devPreviewTextActive: {
        color: '#FFFFFF',
    },
    devPreviewPhaseContainer: {
        marginTop: 8,
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: 'rgba(0,48,2,0.25)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
        gap: 6,
    },
    devPreviewPhaseButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: 'rgba(0,48,2,0.06)',
    },
    devPreviewPhaseButtonActive: {
        backgroundColor: '#003002',
    },
    devPreviewPhaseText: {
        fontSize: 12,
        fontFamily: fonts.Medium,
        color: '#003002',
        textAlign: 'center',
    },
    devPreviewPhaseTextActive: {
        color: '#FFFFFF',
    },

    // ✅ Estilos para as novas fases do bottomsheet
    estimatedTimeHeader: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        color: '#333333',
    },
    driverCompactContainer: {
        marginVertical: 2,
        marginTop: 4,
    },
    driverProfileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    driverCardContainer: {
        marginVertical: 6,
    },
    driverCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 8,
        backgroundColor: '#F9F9F9',
        borderRadius: 12,
        marginBottom: 6,
    },
    driverPhotoContainer: {
        marginRight: 10,
    },
    driverPhoto: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#E0E0E0',
    },
    driverPhotoPlaceholder: {
        justifyContent: 'center',
        alignItems: 'center',
        // ✅ Removido width e height fixos - usar os do driverPhotoHeader (32x32)
    },
    driverCardInfo: {
        flex: 1,
    },
    driverCardName: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        flex: 1,
    },
    vehicleInfoPhotoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    vehicleInfoContainer: {
        flex: 1,
        marginRight: 12,
    },
    carPhotoContainerSide: {
        width: 140, // ✅ Aumentado de 100 para 140
        height: 100, // ✅ Aumentado de 80 para 100
        alignItems: 'center',
        justifyContent: 'flex-end', // ✅ Alinhar imagem pela base
        paddingBottom: 0, // ✅ Sem padding
        marginBottom: -15, // ✅ Compensar espaço em branco da imagem (ajustar conforme necessário)
    },
    carPhotoSide: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
        resizeMode: 'contain',
    },
    vehiclePlate: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        letterSpacing: 0.1,
    },
    vehicleBrandModelRow: {
        marginTop: 4,
        marginBottom: 4,
    },
    vehicleBrandModel: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        letterSpacing: 0.1,
        marginBottom: 2,
    },
    vehicleInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    vehicleInfo: {
        fontSize: 12,
        fontFamily: fonts.Regular,
    },
    vehicleInfoSeparator: {
        fontSize: 12,
        marginHorizontal: 4,
        fontFamily: fonts.Regular,
    },
    carPhotoContainer: {
        width: '100%',
        marginTop: 6,
        marginBottom: 6,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    carPhoto: {
        width: '100%',
        maxWidth: 200,
        height: 80,
        borderRadius: 8,
        resizeMode: 'contain',
        alignSelf: 'center',
    },
    messageInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 4,
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
    embarkTimerContainer: {
        alignItems: 'center',
        marginTop: 4, // ✅ Ajustado
        marginBottom: 4, // ✅ Adicionado para reduzir espaço
    },
    embarkTimerLabel: {
        fontSize: 12,
        fontFamily: fonts.Regular,
        marginBottom: 0,
        color: '#666666',
    },
    embarkTimerValue: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        color: '#333333',
    },
    arrivalEstimateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
        paddingHorizontal: 4,
    },
    arrivalEstimateText: {
        fontSize: 14,
        fontFamily: fonts.Bold,
        color: '#333333',
    },
    actionButtonsContainer: {
        marginTop: 4,
        marginBottom: 4,
        gap: 6,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 12,
        backgroundColor: '#000000',
        gap: 8,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
    },
    actionButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    // ✅ Estilos para botão de adicionar detalhes
    addDetailsButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(65, 211, 116, 0.1)',
        alignSelf: 'flex-start',
        gap: 6,
    },
    addDetailsButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    // ✅ Estilos para modal de detalhes do endereço
    modalOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
    },
    modalContent: {
        width: '90%',
        maxWidth: 400,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        flex: 1,
    },
    modalSubtitle: {
        fontSize: 14,
        marginBottom: 4,
    },
    modalAddress: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 16,
        padding: 12,
        borderRadius: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
    },
    modalLabel: {
        fontSize: 14,
        marginBottom: 8,
        fontWeight: '600',
    },
    modalInput: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        marginBottom: 20,
        minHeight: 50,
    },
    modalButtons: {
        flexDirection: 'row',
        gap: 12,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    modalButtonCancel: {
        // Estilo já aplicado via backgroundColor
    },
    modalButtonSave: {
        // Estilo já aplicado via backgroundColor
    },
    modalButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    // Estilos do modal de cancelamento
    cancelModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    cancelModalContent: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    cancelModalTitle: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
        color: '#000000',
        textAlign: 'center',
        marginBottom: 8,
    },
    cancelModalSubtitle: {
        fontSize: 14,
        fontFamily: fonts.Regular,
        color: '#666666',
        textAlign: 'center',
        marginBottom: 24,
    },
    cancelModalButtons: {
        width: '100%',
        gap: 12,
    },
    cancelModalButton: {
        width: '100%',
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelModalButtonWait: {
        backgroundColor: '#000000',
    },
    cancelModalButtonCancel: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#000000',
    },
    cancelModalButtonText: {
        fontSize: 16,
        fontFamily: fonts.Bold,
        fontWeight: 'bold',
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
    // ✅ NOVO: Estilos comuns para evitar inline styles
    loadingScreen: {
        flex: 1,
        backgroundColor: '#1A330E',
    },
    flexOne: {
        flex: 1,
    },
    marginTopSmall: {
        marginTop: 5,
    },
    iconMarginRight: {
        marginRight: 6,
    },
    locationDeniedBanner: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0, 48, 2, 0.1)',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 8,
        zIndex: 3000,
    },
    locationDeniedBannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    locationDeniedIcon: {
        marginRight: 12,
    },
    locationDeniedText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        color: '#333',
        marginRight: 12,
    },
    locationDeniedButton: {
        paddingVertical: 8,
        paddingHorizontal: 20,
        borderRadius: 8,
        backgroundColor: '#003002',
    },
    locationDeniedButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#FFFFFF',
    },
});

// ✅ OTIMIZAÇÃO: Memoizar componente para evitar re-renders desnecessários
// Comparação customizada para re-renderizar apenas quando props relevantes mudarem
export default memo(PassengerUI, (prevProps, nextProps) => {
    // Comparar props críticas que realmente afetam o render
    const criticalPropsEqual = (
        prevProps.currentLocation?.lat === nextProps.currentLocation?.lat &&
        prevProps.currentLocation?.lng === nextProps.currentLocation?.lng &&
        prevProps.pickupAddress === nextProps.pickupAddress &&
        prevProps.theme === nextProps.theme
    );

    // Se props críticas são iguais, não re-renderizar
    // Nota: Redux state (auth, tripdata, etc.) ainda causará re-render via useSelector
    // mas isso é esperado e necessário
    return criticalPropsEqual;
}); 

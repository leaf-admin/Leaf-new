import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
    Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSelector, useDispatch } from 'react-redux';
import { api } from '../../common-local';
import { fonts } from "../../common-local/font";
// import { useTranslation } from 'react-i18next';
import polyline from '@mapbox/polyline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    prepareEstimateObject,
} from '../../common/sharedFunctions';
import { fetchPlacesAutocomplete, fetchCoordsfromPlace, getDirectionsApi } from '../../common-local/GoogleAPIFunctions';
import { updateTripPickup, updateTripDrop, updateTripCar } from '../../common-local/actions/tripactions';
import { MAIN_COLOR } from '../../common/sharedFunctions';
import WebSocketManager from '../../services/WebSocketManager';
import PriceCard from './PriceCard';
import WooviPaymentModal from '../payment/WooviPaymentModal';
import { getEstimate, clearEstimate, setEstimate } from '../../common-local/actions/estimateactions';
import { addBooking } from '../../common-local/actions/bookingactions';
import { useLocationIntelligence } from '../../hooks/useLocationIntelligence';
import RatingModal from '../common/RatingModal';

function getStreetAndNumber(address) {
    if (!address) return '';
    const match = address.match(/^([^,\-]*\d+)[,\-]?/);
    if (match) return match[1].trim();
    return address.split(',')[0].trim();
}

export default function PassengerUI(props) {
    const { getEstimate, addBooking, clearBooking, clearEstimate } = api;
    const dispatch = useDispatch();
    // Função de tradução temporária
    const t = (key) => key;
    
    const { theme, navigation, pickupAddress, currentLocation, setRoutePolyline } = props;
    
    // DEBUG: Verificar se as props estão chegando
    console.log('🔍 PassengerUI props:', {
        hasSetRoutePolyline: !!setRoutePolyline,
        setRoutePolylineType: typeof setRoutePolyline,
        setRoutePolylineValue: setRoutePolyline,
        pickupAddress,
        currentLocation,
        theme: !!theme
    });

    // Location Intelligence Service
    const locationIntelligence = useLocationIntelligence();

    const auth = useSelector(state => state.auth);
    const tripdata = useSelector(state => state.tripdata);
    const settings = useSelector(state => state.settingsdata.settings);
    const cars = useSelector(state => state.cartypes.cars);
    const estimatedata = useSelector(state => state.estimatedata);

    const [allCarTypes, setAllCarTypes] = useState([]);
    const [searchState, setSearchState] = useState({ visible: false, type: 'pickup' });
    const [addressHistory, setAddressHistory] = useState([]);
    const [bookModelLoading, setBookModelLoading] = useState(false);
    const [isPaymentModalVisible, setPaymentModalVisible] = useState(false);
    const [carEstimates, setCarEstimates] = useState({});
    const [selectedCarType, setSelectedCarType] = useState(null);
    
    // Estados para gerenciar a viagem
    const [currentBooking, setCurrentBooking] = useState(null);
    const [tripStatus, setTripStatus] = useState('idle'); // idle, searching, accepted, started, completed
    const [driverInfo, setDriverInfo] = useState(null);
    const [driverLocation, setDriverLocation] = useState(null);
    
    // Estado para modal de avaliação
    const [ratingModalVisible, setRatingModalVisible] = useState(false);
    
    // Função para selecionar tipo de carro
    const handleCarSelection = useCallback((car) => {
        console.log('🚗 Carro selecionado:', car.name);
        setSelectedCarType(car);
        
        // Atualizar Redux com carro selecionado
        dispatch(updateTripCar(car));
        
        // Se temos estimativa para este carro, usar ela
        if (carEstimates[car.name]?.estimateFare) {
            console.log('💰 Usando estimativa existente para:', car.name);
        } else {
            console.log('⚠️ Estimativa não disponível para:', car.name);
        }
    }, [dispatch, carEstimates]);
    
    // Ref para o timer de debounce
    const searchTimeoutRef = useRef(null);
    
    // Preencher endereço de embarque automaticamente
    useEffect(() => {
        if (pickupAddress && currentLocation) {
            console.log('📍 Verificando endereço de embarque:', {
                pickupAddress,
                currentLocation,
                hasPickupInRedux: !!tripdata.pickup?.add
            });
            
            // Sempre atualizar o Redux com o endereço de embarque
            dispatch(updateTripPickup({
                add: pickupAddress,
                lat: currentLocation.lat,
                lng: currentLocation.lng
            }));
            
            console.log('✅ Endereço de embarque atualizado no Redux');
        }
    }, [pickupAddress, currentLocation, dispatch]);
    
    useEffect(() => {
        const webSocketManager = WebSocketManager.getInstance();

        // ===== HANDLERS PARA EVENTOS DE VIAGEM =====

        // 1. Reserva criada com sucesso
        const handleBookingCreated = (data) => {
            console.log('📋 Reserva criada:', data);
            if (data.success) {
                setCurrentBooking(data.booking);
                setTripStatus('searching');
                
                // Mostrar feedback para o usuário
                Alert.alert(
                    'Reserva Criada!',
                    'Procurando motoristas próximos...',
                    [{ text: 'OK' }]
                );
            } else {
                Alert.alert('Erro', data.error || 'Falha ao criar reserva');
            }
        };

        // 2. Motoristas encontrados
        const handleDriversFound = (data) => {
            console.log('🚗 Motoristas encontrados:', data);
            if (data.success) {
                setTripStatus('searching');
                Alert.alert(
                    'Motoristas Encontrados!',
                    `${data.drivers.length} motoristas próximos foram notificados`,
                    [{ text: 'OK' }]
                );
            }
        };

        // 3. Nenhum motorista disponível
        const handleNoDriversFound = (data) => {
            console.log('❌ Nenhum motorista disponível:', data);
            setTripStatus('idle');
            Alert.alert(
                'Nenhum Motorista',
                'Não há motoristas disponíveis no momento. Tente novamente.',
                [{ text: 'OK' }]
            );
        };

        // 4. Motorista aceitou a corrida
        const handleDriverAccepted = (data) => {
            console.log('✅ Motorista aceitou:', data);
            setTripStatus('accepted');
            setDriverInfo(data.driver);
            
            Alert.alert(
                'Corrida Aceita!',
                `${data.driver.name} aceitou sua corrida e está a caminho!`,
                [{ text: 'Ver Detalhes' }],
                { cancelable: false }
            );
            
            // Navegar para tela de corrida confirmada
            navigation.navigate('BookedCab', { 
                bookingId: data.bookingId,
                driverInfo: data.driver
            });
        };

        // 5. Viagem iniciada
        const handleTripStarted = (data) => {
            console.log('🚀 Viagem iniciada:', data);
            setTripStatus('started');
            
            Alert.alert(
                'Viagem Iniciada!',
                'Sua viagem começou! Acompanhe em tempo real.',
                [{ text: 'OK' }]
            );
        };

        // 6. Localização do motorista atualizada
        const handleDriverLocation = (data) => {
            console.log('📍 Localização do motorista:', data);
            setDriverLocation(data.location);
            
            // Atualizar Redux com localização do motorista
            if (data.location) {
                dispatch(updateTripPickup({
                    ...tripdata.pickup,
                    driverLocation: data.location
                }));
            }
        };

        // 7. Viagem finalizada
        const handleTripCompleted = (data) => {
            console.log('🏁 Viagem finalizada:', data);
            setTripStatus('completed');
            
            Alert.alert(
                'Viagem Finalizada!',
                `Distância: ${data.distance}km\nValor: R$ ${data.fare}\n\nConfirme o pagamento para avaliar a experiência.`,
                [
                    { text: 'Confirmar Pagamento', onPress: () => handlePaymentConfirmation() },
                    { text: 'OK' }
                ]
            );
        };

        // 8. Pagamento confirmado
        const handlePaymentConfirmed = (data) => {
            console.log('💳 Pagamento confirmado:', data);
            setTripStatus('idle');
            setCurrentBooking(null);
            setDriverInfo(null);
            setDriverLocation(null);
            
            Alert.alert(
                'Pagamento Confirmado!',
                'Obrigado por usar o Leaf!',
                [{ text: 'OK' }]
            );
        };

        // ===== REGISTRAR TODOS OS EVENTOS =====
        webSocketManager.on('bookingCreated', handleBookingCreated);
        webSocketManager.on('driversFound', handleDriversFound);
        webSocketManager.on('noDriversFound', handleNoDriversFound);
        webSocketManager.on('driverAccepted', handleDriverAccepted);
        webSocketManager.on('tripStarted', handleTripStarted);
        webSocketManager.on('driverLocation', handleDriverLocation);
        webSocketManager.on('tripCompleted', handleTripCompleted);
        webSocketManager.on('paymentConfirmed', handlePaymentConfirmed);

        // ===== CLEANUP =====
        return () => {
            webSocketManager.off('bookingCreated', handleBookingCreated);
            webSocketManager.on('driversFound', handleDriversFound);
            webSocketManager.off('noDriversFound', handleNoDriversFound);
            webSocketManager.off('driverAccepted', handleDriverAccepted);
            webSocketManager.off('tripStarted', handleTripStarted);
            webSocketManager.off('driverLocation', handleDriverLocation);
            webSocketManager.off('tripCompleted', handleTripCompleted);
            webSocketManager.off('paymentConfirmed', handlePaymentConfirmed);
        };
    }, [navigation, t, tripdata.pickup, dispatch]);
    
    useEffect(() => {
        if(cars){
            const sortedCars = [...cars].sort((a,b) => a.pos - b.pos);
            setAllCarTypes(sortedCars);
        }
    },[cars]);

    const filteredCarTypes = useMemo(() => {
        if (!allCarTypes) return [];
        return allCarTypes.slice(0, 5);
    }, [allCarTypes]);

    // SISTEMA DE ROTA INTEGRADO COM MAPSCREEN (JÁ FUNCIONANDO)
    const calculateRouteAndEstimates = async (pickup, drop) => {
        try {
            console.log('🗺️ Iniciando cálculo de rota e estimativas...');
            
            if (!pickup?.add || !drop?.add || !allCarTypes.length) {
                console.log('⚠️ Dados insuficientes para calcular rota');
                return;
            }
            
            let estimates = {};
            let firstPolyline = null;
            
            // Processar cada tipo de carro (sistema do MapScreen)
            for (const car of allCarTypes) {
                console.log(`🚗 Processando carro: ${car.name}`);
                const tripdataForCar = {
                    pickup: pickup,
                    drop: drop,
                    carType: { ...car }
                };
                
                try {
                    console.log(`📞 Chamando prepareEstimateObject para ${car.name}`);
                    const estimateObj = await prepareEstimateObject(tripdataForCar, {});
                    console.log(`✅ prepareEstimateObject retorno para ${car.name}:`, estimateObj);
                    
                    if (!estimateObj.error && estimateObj.estimateObject && estimateObj.estimateObject.carDetails) {
                        // Calcular tarifa usando FareCalculator
                        let estimateFare = null;
                        let estimateTime = null;
                        
                        if (estimateObj.estimateObject.routeDetails) {
                            const routeDetails = estimateObj.estimateObject.routeDetails;
                            const distance = routeDetails.distance_in_km || 0;
                            const time = routeDetails.time_in_secs || 0;
                            
                            // Importar FareCalculator dinamicamente
                            const { FareCalculator } = require('../../common/sharedFunctions');
                            const fareResult = FareCalculator(
                                distance, 
                                time, 
                                car, 
                                {}, 
                                2, // decimal
                                null, // routePoints
                                'car', // vehicleType
                                null // externalTollFee
                            );
                            
                            estimateFare = fareResult.grandTotal;
                            estimateTime = time;
                            
                            console.log(`💰 Tarifa calculada para ${car.name}:`, fareResult);
                        }
                        
                        estimates[car.name] = {
                            ...estimateObj.estimateObject,
                            estimateFare: estimateFare,
                            estimateTime: estimateTime
                        };
                        
                        // Pega a primeira polyline válida (sistema do MapScreen)
                        if (!firstPolyline && estimateObj.estimateObject.routeDetails && estimateObj.estimateObject.routeDetails.polylinePoints) {
                            console.log(`🗺️ Decodificando polyline para ${car.name}`);
                            const points = polyline.decode(estimateObj.estimateObject.routeDetails.polylinePoints);
                            const coordsArr = points.map(point => ({ latitude: point[0], longitude: point[1] }));
                            firstPolyline = coordsArr;
                            console.log(`✅ Polyline decodificada:`, coordsArr.length, 'pontos');
                        }
                    } else {
                        console.log(`❌ Erro no estimateObj para ${car.name}:`, estimateObj);
                        estimates[car.name] = null;
                    }
                } catch (error) {
                    console.error(`💥 Erro ao processar ${car.name}:`, error);
                    estimates[car.name] = null;
                }
            }
            
            console.log('📊 Estimates finais:', estimates);
            setCarEstimates(estimates);
            
            // Atualizar rota no mapa (sistema do MapScreen)
            if (firstPolyline && setRoutePolyline && typeof setRoutePolyline === 'function') {
                setRoutePolyline(firstPolyline);
                console.log('✅ Polyline gerada e definida:', firstPolyline.length, 'pontos');
                
                // Atualizar Redux com dados da rota
                const routeData = {
                    distance_in_km: estimates[Object.keys(estimates)[0]]?.routeDetails?.distance_in_km || 0,
                    duration_in_minutes: estimates[Object.keys(estimates)[0]]?.routeDetails?.time_in_secs ? 
                        estimates[Object.keys(estimates)[0]].routeDetails.time_in_secs / 60 : 0,
                    polyline: firstPolyline
                };
                
                dispatch(updateTripPickup({
                    ...pickup,
                    routeData: routeData
                }));
                
                dispatch(updateTripDrop({
                    ...drop,
                    routeData: routeData
                }));
                
                console.log('✅ Rota atualizada no Redux:', routeData);
            } else {
                setRoutePolyline([]);
                console.log('⚠️ Polyline vazia - nenhuma rota válida encontrada');
            }
            
        } catch (error) {
            console.error('❌ Erro ao calcular rota e estimativas:', error);
            Alert.alert('Erro', 'Não foi possível calcular a rota. Tente novamente.');
        }
    };
    
    // Função removida - agora integrada em calculateRouteAndEstimates

    // MONITORAR QUANDO AMBOS PICKUP E DROP ESTÃO DISPONÍVEIS
    useEffect(() => {
        console.log('🔍 Monitorando tripdata:', {
            hasPickup: !!tripdata.pickup?.add,
            hasDrop: !!tripdata.drop?.add,
            pickup: tripdata.pickup,
            drop: tripdata.drop,
            allCarTypesLength: allCarTypes.length
        });
        
        // Se temos pickup, drop E carTypes, calcular rota e estimativas
        if (tripdata.pickup?.add && tripdata.drop?.add && allCarTypes.length > 0) {
            console.log('🚀 Pickup, Drop e CarTypes disponíveis! Calculando rota e estimativas...');
            
            // Usar pickup do Redux e drop do Redux
            const pickup = tripdata.pickup;
            const drop = tripdata.drop;
            
            // Chamar função integrada que calcula rota + estimativas
            calculateRouteAndEstimates(pickup, drop);
        } else {
            console.log('⏳ Aguardando condições:', {
                hasPickup: !!tripdata.pickup?.add,
                hasDrop: !!tripdata.drop?.add,
                hasCarTypes: allCarTypes.length > 0
            });
        }
    }, [tripdata.pickup, tripdata.drop, allCarTypes]);
    
    // Função removida - agora integrada no useEffect principal


    const hasValidEstimate = useMemo(() => (
        carEstimates && Object.keys(carEstimates).length > 0 && 
        tripdata.pickup?.add && tripdata.drop?.add
    ), [carEstimates, tripdata.pickup, tripdata.drop]);
    
    const onPaymentConfirmed = useCallback(() => {
        setPaymentModalVisible(false);
        const estimate = estimatedata.estimate;
        if (!estimate) return;

        const bookingObject = {
            pickup: tripdata.pickup,
            drop: tripdata.drop,
            carType: selectedCarType.name,
            estimate: estimate.grandTotal,
            trip_cost: estimate.grandTotal,
            convenience_fees: estimate.convenience_fees,
        };
        dispatch(addBooking(bookingObject));
        Alert.alert(t('notification'), t('booking_request_sent'));
    }, [estimatedata.estimate, tripdata, selectedCarType, dispatch, t]);

    const initiateBooking = async () => {
        if (!selectedCarType) {
            Alert.alert('Erro', 'Por favor, selecione um tipo de carro');
            return;
        }
        
        if (!carEstimates[selectedCarType.name]?.estimateFare) {
            Alert.alert('Erro', 'Estimativa não disponível para este carro');
            return;
        }
        
        if (!tripdata.pickup?.add || !tripdata.drop?.add) {
            Alert.alert('Erro', 'Por favor, selecione origem e destino');
            return;
        }
        
        try {
            setBookModelLoading(true);
            
            // Usar estimativa do carro selecionado
            const estimate = carEstimates[selectedCarType.name];
            
            // Preparar dados da reserva
            const bookingData = {
                pickup: tripdata.pickup,
                drop: tripdata.drop,
                carType: selectedCarType.name,
                estimate: estimate.estimateFare,
                customerId: auth.uid,
                userType: 'passenger'
            };
            
            console.log('📋 Criando reserva:', bookingData);
            
            // Conectar ao WebSocket se não estiver conectado
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
                
                // Autenticar usuário
                await new Promise((resolve, reject) => {
                    webSocketManager.socket.emit('authenticate', { 
                        uid: auth.uid, 
                        userType: 'passenger' 
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
            
            // Criar reserva via WebSocket
            const result = await webSocketManager.createBooking(bookingData);
            
            if (result.success) {
                console.log('✅ Reserva criada com sucesso:', result.bookingId);
                
                // Atualizar Redux com estimativa selecionada
                dispatch(setEstimate({
                    grandTotal: estimate.estimateFare,
                    distance: estimate.routeDetails?.distance_in_km || 0,
                    time: estimate.routeDetails?.time_in_secs || 0
                }));
                
                // A reserva será processada pelos handlers WebSocket
                // Não precisamos abrir o modal de pagamento aqui
                
            } else {
                throw new Error(result.error || 'Falha ao criar reserva');
            }
            
        } catch (error) {
            console.error('❌ Erro ao criar reserva:', error);
            Alert.alert('Erro', error.message || 'Falha ao criar reserva');
        } finally {
            setBookModelLoading(false);
        }
    };

    const handleSelectAddress = useCallback(async (address, type) => {
        // Fechar o campo de busca e limpar estado
        setSearchState({ visible: false, type: 'pickup', inputText: '', results: [], loading: false });
        try {
            let coords;
            
                         // Se o endereço vem do cache (Redis/Firebase) com coordenadas
             if ((address.source === 'redis_cache' || address.source === 'firebase_cache') && address.location) {
                 coords = {
                     lat: address.location.lat,
                     lng: address.location.lng
                 };
                 console.log(`✅ Usando coordenadas do cache (${address.source}):`, coords);
             } else {
                 // Fallback para Google Places (mais caro, mas necessário)
                 coords = await fetchCoordsfromPlace(address.place_id);
                 console.log('🔄 Usando coordenadas do Google Places:', coords);
             }
            
            if (coords) {
                const newAddress = { 
                    lat: coords.lat, 
                    lng: coords.lng, 
                    add: address.description, 
                    source: address.source || 'search' 
                };
                
                                 if (type === 'pickup') {
                     dispatch(updateTripPickup(newAddress));
                 } else {
                     dispatch(updateTripDrop(newAddress));
                 }
                 
                 // Salvar no histórico apenas se não for do cache (já está salvo)
                 if (!address.source || !address.source.includes('cache')) {
                     saveToHistory(address);
                 }
                 
                 // Se temos pickup e drop, calcular rota e estimativas
                 if (type === 'drop' && tripdata.pickup?.lat && newAddress.lat) {
                     console.log('🗺️ Drop selecionado, aguardando carTypes para calcular rota...');
                     // A rota será calculada automaticamente quando carTypes estiverem disponíveis
                 }
            }
        } catch (error) {
            console.error('❌ Erro ao selecionar endereço:', error);
            Alert.alert(t('alert'), t('fetch_coords_error'));
        }
    }, [dispatch]);

         const saveToHistory = async (address) => {
         try {
             const newHistory = [address, ...addressHistory.filter(a => a.place_id !== address.place_id)].slice(0, 5);
             setAddressHistory(newHistory);
             await AsyncStorage.setItem('addressHistory', JSON.stringify(newHistory));
         } catch (error) {
             console.error('Error saving to history:', error);
         }
     };
     
          // Função removida - duplicada
    
         useEffect(() => {
         const loadHistory = async () => {
             const history = await AsyncStorage.getItem('addressHistory');
             if(history) setAddressHistory(JSON.parse(history));
         };
         loadHistory();
         
         // Cleanup do timer quando componente for desmontado
         return () => {
             if (searchTimeoutRef.current) {
                 clearTimeout(searchTimeoutRef.current);
             }
         };
     },[]);

    // Função para formatar endereço para exibição (destacar rua e número)
    const formatAddressForDisplay = (address) => {
        if (!address) return '';
        
        // Limpar vírgulas extras no início
        let cleanAddress = address.replace(/^[,.\s]+/, '').trim();
        
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
    };

    // Função para obter texto secundário do endereço (bairro, cidade)
    const getAddressSubtext = (address) => {
        if (!address) return '';
        
        // Limpar vírgulas extras no início
        let cleanAddress = address.replace(/^[,.\s]+/, '').trim();
        
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
         console.log('🔍 Renderizando AddressFields, searchState:', searchState);
         return (
             <View style={styles.addressContainer}>
            <View style={[styles.addressCardGroup, { backgroundColor: theme.card }]}>
                <View style={styles.addressCardRow}>
                                            <Ionicons name="location" color={theme.icon} size={22} style={styles.addressIcon} />
                    <View style={styles.addressTextContainer}>
                        {searchState.visible && searchState.type === 'pickup' ? (
                            // Campo de busca ativo
                                                         <TextInput
                                 style={[styles.searchInputInline, { color: theme.text }]}
                                 placeholder="Digite local de embarque..."
                                 placeholderTextColor={theme.placeholder}
                                 onChangeText={(text) => {
                                     setSearchState(prev => ({ ...prev, inputText: text }));
                                     debouncedSearch(text);
                                 }}
                                 autoFocus={true}
                                 onBlur={() => setSearchState({ visible: false, type: 'pickup', inputText: '', results: [], loading: false })}
                             />
                        ) : (
                            // Campo de embarque normal
                            <TouchableOpacity onPress={() => {
                                console.log('🔍 Clicando no campo de embarque');
                                setSearchState({ visible: true, type: 'pickup', inputText: '', results: [], loading: false });
                            }}>
                                <Text style={tripdata.pickup?.add ? [styles.addressText, { color: theme.text }] : [styles.addressPlaceholder, { color: theme.placeholder }]} numberOfLines={2}>
                                    {tripdata.pickup?.add ? formatAddressForDisplay(tripdata.pickup.add) : t('choose_pickup_location')}
                                </Text>
                                {tripdata.pickup?.add && shouldShowSubtext(tripdata.pickup.add) && (
                                    <Text style={[styles.addressSubtext, { color: theme.textSecondary }]} numberOfLines={1}>
                                        {getAddressSubtext(tripdata.pickup.add)}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
                <View style={styles.addressDivider} />
                <View style={styles.addressCardRow}>
                                            <Ionicons name="location" color={theme.icon} size={22} style={styles.addressIcon} />
                    <View style={styles.addressTextContainer}>
                        {searchState.visible && searchState.type === 'drop' ? (
                            // Campo de busca ativo
                                                         <TextInput
                                 style={[styles.searchInputInline, { color: theme.text }]}
                                 placeholder="Digite seu destino..."
                                 placeholderTextColor={theme.placeholder}
                                 onChangeText={(text) => {
                                     setSearchState(prev => ({ ...prev, inputText: text }));
                                     debouncedSearch(text);
                                 }}
                                 autoFocus={true}
                                 onBlur={() => setSearchState({ visible: false, type: 'drop', inputText: '', results: [], loading: false })}
                             />
                        ) : (
                            // Campo de destino normal
                            <TouchableOpacity onPress={() => {
                                console.log('🔍 Clicando no campo de destino');
                                setSearchState({ visible: true, type: 'drop', inputText: '', results: [], loading: false });
                            }}>
                                <Text style={tripdata.drop?.add ? [styles.addressText, { color: theme.text }] : [styles.addressPlaceholder, { color: theme.placeholder }]} numberOfLines={2}>
                                    {tripdata.drop?.add ? formatAddressForDisplay(tripdata.drop.add) : 'Escolha seu destino'}
                                </Text>
                                {tripdata.drop?.add && shouldShowSubtext(tripdata.drop.add) && (
                                    <Text style={[styles.addressSubtext, { color: theme.textSecondary }]} numberOfLines={1}>
                                        {getAddressSubtext(tripdata.drop.add)}
                                    </Text>
                                )}
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </View>
        </View>
    );
    }, [tripdata.pickup, tripdata.drop, theme, t, searchState]);

                                       const performSearch = useCallback(async (text) => {
           console.log('🔍 Iniciando busca para:', text);
           
           if (text.length < 3) {
               setSearchState(prev => ({ ...prev, results: [], loading: false }));
               return;
           }
           
           try {
               setSearchState(prev => ({ ...prev, loading: true }));
               
                               // 1. Redis (mais barato - GRÁTIS)
                console.log('🔍 Verificando Redis primeiro...');
                try {
                    const redisResults = await locationIntelligence.getSuggestionsFromRedis(text);
                    if (redisResults && redisResults.length > 0) {
                        console.log('✅ Redis retornou:', redisResults.length, 'resultados');
                        const convertedResults = redisResults.map(item => ({
                            place_id: item.place_id || `redis_${Date.now()}_${Math.random()}`,
                            description: item.formatted_address || item.name || item.description,
                            location: item.location,
                            source: 'redis_cache'
                        }));
                        setSearchState(prev => ({ ...prev, results: convertedResults, loading: false }));
                        return; // Sair aqui se Redis tiver resultados
                    }
                } catch (redisError) {
                    console.warn('⚠️ Redis falhou:', redisError.message);
                }
                
                // 2. Firebase (segundo mais barato - GRÁTIS)
                console.log('🔄 Redis vazio, verificando Firebase...');
                try {
                    const firebaseResults = await locationIntelligence.getSuggestionsFromFirebase(text);
                    if (firebaseResults && firebaseResults.length > 0) {
                        console.log('✅ Firebase retornou:', firebaseResults.length, 'resultados');
                        const convertedResults = firebaseResults.map(item => ({
                            place_id: item.place_id || `firebase_${Date.now()}_${Math.random()}`,
                            description: item.formatted_address || item.name || item.description,
                            location: item.location,
                            source: 'firebase_cache'
                        }));
                        setSearchState(prev => ({ ...prev, results: convertedResults, loading: false }));
                        return; // Sair aqui se Firebase tiver resultados
                    }
                } catch (firebaseError) {
                    console.warn('⚠️ Firebase falhou:', firebaseError.message);
                }
                
                // 3. Google Places Autocomplete (mais caro - $0.017/1000 requests)
                console.log('🔄 Cache vazio, indo para Google Places Autocomplete...');
                try {
                    const results = await fetchPlacesAutocomplete(text);
                    console.log('✅ Google Places Autocomplete retornou:', results);
                    setSearchState(prev => ({ ...prev, results: results || [], loading: false }));
                    
                    // Salvar no cache para próximas buscas (economizar custos futuros)
                    if (results && results.length > 0) {
                        try {
                            await locationIntelligence.cacheSuggestions(text, results, 'google_places');
                            console.log('💾 Resultados salvos no cache para economizar custos futuros');
                        } catch (cacheError) {
                            console.warn('⚠️ Falha ao salvar no cache:', cacheError.message);
                        }
                    }
                                 } catch (googleError) {
                     console.error('❌ Erro no Google Places:', googleError);
                     
                     // 4. Sem fallback local - mostrar erro para o usuário
                     console.log('❌ Google Places falhou, sem sugestões disponíveis');
                     setSearchState(prev => ({ ...prev, results: [], loading: false }));
                     
                     // Alertar o usuário sobre o problema
                     Alert.alert(
                         'Erro de Busca',
                         'Não foi possível buscar endereços no momento. Verifique sua conexão e tente novamente.',
                         [{ text: 'OK' }]
                     );
                 }
                       } catch (error) {
                console.error('❌ Erro geral na busca:', error);
                setSearchState(prev => ({ ...prev, results: [], loading: false }));
                
                // Alertar o usuário sobre o problema
                Alert.alert(
                    'Erro de Busca',
                    'Ocorreu um erro inesperado na busca. Tente novamente.',
                    [{ text: 'OK' }]
                );
            }
             }, [locationIntelligence]);

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
                console.log('⏰ Timer expirado, executando busca hierárquica para:', text);
                performSearch(text);
            }, 1000);
            
            console.log('⏰ Timer configurado para 1 segundo para:', text);
       }, [performSearch]);

      const AddressDropdown = useMemo(() => {
         if (!searchState.visible || !searchState.inputText || searchState.inputText.length < 3) return null;

         // Determinar posição do dropdown baseado no tipo de campo
         const getDropdownPosition = () => {
             if (searchState.type === 'pickup') {
                 return { top: 110 + 60 }; // Posição do campo de embarque + altura do campo
             } else {
                 return { top: 110 + 120 }; // Posição do campo de destino + altura dos dois campos
             }
         };

         const dropdownPosition = getDropdownPosition();

         return (
             <View style={[styles.dropdownContainerInline, dropdownPosition]}>
                 <View style={[styles.dropdownContentInline, { backgroundColor: theme.card, borderColor: theme.divider }]}>
                     {searchState.loading && <ActivityIndicator style={styles.loading} color={MAIN_COLOR} />}
                     
                                           {!searchState.loading && searchState.inputText && searchState.inputText.length >= 3 && (
                          <View style={styles.waitingIndicator}>
                              <Text style={[styles.waitingText, { color: theme.textSecondary }]}>
                                  🔍 Verificando cache e Google Places...
                              </Text>
                          </View>
                      )}
                     
                     {!searchState.loading && (
                         <ScrollView keyboardShouldPersistTaps='handled' style={styles.resultsScrollView}>
                             {searchState.results.length > 0 ? (
                                 searchState.results.map((item) => (
                                     <TouchableOpacity key={item.place_id} style={styles.resultItemInline} onPress={() => handleSelectAddress(item, searchState.type)}>
                                         <Ionicons name="location" color={theme.icon} size={20} style={styles.resultIcon} />
                                         <Text style={[styles.resultTextInline, { color: theme.text }]} numberOfLines={1}>{item.description}</Text>
                                     </TouchableOpacity>
                                 ))
                             ) : (
                                 <Text style={[styles.noResultsTextInline, {color: theme.textSecondary}]}>{t('no_results_found')}</Text>
                             )}
                         </ScrollView>
                     )}
                 </View>
             </View>
         );
     }, [searchState, addressHistory, theme, t, performSearch]);

    const CarOptionsCard = useMemo(() => {
        if (!hasValidEstimate) return null;
        
        return (
            <View style={styles.carOptionsContainer}>
                <View style={[styles.carOptionsMainCard, { backgroundColor: theme.card }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {allCarTypes.map((car) => (
                            <TouchableOpacity
                                key={car.name}
                                style={[
                                    styles.carCard, 
                                    {borderColor: theme.divider, backgroundColor: theme.card},
                                    selectedCarType?.name === car.name && styles.selectedCarCard
                                ]}
                                onPress={() => handleCarSelection(car)}
                            >
                                <Image source={{ uri: car.image }} style={styles.carImage} />
                                <Text style={[styles.carNameValue, {color: theme.text}]}>{car.name}</Text>
                                <Text style={[styles.priceNameValue, {color: theme.text}]}>
                                    {carEstimates[car.name]?.estimateFare ? `${settings.symbol}${(carEstimates[car.name].estimateFare).toFixed(2)}` : '...'}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </View>
        );
    }, [allCarTypes, filteredCarTypes, selectedCarType, carEstimates, theme, settings]);

    const BookButton = useMemo(() => {
        if (!allCarTypes.length || !selectedCarType) return null;
        
        const canBook = selectedCarType && carEstimates[selectedCarType.name]?.estimateFare;
        
        // Determinar texto e estado do botão baseado no status da viagem
        const getButtonText = () => {
            switch (tripStatus) {
                case 'idle':
                    return `Reservar ${selectedCarType.name} - ${settings.symbol}${(carEstimates[selectedCarType.name]?.estimateFare || 0).toFixed(2)}`;
                case 'searching':
                    return 'Procurando motoristas...';
                case 'accepted':
                    return 'Motorista a caminho!';
                case 'started':
                    return 'Viagem em andamento';
                case 'completed':
                    return 'Confirmar pagamento';
                default:
                    return 'Reservar';
            }
        };
        
        const getButtonStyle = () => {
            const baseStyle = [styles.bookButton];
            
            if (!canBook || bookModelLoading) {
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
        
        const isDisabled = !canBook || bookModelLoading || tripStatus === 'accepted' || tripStatus === 'started';
        
        return (
            <View style={styles.bookButtonContainer}>
                <TouchableOpacity
                    style={getButtonStyle()}
                    onPress={tripStatus === 'completed' ? handlePaymentConfirmation : initiateBooking}
                    disabled={isDisabled}
                >
                    <Text style={styles.bookButtonText}>
                        {bookModelLoading ? t('loading') : getButtonText()}
                    </Text>
                </TouchableOpacity>
            </View>
        );
    }, [allCarTypes.length, selectedCarType, carEstimates, bookModelLoading, tripStatus, t, initiateBooking, settings.symbol]);

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
            
            // Conectar ao WebSocket se necessário
            const webSocketManager = WebSocketManager.getInstance();
            if (!webSocketManager.isConnected()) {
                await webSocketManager.connect();
            }
            
            // Confirmar pagamento via WebSocket
            const paymentData = {
                bookingId: currentBooking.id,
                paymentMethod: 'woovi', // TODO: Permitir seleção
                paymentId: `payment_${Date.now()}`,
                amount: currentBooking.estimate
            };
            
            const result = await webSocketManager.confirmPayment(paymentData);
            
            if (result.success) {
                console.log('✅ Pagamento confirmado:', result);
                // O handler WebSocket vai processar o resultado
                
                // Após confirmação de pagamento, mostrar modal de avaliação
                // (mas apenas se a viagem foi realmente finalizada)
                if (tripStatus === 'completed') {
                    // Aguardar um pouco para o usuário processar a confirmação
                    setTimeout(() => {
                        showRatingModal();
                    }, 2000);
                }
            } else {
                throw new Error(result.error || 'Falha ao confirmar pagamento');
            }
            
        } catch (error) {
            console.error('❌ Erro ao confirmar pagamento:', error);
            Alert.alert('Erro', error.message || 'Falha ao confirmar pagamento');
        } finally {
            setBookModelLoading(false);
        }
    };

    // Função para lidar com avaliação da viagem
    const handleRatingSubmit = async (ratingData) => {
        try {
            console.log('⭐ Avaliação submetida:', ratingData);
            
            // Importar RatingService
            const RatingService = require('../../services/RatingService').default;
            
            // Enviar avaliação
            const result = await RatingService.submitRating(ratingData);
            
            if (result.success) {
                console.log('✅ Avaliação enviada com sucesso');
                // A avaliação foi salva localmente e enviada para o backend
            } else {
                throw new Error(result.error || 'Falha ao enviar avaliação');
            }
            
        } catch (error) {
            console.error('❌ Erro ao enviar avaliação:', error);
            Alert.alert('Erro', error.message || 'Falha ao enviar avaliação');
        }
    };

    // Função para mostrar modal de avaliação
    const showRatingModal = () => {
        setRatingModalVisible(true);
    };

    const handleBooking = () => {
        // Lógica de pagamento virá aqui
        console.log("Iniciando fluxo de pagamento e depois a reserva...");
        // bookNow(); // Chamada para a função de booking existente
    };

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={[styles.headerButton, { backgroundColor: theme.card }]} onPress={() => navigation.openDrawer()}>
                                            <Ionicons name="menu" color={theme.icon} size={24} />
                </TouchableOpacity>
                <View style={{flex: 1}}/>
                <TouchableOpacity style={[styles.headerButton, { backgroundColor: theme.card, marginRight: 5 }]} onPress={props.toggleTheme}>
                                            <Ionicons name={props.isDarkMode ? 'sunny' : 'moon'} color={theme.icon} size={24} />
                </TouchableOpacity>
                

                <TouchableOpacity style={[styles.headerButton, { backgroundColor: theme.card }]} onPress={() => navigation.navigate('Notifications')}>
                                            <Ionicons name="notifications" color={theme.icon} size={24} />
                </TouchableOpacity>
            </View>

                         {AddressFields}
             {AddressDropdown}
             
             {/* Indicador de status da viagem */}
             {tripStatus !== 'idle' && (
                 <View style={styles.tripStatusContainer}>
                     <View style={[styles.tripStatusCard, { backgroundColor: theme.card }]}>
                         <View style={styles.tripStatusHeader}>
                             <Ionicons 
                                 name={getTripStatusIcon()} 
                                 color={getTripStatusColor()} 
                                 size={24} 
                             />
                             <Text style={[styles.tripStatusTitle, { color: theme.text }]}>
                                 {getTripStatusTitle()}
                             </Text>
                         </View>
                         <Text style={[styles.tripStatusMessage, { color: theme.textSecondary }]}>
                             {getTripStatusMessage()}
                         </Text>
                         {driverInfo && (
                             <View style={styles.driverInfoContainer}>
                                 <Text style={[styles.driverInfoText, { color: theme.text }]}>
                                     Motorista: {driverInfo.name}
                                 </Text>
                                 <Text style={[styles.driverInfoText, { color: theme.textSecondary }]}>
                                     Carro: {driverInfo.car}
                                 </Text>
                             </View>
                         )}
                         
                         {/* Botão de avaliação será mostrado após confirmação de pagamento */}
                         {/* O modal será aberto automaticamente após confirmação de pagamento */}
                         {/* Fluxo: Viagem Finalizada → Confirmar Pagamento → Modal de Avaliação */}
                     </View>
                 </View>
             )}
             
             {/* Cards de estimativa de preço */}
             {CarOptionsCard}
             {BookButton} 

            {isPaymentModalVisible && (
                 <WooviPaymentModal
                    visible={isPaymentModalVisible}
                    amount={estimatedata.estimate.grandTotal}
                    onClose={() => setPaymentModalVisible(false)}
                    onPaymentSuccess={onPaymentConfirmed}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 1000 },
    headerButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5 },
    addressContainer: { position: 'absolute', top: 110, left: 0, right: 0, zIndex: 900, alignItems: 'center' },
    addressCardGroup: { borderRadius: 18, width: '92%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 6, overflow: 'hidden' },
    addressCardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18 },
    addressDivider: { height: 1, marginHorizontal: 18 },
    addressIcon: { marginRight: 14 },
    addressTextContainer: {
        flex: 1,
    },
    addressText: { flex: 1, fontFamily: fonts.Bold, fontSize: 16, letterSpacing: 0.1 },
    addressSubtext: { fontFamily: fonts.Regular, fontSize: 12 },
    addressPlaceholder: { flex: 1, fontFamily: fonts.Regular, fontSize: 16 },
         // Estilos para campo de busca inline
     searchInputInline: { 
         flex: 1, 
         fontFamily: fonts.Regular, 
         fontSize: 16,
         paddingVertical: 0,
         minHeight: 20
     },
     
           // Estilos para dropdown inline
      dropdownContainerInline: { 
          position: 'absolute', 
          left: 20, 
          right: 20, 
          zIndex: 1500
      },
             dropdownContentInline: { 
           borderRadius: 18, 
           padding: 14, 
           borderWidth: 1,
           shadowColor: '#000', 
           shadowOffset: { width: 0, height: 2 }, 
           shadowOpacity: 0.25, 
           shadowRadius: 8, 
           elevation: 8
       },
       resultsScrollView: {
           maxHeight: 200 // Altura mais apropriada para o dropdown
       },
     historyTitleInline: { 
         fontSize: 15, 
         fontFamily: fonts.Bold, 
         marginBottom: 8, 
         marginLeft: 2 
     },
     historyItemInline: { 
         flexDirection: 'row', 
         alignItems: 'center', 
         paddingVertical: 13, 
         borderBottomWidth: 1,
         borderBottomColor: 'rgba(0,0,0,0.1)'
     },
     historyTextInline: { 
         flex: 1, 
         fontFamily: fonts.Regular, 
         fontSize: 14 
     },
     resultItemInline: { 
         flexDirection: 'row', 
         alignItems: 'center', 
         paddingVertical: 15, 
         borderBottomWidth: 1,
         borderBottomColor: 'rgba(0,0,0,0.1)'
     },
     resultTextInline: { 
         flex: 1, 
         fontFamily: fonts.Regular, 
         fontSize: 14 
     },
           noResultsTextInline: { 
          textAlign: 'center', 
          padding: 20, 
          fontSize: 16 
      },
      waitingIndicator: {
          padding: 15,
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(0,0,0,0.1)'
      },
      waitingText: {
          fontSize: 14,
          fontFamily: fonts.Regular,
          fontStyle: 'italic'
      },
      loading: { marginVertical: 20 },
    carOptionsContainer: { position: 'absolute', bottom: 100, left: 0, right: 0, zIndex: 800 },
    carOptionsMainCard: { marginHorizontal: 20, borderRadius: 16, padding: 8 },
    carCard: { padding: 10, borderRadius: 12, marginRight: 10, alignItems: 'center', borderWidth: 1.5 },
    selectedCarCard: { borderColor: MAIN_COLOR },
    carImage: { width: 80, height: 40, resizeMode: 'contain', marginBottom: 5 },
    carNameValue: { fontFamily: fonts.Bold, fontSize: 14, marginBottom: 2 },
    priceNameValue: { fontFamily: fonts.Regular, fontSize: 12 },
    bookButtonContainer: { position: 'absolute', bottom: 20, left: 20, right: 20, zIndex: 800 },
    bookButton: { backgroundColor: MAIN_COLOR, borderRadius: 12, padding: 16, alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3 },
    bookButtonDisabled: { backgroundColor: '#cccccc' },
    bookButtonText: { color: '#fff', fontSize: 18, fontFamily: fonts.Bold },
    
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
    driverInfoContainer: { 
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
}); 
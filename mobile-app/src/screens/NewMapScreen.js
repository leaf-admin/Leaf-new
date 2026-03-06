import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Image, TouchableOpacity, Alert, Dimensions, Modal, ActivityIndicator } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline, Callout, Circle } from 'react-native-maps';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTheme } from '../common-local/theme';
import { Typography } from '../components/design-system/Typography';
import { AnimatedButton } from '../components/design-system/AnimatedButton';
import { GoogleMapApiConfig } from '../../config/GoogleMapApiConfig';

import PassengerUI from '../components/map/PassengerUI';
import DriverUI from '../components/map/DriverUI';
import PassengerEnRouteUI from '../components/map/PassengerEnRouteUI';
import DriverEnRouteUI from '../components/map/DriverEnRouteUI';
import DriverStartTripUI from '../components/map/DriverStartTripUI';
import PassengerWaitingUI from '../components/map/PassengerWaitingUI';
import DriverOnTripUI from '../components/map/DriverOnTripUI';
import PassengerOnTripUI from '../components/map/PassengerOnTripUI';
import RatingUI from '../components/map/RatingUI';
import WebSocketManager from '../services/WebSocketManager';
import { darkTheme, lightTheme } from '../common-local/theme';
import { clearBooking } from '../common-local/actions/bookingactions';
import polyline from '@mapbox/polyline';
import carIcon from '../../assets/images/track_Car.png';
import { FareCalculator, getDistanceMatrix } from '../common/sharedFunctions';
import { fonts } from '../common/font';
import { colors } from '../common/theme';

const { width, height } = Dimensions.get('window');

// Estilos de mapa para modo claro e escuro
const lightMapStyle = [
    {
        "elementType": "geometry",
        "stylers": [{ "color": "#f5f5f5" }]
    },
    {
        "elementType": "labels.icon",
        "stylers": [{ "visibility": "off" }]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#616161" }]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#f5f5f5" }]
    },
    {
        "featureType": "administrative.land_parcel",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#bdbdbd" }]
    },
    {
        "featureType": "poi",
        "elementType": "geometry",
        "stylers": [{ "color": "#eeeeee" }]
    },
    {
        "featureType": "poi",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "poi.park",
        "elementType": "geometry",
        "stylers": [{ "color": "#e5e5e5" }]
    },
    {
        "featureType": "poi.park",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#9e9e9e" }]
    },
    {
        "featureType": "road",
        "elementType": "geometry",
        "stylers": [{ "color": "#ffffff" }]
    },
    {
        "featureType": "road.arterial",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry",
        "stylers": [{ "color": "#dadada" }]
    },
    {
        "featureType": "road.highway",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#616161" }]
    },
    {
        "featureType": "road.local",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#9e9e9e" }]
    },
    {
        "featureType": "transit.line",
        "elementType": "geometry",
        "stylers": [{ "color": "#e5e5e5" }]
    },
    {
        "featureType": "transit.station",
        "elementType": "geometry",
        "stylers": [{ "color": "#eeeeee" }]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [{ "color": "#c9c9c9" }]
    },
    {
        "featureType": "water",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#9e9e9e" }]
    }
];

const darkMapStyle = [
    {
        "elementType": "geometry",
        "stylers": [{ "color": "#212121" }]
    },
    {
        "elementType": "labels.icon",
        "stylers": [{ "visibility": "off" }]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#212121" }]
    },
    {
        "featureType": "administrative",
        "elementType": "geometry",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "administrative.country",
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#4b4b4b" }]
    },
    {
        "featureType": "administrative.land_parcel",
        "stylers": [{ "visibility": "off" }]
    },
    {
        "featureType": "administrative.locality",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#bdbdbd" }]
    },
    {
        "featureType": "poi",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "poi.park",
        "elementType": "geometry",
        "stylers": [{ "color": "#181818" }]
    },
    {
        "featureType": "poi.park",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#616161" }]
    },
    {
        "featureType": "poi.park",
        "elementType": "labels.text.stroke",
        "stylers": [{ "color": "#1b1b1b" }]
    },
    {
        "featureType": "road",
        "elementType": "geometry.fill",
        "stylers": [{ "color": "#2c2c2c" }]
    },
    {
        "featureType": "road",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#8a8a8a" }]
    },
    {
        "featureType": "road.arterial",
        "elementType": "geometry",
        "stylers": [{ "color": "#373737" }]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry",
        "stylers": [{ "color": "#3c3c3c" }]
    },
    {
        "featureType": "road.highway.controlled_access",
        "elementType": "geometry",
        "stylers": [{ "color": "#4e4e4e" }]
    },
    {
        "featureType": "road.local",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#c0c0c0" }]
    },
    {
        "featureType": "transit",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#757575" }]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [{ "color": "#000000" }]
    },
    {
        "featureType": "water",
        "elementType": "labels.text.fill",
        "stylers": [{ "color": "#3d3d3d" }]
    }
];

export default function NewMapScreen(props) {
    const mapRef = useRef(null);
    const [routePolyline, setRoutePolyline] = useState(null);

    // Log quando routePolyline muda
    useEffect(() => {
        console.log('🗺️ NewMapScreen - routePolyline atualizado:', {
            hasPolyline: !!routePolyline,
            length: routePolyline?.length || 0,
            firstPoint: routePolyline?.[0],
            lastPoint: routePolyline?.[routePolyline?.length - 1]
        });
    }, [routePolyline]);
    const [driverLocation, setDriverLocation] = useState(null);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [currentLocation, setCurrentLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState('');

    // Estados para cards de valores (baseado no MapScreen.js antigo)
    const [allCarTypes, setAllCarTypes] = useState([]);
    const [selectedCarType, setSelectedCarType] = useState(null);
    const [carEstimates, setCarEstimates] = useState({});
    const [filteredCarTypes, setFilteredCarTypes] = useState([]);

    // Estados para controlar z-index do botão de centralizar
    const [bottomSheetState, setBottomSheetState] = useState({
        isDocumentsBottomSheetOpen: false,
        isVehicleBottomSheetOpen: false
    });

    // Função para calcular z-index do botão de centralizar
    const getCenterButtonZIndex = () => {
        if (bottomSheetState.isDocumentsBottomSheetOpen || bottomSheetState.isVehicleBottomSheetOpen) {
            return -100; // Botão fica atrás quando BottomSheet está aberta
        }
        return 100; // Z-index normal quando BottomSheet está fechada
    };

    // Função para receber mudanças do estado das BottomSheets
    const handleBottomSheetStateChange = (state) => {
        setBottomSheetState(state);
    };
    // Estados para mudança de destino (Ride Extension)
    const [changeDestModalVisible, setChangeDestModalVisible] = useState(false);
    const [calculatingFare, setCalculatingFare] = useState(false);
    const [newDropEstimate, setNewDropEstimate] = useState(null);
    const [loading, setLoading] = useState(false);

    // Funções de tradução simplificadas para o NewMapScreen (ou use i18n se disponível)
    const t = (key, fallback) => fallback || key;
    const isRTL = false; // Ajustar se necessário

    // ===== FUNÇÕES PARA GERENCIAR RESERVAS =====
    const dispatch = useDispatch();

    const auth = useSelector(state => state.auth);
    const booking = useSelector(state => state.bookingdata.booking);
    const gps = useSelector(state => state.gpsdata);
    const tripdata = useSelector(state => state.tripdata);
    const settings = useSelector(state => state.settingsdata);
    const cartypes = useSelector(state => state.cartypes);

    // Tema baseado no estado
    const theme = useTheme();

    // Cores padrão para o mapa
    const mapColors = {
        primary: theme.leafGreen || '#41D274',
        background: theme.background || '#FFFFFF',
        surface: theme.card || '#FFFFFF',
        text: theme.text || '#000000'
    };

    // Obter localização atual e endereço
    useEffect(() => {
        getCurrentLocation();
    }, []);

    // Efeito para centralizar o mapa quando a localização mudar
    useEffect(() => {
        if (currentLocation && mapRef.current) {
            console.log('🔄 Localização mudou, centralizando mapa...');
            mapRef.current.animateToRegion({
                latitude: currentLocation.lat,
                longitude: currentLocation.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 1000);
        }
    }, [currentLocation]);

    const getCurrentLocation = async () => {
        try {
            // Verificar permissões
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão negada', 'Precisamos da sua localização para funcionar.');
                return;
            }

            // Obter localização atual
            let location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
                maximumAge: 10000,
                timeout: 15000,
            });

            const { latitude, longitude } = location.coords;
            const newLocation = { lat: latitude, lng: longitude };

            console.log('📍 Nova localização obtida:', newLocation);
            setCurrentLocation(newLocation);

            // Centralizar o mapa automaticamente na nova localização
            if (mapRef.current) {
                console.log('🗺️ Centralizando mapa na nova localização...');
                mapRef.current.animateToRegion({
                    latitude: latitude,
                    longitude: longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }, 1000);
                console.log('✅ Mapa centralizado automaticamente!');
            }

            // Obter endereço usando múltiplas fontes
            try {
                console.log('🔍 Tentando obter endereço para:', { latitude, longitude });

                const address = await getAddressFromMultipleSources(latitude, longitude);
                setPickupAddress(address);
                console.log('📍 Endereço final definido:', address);

            } catch (addressError) {
                console.warn('⚠️ Erro ao obter endereço:', addressError);
                console.log('⚠️ Usando coordenadas como fallback final');
                setPickupAddress(`Localização(${latitude.toFixed(6)}, ${longitude.toFixed(6)})`);
            }

        } catch (error) {
            console.error('❌ Erro ao obter localização:', error);
            Alert.alert('Erro', 'Não foi possível obter sua localização.');
        }
    };

    // Função para obter endereço mais preciso do Google Places
    const getAddressFromGooglePlaces = async (latitude, longitude) => {
        try {
            console.log('🔍 Google Places API - Fazendo requisição para:', { latitude, longitude });

            // Usar a API do Google Places para obter endereço mais preciso
            const response = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY&language=pt-BR`
            );

            console.log('🔍 Google Places API - Status da resposta:', response.status);

            const data = await response.json();
            console.log('🔍 Google Places API - Dados recebidos:', JSON.stringify(data, null, 2));

            if (data.status === 'OK' && data.results && data.results.length > 0) {
                const result = data.results[0];
                console.log('✅ Endereço obtido com Google Places:', result.formatted_address);
                return result.formatted_address;
            } else if (data.status === 'ZERO_RESULTS') {
                console.log('⚠️ Google Places API - Nenhum resultado encontrado');
                return null;
            } else {
                console.log('⚠️ Google Places API - Status de erro:', data.status, data.error_message);
                return null;
            }

        } catch (error) {
            console.warn('⚠️ Erro na API do Google Places:', error);
            return null;
        }
    };

    // Função para tentar obter endereço de múltiplas fontes
    const getAddressFromMultipleSources = async (latitude, longitude) => {
        console.log('🔍 Tentando obter endereço de múltiplas fontes...');

        // 1. Tentar Google Places API primeiro
        try {
            const googleAddress = await getAddressFromGooglePlaces(latitude, longitude);
            if (googleAddress) {
                console.log('✅ Endereço obtido com Google Places:', googleAddress);
                return googleAddress;
            }
        } catch (error) {
            console.log('⚠️ Google Places API falhou (billing não habilitado):', error.message);
        }

        // 2. Tentar Location.reverseGeocodeAsync com configurações diferentes
        try {
            const addressResponse = await Location.reverseGeocodeAsync({
                latitude,
                longitude,
                useGoogleMaps: true // Tentar com Google Maps
            });

            if (addressResponse.length > 0) {
                const address = addressResponse[0];
                if (address.formattedAddress && address.formattedAddress !== 'Brasil') {
                    console.log('✅ Endereço obtido com Google Maps:', address.formattedAddress);
                    return address.formattedAddress;
                }
            }
        } catch (error) {
            console.log('⚠️ Google Maps reverse geocoding falhou:', error);
        }

        // 2. Tentar com configuração nativa
        try {
            const addressResponse = await Location.reverseGeocodeAsync({
                latitude,
                longitude,
                useGoogleMaps: false
            });

            if (addressResponse.length > 0) {
                const address = addressResponse[0];
                // Construir endereço manualmente
                const parts = [
                    address.street,
                    address.district,
                    address.city,
                    address.region
                ].filter(Boolean);

                if (parts.length > 0) {
                    const manualAddress = parts.join(', ');
                    console.log('✅ Endereço construído manualmente:', manualAddress);
                    return manualAddress;
                }
            }
        } catch (error) {
            console.log('⚠️ Reverse geocoding nativo falhou:', error);
        }

        // 3. Fallback: usar coordenadas formatadas
        console.log('⚠️ Todas as fontes falharam, usando coordenadas');
        return `Localização (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`;
    };

    // useEffect para desenhar as rotas
    useEffect(() => {
        let polylinePoints = null;

        // Rota do motorista até o passageiro
        if (booking && booking.status === 'ACCEPTED' && booking.driver_to_pickup_polyline) {
            polylinePoints = booking.driver_to_pickup_polyline;
        }

        // Rota principal da viagem
        if (booking && booking.status === 'STARTED' && booking.trip_polyline) {
            polylinePoints = booking.trip_polyline;
        }

        if (polylinePoints) {
            const points = polyline.decode(polylinePoints);
            const coords = points.map(point => ({
                latitude: point[0],
                longitude: point[1]
            }));
            setRoutePolyline(coords);

            // Ajustar o mapa para mostrar toda a rota
            if (mapRef.current && coords.length > 1) {
                mapRef.current.fitToCoordinates(coords, {
                    edgePadding: { top: 50, right: 50, bottom: 250, left: 50 },
                    animated: true,
                });
            }
        }
    }, [booking?.driver_to_pickup_polyline, booking?.trip_polyline]);

    // Efeito para calcular polyline quando dados de rota são atualizados
    useEffect(() => {
        // Usar o estado local do Redux que já está sendo monitorado
        if (auth.profile?.usertype === 'customer') {
            // O PassengerUI já está calculando rotas e atualizando o Redux
            // A polyline será atualizada automaticamente quando os dados chegarem
            console.log('🗺️ Monitorando atualizações de rota para passageiro...');
        }
    }, [auth.profile?.usertype]);

    const handleSubmitRating = (ratingData) => {
        const webSocketManager = WebSocketManager.getInstance();
        const userType = auth.profile?.usertype;

        webSocketManager.emit('submit_rating', {
            bookingId: booking.key,
            ratingData: ratingData,
            ratedBy: userType,
        });

        dispatch(clearBooking());
    };

    // ✅ NOVO: Efeito para detectar Mudança de Destino via SearchScreen
    useEffect(() => {
        if (tripdata && tripdata.drop && tripdata.drop.source === 'search' && booking && (auth.profile?.usertype === 'customer' || auth.profile?.userType === 'customer')) {
            const calculateNewFare = async () => {
                setCalculatingFare(true);
                setChangeDestModalVisible(true);

                const startLoc = booking.pickup.lat + ',' + booking.pickup.lng;
                const destLoc = tripdata.drop.lat + ',' + tripdata.drop.lng;

                try {
                    const res = await getDistanceMatrix(startLoc, destLoc);
                    if (res) {
                        const distance = parseFloat(res.distance) / 1000;
                        const time = parseFloat(res.time_in_secs) / 60;

                        const rateDetails = {
                            rate_per_unit_distance: booking.rate_per_unit_distance || 0,
                            rate_per_hour: booking.rate_per_hour || 0,
                            base_fare: booking.base_fare || 0,
                            min_fare: booking.min_fare || 0,
                        };

                        let estimate = FareCalculator(distance, time, rateDetails, booking.instructionData, booking.decimal, res.routePoints, booking.carType, 0);

                        setNewDropEstimate({
                            estimate: estimate.estimateFare,
                            distance: res.distance,
                            time: res.time_in_secs,
                            newDrop: tripdata.drop,
                            diff: estimate.estimateFare - booking.estimate
                        });
                    }
                } catch (error) {
                    console.error("Error calculating new fare:", error);
                    Alert.alert(t('error', 'Erro'), t('fare_calc_error', "Erro ao calcular nova tarifa. Tente novamente mais tarde."));
                    setChangeDestModalVisible(false);
                }
                setCalculatingFare(false);
            };

            setTimeout(calculateNewFare, 300);

            dispatch({ type: 'UPDATE_TRIP_DROP', payload: { ...tripdata.drop, source: 'processed' } });
        }
    }, [tripdata?.drop, booking]);

    const confirmDestinationChange = () => {
        if (!newDropEstimate) return;
        const webSocketManager = WebSocketManager.getInstance();
        setChangeDestModalVisible(false);
        setLoading(true);
        if (newDropEstimate.diff > 0) {
            // A corrida ficou mais cara. Pede extensão (Geração Pix Extra).
            webSocketManager.requestRideExtension(booking.id, newDropEstimate.newDrop, newDropEstimate.estimate)
                .then(() => {
                    setLoading(false);
                    Alert.alert(t('success', 'Sucesso'), t('extension_requested', 'Sua solicitação enviará um Pix extra para estender a corrida. Aguarde a confirmação do pagamento.'));
                })
                .catch(err => {
                    setLoading(false);
                    Alert.alert(t('error', 'Erro'), err.message || 'Erro ao processar');
                });
        } else {
            // Corrida ficou mais barata ou mesmo preço. Change Destination direto.
            webSocketManager.changeDestination(booking.id, newDropEstimate.newDrop)
                .then(() => {
                    setLoading(false);
                    Alert.alert(t('success', 'Sucesso'), t('destination_changed', 'Destino alterado com sucesso! Se a corrida ficar mais barata a diferença será estornada no final.'));
                })
                .catch(err => {
                    setLoading(false);
                    Alert.alert(t('error', 'Erro'), err.message || 'Erro ao processar alteração.');
                });
        }
    };


    const toggleTheme = () => {
        setIsDarkMode(!isDarkMode);
    };

    const centerOnUser = () => {
        console.log('🎯 centerOnUser chamado');
        console.log('📍 currentLocation:', currentLocation);
        console.log('🗺️ mapRef.current:', !!mapRef.current);

        if (mapRef.current && currentLocation) {
            console.log('✅ Centralizando mapa na posição do usuário:', {
                lat: currentLocation.lat,
                lng: currentLocation.lng
            });

            // Centralizar com animação suave
            mapRef.current.animateToRegion({
                latitude: currentLocation.lat,
                longitude: currentLocation.lng,
                latitudeDelta: 0.01,  // Zoom aproximado
                longitudeDelta: 0.01,
            }, 1000);

            console.log('✅ Mapa centralizado com sucesso!');
        } else {
            console.log('⚠️ Não foi possível centralizar:', {
                hasMapRef: !!mapRef.current,
                hasCurrentLocation: !!currentLocation
            });

            // Se não tem localização atual, tentar obter novamente
            if (!currentLocation) {
                console.log('🔄 Tentando obter localização atual...');
                getCurrentLocation();
            }
        }
    };

    // Funções para cards de valores (baseado no MapScreen.js antigo)
    const getEstimateForCar = (car) => {
        if (!car || !carEstimates[car.name]) {
            return { fare: car?.min_fare || 0 };
        }
        return carEstimates[car.name];
    };

    // Efeito para carregar tipos de carro
    useEffect(() => {
        console.log('🚗 NewMapScreen - useEffect cartypes:', {
            hasCartypes: !!cartypes,
            cartypesType: typeof cartypes,
            cartypesLength: cartypes?.length || 0,
            cartypesKeys: cartypes ? Object.keys(cartypes) : null,
            cartypesCars: cartypes?.cars || null
        });

        if (cartypes && cartypes.cars && cartypes.cars.length > 0) {
            console.log('✅ NewMapScreen - Definindo allCarTypes:', cartypes.cars.length, 'carros');
            setAllCarTypes(cartypes.cars);
            setFilteredCarTypes(cartypes.cars);
        } else {
            console.log('⚠️ NewMapScreen - cartypes não disponível ou vazio');
        }
    }, [cartypes]);

    // Efeito para filtrar tipos de carro baseado na distância
    useEffect(() => {
        if (allCarTypes.length > 0 && tripdata.pickup && tripdata.drop && tripdata.drop.add) {
            // Filtrar apenas carros disponíveis para a distância da viagem
            const filtered = allCarTypes.filter(car => {
                if (!car.max_distance) return true;
                // Aqui você pode adicionar lógica para filtrar por distância se necessário
                return true;
            });
            setFilteredCarTypes(filtered);
        }
    }, [allCarTypes, tripdata.pickup, tripdata.drop]);

    const renderUI = () => {
        const userType = auth.profile?.usertype;
        const bookingStatus = booking?.status;

        console.log('NewMapScreen - Debug renderUI:', {
            userType: userType,
            authProfile: auth.profile,
            authProfileKeys: auth.profile ? Object.keys(auth.profile) : null,
            usertype: auth.profile?.usertype,
            userType: auth.profile?.userType,
            bookingStatus: bookingStatus
        });

        if (bookingStatus === 'COMPLETE') {
            const userToRate = {
                name: userType === 'customer' ? booking.driver_name : booking.customer_name
            };
            return <RatingUI userToRate={userToRate} onSubmit={handleSubmitRating} />;
        }

        if (bookingStatus === 'STARTED') {
            if (userType === 'customer') {
                return <PassengerOnTripUI booking={booking} />;
            }
            if (userType === 'driver') {
                return <DriverOnTripUI booking={booking} />;
            }
        }

        if (bookingStatus === 'ACCEPTED' || bookingStatus === 'REACHED') {
            if (userType === 'customer') {
                return <PassengerEnRouteUI
                    booking={booking}
                    onDriverLocationUpdate={setDriverLocation}
                />;
            }
            if (userType === 'driver') {
                return bookingStatus === 'ACCEPTED' ?
                    <DriverEnRouteUI booking={booking} onArrived={() => { }} /> :
                    <DriverStartTripUI booking={booking} />;
            }
        }

        // UI Padrão de busca - passar endereço de embarque
        if (userType === 'customer') {
            console.log('🔍 NewMapScreen - Passando props para PassengerUI:', {
                hasSetRoutePolyline: !!setRoutePolyline,
                setRoutePolylineType: typeof setRoutePolyline,
                hasRoutePolyline: !!routePolyline,
                hasTheme: !!theme,
                hasPickupAddress: !!pickupAddress,
                hasCurrentLocation: !!currentLocation
            });

            console.log('🔍 Verificando componentes:', {
                PassengerUI: typeof PassengerUI,
                DriverUI: typeof DriverUI,
                RatingUI: typeof RatingUI
            });

            console.log('🚗 NewMapScreen - Renderizando PassengerUI com allCarTypes:', {
                allCarTypesLength: allCarTypes?.length || 0,
                allCarTypes: allCarTypes,
                cartypesFromRedux: cartypes
            });

            return (
                <PassengerUI
                    mapRef={mapRef}
                    routePolyline={routePolyline}
                    setRoutePolyline={setRoutePolyline}
                    theme={theme}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                    pickupAddress={pickupAddress}
                    currentLocation={currentLocation}
                    allCarTypes={allCarTypes}
                    {...props}
                />
            );
        }
        if (userType === 'driver') {
            return (
                <DriverUI
                    {...props}
                    mapRef={mapRef}
                    theme={theme}
                    isDarkMode={isDarkMode}
                    onBottomSheetStateChange={handleBottomSheetStateChange}
                />
            );
        }

        // Fallback para quando não há userType definido
        console.log('⚠️ renderUI: userType não definido, retornando fallback');
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text>Carregando...</Text>
            </View>
        );
    };

    const initialRegion = currentLocation ? {
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    } : null;

    return (
        <View style={styles.container}>
            <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={initialRegion}
                showsUserLocation={true}
                showsMyLocationButton={false}
                showsCompass={true}
                showsScale={true}
                showsTraffic={false}
                showsBuildings={true}
                showsIndoors={true}
                loadingEnabled={true}
                loadingIndicatorColor={mapColors.primary}
                loadingBackgroundColor={mapColors.background}
                customMapStyle={isDarkMode ? darkMapStyle : lightMapStyle}
                onMapReady={() => console.log('🗺️ MapView carregado e pronto')}
            >
                {routePolyline && (
                    <Polyline
                        coordinates={routePolyline}
                        strokeColor="#006400"
                        strokeWidth={4}
                        lineDashPattern={[1]}
                        zIndex={1000}
                    />
                )}

                {driverLocation && (
                    <Marker
                        coordinate={{
                            latitude: driverLocation.lat,
                            longitude: driverLocation.lng,
                        }}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <Image
                            source={carIcon}
                            style={{ height: 40, width: 40, resizeMode: 'contain' }}
                        />
                    </Marker>
                )}
            </MapView>

            {/* Botões de controle do mapa */}
            <View style={[styles.mapControls, { zIndex: getCenterButtonZIndex() }]}>
                {/* Botão de centralizar no usuário */}
                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: theme.card }]}
                    onPress={centerOnUser}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name="locate"
                        size={24}
                        color={theme.text}
                    />
                </TouchableOpacity>
            </View>

            {/* UI sobreposta */}
            <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
                {renderUI()}
            </View>

            {/* Cards de opções de carro */}
            {filteredCarTypes && filteredCarTypes.length > 0 && tripdata.pickup && tripdata.drop && tripdata.drop.add && (
                <View style={styles.carOptionsContainer}>
                    <View style={[styles.carOptionsMainCard, { backgroundColor: theme.card }]}>
                        {filteredCarTypes.map((car, index) => (
                            <TouchableOpacity
                                key={car.id || index}
                                style={[
                                    styles.carCard,
                                    { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255,255,255,0.05)' : '#F8F9FA' },
                                    selectedCarType === car.name && { borderColor: theme.leafGreen || '#41D274', backgroundColor: theme.card === '#1A1A1A' ? 'rgba(65, 210, 116, 0.1)' : '#E8F5E8' }
                                ]}
                                onPress={() => setSelectedCarType(car.name)}
                            >
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Image
                                        source={{ uri: car.image }}
                                        style={styles.carImage}
                                    />
                                    <View style={styles.carInfo}>
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Typography variant="body" weight="bold" color={theme.text}>{car.name}</Typography>
                                            <Typography variant="body" weight="bold" color={theme.leafGreen || '#41D274'}>
                                                {carEstimates[car.name]?.estimateFare ?
                                                    `${settings.currency}${carEstimates[car.name].estimateFare.toFixed(settings.decimal)}` :
                                                    `${settings.currency}${car.min_fare.toFixed(settings.decimal)}`
                                                }
                                            </Typography>
                                        </View>
                                        <View style={styles.carDetailsRow}>
                                            <Typography variant="caption" color={theme.textSecondary}>{car.extra_info}</Typography>
                                        </View>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            )}

            {/* Botão de agendamento */}
            {selectedCarType && tripdata.pickup && tripdata.drop && tripdata.drop.add && (
                <View style={styles.bookButtonContainer}>
                    <AnimatedButton
                        title="Agendar Agora"
                        onPress={() => {
                            // Implementar lógica de agendamento
                            console.log('Agendando viagem para:', selectedCarType);
                        }}
                    />
                    <Typography variant="caption" color={theme.textSecondary} align="center" style={{ marginTop: 8 }}>
                        {(() => {
                            const selectedCar = filteredCarTypes.find(car => car.name === selectedCarType);
                            const estimate = getEstimateForCar(selectedCar);
                            return estimate.fare ? `${settings.currency}${estimate.fare}` : 'Preço sob consulta';
                        })()}
                    </Typography>
                </View>
            )}
            {/* Modal de Mudança de Destino */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={changeDestModalVisible}
                onRequestClose={() => {
                    setChangeDestModalVisible(false);
                }}
            >
                <View style={[styles.modalContainer, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
                    <View style={[styles.modalView, { backgroundColor: theme.card }]}>
                        <Typography variant="h2" align="center" style={{ marginBottom: 20 }} color={theme.text}>
                            {t('change_destination', 'Alteração de Destino')}
                        </Typography>
                        {calculatingFare ? (
                            <View style={styles.modalLoading}>
                                <ActivityIndicator size="large" color={theme.leafGreen || '#41D274'} />
                                <Typography variant="body" color={theme.textSecondary} style={{ marginTop: 15 }}>
                                    {t('calculating_fare', 'Calculando nova tarifa...')}
                                </Typography>
                            </View>
                        ) : newDropEstimate ? (
                            <View>
                                <View style={{ marginBottom: 12 }}>
                                    <Typography variant="label" color={theme.textSecondary}>{t('new_destination', 'Novo Destino:')}</Typography>
                                    <Typography variant="body" color={theme.text}>{newDropEstimate.newDrop?.add}</Typography>
                                </View>

                                <View style={{ marginBottom: 20 }}>
                                    <Typography variant="label" color={theme.textSecondary}>{t('new_fare', 'Nova Tarifa Estimada:')}</Typography>
                                    <Typography variant="h2" color={theme.leafGreen || '#41D274'}>R$ {(newDropEstimate.estimate).toFixed(2)}</Typography>
                                </View>

                                {newDropEstimate.diff > 0 ? (
                                    <View style={[styles.fareAlertIncrease, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(255, 193, 7, 0.1)' : '#FFF3CD', borderLeftColor: '#FFC107' }]}>
                                        <Typography variant="caption" color={theme.card === '#1A1A1A' ? '#FFC107' : '#856404'} weight="bold">
                                            {t('fare_increase', 'Atenção: A corrida ficou mais longa. Para confirmar a alteração, um Pix adicional de')} R$ {(newDropEstimate.diff).toFixed(2)} {t('fare_increase_end', 'será solicitado após sua confirmação.')}
                                        </Typography>
                                    </View>
                                ) : parseFloat(newDropEstimate.diff).toFixed(2) == 0 ? (
                                    <View style={[styles.fareAlertSame, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(108, 117, 125, 0.1)' : '#E2E3E5', borderLeftColor: '#6C757D' }]}>
                                        <Typography variant="caption" color={theme.card === '#1A1A1A' ? '#c0c0c0' : '#383D41'} weight="bold">
                                            {t('fare_same', 'A tarifa estimada permanece a mesma.')}
                                        </Typography>
                                    </View>
                                ) : (
                                    <View style={[styles.fareAlertDecrease, { backgroundColor: theme.card === '#1A1A1A' ? 'rgba(40, 167, 69, 0.1)' : '#D4EDDA', borderLeftColor: '#28A745' }]}>
                                        <Typography variant="caption" color={theme.card === '#1A1A1A' ? '#41D274' : '#155724'} weight="bold">
                                            {t('fare_decrease', 'Sua viagem ficou mais barata! A diferença será automaticamente recalculada e estornada no encerramento da corrida.')}
                                        </Typography>
                                    </View>
                                )}

                                <View style={styles.modalFooter}>
                                    <View style={{ flex: 1, marginRight: 8 }}>
                                        <AnimatedButton
                                            title={t('cancel', 'Cancelar')}
                                            variant="outline"
                                            onPress={() => setChangeDestModalVisible(false)}
                                        />
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 8 }}>
                                        <AnimatedButton
                                            title={t('confirm', 'Confirmar')}
                                            onPress={confirmDestinationChange}
                                        />
                                    </View>
                                </View>
                            </View>
                        ) : null}
                    </View>
                </View>
            </Modal>
        </View>
    );
}


const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    map: {
        flex: 1,
        width: '100%',
        height: '100%',
    },
    mapControls: {
        position: 'absolute',
        top: '50%',
        right: 20,
        zIndex: 1000,
        transform: [{ translateY: -25 }], // Centralizar verticalmente o botão
    },
    controlButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    // Estilos para cards de valores (baseado no MapScreen.js antigo)
    carOptionsContainer: {
        position: 'absolute',
        bottom: 120,
        left: 20,
        right: 20,
        zIndex: 1000,
    },
    carOptionsMainCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 15,
        padding: 15,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    carCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        marginBottom: 10,
        borderRadius: 10,
        backgroundColor: '#F8F9FA',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    selectedCarCard: {
        borderColor: '#41D274',
        backgroundColor: '#E8F5E8',
    },
    carImage: {
        width: 50,
        height: 50,
        borderRadius: 25,
        marginRight: 15,
    },
    carInfo: {
        flex: 1,
    },
    carNameValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#000000',
    },
    priceNameValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#41D274',
    },
    carDetailsRow: {
        marginTop: 5,
    },
    carSubInfo: {
        fontSize: 14,
        color: '#666666',
    },
    bookButtonContainer: {
        position: 'absolute',
        bottom: 20,
        left: 20,
        right: 20,
        zIndex: 1000,
    },
    bookButton: {
        backgroundColor: '#41D274',
        borderRadius: 25,
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    bookButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    bookButtonSubtext: {
        color: '#FFFFFF',
        fontSize: 14,
        marginTop: 5,
        opacity: 0.9,
    },
    // Estilos do Modal de Mudança de Destino
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalView: {
        width: '90%',
        backgroundColor: '#FFF',
        borderRadius: 20,
        padding: 25,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    modalTitle: {
        fontFamily: fonts.Bold,
        fontSize: 20,
        marginBottom: 20,
        color: '#333',
        textAlign: 'center'
    },
    modalText: {
        fontFamily: fonts.Regular,
        fontSize: 15,
        marginBottom: 12,
        color: '#444',
        lineHeight: 22
    },
    boldText: {
        fontFamily: fonts.Bold,
        color: '#000'
    },
    modalLoading: {
        marginVertical: 30,
        alignItems: 'center'
    },
    modalLoadingText: {
        marginTop: 15,
        fontFamily: fonts.Regular,
        color: '#666'
    },
    fareAlertIncrease: {
        backgroundColor: '#FFF3CD',
        padding: 15,
        borderRadius: 12,
        marginBottom: 20,
        borderLeftWidth: 5,
        borderLeftColor: '#FFC107'
    },
    fareAlertIncreaseText: {
        fontFamily: fonts.Bold,
        color: '#856404',
        fontSize: 14,
        lineHeight: 20
    },
    fareAlertSame: {
        backgroundColor: '#E2E3E5',
        padding: 15,
        borderRadius: 12,
        marginBottom: 20,
        borderLeftWidth: 5,
        borderLeftColor: '#6C757D'
    },
    fareAlertSameText: {
        fontFamily: fonts.Bold,
        color: '#383D41',
        fontSize: 14
    },
    fareAlertDecrease: {
        backgroundColor: '#D4EDDA',
        padding: 15,
        borderRadius: 12,
        marginBottom: 20,
        borderLeftWidth: 5,
        borderLeftColor: '#28A745'
    },
    fareAlertDecreaseText: {
        fontFamily: fonts.Bold,
        color: '#155724',
        fontSize: 14,
        lineHeight: 20
    },
    modalFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 10
    },
    cancelButton: {
        paddingVertical: 12,
        width: '45%',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#DC3545'
    },
    cancelButtonText: {
        color: '#DC3545',
        fontFamily: fonts.Bold,
        fontSize: 16
    },
    confirmButton: {
        backgroundColor: '#28A745',
        paddingVertical: 12,
        width: '45%',
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: '#28A745',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
        elevation: 3
    },
    confirmButtonText: {
        color: '#FFF',
        // fontFamily: fonts.Bold, // Assuming fonts is defined elsewhere, keeping original for now
        fontSize: 16
    }
});

import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    StyleSheet,
    Dimensions,
    TouchableOpacity,
    Alert,
    Platform
} from 'react-native';
import { Icon } from 'react-native-elements';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';
import { useTheme } from '../common-local/theme';
import PassengerUI from '../components/map/PassengerUI';
import DriverUI from '../components/map/DriverUI';
import DecodePolyLine from '@mapbox/polyline';

const { width, height } = Dimensions.get('window');

export default function NewMapScreen({ navigation }) {
    const dispatch = useDispatch();
    const theme = useTheme();
    const auth = useSelector(state => state.auth);
    const tripdata = useSelector(state => state.tripdata);
    const booking = useSelector(state => state.bookingdata);

    // Estados
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [currentLocation, setCurrentLocation] = useState(null);
    const [pickupAddress, setPickupAddress] = useState('');
    const [routePolyline, setRoutePolyline] = useState([]);
    const [mapRef, setMapRef] = useState(null);

    // Refs
    const locationSubscription = useRef(null);

    // Debug: verificar perfil do usuário
    useEffect(() => {
        console.log('🔍 NewMapScreen - Debug renderUI:', {
            authProfile: auth?.profile,
            userType: auth?.profile?.usertype || auth?.profile?.userType,
            profileKeys: auth?.profile ? Object.keys(auth.profile) : 'No profile'
        });
    }, [auth]);

    // Função para alternar tema
    const toggleTheme = () => {
        setIsDarkMode(!isDarkMode);
        console.log('🌙 Tema alternado para:', !isDarkMode ? 'escuro' : 'claro');
    };

    // Função para obter localização atual
    const getCurrentLocation = async () => {
        try {
            console.log('📍 Solicitando permissão de localização...');
            
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permissão Negada', 'Precisamos da sua localização para funcionar corretamente.');
                return;
            }

            console.log('📍 Obtendo localização atual...');
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
                timeout: 10000,
                maximumAge: 60000
            });

            const newLocation = {
                lat: location.coords.latitude,
                lng: location.coords.longitude,
                accuracy: location.coords.accuracy
            };

            setCurrentLocation(newLocation);
            console.log('✅ Localização atual obtida:', newLocation);

            // Obter endereço da localização
            try {
                const addressResult = await Location.reverseGeocodeAsync({
                    latitude: newLocation.lat,
                    longitude: newLocation.lng
                });

                if (addressResult && addressResult.length > 0) {
                    const address = addressResult[0];
                    const formattedAddress = address.formattedAddress || 
                        [address.street, address.streetNumber, address.district, address.city, address.region]
                            .filter(Boolean)
                            .join(', ');
                    
                    setPickupAddress(formattedAddress);
                    console.log('📍 Endereço obtido:', formattedAddress);
                }
            } catch (addressError) {
                console.warn('⚠️ Não foi possível obter endereço:', addressError);
                setPickupAddress('Localização atual');
            }

        } catch (error) {
            console.error('❌ Erro ao obter localização:', error);
            Alert.alert('Erro', 'Não foi possível obter sua localização. Verifique as permissões.');
        }
    };

    // Função para centralizar no usuário
    const centerOnUser = () => {
        if (mapRef && currentLocation) {
            mapRef.animateToRegion({
                latitude: currentLocation.lat,
                longitude: currentLocation.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
            }, 1000);
            console.log('🎯 Mapa centralizado no usuário');
        }
    };

    // Função para alternar tipo de mapa
    const toggleMapType = () => {
        console.log('🗺️ Alternando tipo de mapa...');
    };

    // Função para alternar tráfego
    const toggleTraffic = () => {
        console.log('🚦 Alternando tráfego...');
    };

    // Obter localização inicial
    useEffect(() => {
        getCurrentLocation();

        // Configurar listener de localização em tempo real
        if (Platform.OS === 'ios') {
            locationSubscription.current = Location.watchPositionAsync(
                {
                    accuracy: Location.Accuracy.High,
                    timeInterval: 10000,
                    distanceInterval: 10,
                },
                (location) => {
                    const newLocation = {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude,
                        accuracy: location.coords.accuracy
                    };
                    setCurrentLocation(newLocation);
                }
            );
        }

        return () => {
            if (locationSubscription.current) {
                locationSubscription.current.remove();
            }
        };
    }, []);

    // Monitorar mudanças na polyline da rota
    useEffect(() => {
        if (booking?.driver_to_pickup_polyline) {
            try {
                const points = DecodePolyLine.decode(booking.driver_to_pickup_polyline);
                const coords = points.map(point => ({
                    latitude: point[0],
                    longitude: point[1]
                }));
                setRoutePolyline(coords);
                console.log('✅ Polyline driver_to_pickup atualizada:', coords.length, 'pontos');
            } catch (error) {
                console.error('❌ Erro ao decodificar polyline driver_to_pickup:', error);
            }
        } else if (booking?.trip_polyline) {
            try {
                const points = DecodePolyLine.decode(booking.trip_polyline);
                const coords = points.map(point => ({
                    latitude: point[0],
                    longitude: point[1]
                }));
                setRoutePolyline(coords);
                console.log('✅ Polyline trip atualizada:', coords.length, 'pontos');
            } catch (error) {
                console.error('❌ Erro ao decodificar polyline trip:', error);
            }
        } else if (tripdata?.pickup?.routeData?.polyline) {
            try {
                const points = DecodePolyLine.decode(tripdata.pickup.routeData.polyline);
                const coords = points.map(point => ({
                    latitude: point[0],
                    longitude: point[1]
                }));
                setRoutePolyline(coords);
                console.log('✅ Polyline pickup routeData atualizada:', coords.length, 'pontos');
            } catch (error) {
                console.error('❌ Erro ao decodificar polyline pickup routeData:', error);
            }
        } else if (tripdata?.drop?.routeData?.polyline) {
            try {
                const points = DecodePolyLine.decode(tripdata.drop.routeData.polyline);
                const coords = points.map(point => ({
                    latitude: point[0],
                    longitude: point[1]
                }));
                setRoutePolyline(coords);
                console.log('✅ Polyline drop routeData atualizada:', coords.length, 'pontos');
            } catch (error) {
                console.error('❌ Erro ao decodificar polyline drop routeData:', error);
            }
        }
    }, [
        booking?.driver_to_pickup_polyline,
        booking?.trip_polyline,
        tripdata?.pickup?.routeData?.polyline,
        tripdata?.drop?.routeData?.polyline
    ]);

    // Determinar qual UI renderizar baseado no tipo de usuário
    const renderUI = () => {
        const userType = auth?.profile?.usertype || auth?.profile?.userType;
        
        console.log('🎭 Renderizando UI para userType:', userType);
        
        if (userType === 'driver') {
            return (
                <DriverUI
                    theme={theme}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                    currentLocation={currentLocation}
                    pickupAddress={pickupAddress}
                />
            );
        } else {
            return (
                <PassengerUI
                    theme={theme}
                    isDarkMode={isDarkMode}
                    toggleTheme={toggleTheme}
                    currentLocation={currentLocation}
                    pickupAddress={pickupAddress}
                />
            );
        }
    };

    // Cores do mapa baseadas no tema
    const mapColors = {
        primary: theme.leafGreen || '#4CAF50',
        background: theme.background || '#FFFFFF',
        surface: theme.card || '#F5F5F5',
        text: theme.text || '#000000'
    };

    // Estilos do mapa baseados no tema
    const customMapStyle = isDarkMode ? darkMapStyle : lightMapStyle;

    return (
        <View style={[styles.container, { backgroundColor: mapColors.background }]}>
            {/* Mapa */}
            <MapView
                ref={setMapRef}
                style={styles.map}
                customMapStyle={customMapStyle}
                showsUserLocation={true}
                showsMyLocationButton={false}
                showsCompass={true}
                showsScale={true}
                showsTraffic={false}
                showsBuildings={true}
                showsIndoors={true}
                showsIndoorLevelPicker={true}
                showsPointsOfInterest={true}
                showsMapToolbar={false}
                initialRegion={{
                    latitude: currentLocation?.lat || -22.9068,
                    longitude: currentLocation?.lng || -43.1729,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                }}
                onMapReady={() => {
                    console.log('🗺️ Mapa carregado e pronto');
                }}
            >
                {/* Marcador do usuário */}
                {currentLocation && (
                    <Marker
                        coordinate={{
                            latitude: currentLocation.lat,
                            longitude: currentLocation.lng
                        }}
                        title="Sua localização"
                        description={pickupAddress || 'Localização atual'}
                        anchor={{ x: 0.5, y: 0.5 }}
                    >
                        <View style={styles.userMarker}>
                            <Icon 
                                name="my-location" 
                                type="material" 
                                color={mapColors.primary} 
                                size={24} 
                            />
                        </View>
                    </Marker>
                )}

                {/* Marcador de pickup */}
                {tripdata?.pickup?.lat && (
                    <Marker
                        coordinate={{
                            latitude: tripdata.pickup.lat,
                            longitude: tripdata.pickup.lng
                        }}
                        title="Local de partida"
                        description={tripdata.pickup.address}
                        anchor={{ x: 0.5, y: 1.0 }}
                    >
                        <View style={[styles.pickupMarker, { backgroundColor: mapColors.primary }]}>
                            <Icon 
                                name="location-on" 
                                type="material" 
                                color="#FFFFFF" 
                                size={20} 
                            />
                        </View>
                    </Marker>
                )}

                {/* Marcador de destino */}
                {tripdata?.drop?.lat && (
                    <Marker
                        coordinate={{
                            latitude: tripdata.drop.lat,
                            longitude: tripdata.drop.lng
                        }}
                        title="Destino"
                        description={tripdata.drop.address}
                        anchor={{ x: 0.5, y: 1.0 }}
                    >
                        <View style={[styles.dropMarker, { backgroundColor: '#FF5722' }]}>
                            <Icon 
                                name="location-on" 
                                type="material" 
                                color="#FFFFFF" 
                                size={20} 
                            />
                        </View>
                    </Marker>
                )}

                {/* Polyline da rota */}
                {routePolyline.length > 0 && (
                    <Polyline
                        coordinates={routePolyline}
                        strokeColor={mapColors.primary}
                        strokeWidth={4}
                        lineCap="round"
                        lineJoin="round"
                        geodesic={true}
                    />
                )}
            </MapView>

            {/* Controles do mapa */}
            <View style={styles.mapControls}>
                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: mapColors.surface }]}
                    onPress={centerOnUser}
                    activeOpacity={0.8}
                >
                    <Icon 
                        name="my-location" 
                        type="material" 
                        color={mapColors.primary} 
                        size={24} 
                    />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: mapColors.surface }]}
                    onPress={toggleMapType}
                    activeOpacity={0.8}
                >
                    <Icon 
                        name="layers" 
                        type="material" 
                        color={mapColors.primary} 
                        size={24} 
                    />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.controlButton, { backgroundColor: mapColors.surface }]}
                    onPress={toggleTraffic}
                    activeOpacity={0.8}
                >
                    <Icon 
                        name="traffic" 
                        type="material" 
                        color={mapColors.primary} 
                        size={24} 
                    />
                </TouchableOpacity>
            </View>

            {/* UI específica do usuário */}
            {renderUI()}
        </View>
    );
}

// Estilos do mapa para modo claro
const lightMapStyle = [
    {
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#f5f5f5"
            }
        ]
    },
    {
        "elementType": "labels.icon",
        "stylers": [
            {
                "visibility": "off"
            }
        ]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#616161"
            }
        ]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [
            {
                "color": "#f5f5f5"
            }
        ]
    },
    {
        "featureType": "administrative.land_parcel",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#bdbdbd"
            }
        ]
    },
    {
        "featureType": "poi",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#eeeeee"
            }
        ]
    },
    {
        "featureType": "poi",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "featureType": "poi.park",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#e5e5e5"
            }
        ]
    },
    {
        "featureType": "poi.park",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#9e9e9e"
            }
        ]
    },
    {
        "featureType": "road",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#ffffff"
            }
        ]
    },
    {
        "featureType": "road.arterial",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#dadada"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#616161"
            }
        ]
    },
    {
        "featureType": "road.local",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#9e9e9e"
            }
        ]
    },
    {
        "featureType": "transit.line",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#e5e5e5"
            }
        ]
    },
    {
        "featureType": "transit.station",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#eeeeee"
            }
        ]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#c9c9c9"
            }
        ]
    },
    {
        "featureType": "water",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#9e9e9e"
            }
        ]
    }
];

// Estilos do mapa para modo escuro
const darkMapStyle = [
    {
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#212121"
            }
        ]
    },
    {
        "elementType": "labels.icon",
        "stylers": [
            {
                "visibility": "off"
            }
        ]
    },
    {
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "elementType": "labels.text.stroke",
        "stylers": [
            {
                "color": "#212121"
            }
        ]
    },
    {
        "featureType": "administrative",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "featureType": "poi",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#212121"
            }
        ]
    },
    {
        "featureType": "poi",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "featureType": "poi.park",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#1b1b1b"
            }
        ]
    },
    {
        "featureType": "poi.park",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#6b6b6b"
            }
        ]
    },
    {
        "featureType": "road",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#424242"
            }
        ]
    },
    {
        "featureType": "road.arterial",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#373737"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#3c3c3c"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "geometry.stroke",
        "stylers": [
            {
                "color": "#4a4a4a"
            }
        ]
    },
    {
        "featureType": "road.highway",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#9e9e9e"
            }
        ]
    },
    {
        "featureType": "road.local",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#616161"
            }
        ]
    },
    {
        "featureType": "road.local",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#9e9e9e"
            }
        ]
    },
    {
        "featureType": "transit",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#2f2f2f"
            }
        ]
    },
    {
        "featureType": "transit.line",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#757575"
            }
        ]
    },
    {
        "featureType": "transit.station",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#212121"
            }
        ]
    },
    {
        "featureType": "water",
        "elementType": "geometry",
        "stylers": [
            {
                "color": "#000000"
            }
        ]
    },
    {
        "featureType": "water",
        "elementType": "labels.text.fill",
        "stylers": [
            {
                "color": "#3d3d3d"
            }
        ]
    }
];

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    map: {
        width: width,
        height: height,
    },
    mapControls: {
        position: 'absolute',
        right: 20,
        top: 120,
        gap: 12,
    },
    controlButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    userMarker: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    pickupMarker: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
    dropMarker: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
        elevation: 5,
    },
}); 
import React, { useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    Dimensions,
    Platform,
    StatusBar,
    Animated
} from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { Icon } from 'react-native-elements';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkTheme, lightTheme } from '../common/theme';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline, UrlTile } from 'react-native-maps';

// Importar os componentes modernos
import ModernAddressCard from './ModernAddressCard';
import ModernCarCard from './ModernCarCard';
import ModernBookButton from './ModernBookButton';

const { width, height } = Dimensions.get('window');

// Exemplo de dados mockados para demonstração
const mockCarTypes = [
    {
        id: '1',
        name: 'Leaf Plus',
        image: 'https://cdn.pixabay.com/photo/2017/06/03/08/11/car-2368193_640.png',
        min_fare: 8.50,
        extra_info: 'Capacity: 3, Type: Taxi',
    },
    {
        id: '2',
        name: 'Leaf Elite',
        image: 'https://cdn.pixabay.com/photo/2022/01/23/18/20/car-6961567_640.png',
        min_fare: 12.00,
        extra_info: 'Capacity: 4, Type: Premium',
    },
    {
        id: '3',
        name: 'Leaf XL',
        image: 'https://cdn.pixabay.com/photo/2016/11/18/12/51/automobile-1834274_640.png',
        min_fare: 15.00,
        extra_info: 'Capacity: 6, Type: Van',
    }
];

const ModernMapScreenExample = ({ navigation }) => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [selectedCarType, setSelectedCarType] = useState(null);
    const [pickup, setPickup] = useState(null);
    const [drop, setDrop] = useState(null);
    const [loading, setLoading] = useState(false);
    const [fadeAnim] = useState(new Animated.Value(0));

    const currentTheme = isDarkMode ? darkTheme : lightTheme;

    useEffect(() => {
        // Animação de entrada da tela
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
        }).start();
    }, []);

    const handlePickupPress = () => {
        // Simular seleção de endereço de partida
        setPickup({
            placeName: 'Shopping Center',
            add: 'Av. Paulista, 1000, São Paulo'
        });
    };

    const handleDropPress = () => {
        // Simular seleção de endereço de destino
        setDrop({
            placeName: 'Aeroporto de Congonhas',
            add: 'Av. Washington Luís, São Paulo'
        });
    };

    const handleCarSelect = (car) => {
        setSelectedCarType(car);
    };

    const handleBookNow = () => {
        setLoading(true);
        // Simular processo de agendamento
        setTimeout(() => {
            setLoading(false);
            // Navegar para tela de confirmação
            // navigation.navigate('BookingConfirmation');
        }, 2000);
    };

    const getSelectedCarPrice = () => {
        if (!selectedCarType) return null;
        return selectedCarType.min_fare;
    };

    return (
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
            <StatusBar hidden={true} />
            
            {/* Header Moderno */}
            <View style={[styles.header, { backgroundColor: currentTheme.card }]}>
                <TouchableOpacity 
                    style={styles.headerButton}
                    onPress={() => navigation.navigate('Settings')}
                >
                    <MaterialCommunityIcons
                        name="menu"
                        size={24}
                        color={currentTheme.icon}
                    />
                </TouchableOpacity>
                
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={styles.headerButton}
                        onPress={() => navigation.navigate('Notifications')}
                    >
                        <MaterialCommunityIcons
                            name="bell-outline"
                            size={24}
                            color={currentTheme.icon}
                        />
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                        style={styles.headerButton}
                        onPress={() => setIsDarkMode(!isDarkMode)}
                    >
                        <MaterialCommunityIcons
                            name={isDarkMode ? "weather-sunny" : "weather-night"}
                            size={24}
                            color={currentTheme.icon}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Card de Endereços Moderno */}
            <ModernAddressCard
                pickup={pickup}
                drop={drop}
                onPickupPress={handlePickupPress}
                onDropPress={handleDropPress}
                theme={isDarkMode ? 'dark' : 'light'}
                isActive={true}
            />

            {/* Mapa */}
            <View style={styles.mapContainer}>
                <MapView
                    provider={PROVIDER_GOOGLE}
                    <UrlTile
                        urlTemplate="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        maximumZ={19}
                        flipY={false}
                    />
                    style={styles.map}
                    initialRegion={{
                        latitude: -23.5505,
                        longitude: -46.6333,
                        latitudeDelta: 0.0922,
                        longitudeDelta: 0.0421,
                    }}
                    customMapStyle={isDarkMode ? darkMapStyle : lightMapStyle}
                />
            </View>

            {/* Cards de Carros Modernos */}
            {pickup && drop && (
                <View style={styles.carCardsContainer}>
                    {mockCarTypes.map((car, index) => (
                        <ModernCarCard
                            key={car.id}
                            car={car}
                            isSelected={selectedCarType?.id === car.id}
                            onPress={() => handleCarSelect(car)}
                            theme={isDarkMode ? 'dark' : 'light'}
                            index={index}
                            estimate={{
                                estimateFare: car.min_fare + Math.random() * 5,
                                duration: 15 + Math.random() * 20,
                                distance: 5 + Math.random() * 10
                            }}
                        />
                    ))}
                </View>
            )}

            {/* Botão de Agendamento Moderno */}
            {selectedCarType && pickup && drop && (
                <ModernBookButton
                    onPress={handleBookNow}
                    loading={loading}
                    disabled={!selectedCarType || !pickup || !drop}
                    price={getSelectedCarPrice()}
                    currency="R$"
                    theme={isDarkMode ? 'dark' : 'light'}
                    text="Agendar Agora"
                    subText="Toque para confirmar"
                />
            )}
        </Animated.View>
    );
};

// Estilos do mapa
const darkMapStyle = [
    { elementType: 'geometry', stylers: [{ color: '#232323' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#232323' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
    {
        featureType: 'road',
        elementType: 'geometry',
        stylers: [{ color: '#383838' }]
    },
    {
        featureType: 'water',
        elementType: 'geometry',
        stylers: [{ color: '#181818' }]
    }
];

const lightMapStyle = [
    { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f2f2f2' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#232323' }] },
    {
        featureType: 'road',
        elementType: 'geometry',
        stylers: [{ color: '#e6e6e6' }]
    },
    {
        featureType: 'water',
        elementType: 'geometry',
        stylers: [{ color: '#d6d6d6' }]
    }
];

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    header: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 30,
        left: 16,
        right: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 20,
        zIndex: 1000,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 6,
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    mapContainer: {
        flex: 1,
        marginTop: Platform.OS === 'ios' ? 120 : 90,
    },
    map: {
        flex: 1,
    },
    carCardsContainer: {
        position: 'absolute',
        bottom: 100,
        left: 16,
        right: 16,
        zIndex: 1000,
    },
});

export default ModernMapScreenExample; 
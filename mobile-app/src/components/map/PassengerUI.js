import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Alert,
    Dimensions,
    Keyboard
} from 'react-native';
import { Icon } from 'react-native-elements';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useLocationIntelligence } from '../../hooks/useLocationIntelligence';
import {
    updateTripPickup,
    updateTripDrop
} from '../../common-local/actions/tripactions';
import { getEstimate } from '../../common-local/actions/estimateactions';
import {
    fetchPlacesAutocomplete,
    fetchCoordsfromPlace,
    getDirectionsApi
} from '../../common-local/GoogleAPIFunctions';
import { prepareEstimateObject } from '../../common/sharedFunctions';
import { MAIN_COLOR } from '../../common/sharedFunctions';
import WooviPaymentModal from '../payment/WooviPaymentModal';
import DecodePolyLine from '@mapbox/polyline';

const { width, height } = Dimensions.get('window');

export default function PassengerUI(props) {
    const { t } = useTranslation();
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const tripdata = useSelector(state => state.tripdata);
    const allCarTypes = useSelector(state => state.cartypes?.carTypes || []);
    const { theme, isDarkMode, toggleTheme, pickupAddress, currentLocation } = props;

    // Location Intelligence
    const locationIntelligence = useLocationIntelligence();

    // Estados
    const [carEstimates, setCarEstimates] = useState({});
    const [routePolyline, setRoutePolyline] = useState([]);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [searchState, setSearchState] = useState({
        type: null,
        visible: false,
        inputText: '',
        results: [],
        loading: false
    });

    // Refs
    const searchTimeoutRef = useRef(null);

    // Auto-preenchimento do pickup com localização atual
    useEffect(() => {
        if (currentLocation && !tripdata.pickup?.lat) {
            console.log('📍 Auto-preenchendo pickup com localização atual');
            const newPickup = {
                lat: currentLocation.lat,
                lng: currentLocation.lng,
                address: pickupAddress || 'Localização atual'
            };
            dispatch(updateTripPickup(newPickup));
        }
    }, [currentLocation, pickupAddress, tripdata.pickup]);

    // Cleanup do timeout
    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);

    // Função para formatar endereço para exibição
    const formatAddressForDisplay = (address) => {
        if (!address || typeof address !== 'string') return 'Endereço não disponível';
        
        let cleanAddress = address.replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').replace(/\s*,\s*$/, '');
        const parts = cleanAddress.split(',').map(part => part.trim()).filter(part => part);
        
        if (parts.length === 0) return 'Endereço não disponível';
        if (parts.length === 1) return parts[0];
        
        const mainLine = parts[0];
        const subtext = parts.slice(1).join(', ');
        
        return { mainLine, subtext };
    };

    // Função para obter subtexto do endereço
    const getAddressSubtext = (address) => {
        const formatted = formatAddressForDisplay(address);
        return typeof formatted === 'string' ? '' : formatted.subtext;
    };

    // Função para verificar se deve mostrar subtexto
    const shouldShowSubtext = (address) => {
        const formatted = formatAddressForDisplay(address);
        return typeof formatted !== 'string' && formatted.subtext;
    };

    // Função para salvar no histórico
    const saveToHistory = (address) => {
        try {
            console.log('💾 Salvando no histórico:', address);
        } catch (error) {
            console.error('❌ Erro ao salvar no histórico:', error);
        }
    };

    // Função para calcular rota e estimativas
    const calculateRouteAndEstimates = async (pickup, drop) => {
        try {
            console.log('🗺️ Iniciando cálculo de rota...');
            
            const routeData = await getDirectionsApi(
                { lat: pickup.lat, lng: pickup.lng },
                { lat: drop.lat, lng: drop.lng }
            );
            
            if (routeData && routeData.distance_in_km) {
                console.log('✅ Rota calculada:', routeData);
                
                const bookingData = {
                    pickup: pickup,
                    drop: drop,
                    routeDetails: {
                        distance_in_km: routeData.distance_in_km,
                        time_in_secs: routeData.duration_in_minutes * 60,
                        polylinePoints: routeData.polyline || routeData.polylinePoints,
                        waypoints: routeData.waypoints || []
                    },
                    carType: 'car',
                    carDetails: allCarTypes[0] || {},
                    instructionData: {}
                };
                
                if (allCarTypes.length > 0) {
                    console.log('💰 Calculando estimativas para', allCarTypes.length, 'tipos de carro...');
                    
                    for (const car of allCarTypes) {
                        const carBookingData = {
                            ...bookingData,
                            carType: car.name,
                            carDetails: car
                        };
                        
                        dispatch(getEstimate(carBookingData));
                    }
                }
                
                if (routeData.polyline || routeData.polylinePoints) {
                    const polylineData = routeData.polyline || routeData.polylinePoints;
                    
                    try {
                        const points = DecodePolyLine.decode(polylineData);
                        const coords = points.map(point => ({
                            latitude: point[0],
                            longitude: point[1]
                        }));
                        
                        setRoutePolyline(coords);
                        console.log('✅ Polyline atualizada com', coords.length, 'pontos');
                        
                        Alert.alert(
                            'Rota Calculada!',
                            `Distância: ${routeData.distance_in_km.toFixed(1)}km\nTempo: ${routeData.duration_in_minutes}min`,
                            [{ text: 'OK' }]
                        );
                    } catch (polylineError) {
                        console.error('❌ Erro ao decodificar polyline:', polylineError);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Erro ao calcular rota:', error);
            Alert.alert('Erro', 'Não foi possível calcular a rota. Tente novamente.');
            createBasicEstimates(pickup, drop);
        }
    };
    
    // Função fallback para criar estimativas básicas
    const createBasicEstimates = async (pickup, drop) => {
        try {
            const R = 6371;
            const dLat = (drop.lat - pickup.lat) * Math.PI / 180;
            const dLon = (drop.lng - pickup.lng) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                     Math.cos(pickup.lat * Math.PI / 180) * Math.cos(drop.lat * Math.PI / 180) *
                     Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;
            
            console.log('📏 Distância aproximada calculada:', distance.toFixed(2), 'km');
            
            if (allCarTypes.length > 0) {
                let estimates = {};
                for (const car of allCarTypes) {
                    const basePrice = distance * 2.5;
                    const estimateObject = {
                        estimateFare: basePrice.toFixed(2),
                        distance: distance.toFixed(2),
                        time: 'Estimativa aproximada'
                    };
                    estimates[car.name] = estimateObject;
                }
                
                setCarEstimates(estimates);
                console.log('✅ Estimativas básicas criadas:', Object.keys(estimates).length);
            }
        } catch (error) {
            console.error('❌ Erro ao criar estimativas básicas:', error);
        }
    };

    // Função para realizar busca
    const performSearch = async (query, type) => {
        try {
            setSearchState(prev => ({ ...prev, loading: true }));
            console.log(`🔍 Buscando "${query}" para ${type}...`);

            let results = await locationIntelligence.getSuggestionsFromRedis(query);
            if (results && results.length > 0) {
                console.log('✅ Resultados do Redis:', results.length);
                setSearchState(prev => ({ ...prev, results, loading: false }));
                return;
            }

            results = await locationIntelligence.getSuggestionsFromFirebase(query);
            if (results && results.length > 0) {
                console.log('✅ Resultados do Firebase:', results.length);
                setSearchState(prev => ({ ...prev, results, loading: false }));
                return;
            }

            console.log('🔄 Cache vazio, buscando no Google Places...');
            results = await fetchPlacesAutocomplete(query);
            
            if (results && results.length > 0) {
                console.log('✅ Resultados do Google Places:', results.length);
                await locationIntelligence.cacheSuggestions(query, results, 'google_places');
                setSearchState(prev => ({ ...prev, results, loading: false }));
            } else {
                setSearchState(prev => ({ ...prev, results: [], loading: false }));
            }
        } catch (error) {
            console.error('❌ Erro na busca:', error);
            setSearchState(prev => ({ ...prev, results: [], loading: false }));
        }
    };

    // Função debounced para busca
    const debouncedSearch = useCallback((text, type) => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (text.length < 3) {
            setSearchState(prev => ({ ...prev, results: [], loading: false }));
            return;
        }

        searchTimeoutRef.current = setTimeout(() => {
            performSearch(text, type);
        }, 1000);
    }, []);

    // Função para selecionar endereço
    const handleSelectAddress = async (address, type) => {
        try {
            console.log(`📍 Selecionando endereço para ${type}:`, address);
            
            let newAddress = address;
            if (address.place_id && !address.lat) {
                const coords = await fetchCoordsfromPlace(address.place_id);
                if (coords) {
                    newAddress = { ...address, ...coords };
                }
            }

            if (type === 'pickup') {
                dispatch(updateTripPickup(newAddress));
            } else if (type === 'drop') {
                dispatch(updateTripDrop(newAddress));
            }

            setSearchState(prev => ({ ...prev, visible: false, inputText: '' }));

            if (!address.source || !address.source.includes('cache')) {
                saveToHistory(address);
            }

            if (type === 'drop' && tripdata.pickup?.lat && newAddress.lat) {
                console.log('🗺️ Calculando rota e estimativas...');
                calculateRouteAndEstimates(tripdata.pickup, newAddress);
            }
        } catch (error) {
            console.error('❌ Erro ao selecionar endereço:', error);
            Alert.alert('Erro', 'Não foi possível selecionar o endereço. Tente novamente.');
        }
    };

    // Função para iniciar busca
    const handleStartSearch = (type) => {
        setSearchState(prev => ({
            ...prev,
            type,
            visible: true,
            inputText: tripdata[type]?.address || '',
            results: [],
            loading: false
        }));
    };

    // Função para finalizar busca
    const handleFinishSearch = () => {
        setSearchState(prev => ({
            ...prev,
            visible: false,
            inputText: '',
            results: [],
            loading: false
        }));
        Keyboard.dismiss();
    };

    // Função para calcular posição do dropdown
    const getDropdownPosition = (type) => {
        if (type === 'pickup') {
            return { top: 120 };
        } else {
            return { top: 200 };
        }
    };

    // Componente de campos de endereço
    const AddressFields = useMemo(() => (
        <View style={styles.addressContainer}>
            {/* Campo de Origem */}
            <View style={styles.addressField}>
                <View style={styles.addressLabel}>
                    <MaterialCommunityIcons 
                        name="map-marker" 
                        size={20} 
                        color={MAIN_COLOR} 
                    />
                    <Text style={[styles.addressLabelText, { color: theme.text }]}>
                        Origem
                    </Text>
                </View>
                
                {searchState.visible && searchState.type === 'pickup' ? (
                    <TextInput
                        style={[styles.addressInput, { 
                            backgroundColor: theme.card,
                            color: theme.text,
                            borderColor: theme.divider
                        }]}
                        value={searchState.inputText}
                        onChangeText={(text) => {
                            setSearchState(prev => ({ ...prev, inputText: text }));
                            debouncedSearch(text, 'pickup');
                        }}
                        placeholder="Digite o local de partida"
                        placeholderTextColor={theme.textSecondary}
                        onBlur={handleFinishSearch}
                        autoFocus
                    />
                ) : (
                    <TouchableOpacity
                        style={[styles.addressDisplay, { backgroundColor: theme.card }]}
                        onPress={() => handleStartSearch('pickup')}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.addressText, { color: theme.text }]}>
                            {tripdata.pickup?.address || 'Escolha o local de partida'}
                        </Text>
                        {shouldShowSubtext(tripdata.pickup?.address) && (
                            <Text style={[styles.addressSubtext, { color: theme.textSecondary }]}>
                                {getAddressSubtext(tripdata.pickup?.address)}
                            </Text>
                        )}
                        <Icon name="edit" type="material" size={16} color={theme.icon} />
                    </TouchableOpacity>
                )}
            </View>

            {/* Campo de Destino */}
            <View style={styles.addressField}>
                <View style={styles.addressLabel}>
                    <MaterialCommunityIcons 
                        name="map-marker-check" 
                        size={20} 
                        color={MAIN_COLOR} 
                    />
                    <Text style={[styles.addressLabelText, { color: theme.text }]}>
                        Destino
                    </Text>
                </View>
                
                {searchState.visible && searchState.type === 'drop' ? (
                    <TextInput
                        style={[styles.addressInput, { 
                            backgroundColor: theme.card,
                            color: theme.text,
                            borderColor: theme.divider
                        }]}
                        value={searchState.inputText}
                        onChangeText={(text) => {
                            setSearchState(prev => ({ ...prev, inputText: text }));
                            debouncedSearch(text, 'drop');
                        }}
                        placeholder="Escolha seu destino"
                        placeholderTextColor={theme.textSecondary}
                        onBlur={handleFinishSearch}
                        autoFocus
                    />
                ) : (
                    <TouchableOpacity
                        style={[styles.addressDisplay, { backgroundColor: theme.card }]}
                        onPress={() => handleStartSearch('drop')}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.addressText, { color: theme.text }]}>
                            {tripdata.drop?.address || 'Escolha seu destino'}
                        </Text>
                        {shouldShowSubtext(tripdata.drop?.address) && (
                            <Text style={[styles.addressSubtext, { color: theme.textSecondary }]}>
                                {getAddressSubtext(tripdata.drop?.address)}
                            </Text>
                        )}
                        <Icon name="edit" type="material" size={16} color={theme.icon} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    ), [searchState, tripdata, theme, debouncedSearch]);

    // Componente de dropdown de sugestões
    const AddressDropdown = useMemo(() => {
        if (!searchState.visible || searchState.inputText.length < 3) return null;

        return (
            <View style={[styles.dropdownContainerInline, getDropdownPosition(searchState.type)]}>
                <View style={[styles.dropdownContentInline, { backgroundColor: theme.card }]}>
                    {searchState.loading ? (
                        <View style={styles.loadingContainer}>
                            <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                                🔍 Verificando cache (Redis → Firebase → Google Places)...
                            </Text>
                        </View>
                    ) : searchState.results.length > 0 ? (
                        <ScrollView 
                            style={styles.resultsScrollView}
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                        >
                            {searchState.results.map((result, index) => {
                                const isGooglePlaces = result.place_id || result.structured_formatting;
                                
                                let mainText, subText;
                                
                                if (isGooglePlaces) {
                                    mainText = result.structured_formatting?.main_text || result.name || result.description || 'Local';
                                    subText = result.structured_formatting?.secondary_text || result.vicinity || result.formatted_address || '';
                                } else {
                                    const addressParts = (result.address || result.description || '').split(',').map(part => part.trim()).filter(part => part);
                                    
                                    if (addressParts.length >= 2) {
                                        mainText = addressParts[0];
                                        subText = addressParts.slice(1).join(', ');
                                    } else {
                                        mainText = result.address || result.description || 'Endereço';
                                        subText = '';
                                    }
                                }
                                
                                return (
                                    <TouchableOpacity
                                        key={index}
                                        style={[styles.resultItem, { borderBottomColor: theme.divider }]}
                                        onPress={() => handleSelectAddress(result, searchState.type)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={styles.resultContent}>
                                            <Text style={[styles.resultMainText, { color: theme.text }]}>
                                                {mainText}
                                            </Text>
                                            {subText && (
                                                <Text style={[styles.resultSubText, { color: theme.textSecondary }]}>
                                                    {subText}
                                                </Text>
                                            )}
                                        </View>
                                        <Icon name="chevron-right" type="material" size={16} color={theme.icon} />
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    ) : (
                        <View style={styles.noResultsContainer}>
                            <Text style={[styles.noResultsText, { color: theme.textSecondary }]}>
                                Nenhum resultado encontrado
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        );
    }, [searchState, theme, handleSelectAddress]);

    // Componente de cards de preço
    const PriceCards = useMemo(() => {
        if (Object.keys(carEstimates).length === 0) return null;

        return (
            <View style={styles.priceCardsContainer}>
                <Text style={[styles.priceCardsTitle, { color: theme.text }]}>
                    Tarifas Estimadas
                </Text>
                <ScrollView 
                    horizontal 
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.priceCardsScroll}
                >
                    {Object.entries(carEstimates).map(([carName, estimate]) => (
                        <TouchableOpacity
                            key={carName}
                            style={[styles.priceCard, { backgroundColor: theme.card }]}
                            onPress={() => {
                                console.log('🚗 Carro selecionado:', carName);
                            }}
                            activeOpacity={0.8}
                        >
                            <Text style={[styles.carName, { color: theme.text }]}>
                                {carName}
                            </Text>
                            <Text style={[styles.estimatePrice, { color: MAIN_COLOR }]}>
                                R$ {estimate.estimateFare || estimate.fareCost || 'N/A'}
                            </Text>
                            <Text style={[styles.estimateDetails, { color: theme.textSecondary }]}>
                                {estimate.distance || estimate.estimateDistance} km • {estimate.time || estimate.estimateTime} min
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>
        );
    }, [carEstimates, theme]);

    // Componente de botão de solicitar corrida
    const BookNowButton = useMemo(() => {
        if (!tripdata.pickup?.lat || !tripdata.drop?.lat) return null;

        return (
            <TouchableOpacity
                style={[styles.bookNowButton, { backgroundColor: MAIN_COLOR }]}
                onPress={() => {
                    console.log('🚗 Solicitando corrida...');
                    setShowPaymentModal(true);
                }}
                activeOpacity={0.8}
            >
                <Text style={styles.bookNowButtonText}>
                    {t('book_now_text')}
                </Text>
            </TouchableOpacity>
        );
    }, [tripdata, theme, t]);

    // Componente de header
    const Header = () => (
        <View style={styles.header}>
            <TouchableOpacity 
                style={[styles.headerButton, { backgroundColor: theme.card }]}
                onPress={() => {
                    console.log('📱 Menu aberto');
                }}
            >
                <Icon name="menu" type="material" color={theme.icon} size={24} />
            </TouchableOpacity>
            
            <View style={styles.headerRightContainer}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.card }]}
                    onPress={() => {
                        console.log('🔔 Notificações');
                    }}
                >
                    <Icon name="notifications" type="material" color={theme.icon} size={24} />
                </TouchableOpacity>
                
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.card }]}
                    onPress={toggleTheme}
                >
                    <Icon 
                        name={isDarkMode ? "wb-sunny" : "nightlight-round"} 
                        type="material" 
                        color={theme.icon} 
                        size={24} 
                    />
                </TouchableOpacity>
            </View>
        </View>
    );

    // Botão de teste para Location Intelligence
    const TestLocationIntelligenceButton = () => (
        <TouchableOpacity
            style={[styles.testButton, { backgroundColor: theme.card }]}
            onPress={async () => {
                try {
                    console.log('🧠 Testando Location Intelligence...');
                    const stats = await locationIntelligence.getStats();
                    console.log('📊 Estatísticas:', stats);
                    
                    if (stats) {
                        Alert.alert(
                            'Location Intelligence Stats',
                            `Redis Keys: ${stats.redisKeys || 0}\nFirebase Docs: ${stats.firebaseDocs || 0}\nTotal Queries: ${stats.totalQueries || 0}`
                        );
                    }
                } catch (error) {
                    console.error('❌ Erro no teste:', error);
                    Alert.alert('Erro', 'Falha ao testar Location Intelligence');
                }
            }}
        >
            <Text style={[styles.testButtonText, { color: theme.text }]}>
                🧠 LI Test
            </Text>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container} pointerEvents="box-none">
            {/* Header */}
            <View style={styles.headerFloating} pointerEvents="box-none">
                <Header />
            </View>

            {/* Botão de teste */}
            <View style={styles.testButtonFloating} pointerEvents="box-none">
                <TestLocationIntelligenceButton />
            </View>

            {/* Campos de endereço */}
            <View style={styles.addressFloating} pointerEvents="box-none">
                {AddressFields}
            </View>

            {/* Dropdown de sugestões */}
            {AddressDropdown}

            {/* Cards de preço */}
            <View style={styles.priceCardsFloating} pointerEvents="box-none">
                {PriceCards}
            </View>

            {/* Botão de solicitar corrida */}
            <View style={styles.bookNowFloating} pointerEvents="box-none">
                {BookNowButton}
            </View>

            {/* Modal de pagamento */}
            <WooviPaymentModal
                visible={showPaymentModal}
                onClose={() => setShowPaymentModal(false)}
                tripData={tripdata}
                estimates={carEstimates}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    
    // Header
    headerFloating: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        zIndex: 1000,
        paddingHorizontal: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
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
        gap: 12,
    },

    // Botão de teste
    testButtonFloating: {
        position: 'absolute',
        top: 120,
        right: 20,
        zIndex: 999,
    },
    testButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 3,
    },
    testButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },

    // Campos de endereço
    addressFloating: {
        position: 'absolute',
        top: 180,
        left: 20,
        right: 20,
        zIndex: 998,
    },
    addressContainer: {
        gap: 16,
    },
    addressField: {
        gap: 8,
    },
    addressLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    addressLabelText: {
        fontSize: 14,
        fontWeight: '600',
    },
    addressDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'transparent',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    addressInput: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        fontSize: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    addressText: {
        fontSize: 16,
        flex: 1,
        marginRight: 8,
    },
    addressSubtext: {
        fontSize: 14,
        color: '#666',
        marginTop: 2,
    },

    // Dropdown de sugestões
    dropdownContainerInline: {
        position: 'absolute',
        left: 20,
        right: 20,
        zIndex: 997,
    },
    dropdownContentInline: {
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 5,
        minHeight: 120,
    },
    resultsScrollView: {
        maxHeight: 300,
    },
    resultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    resultContent: {
        flex: 1,
        marginRight: 12,
    },
    resultMainText: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    resultSubText: {
        fontSize: 14,
        color: '#666',
    },
    loadingContainer: {
        padding: 20,
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 14,
        textAlign: 'center',
    },
    noResultsContainer: {
        padding: 20,
        alignItems: 'center',
    },
    noResultsText: {
        fontSize: 14,
        textAlign: 'center',
    },

    // Cards de preço
    priceCardsFloating: {
        position: 'absolute',
        bottom: 120,
        left: 20,
        right: 20,
        zIndex: 996,
    },
    priceCardsContainer: {
        gap: 12,
    },
    priceCardsTitle: {
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 8,
    },
    priceCardsScroll: {
        gap: 12,
        paddingHorizontal: 4,
    },
    priceCard: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderRadius: 16,
        minWidth: 160,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    carName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
    },
    estimatePrice: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    estimateDetails: {
        fontSize: 14,
        textAlign: 'center',
    },

    // Botão de solicitar corrida
    bookNowFloating: {
        position: 'absolute',
        bottom: 40,
        left: 20,
        right: 20,
        zIndex: 995,
    },
    bookNowButton: {
        paddingVertical: 16,
        borderRadius: 25,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 5,
    },
    bookNowButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
}); 
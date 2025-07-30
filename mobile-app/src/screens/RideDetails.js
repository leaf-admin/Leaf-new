import React, { useState, useEffect, useRef } from 'react';
import {
    StyleSheet,
    View,
    Text,
    ImageBackground,
    ScrollView,
    Dimensions,
    Platform,
    Image,
    TouchableOpacity,
    Modal,
    Linking,
    Alert,
    StatusBar,
    ActivityIndicator
} from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { Avatar } from 'react-native-elements';
import * as DecodePolyLine from '@mapbox/polyline';
import { colors } from '../common-local/theme';
import i18n from '../i18n';
import StarRating from 'react-native-star-rating-widget';
import { useSelector, useDispatch } from 'react-redux';
import { Ionicons, Entypo, Fontisto, AntDesign, Octicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { appConsts, MAIN_COLOR } from '../common-local/sharedFunctions';
import moment from 'moment/min/moment-with-locales';
var { width, height } = Dimensions.get('window');
import Button from '../components/Button';
import { fonts } from '../common-local/font';
import DownloadReceipt from '../components/DownloadReceipt';
import { getLangKey } from '../common-local/other/getLangKey';
import { Icon } from 'react-native-elements';
import { api } from '../common-local';

export default function RideDetails(props) {
    const { t } = i18n;
    const { getRideDetails, cancelRide } = api;
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const [loading, setLoading] = useState(true);
    const [rideDetails, setRideDetails] = useState(null);
    const [isDarkMode, setIsDarkMode] = useState(false);

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
        loadRideDetails();
    }, []);

    const loadRideDetails = async () => {
        try {
            setLoading(true);
            const response = await getRideDetails(props.route.params.rideId);
            if (response) {
                setRideDetails(response);
            }
        } catch (error) {
            console.error('Erro ao carregar detalhes da corrida:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleCancelRide = async () => {
        try {
            setLoading(true);
            await cancelRide(rideDetails.id);
            props.navigation.goBack();
        } catch (error) {
            console.error('Erro ao cancelar corrida:', error);
        } finally {
            setLoading(false);
        }
    };

    const renderRideInfo = () => (
        <View style={[styles.rideInfoCard, { backgroundColor: theme.card }]}>
            <View style={styles.rideInfoHeader}>
                <Icon
                    name="directions-car"
                    type="material"
                    color={theme.icon}
                    size={24}
                />
                <Text style={[styles.rideInfoTitle, { color: theme.text }]}>
                    Detalhes da Corrida
                </Text>
                                    </View>

            <View style={styles.rideInfoContent}>
                <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
                        Status
                    </Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>
                        {rideDetails.status}
                    </Text>
                </View>

                <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
                        Data
                    </Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>
                        {new Date(rideDetails.created_at).toLocaleDateString()}
                    </Text>
                            </View>

                <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
                        Valor
                    </Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>
                        R$ {rideDetails.amount.toFixed(2)}
                    </Text>
                                            </View>

                <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>
                        Distância
                    </Text>
                    <Text style={[styles.infoValue, { color: theme.text }]}>
                        {rideDetails.distance} km
                    </Text>
                                </View>
                            </View>
                        </View>
    );

    const renderLocationInfo = () => (
        <View style={[styles.locationCard, { backgroundColor: theme.card }]}>
            <View style={styles.locationHeader}>
                <Icon
                    name="location-on"
                    type="material"
                    color={theme.icon}
                    size={24}
                />
                <Text style={[styles.locationTitle, { color: theme.text }]}>
                    Localização
                </Text>
                    </View>

            <View style={styles.locationContent}>
                <View style={styles.locationRow}>
                    <View style={[styles.dot, { backgroundColor: colors.GREEN_DOT }]} />
                    <Text style={[styles.locationText, { color: theme.text }]}>
                        {rideDetails.pickup_address}
                    </Text>
                                </View>

                <View style={styles.locationRow}>
                    <View style={[styles.dot, { backgroundColor: colors.RED }]} />
                    <Text style={[styles.locationText, { color: theme.text }]}>
                        {rideDetails.dropoff_address}
                    </Text>
                                            </View>
                                        </View>
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
                
                <Text style={[styles.headerTitle, { color: theme.text }]}>Detalhes da Corrida</Text>
                
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
                        <ActivityIndicator size="large" color={MAIN_COLOR} />
                    </View>
                ) : rideDetails ? (
                    <View style={styles.contentContainer}>
                        {renderRideInfo()}
                        {renderLocationInfo()}

                        {rideDetails.status === 'PENDING' && (
                            <TouchableOpacity
                                style={[styles.cancelButton, { backgroundColor: colors.LIGHT_RED }]}
                                onPress={handleCancelRide}
                            >
                                <Text style={styles.cancelButtonText}>Cancelar Corrida</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                ) : (
                    <View style={styles.emptyContainer}>
                        <Icon
                            name="error-outline"
                            type="material"
                            color={theme.textSecondary}
                            size={64}
                        />
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            Não foi possível carregar os detalhes da corrida
                        </Text>
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
    rideInfoCard: {
        marginBottom: 16,
        padding: 16,
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    rideInfoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    rideInfoTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 8,
    },
    rideInfoContent: {
        gap: 12,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    infoLabel: {
        fontSize: 14,
    },
    infoValue: {
        fontSize: 14,
        fontWeight: '500',
    },
    locationCard: {
        marginBottom: 16,
        padding: 16,
        borderRadius: 8,
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    locationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    locationTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginLeft: 8,
    },
    locationContent: {
        gap: 12,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 8,
    },
    locationText: {
        flex: 1,
        fontSize: 14,
    },
    cancelButton: {
        marginTop: 16,
        padding: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    cancelButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 10,
    },
});
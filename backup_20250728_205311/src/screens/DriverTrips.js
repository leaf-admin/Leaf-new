import React, { useEffect, useState, useRef } from 'react';
import { Text, View, StyleSheet, Dimensions, StatusBar, TouchableOpacity } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { Icon } from 'react-native-elements';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { colors, darkTheme, lightTheme } from '../common/theme';
import { useDispatch, useSelector } from 'react-redux';
import * as Location from 'expo-location';

var { width, height } = Dimensions.get('window');

export default function DriverTrips(props) {
    const dispatch = useDispatch();
    const auth = useSelector(state => state.auth);
    const gps = useSelector(state => state.gpsdata);
    const [region, setRegion] = useState(null);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const theme = isDarkMode ? darkTheme : lightTheme;
    const isProfileApproved = auth && auth.profile && auth.profile.usertype === 'driver' ? auth.profile.approved === true : true;
    const [driverOnline, setDriverOnline] = useState(auth?.profile?.driverActiveStatus || false);
    const mapRef = useRef();

    useEffect(() => {
        const loadInitialLocation = async () => {
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    return;
                }
                let location = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced
                });
                setRegion({
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01
                });
                dispatch({
                    type: 'UPDATE_GPS_LOCATION',
                    payload: {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude
                    }
                });
            } catch (error) {
                // Silenciar erro
            }
        };
        if (!region) {
            loadInitialLocation();
        }
    }, []);

    useEffect(() => {
        if (region && mapRef.current) {
            mapRef.current.animateToRegion(region, 800);
        }
    }, [region]);

    // Handler do botão online/offline
    const handleToggleOnline = () => {
        setDriverOnline(!driverOnline);
        dispatch({ type: 'UPDATE_PROFILE', payload: { driverActiveStatus: !driverOnline } });
    };

    // ThemeSwitch customizado (sol/lua)
    function ThemeSwitch({ value, onValueChange }) {
        return (
            <TouchableOpacity
                style={styles.themeSwitchTouchable}
                onPress={() => onValueChange(!value)}
                activeOpacity={0.8}
            >
                <View style={[styles.themeSwitchTrack, { backgroundColor: value ? '#111' : '#fff', borderColor: value ? '#111' : '#ddd' }]}> 
                    {/* Sol (esquerda) */}
                    <View style={[styles.themeSwitchIconBubble, {
                        backgroundColor: value ? '#111' : '#111',
                        opacity: value ? 0.4 : 1,
                    }]}
                    >
                        <MaterialCommunityIcons
                            name="white-balance-sunny"
                            size={20}
                            color={'#fff'}
                />
            </View>
                    <View style={{ flex: 1 }} />
                    {/* Lua (direita) */}
                    <View style={[styles.themeSwitchIconBubble, {
                        backgroundColor: value ? '#fff' : '#fff',
                        opacity: value ? 1 : 0.4,
                    }]}
                    >
                        <MaterialCommunityIcons
                            name="weather-night"
                            size={20}
                            color={'#111'}
                        />
                    </View>
                </View>
            </TouchableOpacity>
        );
    }

    // Header flutuante igual ao MapScreen
    const Header = () => (
        <View style={styles.header}>
            <TouchableOpacity 
                style={styles.headerButton}
                onPress={() => props.navigation.navigate('ProfileScreen')}
            >
                <Icon name="menu" type="material" color={theme.icon} size={24} />
            </TouchableOpacity>
            <View style={styles.headerRightContainer}>
                <TouchableOpacity 
                    style={styles.headerButton}
                    onPress={() => props.navigation.navigate && props.navigation.navigate('Notifications')}
                >
                    <Icon name="notifications" type="material" color={theme.icon} size={24} />
                </TouchableOpacity>
                <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
                                            </View>
                                        </View>
    );

    // Adicione os estilos do mapa do MapScreen
    const mapStyleDark = [
      { elementType: 'geometry', stylers: [{ color: '#232323' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#232323' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
      { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
      { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#424242' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#383838' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212121' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f2f2f' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#181818' }] }
    ];
    const mapStyleLight = [
      { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
      { elementType: 'labels.text.stroke', stylers: [{ color: '#f2f2f2' }] },
      { elementType: 'labels.text.fill', stylers: [{ color: '#232323' }] },
      { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#cccccc' }] },
      { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#e0e0e0' }] },
      { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#e6e6e6' }] },
      { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#cccccc' }] },
      { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
      { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#e0e0e0' }] },
      { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d6d6d6' }] }
    ];

    // Componente flutuante de ganhos do dia
    function EarningsBox({ value }) {
        const [show, setShow] = useState(true);
                                            return (
            <View style={styles.earningsBox}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                    <Text style={styles.earningsValueCentered}>
                        {show ? `R$ ${value.toFixed(2).replace('.', ',')}` : '••••'}
                    </Text>
                    <TouchableOpacity style={styles.earningsEye} onPress={() => setShow(!show)}>
                        <Ionicons name={show ? 'eye' : 'eye-off'} size={22} color="#1A330E" />
                    </TouchableOpacity>
                </View>
                                </View>
        );
    }



    return (
        <View style={styles.container}>
            <StatusBar hidden={true} />
            <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={StyleSheet.absoluteFillObject}
                showsUserLocation={true}
                loadingEnabled
                showsMyLocationButton={false}
                initialRegion={region || { latitude: -23.55052, longitude: -46.633308, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
                customMapStyle={isDarkMode ? mapStyleDark : mapStyleLight}
            />
            {/* Header flutuante */}
            <View style={styles.headerFloating} pointerEvents="box-none">
                <Header />
                            </View>
            {/* Earnings flutuante */}
            <View style={styles.earningsFloating} pointerEvents="box-none">
                <TouchableOpacity onPress={() => props.navigation.navigate('EarningsReportScreen', { from: 'map' })} activeOpacity={0.8}>
                    <EarningsBox value={auth?.profile?.earningsToday || 0} />
                </TouchableOpacity>
            </View>
            {/* Botão inferior flutuante */}
            <View style={styles.bottomButtonFloating} pointerEvents="box-none">
                {isProfileApproved ? (
                    <TouchableOpacity
                        style={[styles.onlineButton, { backgroundColor: driverOnline ? '#1A330E' : '#B0B0B0' }]}
                        onPress={handleToggleOnline}
                    >
                        <Text style={styles.onlineButtonText}>{driverOnline ? 'Ficar Offline' : 'Ficar Online'}</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={[styles.onlineButton, { backgroundColor: '#B0B0B0' }]}> 
                        <Text style={styles.onlineButtonText}>Aguardando aprovação</Text>
                    </View>
                )}
            </View>

        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'transparent' },
    headerFloating: { position: 'absolute', top: 75, left: 0, right: 0, zIndex: 1000, paddingHorizontal: 20 },
    bottomButtonFloating: { position: 'absolute', bottom: 82, left: 0, right: 0, alignItems: 'center', zIndex: 1000 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'transparent' },
    headerButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', shadowColor: colors.BLACK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84, elevation: 5, marginHorizontal: 4 },
    headerRightContainer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    onlineButton: { paddingVertical: 6, paddingHorizontal: 17, borderRadius: 24, alignItems: 'center', justifyContent: 'center', minWidth: 200 },
    onlineButtonText: { color: '#f5f1f1', fontSize: 18, fontWeight: 'bold' },
    themeSwitchTouchable: { width: 72, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 0, marginRight: 0 },
    themeSwitchTrack: { width: 72, height: 40, borderRadius: 20, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', position: 'relative', justifyContent: 'space-between', paddingHorizontal: 6, backgroundColor: '#fff', borderColor: '#ddd' },
    themeSwitchIconBubble: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
    earningsFloating: { position: 'absolute', top: 131, left: 0, right: 0, alignItems: 'center', zIndex: 999 },
    earningsBox: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, paddingVertical: 6, paddingHorizontal: 17, minWidth: 200, maxWidth: 200, width: 200, height: 40, shadowColor: colors.BLACK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3.84, elevation: 3, borderWidth: 1, borderColor: '#eee', position: 'relative' },
    earningsLabel: { color: '#1A330E', fontSize: 13, fontWeight: '600', marginBottom: 0 },
    earningsValue: { color: '#1A330E', fontSize: 18, fontWeight: 'bold', marginRight: 6 },
    earningsEye: { position: 'absolute', right: 12, top: '50%', transform: [{ translateY: -11 }] },
    earningsValueCentered: { color: '#1A330E', fontSize: 18, fontWeight: 'bold', textAlign: 'center', width: '100%' },

});

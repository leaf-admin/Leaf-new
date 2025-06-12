import React, { useEffect, useState, useRef, useContext } from 'react';
import {
    StyleSheet,
    View,
    Image,
    Dimensions,
    Text,
    Platform,
    Alert,
    ScrollView,
    StatusBar,
    Animated,
    ImageBackground,
    Linking,
    ActivityIndicator,
    Modal,
    TextInput
} from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { Icon } from 'react-native-elements';
import { colors, darkTheme, lightTheme } from '../common/theme';
import * as Location from 'expo-location';
var { height, width } = Dimensions.get('window');
import i18n from 'i18n-js';
import DatePicker from 'react-native-date-picker';
import { useSelector, useDispatch } from 'react-redux';
import { api, FirebaseContext } from 'common';
import { OptionModal } from '../components/OptionModal';
import BookingModal, { appConsts, prepareEstimateObject } from '../common/sharedFunctions';
import MapView, { PROVIDER_GOOGLE, Marker, Polyline } from 'react-native-maps';
import { CommonActions } from '@react-navigation/native';
import { MAIN_COLOR, CarHorizontal, CarVertical, validateBookingObj, SECONDORY_COLOR } from '../common/sharedFunctions';
import { startActivityAsync, ActivityAction } from 'expo-intent-launcher';
import Button from '../components/Button';
import { fonts } from "../common/font";
import DeviceInfo from 'react-native-device-info';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { fetchPlacesAutocomplete, fetchCoordsfromPlace } from '../common/sharedFunctions';
import uuid from 'react-native-uuid';
import { FareCalculator } from '../common/sharedFunctions';
import database from '@react-native-firebase/database';
import * as DecodePolyLine from '@mapbox/polyline';
import { tollData } from '../../../common/src/actions/estimateactions.js'; // ajuste o caminho se necessário
import { calcularPedagiosPorPolyline } from '../../../common/src/other/TollUtils';
import * as SplashScreen from 'expo-splash-screen';
import { GoogleMapApiConfig } from '../../config/GoogleMapApiConfig';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import splashImg from '../../assets/images/splash.png';

const hasNotch = DeviceInfo.hasNotch();

// Adicionar constante com o estilo personalizado do mapa
const mapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#232323' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#232323' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#757575' }]
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#424242' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#383838' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#212121' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8a8a8a' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f2f2f' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#181818' }]
  }
];

// Estilo do mapa escuro
const mapStyleDark = [
  { elementType: 'geometry', stylers: [{ color: '#232323' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#232323' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#757575' }]
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#424242' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#383838' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#212121' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8a8a8a' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#2f2f2f' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#181818' }]
  }
];

// Estilo do mapa claro (cinza 20%)
const mapStyleLight = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#232323' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry',
    stylers: [{ color: '#cccccc' }]
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#e0e0e0' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#e6e6e6' }]
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#cccccc' }]
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#8a8a8a' }]
  },
  {
    featureType: 'transit',
    elementType: 'geometry',
    stylers: [{ color: '#e0e0e0' }]
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#d6d6d6' }]
  }
];

// Fallback local para tipos de carro (atualizado manualmente conforme solicitado)
const fallbackCarTypes = [
  {
    name: 'Leaf Plus',
    image: 'https://cdn.pixabay.com/photo/2017/06/03/08/11/car-2368193_640.png',
    min_fare: 8,
    base_fare: 2.98,
    rate_per_hour: 15,
    rate_per_unit_distance: 1.22,
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
    min_fare: 10.11,
    base_fare: 5.32,
    rate_per_hour: 17.4,
    rate_per_unit_distance: 2.18,
    convenience_fee_type: 'flat',
    convenience_fees: 0,
    extra_info: 'Capacity: 4, Type: Sedan',
    fleet_admin_fee: 3.2,
    pos: 10,
    id: 'type3'
  }
];

// Função utilitária para extrair rua e número
function getStreetAndNumber(address) {
  if (!address) return '';
  const match = address.match(/^([^,\-]*\d+)[,\-]?/);
  if (match) return match[1].trim();
  return address.split(',')[0].trim();
}

// Função para buscar o nome do local pelo place_id
async function fetchPlaceName(placeId) {
  const apiKey = Platform.OS === 'ios' ? GoogleMapApiConfig.ios : GoogleMapApiConfig.android;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeId}&key=${apiKey}`
    );
    const data = await response.json();
    if (data.result && data.result.name) {
      return data.result.name;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default function MapScreen(props) {
    const {
        fetchAddressfromCoords,
        fetchDrivers,
        updateTripPickup,
        updateTripDrop,
        updatSelPointType,
        getDistanceMatrix,
        MinutesPassed,
        updateTripCar,
        getEstimate,
        clearEstimate,
        addBooking,
        clearBooking,
        clearTripPoints,
        GetDistance,
        updateProfile,
        updateProfileWithEmail,
        checkUserExists,
        storeAddresses,
        fetchPlacesAutocomplete,
        fetchCoordsfromPlace
    } = api;
    const dispatch = useDispatch();
    const { config } = useContext(FirebaseContext);
    const { t } = useTranslation();
    const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;

    const auth = useSelector(state => state.auth);
    const settingsdata = useSelector(state => state.settingsdata.settings);
    console.log('MapScreen - Settings Data do Redux:', JSON.stringify(settingsdata, null, 2));
    console.log('MapScreen - Settings Decimal:', settingsdata?.decimal);
    console.log('MapScreen - Settings Currency:', settingsdata?.currency);
    const cars = useSelector(state => state.cartypes.cars);
    const tripdata = useSelector(state => state.tripdata);
    const usersdata = useSelector(state => state.usersdata);
    const estimatedata = useSelector(state => state.estimatedata);
    const providers = useSelector(state => state.paymentmethods.providers);
    const gps = useSelector(state => state.gpsdata);
    const activeBookings = useSelector(state => state.bookinglistdata.active);
    const addressdata = useSelector(state => state.addressdata);
    const [datePickerOpen, setDatePickerOpen] = useState(false)
    const latitudeDelta = 0.01;
    const longitudeDelta = 0.01;

    // Inicialize o estado local com o fallback
    const [allCarTypes, setAllCarTypes] = useState(fallbackCarTypes);

    const cartypesRedux = useSelector(state => state.cartypes);
    console.log('allCarTypes:', allCarTypes);
    console.log('cartypesRedux:', cartypesRedux);

    const filteredCarTypes = allCarTypes ? allCarTypes.filter(car => car.name === 'Leaf Plus' || car.name === 'Leaf Elite') : [];
    console.log('filteredCarTypes:', filteredCarTypes);

    const [freeCars, setFreeCars] = useState([]);
    const [pickerConfig, setPickerConfig] = useState({
        selectedDateTime: new Date(),
        dateModalOpen: false,
        dateMode: 'date'
    });
    const [region, setRegion] = useState(null);
    const [optionModalStatus, setOptionModalStatus] = useState(false);
    const [bookingDate, setBookingDate] = useState(null);
    const [bookingModalStatus, setBookingModalStatus] = useState(false);
    const [bookLoading, setBookLoading] = useState(false);
    const [bookLaterLoading, setBookLaterLoading] = useState(false);
    const [initDate, setInitDate] = useState(new Date());

    const instructionInitData = {
        otherPerson: "",
        otherPersonPhone: "",
        pickUpInstructions: "",
        deliveryInstructions: "",
        parcelTypeIndex: 0,
        optionIndex: 0,
        parcelTypeSelected: null,
        optionSelected: null
    };
    const [instructionData, setInstructionData] = useState(instructionInitData);
    const bookingdata = useSelector(state => state.bookingdata);
    const [locationRejected, setLocationRejected] = useState(false);
    const mapRef = useRef();
    const [dragging, setDragging] = useState(0);

    const animation = useRef(new Animated.Value(4)).current;
    const [isEditing, setIsEditing] = useState(false);
    const [touchY, setTouchY] = useState();

    const [bookingType, setBookingType] = useState(false);
    const intVal = useRef();

    const [profile, setProfile] = useState();
    const [checkType, setCheckType] = useState(false);
    const pageActive = useRef();
    const [drivers, setDrivers] = useState();
    const [roundTrip, setRoundTrip] = useState(false);
    const [tripInstructions, setTripInstructions] = useState('');
    const [payment_mode, setPaymentMode] = useState(0);
    const [radioProps, setRadioProps] = useState([]);
    const [checkTerm, setCheckTerm] = useState(false);
    const [bookModelLoading, setBookModelLoading] = useState(false);
    const [term, setTerm] = useState(false);
    const [deliveryWithBid, setDeliveryWithBid] = useState(false);
    const [otherPerson, setOtherPerson] = useState(false)
    const [offerFare, setOfferFare] = useState(0);
    const [minimumPrice, setMinimumPrice] = useState(0);

    const [profileData, setProfileData] = useState({
        firstName: auth && auth.profile && auth.profile.firstName ? auth.profile.firstName : "",
        lastName:  auth && auth.profile && auth.profile.lastName ? auth.profile.lastName : "",
        email: auth && auth.profile && auth.profile.email ? auth.profile.email : "",
    });
    const[bookingOnWait,setBookingOnWait] = useState();

    const addresses = useSelector(state => state.locationdata.addresses);
    
    const [searchModalVisible, setSearchModalVisible] = useState(false);
    const [currentSelection, setCurrentSelection] = useState(null);
    const [searchText, setSearchText] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [modalVisible, setModalVisible] = useState(false);
    const [selectedType, setSelectedType] = useState(null);
    const [addressHistory, setAddressHistory] = useState([]);
    const [isDropdownVisible, setIsDropdownVisible] = useState(false);
    const [activeField, setActiveField] = useState(null);

    const [UUID, setUUID] = useState();

    const [isShowingResults, setIsShowingResults] = useState(false);
    const [settings, setSettings] = useState({});

    // Novo estado para seleção de categoria
    const [selectedCarType, setSelectedCarType] = useState('Leaf Plus');

    const [carEstimates, setCarEstimates] = useState({});

    const [routePolyline, setRoutePolyline] = useState([]);

    const [showCarOptions, setShowCarOptions] = useState(false);

    // Adicionar estados para controlar o carregamento real do mapa
    const [mapReady, setMapReady] = useState(false);
    const [mapLayout, setMapLayout] = useState(false);

    const [isDarkMode, setIsDarkMode] = useState(true);
    const theme = isDarkMode ? darkTheme : lightTheme;

    // Estilos do switch customizado
    const switchStyles = StyleSheet.create({
        track: (value) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: value ? '#111' : '#111',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 4,
            position: 'relative',
        }),
        icon: {
            zIndex: 1,
        },
        thumb: (value) => ({
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: '#fff',
            position: 'absolute',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
        }),
    });

    const styles = StyleSheet.create({
        container: {
            flex: 1,
            width: '100%',
            margin: 0,
            padding: 0,
            backgroundColor: 'transparent',
        },
        header: {
            position: 'absolute',
            top: (Platform.OS === 'ios' ? 50 : 30) + 30,
            left: 0,
            right: 0,
            flexDirection: 'row',
            justifyContent: 'space-between',
            padding: 20,
            paddingTop: 0,
            zIndex: 1000,
        },
        headerButton: {
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.card,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: colors.BLACK,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
        },
        headerRightContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
        },
        addressContainer: {
            position: 'absolute',
            top: (Platform.OS === 'ios' ? 90 : 60) + 52,
            left: 0,
            right: 0,
            zIndex: 1000,
            alignItems: 'center',
        },
        addressCardGroup: {
            backgroundColor: theme.card,
            borderRadius: 18,
            width: '92%',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.18,
            shadowRadius: 10,
            elevation: 6,
            overflow: 'hidden',
        },
        addressCardRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 14,
            paddingHorizontal: 18,
        },
        addressDivider: {
            height: 1,
            backgroundColor: theme.divider,
            marginLeft: 18,
            marginRight: 18,
        },
        addressIcon: {
            marginRight: 14,
            opacity: 1,
        },
        addressText: {
            flex: 1,
            fontFamily: fonts.Bold,
            fontSize: 17,
            color: theme.text,
            letterSpacing: 0.1,
            fontWeight: '600',
        },
        addressPlaceholder: {
            color: theme.placeholder,
            fontFamily: fonts.Regular,
            fontSize: 16,
        },
        mapcontainer: {
            flex: 1,
            width: '100%',
            height: '100%',
            margin: 0,
            padding: 0,
            left: 0,
            right: 0,
            position: 'relative',
            backgroundColor: 'transparent',
        },
        mapViewStyle: {
            flex: 1,
            width: '100%',
            height: '100%',
            margin: 0,
            padding: 0,
            left: 0,
            right: 0,
            position: 'absolute',
            backgroundColor: 'transparent',
        },
        mapFloatingPinView: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'none'
        },
        locationButtonView: {
            position: 'absolute',
            right: 24,
            bottom: 340,
            zIndex: 1001,
        },
        locateButtonStyle: {
            backgroundColor: theme.icon,
            borderRadius: 24,
            width: 48,
            height: 48,
            justifyContent: 'center',
            alignItems: 'center',
            shadowColor: theme.icon,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.7,
            shadowRadius: 8,
            elevation: 12,
        },
        carOptionsContainer: {
            position: 'absolute',
            bottom: 93,
            left: 0,
            right: 0,
            paddingHorizontal: 16,
            zIndex: 1000,
        },
        carOptionsMainCard: {
            backgroundColor: theme.card,
            borderRadius: 16,
            padding: 12,
            shadowColor: '#000',
            shadowOffset: {
                width: 0,
                height: 2,
            },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
        },
        carCard: {
            backgroundColor: theme.card,
            borderRadius: 12,
            padding: 12,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: theme.divider,
        },
        selectedCarCard: {
            borderColor: theme.leafGreen,
            backgroundColor: theme.card,
        },
        carImage: {
            width: 54,
            height: 38,
            resizeMode: 'contain',
            marginRight: 18,
            borderRadius: 10,
            backgroundColor: theme.background,
        },
        carInfo: {
            width: '100%',
        },
        carNameValue: {
            color: theme.text,
            fontSize: 16,
            fontWeight: '600',
            flex: 1,
        },
        priceNameValue: {
            color: theme.text,
            fontSize: 16,
            fontWeight: '600',
            marginLeft: 8,
        },
        carDetailsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 4,
        },
        carSubInfo: {
            color: theme.textSecondary,
            fontSize: 14,
        },
        bookButtonContainer: {
            position: 'absolute',
            bottom: 5,
            left: 0,
            right: 0,
            paddingHorizontal: 20,
            zIndex: 2000,
        },
        bookButton: {
            backgroundColor: theme.leafGreen,
            borderRadius: 12,
            padding: 16,
            alignItems: 'center',
            shadowColor: '#000',
            shadowOffset: {
                width: 0,
                height: 2,
            },
            shadowOpacity: 0.25,
            shadowRadius: 3.84,
            elevation: 5,
        },
        bookButtonDisabled: {
            backgroundColor: '#666',
            opacity: 0.7,
        },
        bookButtonText: {
            color: '#fff',
            fontSize: 18,
            fontWeight: '600',
            fontFamily: fonts.Bold,
        },
        bookButtonSubtext: {
            color: '#fff',
            fontSize: 14,
            marginTop: 4,
            opacity: 0.9,
            fontFamily: fonts.Regular,
        },
        dropdownContainerModern: {
            position: 'absolute',
            top: Platform.OS === 'ios' ? 180 : 150,
            left: 20,
            right: 20,
            zIndex: 1000,
        },
        dropdownContentModern: {
            backgroundColor: theme.dropdown,
            borderRadius: 18,
            padding: 14,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 8,
            maxHeight: 400,
        },
        searchContainerModern: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.inputBg,
            borderRadius: 12,
            borderWidth: 1.2,
            borderColor: theme.inputBorder,
            paddingHorizontal: 12,
            marginBottom: 18,
        },
        searchIconModern: {
            marginRight: 10,
        },
        searchInputModern: {
            flex: 1,
            height: 48,
            fontFamily: fonts.Regular,
            fontSize: 16,
            color: theme.text,
        },
        historyContainerModern: {
            marginBottom: 10,
        },
        historyTitleModern: {
            fontSize: 15,
            fontFamily: fonts.Bold,
            color: theme.text,
            marginBottom: 8,
            marginLeft: 2,
        },
        historyItemModern: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 13,
            borderBottomWidth: 1,
            borderBottomColor: theme.divider,
        },
        historyIconModern: {
            borderBottomColor: colors.GRAY_LIGHT,
        },
        historyIcon: {
            marginRight: 10,
        },
        historyText: {
            flex: 1,
            fontFamily: fonts.Regular,
            fontSize: 14,
            color: theme.text,
        },
        resultsContainer: {
            maxHeight: 300,
        },
        resultItem: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 15,
            borderBottomWidth: 1,
            borderBottomColor: colors.GRAY_LIGHT,
        },
        resultIcon: {
            marginRight: 10,
        },
        resultText: {
            flex: 1,
            fontFamily: fonts.Regular,
            fontSize: 14,
            color: theme.text,
        },
        loading: {
            marginTop: 20,
        },
        themeSwitchTouchable: {
            width: 72,
            height: 40,
            borderRadius: 20,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 0,
            marginRight: 0,
        },
        themeSwitchTrack: {
            width: 72,
            height: 40,
            borderRadius: 20,
            borderWidth: 1.5,
            flexDirection: 'row',
            alignItems: 'center',
            position: 'relative',
            justifyContent: 'space-between',
            paddingHorizontal: 6,
            backgroundColor: theme.card,
            borderColor: theme.divider,
        },
        themeSwitchIconBubble: {
            width: 28,
            height: 28,
            borderRadius: 14,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: theme.icon,
        },
        themeSwitchIconLeft: {
            position: 'absolute',
            left: 14,
            zIndex: 3,
        },
        themeSwitchIconRight: {
            position: 'absolute',
            right: 14,
            zIndex: 3,
        },
        historyTextModern: {
            flex: 1,
            fontFamily: fonts.Regular,
            fontSize: 14,
            color: theme.text,
        },
        resultTextModern: {
            flex: 1,
            fontFamily: fonts.Regular,
            fontSize: 14,
            color: theme.text,
        },
    });

    // Switch customizado
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
                    {/* Espaço entre */}
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

    const adjustMapZoom = () => {
        if (tripdata.pickup && tripdata.drop && mapRef.current) {
            const points = [
                { latitude: tripdata.pickup.lat, longitude: tripdata.pickup.lng },
                { latitude: tripdata.drop.lat, longitude: tripdata.drop.lng }
            ];
            
            mapRef.current.fitToCoordinates(points, {
                edgePadding: { top: 100, right: 50, bottom: 100, left: 50 },
                animated: true
            });
        }
    };

    // Atualizar estimativas para ambos os tipos ao selecionar pickup e drop
    useEffect(() => {
        const fetchEstimates = async () => {
            if (tripdata.pickup && tripdata.drop) {
                let estimates = {};
                let firstPolyline = null;
                for (const car of filteredCarTypes) {
                    const tripdataForCar = {
                        pickup: tripdata.pickup,
                        drop: tripdata.drop,
                        carType: { ...car }
                    };
                    const estimateObj = await prepareEstimateObject(tripdataForCar, instructionData);
                    if (!estimateObj.error && estimateObj.estimateObject && estimateObj.estimateObject.carDetails) {
                        estimates[car.name] = {
                            ...estimateObj.estimateObject,
                            estimateFare: estimateObj.estimateObject.routeDetails && estimateObj.estimateObject.routeDetails.fare ? estimateObj.estimateObject.routeDetails.fare : null,
                            estimateTime: estimateObj.estimateObject.routeDetails && estimateObj.estimateObject.routeDetails.time_in_secs ? estimateObj.estimateObject.routeDetails.time_in_secs : null
                        };
                        // Pega a primeira polyline válida
                        if (!firstPolyline && estimateObj.estimateObject.routeDetails && estimateObj.estimateObject.routeDetails.polylinePoints) {
                            const points = DecodePolyLine.decode(estimateObj.estimateObject.routeDetails.polylinePoints);
                            const coordsArr = points.map(point => ({ latitude: point[0], longitude: point[1] }));
                            firstPolyline = coordsArr;
                        }
                    } else {
                        estimates[car.name] = null;
                    }
                }
                setCarEstimates(estimates);
                if (firstPolyline) {
                    setRoutePolyline(firstPolyline);
                    console.log('Polyline gerada:', firstPolyline);
                } else {
                    setRoutePolyline([]);
                    console.log('Polyline vazia!');
                }
            }
        };
        fetchEstimates();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tripdata.pickup, tripdata.drop, allCarTypes]);

    console.log('filteredCarTypes:', filteredCarTypes);
    console.log('carEstimates:', carEstimates);

    // Exibir o card apenas se houver pelo menos uma estimativa válida
    const hasValidEstimate = filteredCarTypes.some(car => carEstimates[car.name]);

    const getEstimateForCar = (car) => {
        const estimate = carEstimates[car.name];
        if (estimate && estimate.routeDetails) {
            const distance = Number(estimate.routeDetails.distance_in_km);
            const time = Number(estimate.routeDetails.time_in_secs);
            const decimal = settings?.decimal || 2;
            const currency = settings?.currency || 'R$';
            // Polyline string da rota
            const polylineString = estimate.routeDetails.polylinePoints;
            // Calcula o valor do pedágio para a rota
            const { valorTotal } = calcularPedagiosPorPolyline(polylineString, tollData, 1); // tolerância 1km
            const valorPedagio = parseFloat(valorTotal) || 0;
            console.log('Valor total de pedágio passado ao FareCalculator:', valorPedagio);
            // Chama o FareCalculator passando o valor do pedágio
            const fareObj = FareCalculator(
                distance,
                time,
                car,
                instructionData,
                decimal,
                routePolyline,
                'car',
                valorPedagio
            );
            console.log('Valor do pedágio recebido no FareCalculator:', fareObj.tollFee);
            console.log('Valor total exibido no card (grandTotal):', fareObj.grandTotal);
            const formattedPrice = `${currency} ${fareObj.grandTotal.toFixed(decimal)}`;
            // Calcular hora estimada de chegada
            const now = new Date();
            const arrivalTime = new Date(now.getTime() + (time * 1000));
            const formattedTime = arrivalTime.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false 
            });
            return {
                fare: formattedPrice,
                time: formattedTime,
                tollFee: valorPedagio > 0 ? `${currency} ${valorPedagio.toFixed(decimal)}` : null
            };
        }
        return {
            fare: '--',
            time: '--',
            tollFee: null
        };
    };

    useEffect(() => {
        const uuidv4 = uuid.v4();
        setUUID(uuidv4);
        return () => {
            setUUID(null);
        };
    }, []);

    useEffect(() => {
        const loadInitialLocation = async () => {
            try {
                let { status } = await Location.requestForegroundPermissionsAsync();
                if (status !== 'granted') {
                    setLocationRejected(true);
                    return;
                }

                let location = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced
                });

                const initialRegion = {
                    latitude: location.coords.latitude,
                    longitude: location.coords.longitude,
                    latitudeDelta: 0.0922,
                    longitudeDelta: 0.0421
                };

                setRegion(initialRegion);
                pageActive.current = true;
                
                dispatch({
                    type: 'UPDATE_GPS_LOCATION',
                    payload: {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude
                    }
                });

                const latlng = `${location.coords.latitude},${location.coords.longitude}`;
                const address = await fetchAddressfromCoords(latlng);
                if (address) {
                    dispatch(
                        updateTripPickup({
                            lat: location.coords.latitude,
                            lng: location.coords.longitude,
                            add: address,
                            source: 'init'
                        })
                    );
                }
            } catch (error) {
                console.error('Error getting location:', error);
                setLocationRejected(true);
            }
        };

        loadInitialLocation();
        return () => {
            pageActive.current = false;
        };
    }, []);
    
    useEffect(() => {
        if (auth.profile) {
            setTimeout(()=>{
                setTerm(true)
            },2000);
            setCheckTerm(auth.profile.term ? true : false)
            if(bookingOnWait){
                finaliseBooking(bookingOnWait);
                setBookingOnWait(null);
                setBookModelLoading(false);
            }
        }
    }, [auth.profile,bookingOnWait])

    const isTermRequired = settings && settings.term_required === true;
    const isProfileApproved = auth && auth.profile && auth.profile.usertype === 'driver' ? auth.profile.approved === true : true;

    useEffect(() => {
        if (settingsdata) {
            setSettings(settingsdata);
        }
    }, [settingsdata]);
    
    useEffect(() => {
        if (usersdata.drivers) {
            const freeDrivers = usersdata.drivers.filter(d => !d.queue)
          let arr = [];
          for (let i = 0; i < freeDrivers.length; i++) {
            let driver = freeDrivers[i];
            if (!driver.carType) {
              let carTypes = allCarTypes;
              for (let i = 0; i < carTypes.length; i++) {
                let temp = { ...driver, carType: carTypes[i].name };
                arr.push(temp);
              }
            } else {
              arr.push(driver);
            }
          }
          setDrivers(arr);
        }
      }, [usersdata.drivers]);

    useEffect(() => {
        if (auth.profile && auth.profile.uid) {
            setProfile(auth.profile);
        } else {
            setProfile(null);
        }
    }, [auth.profile]);

    useEffect(() => {
        if (tripdata.drop && tripdata.drop.add) {
            setIsEditing(true);
        }
    }, [tripdata]);

    useEffect(() => easing => {
        Animated.timing(animation, {
            toValue: !isEditing ? 4 : 0,
            duration: 300,
            useNativeDriver: false,
            easing
        }).start();
    }, [isEditing]);

    useEffect(() => {
        if (cars) {
            resetCars();
        }
    }, [cars]);

    useEffect(() => {
        if (tripdata.pickup && drivers) {
            getDrivers();
        }
        if (tripdata.pickup && !drivers) {
            resetCars();
            setFreeCars([]);
        }
    }, [drivers, tripdata.pickup]);

    useEffect(() => {
        if (estimatedata.estimate) {
            if (!bookingdata.loading) {
                setBookingModalStatus(true);
            }
            setBookLoading(false);
            setBookLaterLoading(false);
        }
        if (estimatedata.estimate && settings && !settings.coustomerBidPrice) {
            let  price = estimatedata.estimate.estimateFare;
            let ammount =  settings.coustomerBidPriceType === 'flat' ? parseFloat(price- settings.bidprice).toFixed(settings.decimal) : parseFloat(price - parseFloat(price*(settings.bidprice/100))).toFixed(settings.decimal);
            if(ammount && ammount > 0){setMinimumPrice(ammount)}
        }
        if (estimatedata.error && estimatedata.error.flag) {
            setBookLoading(false);
            setBookLaterLoading(false);
            Alert.alert(estimatedata.error.msg);
            dispatch(clearEstimate());
        }
    }, [estimatedata.estimate, estimatedata.error, estimatedata.error.flag]);

    useEffect(() => {
        if (tripdata.selected && tripdata.selected == 'pickup' && tripdata.pickup && tripdata.pickup.source == 'search' && mapRef.current) {
            // Removido ajuste de zoom antigo para pickup
        }
        if (tripdata.selected && tripdata.selected == 'drop' && tripdata.drop && tripdata.drop.source == 'search' && mapRef.current) {
            // Removido ajuste de zoom antigo para drop
        }
    }, [tripdata.selected, tripdata.pickup, tripdata.drop]);

    useEffect(() => {
        if (bookingdata.booking) {
            const bookingStatus = bookingdata.booking.mainData.status;
            if (bookingStatus == 'PAYMENT_PENDING') {
                setTimeout(() => {
                    props.navigation.dispatch(
                        CommonActions.reset({
                            index: 0,
                            routes: [
                                {
                                    name: 'PaymentDetails',
                                    params: { booking: bookingdata.booking.mainData },
                                },
                            ],
                        })
                    );
                    dispatch(clearEstimate());
                    dispatch(clearBooking());
                    dispatch(clearTripPoints());
                }, 1000);
            } else {
                setTimeout(() => {
                    props.navigation.dispatch(
                        CommonActions.reset({
                            index: 0,
                            routes: [
                                {
                                    name: 'BookedCab',
                                    params: { bookingId: bookingdata.booking.booking_id },
                                },
                            ],
                        })
                    );
                    dispatch(clearEstimate());
                    dispatch(clearBooking());
                    dispatch(clearTripPoints());
                }, 1000);
            }
        }
        if (bookingdata.error && bookingdata.error.flag) {
            Alert.alert(bookingdata.error.msg);
            dispatch(clearBooking());
        }
        if (bookingdata.loading) {
            setBookLoading(true);
            setBookLaterLoading(true);
        }
    }, [bookingdata.booking, bookingdata.loading, bookingdata.error, bookingdata.error.flag]);

    useEffect(() => {
        if (gps.location && gps.location.lat && gps.location.lng && mapRef.current) {
            // Primeiro centraliza com o delta antigo (mais aberto)
            mapRef.current.animateToRegion({
                latitude: gps.location.lat,
                longitude: gps.location.lng,
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421
            });
            // Depois de um pequeno delay, faz o zoom in suave
            setTimeout(() => {
                mapRef.current.animateToRegion({
                    latitude: gps.location.lat,
                    longitude: gps.location.lng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01
                });
            }, 400);
            updateAddresses({
                latitude: gps.location.lat,
                longitude: gps.location.lng
            }, region ? 'gps' : 'init');
        }
    }, [gps.location]);


    useEffect(() => {
        if (region && mapRef.current) {
            if (Platform.OS == 'ios') {
                mapRef.current.animateToRegion({
                    latitude: region.latitude,
                    longitude: region.longitude,
                    latitudeDelta: latitudeDelta,
                    longitudeDelta: longitudeDelta
                });
            }
        }
    }, [region, mapRef.current]);

    useEffect(() => {
        if (tripdata.pickup && tripdata.drop && tripdata.drop.add) {
            adjustMapZoom();
            // Animar o card para cima
            Animated.timing(animation, {
                toValue: 1,
                duration: 300,
                useNativeDriver: false
            }).start();
            
            // Carregar categorias de carros e preços
            handleGetEstimate();
            getDrivers();
        } else {
            // Animar o card para baixo
            Animated.timing(animation, {
                toValue: 0,
                duration: 300,
                useNativeDriver: false
            }).start();
        }
    }, [tripdata.pickup, tripdata.drop]);

    const resetCars = () => {
        if (cars) {
            let carWiseArr = [];
            const sorted = cars.sort((a, b) => a.pos - b.pos);
            for (let i = 0; i < sorted.length; i++) {
                let temp = { ...sorted[i], minTime: '', available: false, active: false };
                carWiseArr.push(temp);
            }
            setAllCarTypes(carWiseArr);
        }
    }

    const resetActiveCar = () => {
        let carWiseArr = [];
        const sorted = allCarTypes.sort((a, b) => a.pos - b.pos);
        for (let i = 0; i < sorted.length; i++) {
            let temp = { ...sorted[i], active: false };
            carWiseArr.push(temp);
        }
        setAllCarTypes(carWiseArr);
    }

    const locateUser = async () => {
        if (tripdata.selected == 'pickup') {
            let tempWatcher = await Location.watchPositionAsync({
                accuracy: Location.Accuracy.Balanced
            }, location => {
                dispatch({
                    type: 'UPDATE_GPS_LOCATION',
                    payload: {
                        lat: location.coords.latitude,
                        lng: location.coords.longitude
                    }
                });
                tempWatcher.remove();
            })
        }
    }


  const setAddresses = async (pos, res, source) => {
    if (res) {
      if (tripdata.selected == "pickup") {
        dispatch(
          updateTripPickup({
            lat: pos.latitude,
            lng: pos.longitude,
            add: res,
            source: source,
          })
        );
        if (source == "init") {
          dispatch(
            updateTripDrop({
              lat: pos.latitude,
              lng: pos.longitude,
              add: null,
              source: source,
            })
          );
        }
      } else {
        dispatch(
          updateTripDrop({
            lat: pos.latitude,
            lng: pos.longitude,
            add: res,
            source: source,
          })
        );
      }
    }
  };

  const updateAddresses = async (pos, source) => {
    let latlng = pos.latitude + "," + pos.longitude;
    if (!pos.latitude) return;
    let res='';
    let  found = false;
    let savedAddresses = [];

    try {
      const value = addresses;
      if (value !== null) {
        savedAddresses = JSON.parse(value);
        for(let i =0; i<savedAddresses.length; i++){
          let distance = GetDistance(pos.latitude, pos.longitude, savedAddresses[i].lat, savedAddresses[i].lng);
          if(distance<0.25){
            res=savedAddresses[i].description;
            found = true;
            break;
          }
        }
      }
    } catch (error) {
      found = false;
    }

    if(found){
      setAddresses(pos, res, source);
    } else{
      fetchAddressfromCoords(latlng).then((add) => {  
        if (add) {
          savedAddresses.push({
            lat: pos.latitude,
            lng: pos.longitude,
            description: add
          });
          storeAddresses(savedAddresses);
          setAddresses(pos, add, source);
        }
      });
    }
  };

    const onRegionChangeComplete = (newregion, gesture) => {
        if((tripdata.pickup && tripdata.pickup.source =='mapSelect') || (tripdata.drop && tripdata.drop.source =='mapSelect')){
            if (gesture && gesture.isGesture) {
                updateAddresses({
                    latitude: newregion.latitude,
                    longitude: newregion.longitude
                }, 'mapSelect');
            }
        }
    }

    const selectCarType = (value, key) => {
        let carTypes = allCarTypes;
        for (let i = 0; i < carTypes.length; i++) {
            carTypes[i].active = false;
            if (carTypes[i].name == value.name) {
                carTypes[i].active = true;
                let instObj = { ...instructionData };
                if (Array.isArray(carTypes[i].parcelTypes)) {
                    instObj.parcelTypeSelected = carTypes[i].parcelTypes[0];
                    instObj.parcelTypeIndex = 0;
                }
                if (Array.isArray(carTypes[i].options)) {
                    instObj.optionSelected = carTypes[i].options[0];
                    instObj.optionIndex = 0;
                }
                setInstructionData(instObj);
            } else {
                carTypes[i].active = false;
            }
        }
        dispatch(updateTripCar(value));
    }

    const getDrivers = async () => {
        if (tripdata.pickup) {
            let availableDrivers = [];
            let arr = {};
            let startLoc = tripdata.pickup.lat + ',' + tripdata.pickup.lng;

            let distArr = [];
            let allDrivers = [];
            for (let i = 0; i < drivers.length; i++) {
                let driver = { ...drivers[i] };
                let distance = GetDistance(tripdata.pickup.lat, tripdata.pickup.lng, driver.location.lat, driver.location.lng);
                if (settings.convert_to_mile) {
                    distance = distance / 1.609344;
                }
                if (distance < ((settings && settings.driverRadius) ? settings.driverRadius : 10)) {
                    driver["distance"] = distance;
                    allDrivers.push(driver);
                }
            }

            const sortedDrivers = settings.useDistanceMatrix ? allDrivers.slice(0, 25) : allDrivers;

            if (sortedDrivers.length > 0) {
                let driverDest = "";
                for (let i = 0; i < sortedDrivers.length; i++) {
                    let driver = { ...sortedDrivers[i] };
                    driverDest = driverDest + driver.location.lat + "," + driver.location.lng
                    if (i < (sortedDrivers.length - 1)) {
                        driverDest = driverDest + '|';
                    }
                }

                if (settings.useDistanceMatrix) {
                    distArr = await getDistanceMatrix(startLoc, driverDest);
                } else {
                    for (let i = 0; i < sortedDrivers.length; i++) {
                        distArr.push({ timein_text: ((sortedDrivers[i].distance * 2) + 1).toFixed(0) + ' min', found: true })
                    }
                }


                for (let i = 0; i < sortedDrivers.length; i++) {
                    let driver = { ...sortedDrivers[i] };
                    if (distArr[i].found && cars) {
                        driver.arriveTime = distArr[i];
                        for (let i = 0; i < cars.length; i++) {
                            if (cars[i].name == driver.carType) {
                                driver.carImage = cars[i].image;
                            }
                        }
                        let carType = driver.carType;
                        if(carType && carType.length>0){
                            if (arr[carType] && arr[carType].sortedDrivers) {
                                arr[carType].sortedDrivers.push(driver);
                                if (arr[carType].minDistance > driver.distance) {
                                    arr[carType].minDistance = driver.distance;
                                    arr[carType].minTime = driver.arriveTime.timein_text;
                                }
                            } else {
                                arr[carType] = {};
                                arr[carType].sortedDrivers = [];
                                arr[carType].sortedDrivers.push(driver);
                                arr[carType].minDistance = driver.distance;
                                arr[carType].minTime = driver.arriveTime.timein_text;
                            }
                        } else{
                            let carTypes = allCarTypes;
                            for(let i=0;i<carTypes.length; i++){
                                let carType =carTypes[i];
                                if (arr[carType]  ) {
                                    arr[carType].sortedDrivers.push(driver);
                                    if (arr[carType].minDistance > driver.distance) {
                                        arr[carType].minDistance = driver.distance;
                                        arr[carType].minTime = driver.arriveTime.timein_text;
                                    }
                                } else {
                                    arr[carType] = {};
                                    arr[carType].sortedDrivers = [];
                                    arr[carType].sortedDrivers.push(driver);
                                    arr[carType].minDistance = driver.distance;
                                    arr[carType].minTime = driver.arriveTime.timein_text;
                                }
                            }
                        }
                        availableDrivers.push(driver);
                    }
                }
            }

            let carWiseArr = [];
            if (cars) {
                for (let i = 0; i < cars.length; i++) {
                    let temp = { ...cars[i] };
                    if (arr[cars[i].name]) {
                        temp['nearbyData'] = arr[cars[i].name].drivers;
                        temp['minTime'] = arr[cars[i].name].minTime;
                        temp['available'] = true;
                    } else {
                        temp['minTime'] = '';
                        temp['available'] = false;
                    }
                    temp['active'] = (tripdata.carType && (tripdata.carType.name == cars[i].name)) ? true : false;
                    carWiseArr.push(temp);
                }
            }

            setFreeCars(availableDrivers);
            setAllCarTypes(carWiseArr);
        }
    }
    
    const tapAddress = (selection) => {
        setSearchModalVisible(true);
        setCurrentSelection(selection);
        setSearchResults([]);
        setSearchText('');
    };

    const onPressBook = async () => {
        if (parseFloat(profile.walletBalance) >= 0) {
            setCheckType(true);
            setBookLoading(true);
            if (!(profile.mobile && profile.mobile.length > 6)) {
                Alert.alert(t('alert'), t('mobile_need_update'));
                props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Profile', params: { fromPage: 'Map'} }] }));
                setBookLoading(false);
            } else {
                if ((settings && settings.imageIdApproval && auth.profile.verifyId && auth.profile.verifyIdImage) || (settings && !settings.imageIdApproval)) {
                 if(auth.profile.approved){
                    if (tripdata.pickup && tripdata.drop && tripdata.drop.add) {
                        if (!tripdata.carType) {
                            setBookLoading(false);
                            Alert.alert(t('alert'), t('car_type_blank_error'))
                        } else {
                            let driver_available = false;
                            for (let i = 0; i < allCarTypes.length; i++) {
                                let car = allCarTypes[i];
                                if (car.name == tripdata.carType.name && car.minTime) {
                                    driver_available = true;
                                    break;
                                }
                            }
                            if (driver_available) {
                                setBookingDate(null);
                                setBookingType(false);
                                if (appConsts.hasOptions  &&
                                    (tripdata?.carType?.options?.length > 0 || tripdata?.carType?.parcelTypes?.length > 0)) {
                                    setOptionModalStatus(true);
                                    setBookLaterLoading(false);
                                } else {
                                    let result = await prepareEstimateObject(tripdata, instructionData);
                                    if (result.error) {
                                        setBookLoading(false);
                                        Alert.alert(t('alert'), result.msg);
                                    } else {
                                        dispatch(getEstimate((await result).estimateObject));
                                    }
                                }
                            } else {
                                Alert.alert(t('alert'), t('no_driver_found_alert_messege'));
                                setBookLoading(false);
                            }
                        }
                    } else {
                        Alert.alert(t('alert'), t('drop_location_blank_error'));
                        setBookLoading(false);
                    }
                 }else{
                    Alert.alert(t('alert'), t('admin_contact'));
                    setBookLoading(false);
                 }
                } else {
                    Alert.alert(
                        t('alert'),
                        t('verifyid_error'),
                        [
                            { text: t('cancel'), onPress: () => { setBookLoading(true) }, style: 'cancel' },
                            { text: t('ok'), onPress: () =>   
                                props.navigation.dispatch(CommonActions.reset({index: 0, routes:[{ name: 'editUser', params: { fromPage: 'Map'} }]})) 
                            }
                        ],
                        { cancelable: false }
                    );
                }
            }
        } else {
            Alert.alert(
                t('alert'),
                t('wallet_balance_low')
            );
        }
    }


    const onPressBookLater = () => {
        setCheckType(false);
        if (parseFloat(profile.walletBalance) >= 0) {
            if (!(profile.mobile && profile.mobile.length > 6)) {
                Alert.alert(t('alert'), t('mobile_need_update'));
                props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Profile', params: { fromPage: 'Map'} }] }));
            } else {
                if ((settings && settings.imageIdApproval && auth.profile.verifyId && auth.profile.verifyIdImage) || (settings && !settings.imageIdApproval)) {
                  if(auth.profile.approved){
                    if (tripdata.pickup && tripdata.drop && tripdata.drop.add) {
                        if (tripdata.carType) {
                            setInitDate(new Date());
                            setDatePickerOpen(true);
                        } else {
                            Alert.alert(t('alert'), t('car_type_blank_error'))
                        }
                    } else {
                        Alert.alert(t('alert'), t('drop_location_blank_error'))
                    }
                  }else{
                    Alert.alert(t('alert'), t('admin_contact'))
                  }
                } else {
                    Alert.alert(
                        t('alert'),
                        t('verifyid_error'),
                        [
                            { text: t('cancel'), onPress: () => { }, style: 'cancel' },
                            { text: t('ok'), onPress: () =>   
                                props.navigation.dispatch(CommonActions.reset({index: 0, routes:[{ name: 'editUser', params: { fromPage: 'Map'} }]})) 
                            }
                        ],
                        { cancelable: false }
                    );
                }
            }
        } else {
            Alert.alert(
                t('alert'),
                t('wallet_balance_low')
            );
        }
    }

    const hideDatePicker = () => {
        setDatePickerOpen(false);
      };

      const handleDateConfirm = (date) => {
        setInitDate(date);
        setDatePickerOpen(false);
            setBookLaterLoading(true);
            setTimeout(async () => {
                let date1;
                try{
                    let res =  await fetch(`https://${config.projectId}.web.app/getservertime`, { method: 'GET', headers: {'Content-Type': 'application/json'}});
                    const json = await res.json();
                    if(json.time){
                        date1 = json.time;
                    } else{
                        date1 = new Date().getTime();
                    }
                }catch (err){
                    date1 = new Date().getTime();
                }
                
                const date2 = new Date(date);
                const diffTime = date2 - date1;
                const diffMins =  diffTime / (1000 * 60);

                if (diffMins < 15) {
                    setBookLaterLoading(false);
                    Alert.alert(
                        t('alert'),
                        t('past_booking_error'),
                        [
                            { text: t('ok'), onPress: () => { } }
                        ],
                        { cancelable: true }
                    );
                } else {
                    setBookingDate(date);
                    setBookingType(true);
                    if (appConsts.hasOptions) {
                        setOptionModalStatus(true);
                        setBookLaterLoading(false);
                    } else {
                        let result = await prepareEstimateObject(tripdata, instructionData);
                        if (result.error) {
                            setBookLoading(false);
                            Alert.alert(t('alert'), result.msg);
                        } else {
                            dispatch(getEstimate((await result).estimateObject));
                        }
                    }
                }
            }, 1000);
        
    };


    const handleGetEstimate = async () => {
        if (checkType) {
            setBookLoading(true);
        } else {
            setBookLaterLoading(true);
        }
        setOptionModalStatus(false);
        let result = await prepareEstimateObject(tripdata, instructionData);
        if (result.error) {
            setBookLoading(false);
            Alert.alert(t('alert'), result.msg);
            return false;
        } else {
            await dispatch(getEstimate(result.estimateObject));
            return true;
        }
    }

    const handleParcelTypeSelection = (value) => {
        setInstructionData({
            ...instructionData,
            parcelTypeIndex: value,
            parcelTypeSelected: tripdata.carType.parcelTypes[value]
        });
    }

    const handleOptionSelection = (value) => {
        setInstructionData({
            ...instructionData,
            optionIndex: value,
            optionSelected: tripdata.carType.options[value]
        });
    }

    const onModalCancel = () => {
        setInstructionData(instructionInitData);
        setTripInstructions("");
        setOfferFare(0)
        setRoundTrip(false);
        dispatch(updateTripCar(null));
        setBookingModalStatus(false);
        setOptionModalStatus(false);
        resetActiveCar();
        setBookLoading(false);
        setBookLaterLoading(false);
        dispatch(clearEstimate());
        setBookModelLoading(false);
    }

    const finaliseBooking = (bookingData) => {
        dispatch(addBooking(bookingData));
        setInstructionData(instructionInitData);
        setBookingModalStatus(false);
        setOptionModalStatus(false);
        resetCars();
        setTripInstructions("");
        setOfferFare(0)
        setRoundTrip(false);
        resetCars();
    }

    const bookNow = async () => {
        setBookModelLoading(true);
        let wallet_balance = profile.walletBalance;
        let notfound = true;
        if (activeBookings) {
            for (let i = 0; i < activeBookings.length; i++) {
                if (activeBookings[i].payment_mode === 'wallet' && activeBookings[i].status !== 'PAID') {
                    notfound = false;
                    break;
                }
            }
        }
        const regx1 = /([0-9\s-]{7,})(?:\s*(?:#|x\.?|ext\.?|extension)\s*(\d+))?$/;
        if ((otherPerson && /\S/.test(instructionData.otherPerson) && regx1.test(instructionData.otherPersonPhone) && instructionData.otherPersonPhone && instructionData.otherPersonPhone.length > 6) || !otherPerson) {
            if((offerFare > 0 && offerFare >= parseFloat(minimumPrice)) || offerFare == 0){
                if ((radioProps[payment_mode].cat === 'wallet' && notfound) || radioProps[payment_mode].cat !== 'wallet') {
                    if ((radioProps[payment_mode].cat === 'wallet' && (parseFloat(wallet_balance) >= parseFloat(estimatedata.estimate.estimateFare)) && appConsts.checkWallet) || radioProps[payment_mode].cat !== 'wallet' || (radioProps[payment_mode].cat === 'wallet' && !appConsts.checkWallet)) {
                        const addBookingObj = {
                            pickup: estimatedata.estimate.pickup,
                            drop: estimatedata.estimate.drop,
                            carDetails: estimatedata.estimate.carDetails,
                            userDetails: auth.profile,
                            estimate: estimatedata.estimate,
                            tripdate: bookingType ? new Date(bookingDate).getTime() : new Date().getTime(),
                            bookLater: bookingType,
                            settings: settings,
                            booking_type_admin: false,
                            booking_type_fleetadmin:false,
                            deliveryWithBid: deliveryWithBid ? deliveryWithBid : false,
                            payment_mode: radioProps[payment_mode].cat,
                            customer_offer: offerFare
                        };
                        if(auth && auth.profile && auth.profile.firstName && auth.profile.firstName.length > 0 && auth.profile.lastName && auth.profile.lastName.length > 0 && auth.profile.email && auth.profile.email.length > 0){
                            const result = await validateBookingObj(t, addBookingObj, instructionData, settings, bookingType, roundTrip, tripInstructions, tripdata, drivers, otherPerson, offerFare);
                            if (result.error) {
                                Alert.alert(
                                    t('alert'),
                                    result.msg,
                                    [
                                        { text: t('ok'), onPress: () => {setBookModelLoading(false) } }
                                    ],
                                    { cancelable: true }
                                );
                            } else {
                                finaliseBooking(result.addBookingObj);
                            }
                        }else{
                            setBookModelLoading(true);
                            const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
                            if(/\S/.test( profileData.firstName) && /\S/.test(profileData.lastName) && auth){
                                const userData = {
                                    firstName: profileData.firstName,
                                    lastName: profileData.lastName
                                }
                                if(auth.profile.email){
                                    const result = await validateBookingObj(t, addBookingObj, instructionData, settings, bookingType, roundTrip, tripInstructions, tripdata, drivers, otherPerson, offerFare);
                                    let bookingData = result.addBookingObj;
                                    bookingData.userDetails.firstName = profileData.firstName;
                                    bookingData.userDetails.lastName = profileData.lastName;
                                    setBookingOnWait(bookingData);
                                    setTimeout(()=>{
                                        dispatch(updateProfile(userData));
                                    },200) 
                                } else{
                                    if(re.test(profileData.email)){
                                        checkUserExists({email: profileData.email}).then(async(res) => {
                                            if (res.users && res.users.length > 0) {
                                                Alert.alert(t('alert'), t('user_exists'));
                                                setBookModelLoading(false);
                                            } else if(res.error){
                                                Alert.alert(t('alert'), t('email_or_mobile_issue'));
                                                setBookModelLoading(false);
                                            } else{
                                                const result = await validateBookingObj(t, addBookingObj, instructionData, settings, bookingType, roundTrip, tripInstructions, tripdata, drivers, otherPerson, offerFare);
                                                if (result.error) {
                                                    Alert.alert(
                                                        t('alert'),
                                                        result.msg,
                                                        [
                                                            { text: t('ok'), onPress: () => {setBookModelLoading(false) } }
                                                        ],
                                                        { cancelable: true }
                                                    );
                                                } else {
                                                    profileData['uid'] = auth.profile.uid;
                                                    let bookingData = result.addBookingObj;
                                                    bookingData.userDetails.firstName = profileData.firstName;
                                                    bookingData.userDetails.lastName = profileData.lastName;
                                                    bookingData.userDetails.email = profileData.email;
                                                    setBookingOnWait(bookingData);
                                                    setTimeout(()=>{
                                                        dispatch(updateProfileWithEmail(profileData));
                                                    },200) 
                                                }
                                            }    
                                        });
                                    }else{
                                        Alert.alert(t('alert'), t('proper_email'));
                                        setBookModelLoading(false);
                                    }
                                }
                            }else{
                                Alert.alert(t('alert'), t('proper_input_name'));
                                setBookModelLoading(false);
                            }
                        }
                    } else {
                        Alert.alert(
                            t('alert'),
                            t('wallet_balance_low')
                        );
                        setBookModelLoading(false);
                    }
                } else {
                    Alert.alert(
                        t('alert'),
                        t('wallet_booking_alert')
                    );
                    setBookModelLoading(false);
                }
            } else {
                Alert.alert(
                    t('alert'),
                    t('offer_price_greter_minimum_price')
                );
                setBookModelLoading(false);
            }
        }else{
            Alert.alert(t('alert'), t('otherPersonDetailMissing'));
            setBookModelLoading(false);
        }
    };

    useEffect(() => {
        const unsubscribe = props.navigation.addListener('focus', () => {
            pageActive.current = true;
            dispatch(fetchDrivers('app'));
            if (intVal.current == 0) {
                intVal.current = setInterval(() => {
                    dispatch(fetchDrivers('app'));
                }, 30000);
            }
        });
        return unsubscribe;
    }, [props.navigation, intVal.current]);

    useEffect(() => {
        const unsubscribe = props.navigation.addListener('blur', () => {
            pageActive.current = false;
            intVal.current ? clearInterval(intVal.current) : null;
            intVal.current = 0;
        });
        return unsubscribe;
    }, [props.navigation, intVal.current]);

    useEffect(() => {
        pageActive.current = true;
        const interval = setInterval(() => {
            dispatch(fetchDrivers('app'));
        }, 30000);
        intVal.current = interval;
        return () => {
            clearInterval(interval);
            intVal.current = 0;
        };
    }, []);

    const changePermission = async () => {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status != 'granted') {
     if(Platform.OS == 'ios'){
                Linking.openSettings()
            } else{
                startActivityAsync(ActivityAction.LOCATION_SOURCE_SETTINGS);
            }
         } 
    }
    const onTermAccept =  () => {        
        if(checkTerm == false){
           dispatch(updateProfile({term: true}));
       }
   }
    const  onTermLink  = async () => {
        Linking.openURL(settings.CompanyTermCondition).catch(err => console.error("Couldn't load page", err));
   }

const onMapSelectComplete = () => {
    if((tripdata.pickup && tripdata.pickup.source =='mapSelect') || (tripdata.drop && tripdata.drop.source =='mapSelect')){
       if(tripdata.selected === 'pickup'){
           dispatch(updateTripPickup({...tripdata.pickup, source:"region-change"}))
       } else{
           dispatch(updateTripDrop({...tripdata.drop, source:"region-change"}))
       }
    }
  }

    const handleSearch = async (text) => {
        setSearchText(text);
        if (text.length > (settings.AllowCriticalEditsAdmin ? 3 : 5)) {
            setSearchLoading(true);
            try {
                const results = await fetchPlacesAutocomplete(text, UUID);
                if (results) {
                    setSearchResults(results);
                    setIsShowingResults(true);
                }
            } catch (error) {
                console.error('Error searching addresses:', error);
                setSearchResults([]);
            }
            setSearchLoading(false);
        } else {
            setSearchResults([]);
            setIsShowingResults(false);
        }
    };

    const handleSelectAddress = async (address) => {
        setSearchLoading(true);
        try {
            const coords = await fetchCoordsfromPlace(address.place_id);
            if (coords && coords.lat) {
                let placeName = null;
                if (address.place_id) {
                    placeName = await fetchPlaceName(address.place_id);
                }
                if (activeField === 'pickup') {
                    dispatch(updateTripPickup({
                        lat: coords.lat,
                        lng: coords.lng,
                        add: address.description,
                        placeName: placeName,
                        source: 'search'
                    }));
                } else {
                    dispatch(updateTripDrop({
                        lat: coords.lat,
                        lng: coords.lng,
                        add: address.description,
                        placeName: placeName,
                        source: 'search'
                    }));
                    // Buscar dados atuais do Realtime Database ao selecionar destino
                    try {
                        const snapshot = await database().ref('car_types').once('value');
                        const carTypesData = snapshot.val();
                        if (carTypesData) {
                            const carTypesArray = Object.values(carTypesData);
                            console.log('MapScreen - [DESTINO] CarTypes buscados do Realtime ao selecionar destino:', JSON.stringify(carTypesArray, null, 2));
                            setAllCarTypes(carTypesArray);
                        } else {
                            console.log('MapScreen - [DESTINO] carTypesData vazio ou nulo ao selecionar destino!');
                        }
                    } catch (err) {
                        console.error('MapScreen - [DESTINO] Erro ao buscar car_types do Realtime:', err);
                    }
                }
                setIsDropdownVisible(false);
                if (tripdata.pickup && tripdata.drop && tripdata.drop.add) {
                    await handleGetEstimate();
                    getDrivers();
                    Animated.timing(animation, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: false
                    }).start();
                }
            } else {
                Alert.alert(t('alert'), t('place_to_coords_error'));
            }
        } catch (error) {
            console.error('Error getting coordinates:', error);
            Alert.alert(t('alert'), t('place_to_coords_error'));
        }
        setSearchLoading(false);
    };

    useEffect(() => {
        const loadAddressHistory = async () => {
            try {
                const history = await AsyncStorage.getItem('addressHistory');
                if (history) {
                    setAddressHistory(JSON.parse(history));
                }
            } catch (error) {
                console.error('Error loading address history:', error);
            }
        };
        loadAddressHistory();
    }, []);

    const saveToHistory = async (address) => {
        try {
            const newHistory = [address, ...addressHistory.filter(a => a.description !== address.description)].slice(0, 5);
            setAddressHistory(newHistory);
            await AsyncStorage.setItem('addressHistory', JSON.stringify(newHistory));
        } catch (error) {
            console.error('Error saving address to history:', error);
        }
    };

    const renderAddressDropdown = () => {
        if (!isDropdownVisible) return null;

        return (
            <View style={[styles.dropdownContainerModern]}>
                <View style={[styles.dropdownContentModern, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder }]}> 
                    <View style={[styles.searchContainerModern, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder }]}> 
                        <Icon name="search" type="material" color={theme.icon} size={22} style={styles.searchIconModern} />
                        <TextInput
                            style={[styles.searchInputModern, { color: theme.text }]}
                            placeholder="Digite o endereço"
                            placeholderTextColor={theme.placeholder}
                            value={searchText}
                            onChangeText={handleSearch}
                            autoFocus
                        />
                    </View>

                    {searchText.length === 0 && addressHistory.length > 0 && (
                        <View style={styles.historyContainerModern}>
                            <Text style={[styles.historyTitleModern, { color: theme.text }]} >Endereços recentes</Text>
                            {addressHistory.map((address, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={styles.historyItemModern}
                                    onPress={() => {
                                        handleSelectAddress(address);
                                        setIsDropdownVisible(false);
                                    }}
                                >
                                    <Icon 
                                        name="history" 
                                        type="material" 
                                        color={theme.icon} 
                                        size={20} 
                                        style={styles.historyIconModern}
                                    />
                                    <Text style={[styles.historyTextModern, { color: theme.text }]}>{address.description}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {searchText.length > 0 && isShowingResults && (
                        <ScrollView style={styles.resultsContainerModern}>
                            {searchResults.map((result, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={styles.resultItemModern}
                                    onPress={() => {
                                        handleSelectAddress(result);
                                        saveToHistory(result);
                                        setIsDropdownVisible(false);
                                        setIsShowingResults(false);
                                    }}
                                >
                                    <Icon 
                                        name="location-on" 
                                        type="material" 
                                        color={theme.icon} 
                                        size={20} 
                                        style={styles.resultIconModern}
                                    />
                                    <Text style={[styles.resultTextModern, { color: theme.text }]}>{result.description}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}
                </View>
            </View>
        );
    };

    useEffect(() => {
        // Configurar listener para atualizações em tempo real dos tipos de carro
        const carTypesRef = database().ref('car_types');
        const unsubscribe = carTypesRef.on('value', (snapshot) => {
            const carTypesData = snapshot.val();
            if (carTypesData) {
                const carTypesArray = Object.values(carTypesData);
                console.log('MapScreen - [FIREBASE] CarTypes atualizados do Realtime:', JSON.stringify(carTypesArray, null, 2));
                setAllCarTypes(carTypesArray);
            } else {
                console.log('MapScreen - [FIREBASE] carTypesData vazio ou nulo!');
            }
        });
        // Limpar listener quando o componente for desmontado
        return () => {
            carTypesRef.off('value', unsubscribe);
        };
    }, []);

    // Adicionar log sempre que allCarTypes mudar
    useEffect(() => {
        console.log('MapScreen - [STATE] allCarTypes atualizado:', JSON.stringify(allCarTypes, null, 2));
    }, [allCarTypes]);

    useEffect(() => {
      if (routePolyline && routePolyline.length > 1 && mapRef.current) {
        mapRef.current.fitToCoordinates(routePolyline, {
          edgePadding: { top: 80, right: 40, bottom: 120, left: 40 }, // padding ajustado para melhor visualização
          animated: true,
        });
      }
    }, [routePolyline]);

    // Adicione este useEffect para desmontar o card antigo ao trocar o destino
    useEffect(() => {
      setShowCarOptions(false);
    }, [tripdata.drop]);

    useEffect(() => {
      if (mapReady && mapLayout && tripdata.pickup && tripdata.pickup.add) {
        setTimeout(() => setShowLoadingOverlay(false), 300); // delay para garantir renderização
        SplashScreen.hideAsync();
      }
    }, [mapReady, mapLayout, tripdata.pickup && tripdata.pickup.add]);

    useEffect(() => {
      if (mapRef.current && routePolyline && routePolyline.length > 1 && destinoBottom && cardTop && mapTop !== undefined) {
        mapRef.current.fitToCoordinates(routePolyline, {
          edgePadding: {
            top: (destinoBottom - mapTop) + 20, // 20px abaixo da linha inferior do campo de destino, relativo ao topo do mapa
            right: 60,
            bottom: windowHeight - cardTop + 20, // 20px acima do card de preços
            left: 60,
          },
          animated: true,
        });
      }
    }, [routePolyline, destinoBottom, cardTop, mapTop]);

    const [destinoBottom, setDestinoBottom] = useState(0);
    const [cardTop, setCardTop] = useState(0);
    const windowHeight = Dimensions.get('window').height;

    useEffect(() => {
      if (mapRef.current && routePolyline && routePolyline.length > 1 && destinoBottom && cardTop) {
        mapRef.current.fitToCoordinates(routePolyline, {
          edgePadding: {
            top: (destinoBottom + 175), // distância entre o topo da tela e a linha inferior do campo de destino, menos 20px
            right: 60,
            bottom: windowHeight - cardTop + 10, // 20px acima do card de preços
            left: 60,
          },
          animated: true,
        });
      }
    }, [routePolyline, destinoBottom, cardTop]);

    const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);
    const [mapTop, setMapTop] = useState(0);

    return (
        <View style={styles.container}>
            <StatusBar hidden={true} />
            
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity 
                    style={[styles.headerButton, { backgroundColor: theme.card }]}
                    onPress={() => props.navigation.navigate('Settings')}
                >
                    <Icon name="menu" type="material" color={theme.icon} size={24} />
                </TouchableOpacity>
                
                <View style={styles.headerRightContainer}>
                    <TouchableOpacity 
                        style={[styles.headerButton, { backgroundColor: theme.card }]}
                        onPress={() => props.navigation.navigate('Notifications')}
                    >
                        <Icon name="notifications" type="material" color={theme.icon} size={24} />
                    </TouchableOpacity>
                    <ThemeSwitch value={isDarkMode} onValueChange={setIsDarkMode} />
                </View>
            </View>

            {/* Campos de Endereço */}
            <View style={styles.addressContainer}>
                <View style={[styles.addressCardGroup, { backgroundColor: theme.card }]}>
                    <TouchableOpacity
                        style={styles.addressCardRow}
                        onPress={() => {
                            setActiveField('pickup');
                            setIsDropdownVisible(true);
                            setSearchText('');
                            setSearchResults([]);
                        }}
                    >
                        <Icon name="my-location" type="material" color={theme.icon} size={22} containerStyle={styles.addressIcon} />
                        <Text style={tripdata.pickup && (tripdata.pickup.placeName || getStreetAndNumber(tripdata.pickup.add)) ? [styles.addressText, { color: theme.text }] : [styles.addressPlaceholder, { color: theme.placeholder }]} numberOfLines={2}>
                          {tripdata.pickup && (tripdata.pickup.placeName || getStreetAndNumber(tripdata.pickup.add)) || 'Escolha o ponto de partida'}
                        </Text>
                    </TouchableOpacity>
                    <View style={styles.addressDivider} />
                    <TouchableOpacity
                        style={styles.addressCardRow}
                        onLayout={e => setDestinoBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
                        onPress={() => {
                            setActiveField('drop');
                            setIsDropdownVisible(true);
                            setSearchText('');
                            setSearchResults([]);
                        }}
                    >
                        <Icon name="location-on" type="material" color={theme.icon} size={22} containerStyle={styles.addressIcon} />
                        <Text style={tripdata.drop && (tripdata.drop.placeName || getStreetAndNumber(tripdata.drop.add)) ? [styles.addressText, { color: theme.text }] : [styles.addressPlaceholder, { color: theme.placeholder }]} numberOfLines={2}>
                          {tripdata.drop && (tripdata.drop.placeName || getStreetAndNumber(tripdata.drop.add)) || 'Escolha o destino'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {renderAddressDropdown()}

            {/* Mapa */}
            <View style={styles.mapcontainer} onLayout={e => setMapTop(e.nativeEvent.layout.y)}>
                {region && region.latitude && pageActive.current ? (
                    <MapView
                        ref={mapRef}
                        provider={PROVIDER_GOOGLE}
                        style={styles.mapViewStyle}
                        showsUserLocation={true}
                        loadingEnabled
                        showsMyLocationButton={false}
                        initialRegion={region}
                        onRegionChangeComplete={onRegionChangeComplete}
                        onPanDrag={() => setDragging(30)}
                        minZoomLevel={11}
                        maxZoomLevel={20}
                        customMapStyle={isDarkMode ? mapStyleDark : mapStyleLight}
                        showsCompass={true}
                        showsScale={true}
                        showsTraffic={false}
                        showsBuildings={true}
                        showsIndoors={true}
                        showsIndoorLevelPicker={true}
                        rotateEnabled={true}
                        scrollEnabled={true}
                        pitchEnabled={true}
                        toolbarEnabled={false}
                        moveOnMarkerPress={false}
                        onMapReady={() => setMapReady(true)}
                        onLayout={() => setMapLayout(true)}
                    >
                        {freeCars ? freeCars.map((item, index) => {
                            return (
                                <Marker.Animated
                                    coordinate={{ latitude: item.location ? item.location.lat : 0.00, longitude: item.location ? item.location.lng : 0.00 }}
                                    key={index}
                                >
                                    <Image
                                        key={index}
                                        source={settings && settings.carType_required && item.carImage ? {uri: item.carImage} : require('../../assets/images/microBlackCar.png')}
                                        style={{ height: 48, width: 48, resizeMode: 'contain' }}
                                    />
                                </Marker.Animated>
                            )
                        }) : null}
                        {tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng && (
                          <Marker
                            coordinate={{ latitude: tripdata.pickup.lat, longitude: tripdata.pickup.lng }}
                            title="Origem"
                          >
                            <Icon name="location-on" type="material" color={isDarkMode ? "#FFFFFF" : "#333333"} size={24} />
                          </Marker>
                        )}
                        {tripdata.drop && tripdata.drop.lat && tripdata.drop.lng && (
                          <Marker
                            coordinate={{ latitude: tripdata.drop.lat, longitude: tripdata.drop.lng }}
                            title="Destino"
                          >
                            <Icon name="location-on" type="material" color={isDarkMode ? "#FFFFFF" : "#333333"} size={24} />
                          </Marker>
                        )}
                        <Polyline
                          coordinates={routePolyline}
                          strokeColor={isDarkMode ? "#FFFFFF" : "#000000"}
                          strokeWidth={3}
                          zIndex={10}
                        />
                    </MapView>
                ) : null}
            </View>

            {mapReady && mapLayout && tripdata.pickup && tripdata.pickup.add && tripdata.drop && tripdata.drop.add && hasValidEstimate && (
                <>
                    <View
                      style={[styles.carOptionsContainer]}
                      onLayout={e => setCardTop(e.nativeEvent.layout.y)}
                    >
                      <View style={[styles.carOptionsMainCard, { backgroundColor: theme.card }]}> 
                        {filteredCarTypes.map((car, idx) => {
                          const { fare, time, tollFee } = getEstimateForCar(car);
                          const selected = selectedCarType === car.name;
                          return (
                            <TouchableOpacity
                              key={car.name}
                              onPress={() => setSelectedCarType(car.name)}
                              style={[styles.carCard, selected && styles.selectedCarCard, { backgroundColor: theme.card, borderColor: selected ? theme.leafGreen : theme.divider }]}
                              activeOpacity={0.85}
                            >
                              <View style={[styles.carInfo, { width: '100%' }]}> 
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 2 }}>
                                  <Text style={[styles.carNameValue, { color: theme.text }]} numberOfLines={1}>{car.name}</Text>
                                  <Text style={[styles.priceNameValue, { color: theme.text }]}>{fare}</Text>
                                </View>
                                <View style={styles.carDetailsRow}>
                                  <Text style={[styles.carSubInfo, { color: theme.textSecondary }]}>{time} chegada</Text>
                                  {tollFee && <Text style={[styles.carSubInfo, { color: theme.textSecondary }]}>• Pedágio: {tollFee}</Text>}
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>

                    {/* Botão de Agendar */}
                    <View style={styles.bookButtonContainer}>
                      <View style={[styles.animatedBorder, { borderColor: '#fff', padding: 3 }]}> 
                        <TouchableOpacity
                          style={[
                            styles.bookButton,
                            { backgroundColor: theme.leafGreen }
                          ]}
                          onPress={bookNow}
                          disabled={!selectedCarType || !hasValidEstimate || bookModelLoading}
                          activeOpacity={0.85}
                        >
                          {bookModelLoading ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                          ) : (
                            <>
                              <Text style={styles.bookButtonText}>
                                {selectedCarType === 'Leaf Plus' && 'Confirmar Plus'}
                                {selectedCarType === 'Leaf Elite' && 'Confirmar Elite'}
                                {!selectedCarType && 'Confirmar'}
                              </Text>
                              <Text style={styles.bookButtonSubtext}>
                                {selectedCarType && hasValidEstimate ? 
                                  (() => {
                                    const estimate = getEstimateForCar(filteredCarTypes.find(car => car.name === selectedCarType));
                                    return estimate && estimate.fare ? `${settings.currency} ${estimate.fare}` : 'Valor indisponível';
                                  })()
                                  : 'Selecione um carro'}
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                </>
            )}
            {showLoadingOverlay && (
              <View style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: isDarkMode ? '#232323' : '#fff',
                zIndex: 9999,
                justifyContent: 'center',
                alignItems: 'center'
              }}>
                <Image source={splashImg} style={{ position: 'absolute', width: '100%', height: '100%', resizeMode: 'cover' }} />
                <ActivityIndicator size="large" color="#fff" style={{ zIndex: 2, marginTop: 170 }} />
              </View>
            )}
        </View>
    );
}
import React, { useEffect, useState, useRef, useContext, useMemo, useCallback } from 'react';
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
import i18n from '../i18n';
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
import BottomMenu from '../components/BottomMenu';
import OptionModal from '../components/OptionModal';
import GoogleMapApiConfig from '../../config/GoogleMapApiConfig';
import TollUtils from '../../../common/src/other/TollUtils';

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
        fetchNearbyDrivers,
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
    
    // Verificar se o FirebaseContext está disponível antes de usar
    let config = null;
    try {
        const firebaseContext = useContext(FirebaseContext);
        config = firebaseContext?.config;
    } catch (error) {
        console.warn('FirebaseContext não disponível:', error);
    }
    
    // Fallback para config se não estiver disponível
    if (!config) {
        config = {
            projectId: "leaf-reactnative",
            appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
            databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
            storageBucket: "leaf-reactnative.firebasestorage.app",
            apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
            authDomain: "leaf-reactnative.firebaseapp.com",
            messagingSenderId: "106504629884",
            measurementId: "G-22368DBCY9"
        };
    }
    
    const { t } = useTranslation();
    const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;

    const auth = useSelector(state => state.auth);
    const settingsdata = useSelector(state => state.settingsdata.settings);
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

    // Usar o tema importado
    const [isDarkMode, setIsDarkMode] = useState(false);
    const theme = isDarkMode ? darkTheme : lightTheme;

    // Inicialize o estado local com o fallback
    const [allCarTypes, setAllCarTypes] = useState(fallbackCarTypes);

    const cartypesRedux = useSelector(state => state.cartypes);
    console.log('allCarTypes:', allCarTypes);
    console.log('cartypesRedux:', cartypesRedux);

    const filteredCarTypes = useMemo(() => {
        if (!allCarTypes || allCarTypes.length === 0) return [];
        
        return allCarTypes
            .filter(car => car && car.name)
            .sort((a, b) => (a.pos || 0) - (b.pos || 0))
            .slice(0, 5); // Limitar a 5 tipos de carro para performance
    }, [allCarTypes]);

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

    // Novo estado para seleção de categoria - definindo Leaf Plus como padrão
    const [selectedCarType, setSelectedCarType] = useState('Leaf Plus');

    const [carEstimates, setCarEstimates] = useState({});

    const [routePolyline, setRoutePolyline] = useState([]);

    const [showCarOptions, setShowCarOptions] = useState(false);

    // Adicionar estados para controlar o carregamento real do mapa
    const [mapReady, setMapReady] = useState(false);
    const [mapLayout, setMapLayout] = useState(false);
    // Adicionar estado para destinoBottom
    const [destinoBottom, setDestinoBottom] = useState(null);
    // Adicionar estado para cardTop
    const [cardTop, setCardTop] = useState(null);
    // Adicionar estado para mapTop
    const [mapTop, setMapTop] = useState(null);
    // Adicionar estado para showLoadingOverlay
    const [showLoadingOverlay, setShowLoadingOverlay] = useState(true);

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
            zIndex: 2500,
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
            zIndex: 3000,
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
            zIndex: 1500,
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
        historyTextModern: {
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
        clearButtonModern: {
            padding: 8,
            marginLeft: 8,
        },
        noResultsContainerModern: {
            padding: 20,
            alignItems: 'center',
        },
        noResultsTextModern: {
            fontSize: 16,
            textAlign: 'center',
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

    const adjustMapZoom = useCallback(() => {
        if (!mapRef.current || !routePolyline || routePolyline.length < 2) return;

        mapRef.current.fitToCoordinates(routePolyline, {
            edgePadding: { top: 80, right: 40, bottom: 120, left: 40 },
            animated: true,
        });
    }, [routePolyline]);

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
    const hasValidEstimate = useMemo(() => {
        return carEstimates && Object.keys(carEstimates).length > 0 && 
               tripdata.pickup && tripdata.pickup.add && 
               tripdata.drop && tripdata.drop.add;
    }, [carEstimates, tripdata.pickup, tripdata.drop]);

    const getEstimateForCar = useCallback((car) => {
        if (!car || !tripdata.pickup || !tripdata.drop) return { fare: '0', time: '0', tollFee: 0 };
        
        try {
            const estimate = carEstimates[car.name];
            if (estimate && estimate.estimateFare) {
                return {
                    fare: estimate.estimateFare,
                    time: estimate.estimateTime ? Math.round(estimate.estimateTime / 60) : 0,
                    tollFee: estimate.tollFee || 0
                };
            }
            
            // Fallback para cálculo local se necessário
            return { fare: '0', time: '0', tollFee: 0 };
        } catch (error) {
            console.error('Erro ao calcular estimativa:', error);
            return { fare: '0', time: '0', tollFee: 0 };
        }
    }, [carEstimates, tripdata.pickup, tripdata.drop]);

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
            try {
                console.log('🚗 Buscando motoristas próximos...');
                
                // Usar nova função otimizada com Redis
                const nearbyDrivers = await dispatch(fetchNearbyDrivers(
                    tripdata.pickup.lat, 
                    tripdata.pickup.lng, 
                    (settings && settings.driverRadius) ? settings.driverRadius : 10,
                    { appType: 'app' }
                ));

                console.log('📍 Motoristas encontrados:', nearbyDrivers.length);

                if (nearbyDrivers && nearbyDrivers.length > 0) {
                    let availableDrivers = [];
                    let arr = {};
                    let startLoc = tripdata.pickup.lat + ',' + tripdata.pickup.lng;
                    let distArr = [];

                    // Usar motoristas já ordenados por distância do Redis/Firebase
                    const sortedDrivers = settings.useDistanceMatrix ? nearbyDrivers.slice(0, 25) : nearbyDrivers;

                    if (sortedDrivers.length > 0) {
                        // Preparar destinos para Distance Matrix (se necessário)
                        let driverDest = "";
                        for (let i = 0; i < sortedDrivers.length; i++) {
                            let driver = { ...sortedDrivers[i] };
                            driverDest = driverDest + driver.location.lat + "," + driver.location.lng;
                            if (i < (sortedDrivers.length - 1)) {
                                driverDest = driverDest + '|';
                            }
                        }

                        // Obter tempos de chegada
                        if (settings.useDistanceMatrix) {
                            distArr = await getDistanceMatrix(startLoc, driverDest);
                        } else {
                            // Usar distância já calculada pelo Redis/Firebase
                            for (let i = 0; i < sortedDrivers.length; i++) {
                                const driver = sortedDrivers[i];
                                const timeEstimate = driver.distance ? 
                                    ((driver.distance * 2) + 1).toFixed(0) + ' min' : 
                                    '5 min';
                                distArr.push({ timein_text: timeEstimate, found: true });
                            }
                        }

                        // Processar motoristas
                        for (let i = 0; i < sortedDrivers.length; i++) {
                            let driver = { ...sortedDrivers[i] };
                            if (distArr[i] && distArr[i].found && cars) {
                                driver.arriveTime = distArr[i];
                                
                                // Adicionar imagem do carro
                                for (let j = 0; j < cars.length; j++) {
                                    if (cars[j].name == driver.carType) {
                                        driver.carImage = cars[j].image;
                                        break;
                                    }
                                }

                                // Organizar por tipo de carro
                                let carType = driver.carType;
                                if (carType && carType.length > 0) {
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
                                } else {
                                    // Fallback para todos os tipos de carro
                                    let carTypes = allCarTypes;
                                    for (let j = 0; j < carTypes.length; j++) {
                                        let carType = carTypes[j];
                                        if (arr[carType]) {
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

                    // Atualizar tipos de carro disponíveis
                    let carWiseArr = [];
                    if (cars) {
                        for (let i = 0; i < cars.length; i++) {
                            let temp = { ...cars[i] };
                            if (arr[cars[i].name]) {
                                temp['nearbyData'] = arr[cars[i].name].sortedDrivers;
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
                    
                    console.log('✅ Motoristas processados:', availableDrivers.length);
                } else {
                    console.log('⚠️ Nenhum motorista encontrado na área');
                    setFreeCars([]);
                    resetCars();
                }
            } catch (error) {
                console.error('❌ Erro ao buscar motoristas:', error);
                setFreeCars([]);
                resetCars();
            }
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
                    // Usar um fallback se config não estiver disponível
                    const projectId = config?.projectId || 'leaf-reactnative';
                    let res =  await fetch(`https://${projectId}.web.app/getservertime`, { method: 'GET', headers: {'Content-Type': 'application/json'}});
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

    const bookNow = useCallback(async () => {
        if (!selectedCarType || !hasValidEstimate || bookModelLoading) return;

        try {
            setBookModelLoading(true);
            const selectedCar = filteredCarTypes.find(car => car.name === selectedCarType);
            if (!selectedCar) {
                console.error('Carro selecionado não encontrado');
                return;
            }

            const bookingData = {
                ...tripdata,
                carType: selectedCar,
                estimate: getEstimateForCar(selectedCar)
            };

            await finaliseBooking(bookingData);
        } catch (error) {
            console.error('Erro ao agendar:', error);
        } finally {
            setBookModelLoading(false);
        }
    }, [selectedCarType, hasValidEstimate, bookModelLoading, filteredCarTypes, tripdata, getEstimateForCar]);

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

    const handleSearch = useCallback(async (text) => {
        if (!text || text.length < 3) {
            setSearchResults([]);
            return;
        }

        try {
            const results = await fetchPlacesAutocomplete(text);
            setSearchResults(results || []);
        } catch (error) {
            console.error('Erro na busca:', error);
            setSearchResults([]);
        }
    }, []);

    const handleSelectAddress = useCallback(async (address) => {
        try {
            const coords = await fetchCoordsfromPlace(address.place_id);
            if (coords) {
                const newAddress = {
                    lat: coords.lat,
                    lng: coords.lng,
                    add: address.description,
                    placeName: address.description,
                    placeId: address.place_id
                };

                if (activeField === 'pickup') {
                    dispatch(updateTripPickup(newAddress));
                } else {
                    dispatch(updateTripDrop(newAddress));
                }
            }
        } catch (error) {
            console.error('Erro ao selecionar endereço:', error);
        }
    }, [activeField]);

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

    // Memoizar marcadores dos carros
    const CarMarkers = useMemo(() => {
        if (!freeCars || freeCars.length === 0) return null;
        
        return freeCars.map((item, index) => (
            <Marker.Animated
                coordinate={{ 
                    latitude: item.location ? item.location.lat : 0.00, 
                    longitude: item.location ? item.location.lng : 0.00 
                }}
                key={`car-${index}`}
            >
                <Image
                    source={settings && settings.carType_required && item.carImage ? 
                        {uri: item.carImage} : 
                        require('../../assets/images/microBlackCar.png')
                    }
                    style={{ height: 48, width: 48, resizeMode: 'contain' }}
                />
            </Marker.Animated>
        ));
    }, [freeCars, settings]);

    // Memoizar marcadores de origem e destino
    const RouteMarkers = useMemo(() => {
        const markers = [];
        
        if (tripdata.pickup && tripdata.pickup.lat && tripdata.pickup.lng) {
            markers.push(
                <Marker
                    key="pickup"
                    coordinate={{ latitude: tripdata.pickup.lat, longitude: tripdata.pickup.lng }}
                    title="Origem"
                >
                    <Icon name="location-on" type="material" color={isDarkMode ? "#FFFFFF" : "#333333"} size={24} />
                </Marker>
            );
        }
        
        if (tripdata.drop && tripdata.drop.lat && tripdata.drop.lng) {
            markers.push(
                <Marker
                    key="drop"
                    coordinate={{ latitude: tripdata.drop.lat, longitude: tripdata.drop.lng }}
                    title="Destino"
                >
                    <Icon name="location-on" type="material" color={isDarkMode ? "#FFFFFF" : "#333333"} size={24} />
                </Marker>
            );
        }
        
        return markers;
    }, [tripdata.pickup, tripdata.drop, isDarkMode]);

    // Memoizar polyline da rota
    const RoutePolyline = useMemo(() => {
        if (!routePolyline || routePolyline.length < 2) return null;
        
        return (
            <Polyline
                coordinates={routePolyline}
                strokeColor={isDarkMode ? "#FFFFFF" : "#000000"}
                strokeWidth={3}
                zIndex={10}
            />
        );
    }, [routePolyline, isDarkMode]);

    // Otimizar dropdown de endereços
    const AddressDropdown = useMemo(() => {
        if (!isDropdownVisible) return null;

        return (
            <View style={styles.dropdownContainerModern}>
                <View style={[styles.dropdownContentModern, { backgroundColor: theme.dropdown }]}>
                    <View style={styles.searchContainerModern}>
                        <Icon 
                            name="search" 
                            type="material" 
                            color={theme.icon} 
                            size={20} 
                            style={styles.searchIconModern}
                        />
                        <TextInput
                            style={[styles.searchInputModern, { color: theme.text, backgroundColor: theme.background }]}
                            placeholder={t('search_place')}
                            placeholderTextColor={theme.placeholder}
                            value={searchText}
                            onChangeText={handleSearch}
                            autoFocus={true}
                        />
                        {searchText.length > 0 && (
                            <TouchableOpacity 
                                onPress={() => {
                                    setSearchText('');
                                    setSearchResults([]);
                                }}
                                style={styles.clearButtonModern}
                            >
                                <Icon name="close" type="material" color={theme.icon} size={20} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {searchText.length === 0 && addressHistory.length > 0 && (
                        <View style={styles.historyContainerModern}>
                            <Text style={[styles.historyTitleModern, { color: theme.textSecondary }]}>
                                {t('recent_searches')}
                            </Text>
                            {addressHistory.slice(0, 5).map((address, index) => (
                                <TouchableOpacity
                                    key={`history-${index}`}
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
                                    <Text style={[styles.historyTextModern, { color: theme.text }]} numberOfLines={2}>
                                        {address.description}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}

                    {searchText.length > 0 && searchResults.length > 0 && (
                        <ScrollView style={styles.resultsContainerModern} showsVerticalScrollIndicator={false}>
                            {searchResults.map((result, index) => (
                                <TouchableOpacity
                                    key={`result-${index}`}
                                    style={styles.resultItemModern}
                                    onPress={() => {
                                        handleSelectAddress(result);
                                        saveToHistory(result);
                                        setIsDropdownVisible(false);
                                    }}
                                >
                                    <Icon 
                                        name="location-on" 
                                        type="material" 
                                        color={theme.icon} 
                                        size={20} 
                                        style={styles.resultIconModern}
                                    />
                                    <Text style={[styles.resultTextModern, { color: theme.text }]} numberOfLines={2}>
                                        {result.description}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}

                    {searchText.length > 0 && searchResults.length === 0 && (
                        <View style={styles.noResultsContainerModern}>
                            <Text style={[styles.noResultsTextModern, { color: theme.textSecondary }]}>
                                {t('no_results_found')}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        );
    }, [isDropdownVisible, searchText, searchResults, addressHistory, theme, handleSearch, handleSelectAddress]);

    // Otimizar campos de endereço
    const AddressFields = useMemo(() => {
        return (
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
                        <Text 
                            style={
                                tripdata.pickup && (tripdata.pickup.placeName || getStreetAndNumber(tripdata.pickup.add)) ? 
                                [styles.addressText, { color: theme.text }] : 
                                [styles.addressPlaceholder, { color: theme.placeholder }]
                            } 
                            numberOfLines={2}
                        >
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
                        <Text 
                            style={
                                tripdata.drop && (tripdata.drop.placeName || getStreetAndNumber(tripdata.drop.add)) ? 
                                [styles.addressText, { color: theme.text }] : 
                                [styles.addressPlaceholder, { color: theme.placeholder }]
                            } 
                            numberOfLines={2}
                        >
                            {tripdata.drop && (tripdata.drop.placeName || getStreetAndNumber(tripdata.drop.add)) || 'Escolha o destino'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }, [tripdata.pickup, tripdata.drop, theme]);

    // Componente para opções de carro
    const CarOptionsCard = useMemo(() => {
        if (!filteredCarTypes || filteredCarTypes.length === 0) return null;
        if (!tripdata.pickup || !tripdata.drop || !tripdata.drop.add) return null;
        
        return (
            <View style={styles.carOptionsContainer}>
                <View style={[styles.carOptionsMainCard, { backgroundColor: theme.card }]}>
                    {filteredCarTypes.map((car, index) => (
                        <TouchableOpacity
                            key={car.id || index}
                            style={[
                                styles.carCard,
                                selectedCarType === car.name && styles.selectedCarCard
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
                                        <Text style={styles.carNameValue}>{car.name}</Text>
                                        <Text style={styles.priceNameValue}>
                                            {carEstimates[car.name]?.estimateFare ? 
                                                `${settings.currency}${carEstimates[car.name].estimateFare.toFixed(settings.decimal)}` : 
                                                `${settings.currency}${car.min_fare.toFixed(settings.decimal)}`
                                            }
                                        </Text>
                                    </View>
                                    <View style={styles.carDetailsRow}>
                                        <Text style={styles.carSubInfo}>{car.extra_info}</Text>
                                    </View>
                                </View>
                            </View>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        );
    }, [filteredCarTypes, selectedCarType, carEstimates, settings, theme, tripdata.pickup, tripdata.drop]);

    // Componente para o botão de agendamento
    const BookButton = useMemo(() => {
        if (!selectedCarType || !tripdata.pickup || !tripdata.drop || !tripdata.drop.add) return null;
        
        const selectedCar = filteredCarTypes.find(car => car.name === selectedCarType);
        const estimate = getEstimateForCar(selectedCar);
        
        return (
            <View style={styles.bookButtonContainer}>
                <TouchableOpacity
                    style={[
                        styles.bookButton,
                        bookModelLoading && styles.bookButtonDisabled
                    ]}
                    onPress={bookNow}
                    disabled={bookModelLoading}
                >
                    <Text style={styles.bookButtonText}>
                        {bookModelLoading ? 'Aguarde...' : 'Agendar Agora'}
                    </Text>
                    <Text style={styles.bookButtonSubtext}>
                        {estimate.fare ? `${settings.currency}${estimate.fare}` : 'Preço sob consulta'}
                    </Text>
                </TouchableOpacity>
            </View>
        );
    }, [selectedCarType, filteredCarTypes, getEstimateForCar, bookModelLoading, settings, bookNow, tripdata.pickup, tripdata.drop]);

    // Otimizar useEffects
    useEffect(() => {
        // Configurar listener para atualizações em tempo real dos tipos de carro
        const carTypesRef = database().ref('car_types');
        
        const handleCarTypesUpdate = (snapshot) => {
            const carTypesData = snapshot.val();
            if (carTypesData) {
                const carTypesArray = Object.values(carTypesData).filter(car => car && car.name);
                setAllCarTypes(carTypesArray);
            }
        };

        carTypesRef.on('value', handleCarTypesUpdate);
        
        return () => {
            carTypesRef.off('value', handleCarTypesUpdate);
        };
    }, []);

    // Otimizar ajuste de zoom quando rota muda
    useEffect(() => {
        if (routePolyline && routePolyline.length > 1 && mapRef.current) {
            adjustMapZoom();
        }
    }, [routePolyline, adjustMapZoom]);

    // Otimizar loading overlay
    useEffect(() => {
        if (mapReady && mapLayout && tripdata.pickup && tripdata.pickup.add) {
            const timer = setTimeout(() => {
                setShowLoadingOverlay(false);
                SplashScreen.hideAsync();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [mapReady, mapLayout, tripdata.pickup]);

    // Otimizar ajuste de zoom com posições dos elementos
    useEffect(() => {
        if (mapRef.current && routePolyline && routePolyline.length > 1 && destinoBottom && cardTop && mapTop !== undefined) {
            const windowHeight = Dimensions.get('window').height;
            mapRef.current.fitToCoordinates(routePolyline, {
                edgePadding: {
                    top: (destinoBottom - mapTop) + 20,
                    right: 60,
                    bottom: windowHeight - cardTop + 20,
                    left: 60,
                },
                animated: true,
            });
        }
    }, [routePolyline, destinoBottom, cardTop, mapTop]);

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
            {AddressFields}

            {AddressDropdown}

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
                        {CarMarkers}
                        {RouteMarkers}
                        {RoutePolyline}
                    </MapView>
                ) : null}
            </View>

            {/* Botão de localização flutuante */}
            {mapReady && mapLayout && (!tripdata.pickup || !tripdata.drop || !tripdata.drop.add) && (
                <View style={styles.locationButtonView}>
                    <TouchableOpacity
                        style={[styles.locateButtonStyle, { backgroundColor: theme.icon }]}
                        onPress={locateUser}
                    >
                        <Icon name="my-location" type="material" color="#fff" size={24} />
                    </TouchableOpacity>
                </View>
            )}

            {/* Card de opções de carro */}
            {CarOptionsCard}
            {/* Botão de ação principal */}
            <View onLayout={e => setCardTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
                {BookButton}
            </View>

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
            {/* Menu inferior moderno, só aparece quando o mapa está pronto e não há destino definido */}
            <BottomMenu visible={mapReady && mapLayout && (!tripdata.pickup || !tripdata.drop || !tripdata.drop.add)} />
        </View>
    );
}
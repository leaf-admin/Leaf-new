import React, { useEffect, useState, useRef } from 'react';
import { colors } from '../common/theme';
import { useSelector, useDispatch } from 'react-redux';
import {
    View,
    Text,
    Dimensions,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Image,
    Platform,
    Alert,
    StyleSheet,
    TextInput,
    ActivityIndicator

} from 'react-native';
import { AntDesign } from '@expo/vector-icons';
import Button from '../components/Button';
import RNPickerSelect from '../components/RNPickerSelect';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import ActionSheet from "react-native-actions-sheet";
import i18n from '../i18n';
import { Ionicons } from '@expo/vector-icons';
import Footer from '../components/Footer';
import { FormIcon, MAIN_COLOR } from '../common/sharedFunctions';
import {fonts}from "../common/font"
import { getLangKey } from 'common/src/other/getLangKey';
var { height, width } = Dimensions.get('window');

export default function CarEditScreen(props) {
    // [1] Lista de modelos Leaf Elite
    const eliteList = [
      { brand: 'Nissan', model: 'Kicks' },
      { brand: 'Toyota', model: 'Corolla' },
      { brand: 'Hyundai', model: 'Creta' },
      { brand: 'Volkswagen', model: 'T-Cross' },
      { brand: 'BYD', model: 'Dolphin' },
      { brand: 'Citroen', model: 'C4 Cactus' },
      { brand: 'Chevrolet', model: 'Tracker' },
      { brand: 'Volkswagen', model: 'Nivus' },
      { brand: 'Nissan', model: 'Sentra' },
      { brand: 'Renault', model: 'Captur' },
      { brand: 'Chevrolet', model: 'Cruze' },
      { brand: 'Renault', model: 'Duster' },
      { brand: 'Jeep', model: 'Renegade' },
      { brand: 'Honda', model: 'HR-V' },
      { brand: 'Honda', model: 'Civic' },
      { brand: 'Kia', model: 'Cerato' },
      { brand: 'Chery', model: 'Arrizo 5' },
      { brand: 'Fiat', model: 'Fastback' },
      { brand: 'Volkswagen', model: 'Jetta' },
      { brand: 'Mitsubishi', model: 'Lancer' },
      { brand: 'Toyota', model: 'Prius' },
      { brand: 'Jeep', model: 'Compass' },
      { brand: 'Chery', model: 'Tiggo 5X' },
      { brand: 'Chery', model: 'Arrizo 6' },
      { brand: 'Toyota', model: 'Corolla Cross' },
      { brand: 'Hyundai', model: 'ix35' },
      { brand: 'BYD', model: 'D1' },
      { brand: 'Chery', model: 'Tiggo' },
      { brand: 'JAC Motors', model: 'T40' },
      { brand: 'Citroen', model: 'C4 Lounge' },
      { brand: 'Nissan', model: 'LEAF' },
      { brand: 'Citroen', model: 'C4L' },
      { brand: 'Hyundai', model: 'Tucson' },
      { brand: 'Ford', model: 'Fusion' },
      { brand: 'Hyundai', model: 'Elantra' },
      { brand: 'Mitsubishi', model: 'ASX' },
      { brand: 'Renault', model: 'Kardian' },
      { brand: 'Toyota', model: 'Corolla Cross Hybrid' },
      { brand: 'Peugeot', model: '3008' },
      { brand: 'Chery', model: 'Tiggo 7' },
      { brand: 'Chery', model: 'Tiggo 3X' },
      { brand: 'JAC Motors', model: 'E-JS4' },
      { brand: 'Kia', model: 'Sportage' },
      { brand: 'Audi', model: 'A3' },
      { brand: 'Mitsubishi', model: 'Outlander' },
      { brand: 'BYD', model: 'Yuan Plus' },
      { brand: 'Volkswagen', model: 'Taos' },
      { brand: 'BYD', model: 'KING DM-i' },
      { brand: 'JAC Motors', model: 'T50' },
      { brand: 'Volkswagen', model: 'Tiguan' },
      { brand: 'Volkswagen', model: 'Golf' },
      { brand: 'JAC Motors', model: 'EJ7' },
      { brand: 'Toyota', model: 'Corolla Altis Hybrid' },
      { brand: 'Audi', model: 'Q3' },
      { brand: 'BYD', model: 'Song Plus' },
      { brand: 'Toyota', model: 'RAV4' },
      { brand: 'Toyota', model: 'Corolla Altis' },
      { brand: 'Peugeot', model: 'E-208' },
      { brand: 'Chery', model: 'Tiggo 8' },
      { brand: 'Chevrolet', model: 'Equinox' },
      { brand: 'Chery', model: 'Tiggo 3' },
      { brand: 'Hyundai', model: 'Ioniq' },
      { brand: 'Chery', model: 'Tiggo 5' },
      { brand: 'Hyundai', model: 'i30' },
      { brand: 'Hyundai', model: 'Ioniq Plug-in Hybrid' },
      { brand: 'Kia', model: 'Soul' },
      { brand: 'Mitsubishi', model: 'Eclipse Cross' },
      { brand: 'Kia', model: 'Stonic' },
      { brand: 'Chevrolet', model: 'Bolt' },
      { brand: 'Toyota', model: 'Corolla Hybrid' },
      { brand: 'BYD', model: 'Song Pro' },
      { brand: 'Hyundai', model: 'Kona Hybrid' },
      { brand: 'JAC Motors', model: 'T60 Plus' },
      { brand: 'Mercedes-Benz', model: 'C 180' },
      { brand: 'Chery', model: 'Arrizo 5e' },
      { brand: 'Peugeot', model: 'E-2008' },
      { brand: 'Jeep', model: 'Commander' },
      { brand: 'Haval', model: 'H6' },
      { brand: 'Volkswagen', model: 'Passat' },
      { brand: 'JAC', model: 'T60' },
      { brand: 'BMW', model: 'X1' },
      { brand: 'Audi', model: 'A4' },
      { brand: 'Fiat', model: 'Freemont' },
      { brand: 'Citroen', model: 'C4 Picasso' },
      { brand: 'Suzuki', model: 'S-Cross' },
      { brand: 'Dodge', model: 'Journey' },
      { brand: 'BMW', model: '320i' },
      { brand: 'Mercedes-Benz', model: 'GLA-Class' },
      { brand: 'BYD', model: 'Seal' },
      { brand: 'Volkswagen', model: 'Jetta Clasico' },
      { brand: 'Volvo', model: 'XC40' },
      { brand: 'Volvo', model: 'S60' },
      { brand: 'Mercedes-Benz', model: 'C 250' },
      { brand: 'Hyundai', model: 'Kona' },
      { brand: 'Toyota', model: 'Camry' },
      { brand: 'Kia', model: 'Sorento' },
      { brand: 'Citroen', model: 'Grand Picasso' },
      { brand: 'Honda', model: 'Accord' },
      { brand: 'Hyundai', model: 'Santa Fe' },
      { brand: 'Renault', model: 'Megane E-Tech' },
      { brand: 'BMW', model: 'M3' },
      { brand: 'Chevrolet', model: 'Trailblazer' },
      { brand: 'Chevrolet', model: 'Captiva' },
      { brand: 'Toyota', model: 'Hilux SW4' },
      { brand: 'Mercedes-Benz', model: 'C 200' },
      { brand: 'BMW', model: '3-Series 330e' },
      { brand: 'Nissan', model: 'LEAF EV' },
      { brand: 'Kia', model: 'E-Niro' },
      { brand: 'Toyota', model: 'Prius+' },
      { brand: 'Hyundai', model: 'Azera' },
      { brand: 'Mercedes-Benz', model: 'A-Class' },
      { brand: 'Mercedes-Benz', model: 'C-Class' },
      { brand: 'Honda', model: 'ZR-V' },
      { brand: 'Volvo', model: 'V60' },
      { brand: 'Mitsubishi', model: 'Pajero' },
      { brand: 'Subaru', model: 'Forester' },
      { brand: 'Mitsubishi', model: 'Outlander Sport' },
      { brand: 'Land Rover', model: 'Discovery Sport' },
      { brand: 'Audi', model: 'Q5' },
      { brand: 'Volvo', model: 'EX30' },
      { brand: 'Lexus', model: 'ES' },
      { brand: 'Kia', model: 'Optima' },
      { brand: 'Mercedes-Benz', model: 'CLA-Class' },
      { brand: 'BMW', model: '3-series' },
      { brand: 'Land Rover', model: 'Range Rover Evoque' },
      { brand: 'BMW', model: 'X2' },
      { brand: 'Volvo', model: 'XC60' },
      { brand: 'Lexus', model: 'UX Hybrid' },
      { brand: 'Mitsubishi', model: 'Pajero Sport' },
      { brand: 'Mercedes-Benz', model: 'E250' },
      { brand: 'Kia', model: 'Carnival' },
      { brand: 'Hyundai', model: 'Sonata' },
      { brand: 'Hyundai', model: 'Veracruz' },
      { brand: 'Mercedes-Benz', model: 'B200' },
      { brand: 'Ford', model: 'Bronco' },
      { brand: 'Porsche', model: 'Macan' },
      { brand: 'Volkswagen', model: 'CC' },
      { brand: 'Volvo', model: 'XC90' },
      { brand: 'Alfa Romeo', model: '159' },
      { brand: 'Alfa Romeo', model: '166' },
      { brand: 'Alfa Romeo', model: '939' },
      { brand: 'Alfa Romeo', model: 'Giulietta' },
      { brand: 'Alfa Romeo', model: 'GTV' },
      { brand: 'Aston Martin', model: 'DBS' },
      { brand: 'Audi', model: '100' },
      { brand: 'Audi', model: 'A3 Limousine' },
      { brand: 'Audi', model: 'A3 Sportback' },
      { brand: 'Audi', model: 'A4 Avant' },
      { brand: 'Audi', model: 'A5' },
      { brand: 'Audi', model: 'A5 Avant' },
      { brand: 'Audi', model: 'A6' },
      { brand: 'Audi', model: 'A6 Avant' },
      { brand: 'Audi', model: 'A7' },
      { brand: 'Audi', model: 'A8' },
      { brand: 'Audi', model: 'e-tron' },
      { brand: 'Audi', model: 'e-tron Sportback' },
      { brand: 'Audi', model: 'Q6' },
      { brand: 'Audi', model: 'Q7' },
      { brand: 'Audi', model: 'Q8' },
      { brand: 'Audi', model: 'RS 3' },
      { brand: 'Audi', model: 'RS 4' },
      { brand: 'Audi', model: 'RS 6' },
      { brand: 'Audi', model: 'S3' },
      { brand: 'Audi', model: 'S4 Avant' },
      { brand: 'Audi', model: 'S5 Sportback' },
      { brand: 'Audi', model: 'S6' },
      { brand: 'Audi', model: 'S7' },
      { brand: 'Audi', model: 'SQ5' },
      { brand: 'Audi', model: 'TT' },
      { brand: 'Audi', model: 'TTS' },
      { brand: 'BMW', model: '1-series' },
      { brand: 'BMW', model: '2-Series 225xe' },
      { brand: 'BMW', model: '2-series Active Tourer' },
      { brand: 'BMW', model: '2-series Gran Tourer' },
      { brand: 'BMW', model: '3-series Gran Turismo' },
      { brand: 'BMW', model: '316i' },
      { brand: 'BMW', model: '4-series' },
      { brand: 'BMW', model: '4-series Gran Coupe' },
      { brand: 'BMW', model: '5-series' },
      { brand: 'BMW', model: '5-Series 530e' },
      { brand: 'BMW', model: '5-series Gran Turismo' },
      { brand: 'BMW', model: '6-series' },
      { brand: 'BMW', model: '6-series Gran Coupe' },
      { brand: 'BMW', model: '7-series' },
      { brand: 'BMW', model: '7-Series 745e' },
      { brand: 'BMW', model: 'ActiveHybrid 5' },
      { brand: 'BMW', model: 'M5' },
      { brand: 'BMW', model: 'X3' },
      { brand: 'BMW', model: 'X4' },
      { brand: 'BMW', model: 'X5' },
      { brand: 'BMW', model: 'X6' },
      { brand: 'BMW', model: 'X7' },
      { brand: 'BYD', model: 'e5' },
      { brand: 'BYD', model: 'e6' },
      { brand: 'BYD', model: 'Tang' },
      { brand: 'Cadillac', model: 'DeVille' },
      { brand: 'Cadillac', model: 'Eldorado' },
      { brand: 'Cadillac', model: 'Escalade' },
      { brand: 'Cadillac', model: 'Seville' },
      { brand: 'Champion', model: 'Defender' },
      { brand: "Chang'an Suzuki", model: 'S-Cross' },
      { brand: 'Chery', model: 'A5' },
      { brand: 'Chery', model: 'A6' },
      { brand: 'Chery', model: 'Arrizo 3' },
      { brand: 'Chery', model: 'Arrizo 7' },
      { brand: 'Chery', model: 'Arrizo M7' },
      { brand: 'Chery', model: 'Grand Tiggo' },
      { brand: 'Chery', model: 'Tiggo 4' },
      { brand: 'Chevrolet', model: 'Grand Vitara' },
      { brand: 'Chevrolet', model: 'Malibu' },
      { brand: 'Chrysler', model: '300' },
      { brand: 'Chrysler', model: 'Town and Country' },
      { brand: 'Citroen', model: 'DS5' },
      { brand: 'Demak', model: 'Civic' },
      { brand: 'Dodge', model: 'Caravan' },
      { brand: 'Dodge', model: 'Grand Caravan' },
      { brand: 'Hawtai', model: 'Santa Fe' },
      { brand: 'Holden', model: 'Cruze' },
      { brand: 'Holden', model: 'Equinox' },
      { brand: 'Holden', model: 'Malibu' },
      { brand: 'Holden', model: 'Trailblazer' },
      { brand: 'Hyundai', model: 'Genesis' },
      { brand: 'Hyundai', model: 'IONIQ 5' },
      { brand: 'Hyundai', model: 'IONIQ 6' },
      { brand: 'Hyundai', model: 'IONIQ Electric' },
      { brand: 'Hyundai', model: 'Kona Electric' },
      { brand: 'Hyundai', model: 'Santa Fe Sport' },
      { brand: 'JAC Motors', model: 'A-Class' },
      { brand: 'JAC Motors', model: 'HFC' },
      { brand: 'JAC Motors', model: 'iEV 40' },
      { brand: 'JAC Motors', model: 'J3 Turin' },
      { brand: 'JAC Motors', model: 'J4' },
      { brand: 'JAC Motors', model: 'T8' },
      { brand: 'Jaguar', model: 'E-PACE' },
      { brand: 'Jaguar', model: 'XE' },
      { brand: 'Jaguar', model: 'XF' },
      { brand: 'Jaguar', model: 'XJ' },
      { brand: 'Jeep', model: 'Cherokee' },
      { brand: 'Jeep', model: 'Grand Cherokee' },
      { brand: 'Jeep', model: 'Wrangler' },
      { brand: 'Joylong', model: 'A6' },
      { brand: 'Keyton', model: 'V60' },
      { brand: 'Kia', model: 'Cadenza' },
      { brand: 'Kia', model: 'Mohave' },
      { brand: 'Land Rover', model: 'Defender' },
      { brand: 'Land Rover', model: 'Discovery' },
      { brand: 'Land Rover', model: 'LR2' },
      { brand: 'Land Rover', model: 'LR3' },
      { brand: 'Land Rover', model: 'LR4' },
      { brand: 'Land Rover', model: 'Range Rover' },
      { brand: 'Land Rover', model: 'Range Rover Sport' },
      { brand: 'Land Rover', model: 'Range Rover Velar' },
      { brand: 'Land Rover', model: 'Range Rover Vogue' },
      { brand: 'Landwind', model: 'X2' },
      { brand: 'Landwind', model: 'X5' },
      { brand: 'Landwind', model: 'X6' },
      { brand: 'Landwind', model: 'X7' },
      { brand: 'Lexus', model: 'NX' },
      { brand: 'Lexus', model: 'RX' },
      { brand: 'Lifan', model: 'X7' },
      { brand: 'Maruti Suzuki', model: 'Grand Vitara' },
      { brand: 'Maruti Suzuki', model: 'S-Cross' },
      { brand: 'Mercedes-Benz', model: 'B-Class' },
      { brand: 'Mercedes-Benz', model: 'E 220' },
      { brand: 'Mercedes-Benz', model: 'E-Class' },
      { brand: 'Mercedes-Benz', model: 'E-Class Wagon' },
      { brand: 'Mercedes-Benz', model: 'GLE-Class' },
      { brand: 'Mercedes-Benz', model: 'M-Class' },
      { brand: 'Mercedes-Benz', model: 'ML Class' },
      { brand: 'Mercedes-Benz', model: 'S-Class' },
      { brand: 'Mitsubishi', model: 'Airtrek' },
      { brand: 'Mitsubishi', model: 'Pajero Full' },
      { brand: 'Nissan', model: 'Altima' },
      { brand: 'Nissan', model: 'Pathfinder' },
      { brand: 'Peugeot', model: '5008' },
      { brand: 'Porsche', model: 'Cayenne' },
      { brand: 'Shineray', model: 'X7' },
      { brand: 'Ssangyong', model: 'Korando' },
      { brand: 'Ssangyong', model: 'XLV' },
      { brand: 'Subaru', model: 'Impreza' },
      { brand: 'Subaru', model: 'XV Crosstrek' },
      { brand: 'Suzuki', model: 'Grand Vitara' },
      { brand: 'Toyota', model: 'Camry Hybrid' },
      { brand: 'Toyota', model: 'Corolla Ceres' },
      { brand: 'Toyota', model: 'Corolla EX' },
      { brand: 'Toyota', model: 'Sienna' },
      { brand: 'Toyota', model: 'SW4' },
      { brand: 'Volkswagen', model: 'Jetta GLI' },
      { brand: 'Volkswagen', model: 'Jetta SportWagen' },
      { brand: 'Volkswagen', model: 'Touareg' },
      { brand: 'Volkswagen', model: 'Virtus' }, // ano mínimo 2025
      { brand: 'Volvo', model: 'S40' },
      { brand: 'Volvo', model: 'S70' },
      { brand: 'Volvo', model: 'S80' },
      { brand: 'Volvo', model: 'S90' },
      { brand: 'Volvo', model: 'V40' },
      { brand: 'Volvo', model: 'V50' },
      { brand: 'Volvo', model: 'V70' },
      { brand: 'Volvo', model: 'XC70' },
      { brand: 'Zotye', model: '5008' },
      { brand: 'Citroen', model: 'Basalt' },
    ];

    const eliteColors = ['preto', 'chumbo', 'prata', 'cinza', 'azul marinho', 'marrom', 'branco'];

    // [2] Função para classificar o tipo
    function classifyCarType(brand, model, year, color) {
      // Exceção: Virtus só Elite se ano >= 2025
      if (brand.trim().toLowerCase() === 'volkswagen' && model.trim().toLowerCase() === 'virtus') {
        if (parseInt(year) >= 2025 && eliteColors.includes(color.trim().toLowerCase())) return 'Leaf Elite';
        else return 'Leaf Plus';
      }
      // Busca na lista Elite
      const isElite = eliteList.some(item => item.brand.trim().toLowerCase() === brand.trim().toLowerCase() && item.model.trim().toLowerCase() === model.trim().toLowerCase());
      if (isElite && parseInt(year) >= 2016 && eliteColors.includes(color.trim().toLowerCase())) return 'Leaf Elite';
      if (parseInt(year) >= 2015) return 'Leaf Plus';
      return null; // Não atende ao mínimo
    }

    // [3] Estado para carType
    const [carType, setCarType] = useState('');

    // [4] Atualizar carType automaticamente
    useEffect(() => {
      if (state.vehicleMake && state.vehicleModel && year && color) {
        const tipo = classifyCarType(state.vehicleMake, state.vehicleModel, year, color);
        setCarType(tipo || '');
      } else {
        setCarType('');
      }
    }, [state.vehicleMake, state.vehicleModel, year, color]);

    const { t } = i18n;
    const isRTL = i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0;
    const dispatch = useDispatch();
    const carlistdata = useSelector(state => state.carlistdata);
    const cartypes = useSelector(state => state.cartypes.cars);
    const settings = useSelector(state => state.settingsdata.settings);
    const auth = useSelector(state => state.auth);
    const [carTypes, setCarTypes] = useState(null);
    const [loading, setLoading] = useState(false);
    const [capturedImage, setCapturedImage] = useState(null);
    const actionSheetRef = useRef(null);
    const [cars, setCars] = useState({});
    const [updateCalled, setUpdateCalled] = useState(false);
    // [1] Novo estado para ano e CRLV
    const [year, setYear] = useState(car && car.year ? car.year : '');
    const [crlvImage, setCrlvImage] = useState(car && car.crlv_image ? car.crlv_image : null);
    const [crlvBlob, setCrlvBlob] = useState();
    // [1] Novo estado para cor do carro
    const [color, setColor] = useState(car && car.color ? car.color : '');

    const car = props.route.params && props.route.params.car ? props.route.params.car : null;

    const [state, setState] = useState({
        car_image: car && car.car_image ? car.car_image : null,
        vehicleNumber: car && car.vehicleNumber ? car.vehicleNumber : null,
        vehicleMake: car && car.vehicleMake ? car.vehicleMake : null,
        vehicleModel: car && car.vehicleModel ? car.vehicleModel : null,
        carType: car && car.carType ? car.carType : null,
        other_info: car && car.other_info ? car.other_info : "",
        approved: car && car.approved ? car.approved : null,
        active: car && car.active ? car.active : null
    });

    const [blob, setBlob] = useState();
    const pickerRef1 = React.createRef();

    useEffect(() => {
        if (cartypes) {
            let arr = [];
            const sorted = cartypes.sort((a, b) => a.pos - b.pos);
            for (let i = 0; i < sorted.length; i++) {
                arr.push({ label: t(getLangKey(sorted[i].name)), value: sorted[i].name });
            }
            if (arr.length > 0) {
                setState({ ...state, carType: arr[0].value })
            }
            setCarTypes(arr);
        }
    }, [cartypes]);

    useEffect(() => {
        if (carlistdata.cars) {
            setCars(carlistdata.cars);
            if (updateCalled) {
                setLoading(false);
                Alert.alert(
                    t('alert'),
                    t('profile_updated'),
                    [
                        { text: t('ok'), onPress: () => { props.navigation.goBack() } }
                    ],
                    { cancelable: true }
                );
                setUpdateCalled(false);
            }
        } else {
            setCars([]);
        }
    }, [carlistdata.cars, updateCalled]);

    const showActionSheet = () => {
        actionSheetRef.current?.setModalVisible(true);
    }

    const uploadImage = () => {
        return (
            <ActionSheet ref={actionSheetRef}>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderColor: colors.CONVERTDRIVER_TEXT, borderBottomWidth: 1, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('CAMERA', ImagePicker.launchCameraAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT,fontFamily:fonts.Bold }}>{t('camera')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, borderBottomWidth: 1, borderColor: colors.CONVERTDRIVER_TEXT, height: 60, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { _pickImage('MEDIA', ImagePicker.launchImageLibraryAsync) }}
                >
                    <Text style={{ color: colors.CAMERA_TEXT,fontFamily:fonts.Bold}}>{t('medialibrary')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ width: '90%', alignSelf: 'center', paddingLeft: 20, paddingRight: 20, height: 50, alignItems: 'center', justifyContent: 'center' }}
                    onPress={() => { actionSheetRef.current?.setModalVisible(false); }}>
                    <Text style={{ color: 'red',fontFamily:fonts.Bold }}>{t('cancel')}</Text>
                </TouchableOpacity>
            </ActionSheet>
        )
    }

    const _pickImage = async (permissionType, res) => {
        var pickFrom = res;
        let permisions;
        if (permissionType == 'CAMERA') {
            permisions = await ImagePicker.requestCameraPermissionsAsync();
        } else {
            permisions = await ImagePicker.requestMediaLibraryPermissionsAsync();
        }
        const { status } = permisions;

        if (status == 'granted') {

            let result = await pickFrom({
                allowsEditing: true,
                aspect: [4, 3]
            });

            actionSheetRef.current?.setModalVisible(false);

            if (!result.canceled) {
                setCapturedImage(result.assets[0].uri);
                const blob = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function () {
                        resolve(xhr.response);
                    };
                    xhr.onerror = function () {
                        Alert.alert(t('alert'), t('image_upload_error'));
                    };
                    xhr.responseType = 'blob';
                    xhr.open('GET', result.assets[0].uri, true);
                    xhr.send(null);
                });
                setBlob(blob);
            }
        } else {
            Alert.alert(t('alert'), t('camera_permission_error'))
        }
    }

    const cancelPhoto = () => {
        setCapturedImage(null);
    }

    // [2] Função para upload do CRLV
    const showCrlvActionSheet = async () => {
        let permisions = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permisions.status === 'granted') {
            let result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3] });
            if (!result.canceled) {
                setCrlvImage(result.assets[0].uri);
                const blob = await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.onload = function () { resolve(xhr.response); };
                    xhr.onerror = function () { Alert.alert(t('alert'), t('image_upload_error')); };
                    xhr.responseType = 'blob';
                    xhr.open('GET', result.assets[0].uri, true);
                    xhr.send(null);
                });
                setCrlvBlob(blob);
            }
        } else {
            Alert.alert(t('alert'), t('camera_permission_error'));
        }
    };

    // [3] Validação no onSave
    const onSave = () => {
        if (!state.vehicleMake || !state.vehicleModel || !year || !color) {
            Alert.alert(t('alert'), t('no_details_error'));
            return;
        }
        if (!carType) {
            Alert.alert(t('alert'), 'Ano mínimo para cadastro: 2015 para Leaf Plus, 2016 para Leaf Elite. Verifique também a cor.');
            return;
        }
        if (!blob) {
            Alert.alert(t('alert'), t('proper_input_image'));
            return;
        }
        if (!crlvBlob) {
            Alert.alert(t('alert'), 'Envie a imagem do documento CRLV do veículo');
            return;
        }
        setLoading(true);
        setUpdateCalled(true);
        let activeCar = null;
        let newData = { ...state };
        newData.driver = auth.profile.uid;
        newData.year = year;
        newData.color = color;
        newData.carType = carType;
        for (let i = 0; i < cars.length; i++) {
            if (cars[i].active) {
                activeCar = cars[i];
                break;
            }
        }
        if (activeCar && state.active) {
            activeCar.active = false;
            dispatch(editCar(activeCar, "Update"));
        } else if (activeCar && !newData.active) {
            newData.active = false;
        } else {
            newData.active = true;
        }
        newData['createdAt'] = new Date().getTime();
        newData['fleetadmin'] = auth.profile && auth.profile.fleetadmin ? auth.profile.fleetadmin : null;
        if (!settings.carApproval) {
            newData['approved'] = true;
        } else {
            newData['approved'] = false;
        }
        dispatch(updateUserCarWithImage({ ...newData, crlv_image: null }, blob, crlvBlob));
    };

    const makeActive = () => {
        setLoading(true);
        let activeCar = null;
        for (let i = 0; i < cars.length; i++) {
            if (cars[i].active && cars[i].id != car.id) {
                activeCar = cars[i];
                break;
            }
        }
        if (activeCar) {
            activeCar.active = false;
            dispatch(editCar(activeCar, "Update"));
        }
        car.active = true;
        dispatch(editCar(car, "Update"));
        let updateData = {
            carType: car.carType,
            vehicleNumber: car.vehicleNumber,
            vehicleMake: car.vehicleMake,
            vehicleModel: car.vehicleModel,
            other_info: car.other_info ? car.other_info : "",
            car_image: car.car_image,
            carApproved: car.approved,
            updateAt: new Date().getTime()
        };
        dispatch(updateUserCar(auth.profile.uid, updateData));
        props.navigation.goBack()
    }

    const RemoteImage = ({ uri, desiredWidth }) => {
        const [desiredHeight, setDesiredHeight] = useState(0);
        Image.getSize(uri, (width, height) => setDesiredHeight(desiredWidth / width * height));
        return <Image source={{ uri }} style={{ width: desiredWidth, height: desiredHeight }} />
    }
    const [vehicleTypeFocus, setvehicleTypeFocus] = useState(false)
    const [vehicleNameFocus, setvehicleNameFocus] = useState(false)
    const [vehicleModelFocus, setvehicleModelFocus] = useState(false)
    const [vehicleregistrationFocus, setvehicleregistrationFocus] = useState(false)
    const [vehicleInfoFocus, setvehicleInfoFocus] = useState(false)

    return (
        <View style={{ flex: 1 }}>
            {/* <Footer/> */}
            <View style={{ flex: 1, position: 'absolute', backgroundColor: colors.WHITE, height: '100%', width: '100%' }}>
                <KeyboardAvoidingView style={styles.form} behavior={Platform.OS == "ios" ? "padding" : (__DEV__ ? null : "padding")} keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}>
                    <ScrollView style={styles.scrollViewStyle} showsVerticalScrollIndicator={false}>
                        {
                            uploadImage()
                        }
                        <View style={styles.containerStyle}>
                            <View style={styles.containerStyle}>
                                {state.car_image ?
                                    <View style={{ alignSelf: 'center', marginVertical: 10,  }}>
                                        <RemoteImage
                                            uri={state.car_image}
                                            desiredWidth={width * 0.8}
                                        />
                                    </View>
                                    :
                                    capturedImage ?
                                        <View style={styles.imagePosition}>
                                            <TouchableOpacity style={styles.photoClick} onPress={cancelPhoto}>
                                                <Image source={require('../../assets/images/cross.png')} resizeMode={'contain'} style={styles.imageStyle} />
                                            </TouchableOpacity>
                                            <Image source={{ uri: capturedImage }} style={styles.photoResult} resizeMode={'cover'} />
                                        </View>
                                        :
                                        <View style={styles.capturePhoto}>
                                            <View>
                                                <Text style={[styles.capturePhotoTitle, styles.fontStyle]}>{t('upload_car_image')}</Text>
                                            </View>
                                            <View style={[styles.capturePicClick, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <TouchableOpacity style={styles.flexView1} onPress={showActionSheet}>
                                                    <View>
                                                        <View style={styles.imageFixStyle}>
                                                            <AntDesign name="clouduploado" size={100} color={MAIN_COLOR} style={styles.imageStyle2} />
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                }

                                { car && car.id ? 
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        value={t(getLangKey(car.carType))}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                    />
                                </View>
                                :
                                <View style={[styles.textInputContainerStyle, { borderColor: colors.FOOTERTOP, borderWidth: 1, borderRadius: 10, }, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>

                                    {carTypes ?
                                        <View style={[{ width: "100%", height: "100%", paddingLeft: isRTL ? 0 : 10, paddingRight: isRTL ? 10 : 0, alignItems: 'center', position: 'relative' }, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                            <RNPickerSelect
                                                pickerRef={pickerRef1}
                                                placeholder={{}} 
                                                value={car && car.carType ? car.carType : state.carType}
                                                useNativeAndroidPickerStyle={false}
                                                style={{
                                                    inputIOS: [styles.pickerStyle, styles.fontBoldStyle, { alignSelf: isRTL ? 'flex-end' : 'flex-start', textAlign: isRTL ? 'right' : 'left' }],
                                                    placeholder: {
                                                        color: '#2a383b'
                                                    },
                                                    inputAndroid: [styles.pickerStyle, styles.fontBoldStyle, { alignSelf: isRTL ? 'flex-end' : 'flex-start', textAlign: isRTL ? 'right' : 'left' }]
                                                }}
                                                onTap={() => { pickerRef1.current.focus() }}
                                                onValueChange={(value) => setState({ ...state, carType: value })}
                                                items={carTypes}
                                                Icon={() => { return <Ionicons
                                                    style={{
                                                        left: -10,
                                                        top: '100%',
                                                        transform: [{ translateY: -13 }],
                                                        marginLeft: isRTL ? 10 : 0,
                                                        marginRight: isRTL ? 0 : 10,
                                                    }}
                                                    name="arrow-down-outline"
                                                    size={26}
                                                    color="gray"
                                                />; }}
                                            />
                                        </View>
                                : null}
                                </View>
                                }
                                
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        onFocus={() => setvehicleNameFocus(!vehicleNameFocus)}
                                        onBlur={() => setvehicleNameFocus(!vehicleNameFocus)}
                                        placeholder={t('vehicle_model_name')}
                                        value={state.vehicleMake}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setState({ ...state, vehicleMake: text }) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        placeholder={t('vehicle_model_no')}
                                        value={state.vehicleModel}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setState({ ...state, vehicleModel: text }) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        placeholder={t('vehicle_reg_no')}
                                        value={state.vehicleNumber}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 10 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setState({ ...state, vehicleNumber: text }) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        placeholder={t('other_info')}
                                        value={state.other_info}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setState({ ...state, other_info: text }) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}> 
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        placeholder={'Ano do veículo (ex: 2020)'}
                                        value={year}
                                        keyboardType="numeric"
                                        maxLength={4}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setYear(text.replace(/[^0-9]/g, '')) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' }]}> 
                                    <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={showCrlvActionSheet} disabled={car && car.id ? true : false}>
                                        <Text style={[styles.fontBoldStyle, { color: crlvImage ? MAIN_COLOR : colors.PLACEHOLDER_COLOR }]}>
                                            {crlvImage ? 'Documento CRLV enviado' : 'Enviar documento CRLV'}
                                        </Text>
                                        {crlvImage && <Ionicons name="checkmark-circle" size={22} color={MAIN_COLOR} style={{ marginLeft: 8 }} />}
                                    </TouchableOpacity>
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}> 
                                    <TextInput
                                        editable={car && car.id ? false : true}
                                        placeholder={'Cor do veículo'}
                                        value={color}
                                        textAlign={isRTL ? 'right' : 'left'}
                                        style={[styles.inPutFieldStyle, styles.fontBoldStyle, { paddingRight: isRTL ? 15 : 0 }]}
                                        placeholderTextColor={colors.PLACEHOLDER_COLOR}
                                        onChangeText={(text) => { setColor(text) }}
                                    />
                                </View>
                                <View style={[styles.textInputContainerStyle, { flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' }]}> 
  <Text style={[styles.fontBoldStyle, { color: carType === 'Leaf Elite' ? MAIN_COLOR : (carType === 'Leaf Plus' ? colors.HEADER : colors.RED), fontSize: 16 }]}> 
    {carType ? `Tipo: ${carType}` : 'Preencha todos os dados para classificar o tipo'}
  </Text>
</View>
                                <View style={styles.buttonContainer}>
                                    {!car ?

                                        <Button
                                            btnClick={onSave}
                                            title={t('save')}
                                            loading={false}
                                            loadingColor={{ color: colors.WHITE }}
                                            style={[styles.registerButton, loading === true ? styles.registerButtonClicked : styles.registerButton]}
                                            buttonStyle={[styles.buttonTitle, styles.fontBoldStyle]}
                                        />

                                        : null}
                                    {car && car.id && !car.active ?

                                        <Button
                                            btnClick={makeActive}
                                            title={t('make_active')}
                                            loading={false}
                                            loadingColor={{ color: colors.WHITE }}
                                            style={ [styles.registerButton, loading === true ? styles.registerButtonClicked : styles.registerButton]}
                                            buttonStyle={[styles.buttonTitle, styles.fontBoldStyle]}
                                        />
                                        :
                                        null}
                                    {loading === true ?
                                        <ActivityIndicator size="large" color={MAIN_COLOR} style={styles.loader} />
                                        : null
                                    }
                                </View>
                            </View>
                        </View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </View>
        </View>
    );

}

const styles = StyleSheet.create({
    mainView: {
        flex: 1,
        backgroundColor: colors.BLACK
    },
    inputContainerStyle: {
        width: "100%",
    },
    vew1: {
        height: '100%',
        borderBottomRightRadius: 120,
        overflow: 'hidden',
        backgroundColor: colors.WHITE,
    },
    iconContainer: {
        width: '15%',
        alignItems: 'center'
    },
    vew: {
        borderTopLeftRadius: 130,
        height: '100%',
        alignItems: 'flex-end'
    },
    gapView: {
        height: 40,
        width: '100%'
    },

    registerButton: {
        backgroundColor: MAIN_COLOR,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: 'center',
        width: '95%'
    },
    registerButtonClicked: {
        backgroundColor: colors.WHITE,
        borderWidth: 1,
        borderColor: MAIN_COLOR,
        width: '95%'
    },

    buttonTitle: {
        fontSize: 18,
        color: colors.WHITE,
        paddingVertical: 5,
    },
    buttonClickedTitle: {

    },
    pickerStyle: {
        color: colors.HEADER,
        fontSize: 15,
        height: "100%",
        minWidth: "100%",


    },
    inputTextStyle: {
        color: colors.BLACK,
        fontSize: 13,
        marginLeft: 0,
        height: 32,
    },
    errorMessageStyle: {
        fontSize: 12,
        fontWeight: 'bold',
        marginLeft: 0
    },
    containerStyle: {
        flexDirection: 'column',
        width: '100%',
        backgroundColor: colors.WHITE,
        gap: 5,
        alignItems: 'center'
    },
    form: {
        flex: 1,
    },
    logo: {
        width: '100%',
        justifyContent: "center",
        height: '10%',
        borderBottomRightRadius: 150,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 5,
        },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 3,
        marginBottom: 2,
    },
    scrollViewStyle: {
        height: height
    },
    fontStyle: {
        fontFamily:fonts.Regular
    },
    fontBoldStyle: {
        fontFamily: fonts.Bold
    },
    textInputContainerStyle: {
        width: '95%',
        height: 60,
        marginVertical: 10,
        alignItems: 'center',
        justifyContent: "center"
    },
    inPutFieldStyle: {
        width: "100%",
        height: "100%",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.FOOTERTOP,
        fontSize: 14,
        paddingLeft:15
    },
    inputFocused: {
        width: "100%",
        height: "100%",
        borderRadius: 10,
        borderWidth: 0.2,
        borderBlockColor: MAIN_COLOR,
        fontSize: 15,
        paddingLeft: 15,
    },
    headerStyle: {
        fontSize: 25,
        color: colors.WHITE,
        flexDirection: 'row',
    },
    capturePhoto: {
        width: '95%',
        height: 180,
        alignSelf: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: 10,
        marginTop: 15,
        borderWidth: 0.8
    },
    capturePhotoTitle: {
        color: colors.BLACK,
        fontSize: 16,
        textAlign: 'center',
        paddingBottom: 15,

    },
    errorPhotoTitle: {
        color: colors.RED,
        fontSize: 13,
        textAlign: 'center',
        paddingBottom: 15,
    },
    photoResult: {
        alignSelf: 'center',
        flexDirection: 'column',
        justifyContent: 'center',
        borderRadius: 10,
        marginLeft: 20,
        paddingTop: 15,
        marginRight: 20,
        paddingBottom: 10,
        marginTop: 15,
        width: '95%',
        height: height / 4,
    },
    imagePosition: {
        position: 'relative',
        width: "100%",
    },
    photoClick: {
        paddingRight: 35,
        position: 'absolute',
        zIndex: 1,
        marginTop: 18,
        alignSelf: 'flex-end'
    },
    capturePicClick: {
        backgroundColor: colors.WHITE,
        justifyContent: "center",
        flexDirection: 'row',
        position: 'relative',
        zIndex: 1
    },
    imageStyle: {
        width: 25,
        height: 25,
    },
    flexView1: {

        width: "100%",
        height: "100%"
    },
    imageFixStyle: {
        alignItems: 'center',
        justifyContent: 'center'
    },
    imageStyle2: {
        opacity: 0.6
    },
    myView: {
        flex: 2,
        height: 50,
        width: 1,
        alignItems: 'center'
    },
    myView1: {
        height: height / 18,
        width: 1.5,
        backgroundColor: colors.CONVERTDRIVER_TEXT,
        alignItems: 'center',
        marginTop: 10
    },
    myView2: {
        flex: 20,
        alignItems: 'center',
        justifyContent: 'center'
    },
    myView3: {
        flex: 2.2,
        alignItems: 'center',
        justifyContent: 'center'
    },
    loader: {
        position: 'absolute'
    },
    buttonContainer: {
        width: "100%",
        alignItems: "center",
        justifyContent: 'center',
        marginBottom: 12,
        position: "relative",
    },

});
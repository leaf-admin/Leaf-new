import Logger from '../utils/Logger';
import React, { useEffect, useState, useRef } from 'react';
import { Text, View, StyleSheet, Dimensions, FlatList, Modal, TouchableHighlight, Switch, Image, Platform, Linking, TouchableOpacity, KeyboardAvoidingView, StatusBar } from 'react-native';
import { Button, Icon } from 'react-native-elements';
import MapView, { Polyline, PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { colors } from '../common/theme';
import i18n from '../i18n';
import { useDispatch, useSelector } from 'react-redux';
import { api } from '../common-local/api';
import { Alert } from 'react-native';
import moment from 'moment/min/moment-with-locales';
import carImageIcon from '../../assets/images/track_Car.png';
var { width, height } = Dimensions.get('window');
import { CommonActions } from '@react-navigation/native';
import { ExtraInfo, RateView, appConsts, MAIN_COLOR, SECONDORY_COLOR } from '../common/sharedFunctions';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startActivityAsync, ActivityAction } from 'expo-intent-launcher';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../common/font';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Typography from '../components/design-system/Typography';
import AnimatedButton from '../components/design-system/AnimatedButton';
import { useTheme } from '../common-local/theme';


export default function DriverTrips(props) {
    const {
        acceptTask,
        cancelTask,
        updateProfile,
        updateBooking,
        fetchTasks,
        RequestPushMsg
    } = api;
    const dispatch = useDispatch();
    const tasks = useSelector(state => state.taskdata.tasks);
    const settings = useSelector(state => state.settingsdata.settings) || {};
    const auth = useSelector(state => state.auth);
    const bookinglistdata = useSelector(state => state.bookinglistdata);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [activeBookings, setActiveBookings] = useState([]);
    const [region, setRegion] = useState(null);
    const gps = useSelector(state => state.gpsdata);
    const latitudeDelta = 0.0922;
    const longitudeDelta = 0.0421;
    // Função de tradução segura com fallback
    const t = (key) => {
        try {
            if (i18n && typeof i18n.t === 'function') {
                return i18n.t(key);
            } else if (i18n && i18n[key]) {
                return i18n[key];
            }
            // Fallback para chaves comuns
            const commonTranslations = {
                'on_duty': 'Em serviço',
                'where_are_you': 'Onde você está',
                'rider_not_here': 'Aguardando passageiro',
                'service_off': 'Serviço desativado',
                'location_permission_error': 'Erro de permissão de localização',
                'loading': 'Carregando...',
                'pickup_location': 'Local de embarque',
                'drop_location': 'Local de destino',
                'go_to_booking': 'Ir para reserva',
                'ignore_text': 'Ignorar',
                'accept': 'Aceitar',
                'today_text': 'Hoje',
                'rides': 'viagens',
                'alert': 'Alerta',
                'alert_text': 'Alerta',
                'ignore_job_title': 'Tem certeza que deseja ignorar esta corrida?',
                'cancel': 'Cancelar',
                'ok': 'OK',
                'modal_close': 'Fechar',
                'always_on': 'GPS sempre ativado',
                'fix': 'Corrigir',
                'no_car_assign_text': 'Nenhum carro atribuído',
                'cars': 'Carros',
                'carApproved_by_admin': 'Carro aprovado pelo administrador',
                'upload_driving_license': 'Enviar CNH',
                'profile': 'Perfil',
                'admin_contact': 'Entre em contato com o administrador',
                'driver_active': 'Motorista ativo',
                'make_active': 'Ativar',
                'upload_id_details': 'Enviar detalhes de ID',
                'term_condition': 'Termos e condições',
                'km': 'km',
                'mile': 'milhas',
                'mins': 'min',
            };
            return commonTranslations[key] || key;
        } catch (error) {
            Logger.error('Erro na função t:', error);
            return key;
        }
    };

    const isRTL = (i18n && i18n.locale && typeof i18n.locale === 'string')
        ? (i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0)
        : false;
    const [amount, setAmount] = useState({});
    const pageActive = useRef();
    const [deviceId, setDeviceId] = useState();
    const [totalEarning, setTotalEarning] = useState(0);
    const [today, setToday] = useState(0);
    const [thisMonth, setThisMonth] = useState(0);
    const [bookingCount, setBookingCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const insets = useSafeAreaInsets();
    useEffect(() => {
        if (auth?.profile) {
            setChecks(prevChecks => ({
                ...prevChecks,
                driverActiveStatus: auth.profile.driverActiveStatus ? true : false
            }));
        }
    }, [auth?.profile?.driverActiveStatus])

    // Processar bookings apenas quando realmente mudarem
    const bookingsRef = useRef(null);
    const lastBookingsLength = useRef(0);

    useEffect(() => {
        const bookings = bookinglistdata?.bookings;
        const bookingsLength = bookings?.length || 0;
        const decimalValue = settings?.decimal || 2;

        // Só processar se realmente mudou
        if (bookingsLength === lastBookingsLength.current && bookingsRef.current === bookings) {
            return;
        }

        lastBookingsLength.current = bookingsLength;
        bookingsRef.current = bookings;

        if (bookings && bookingsLength > 0) {
            let today = new Date();
            let tdTrans = 0;
            let mnTrans = 0;
            let totTrans = 0;
            let count = 0;

            for (let i = 0; i < bookings.length; i++) {
                if (bookings[i].status === 'PAID' || bookings[i].status === 'COMPLETE') {
                    const { tripdate, driver_share } = bookings[i];
                    if (tripdate && driver_share != undefined) {
                        let tDate = new Date(tripdate);
                        if (tDate.getDate() === today.getDate() && tDate.getMonth() === today.getMonth()) {
                            tdTrans = tdTrans + parseFloat(driver_share);
                            count = count + 1;
                        }
                        if (tDate.getMonth() === today.getMonth() && tDate.getFullYear() === today.getFullYear()) {
                            mnTrans = mnTrans + parseFloat(driver_share);
                        }
                        totTrans = totTrans + parseFloat(driver_share);
                    }
                }
            }

            setTotalEarning(parseFloat(totTrans.toFixed(decimalValue)));
            setToday(parseFloat(tdTrans.toFixed(decimalValue)));
            setThisMonth(parseFloat(mnTrans.toFixed(decimalValue)));
            setBookingCount(count);

            const active = bookings.filter(booking =>
                booking.status == 'ACCEPTED' ||
                booking.status == 'ARRIVED' ||
                booking.status == 'STARTED' ||
                booking.status == 'REACHED'
            );
            setActiveBookings(active);
        } else {
            // Sem dados, mas mostrar estrutura
            setTotalEarning(0);
            setToday(0);
            setThisMonth(0);
            setBookingCount(0);
            setActiveBookings([]);
        }
    }, [bookinglistdata?.bookings, settings?.decimal])

    const onPressAccept = (item, price) => {
        let wallet_balance = parseFloat(auth.profile.walletBalance);
        if ((settings?.imageIdApproval && auth.profile.verifyId && auth.profile.verifyIdImage) || (!settings?.imageIdApproval)) {
            if (!settings?.negativeBalance && !settings?.disable_cash && (wallet_balance <= 0 || (wallet_balance > 0 && wallet_balance < item.convenience_fees)) && item.payment_mode === 'cash') {
                Alert.alert(
                    t('alert'),
                    t('wallet_balance_low')
                );
            } else if (settings?.negativeBalance && settings?.driverThreshold && settings?.driverThreshold >= wallet_balance) {
                Alert.alert(
                    t('alert'),
                    t('wallet_balance_threshold_reached')
                );
            } else if (appConsts.acceptWithAmount || item.deliveryWithBid) {
                if (item && item.customer_offer && !settings?.coustomerBidPrice && !parseFloat(price)) {
                    price = item.customer_offer;
                }
                if (parseFloat(price) > 0) {
                    const profile = auth.profile;
                    let convenience_fees = item.commission_type == 'flat' ? parseFloat(item.commission_rate) : (parseFloat(price) * parseFloat(item.commission_rate) / 100);
                    let fleetCommissione_fees = profile.fleetadmin ? ((parseFloat(price) - parseFloat(convenience_fees)) * parseFloat(item.fleet_admin_comission) / 100).toFixed(2) : 0;
                    if (wallet_balance < convenience_fees && !settings?.negativeBalance) {
                        Alert.alert(
                            t('alert'),
                            t('wallet_balance_low')
                        );
                    } else if (settings?.negativeBalance && settings?.driverThreshold && settings?.driverThreshold >= wallet_balance) {
                        Alert.alert(
                            t('alert'),
                            t('wallet_balance_threshold_reached')
                        );
                    } else {
                        let obj = {};
                        obj.driver = auth.profile.uid;
                        obj.driver_image = profile.profile_image ? profile.profile_image : "";
                        obj.car_image = profile.car_image ? profile.car_image : "";
                        obj.driver_name = profile.firstName + ' ' + profile.lastName;
                        obj.driver_contact = profile.mobile;
                        obj.driver_token = profile.pushToken ? profile.pushToken : '';
                        obj.vehicle_number = profile.vehicleNumber ? profile.vehicleNumber : "";
                        obj.vehicleModel = profile.vehicleModel ? profile.vehicleModel : "";
                        obj.vehicleMake = profile.vehicleMake ? profile.vehicleMake : "";
                        obj.driverRating = profile.rating ? profile.rating : "0";
                        obj.fleetadmin = profile.fleetadmin ? profile.fleetadmin : '';
                        obj.fleetCommission = fleetCommissione_fees ? fleetCommissione_fees : null;
                        obj.bidPrice = price;
                        obj.trip_cost = parseFloat(price).toFixed(2);
                        obj.convenience_fees = convenience_fees.toFixed(2);
                        obj.driver_share = parseFloat(parseFloat(price) - parseFloat(fleetCommissione_fees) - parseFloat(convenience_fees)).toFixed(2);
                        obj.car_image = profile.car_image ? profile.car_image : "";
                        obj.driverDeviceId = deviceId;
                        if (!item.driverOffers) {
                            item.driverOffers = {};
                        }
                        item.driverOffers[auth.profile.uid] = obj;
                        let allAmts = { ...amount };
                        allAmts[item.id] = 0;
                        setAmount(allAmts);
                        dispatch(updateBooking(item));
                        if (item.customer_token) {
                            RequestPushMsg(
                                item.customer_token,
                                {
                                    title: t('notification_title'),
                                    msg: t('start_accept_bid'),
                                    screen: 'BookedCab',
                                    params: { bookingId: item.id }
                                }
                            )
                        }
                    }
                } else {
                    Alert.alert(t('alert'), t('no_details_error'));
                }
            } else {
                item['driverDeviceId'] = deviceId;
                item['vehicle_number'] = auth.profile.vehicleNumber ? auth.profile.vehicleNumber : "";
                dispatch(acceptTask(item));
                setSelectedItem(null);
                setModalVisible(null);
                setTimeout(() => {
                    props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'BookedCab', params: { bookingId: item.id } }] }));
                }, 3000)
            }
        } else {
            Alert.alert(t('alert'), t('verifyid_error'));
        }
    };
    const onPressIgnore = (id) => {
        dispatch(cancelTask(id));
        setSelectedItem(null);
        setModalVisible(null)
    };

    const goToBooking = (id) => {
        props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'BookedCab', params: { bookingId: id } }] }));
    };

    const onChangeFunction = () => {
        if (auth.profile && auth.profile.queue) {
            Alert.alert(t('alert'), t('active_booking_right_now'));
        } else {
            if (gps.error) {
                Alert.alert(t('alert'), t('always_on'));
            } else {
                let res = !auth.profile.driverActiveStatus;
                if (res === true) dispatch(fetchTasks());
                const isDriverActive = auth.profile.driverActiveStatus;
                const action = isDriverActive ? 'off' : 'on';
                if (action === 'on' && settings && settings.license_image_required && !auth.profile.licenseImage) {
                    Alert.alert(t('alert'), t('upload_driving_license'));
                    return;
                }
                if (action === 'on' && settings && settings.term_required && !auth.profile.term) {
                    Alert.alert(t('alert'), t('term_condition'));
                    return;
                }
                if (action === 'on' && settings && settings.imageIdApproval && !auth.profile.verifyIdImage) {
                    Alert.alert(t('alert'), t('upload_id_details'));
                    return;
                }
                if (action === 'on') {
                    if (settings && settings.carType_required) {
                        if (!auth.profile.carType) {
                            Alert.alert(t('alert'), t("no_car_assign_text"));
                            return;
                        }
                        if (settings.carApproval && !auth.profile.carApproved) {
                            Alert.alert(t('alert'), t("carApproved_by_admin"));
                            return;
                        }
                        if (settings.driver_approval && !auth.profile.approved) {
                            Alert.alert(t('alert'), t("admin_contact"));
                            return;
                        }
                    } else {
                        if (settings && settings.driver_approval && !auth.profile.approved) {
                            Alert.alert(t('alert'), t("admin_contact"));
                            return;
                        }
                    }
                }
                dispatch(updateProfile({ driverActiveStatus: !isDriverActive }));
            }
        }
    };

    const onTermAccept = () => {
        if (!auth.profile.term || auth.profile.term === false) {
            dispatch(updateProfile({ term: true }));
            dispatch(fetchTasks());
        }
    }

    const onTermLink = async () => {
        Linking.openURL(settings.CompanyTermCondition).catch(err => Logger.error("Couldn't load page", err));
    }
    useEffect(() => {
        if (gps.location) {
            if (gps.location.lat && gps.location.lng) {
                setRegion({
                    latitude: gps.location.lat,
                    longitude: gps.location.lng,
                    latitudeDelta: latitudeDelta,
                    longitudeDelta: longitudeDelta
                });
            }
        }
    }, [gps.location]);

    useEffect(() => {
        if (gps.error) {
            dispatch(updateProfile({ driverActiveStatus: false }));
            setChecks({ ...checks, driverActiveStatus: false });
        }
    }, [gps.error]);


    const navEditUser = () => {
        props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'editUser', params: { fromPage: 'DriverTrips' } }] }));
    }

    // Header com botão voltar e título (seguindo padrão das outras telas)

    const Header = () => (
        <View style={[styles.headerCustom, { backgroundColor: theme.card, borderBottomWidth: 1, borderBottomColor: theme.border }]}>
            <TouchableOpacity
                style={[
                    styles.headerButtonCustom,
                    {
                        backgroundColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                        borderWidth: 1,
                        borderColor: theme.border,
                    }
                ]}
                onPress={() => props.navigation.goBack()}
                activeOpacity={0.7}
            >
                <Ionicons name="chevron-back" size={22} color={theme.text} />
            </TouchableOpacity>
            <Typography variant="h2" weight="bold" color={theme.text}>
                Histórico de viagens
            </Typography>
            <View style={styles.headerRightContainerCustom} />
        </View>
    );

    // Esconder header do navigation
    React.useEffect(() => {
        props.navigation.setOptions({
            headerShown: false,
        });
    }, [props.navigation]);

    useEffect(() => {
        const unsubscribe = props.navigation.addListener('focus', () => {
            pageActive.current = true;
        });
        return unsubscribe;
    }, [props.navigation, pageActive.current]);

    useEffect(() => {
        const unsubscribe = props.navigation.addListener('blur', () => {
            pageActive.current = false;
        });
        return unsubscribe;
    }, [props.navigation, pageActive.current]);

    useEffect(() => {
        pageActive.current = true;
        return () => {
            pageActive.current = false;
        };
    }, []);

    const changePermission = async () => {
        let permResp = await Location.requestForegroundPermissionsAsync();
        if (permResp.status == 'granted') {
            let { status } = await Location.requestBackgroundPermissionsAsync();
            if (status === 'granted') {
                dispatch(updateProfile({ driverActiveStatus: true }));
                setChecks({ ...checks, driverActiveStatus: true });
            }
        }
        else {
            if (Platform.OS == 'ios') {
                Linking.openSettings()
            } else {
                startActivityAsync(ActivityAction.LOCATION_SOURCE_SETTINGS);
            }
        }
    }
    const windoWidth = Dimensions.get("window").width
    const windoHight = Dimensions.get("window").height

    // Adicionar verificações de segurança
    const isProfileApproved = auth && auth.profile && auth.profile.approved === true;
    const hasCarType = auth && auth.profile && auth.profile.carType;
    const isCarApproved = auth && auth.profile && auth.profile.carApproved;
    const hasLicenseImage = auth && auth.profile && auth.profile.licenseImage;
    const hasVerifyIdImage = auth && auth.profile && auth.profile.verifyIdImage;
    const hasTerm = auth && auth.profile && auth.profile.term;

    return (
        <View style={[styles.mainViewStyle, { backgroundColor: theme.background }]}>
            <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} backgroundColor={theme.background} />
            <Header />
            <KeyboardAvoidingView behavior={Platform.OS == "ios" ? "padding" : (__DEV__ ? null : "padding")} style={{ flex: 1 }}>
                <View style={{ height: '80%' }}>
                    <FlatList
                        data={auth.profile && auth.profile.uid && auth.profile.driverActiveStatus ?
                            (appConsts && appConsts.showBookingOptions ? tasks ? tasks : activeBookings : auth.profile.queue ? activeBookings : tasks) : []}
                        keyExtractor={(item, index) => index.toString()}
                        ListEmptyComponent={
                            <View style={{ height: '100%', width: width, overflow: 'hidden' }}>
                                {region && region.latitude && pageActive.current && auth?.profile ? (
                                    <MapView
                                        region={{
                                            latitude: region.latitude,
                                            longitude: region.longitude,
                                            latitudeDelta: latitudeDelta,
                                            longitudeDelta: longitudeDelta
                                        }}
                                        minZoomLevel={3}
                                        provider={PROVIDER_GOOGLE}
                                        style={{ minHeight: height - 60, height: height - (Platform.OS == 'android' ? 15 : 60), width: width }}
                                    >
                                        <UrlTile
                                            urlTemplate="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                            maximumZ={19}
                                            flipY={false}
                                        />
                                        <Marker
                                            coordinate={{ latitude: region.latitude, longitude: region.longitude }}
                                            pinColor={theme.primary}
                                        >
                                            <View style={{ alignItems: 'center' }}>
                                                <View style={{ alignItems: 'center', backgroundColor: theme.card, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, borderColor: theme.border, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 5 }}>
                                                    <Typography variant="small" weight="bold" color={theme.leafGreen || colors.BUTTON_ORANGE}>{t('where_are_you')}</Typography>
                                                    <Typography variant="caption" weight="medium" color={theme.textSecondary}>{auth.profile?.driverActiveStatus ? t('rider_not_here') : t('service_off')}</Typography>
                                                </View>
                                                <Image
                                                    source={carImageIcon}
                                                    style={{ height: 40, width: 40, tintColor: theme.leafGreen }}
                                                />
                                            </View>
                                        </Marker>
                                    </MapView>
                                ) : gps?.error ? (
                                    <View style={{ alignItems: 'center', justifyContent: 'center', height: height - 200, width: width }}>
                                        <Ionicons name="location-outline" size={48} color={theme.error || colors.RED} style={{ marginBottom: 16 }} />
                                        <Typography variant="h2" weight="bold" color={theme.text} style={{ marginBottom: 8 }}>{t('location_permission_error')}</Typography>
                                        <Typography variant="caption" color={theme.textSecondary} style={{ textAlign: 'center', paddingHorizontal: 20 }}>
                                            É necessário permitir o acesso à localização para visualizar o mapa
                                        </Typography>
                                    </View>
                                ) : (
                                    <View style={{ alignItems: 'center', justifyContent: 'center', height: height - 200, width: width }}>
                                        {isLoading ? (
                                            <>
                                                <ActivityIndicator size="large" color={theme.leafGreen} />
                                                <Typography variant="caption" color={theme.textSecondary} style={{ marginTop: 12 }}>{t('loading')}</Typography>
                                            </>
                                        ) : (
                                            <>
                                                <Ionicons name="time-outline" size={64} color={theme.textSecondary} style={{ marginBottom: 16, opacity: 0.5 }} />
                                                <Typography variant="h2" weight="bold" color={theme.text} style={{ marginBottom: 8 }}>
                                                    Nenhuma viagem encontrada
                                                </Typography>
                                                <Typography variant="caption" color={theme.textSecondary} style={{ textAlign: 'center', paddingHorizontal: 40 }}>
                                                    Quando você aceitar corridas, elas aparecerão aqui no histórico
                                                </Typography>
                                            </>
                                        )}
                                    </View>
                                )}
                                {gps.error || (!hasCarType && settings && settings.carType_required) || (!isCarApproved && settings && settings.carType_required) || (!hasLicenseImage && settings && settings.license_image_required) || (!isProfileApproved && settings && settings.driver_approval) || (settings && settings.imageIdApproval && !hasVerifyIdImage) || (!hasTerm && settings && settings.term_required) ?
                                    <View style={{
                                        top: 0, left: 0, position: 'absolute', width: width - 20, margin: 10, borderRadius: 8, flexDirection: 'column', alignItems: 'center', backgroundColor: colors.new,
                                        shadowColor: colors.BLACK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.75, shadowRadius: 4, elevation: 5,
                                        minHeight: 10 + (gps.error ? 70 : 0) + (!hasCarType && settings && settings.carType_required ? 70 : 0) + (!isCarApproved && settings && settings.carType_required ? 70 : 0) + (!isProfileApproved && settings && settings.driver_approval ? 70 : 0) + (!hasLicenseImage && settings && settings.license_image_required ? 70 : 0) + (settings && settings.imageIdApproval && !hasVerifyIdImage ? 70 : 0) + (!hasTerm && settings && settings.term_required ? 70 : 0)
                                    }}>
                                        {gps.error ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row', }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row', }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={18} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('always_on')}</Text>
                                                </View>
                                                <Button onPress={changePermission} title={t('fix').toUpperCase()} titleStyle={styles.checkButtonTitle} buttonStyle={styles.checkButtonStyle} />
                                            </View>
                                            : null}
                                        {!hasCarType && settings && settings.carType_required ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={18} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('no_car_assign_text')}</Text>
                                                </View>
                                                <Button onPress={() => props.navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Cars', params: { fromPage: 'DriverTrips' } }] }))}
                                                    title={t('cars')} titleStyle={styles.checkButtonTitle} buttonStyle={styles.checkButtonStyle} />
                                            </View>
                                            : null}
                                        {!isCarApproved && settings && settings.carType_required ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={16} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('carApproved_by_admin')}</Text>
                                                </View>
                                            </View>
                                            : null}
                                        {!hasLicenseImage && settings && settings.license_image_required ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={16} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('upload_driving_license')}</Text>
                                                </View>
                                                <Button onPress={navEditUser} title={t('profile')} titleStyle={styles.checkButtonTitle} buttonStyle={styles.checkButtonStyle} />
                                            </View>
                                            : null}
                                        {!isProfileApproved && settings && settings.driver_approval ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row', width: "100%" }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={18} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('admin_contact')}</Text>
                                                </View>
                                            </View>
                                            : null}
                                        {settings && settings.imageIdApproval && !hasVerifyIdImage ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <View style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row', padding: 2 }]}>
                                                    <Icon name="alert-circle" type="ionicon" color={colors.RED} size={18} />
                                                    <Text style={{ fontSize: 14, fontFamily: fonts.Bold, color: colors.BLACK, marginLeft: 3 }}>{t('upload_id_details')}</Text>
                                                </View>
                                                <Button onPress={navEditUser} title={t('profile')} titleStyle={styles.checkButtonTitle} buttonStyle={[styles.checkButtonStyle, { width: 90 }]} />
                                            </View>
                                            : null}
                                        {!hasTerm && settings && settings.term_required ?
                                            <View style={[styles.alrt, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <TouchableOpacity onPress={onTermLink} style={[styles.alrt1, { flexDirection: isRTL ? 'row-reverse' : 'row', width: width - 180, height: 50 }]}>
                                                    <Icon name="document-text" type="ionicon" color={colors.RED} size={18} />
                                                    <Typography variant="caption" weight="bold" color={theme.leafGreen} style={{ marginLeft: 3, textDecorationLine: 'underline' }}>{t('term_condition')}</Typography>
                                                </TouchableOpacity>
                                                <AnimatedButton onPress={onTermAccept} title={t('accept')} variant="primary" small />
                                            </View>
                                            : null}
                                    </View>
                                    : null}

                            </View>
                        }
                        renderItem={({ item, index }) => {
                            return (
                                <View style={styles.listItemView}>
                                    {/* <View style={styles.listItemView}> */}
                                    <View style={[styles.mapcontainer, activeBookings && activeBookings.length >= 1 ? { height: height - 500 } : null]}>
                                        <MapView style={styles.map}
                                            provider={PROVIDER_GOOGLE}
                                            minZoomLevel={3}
                                            initialRegion={{
                                                latitude: item.pickup.lat,
                                                longitude: item.pickup.lng,
                                                latitudeDelta: activeBookings && activeBookings.length >= 1 ? 0.0922 : 0.0822,
                                                longitudeDelta: activeBookings && activeBookings.length >= 1 ? 0.0421 : 0.0321
                                            }}
                                        >
                                            <UrlTile
                                                urlTemplate="https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                                maximumZ={19}
                                                flipY={false}
                                            />
                                            <Marker
                                                coordinate={{ latitude: item.pickup.lat, longitude: item.pickup.lng }}
                                                title={item.pickup.add}
                                                description={t('pickup_location')}>
                                                <Image source={require("../../assets/images/green_pin.png")} style={{ height: 35, width: 35 }} />
                                            </Marker>

                                            <Marker
                                                coordinate={{ latitude: item.drop.lat, longitude: item.drop.lng }}
                                                title={item.drop.add}
                                                description={t('drop_location')}>
                                                <Image source={require("../../assets/images/rsz_2red_pin.png")} style={{ height: 35, width: 35 }} />
                                            </Marker>
                                            {item.waypoints && item.waypoints.length > 0 ? item.waypoints.map((point, index) => {
                                                return (
                                                    <Marker
                                                        coordinate={{ latitude: point.lat, longitude: point.lng }}
                                                        title={point.add}
                                                        key={index}
                                                    >
                                                        <Image source={require("../../assets/images/rsz_2red_pin.png")} style={{ height: 35, width: 35 }} />
                                                    </Marker>
                                                )
                                            })
                                                : null}
                                            {item.coords ?
                                                <Polyline
                                                    coordinates={item.coords}
                                                    strokeWidth={4}
                                                    strokeColor={colors.INDICATOR_BLUE}
                                                />
                                                : null}
                                        </MapView>
                                    </View>
                                    <View style={[styles.mapDetails, { backgroundColor: theme.card, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderTopWidth: 1, borderTopColor: theme.border }]}>
                                        <View style={styles.dateView}>
                                            <View>
                                                <Typography variant="h2" weight="bold" color={theme.text} style={{ alignSelf: 'center', marginTop: 5 }}>
                                                    {moment(item.tripdate).format('lll')}
                                                </Typography>
                                            </View>
                                            <RateView
                                                uid={auth.profile.uid}
                                                settings={settings}
                                                item={item}
                                                styles={styles}
                                            />
                                            <View style={[styles.estimateView, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                                                <Typography variant="h3" color={theme.text}>
                                                    {item.estimateDistance ? parseFloat(item.estimateDistance).toFixed(settings.decimal) : 0} {settings.convert_to_mile ? t('mile') : t('km')}
                                                </Typography>
                                                <Typography variant="h3" color={theme.text}>
                                                    {item.estimateTime ? parseFloat(item.estimateTime / 60).toFixed(0) : 0} {t('mins')}
                                                </Typography>
                                            </View>
                                        </View>
                                        <View style={[styles.addressViewStyle, isRTL ? {} : {}]}>
                                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', marginBottom: 8, width: '100%' }}>
                                                <View style={[styles.locationStyle, { backgroundColor: theme.leafGreen }]}>
                                                    <Ionicons name="location-sharp" size={20} color="white" />
                                                </View>
                                                <Typography variant="caption" color={theme.text} style={[isRTL ? { marginRight: 8 } : { marginLeft: 8 }, { textAlign: isRTL ? 'right' : 'left', flex: 1 }]}>
                                                    {item.pickup.add}
                                                </Typography>
                                            </View>
                                            {item.waypoints && item.waypoints.length > 0 ? item.waypoints.map((point, index) => {
                                                return (
                                                    <View key={"key" + index} style={{ marginBottom: 8, flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' }}>
                                                        <View style={[styles.locationStyle, { backgroundColor: theme.textSecondary }]}>
                                                            <Ionicons name="location-sharp" size={16} color="white" />
                                                        </View>
                                                        <Typography variant="caption" color={theme.text} style={[isRTL ? { marginRight: 8 } : { marginLeft: 8 }, { textAlign: isRTL ? 'right' : 'left', flex: 1 }]}>
                                                            {point.add}
                                                        </Typography>
                                                    </View>
                                                )
                                            })
                                                : null}
                                            <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' }}>
                                                <View style={[styles.locationStyle, { backgroundColor: '#E74C3C' }]}>
                                                    <Ionicons name="location-sharp" size={20} color="white" />
                                                </View>
                                                <Typography variant="caption" color={theme.text} style={[isRTL ? { marginRight: 8 } : { marginLeft: 8 }, { textAlign: isRTL ? 'right' : 'left', flex: 1 }]}>
                                                    {item.drop.add}
                                                </Typography>
                                            </View>
                                        </View>
                                        <ExtraInfo
                                            item={item}
                                            uid={auth.profile.uid}
                                            amount={amount}
                                            setAmount={setAmount}
                                            styles={styles}
                                            onPressAccept={onPressAccept}
                                            settings={settings}
                                        />
                                        {item && item.status != 'NEW' ?
                                            <View style={styles.detailsBtnView}>
                                                <AnimatedButton
                                                    onPress={() => goToBooking(item.id)}
                                                    title={t('go_to_booking')}
                                                    variant="primary"
                                                    style={{ width: '90%', alignSelf: 'center' }}
                                                />
                                            </View>
                                            :
                                            <View style={[styles.detailsBtnView, { flexDirection: isRTL ? 'row-reverse' : 'row', paddingHorizontal: 16 }]}>
                                                <AnimatedButton
                                                    onPress={() => {
                                                        setModalVisible(true);
                                                        setSelectedItem(item);
                                                    }}
                                                    title={t('ignore_text')}
                                                    variant="danger"
                                                    style={{ flex: 1, marginRight: isRTL ? 0 : 8, marginLeft: isRTL ? 8 : 0 }}
                                                />
                                                {(item.deliveryWithBid && !(item.driverOffers && item.driverOffers[auth.profile.uid])) || (!item.deliveryWithBid && (!appConsts.acceptWithAmount || (appConsts.acceptWithAmount && !(item.driverOffers && item.driverOffers[auth.profile.uid])))) ?
                                                    <AnimatedButton
                                                        title={t('accept')}
                                                        onPress={() => onPressAccept(item, amount[item.id])}
                                                        variant="primary"
                                                        style={{ flex: 1, marginLeft: isRTL ? 0 : 8, marginRight: isRTL ? 8 : 0 }}
                                                    />
                                                    : null}
                                            </View>
                                        }
                                    </View>

                                </View>
                            )
                        }
                        }
                    />
                </View>
                <View style={[styles.report, { backgroundColor: theme.card, borderTopWidth: 1, borderTopColor: theme.border, paddingVertical: 16 }]}>
                    <TouchableOpacity
                        style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', width: '90%', alignSelf: 'center', marginBottom: 16 }}
                        onPress={() => props.navigation.navigate("MyEarning")}
                    >
                        <Typography variant="h2" weight="bold" color={theme.text}>{t('today_text')}</Typography>
                        <MaterialIcons
                            name="keyboard-arrow-right"
                            size={28}
                            color={theme.leafGreen}
                        />
                    </TouchableOpacity>
                    <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', width: '90%', alignSelf: 'center' }}>
                        <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center' }}>
                            <Typography variant="h2" weight="bold" color={theme.leafGreen}>{bookingCount}</Typography>
                            <Typography variant="body" color={theme.textSecondary} style={{ marginHorizontal: 6 }}>{t('rides')}</Typography>
                        </View>
                        <Typography variant="h2" weight="bold" color={theme.leafGreen}>
                            {settings.swipe_symbol === false ?
                                `${settings.symbol}${today ? parseFloat(today).toFixed(settings.decimal) : '0'}` :
                                `${today ? parseFloat(today).toFixed(settings.decimal) : '0'}${settings.symbol}`
                            }
                        </Typography>
                    </View>
                </View>

            </KeyboardAvoidingView >

            <View style={styles.modalPage}>
                <Modal
                    animationType="slide"
                    transparent={true}
                    visible={modalVisible}
                    onRequestClose={() => {
                        setModalVisible(false);
                    }}>
                    <View style={styles.modalMain}>
                        <View style={[styles.modalContainer, { backgroundColor: theme.card, borderRadius: 20, padding: 24, maxHeight: 220 }]}>
                            <View style={styles.modalHeading}>
                                <Typography variant="h2" weight="bold" color={theme.text}>{t('alert_text')}</Typography>
                            </View>
                            <View style={[styles.modalBody, { marginVertical: 20 }]}>
                                <Typography variant="body" color={theme.textSecondary} style={{ textAlign: 'center' }}>
                                    {t('ignore_job_title')}
                                </Typography>
                            </View>
                            <View style={[styles.modalFooter, { flexDirection: isRTL ? 'row-reverse' : 'row', borderTopWidth: 0 }]}>
                                <AnimatedButton
                                    onPress={() => {
                                        setModalVisible(!modalVisible);
                                        setSelectedItem(null);
                                    }}
                                    title={t('cancel')}
                                    variant="secondary"
                                    style={{ flex: 1, marginRight: isRTL ? 0 : 8, marginLeft: isRTL ? 8 : 0 }}
                                />
                                <AnimatedButton
                                    onPress={() => {
                                        onPressIgnore(selectedItem.id)
                                    }}
                                    title={t('ok')}
                                    variant="primary"
                                    style={{ flex: 1, marginLeft: isRTL ? 0 : 8, marginRight: isRTL ? 8 : 0 }}
                                />
                            </View>
                        </View>
                    </View>
                </Modal>
            </View>
        </View >
    )
}

const styles = StyleSheet.create({
    alrt: {
        width: width - 40,
        minHeight: 60,
        marginTop: 10,
        padding: 5,
        borderWidth: 1,
        borderColor: colors.BORDER_BACKGROUND,
        borderRadius: 5,
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    report: {
        height: '30%',
        width: '100%',
        alignSelf: 'center',
        borderTopRightRadius: 15,
        borderTopLeftRadius: 15,
        backgroundColor: colors.WHITE,
        marginTop: -10,
        shadowColor: 'black',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: Platform.OS == 'ios' ? 0.1 : 0.8,
        shadowRadius: 3,
        elevation: Platform.OS == 'ios' ? 2 : 8,
    },
    locationStyle: {
        height: 35,
        width: 35,
        backgroundColor: MAIN_COLOR,
        justifyContent: 'center',
        borderRadius: 25,
        alignItems: 'center',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.5,
        shadowRadius: 5,
        elevation: 2,

    },
    alrt1: {
        justifyContent: 'flex-start',
        alignItems: 'center',
        height: '100%',
        width: "65%",

    },
    headerStyle: {
        backgroundColor: colors.HEADER,
        borderBottomWidth: 0
    },
    headerInnerStyle: {
        marginLeft: 10,
        marginRight: 10
    },
    btn: {
        width: 110,
        borderRadius: 10,
        height: 55,
    },
    headerTitleStyle: {
        color: colors.WHITE,
        fontFamily: fonts.Bold,
        fontSize: 20,
        marginTop: 3
    },
    mapcontainer: {
        width: width,
        height: 180,
        borderColor: colors.HEADER,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mapDetails: {
        backgroundColor: colors.WHITE,
        flex: 1,
        flexDirection: 'column',
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 3,
        width: '98%',
        alignSelf: 'center',
        borderRadius: 10,
        marginTop: -10,
    },
    map: {
        flex: 1,
        ...StyleSheet.absoluteFillObject,
        overflow: 'hidden'
    },
    triangle: {
        width: 0,
        height: 0,
        backgroundColor: colors.TRANSPARENT,
        borderStyle: 'solid',
        borderLeftWidth: 9,
        borderRightWidth: 9,
        borderBottomWidth: 10,
        borderLeftColor: colors.TRANSPARENT,
        borderRightColor: colors.TRANSPARENT,
        borderBottomColor: colors.BOX_BG,
        transform: [
            { rotate: '180deg' }
        ]
    },
    signInTextStyle: {
        fontFamily: 'Roboto-Bold',
        fontWeight: "700",
        color: colors.WHITE
    },
    listItemView: {
        flex: 1,
        width: '100%',
        marginBottom: 10,
        flexDirection: 'column',
    },
    dateView: {
        backgroundColor: SECONDORY_COLOR,
        shadowColor: "#000",
        shadowOffset: {
            width: 0,
            height: 3,
        },
        shadowOpacity: 0.2,
        shadowRadius: 3,
        elevation: 2,
        borderTopRightRadius: 10,
        borderTopLeftRadius: 10,
        marginBottom: 10,
    },
    listDate: {
        fontSize: 20,
        fontFamily: fonts.Bold,
        paddingLeft: 10,
        color: colors.BLACK,
        alignSelf: 'center',
        marginTop: 5
    },
    estimateView: {
        flex: 1.1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        marginBottom: 10
    },
    listEstimate: {
        fontSize: 20,
        color: colors.BLACK,
        fontFamily: fonts.Regular
    },
    addressViewStyle: {
        width: '97%',
        marginHorizontal: 5,
    },
    no_driver_style: {
        color: colors.DRIVER_TRIPS_TEXT,
        fontSize: 18,
    },
    addressViewTextStyle: {
        color: colors.BLACK,
        fontSize: 15,
        flex: 1,
        fontFamily: fonts.Regular
    },
    greenDot: {
        backgroundColor: colors.GREEN_DOT,
        width: 10,
        height: 10,
        borderRadius: 50
    },
    redDot: {
        backgroundColor: colors.RED,
        width: 10,
        height: 10,
        borderRadius: 50
    },
    detailsBtnView: {
        flex: 2,
        justifyContent: 'space-between',
        width: width,
        marginTop: 20,
        marginBottom: 20
    },

    modalPage: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalMain: {
        flex: 1,
        backgroundColor: colors.BACKGROUND,
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalContainer: {
        width: '80%',
        backgroundColor: colors.WHITE,
        borderRadius: 10,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        paddingTop: 15,
        flex: 1,
        maxHeight: 180
    },
    modalHeading: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalBody: {
        flex: 2,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center'
    },
    modalFooter: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        borderTopColor: colors.FOOTERTOP,
        borderTopWidth: 1,
        width: '100%',
    },
    btnStyle: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mainViewStyle: {
        flex: 1,
    },
    headerCustom: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 45,
        paddingBottom: 16,
    },
    headerButtonCustom: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 1,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    headerTitleCustom: {
        fontSize: 18,
        fontWeight: 'bold',
        fontFamily: fonts.Bold,
    },
    headerRightContainerCustom: {
        width: 40,
    },
    myButtonStyle: {
        backgroundColor: colors.RED,
        width: height / 6,
        padding: 2,
        borderColor: colors.TRANSPARENT,
        borderWidth: 0,
        borderRadius: 5,
    },
    alertStyle: {
        fontFamily: fonts.Bold,
        fontSize: 18,
        width: '100%',
        textAlign: 'center'
    },
    cancelTextStyle: {
        color: colors.INDICATOR_BLUE,
        fontSize: 18,
        fontFamily: fonts.Bold,
        width: "100%",
        textAlign: 'center'
    },
    okStyle: {
        color: colors.INDICATOR_BLUE,
        fontSize: 18,
        fontFamily: fonts.Bold
    },
    viewFlex1: {
        flex: 1
    },
    clickText: {
        borderRightColor: colors.DRIVER_TRIPS_TEXT,
        borderRightWidth: 1
    },
    titleStyles: {
        width: "100%",
        alignSelf: 'center',
        fontFamily: fonts.Bold
    },
    rateViewStyle: {
        alignItems: 'center',
        flex: 2,
        marginBottom: 0
    },
    rateViewTextStyle: {
        fontSize: 25,
        fontFamily: fonts.Bold,
        textAlign: "center"
    },
    textContainerStyle: {
        marginHorizontal: 15,
        marginTop: 10
    },
    deliveryOption: {
        justifyContent: 'space-around',
        borderTopWidth: 0.5,
        borderBottomWidth: 0.5,
        marginTop: 10,
        padding: 6
    },
    textContainerStyle2: {
        flexDirection: 'column',
        alignItems: "flex-start",
        marginLeft: 35,
        marginRight: 35,
        marginTop: 10
    },
    textHeading: {
        fontSize: 15,
        fontFamily: fonts.Regular
    },
    textContent: {
        fontSize: 15,
        marginLeft: 3,
        fontFamily: fonts.Bold
    },
    textContent2: {
        marginTop: 4,
        color: colors.DRIVER_TRIPS_TEXT,
        fontSize: 15
    },
    box: {
        height: 45,
        backgroundColor: colors.WHITE,
        marginTop: 10,
        marginLeft: 20,
        marginRight: 20,
        borderWidth: 1,
        borderColor: colors.BLACK,
        justifyContent: 'center',
        borderRadius: 10
    },
    labelStyle: {
        fontFamily: fonts.Regular,
        fontSize: 13,
        color: colors.BLACK,
        marginTop: 15,
        alignSelf: 'center'
    },
    dateTextStyle: {
        marginLeft: 14,
        fontFamily: fonts.Regular,
        fontSize: 14,
        color: colors.BLACK
    },
    checkButtonStyle: {
        backgroundColor: colors.GREEN,
        width: 110,
        minHeight: 40,
        borderColor: colors.TRANSPARENT,
        borderWidth: 0,
        borderRadius: 5
    },
    checkButtonTitle: {
        fontFamily: fonts.Bold,
        fontSize: 12,
        color: colors.WHITE
    },
    priceView: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center"
    },
    priceViewHeading: {
        fontSize: 18,
        fontFamily: fonts.Regular
    },
    priceViewContent: {
        fontSize: 18,
        marginLeft: 3,
        fontFamily: fonts.Bold
    },

});

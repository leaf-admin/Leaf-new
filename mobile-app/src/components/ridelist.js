import Logger from '../utils/Logger';
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image, Dimensions, Modal, Linking, Alert, Animated, TouchableWithoutFeedback, Platform } from 'react-native';
import { colors } from '../common/theme';

// Importar i18n com fallback para compatibilidade
let i18nModule = null;
try {
    i18nModule = require('../i18n');
} catch (error) {
    Logger.warn('i18n não encontrado');
}

// Criar objeto i18n compatível
const i18n = i18nModule && i18nModule.default ? i18nModule.default : (i18nModule || {
    locale: 'pt',
    t: (key) => key
});
import { useSelector } from 'react-redux';
import SegmentedControlTab from 'react-native-segmented-control-tab';
import moment from 'moment/min/moment-with-locales';
import { MAIN_COLOR, SECONDORY_COLOR, appConsts } from '../common/sharedFunctions';
var { width, height } = Dimensions.get('window');
import { Ionicons, Entypo, Fontisto, AntDesign, Octicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from 'react-native-elements';
import StarRating from 'react-native-star-rating-widget';
import Button from './Button';
import RNPickerSelect from './RNPickerSelect';
import Emptylist from './Emptylist';
import { fonts } from '../common/font';
import { getLangKey } from '../common-local/other/getLangKey';
import MapView, { Marker, Polyline } from 'react-native-maps';

export default function RideList(props) {
    // Função de tradução segura - compatível com i18n antigo e novo
    const t = (key) => {
        try {
            // Se i18n tem propriedade t (novo sistema)
            if (i18n && typeof i18n.t === 'function') {
                return i18n.t(key);
            }
            // Se i18n tem t como propriedade (sistema antigo)
            if (i18n && i18n.t && typeof i18n.t === 'function') {
                return i18n.t(key);
            }
            // Se i18n tem a chave diretamente
            if (i18n && i18n[key]) {
                return i18n[key];
            }
            // Fallback: retornar a chave
            return key;
        } catch (error) {
            Logger.warn(`Erro ao traduzir "${key}":`, error);
            return key;
        }
    };
    const isRTL = i18n.locale && (i18n.locale.indexOf('he') === 0 || i18n.locale.indexOf('ar') === 0);
    //const isRTL = true;
    const settings = useSelector(state => state.settingsdata.settings);
    const [tabIndex, setTabIndex] = useState(props.tabIndex);
    const auth = useSelector(state => state.auth);
    const [expandedItem, setExpandedItem] = useState(null);

    const [scaleAnim] = useState(new Animated.Value(0))
    useEffect(() => {
        Animated.spring(
            scaleAnim,
            {
                toValue: 1,
                friction: 3,
                useNativeDriver: true
            }
        ).start();
    }, [])

    const onPressButton = (item, index) => {
        props.onPressButton(item, index)
    }

    const onPressAction = (item, index) => {
        props.onPressAction(item, index)
    }

    const onChatAction = (item, index) => {
        props.onChatAction(item, index)
    }

    const [role, setRole] = useState();
    const [userInfoModalStatus, setUserInfoModalStatus] = useState(false);

    useEffect(() => {
        if (auth.profile && auth.profile.usertype) {
            setRole(auth.profile.usertype);
        } else {
            setRole(null);
        }
    }, [auth.profile]);

    const onPressCall = (phoneNumber) => {
        let call_link = Platform.OS == 'android' ? 'tel:' + phoneNumber : 'telprompt:' + phoneNumber;
        Linking.openURL(call_link);
    }

    const onAlert = (item) => {
        if (item.status === "COMPLETE") Alert.alert(t('alert'), t('booking_is') + t('COMPLETE') + "." + t('not_call'));
        if (item.status === "CANCELLED") Alert.alert(t('alert'), t('booking_is') + t('CANCELLED') + "." + t('not_call'));
        if (item.status === "PAID") Alert.alert(t('alert'), t('booking_is') + t('PAID') + "." + t('not_call'));
    }

    const onChatAlert = (item) => {
        if (item.status === "COMPLETE") Alert.alert(t('alert'), t('booking_is') + t('COMPLETE') + "." + t('not_chat'));
        if (item.status === "CANCELLED") Alert.alert(t('alert'), t('booking_is') + t('CANCELLED') + "." + t('not_chat'));
        if (item.status === "PAID") Alert.alert(t('alert'), t('booking_is') + t('PAID') + "." + t('not_chat'));
    }

    const goHome = () => {
        props.goHome()
    }

    const renderData = ({ item, index }) => {
        const isExpanded = expandedItem === index;

        return (
            <View style={styles.rideContainer}>
                <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setExpandedItem(isExpanded ? null : index)}
                    style={styles.rideHeader}
                >
                    <View style={styles.locationsContainer}>
                        <View style={styles.locationRow}>
                            <Ionicons name="location" size={20} color={colors.BALANCE_GREEN} />
                            <Text style={styles.locationText} numberOfLines={1}>{item.pickup.add}</Text>
                        </View>
                        <View style={styles.locationRow}>
                            <Ionicons name="location" size={20} color={colors.BUTTON_ORANGE} />
                            <Text style={styles.locationText} numberOfLines={1}>{item.drop.add}</Text>
                        </View>
                    </View>
                    <View style={styles.timeContainer}>
                        <Text style={styles.timeText}>
                            {moment(item.startTime).format('HH:mm')}
                        </Text>
                        <Text style={styles.dateText}>
                            {moment(item.startTime).format('DD/MM/YYYY')}
                        </Text>
                    </View>
                    <Ionicons
                        name={isExpanded ? "chevron-up" : "chevron-down"}
                        size={24}
                        color={MAIN_COLOR}
                    />
                </TouchableOpacity>

                {isExpanded && (
                    <View style={styles.expandedContent}>
                        <View style={styles.mapContainer}>
                            <MapView
                                style={styles.map}
                                initialRegion={{
                                    latitude: item.pickup.lat,
                                    longitude: item.pickup.lng,
                                    latitudeDelta: 0.0922,
                                    longitudeDelta: 0.0421,
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
                                >
                                    <Ionicons name="location" size={24} color={colors.BALANCE_GREEN} />
                                </Marker>
                                <Marker
                                    coordinate={{ latitude: item.drop.lat, longitude: item.drop.lng }}
                                    title={item.drop.add}
                                >
                                    <Ionicons name="location" size={24} color={colors.BUTTON_ORANGE} />
                                </Marker>
                                {item.coords && (
                                    <Polyline
                                        coordinates={item.coords}
                                        strokeWidth={4}
                                        strokeColor={MAIN_COLOR}
                                    />
                                )}
                            </MapView>
                        </View>

                        <View style={styles.driverInfo}>
                            <View style={styles.driverHeader}>
                                <Avatar
                                    size="medium"
                                    rounded
                                    source={item.driver_image ? { uri: item.driver_image } : require('../../assets/images/profilePic.png')}
                                />
                                <View style={styles.driverDetails}>
                                    <Text style={styles.driverName}>{item.driver_name || t('no_name')}</Text>
                                    <Text style={styles.carInfo}>{item.carType} - {item.carModel}</Text>
                                </View>
                            </View>

                            <View style={styles.priceContainer}>
                                <Text style={styles.priceLabel}>{t('total_price')}</Text>
                                <Text style={styles.priceValue}>
                                    {settings.symbol}{item.trip_cost ? parseFloat(item.trip_cost).toFixed(settings.decimal) : parseFloat(item.estimate).toFixed(settings.decimal)}
                                </Text>
                            </View>
                        </View>
                    </View>
                )}
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.tabContainer}>
                <TouchableOpacity
                    style={[styles.tab, tabIndex === 0 && styles.activeTab]}
                    onPress={() => setTabIndex(0)}
                >
                    <Text style={[styles.tabText, tabIndex === 0 && styles.activeTabText]}>
                        {t('active_booking')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, tabIndex === 1 && styles.activeTab]}
                    onPress={() => setTabIndex(1)}
                >
                    <Text style={[styles.tabText, tabIndex === 1 && styles.activeTabText]}>
                        {t('COMPLETE')}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, tabIndex === 2 && styles.activeTab]}
                    onPress={() => setTabIndex(2)}
                >
                    <Text style={[styles.tabText, tabIndex === 2 && styles.activeTabText]}>
                        {t('CANCELLED')}
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={tabIndex === 0
                    ? props.data.filter(item => !(item.status === 'CANCELLED' || item.status === 'COMPLETE'))
                    : tabIndex === 1
                        ? props.data.filter(item => item.status === 'COMPLETE')
                        : props.data.filter(item => item.status === 'CANCELLED')
                }
                renderItem={renderData}
                keyExtractor={(item, index) => index.toString()}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>{t('no_data_available')}</Text>
                    </View>
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.WHITE,
    },
    tabContainer: {
        flexDirection: 'row',
        backgroundColor: MAIN_COLOR,
        paddingVertical: 10,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
    },
    activeTab: {
        borderBottomWidth: 2,
        borderBottomColor: colors.WHITE,
    },
    tabText: {
        color: colors.WHITE,
        fontFamily: fonts.Bold,
        fontSize: 16,
        fontWeight: '600',
    },
    activeTabText: {
        color: colors.WHITE,
    },
    rideContainer: {
        backgroundColor: colors.WHITE,
        marginHorizontal: 16,
        marginVertical: 8,
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
        elevation: 6,
    },
    rideHeader: {
        flexDirection: 'row',
        padding: 16,
        alignItems: 'center',
    },
    locationsContainer: {
        flex: 1,
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    locationText: {
        flex: 1,
        marginLeft: 8,
        fontFamily: fonts.Regular,
        fontSize: 17,
        color: colors.BLACK,
        letterSpacing: 0.1,
    },
    timeContainer: {
        alignItems: 'flex-end',
        marginLeft: 16,
    },
    timeText: {
        fontFamily: fonts.Bold,
        fontSize: 16,
        color: MAIN_COLOR,
        fontWeight: '600',
    },
    dateText: {
        fontFamily: fonts.Regular,
        fontSize: 14,
        color: colors.GRAY,
        marginTop: 4,
    },
    expandedContent: {
        borderTopWidth: 1,
        borderTopColor: colors.GRAY_LIGHT,
    },
    mapContainer: {
        height: 200,
        margin: 16,
        borderRadius: 12,
        overflow: 'hidden',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },
    driverInfo: {
        padding: 16,
    },
    driverHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    driverDetails: {
        marginLeft: 12,
        flex: 1,
    },
    driverName: {
        fontFamily: fonts.Bold,
        fontSize: 17,
        color: colors.BLACK,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    carInfo: {
        fontFamily: fonts.Regular,
        fontSize: 14,
        color: colors.GRAY,
        marginTop: 4,
    },
    priceContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: colors.GRAY_LIGHT,
    },
    priceLabel: {
        fontFamily: fonts.Regular,
        fontSize: 14,
        color: colors.GRAY,
    },
    priceValue: {
        fontFamily: fonts.Bold,
        fontSize: 18,
        color: MAIN_COLOR,
        fontWeight: '600',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: height / 3,
    },
    emptyText: {
        fontFamily: fonts.Regular,
        fontSize: 16,
        color: colors.GRAY,
    },
});